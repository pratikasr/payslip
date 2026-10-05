//! Statements: scan with viewing keys, decode memos, join to runs.

use std::collections::HashMap;

use axum::{
    extract::{Query, State},
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
    statements::{self, Classified, ExportFormat, KeyInfo},
    viewer::{fingerprint_of, ScanKey, ViewingKey},
};

pub fn routes() -> Router<AppStateRef> {
    Router::new()
        .route("/api/statements/contractor", post(contractor_json))
        .route("/api/statements/contractor.csv", post(contractor_csv))
        .route("/api/statements/accountant", post(accountant_json))
        .route("/api/statements/accountant.csv", post(accountant_csv))
        .route("/api/statements/forget", post(forget))
}

#[derive(Deserialize)]
struct ContractorReq {
    ufvk: String,
    from: String,
    to: String,
    /// Where to start scanning for a key this deployment does not know (optional).
    birthday_height: Option<u32>,
    /// Currency for the market value at receipt (ISO 4217, default USD).
    currency: Option<String>,
}

#[derive(Deserialize)]
struct AccountantReq {
    ufvks: Vec<String>,
    from: String,
    to: String,
    birthday_height: Option<u32>,
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
    // A statements-only deployment knows no accounts; every key is scanned as supplied.
    let Some(payer) = s.payer.as_ref() else { return Ok(out) };
    let info = payer.wallet_info().await?;
    let mut push = |ufvk: String, index: u32, label: String, role: &str, birthday: u32, cid: Option<String>| {
        if let Ok(k) = zcash_keys::keys::UnifiedFullViewingKey::decode(&params, &ufvk) {
            let fp = fingerprint_of(&params, &k);
            out.insert(
                fp.clone(),
                Known {
                    info: KeyInfo {
                        fingerprint: fp,
                        account_index: Some(index),
                        label: Some(label),
                        role: role.into(),
                    },
                    birthday,
                    contractor_id: cid,
                },
            );
        }
    };
    push(
        payer.ufvk(TREASURY_INDEX).await?,
        TREASURY_INDEX,
        "Treasury".into(),
        "treasury",
        info.birthday_height,
        None,
    );
    for c in db::all_contractors(&s.db).await? {
        if let Ok(ufvk) = payer.ufvk(c.account_index as u32).await {
            push(
                ufvk,
                c.account_index as u32,
                c.name.clone(),
                "contractor",
                c.account_birthday_height as u32,
                Some(c.id.clone()),
            );
        }
    }
    Ok(out)
}

struct Scanned {
    keys: Vec<KeyInfo>,
    contractor_ids: Vec<Option<String>>,
    /// Every output the keys see, and the tip they were classified against.
    outputs: Vec<crate::viewer::ScanOutput>,
    tip: u32,
    dates: (time::Date, time::Date),
    /// The outputs classified for the requested period.
    classified: Classified,
    scanned_to: u32,
    /// Per key (same order as `keys`): the height its scan starts at.
    scanned_from: Vec<Option<u32>>,
    period: (String, String),
}

impl Scanned {
    /// The lowest height any key was scanned from: nothing earlier is in the statement.
    fn scanned_from_height(&self) -> Option<u32> {
        self.scanned_from.iter().flatten().copied().min()
    }

    fn accounts_json(&self) -> Value {
        Value::Array(
            self.keys
                .iter()
                .zip(&self.scanned_from)
                .map(|(k, from)| {
                    json!({"fingerprint": k.fingerprint, "account_index": k.account_index, "label": k.label,
                           "role": k.role, "scanned_from_height": from})
                })
                .collect(),
        )
    }
}

async fn scan(s: &AppStateRef, raw_keys: &[String], from: &str, to: &str, birthday: Option<u32>) -> ApiResult<Scanned> {
    let (f, t) = validate_period(from, to)?;
    if raw_keys.is_empty() {
        return Err(ApiError::bad_request(
            "invalid_viewing_key",
            "No viewing keys were supplied.",
            "Paste at least one viewing key, one per line, or import the payer's export file.",
        ));
    }
    if raw_keys.len() > 200 {
        return Err(ApiError::bad_request(
            "too_many_keys",
            "At most 200 viewing keys per request.",
            "Split the accounts into smaller groups.",
        ));
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
    if let Some(b) = birthday {
        let floor = s.cfg.network.ironwood_activation_height();
        if b < floor {
            return Err(ApiError::bad_request(
                "invalid_birthday_height",
                format!("A scan cannot start below block {floor}, where the Ironwood pool Payslip pays into began."),
                format!("Use the birthday height from the key file, or leave it out to start at {floor}."),
            ));
        }
        let tip = {
            let mut client = s.lwd.lock().await;
            crate::wallet::lwd::tip(&mut client).await.map_err(ApiError::from)?
        };
        let tip = u32::from(tip);
        if b > tip {
            return Err(ApiError::bad_request(
                "invalid_birthday_height",
                format!("Block {b} is above the chain tip ({tip}), so a scan cannot start there."),
                format!("Use the birthday height from the key file (between {floor} and {tip}), or leave it out."),
            ));
        }
    }
    let known = known_keys(s).await?;
    // A key this deployment does not know scans from the earlier of the requested height and
    // PAYSLIP_VIEWER_BIRTHDAY_HEIGHT (Ironwood activation if neither): never from the payer
    // wallet's own birthday, which says nothing about someone else's key.
    let default_birthday = s.cfg.viewer_scan_start(birthday);
    let mut keys = vec![];
    let mut contractor_ids = vec![];
    let mut to_scan = vec![];
    for k in parsed {
        match known.get(&k.fingerprint) {
            Some(kn) => {
                keys.push(kn.info.clone());
                contractor_ids.push(kn.contractor_id.clone());
                to_scan.push(ScanKey {
                    key: k,
                    label: kn.info.label.clone().unwrap_or_default(),
                    birthday: kn.birthday,
                    rescan_if_earlier: false,
                });
            }
            None => {
                keys.push(KeyInfo {
                    fingerprint: k.fingerprint.clone(),
                    account_index: None,
                    label: None,
                    role: "unknown".into(),
                });
                contractor_ids.push(None);
                // Only a height the request asked for rescans a cached key; the default start
                // applies to a key seen for the first time.
                to_scan.push(ScanKey {
                    key: k,
                    label: "Imported key".into(),
                    birthday: default_birthday,
                    rescan_if_earlier: birthday.is_some(),
                });
            }
        }
    }
    // Scans are the expensive requests: wait for a slot, but not forever.
    let _slot = tokio::time::timeout(std::time::Duration::from_secs(120), s.scan_slots.acquire())
        .await
        .map_err(|_| {
            ApiError::unavailable(
                "scanner_busy",
                "Every scan slot is busy with other viewing keys.",
                "Try again in a minute.",
            )
        })?
        .map_err(ApiError::internal)?;
    let result = s
        .viewers
        .scan_keys(to_scan)
        .await
        .map_err(|e| ApiError::from(e.context("scanning with the viewing keys")))?;
    statements::infer_treasury(&result.outputs, &mut keys);
    let classified = statements::classify(s.cfg.network, &result.outputs, &keys, result.chain_tip, Some((f, t)));
    let scanned_from = keys
        .iter()
        .map(|k| result.scanned_from.get(&k.fingerprint).copied())
        .collect();
    Ok(Scanned {
        keys,
        contractor_ids,
        outputs: result.outputs,
        tip: result.chain_tip,
        dates: (f, t),
        classified,
        scanned_to: result.scanned_to_height,
        scanned_from,
        period: (from.to_string(), to.to_string()),
    })
}

/// Run metadata for runs this service knows, keyed by run id.
async fn runs_index(s: &AppStateRef, c: &Classified, extra: &[&str]) -> ApiResult<Value> {
    let mut ids: Vec<&str> = c
        .lines
        .iter()
        .chain(c.pending.iter())
        .map(|l| l.run_id.as_str())
        .collect();
    ids.extend(c.run_records.iter().map(|r| r.run_id.as_str()));
    ids.extend(extra.iter().copied());
    ids.sort();
    ids.dedup();
    let mut out = serde_json::Map::new();
    for id in ids {
        if let Some(r) = db::get_run(&s.db, id).await? {
            out.insert(
                id.into(),
                json!({"period_start": r.period_start, "period_end": r.period_end, "status": r.status}),
            );
        }
    }
    Ok(Value::Object(out))
}

fn csv_response(body: String, filename: &str) -> Response {
    (
        [
            (header::CONTENT_TYPE, "text/csv; charset=utf-8".to_string()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"{filename}\""),
            ),
        ],
        body,
    )
        .into_response()
}

async fn contractor_statement(s: &AppStateRef, req: &ContractorReq) -> ApiResult<(Scanned, Value)> {
    // Checked before the scan: a bad currency must not cost a chain scan.
    let currency = crate::prices::parse_currency(req.currency.as_deref()).ok_or_else(|| {
        ApiError::bad_request(
            "invalid_currency",
            format!(
                "Market values are not available in {:?}.",
                req.currency.clone().unwrap_or_default()
            ),
            format!(
                "Use a currency code such as USD, EUR, GBP or INR: {}.",
                crate::prices::CURRENCIES.join(", ").to_uppercase()
            ),
        )
    })?;
    let mut sc = scan(
        s,
        std::slice::from_ref(&req.ufvk),
        &req.from,
        &req.to,
        req.birthday_height,
    )
    .await?;
    let market = attach_market_values(s, &mut sc.classified, &currency).await;
    let k = &sc.keys[0];
    let body = json!({
        "market": market,
        "network": s.cfg.network.as_str(),
        "account": {"fingerprint": k.fingerprint, "account_index": k.account_index, "label": k.label, "role": k.role},
        "period": {"from": sc.period.0, "to": sc.period.1},
        "scanned_from_height": sc.scanned_from_height(),
        "scanned_to_height": sc.scanned_to,
        "generated_at": db::now(),
        "lines": sc.classified.lines,
        "pending": sc.classified.pending,
        "totals": statements::totals(&sc.classified.lines),
        "unlabelled": sc.classified.unlabelled,
        "funding": sc.classified.funding,
        "runs": runs_index(s, &sc.classified, &[]).await?,
    });
    Ok((sc, body))
}

/// Fills in each mined line's market value at receipt. Prices that cannot be fetched leave the
/// lines without one and say why; the statement itself never fails over prices.
async fn attach_market_values(s: &AppStateRef, c: &mut Classified, currency: &str) -> Value {
    let upper = currency.to_ascii_uppercase();
    let note = (s.cfg.network == crate::config::ZcashNetwork::Testnet).then_some(
        "Testnet ZEC has no market value. These figures show what the same amount of mainnet ZEC was worth at the time.",
    );
    if !s.prices.enabled() {
        return json!({"currency": upper, "available": false, "error": "Market prices are turned off on this deployment.", "note": note});
    }
    let idx: Vec<(usize, i64, u64)> =
        c.lines
            .iter()
            .enumerate()
            .filter_map(|(i, l)| {
                let t = l.block_time.as_deref().and_then(|t| {
                    time::OffsetDateTime::parse(t, &time::format_description::well_known::Rfc3339).ok()
                })?;
                Some((i, t.unix_timestamp(), l.amount_zat))
            })
            .collect();
    let payments: Vec<(i64, u64)> = idx.iter().map(|&(_, t, z)| (t, z)).collect();
    match s.prices.values(currency, &payments).await {
        Ok(values) => {
            let mut total = 0u64;
            let mut priced = 0usize;
            for (&(i, _, _), v) in idx.iter().zip(values) {
                if let Some(v) = &v {
                    total += v.value_cents;
                    priced += 1;
                }
                c.lines[i].market = v;
            }
            json!({
                "currency": upper,
                "available": true,
                "source": "CoinGecko ZEC market price nearest each payment's block time",
                "total_cents": total,
                "priced_lines": priced,
                "unpriced_lines": c.lines.len() - priced,
                "note": note,
            })
        }
        Err(e) => {
            tracing::warn!("market prices unavailable: {e:#}");
            json!({"currency": upper, "available": false, "error": "The price source could not be reached; try again shortly.", "note": note})
        }
    }
}

async fn contractor_json(State(s): State<AppStateRef>, Json(req): Json<ContractorReq>) -> ApiResult<Json<Value>> {
    let (sc, body) = contractor_statement(&s, &req).await?;
    db::record_statement(
        &s.db,
        "contractor",
        sc.contractor_ids[0].as_deref(),
        &sc.keys[0].fingerprint,
        (&sc.period.0, &sc.period.1),
        sc.scanned_to,
        None,
    )
    .await?;
    Ok(Json(body))
}

#[derive(Deserialize)]
struct FormatQuery {
    format: Option<String>,
}

fn export_format(q: &FormatQuery, allowed: &[ExportFormat]) -> ApiResult<ExportFormat> {
    let names: Vec<&str> = allowed.iter().map(|f| f.slug()).collect();
    ExportFormat::parse(q.format.as_deref())
        .filter(|f| allowed.contains(f))
        .ok_or_else(|| {
            ApiError::bad_request(
                "invalid_format",
                format!("Unknown export format {:?}.", q.format.clone().unwrap_or_default()),
                format!("Use one of: {}.", names.join(", ")),
            )
        })
}

fn file_prefix(format: ExportFormat) -> String {
    match format {
        ExportFormat::Payslip => "payslip-".into(),
        f => format!("payslip-{}-", f.slug()),
    }
}

async fn contractor_csv(
    State(s): State<AppStateRef>,
    Query(q): Query<FormatQuery>,
    Json(req): Json<ContractorReq>,
) -> ApiResult<Response> {
    let format = export_format(
        &q,
        &[ExportFormat::Payslip, ExportFormat::Koinly, ExportFormat::CoinTracker],
    )?;
    let (sc, _) = contractor_statement(&s, &req).await?;
    let csv = statements::contractor_export(&sc.classified, format, s.cfg.network);
    let hash = hex::encode(Sha256::digest(csv.as_bytes()));
    db::record_statement(
        &s.db,
        "contractor",
        sc.contractor_ids[0].as_deref(),
        &sc.keys[0].fingerprint,
        (&sc.period.0, &sc.period.1),
        sc.scanned_to,
        Some(&hash),
    )
    .await?;
    let name = sc.keys[0]
        .label
        .clone()
        .unwrap_or_else(|| sc.keys[0].fingerprint.clone())
        .replace(|c: char| !c.is_ascii_alphanumeric(), "-");
    Ok(csv_response(
        csv,
        &format!(
            "{}statement-{name}-{}-{}.csv",
            file_prefix(format),
            sc.period.0,
            sc.period.1
        ),
    ))
}

async fn accountant_view(
    s: &AppStateRef,
    req: &AccountantReq,
) -> ApiResult<(Scanned, Vec<statements::RunReconciliation>, Value)> {
    let sc = scan(s, &req.ufvks, &req.from, &req.to, req.birthday_height).await?;
    // Each run is reconciled over everything the keys have seen, not only this period's lines
    // (a run paid either side of midnight still has all its payments); the period decides
    // which runs are listed.
    let all = statements::classify(s.cfg.network, &sc.outputs, &sc.keys, sc.tip, None);
    let runs = statements::reconcile(&all, Some(sc.dates));
    let funded: i64 = runs.iter().filter_map(|r| r.funded_usd_cents).map(|v| v as i64).sum();
    let paid: i64 = runs.iter().map(|r| r.paid_usd_cents as i64).sum();
    let paid_zat: u64 = runs.iter().map(|r| r.paid_zat).sum();
    let count: usize = runs.iter().map(|r| r.lines).sum();
    let run_ids: Vec<&str> = runs.iter().map(|r| r.run_id.as_str()).collect();
    let run_index = runs_index(s, &sc.classified, &run_ids).await?;
    let body = json!({
        "network": s.cfg.network.as_str(),
        "period": {"from": sc.period.0, "to": sc.period.1},
        "scanned_from_height": sc.scanned_from_height(),
        "scanned_to_height": sc.scanned_to,
        "generated_at": db::now(),
        "accounts": sc.accounts_json(),
        "runs": runs,
        "run_records": sc.classified.run_records,
        "lines": sc.classified.lines,
        "pending": sc.classified.pending,
        "unlabelled": sc.classified.unlabelled,
        "funding": sc.classified.funding,
        "totals": {"funded_usd_cents": funded, "paid_usd_cents": paid, "variance_usd_cents": funded - paid, "paid_zat": paid_zat, "count": count},
        "run_index": run_index,
        // True when a treasury key was supplied: known as the treasury, or it decrypted a run
        // funding record (in statements mode no key is known in advance).
        "treasury_key_present": sc.keys.iter().any(|k| k.role == "treasury") || !all.run_records.is_empty(),
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
    db::record_statement(
        &s.db,
        "accountant",
        None,
        &subject(&sc),
        (&sc.period.0, &sc.period.1),
        sc.scanned_to,
        None,
    )
    .await?;
    Ok(Json(body))
}

async fn accountant_csv(
    State(s): State<AppStateRef>,
    Query(q): Query<FormatQuery>,
    Json(req): Json<AccountantReq>,
) -> ApiResult<Response> {
    let format = export_format(
        &q,
        &[ExportFormat::Payslip, ExportFormat::Xero, ExportFormat::QuickBooks],
    )?;
    let (sc, runs, _) = accountant_view(&s, &req).await?;
    let csv = match format {
        ExportFormat::Payslip => statements::accountant_csv(&runs, &sc.classified),
        f => statements::accountant_tool_csv(&sc.classified, f),
    };
    let hash = hex::encode(Sha256::digest(csv.as_bytes()));
    db::record_statement(
        &s.db,
        "accountant",
        None,
        &subject(&sc),
        (&sc.period.0, &sc.period.1),
        sc.scanned_to,
        Some(&hash),
    )
    .await?;
    Ok(csv_response(
        csv,
        &format!(
            "{}reconciliation-{}-{}.csv",
            file_prefix(format),
            sc.period.0,
            sc.period.1
        ),
    ))
}

#[derive(Deserialize)]
struct ForgetReq {
    ufvks: Vec<String>,
}

/// Deletes the cached scan of exactly this key set: the viewer database that keeps the keys so
/// the next statement is incremental. The next request with the same keys scans from scratch.
async fn forget(State(s): State<AppStateRef>, Json(req): Json<ForgetReq>) -> ApiResult<Json<Value>> {
    if req.ufvks.is_empty() || req.ufvks.len() > 200 {
        return Err(ApiError::bad_request(
            "invalid_viewing_key",
            "Send the same 1 to 200 viewing keys the statements used.",
            "Paste the keys exactly as you sent them for the statement, one per entry.",
        ));
    }
    let mut keys = vec![];
    for k in &req.ufvks {
        keys.push(ViewingKey::parse(&s.cfg.network, k)?);
    }
    let fps: Vec<&str> = keys.iter().map(|k| k.fingerprint.as_str()).collect();
    match s.viewers.forget(&fps).await? {
        Ok(forgotten) => Ok(Json(json!({ "forgotten": forgotten }))),
        Err(crate::viewer::ForgetBusy) => Err(ApiError::conflict(
            "scan_in_progress",
            "A statement for these keys is being scanned right now.",
            "Try again when it finishes.",
        )),
    }
}
