//! View-only scanning for statements: the chain read back with the viewing keys a contractor
//! or accountant supplied, never with the payer's wallet.
//!
//! Each distinct set of keys gets its own view-only wallet database under
//! `PAYSLIP_DATA_DIR/viewers/`, so repeated scans are incremental.

use std::{collections::HashMap, path::PathBuf, sync::Arc};

use anyhow::{anyhow, Context};
use sha2::{Digest, Sha256};
use zcash_client_backend::proto::service::BlockId;
use zcash_keys::keys::UnifiedFullViewingKey;
use zcash_protocol::consensus::{BlockHeight, Network};

use crate::{
    config::{Config, ZcashNetwork},
    error::ApiError,
    wallet::{WalletCore, WalletHandle},
};

/// A validated unified full viewing key.
#[derive(Clone, Debug)]
pub struct ViewingKey {
    pub ufvk: UnifiedFullViewingKey,
    /// Canonical encoding for this network (ZIP 316 Revision 2).
    pub encoded: String,
    /// Short stable identifier: first 16 hex chars of SHA-256 of the canonical encoding.
    pub fingerprint: String,
}

fn looks_like_seed_phrase(s: &str) -> bool {
    let words: Vec<&str> = s.split_whitespace().collect();
    words.len() >= 12 && words.iter().all(|w| w.chars().all(|c| c.is_ascii_lowercase()))
}

pub fn fingerprint_of(params: &Network, ufvk: &UnifiedFullViewingKey) -> String {
    let digest = Sha256::digest(ufvk.encode(params).as_bytes());
    hex::encode(&digest[..8])
}

impl ViewingKey {
    pub fn parse(network: &ZcashNetwork, raw: &str) -> Result<Self, ApiError> {
        let s: String = raw.split_whitespace().collect::<Vec<_>>().join(" ");
        let s = s.trim();
        let paste_hint = "Paste the full viewing key from Payslip. It starts with uviewtest or uvftest on testnet, uview or uvf on mainnet.";
        if s.is_empty() {
            return Err(ApiError::bad_request(
                "invalid_viewing_key",
                "No viewing key was supplied.",
                paste_hint,
            ));
        }
        if looks_like_seed_phrase(s) {
            return Err(ApiError::bad_request(
                "spending_key_rejected",
                "That looks like a seed phrase, which can spend funds. It was not stored or sent anywhere.",
                "Never share a seed phrase. Ask the payer for your viewing key instead.",
            ));
        }
        let lower = s.to_ascii_lowercase();
        if lower.starts_with("secret")
            || lower.starts_with("usk")
            || lower.starts_with("xprv")
            || lower.starts_with("tprv")
        {
            return Err(ApiError::bad_request(
                "spending_key_rejected",
                "That is a spending key. Payslip only accepts viewing keys and did not store it.",
                "Never share a spending key. Paste the viewing key (uview..., uvf...) instead.",
            ));
        }
        // ZIP 316 incoming viewing keys: Revision 0 `uivk`/`uivktest`, Revision 2 `uvi`/`uvitest`
        // (matched with their separator, since `uview` also begins with `uvi`).
        if lower.starts_with("uivk") || lower.starts_with("uvi1") || lower.starts_with("uvitest1") {
            return Err(ApiError::bad_request(
                "incoming_viewing_key",
                "That is an incoming viewing key. It cannot see payments the account sent, so it cannot produce a statement.",
                paste_hint,
            ));
        }
        if s.contains(' ') {
            return Err(ApiError::bad_request(
                "invalid_viewing_key",
                "A viewing key has no spaces.",
                paste_hint,
            ));
        }
        let params = network.params();
        match UnifiedFullViewingKey::decode(&params, s) {
            Ok(ufvk) => {
                let encoded = ufvk.encode(&params);
                let fingerprint = fingerprint_of(&params, &ufvk);
                Ok(ViewingKey {
                    ufvk,
                    encoded,
                    fingerprint,
                })
            }
            Err(e) => {
                let other = match network {
                    ZcashNetwork::Mainnet => Network::TestNetwork,
                    ZcashNetwork::Testnet => Network::MainNetwork,
                };
                if UnifiedFullViewingKey::decode(&other, s).is_ok() {
                    let (key_net, svc_net) = match network {
                        ZcashNetwork::Mainnet => ("testnet", "mainnet"),
                        ZcashNetwork::Testnet => ("mainnet", "testnet"),
                    };
                    return Err(ApiError::bad_request(
                        "wrong_network",
                        format!("This viewing key is for {key_net}, but this Payslip service runs on {svc_net}."),
                        format!("Use the {svc_net} key from the same payer, or open the {key_net} Payslip deployment."),
                    ));
                }
                Err(ApiError::bad_request(
                    "invalid_viewing_key",
                    format!("That is not a valid unified full viewing key ({e})."),
                    paste_hint,
                ))
            }
        }
    }
}

/// One output of a transaction that involves a scanned account.
#[derive(Clone, Debug)]
pub struct ScanOutput {
    pub txid: String,
    pub mined_height: Option<u32>,
    pub block_time: Option<i64>,
    pub expiry_height: Option<u32>,
    pub pool: i64,
    pub output_index: i64,
    /// Fingerprint of the scanned account that funded this output, if any.
    pub from_account: Option<String>,
    /// Fingerprint of the scanned account that received this output, if any.
    pub to_account: Option<String>,
    pub to_address: Option<String>,
    pub value_zat: u64,
    pub is_change: bool,
    pub memo: Option<Vec<u8>>,
    pub fee_zat: Option<u64>,
}

#[derive(Clone, Debug)]
pub struct ScanResult {
    pub scanned_to_height: u32,
    pub chain_tip: u32,
    pub outputs: Vec<ScanOutput>,
}

struct Viewer {
    handle: WalletHandle,
    path: PathBuf,
}

pub struct ViewerRegistry {
    params: Network,
    lightwalletd_url: String,
    dir: PathBuf,
    min_confirmations: u32,
    viewers: tokio::sync::Mutex<HashMap<String, Arc<Viewer>>>,
}

const MAX_OPEN_VIEWERS: usize = 32;

impl ViewerRegistry {
    pub fn new(cfg: &Config) -> Self {
        ViewerRegistry {
            params: cfg.network.params(),
            lightwalletd_url: cfg.lightwalletd_url.clone(),
            dir: cfg.viewers_dir(),
            min_confirmations: cfg.min_confirmations,
            viewers: tokio::sync::Mutex::new(HashMap::new()),
        }
    }

    async fn viewer(&self, set_key: &str) -> anyhow::Result<Arc<Viewer>> {
        let mut map = self.viewers.lock().await;
        if let Some(v) = map.get(set_key) {
            return Ok(v.clone());
        }
        if map.len() >= MAX_OPEN_VIEWERS {
            // Dropping a handle ends its thread once in-flight jobs finish; the database stays.
            map.clear();
        }
        let path = self.dir.join(format!("{set_key}.db"));
        let (params, p, url, conf) = (
            self.params,
            path.clone(),
            self.lightwalletd_url.clone(),
            self.min_confirmations,
        );
        let handle = WalletHandle::spawn(format!("viewer-{}", &set_key[..8]), move || {
            WalletCore::open(params, &p, &url, None, conf)
        })?;
        let v = Arc::new(Viewer { handle, path });
        map.insert(set_key.to_string(), v.clone());
        Ok(v)
    }

    /// Imports the keys (with their birthdays), syncs, and returns every output that involves
    /// them. `keys` are (key, label, birthday height).
    pub async fn scan(&self, keys: Vec<(ViewingKey, String, u32)>) -> anyhow::Result<ScanResult> {
        if keys.is_empty() {
            anyhow::bail!("no viewing keys");
        }
        let mut fps: Vec<&str> = keys.iter().map(|k| k.0.fingerprint.as_str()).collect();
        fps.sort();
        fps.dedup();
        let set_key = hex::encode(&Sha256::digest(fps.join(",").as_bytes())[..12]);
        let viewer = self.viewer(&set_key).await?;
        let path = viewer.path.clone();
        viewer
            .handle
            .run(move |w| {
                Box::pin(async move {
                    let mut by_uuid: HashMap<uuid::Uuid, String> = HashMap::new();
                    for (key, label, birthday) in &keys {
                        let id = w
                            .ensure_ufvk_account(label, &key.ufvk, BlockHeight::from_u32(*birthday))
                            .await?;
                        by_uuid.insert(id.expose_uuid(), key.fingerprint.clone());
                    }
                    let report = w.sync().await?;
                    let mut outputs = read_outputs(&path, &by_uuid)?;
                    // Fill block times the wallet did not record.
                    let mut times: HashMap<u32, i64> = HashMap::new();
                    for o in outputs.iter_mut() {
                        if let (None, Some(h)) = (o.block_time, o.mined_height) {
                            if let Some(t) = times.get(&h) {
                                o.block_time = Some(*t);
                                continue;
                            }
                            let block = w
                                .client()
                                .get_block(BlockId {
                                    height: u64::from(h),
                                    hash: vec![],
                                })
                                .await
                                .with_context(|| format!("GetBlock {h}"))?
                                .into_inner();
                            times.insert(h, i64::from(block.time));
                            o.block_time = Some(i64::from(block.time));
                        }
                    }
                    Ok(ScanResult {
                        scanned_to_height: report.fully_scanned,
                        chain_tip: report.chain_tip,
                        outputs,
                    })
                })
            })
            .await?
    }
}

fn uuid_from_row(v: rusqlite::types::ValueRef<'_>) -> Option<uuid::Uuid> {
    match v {
        rusqlite::types::ValueRef::Blob(b) => uuid::Uuid::from_slice(b).ok(),
        rusqlite::types::ValueRef::Text(t) => std::str::from_utf8(t).ok().and_then(|s| uuid::Uuid::parse_str(s).ok()),
        _ => None,
    }
}

fn read_outputs(path: &PathBuf, by_uuid: &HashMap<uuid::Uuid, String>) -> anyhow::Result<Vec<ScanOutput>> {
    let conn = rusqlite::Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .with_context(|| format!("opening {}", path.display()))?;
    let mut stmt = conn.prepare(
        "SELECT o.txid, t.mined_height, o.output_pool, o.output_index, o.from_account_uuid, o.to_account_uuid,
                o.to_address, o.value, o.is_change, o.memo, t.fee, t.expiry_height, b.time
         FROM v_tx_outputs o
         JOIN transactions t ON t.id_tx = o.transaction_id
         LEFT JOIN blocks b ON b.height = t.mined_height
         ORDER BY t.mined_height IS NULL, t.mined_height, o.txid, o.output_pool, o.output_index",
    )?;
    let mut rows = stmt.query([])?;
    let mut out = vec![];
    while let Some(r) = rows.next()? {
        let mut txid: Vec<u8> = r.get(0)?;
        txid.reverse();
        let fp = |idx: usize| -> rusqlite::Result<Option<String>> {
            Ok(uuid_from_row(r.get_ref(idx)?).and_then(|u| by_uuid.get(&u).cloned()))
        };
        let value: i64 = r.get(7)?;
        out.push(ScanOutput {
            txid: hex::encode(txid),
            mined_height: r.get::<_, Option<i64>>(1)?.map(|h| h as u32),
            block_time: r.get::<_, Option<i64>>(12)?,
            expiry_height: r.get::<_, Option<i64>>(11)?.map(|h| h as u32),
            pool: r.get(2)?,
            output_index: r.get(3)?,
            from_account: fp(4)?,
            to_account: fp(5)?,
            to_address: r.get(6)?,
            value_zat: u64::try_from(value).map_err(|_| anyhow!("negative output value"))?,
            is_change: r.get::<_, Option<bool>>(8)?.unwrap_or(false),
            memo: r.get(9)?,
            fee_zat: r.get::<_, Option<i64>>(10)?.map(|f| f as u64),
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mainnet_key_on_testnet_names_the_mismatch() {
        let params = Network::MainNetwork;
        let usk = zcash_keys::keys::UnifiedSpendingKey::from_seed(&params, &[0u8; 32], zip32::AccountId::ZERO).unwrap();
        let mainnet = usk.to_unified_full_viewing_key().encode(&params);
        let err = ViewingKey::parse(&ZcashNetwork::Testnet, &mainnet).unwrap_err();
        assert_eq!(err.body.code, "wrong_network");
        assert!(ViewingKey::parse(&ZcashNetwork::Mainnet, &mainnet).is_ok());
    }

    #[test]
    fn rejects_secrets_and_junk_with_actionable_codes() {
        let net = ZcashNetwork::Testnet;
        let cases = [
            ("", "invalid_viewing_key"),
            (
                "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
                "spending_key_rejected",
            ),
            ("secret-extended-key-test1qqqqqqqq", "spending_key_rejected"),
            ("uivktest1abcdef", "incoming_viewing_key"),
            ("uvitest1qqqqqqqqqqqqqq", "incoming_viewing_key"),
            ("uvi1qqqqqqqqqqqqqq", "incoming_viewing_key"),
            ("uviewtest1 not a key", "invalid_viewing_key"),
            ("uviewtest1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq", "invalid_viewing_key"),
        ];
        for (input, code) in cases {
            let err = ViewingKey::parse(&net, input).unwrap_err();
            assert_eq!(err.body.code, code, "{input}");
            assert!(!err.body.hint.is_empty());
        }
    }
}
