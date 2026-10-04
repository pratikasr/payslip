//! Statements: scan with viewing keys, decode memos, join to runs.

use std::collections::HashMap;

use axum::{
    extract::State,
    http::header,
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::AppStateRef;
use crate::{
    db,
    error::{ApiError, ApiResult},
    payer::TREASURY_INDEX,
    runs::validate_period,
    statements::{self, Classified, KeyInfo},
    viewer::{fingerprint_of, ViewingKey},
};

pub fn routes() -> Router<AppStateRef> {
    Router::new()
        .route("/api/statements/contractor", post(contractor_json))
        .route("/api/statements/contractor.csv", post(contractor_csv))
        .route("/api/statements/accountant", post(accountant_json))
        .route("/api/statements/accountant.csv", post(accountant_csv))
}

#[derive(Deserialize)]
struct ContractorReq {
    ufvk: String,
    from: String,
    to: String,
}

#[derive(Deserialize)]
struct AccountantReq {
    ufvks: Vec<String>,
    from: String,
    to: String,
}

struct Known {
    info: KeyInfo,
    birthday: u32,
    contractor_id: Option<String>,
}

/// Fingerprints of every account this payer knows, for labelling keys that come back.
async fn known_keys(s: &AppStateRef) -> ApiResult<HashMap<String, Known>> {
    let params = s.cfg.network.params();
    let mut out = HashMap::new();
    let info = s.payer.wallet_info().await?;
    let mut push = |ufvk: String, index: u32, label: String, role: &str, birthday: u32, cid: Option<String>| {
        if let Ok(k) = zcash_keys::keys::UnifiedFullViewingKey::decode(&params, &ufvk) {
            let fp = fingerprint_of(&params, &k);
            out.insert(fp.clone(), Known { info: KeyInfo { fingerprint: fp, account_index: Some(index), label: Some(label), role: role.into() }, birthday, contractor_id: cid });
        }
    };
    push(s.payer.ufvk(TREASURY_INDEX).await?, TREASURY_INDEX, "Treasury".into(), "treasury", info.birthday_height, None);
    for c in db::all_contractors(&s.db).await? {
        if let Ok(ufvk) = s.payer.ufvk(c.account_index as u32).await {
            push(ufvk, c.account_index as u32, c.name.clone(), "contractor", c.account_birthday_height as u32, Some(c.id.clone()));
        }
    }
    Ok(out)
}

struct Scanned {
    keys: Vec<KeyInfo>,
    contractor_ids: Vec<Option<String>>,
    classified: Classified,
    scanned_to: u32,
    period: (String, String),
}

async fn scan(s: &AppStateRef, raw_keys: &[String], from: &str, to: &str) -> ApiResult<Scanned> {
    let (f, t) = validate_period(from, to)?;
    if raw_keys.is_empty() {
        return Err(ApiError::bad_request("invalid_viewing_key", "No viewing keys were supplied.", "Paste at least one viewing key, one per line, or import the payer's export file."));
    }
    if raw_keys.len() > 200 {
        return Err(ApiError::bad_request("too_many_keys", "At most 200 viewing keys per request.", "Split the accounts into smaller groups."));
    }
    let mut parsed = vec![];
    for (i, k) in raw_keys.iter().enumerate() {
        let key = ViewingKey::parse(&s.cfg.network, k).map_err(|mut e| {
            if raw_keys.len() > 1 {
                e.body.message = format!("Key {} of {}: {}", i + 1, raw_keys.len(), e.body.message);
            }
            e
        })?;
        if !parsed.iter().any(|p: &ViewingKey| p.fingerprint == key.fingerprint) {
            parsed.push(key);
        }
    }
    let known = known_keys(s).await?;
    let default_birthday = s.payer.wallet_info().await?.birthday_height;
    let mut keys = vec![];
    let mut contractor_ids = vec![];
    let mut to_scan = vec![];
    for k in parsed {
        match known.get(&k.fingerprint) {
            Some(kn) => {
                keys.push(kn.info.clone());
                contractor_ids.push(kn.contractor_id.clone());
                to_scan.push((k, kn.info.label.clone().unwrap_or_default(), kn.birthday));
            }
            None => {
                keys.push(KeyInfo { fingerprint: k.fingerprint.clone(), account_index: None, label: None, role: "unknown".into() });
                contractor_ids.push(None);
                to_scan.push((k, "Imported key".into(), default_birthday));
            }
        }
    }
    let result = s.viewers.scan(to_scan).await.map_err(|e| ApiError::from(e.context("scanning with the viewing keys")))?;
    let classified = statements::classify(s.cfg.network, &result.outputs, &keys, result.chain_tip, Some((f, t)));
    Ok(Scanned { keys, contractor_ids, classified, scanned_to: result.scanned_to_height, period: (from.to_string(), to.to_string()) })
}

/// Run metadata for runs this service knows, keyed by run id.
async fn runs_index(s: &AppStateRef, c: &Classified) -> ApiResult<Value> {
    let mut ids: Vec<&str> = c.lines.iter().chain(c.pending.iter()).map(|l| l.run_id.as_str()).collect();
    ids.extend(c.run_records.iter().map(|r| r.run_id.as_str()));
    ids.sort();
    ids.dedup();
    let mut out = serde_json::Map::new();
    for id in ids {
        if let Some(r) = db::get_run(&s.db, id).await? {
            out.insert(id.into(), json!({"period_start": r.period_start, "period_end": r.period_end, "status": r.status}));
        }
    }
    Ok(Value::Object(out))
}

fn csv_response(body: String, filename: &str) -> Response {
    (
        [(header::CONTENT_TYPE, "text/csv; charset=utf-8".to_string()), (header::CONTENT_DISPOSITION, format!("attachment; filename=\"{filename}\""))],
        body,
    )
        .into_response()
}

async fn contractor_statement(s: &AppStateRef, req: &ContractorReq) -> ApiResult<(Scanned, Value)> {
    let sc = scan(s, std::slice::from_ref(&req.ufvk), &req.from, &req.to).await?;
    let k = &sc.keys[0];
    let body = json!({
        "network": s.cfg.network.as_str(),
        "account": {"fingerprint": k.fingerprint, "account_index": k.account_index, "label": k.label, "role": k.role},
        "period": {"from": sc.period.0, "to": sc.period.1},
        "scanned_to_height": sc.scanned_to,
        "generated_at": db::now(),
        "lines": sc.classified.lines,
        "pending": sc.classified.pending,
        "totals": statements::totals(&sc.classified.lines),
        "unlabelled": sc.classified.unlabelled,
        "funding": sc.classified.funding,
        "runs": runs_index(s, &sc.classified).await?,
    });
    Ok((sc, body))
}

async fn contractor_json(State(s): State<AppStateRef>, Json(req): Json<ContractorReq>) -> ApiResult<Json<Value>> {
    let (sc, body) = contractor_statement(&s, &req).await?;
    db::record_statement(&s.db, "contractor", sc.contractor_ids[0].as_deref(), &sc.keys[0].fingerprint, (&sc.period.0, &sc.period.1), sc.scanned_to, None).await?;
    Ok(Json(body))
}

async fn contractor_csv(State(s): State<AppStateRef>, Json(req): Json<ContractorReq>) -> ApiResult<Response> {
    let (sc, _) = contractor_statement(&s, &req).await?;
    let csv = statements::contractor_csv(&sc.classified);
    let hash = hex::encode(Sha256::digest(csv.as_bytes()));
    db::record_statement(&s.db, "contractor", sc.contractor_ids[0].as_deref(), &sc.keys[0].fingerprint, (&sc.period.0, &sc.period.1), sc.scanned_to, Some(&hash)).await?;
    let name = sc.keys[0].label.clone().unwrap_or_else(|| sc.keys[0].fingerprint.clone()).replace(|c: char| !c.is_ascii_alphanumeric(), "-");
    Ok(csv_response(csv, &format!("payslip-statement-{name}-{}-{}.csv", sc.period.0, sc.period.1)))
}

async fn accountant_view(s: &AppStateRef, req: &AccountantReq) -> ApiResult<(Scanned, Vec<statements::RunReconciliation>, Value)> {
    let sc = scan(s, &req.ufvks, &req.from, &req.to).await?;
    let runs = statements::reconcile(&sc.classified);
    let funded: i64 = runs.iter().filter_map(|r| r.funded_usd_cents).map(|v| v as i64).sum();
    let paid: i64 = runs.iter().map(|r| r.paid_usd_cents as i64).sum();
    let paid_zat: u64 = runs.iter().map(|r| r.paid_zat).sum();
    let count: usize = runs.iter().map(|r| r.lines).sum();
    let body = json!({
        "network": s.cfg.network.as_str(),
        "period": {"from": sc.period.0, "to": sc.period.1},
        "scanned_to_height": sc.scanned_to,
        "generated_at": db::now(),
        "accounts": sc.keys,
        "runs": runs,
        "run_records": sc.classified.run_records,
        "lines": sc.classified.lines,
        "pending": sc.classified.pending,
        "unlabelled": sc.classified.unlabelled,
        "funding": sc.classified.funding,
        "totals": {"funded_usd_cents": funded, "paid_usd_cents": paid, "variance_usd_cents": funded - paid, "paid_zat": paid_zat, "count": count},
        "run_index": runs_index(s, &sc.classified).await?,
        "treasury_key_present": sc.keys.iter().any(|k| k.role == "treasury"),
    });
    Ok((sc, runs, body))
}

fn subject(sc: &Scanned) -> String {
    let mut fps: Vec<&str> = sc.keys.iter().map(|k| k.fingerprint.as_str()).collect();
    fps.sort();
    fps.join(",")
}

async fn accountant_json(State(s): State<AppStateRef>, Json(req): Json<AccountantReq>) -> ApiResult<Json<Value>> {
    let (sc, _, body) = accountant_view(&s, &req).await?;
    db::record_statement(&s.db, "accountant", None, &subject(&sc), (&sc.period.0, &sc.period.1), sc.scanned_to, None).await?;
    Ok(Json(body))
}

async fn accountant_csv(State(s): State<AppStateRef>, Json(req): Json<AccountantReq>) -> ApiResult<Response> {
    let (sc, runs, _) = accountant_view(&s, &req).await?;
    let csv = statements::accountant_csv(&runs, &sc.classified);
    let hash = hex::encode(Sha256::digest(csv.as_bytes()));
    db::record_statement(&s.db, "accountant", None, &subject(&sc), (&sc.period.0, &sc.period.1), sc.scanned_to, Some(&hash)).await?;
    Ok(csv_response(csv, &format!("payslip-reconciliation-{}-{}.csv", sc.period.0, sc.period.1)))
}
