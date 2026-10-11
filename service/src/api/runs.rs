//! Runs: create, approve, fund, execute, progress over SSE.

use std::{convert::Infallible, time::Duration};

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{
        sse::{Event, KeepAlive, Sse},
        IntoResponse, Response,
    },
    routing::{get, post},
    Extension, Json, Router,
};
use futures_util::{Stream, StreamExt};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::broadcast::error::RecvError;

use super::AppStateRef;
use crate::{
    auth::{AuditInfo, Identity},
    db::{self, NewLine, NewRun, RunInsert, RunRow},
    error::{ApiError, ApiResult},
    memo, requests,
    runs::{run_over_cap, validate_period, FundMethod, FundRequest},
};

pub fn routes() -> Router<AppStateRef> {
    Router::new()
        .route("/api/runs", get(list).post(create))
        .route("/api/runs/{id}", get(get_one).delete(discard))
        .route("/api/runs/{id}/approve", post(approve))
        .route("/api/runs/{id}/fund", post(fund))
        .route("/api/runs/{id}/funding", get(funding))
        .route("/api/runs/{id}/funding/deposit-tx", post(deposit_tx))
        .route("/api/runs/{id}/execute", post(execute))
        .route("/api/runs/{id}/cancel", post(cancel))
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
    /// Create the run even when a run that is not cancelled covers part of its period (an extra
    /// run, such as a bonus or a correction).
    #[serde(default)]
    allow_overlap: bool,
    /// Take every approved payment request for the period into the run: onto its contractor's
    /// line when the body has one, else as a line of its own.
    #[serde(default)]
    include_requests: bool,
    /// Exactly these approved requests instead (what the payer kept on the Amounts step).
    request_ids: Option<Vec<String>>,
}

/// SHA-256 of a create request's canonical form: the period, and each line's contractor, amount
/// and trimmed invoice reference, lines sorted, so the same payroll matches whatever the order
/// of its lines. The idempotency key and `allow_overlap` are left out: they say how to create the
/// run, not what it is.
fn request_hash(input: &CreateRun) -> String {
    let mut lines: Vec<String> = input
        .lines
        .iter()
        .map(|l| json!([l.contractor_id, l.amount_usd_cents, l.invoice_ref.trim()]).to_string())
        .collect();
    lines.sort();
    let canonical = json!([input.period_start, input.period_end, lines]).to_string();
    hex::encode(Sha256::digest(canonical.as_bytes()))
}

/// The answer to a request whose idempotency key already created `existing`: that run (200)
/// when the request is the same, else 409 `idempotency_mismatch`. A run created before request
/// hashes were stored has none and is returned as before.
async fn replay(s: &AppStateRef, existing: &RunRow, hash: &str) -> ApiResult<(StatusCode, Json<Value>)> {
    if existing.idempotency_hash.as_deref().is_some_and(|h| h != hash) {
        return Err(ApiError::conflict(
            "idempotency_mismatch",
            format!(
                "This idempotency key already created run {} with a different period or different lines.",
                existing.id
            ),
            "Send a new idempotency key to create another run. To get that run back, resend its original request unchanged.",
        )
        .with_runs(vec![existing.id.clone()]));
    }
    Ok((StatusCode::OK, Json(view(s, &existing.id).await?)))
}

fn overlap_error(start: &str, end: &str, runs: &[RunRow]) -> ApiError {
    let listed = runs
        .iter()
        .map(|r| format!("{} ({} to {}, {})", r.id, r.period_start, r.period_end, r.status))
        .collect::<Vec<_>>()
        .join("; ");
    let count = match runs.len() {
        1 => "a run that is".to_string(),
        n => format!("{n} runs that are"),
    };
    ApiError::conflict(
        "period_overlap",
        format!("{start} to {end} overlaps {count} not cancelled: {listed}."),
        "Paying a period twice pays these people twice. Finish, discard or cancel the other run, or choose another period. For an extra run (a bonus or a correction), send the request again with \"allow_overlap\": true.",
    )
    .with_runs(runs.iter().map(|r| r.id.clone()).collect())
}

async fn view(s: &AppStateRef, id: &str) -> ApiResult<Value> {
    let mut v = s.executor()?.run_view(id).await?;
    if let Some(o) = v.as_object_mut() {
        o.insert("executing".into(), Value::Bool(s.executor()?.is_running(id)));
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
    let _ = s.executor()?.refresh_conversions(&id).await;
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
            "Funded runs stay on record. Cancel it if it received no money (POST /api/runs/{id}/cancel), or open it to follow or resume it.",
        ))
    }
}

async fn create(
    State(s): State<AppStateRef>,
    // The signed-in member (ADR-026); absent with sign-in off.
    identity: Option<Extension<Identity>>,
    Json(input): Json<CreateRun>,
) -> ApiResult<(StatusCode, Json<Value>)> {
    let created_by = identity.as_ref().map(|i| i.user.id.clone());
    let hash = request_hash(&input);
    if let Some(key) = input.idempotency_key.as_deref() {
        if key.is_empty() || key.len() > 100 {
            return Err(ApiError::bad_request(
                "invalid_idempotency_key",
                "The idempotency key must be 1 to 100 characters.",
                "Send a fresh UUID per form submission.",
            ));
        }
        // Before any other check: a retry gets its run back even if, say, a contractor on it was
        // archived since, and never counts as overlapping the run it created.
        if let Some(existing) = db::get_run_by_key(&s.db, key).await? {
            return replay(&s, &existing, &hash).await;
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
    // Approved payment requests for the period: the ones named, or all of them.
    let taken = match &input.request_ids {
        Some(ids) => {
            let found = requests::by_ids(&s.db, ids).await?;
            for id in ids {
                let r = found.iter().find(|r| &r.id == id).ok_or_else(|| {
                    ApiError::bad_request(
                        "unknown_request",
                        format!("Payment request {id} does not exist."),
                        "Reload the requests and try again.",
                    )
                })?;
                let in_period = r.period_start <= input.period_end && r.period_end >= input.period_start;
                if r.status != "approved" || r.run_id.is_some() || r.contractor_archived || !in_period {
                    let why = if r.run_id.is_some() {
                        "in another run".to_string()
                    } else if !in_period {
                        "for another period".to_string()
                    } else if r.contractor_archived {
                        "from an archived contractor".to_string()
                    } else {
                        r.status.clone()
                    };
                    return Err(ApiError::conflict(
                        "request_not_available",
                        format!(
                            "The request {} from {} is {why} and cannot join this run.",
                            r.invoice_ref, r.contractor_name
                        ),
                        "Reload the requests: only approved requests for this period that no run has taken can join.",
                    ));
                }
            }
            found
        }
        None if input.include_requests => {
            requests::approved_for_period(&s.db, &input.period_start, &input.period_end).await?
        }
        None => vec![],
    };
    let draft_lines = requests::merge_lines(lines, &taken);
    let lines: Vec<NewLine> = draft_lines.iter().map(|l| l.line.clone()).collect();
    if lines.len() > MAX_LINES {
        return Err(ApiError::bad_request(
            "too_many_lines",
            format!("With the payment requests, this run would pay more than {MAX_LINES} contractors."),
            "Split the payroll into two runs.",
        ));
    }
    // PAYSLIP_MAX_RUN_USD_CENTS (ADR-025): said at creation, and checked again at funding.
    if let Some(cap) = s.cfg.max_run_usd_cents {
        let total: u64 = lines.iter().map(|l| l.amount_usd_cents).sum();
        if total > cap {
            return Err(run_over_cap(total, cap));
        }
    }
    let run = NewRun {
        created_by: created_by.as_deref(),
        idempotency_key: input.idempotency_key.as_deref(),
        request_hash: Some(&hash),
        period_start: &input.period_start,
        period_end: &input.period_end,
        allow_overlap: input.allow_overlap,
    };
    match db::create_run(&s.db, &run, &lines).await? {
        RunInsert::Created(id) => {
            requests::link(&s.db, &id, &draft_lines).await?;
            if !taken.is_empty() {
                db::log_event(
                    &s.db,
                    &id,
                    &format!(
                        "{} approved payment request{} taken into the run",
                        taken.len(),
                        if taken.len() == 1 { "" } else { "s" }
                    ),
                )
                .await?;
            }
            Ok((StatusCode::CREATED, Json(view(&s, &id).await?)))
        }
        // Lost a race with a submission carrying the same key.
        RunInsert::KeyExists(existing) => replay(&s, &existing, &hash).await,
        RunInsert::Overlaps(runs) => Err(overlap_error(&input.period_start, &input.period_end, &runs)),
    }
}

#[derive(Deserialize, Default)]
struct FundInput {
    /// "usdc" (default): a USDC deposit swapped by the configured venue. "zec": ZEC sent to the
    /// treasury (ADR-025).
    method: Option<String>,
    origin_chain: Option<String>,
    refund_address: Option<String>,
}

async fn fund(
    State(s): State<AppStateRef>,
    Path(id): Path<String>,
    body: Option<Json<FundInput>>,
) -> ApiResult<Json<Value>> {
    let input = body.map(|b| b.0).unwrap_or_default();
    let method = FundMethod::parse(input.method.as_deref())?;
    s.executor()?
        .fund_with(
            &id,
            FundRequest {
                method,
                origin_chain: input.origin_chain,
                refund_address: input.refund_address,
            },
        )
        .await?;
    Ok(Json(view(&s, &id).await?))
}

async fn funding(State(s): State<AppStateRef>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    s.executor()?.refresh_funding(&id).await?;
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
    s.executor()?.submit_deposit(&id, h).await?;
    Ok(Json(view(&s, &id).await?))
}

async fn execute(State(s): State<AppStateRef>, Path(id): Path<String>) -> ApiResult<(StatusCode, Json<Value>)> {
    s.executor()?.start(&id).await?;
    Ok((StatusCode::ACCEPTED, Json(view(&s, &id).await?)))
}

/// Records the signed-in member's approval of the run (ADR-026, migration 0007). The guard has
/// already checked the role (admin or approver) and writes the audit row; the executor applies
/// the run's state, the creator rule and one approval per member.
async fn approve(
    State(s): State<AppStateRef>,
    identity: Option<Extension<Identity>>,
    Path(id): Path<String>,
) -> ApiResult<Response> {
    let Some(Extension(identity)) = identity else {
        return Err(ApiError::conflict(
            "signin_off",
            "Approvals need sign-in: with PAYSLIP_AUTH=off there is nobody to record.",
            "Set PAYSLIP_AUTH=required and PAYSLIP_APPROVALS_REQUIRED on the service (README, Sign-in).",
        ));
    };
    let member = identity.member()?;
    let executor = s.executor()?;
    executor.approve(&id, &identity.user, member.role).await?;
    let run = view(&s, &id).await?;
    let recorded = run["approvals"].as_array().map(|a| a.len()).unwrap_or(0);
    let mut res = Json(&run).into_response();
    res.extensions_mut().insert(AuditInfo {
        target: Some(id),
        details: Some(json!({
            "approvals": recorded,
            "approvals_required": executor.approvals_required(),
        })),
    });
    Ok(res)
}

async fn cancel(State(s): State<AppStateRef>, Path(id): Path<String>) -> ApiResult<Json<Value>> {
    s.executor()?.cancel(&id).await?;
    Ok(Json(view(&s, &id).await?))
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
    // Each open stream holds a slot until the client goes away.
    let slot = super::stream_slot(&s.sse_slots)?;
    let rx = s.executor()?.subscribe();
    let stream = futures_util::stream::unfold(
        (s, id, rx, 0i64, true, slot),
        |(s, id, mut rx, last, first, slot)| async move {
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
            Some((futures_util::stream::iter(out), (s, id, rx, new_last, false, slot)))
        },
    )
    .flatten();
    Ok(Sse::new(stream).keep_alive(KeepAlive::new().interval(Duration::from_secs(15))))
}
