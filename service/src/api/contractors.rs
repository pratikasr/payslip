//! Contractors and viewing-key export.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};

use super::AppStateRef;
use crate::{
    config::ZcashNetwork,
    db::{self, Contractor, NewContractor},
    error::{ApiError, ApiResult},
    payer::TREASURY_INDEX,
};

pub fn routes() -> Router<AppStateRef> {
    Router::new()
        .route("/api/contractors", get(list).post(create))
        .route("/api/contractors/{id}", get(get_one).patch(update).delete(archive))
        .route("/api/contractors/{id}/viewing-key", get(viewing_key))
        .route("/api/contractors/{id}/viewing-key/shared", post(mark_shared))
        .route("/api/viewing-keys", get(all_viewing_keys))
}

#[derive(Deserialize)]
pub struct ContractorInput {
    name: Option<String>,
    email: Option<String>,
    unified_address: Option<String>,
    settlement_choice: Option<String>,
    payout_chain: Option<String>,
    payout_address: Option<String>,
}

const PAYOUT_CHAINS: &[&str] = &["base", "arb", "eth", "sol"];

fn clean(s: Option<String>) -> Option<String> {
    s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// Validates input into a `NewContractor`, starting from `base` for partial updates.
fn validate(network: &ZcashNetwork, input: ContractorInput, base: Option<&Contractor>) -> ApiResult<NewContractor> {
    let name = clean(input.name)
        .or_else(|| base.map(|b| b.name.clone()))
        .ok_or_else(|| {
            ApiError::bad_request(
                "name_required",
                "A contractor needs a name.",
                "Enter the name that should appear on statements.",
            )
        })?;
    if name.chars().count() > 120 {
        return Err(ApiError::bad_request(
            "name_too_long",
            "Names are limited to 120 characters.",
            "Shorten the name.",
        ));
    }
    let email = match input.email {
        Some(e) => clean(Some(e)),
        None => base.and_then(|b| b.email.clone()),
    };
    if let Some(e) = &email {
        if !e.contains('@') || e.len() > 254 {
            return Err(ApiError::bad_request(
                "invalid_email",
                "That email address is not valid.",
                "Use the form name@example.com or leave it empty.",
            ));
        }
    }
    let address = clean(input.unified_address)
        .or_else(|| base.map(|b| b.unified_address.clone()))
        .ok_or_else(|| {
            ApiError::bad_request(
                "invalid_address",
                "A unified address is required.",
                "Ask the contractor for the unified address from their Zcash wallet (Zodl shows it under Receive).",
            )
        })?;
    validate_address(network, &address)?;
    let settlement = clean(input.settlement_choice)
        .or_else(|| base.map(|b| b.settlement_choice.clone()))
        .unwrap_or_else(|| "hold_zec".into());
    if settlement != "hold_zec" && settlement != "convert_usdc" {
        return Err(ApiError::bad_request(
            "invalid_settlement_choice",
            "Settlement must be hold_zec or convert_usdc.",
            "Pick Hold ZEC or Convert to USDC.",
        ));
    }
    let (payout_chain, payout_address) = if settlement == "convert_usdc" {
        let chain = clean(input.payout_chain).or_else(|| base.and_then(|b| b.payout_chain.clone()));
        let addr = clean(input.payout_address).or_else(|| base.and_then(|b| b.payout_address.clone()));
        match (chain, addr) {
            (Some(c), Some(a)) => {
                if !PAYOUT_CHAINS.contains(&c.as_str()) {
                    return Err(ApiError::bad_request(
                        "invalid_payout_chain",
                        format!("Payout chain {c} is not supported."),
                        "Choose base, arb, eth or sol.",
                    ));
                }
                let ok = if c == "sol" {
                    (32..=44).contains(&a.len()) && a.chars().all(|ch| ch.is_ascii_alphanumeric())
                } else {
                    a.len() == 42 && a.starts_with("0x") && a[2..].chars().all(|ch| ch.is_ascii_hexdigit())
                };
                if !ok {
                    return Err(ApiError::bad_request(
                        "invalid_payout_address",
                        "The USDC payout address does not match the chain.",
                        "Paste the contractor's USDC address on the chosen chain (0x... for EVM chains).",
                    ));
                }
                (Some(c), Some(a))
            }
            _ => {
                return Err(ApiError::bad_request(
                    "payout_address_required",
                    "Converting to USDC needs a payout chain and address.",
                    "Enter where the contractor wants USDC delivered, or choose Hold ZEC.",
                ))
            }
        }
    } else {
        (None, None)
    };
    Ok(NewContractor {
        name,
        email,
        unified_address: address,
        settlement_choice: settlement,
        payout_chain,
        payout_address,
    })
}

pub fn validate_address(network: &ZcashNetwork, address: &str) -> ApiResult<()> {
    let params = network.params();
    let hint_unified = "Paste the contractor's unified address. On testnet it starts with utest1 or zutest1, on mainnet with u1 or zu1.";
    match zcash_keys::address::Address::decode(&params, address) {
        Some(zcash_keys::address::Address::Unified(ua)) => {
            if ua.orchard().is_none() && ua.sapling().is_none() {
                return Err(ApiError::bad_request(
                    "address_without_shielded_receiver",
                    "That unified address has no shielded receiver, so the payment and its memo would be public.",
                    "Ask the contractor for a shielded unified address (any recent Zodl or Ledger address has one).",
                ));
            }
            Ok(())
        }
        Some(_) => Err(ApiError::bad_request(
            "invalid_address",
            "Payslip pays unified addresses only.",
            hint_unified,
        )),
        None => {
            let other = match network {
                ZcashNetwork::Mainnet => zcash_protocol::consensus::Network::TestNetwork,
                ZcashNetwork::Testnet => zcash_protocol::consensus::Network::MainNetwork,
            };
            if zcash_keys::address::Address::decode(&other, address).is_some() {
                return Err(ApiError::bad_request(
                    "wrong_network",
                    format!("That address is not a {} address.", network.as_str()),
                    hint_unified,
                ));
            }
            Err(ApiError::bad_request(
                "invalid_address",
                "That is not a valid Zcash unified address.",
                hint_unified,
            ))
        }
    }
}

async fn list(State(s): State<AppStateRef>) -> ApiResult<Json<serde_json::Value>> {
    Ok(Json(
        serde_json::json!({ "contractors": db::list_contractors(&s.db).await? }),
    ))
}

async fn get_contractor(s: &AppStateRef, id: &str) -> ApiResult<Contractor> {
    db::get_contractor(&s.db, id)
        .await?
        .filter(|c| c.archived_at.is_none())
        .ok_or_else(|| ApiError::not_found("Contractor"))
}

async fn get_one(State(s): State<AppStateRef>, Path(id): Path<String>) -> ApiResult<Json<Contractor>> {
    Ok(Json(get_contractor(&s, &id).await?))
}

async fn create(
    State(s): State<AppStateRef>,
    Json(input): Json<ContractorInput>,
) -> ApiResult<(StatusCode, Json<Contractor>)> {
    let new = validate(&s.cfg.network, input, None)?;
    let _guard = s.contractor_lock.lock().await;
    if db::find_active_by_address(&s.db, &new.unified_address).await?.is_some() {
        return Err(ApiError::conflict(
            "duplicate_address",
            "Another contractor already uses that address.",
            "Each contractor needs their own address. Check for a duplicate entry.",
        ));
    }
    let index = db::next_account_index(&s.db).await?;
    let (_ufvk, birthday) = s.payer()?.ensure_account(index, new.name.clone()).await?;
    let c = db::insert_contractor(&s.db, &new, index, birthday).await?;
    Ok((StatusCode::CREATED, Json(c)))
}

async fn update(
    State(s): State<AppStateRef>,
    Path(id): Path<String>,
    Json(input): Json<ContractorInput>,
) -> ApiResult<Json<Contractor>> {
    let existing = get_contractor(&s, &id).await?;
    let new = validate(&s.cfg.network, input, Some(&existing))?;
    if new.unified_address != existing.unified_address {
        if let Some(other) = db::find_active_by_address(&s.db, &new.unified_address).await? {
            if other.id != id {
                return Err(ApiError::conflict(
                    "duplicate_address",
                    "Another contractor already uses that address.",
                    "Each contractor needs their own address.",
                ));
            }
        }
        if db::contractor_in_active_run(&s.db, &id).await? {
            return Err(ApiError::conflict(
                "contractor_in_active_run",
                "The address cannot change while a run that pays this contractor is in progress.",
                "Wait for the run to finish, then edit the address.",
            ));
        }
    }
    db::update_contractor(&s.db, &id, &new).await?;
    Ok(Json(get_contractor(&s, &id).await?))
}

async fn archive(State(s): State<AppStateRef>, Path(id): Path<String>) -> ApiResult<StatusCode> {
    get_contractor(&s, &id).await?;
    if db::contractor_in_active_run(&s.db, &id).await? {
        return Err(ApiError::conflict(
            "contractor_in_active_run",
            "This contractor is in a run that has not finished.",
            "Wait for the run to finish, then archive the contractor.",
        ));
    }
    db::archive_contractor(&s.db, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Serialize)]
struct ViewingKeyOut {
    contractor_id: String,
    account_index: i64,
    ufvk: String,
    /// The same key in the older Revision 0 form (`uview`), for wallets such as Zingo and Zkool.
    ufvk_wallet: String,
    birthday_height: i64,
    network: &'static str,
}

async fn viewing_key(State(s): State<AppStateRef>, Path(id): Path<String>) -> ApiResult<Json<ViewingKeyOut>> {
    let c = get_contractor(&s, &id).await?;
    let ufvk = s.payer()?.ufvk(c.account_index as u32).await?;
    let ufvk_wallet = wallet_form(&s, &ufvk)?;
    Ok(Json(ViewingKeyOut {
        contractor_id: c.id,
        account_index: c.account_index,
        ufvk,
        ufvk_wallet,
        birthday_height: c.account_birthday_height,
        network: s.cfg.network.as_str(),
    }))
}

async fn mark_shared(State(s): State<AppStateRef>, Path(id): Path<String>) -> ApiResult<Json<Contractor>> {
    get_contractor(&s, &id).await?;
    db::mark_fvk_shared(&s.db, &id).await?;
    Ok(Json(get_contractor(&s, &id).await?))
}

#[derive(Serialize)]
struct ExportKey {
    label: String,
    role: &'static str,
    account_index: u32,
    ufvk: String,
    ufvk_wallet: String,
    contractor_id: Option<String>,
    birthday_height: u32,
}

async fn all_viewing_keys(State(s): State<AppStateRef>) -> ApiResult<Json<serde_json::Value>> {
    let info = s.payer()?.wallet_info().await?;
    let treasury = s.payer()?.ufvk(TREASURY_INDEX).await?;
    let mut keys = vec![ExportKey {
        label: "Treasury".into(),
        role: "treasury",
        account_index: TREASURY_INDEX,
        ufvk_wallet: wallet_form(&s, &treasury)?,
        ufvk: treasury,
        contractor_id: None,
        birthday_height: info.birthday_height,
    }];
    // Archived contractors stay in the export: their history is still part of the books.
    for c in db::all_contractors(&s.db).await? {
        let ufvk = s.payer()?.ufvk(c.account_index as u32).await?;
        keys.push(ExportKey {
            label: c.name.clone(),
            role: "contractor",
            account_index: c.account_index as u32,
            ufvk_wallet: wallet_form(&s, &ufvk)?,
            ufvk,
            contractor_id: Some(c.id.clone()),
            birthday_height: c.account_birthday_height as u32,
        });
    }
    Ok(Json(serde_json::json!({
        "network": s.cfg.network.as_str(),
        "birthday_height": info.birthday_height,
        "keys": keys,
    })))
}

/// The Revision 0 (`uview`) form of a key, for wallets that do not read Revision 2 yet.
fn wallet_form(s: &AppStateRef, ufvk: &str) -> ApiResult<String> {
    let params = s.cfg.network.params();
    let key = zcash_keys::keys::UnifiedFullViewingKey::decode(&params, ufvk).map_err(ApiError::internal)?;
    Ok(crate::viewer::encode_ufvk_r0(&params, &key)?)
}
