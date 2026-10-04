//! Runs: create, fund, execute, progress over SSE.

use std::{convert::Infallible, time::Duration};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::sse::{Event, KeepAlive, Sse},
    routing::{get, post},
    Json, Router,
};
use futures_util::{Stream, StreamExt};
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::broadcast::error::RecvError;

use super::AppStateRef;
use crate::{
    db::{self, NewLine},
    error::{ApiError, ApiResult},
    memo,
    runs::validate_period,
};

pub fn routes() -> Router<AppStateRef> {
    Router::new()
        .route("/api/runs", get(list).post(create))
        .route("/api/runs/{id}", get(get_one).delete(discard))
        .route("/api/runs/{id}/fund", post(fund))
        .route("/api/runs/{id}/funding", get(funding))
        .route("/api/runs/{id}/funding/deposit-tx", post(deposit_tx))
        .route("/api/runs/{id}/execute", post(execute))
        .route("/api/runs/{id}/events", get(events))
        .route("/api/runs/{id}/log", get(log))
}

const MAX_LINES: usize = 50;
/// $10,000,000.00: far above any single contractor payment, catches unit mistakes.
const MAX_LINE_CENTS: i64 = 1_000_000_000;

#[derive(Deserialize)]
struct LineInput {
    contractor_id: String,
    amount_usd_cents: Value,
    invoice_ref: String,
}

#[derive(Deserialize)]
struct CreateRun {
    period_start: String,
    period_end: String,
    lines: Vec<LineInput>,
    idempotency_key: Option<String>,
}

async fn view(s: &AppStateRef, id: &str) -> ApiResult<Value> {
    let mut v = s.executor.run_view(id).await?;
    if let Some(o) = v.as_object_mut() {
        o.insert("executing".into(), Value::Bool(s.executor.is_running(id)));
        o.insert("network".into(), Value::String(s.cfg.network.as_str().into()));
    }
    Ok(v)
}

async fn list(State(s): State<AppStateRef>) -> ApiResult<Json<Value>> {
    let mut runs = vec![];
    for r in db::list_runs(&s.db).await? {
        runs.push(view(&s, &r.id).await?);
    }
    Ok(Json(serde_json::json!({ "runs": runs })))
}

async fn get_one(State(s): State<AppStateRef>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    Ok(Json(view(&s, &id).await?))
}

async fn discard(State(s): State<AppStateRef>, Path(id): Path<String>) -> ApiResult<StatusCode> {
    view(&s, &id).await?;
    if db::delete_draft_run(&s.db, &id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::conflict(
            "run_not_draft",
            "Only a draft run can be discarded; this one has been funded.",
            "Funded runs stay on record. Open the run to follow or resume it.",
        ))
    }
}

async fn create(State(s): State<AppStateRef>, Json(input): Json<CreateRun>) -> ApiResult<(StatusCode, Json<Value>)> {
    if let Some(key) = input.idempotency_key.as_deref() {
        if key.is_empty() || key.len() > 100 {
            return Err(ApiError::bad_request(
                "invalid_idempotency_key",
                "The idempotency key must be 1 to 100 characters.",
                "Send a fresh UUID per form submission.",
            ));
        }
        if let Some(existing) = db::get_run_by_key(&s.db, key).await? {
            return Ok((StatusCode::OK, Json(view(&s, &existing.id).await?)));
        }
    }
    validate_period(&input.period_start, &input.period_end)?;
    if input.lines.is_empty() {
        return Err(ApiError::bad_request(
            "no_lines",
            "A run needs at least one pay line.",
            "Add an amount for at least one contractor.",
        ));
    }
    if input.lines.len() > MAX_LINES {
        return Err(ApiError::bad_request(
            "too_many_lines",
            format!("A run can pay at most {MAX_LINES} contractors."),
            "Split the payroll into two runs.",
        ));
    }
    let mut seen = std::collections::HashSet::new();
    let mut lines = vec![];
    for l in &input.lines {
        let c = db::get_contractor(&s.db, &l.contractor_id)
            .await?
            .filter(|c| c.archived_at.is_none())
            .ok_or_else(|| {
                ApiError::bad_request(
                    "unknown_contractor",
                    format!("Contractor {} does not exist.", l.contractor_id),
                    "Refresh the contractor list and pick from it.",
                )
            })?;
        if !seen.insert(c.id.clone()) {
            return Err(ApiError::bad_request(
                "duplicate_contractor_line",
                format!("{} appears twice in this run.", c.name),
                "Combine the amounts into one line per contractor.",
            ));
        }
        let cents = l
            .amount_usd_cents
            .as_i64()
            .filter(|_| l.amount_usd_cents.is_i64() || l.amount_usd_cents.is_u64())
            .ok_or_else(|| {
                ApiError::bad_request(
                    "invalid_amount",
                    format!("The amount for {} must be a whole number of cents.", c.name),
                    "Send amount_usd_cents as an integer, for example 480000 for $4,800.00.",
                )
            })?;
        if cents <= 0 {
            return Err(ApiError::bad_request(
                "invalid_amount",
                format!("The amount for {} must be greater than zero.", c.name),
                "Enter a positive USD amount, or remove the line.",
            ));
        }
        if cents > MAX_LINE_CENTS {
            return Err(ApiError::bad_request(
                "invalid_amount",
                format!("The amount for {} is over $10,000,000.", c.name),
                "Check the amount is in cents, not a larger unit.",
            ));
        }
        let invoice = l.invoice_ref.trim().to_string();
        memo::validate_invoice_ref(&invoice).map_err(|e| {
            let code = if matches!(e, memo::EncodeError::InvoiceRefTooLong) {
                "invoice_ref_too_long"
            } else {
                "invalid_invoice_ref"
            };
            ApiError::bad_request(
                code,
                format!("Invoice reference for {}: {e}.", c.name),
                "Use up to 64 plain characters (letters, digits, spaces, - / . #), no '|'.",
            )
        })?;
        lines.push(NewLine {
            contractor_id: c.id.clone(),
            amount_usd_cents: cents as u64,
            invoice_ref: invoice,
        });
    }
    match db::insert_run(
        &s.db,
        input.idempotency_key.as_deref(),
        &input.period_start,
        &input.period_end,
        &lines,
    )
    .await?
    {
        Some(id) => Ok((StatusCode::CREATED, Json(view(&s, &id).await?))),
        None => {
            // Lost a race with an identical submission.
            let key = input.idempotency_key.unwrap_or_default();
            let existing = db::get_run_by_key(&s.db, &key)
                .await?
                .ok_or_else(|| ApiError::internal("idempotency conflict"))?;
            Ok((StatusCode::OK, Json(view(&s, &existing.id).await?)))
        }
    }
}

#[derive(Deserialize, Default)]
struct FundInput {
    origin_chain: Option<String>,
    refund_address: Option<String>,
}

async fn fund(
    State(s): State<AppStateRef>,
    Path(id): Path<String>,
    body: Option<Json<FundInput>>,
) -> ApiResult<Json<Value>> {
    let input = body.map(|b| b.0).unwrap_or_default();
    s.executor.fund(&id, input.origin_chain, input.refund_address).await?;
    Ok(Json(view(&s, &id).await?))
}

async fn funding(State(s): State<AppStateRef>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    s.executor.refresh_funding(&id).await?;
    Ok(Json(view(&s, &id).await?))
}

#[derive(Deserialize)]
struct DepositInput {
    tx_hash: String,
}

async fn deposit_tx(
    State(s): State<AppStateRef>,
    Path(id): Path<String>,
    Json(input): Json<DepositInput>,
) -> ApiResult<Json<Value>> {
    let h = input.tx_hash.trim();
    if h.len() < 32 || h.len() > 100 || !h.trim_start_matches("0x").chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err(ApiError::bad_request(
            "invalid_tx_hash",
            "That is not a transaction hash.",
            "Paste the hash your wallet showed after sending the USDC.",
        ));
    }
    s.executor.submit_deposit(&id, h).await?;
    Ok(Json(view(&s, &id).await?))
}

async fn execute(State(s): State<AppStateRef>, Path(id): Path<String>) -> ApiResult<(StatusCode, Json<Value>)> {
    s.executor.start(&id).await?;
    Ok((StatusCode::ACCEPTED, Json(view(&s, &id).await?)))
}

async fn log(State(s): State<AppStateRef>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    view(&s, &id).await?;
    Ok(Json(serde_json::json!({ "events": db::events(&s.db, &id).await? })))
}

async fn events(
    State(s): State<AppStateRef>,
    Path(id): Path<String>,
) -> ApiResult<Sse<impl Stream<Item = Result<Event, Infallible>>>> {
    view(&s, &id).await?;
    let rx = s.executor.subscribe();
    let stream = futures_util::stream::unfold((s, id, rx, 0i64, true), |(s, id, mut rx, last, first)| async move {
        if !first {
            loop {
                match rx.recv().await {
                    Ok(changed) if changed == id => break,
                    Ok(_) => continue,
                    Err(RecvError::Lagged(_)) => break,
                    Err(RecvError::Closed) => return None,
                }
            }
        }
        let mut out = vec![];
        let mut new_last = last;
        if let Ok(events) = db::events(&s.db, &id).await {
            for e in events.into_iter().filter(|e| e.id > last) {
                new_last = e.id;
                if let Ok(ev) = Event::default().event("log").json_data(&e) {
                    out.push(Ok(ev));
                }
            }
        }
        if let Ok(v) = view(&s, &id).await {
            if let Ok(ev) = Event::default().event("snapshot").json_data(&v) {
                out.push(Ok(ev));
            }
        }
        Some((futures_util::stream::iter(out), (s, id, rx, new_last, false)))
    })
    .flatten();
    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}
