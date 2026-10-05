//! Payment proofs: create one from a viewing key and a txid, verify one from the chain.

use axum::{
    extract::{Path, Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use time::OffsetDateTime;
use zcash_primitives::transaction::{Transaction, TxId};
use zcash_protocol::consensus::BlockHeight;

use super::AppStateRef;
use crate::{
    config::ZcashNetwork,
    error::{ApiError, ApiResult},
    memo::{self, Decoded, PayslipMemo},
    proof::{self, OpenedOutput, ProofToken},
    viewer::ViewingKey,
    wallet::{lwd, parse_txid, txid_hex},
};

pub fn routes() -> Router<AppStateRef> {
    Router::new()
        .route("/api/proofs", post(create))
        .route("/api/proofs/{token}", get(verify))
}

#[derive(Deserialize)]
struct CreateReq {
    ufvk: String,
    txid: String,
}

/// Opens every payment the key's account sent in the transaction and returns a proof for each.
async fn create(State(s): State<AppStateRef>, Json(req): Json<CreateReq>) -> ApiResult<Json<Value>> {
    let key = ViewingKey::parse(&s.cfg.network, &req.ufvk)?;
    let txid = parse_txid_arg(&req.txid)?;
    let (tx, height) = fetch(&s, txid).await?;
    let params = s.cfg.network.params();
    let sent = proof::sent_outputs(&key.ufvk, &tx);
    if sent.is_empty() {
        return Err(ApiError::bad_request(
            "nothing_to_prove",
            "This viewing key did not send a shielded payment in that transaction.",
            "Use the txid of a payment from this contractor's statement.",
        ));
    }
    let proofs: Vec<Value> = sent
        .iter()
        .map(|o| {
            let token = ProofToken {
                mainnet: s.cfg.network == ZcashNetwork::Mainnet,
                pool: o.pool,
                action_index: o.action_index,
                txid,
                ock: o.ock,
            };
            json!({
                "token": token.encode(),
                "pool": o.pool.as_str(),
                "action_index": o.action_index,
                "amount_zat": o.value_zat,
                "recipient": proof::recipient_address(&params, o.recipient),
                "memo": memo_json(&o.memo),
            })
        })
        .collect();
    Ok(Json(json!({
        "network": s.cfg.network.as_str(),
        "txid": txid_hex(&txid),
        "height": height.map(u32::from),
        "proofs": proofs,
    })))
}

#[derive(Deserialize)]
struct VerifyQuery {
    /// A unified address the verifier expects the payment to have gone to (optional).
    address: Option<String>,
}

/// Verifies a proof against the chain. Public: needs no key and reveals only that one payment.
async fn verify(
    State(s): State<AppStateRef>,
    Path(token): Path<String>,
    Query(q): Query<VerifyQuery>,
) -> ApiResult<Json<Value>> {
    let token = ProofToken::decode(&token).map_err(|e| {
        ApiError::bad_request(
            "invalid_proof",
            format!("That is not a valid Payslip payment proof: {e}."),
            "Copy the whole proof link or code; it starts with pp1.",
        )
    })?;
    let ours = s.cfg.network == ZcashNetwork::Mainnet;
    if token.mainnet != ours {
        let (proof_net, svc_net) = if token.mainnet {
            ("mainnet", "testnet")
        } else {
            ("testnet", "mainnet")
        };
        return Err(ApiError::bad_request(
            "wrong_network",
            format!("This proof is for a {proof_net} payment, but this Payslip service reads {svc_net}."),
            format!("Open the proof on a {proof_net} Payslip deployment."),
        ));
    }
    let (tx, height) = fetch(&s, token.txid).await?;
    let opened = proof::open_with_proof(&token, &tx).map_err(|e| {
        ApiError::new(
            axum::http::StatusCode::UNPROCESSABLE_ENTITY,
            "proof_mismatch",
            format!("The proof does not match the transaction on chain ({e})."),
            "The proof was altered or belongs to another transaction. Ask the sender for a new link.",
        )
    })?;
    let params = s.cfg.network.params();
    let (tip, block_time) = {
        let mut client = s.lwd.lock().await;
        let tip = lwd::tip(&mut client).await.map_err(ApiError::internal)?;
        let time = match height {
            Some(h) => Some(lwd::block_time(&mut client, h).await.map_err(ApiError::internal)?),
            None => None,
        };
        (tip, time)
    };
    // None: no address given. Some(None): not a unified address on this network.
    let address_check = q
        .address
        .as_deref()
        .filter(|a| !a.trim().is_empty())
        .map(|a| proof::address_matches(&params, a, &opened.recipient));
    Ok(Json(verified_json(
        &s,
        &token,
        &opened,
        height,
        tip,
        block_time,
        address_check,
    )))
}

fn verified_json(
    s: &AppStateRef,
    token: &ProofToken,
    o: &OpenedOutput,
    height: Option<BlockHeight>,
    tip: BlockHeight,
    block_time: Option<i64>,
    address_check: Option<Option<bool>>,
) -> Value {
    let params = s.cfg.network.params();
    let txid = txid_hex(&token.txid);
    let confirmations = height.map(|h| u32::from(tip).saturating_sub(u32::from(h)) + 1);
    json!({
        "valid": true,
        "network": s.cfg.network.as_str(),
        "txid": txid,
        "explorer_url": s.cfg.network.explorer_tx_url(&txid),
        "height": height.map(u32::from),
        "confirmations": confirmations,
        "block_time": block_time
            .and_then(|t| OffsetDateTime::from_unix_timestamp(t).ok())
            .and_then(|t| t.format(&time::format_description::well_known::Rfc3339).ok()),
        "pool": o.pool.as_str(),
        "amount_zat": o.value_zat,
        "recipient": proof::recipient_address(&params, o.recipient),
        "address_matches": address_check.flatten(),
        "address_valid": address_check.map(|c| c.is_some()),
        "memo": memo_json(&o.memo),
        "discloses": "This one payment: its amount, the address it was paid to and its memo. Not the sender, not the payer's other payments, and no viewing key.",
    })
}

fn memo_json(bytes: &[u8; 512]) -> Value {
    match memo::decode_bytes(Some(bytes)) {
        Decoded::Payslip(PayslipMemo::PayLine(p)) => json!({
            "kind": "pay_line",
            "run_id": p.run_id,
            "period": p.period.to_string(),
            "invoice_ref": p.invoice_ref,
            "usd_basis_cents": p.usd_basis_cents,
            "rate_usd_per_zec_e6": p.rate_e6,
        }),
        Decoded::Payslip(_) => json!({ "kind": "payslip_internal" }),
        Decoded::Unlabelled { text, .. } => match text {
            Some(t) => json!({ "kind": "text", "text": t }),
            None => json!({ "kind": "none" }),
        },
    }
}

fn parse_txid_arg(raw: &str) -> ApiResult<TxId> {
    parse_txid(raw.trim()).map_err(|_| {
        ApiError::bad_request(
            "invalid_txid",
            "A transaction id is 64 hexadecimal characters.",
            "Copy the txid from the statement.",
        )
    })
}

async fn fetch(s: &AppStateRef, txid: TxId) -> ApiResult<(Transaction, Option<BlockHeight>)> {
    let params = s.cfg.network.params();
    let mut client = s.lwd.lock().await;
    let tip = lwd::tip(&mut client).await.map_err(ApiError::internal)?;
    match lwd::fetch_tx(&mut client, &params, tip, txid)
        .await
        .map_err(ApiError::internal)?
    {
        Some(found) => Ok(found),
        None => Err(ApiError::new(
            axum::http::StatusCode::NOT_FOUND,
            "tx_not_found",
            format!("Transaction {} is not on {}.", txid_hex(&txid), s.cfg.network.as_str()),
            "Check the txid and the network.",
        )),
    }
}
