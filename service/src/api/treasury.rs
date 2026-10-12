//! The treasury key (ADR-030): its state, lock and unlock, creating and replacing it, and
//! moving the treasury out. Admin-only writes, audited; the state is read by every member.

use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;

use super::AppStateRef;
use crate::{
    auth::AuditInfo,
    error::{ApiError, ApiResult},
    treasury::{KeyView, DEFAULT_UNLOCK_HOURS},
};

pub fn routes() -> Router<AppStateRef> {
    Router::new()
        .route("/api/treasury/key", get(key).post(create_key))
        .route("/api/treasury/key/replace", post(replace_key))
        .route("/api/treasury/unlock", post(unlock))
        .route("/api/treasury/lock", post(lock))
        .route("/api/treasury/move", post(move_funds))
}

/// The audit row's target for every key write: the key itself, never a secret.
const TARGET: &str = "treasury";

fn with_audit(view: &KeyView, s: &AppStateRef, extra: serde_json::Value, status: StatusCode) -> Response {
    let mut details = s
        .treasury
        .as_ref()
        .map(|t| t.audit_details(view))
        .unwrap_or_else(|| json!({}));
    if let (Some(d), Some(e)) = (details.as_object_mut(), extra.as_object()) {
        for (k, v) in e {
            d.insert(k.clone(), v.clone());
        }
    }
    let mut res = (status, Json(view)).into_response();
    res.extensions_mut().insert(AuditInfo {
        target: Some(TARGET.into()),
        details: Some(details),
    });
    res
}

async fn key(State(s): State<AppStateRef>) -> ApiResult<Json<KeyView>> {
    Ok(Json(s.treasury()?.key_view().await?))
}

#[derive(Deserialize)]
struct UnlockInput {
    passphrase: String,
    hours: Option<u32>,
}

async fn unlock(State(s): State<AppStateRef>, Json(input): Json<UnlockInput>) -> ApiResult<Response> {
    let hours = input.hours.unwrap_or(DEFAULT_UNLOCK_HOURS);
    if input.passphrase.is_empty() {
        return Err(ApiError::bad_request(
            "passphrase_required",
            "The passphrase is empty.",
            "Type the passphrase chosen when the treasury key was created.",
        ));
    }
    let view = s.treasury()?.unlock(&input.passphrase, hours).await?;
    Ok(with_audit(&view, &s, json!({ "hours": hours }), StatusCode::OK))
}

async fn lock(State(s): State<AppStateRef>) -> ApiResult<Response> {
    let view = s.treasury()?.lock().await?;
    Ok(with_audit(&view, &s, json!({}), StatusCode::OK))
}

#[derive(Deserialize)]
struct CreateInput {
    /// The armored age file: the 24 words encrypted with the passphrase (scrypt recipient).
    ciphertext: String,
    /// Optional: verifies the file and unlocks the treasury at once. Never stored.
    passphrase: Option<String>,
}

async fn create_key(State(s): State<AppStateRef>, Json(input): Json<CreateInput>) -> ApiResult<Response> {
    let passphrase = input.passphrase.as_deref().map(str::trim).filter(|p| !p.is_empty());
    let view = s.treasury()?.create_key(&input.ciphertext, passphrase).await?;
    Ok(with_audit(
        &view,
        &s,
        json!({ "verified": passphrase.is_some() }),
        StatusCode::CREATED,
    ))
}

#[derive(Deserialize)]
struct ReplaceInput {
    ciphertext: String,
    passphrase: String,
    /// Where the old treasury's balance goes. Only `new` (the new key's treasury) exists.
    sweep_to: String,
}

async fn replace_key(State(s): State<AppStateRef>, Json(input): Json<ReplaceInput>) -> ApiResult<Response> {
    if input.sweep_to.trim() != "new" {
        return Err(ApiError::bad_request(
            "invalid_sweep_to",
            format!("{:?} is not a place the old balance can go.", input.sweep_to),
            "Send \"sweep_to\": \"new\" to move the old treasury's balance to the new key. To send it elsewhere, use POST /api/treasury/move first.",
        ));
    }
    if input.passphrase.is_empty() {
        return Err(ApiError::bad_request(
            "passphrase_required",
            "The new key's passphrase is empty.",
            "Send the passphrase the new key was encrypted with, so it can be verified before the old key is retired.",
        ));
    }
    let t = s.treasury()?;
    let view = t.replace_key(&input.ciphertext, &input.passphrase).await?;
    let mut details = t.audit_details(&view.key);
    if let Some(d) = details.as_object_mut() {
        d.insert("old_address".into(), json!(view.old_address));
        d.insert("new_address".into(), json!(view.new_address));
        d.insert("sweep_txid".into(), json!(view.sweep_txid));
        d.insert("contractors_rotated".into(), json!(view.contractors_rotated));
        d.insert("retired".into(), json!(view.retired));
    }
    let mut res = Json(&view).into_response();
    res.extensions_mut().insert(AuditInfo {
        target: Some(TARGET.into()),
        details: Some(details),
    });
    Ok(res)
}

#[derive(Deserialize)]
struct MoveInput {
    to_address: String,
}

async fn move_funds(State(s): State<AppStateRef>, Json(input): Json<MoveInput>) -> ApiResult<Response> {
    let view = s.treasury()?.move_funds(&input.to_address).await?;
    let mut res = Json(&view).into_response();
    res.extensions_mut().insert(AuditInfo {
        target: Some(TARGET.into()),
        details: Some(json!({
            "to_address": view.to_address,
            "txid": view.txid,
            "amount_zat": view.amount_zat,
            "fee_zat": view.fee_zat,
        })),
    });
    Ok(res)
}
