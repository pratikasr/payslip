//! Payment requests: the portal side (keyed by the contractor's viewing key, as statements are)
//! and the console side (the queue, approve, reject).

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{get, post},
    Extension, Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use super::AppStateRef;
use crate::{
    auth::Identity,
    db::{self, Contractor},
    error::{ApiError, ApiResult},
    memo,
    requests::{self, NewRequest, MAX_NOTE_CHARS},
    runs::{parse_date, validate_period},
    schedule::Cadence,
    viewer::{fingerprint_of, ViewingKey},
};

/// Mounted in every mode: a contractor can send a request to any Payslip that knows their key.
pub fn portal_routes() -> Router<AppStateRef> {
    Router::new()
        .route("/api/portal/requests", post(submit))
        .route("/api/portal/requests/list", post(list_mine))
}

/// The payer's side, mounted with the other payer routes (full mode only).
pub fn routes() -> Router<AppStateRef> {
    Router::new()
        .route("/api/requests", get(list))
        .route("/api/requests/{id}/approve", post(approve))
        .route("/api/requests/{id}/reject", post(reject))
}

/// $10,000,000.00, as for a pay line.
const MAX_AMOUNT_CENTS: i64 = 1_000_000_000;

fn unknown_key(s: &AppStateRef) -> ApiError {
    let hint = if s.cfg.statements_only {
        "This Payslip reads statements only and knows no contractors. Send the request on the Payslip your payer runs: the link in your invite opens it."
    } else {
        "Payment requests need the viewing key of a contractor of this company. Paste the key your payer sent you; if they archived you, ask them."
    };
    ApiError::new(
        StatusCode::NOT_FOUND,
        "unknown_key",
        "This viewing key does not belong to a contractor of this Payslip.",
        hint,
    )
}

/// The contractor whose account's viewing key this is: by the fingerprint recorded when the
/// contractor was added, and for contractors from before fingerprints were recorded, by deriving
/// theirs from the payer wallet once.
pub async fn resolve_contractor(s: &AppStateRef, raw_key: &str) -> ApiResult<Contractor> {
    let key = ViewingKey::parse(&s.cfg.network, raw_key)?;
    if let Some(c) = db::find_contractor_by_fingerprint(&s.db, &key.fingerprint).await? {
        return Ok(c);
    }
    if let Some(payer) = s.payer.as_ref() {
        let params = s.cfg.network.params();
        for c in db::contractors_without_fingerprint(&s.db).await? {
            let Ok(ufvk) = payer.ufvk(c.account_index as u32).await else {
                continue;
            };
            if let Ok(k) = zcash_keys::keys::UnifiedFullViewingKey::decode(&params, &ufvk) {
                db::set_contractor_fingerprint(&s.db, &c.id, &fingerprint_of(&params, &k)).await?;
            }
        }
        if let Some(c) = db::find_contractor_by_fingerprint(&s.db, &key.fingerprint).await? {
            return Ok(c);
        }
    }
    Err(unknown_key(s))
}

#[derive(Deserialize)]
struct SubmitInput {
    ufvk: String,
    amount_usd_cents: Value,
    period_start: String,
    period_end: String,
    invoice_ref: String,
    due_date: Option<String>,
    note: Option<String>,
    recurring: Option<String>,
}

fn clean_note(note: Option<String>, code: &str) -> ApiResult<Option<String>> {
    let note = note.map(|n| n.trim().to_string()).filter(|n| !n.is_empty());
    if let Some(n) = &note {
        if n.chars().count() > MAX_NOTE_CHARS {
            return Err(ApiError::bad_request(
                code,
                format!("The note is over {MAX_NOTE_CHARS} characters."),
                "Shorten the note.",
            ));
        }
    }
    Ok(note)
}

fn validate(input: &SubmitInput, contractor: &Contractor) -> ApiResult<NewRequest> {
    let cents = input
        .amount_usd_cents
        .as_i64()
        .filter(|_| input.amount_usd_cents.is_i64() || input.amount_usd_cents.is_u64())
        .ok_or_else(|| {
            ApiError::bad_request(
                "invalid_amount",
                "The amount must be a whole number of cents.",
                "Send amount_usd_cents as an integer, for example 480000 for $4,800.00.",
            )
        })?;
    if cents <= 0 {
        return Err(ApiError::bad_request(
            "invalid_amount",
            "The amount must be greater than zero.",
            "Enter the amount you are asking to be paid, in US dollars.",
        ));
    }
    if cents > MAX_AMOUNT_CENTS {
        return Err(ApiError::bad_request(
            "invalid_amount",
            "The amount is over $10,000,000.",
            "Check the amount is in cents, not a larger unit.",
        ));
    }
    validate_period(&input.period_start, &input.period_end)?;
    let invoice = input.invoice_ref.trim().to_string();
    memo::validate_invoice_ref(&invoice).map_err(|e| {
        let code = if matches!(e, memo::EncodeError::InvoiceRefTooLong) {
            "invoice_ref_too_long"
        } else {
            "invalid_invoice_ref"
        };
        ApiError::bad_request(
            code,
            format!("Invoice number: {e}."),
            "Use up to 64 plain characters (letters, digits, spaces, - / . #), no '|'. It is written into the payment's memo.",
        )
    })?;
    let due_date = match input.due_date.as_deref().map(str::trim).filter(|d| !d.is_empty()) {
        None => None,
        Some(d) => {
            parse_date(d).ok_or_else(|| {
                ApiError::bad_request(
                    "invalid_due_date",
                    format!("{d} is not a date."),
                    "Use the form YYYY-MM-DD, or leave the due date out.",
                )
            })?;
            Some(d.to_string())
        }
    };
    let recurring = match input.recurring.as_deref().map(str::trim).filter(|r| !r.is_empty()) {
        None => None,
        Some(r) => Some(Cadence::parse(r).ok_or_else(|| {
            ApiError::bad_request(
                "invalid_recurring",
                format!("{r:?} is not a cadence."),
                "Use monthly, biweekly or weekly to repeat the request, or leave it out.",
            )
        })?),
    };
    Ok(NewRequest {
        contractor_id: contractor.id.clone(),
        amount_usd_cents: cents as u64,
        period_start: input.period_start.clone(),
        period_end: input.period_end.clone(),
        invoice_ref: invoice,
        due_date,
        note: clean_note(input.note.clone(), "note_too_long")?,
        recurring,
    })
}

async fn submit(State(s): State<AppStateRef>, Json(input): Json<SubmitInput>) -> ApiResult<(StatusCode, Json<Value>)> {
    let contractor = resolve_contractor(&s, &input.ufvk).await?;
    let new = validate(&input, &contractor)?;
    let r = requests::insert(&s.db, &new).await?;
    Ok((StatusCode::CREATED, Json(requests::json(s.cfg.network, &r))))
}

#[derive(Deserialize)]
struct ListMineInput {
    ufvk: String,
}

async fn list_mine(State(s): State<AppStateRef>, Json(input): Json<ListMineInput>) -> ApiResult<Json<Value>> {
    let contractor = resolve_contractor(&s, &input.ufvk).await?;
    let rows = requests::list_for_contractor(&s.db, &contractor.id).await?;
    Ok(Json(json!({
        "contractor": {"id": contractor.id, "name": contractor.name},
        "requests": rows.iter().map(|r| requests::json(s.cfg.network, r)).collect::<Vec<_>>(),
    })))
}

#[derive(Deserialize)]
struct ListQuery {
    status: Option<String>,
}

async fn list(State(s): State<AppStateRef>, Query(q): Query<ListQuery>) -> ApiResult<Json<Value>> {
    let status = q.status.as_deref().map(str::trim).filter(|v| !v.is_empty());
    if let Some(st) = status {
        if !requests::STATUSES.contains(&st) {
            return Err(ApiError::bad_request(
                "invalid_status",
                format!("{st:?} is not a request status."),
                "Use submitted, approved, rejected or paid, or leave status out for every request.",
            ));
        }
    }
    let rows = requests::list(&s.db, status).await?;
    Ok(Json(json!({
        "requests": rows.iter().map(|r| requests::json(s.cfg.network, r)).collect::<Vec<_>>(),
        "counts": {
            "submitted": requests::count_by_status(&s.db, "submitted").await?,
            "approved": requests::count_by_status(&s.db, "approved").await?,
        },
    })))
}

#[derive(Deserialize, Default)]
struct DecisionInput {
    note: Option<String>,
}

async fn load(s: &AppStateRef, id: &str) -> ApiResult<requests::RequestRow> {
    requests::get(&s.db, id)
        .await?
        .ok_or_else(|| ApiError::not_found("Payment request"))
}

/// Who decided, for the request's record: the signed-in member's email, none with sign-in off.
fn decider(identity: &Option<Extension<Identity>>) -> Option<String> {
    identity.as_ref().map(|i| i.user.email.clone())
}

async fn approve(
    State(s): State<AppStateRef>,
    Path(id): Path<String>,
    identity: Option<Extension<Identity>>,
    body: Option<Json<DecisionInput>>,
) -> ApiResult<Json<Value>> {
    let input = body.map(|b| b.0).unwrap_or_default();
    let note = clean_note(input.note, "note_too_long")?;
    let r = load(&s, &id).await?;
    match r.status.as_str() {
        "submitted" => {}
        "approved" => return Ok(Json(requests::json(s.cfg.network, &r))),
        "paid" => {
            return Err(ApiError::conflict(
                "request_paid",
                "This request was paid.",
                "Nothing to approve: open the run that paid it.",
            ))
        }
        _ => {
            return Err(ApiError::conflict(
                "request_decided",
                "This request was rejected.",
                "Ask the contractor to send it again if it should be paid after all.",
            ))
        }
    }
    if r.contractor_archived {
        return Err(ApiError::conflict(
            "contractor_archived",
            format!(
                "{} was archived, so their request cannot be approved.",
                r.contractor_name
            ),
            "Reject the request, or add them again first.",
        ));
    }
    requests::decide(
        &s.db,
        &id,
        &["submitted"],
        "approved",
        note.as_deref(),
        decider(&identity).as_deref(),
    )
    .await?;
    Ok(Json(requests::json(s.cfg.network, &load(&s, &id).await?)))
}

async fn reject(
    State(s): State<AppStateRef>,
    Path(id): Path<String>,
    identity: Option<Extension<Identity>>,
    body: Option<Json<DecisionInput>>,
) -> ApiResult<Json<Value>> {
    let input = body.map(|b| b.0).unwrap_or_default();
    let note = clean_note(input.note, "note_too_long")?;
    let r = load(&s, &id).await?;
    match r.status.as_str() {
        "submitted" => {}
        // Approved but not yet in a run: the payer may still change their mind.
        "approved" if r.run_id.is_none() => {}
        "rejected" => return Ok(Json(requests::json(s.cfg.network, &r))),
        "approved" => {
            return Err(ApiError::conflict(
                "request_in_run",
                "This request is in a run already.",
                "Discard or cancel that run first; the request then waits for the next one, and can be rejected.",
            ))
        }
        _ => {
            return Err(ApiError::conflict(
                "request_paid",
                "This request was paid.",
                "Nothing to reject: open the run that paid it.",
            ))
        }
    }
    requests::decide(
        &s.db,
        &id,
        &["submitted", "approved"],
        "rejected",
        note.as_deref(),
        decider(&identity).as_deref(),
    )
    .await?;
    Ok(Json(requests::json(s.cfg.network, &load(&s, &id).await?)))
}
