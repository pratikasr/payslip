//! lightwalletd gRPC client helpers (the generated client ships in `zcash_client_backend`).

use std::time::Duration;

use anyhow::Context;
use tonic::transport::{Channel, ClientTlsConfig, Endpoint};
use zcash_client_backend::proto::service::{
    self, compact_tx_streamer_client::CompactTxStreamerClient, BlockId, ChainSpec, Empty, RawTransaction, TxFilter,
};
use zcash_primitives::transaction::{Transaction, TxId};
use zcash_protocol::consensus::{BlockHeight, BranchId, Parameters};

pub type Client = CompactTxStreamerClient<Channel>;

/// Opens a lazily connected channel; tonic reconnects on demand.
pub fn connect(url: &str) -> anyhow::Result<Client> {
    let mut endpoint = Endpoint::from_shared(url.to_string())
        .with_context(|| format!("invalid LIGHTWALLETD_URL {url}"))?
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .tcp_keepalive(Some(Duration::from_secs(30)))
        // HTTP/2 pings keep an idle connection open (servers close quiet ones after some
        // minutes) and reveal a dead one before a request is sent on it.
        .http2_keep_alive_interval(Duration::from_secs(30))
        .keep_alive_timeout(Duration::from_secs(20))
        .keep_alive_while_idle(true);
    if url.starts_with("https://") {
        endpoint = endpoint.tls_config(ClientTlsConfig::new().with_webpki_roots())?;
    }
    let channel = endpoint.connect_lazy();
    Ok(CompactTxStreamerClient::new(channel).max_decoding_message_size(64 * 1024 * 1024))
}

/// True when an error is the connection to lightwalletd failing (closed, reset, refused), as
/// opposed to lightwalletd answering with an error: worth reconnecting and trying again.
pub fn is_transport_error(e: &anyhow::Error) -> bool {
    let m = format!("{e:#}").to_ascii_lowercase();
    [
        "transport error",
        "close_notify",
        "connection reset",
        "connection refused",
        "broken pipe",
        "connection closed",
        "operation was canceled",
        "h2 protocol error",
    ]
    .iter()
    .any(|p| m.contains(p))
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct LightdInfo {
    pub chain_name: String,
    pub block_height: u64,
    pub vendor: String,
    pub version: String,
    pub consensus_branch_id: String,
}

pub async fn info(client: &mut Client) -> anyhow::Result<LightdInfo> {
    let i = client
        .get_lightd_info(Empty {})
        .await
        .context("GetLightdInfo")?
        .into_inner();
    Ok(LightdInfo {
        chain_name: i.chain_name,
        block_height: i.block_height,
        vendor: i.vendor,
        version: i.version,
        consensus_branch_id: i.consensus_branch_id,
    })
}

pub async fn tip(client: &mut Client) -> anyhow::Result<BlockHeight> {
    let b = client
        .get_latest_block(ChainSpec::default())
        .await
        .context("GetLatestBlock")?
        .into_inner();
    Ok(BlockHeight::from_u32(
        u32::try_from(b.height).context("tip height out of range")?,
    ))
}

/// Height and timestamp (Unix seconds) of the chain tip.
pub async fn tip_time(client: &mut Client) -> anyhow::Result<(u32, i64)> {
    let tip = tip(client).await?;
    let block = client
        .get_block(BlockId {
            height: u64::from(tip),
            hash: vec![],
        })
        .await
        .context("GetBlock at tip")?
        .into_inner();
    Ok((u32::from(tip), i64::from(block.time)))
}

/// Timestamp (Unix seconds) of the block at `height`.
pub async fn block_time(client: &mut Client, height: BlockHeight) -> anyhow::Result<i64> {
    let block = client
        .get_block(BlockId {
            height: u64::from(height),
            hash: vec![],
        })
        .await
        .with_context(|| format!("GetBlock at {height}"))?
        .into_inner();
    Ok(i64::from(block.time))
}

pub async fn tree_state(client: &mut Client, height: BlockHeight) -> anyhow::Result<service::TreeState> {
    Ok(client
        .get_tree_state(BlockId {
            height: u64::from(height),
            hash: vec![],
        })
        .await
        .with_context(|| format!("GetTreeState at {height}"))?
        .into_inner())
}

/// Fetches a transaction by id. `Ok(None)` if the server does not know it.
pub async fn fetch_tx<P: Parameters>(
    client: &mut Client,
    params: &P,
    chain_tip: BlockHeight,
    txid: TxId,
) -> anyhow::Result<Option<(Transaction, Option<BlockHeight>)>> {
    let raw = match client
        .get_transaction(TxFilter {
            hash: txid.as_ref().to_vec(),
            ..Default::default()
        })
        .await
    {
        Ok(r) => r.into_inner(),
        Err(status) if status.code() == tonic::Code::NotFound => return Ok(None),
        Err(status) if status.message().contains("No such mempool or") || status.message().contains("not found") => {
            return Ok(None)
        }
        Err(status) => return Err(status).context("GetTransaction"),
    };
    Ok(Some(parse_raw(params, chain_tip, raw)?))
}

/// The mined height of a transaction if the server has it in a block. `Ok(None)` when it is in
/// the mempool or unknown.
pub async fn mined_height(client: &mut Client, txid: TxId) -> anyhow::Result<Option<BlockHeight>> {
    match client
        .get_transaction(TxFilter {
            hash: txid.as_ref().to_vec(),
            ..Default::default()
        })
        .await
    {
        Ok(r) => {
            let h = r.into_inner().height;
            Ok((h > 0 && h < u64::from(u32::MAX)).then(|| BlockHeight::from_u32(h as u32)))
        }
        Err(status) if status.code() == tonic::Code::NotFound => Ok(None),
        Err(status) if status.message().contains("No such mempool or") || status.message().contains("not found") => {
            Ok(None)
        }
        Err(status) => Err(status).context("GetTransaction"),
    }
}

pub fn parse_raw<P: Parameters>(
    params: &P,
    chain_tip: BlockHeight,
    raw: RawTransaction,
) -> anyhow::Result<(Transaction, Option<BlockHeight>)> {
    let mined = (raw.height > 0 && raw.height < u64::from(u32::MAX)).then(|| BlockHeight::from_u32(raw.height as u32));
    let tx = Transaction::read(
        &raw.data[..],
        BranchId::for_height(params, mined.unwrap_or(chain_tip + 1)),
    )
    .context("parsing transaction")?;
    Ok((tx, mined))
}

#[derive(Debug, thiserror::Error)]
#[error("lightwalletd rejected the transaction ({code}): {message}")]
pub struct BroadcastError {
    pub code: i32,
    pub message: String,
}

impl BroadcastError {
    /// The node already has this transaction, so a rebroadcast is a success.
    pub fn is_duplicate(&self) -> bool {
        let m = self.message.to_ascii_lowercase();
        m.contains("already") || m.contains("txn-already-in-mempool") || m.contains("duplicate")
    }
}

pub async fn broadcast(client: &mut Client, raw: Vec<u8>) -> anyhow::Result<Result<(), BroadcastError>> {
    let resp = client
        .send_transaction(RawTransaction { data: raw, height: 0 })
        .await
        .context("SendTransaction")?
        .into_inner();
    if resp.error_code == 0 {
        Ok(Ok(()))
    } else {
        Ok(Err(BroadcastError {
            code: resp.error_code,
            message: resp.error_message,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Audit JD-04: the errors a dropped or refused connection produces are recognised as
    /// transport failures (worth a reconnect); an answer from lightwalletd is not.
    #[tokio::test]
    async fn dropped_connections_are_transport_errors() {
        // A server that accepts and immediately closes every connection.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((sock, _)) = listener.accept().await {
                drop(sock);
            }
        });
        let mut client = connect(&format!("http://{addr}")).unwrap();
        let err = tip(&mut client).await.unwrap_err();
        assert!(is_transport_error(&err), "{err:#}");
        // Nothing listening at all.
        let free = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let closed = free.local_addr().unwrap();
        drop(free);
        let mut client = connect(&format!("http://{closed}")).unwrap();
        let err = tip(&mut client).await.unwrap_err();
        assert!(is_transport_error(&err), "{err:#}");
        // The error seen on idle TLS connections in the audit.
        let idle =
            anyhow::anyhow!("sync failed: transport error: peer closed connection without sending TLS close_notify");
        assert!(is_transport_error(&idle));
        let answered = anyhow::anyhow!("GetTreeState at 99999998: the requested block is not in the main chain");
        assert!(!is_transport_error(&answered));
    }
}
