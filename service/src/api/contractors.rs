//! Contractors and viewing-key export.

use axum::{
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Deserializer, Serialize};

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
        .route(
            "/api/contractors/{id}/viewing-key/shared",
            post(mark_shared).delete(unmark_shared),
        )
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
    /// The usual pay in cents for a scheduled draft: a number sets it, `null` clears it, absent
    /// leaves it as it is (so `null` must survive deserialisation, which `present` ensures).
    #[serde(default, deserialize_with = "present")]
    default_amount_usd_cents: Option<serde_json::Value>,
}

/// Keeps a JSON `null` as `Some(Value::Null)`: a field sent as null is a request to clear it,
/// unlike a field left out.
fn present<'de, D: Deserializer<'de>>(d: D) -> Result<Option<serde_json::Value>, D::Error> {
    serde_json::Value::deserialize(d).map(Some)
}

/// $10,000,000.00, the ceiling for one pay line.
const MAX_DEFAULT_CENTS: i64 = 1_000_000_000;

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
                let ok = payout_address_valid(&c, &a);
                if !ok {
                    return Err(ApiError::bad_request(
                        "invalid_payout_address",
                        "The USDC payout address does not match the chain.",
                        "Paste the contractor's USDC address on the chosen chain: 0x followed by 40 hex characters on Base, Arbitrum and Ethereum, a base58 public key on Solana.",
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
    let default_amount_usd_cents = match &input.default_amount_usd_cents {
        None => base.and_then(|b| b.default_amount_usd_cents),
        Some(serde_json::Value::Null) => None,
        Some(v) => {
            let cents = v
                .as_i64()
                .filter(|_| v.is_i64() || v.is_u64())
                .filter(|c| (1..=MAX_DEFAULT_CENTS).contains(c))
                .ok_or_else(|| {
                    ApiError::bad_request(
                        "invalid_default_amount",
                        "The default amount must be a whole number of cents above zero and at most $10,000,000.",
                        "Send default_amount_usd_cents as an integer, for example 480000 for $4,800.00, or null to clear it.",
                    )
                })?;
            Some(cents)
        }
    };
    Ok(NewContractor {
        name,
        email,
        unified_address: address,
        settlement_choice: settlement,
        payout_chain,
        payout_address,
        default_amount_usd_cents,
    })
}

/// A USDC payout address for `chain`: an EVM address (0x and 40 hex characters) on Base,
/// Arbitrum and Ethereum; a Solana public key (base58 of exactly 32 bytes) on Solana.
pub fn payout_address_valid(chain: &str, address: &str) -> bool {
    if chain == "sol" {
        (32..=44).contains(&address.len()) && bs58::decode(address).into_vec().map(|b| b.len() == 32).unwrap_or(false)
    } else {
        address.len() == 42 && address.starts_with("0x") && address[2..].chars().all(|ch| ch.is_ascii_hexdigit())
    }
}

/// Whether an edit changes how or where the contractor is paid. Such edits wait until no run
/// that includes them is in progress: the run pays what it was funded for.
pub fn changes_payout(existing: &Contractor, new: &NewContractor) -> bool {
    existing.unified_address != new.unified_address
        || existing.settlement_choice != new.settlement_choice
        || existing.payout_chain != new.payout_chain
        || existing.payout_address != new.payout_address
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
    let (ufvk, birthday) = s.payer()?.ensure_account(index, new.name.clone()).await?;
    let c = db::insert_contractor(&s.db, &new, index, birthday).await?;
    // The key's fingerprint maps a viewing key sent to the portal back to this contractor.
    let params = s.cfg.network.params();
    if let Ok(k) = zcash_keys::keys::UnifiedFullViewingKey::decode(&params, &ufvk) {
        db::set_contractor_fingerprint(&s.db, &c.id, &crate::viewer::fingerprint_of(&params, &k)).await?;
    }
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
    }
    if changes_payout(&existing, &new) && db::contractor_in_active_run(&s.db, &id).await? {
        return Err(ApiError::conflict(
            "contractor_in_active_run",
            "The address and settlement cannot change while a run that pays this contractor is in progress.",
            "Wait for the run to finish (or cancel it if it received no money), then edit. The name and email can change now.",
        ));
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
            "Wait for the run to finish, or cancel it if it received no money, then archive the contractor.",
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

/// Undoes "Mark as shared" (a click by mistake). It records nothing about the key itself: a key
/// that was handed over still reads the contractor's payments.
async fn unmark_shared(State(s): State<AppStateRef>, Path(id): Path<String>) -> ApiResult<Json<Contractor>> {
    get_contractor(&s, &id).await?;
    db::clear_fvk_shared(&s.db, &id).await?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn solana_payout_addresses_must_be_base58_public_keys() {
        // USDC's own mint and the system program are valid 32-byte keys.
        assert!(payout_address_valid(
            "sol",
            "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        ));
        assert!(payout_address_valid("sol", "11111111111111111111111111111111"));
        // 0, O, I and l are not base58 (audit SL-17).
        assert!(!payout_address_valid("sol", "0000000000000000000000000000000000000000"));
        assert!(!payout_address_valid("sol", "OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO"));
        // Valid base58 of the wrong length.
        assert!(!payout_address_valid(
            "sol",
            "2222222222222222222222222222222222222222222"
        ));
        assert!(payout_address_valid(
            "base",
            "0x2527D02599Ba641c19FEa793cD0F167589a0f10D"
        ));
        assert!(!payout_address_valid(
            "base",
            "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        ));
    }

    fn contractor() -> Contractor {
        Contractor {
            id: "c".into(),
            name: "Amara".into(),
            email: None,
            unified_address: "utest1a".into(),
            account_index: 1,
            account_birthday_height: 1,
            settlement_choice: "hold_zec".into(),
            payout_chain: None,
            payout_address: None,
            fvk_shared_at: None,
            default_amount_usd_cents: None,
            created_at: String::new(),
            archived_at: None,
            key_fingerprint: None,
        }
    }

    fn edit(c: &Contractor) -> NewContractor {
        NewContractor {
            name: c.name.clone(),
            email: c.email.clone(),
            unified_address: c.unified_address.clone(),
            settlement_choice: c.settlement_choice.clone(),
            payout_chain: c.payout_chain.clone(),
            payout_address: c.payout_address.clone(),
            default_amount_usd_cents: c.default_amount_usd_cents,
        }
    }

    /// Audit SL-05: switching settlement or the USDC destination during a run is guarded like
    /// the address; the name and email are not.
    #[test]
    fn settlement_and_payout_edits_are_payout_changes() {
        let c = contractor();
        let mut n = edit(&c);
        n.name = "Amara O.".into();
        n.email = Some("a@example.com".into());
        assert!(!changes_payout(&c, &n));
        let mut n = edit(&c);
        n.settlement_choice = "convert_usdc".into();
        n.payout_chain = Some("base".into());
        n.payout_address = Some("0x2527D02599Ba641c19FEa793cD0F167589a0f10D".into());
        assert!(changes_payout(&c, &n));
        let mut n = edit(&c);
        n.unified_address = "utest1b".into();
        assert!(changes_payout(&c, &n));
        let mut conv = contractor();
        conv.settlement_choice = "convert_usdc".into();
        conv.payout_chain = Some("base".into());
        conv.payout_address = Some("0x2527D02599Ba641c19FEa793cD0F167589a0f10D".into());
        let mut n = edit(&conv);
        n.payout_address = Some("0x000000000000000000000000000000000000dEaD".into());
        assert!(changes_payout(&conv, &n));
    }
}
