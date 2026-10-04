//! Swap venues behind one trait (ADR-005, ADR-015).
//!
//! - [`NearIntents1Click`]: primary. USDC on Base, Arbitrum or Ethereum into native ZEC,
//!   delivered into the Ironwood pool at the treasury's unified address.
//! - [`Maya`]: fallback quote source (Sapling delivery only).
//! - [`TestnetVenue`]: testnet only. Records a fixed rate and draws ZEC from the treasury's
//!   existing testnet balance. The config refuses it on mainnet.

use std::{sync::Arc, time::Duration};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

use crate::{
    config::{Config, VenueKind},
    money,
};

/// Funding instructions and venue state for one run. Stored as JSON in `runs.venue_state`
/// and returned as `Run.funding`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Funding {
    pub venue: String,
    /// awaiting_deposit, deposit_seen, processing, success, refunded, failed, expired, incomplete
    pub status: String,
    pub origin_asset: String,
    pub origin_chain: Option<String>,
    pub token_address: Option<String>,
    pub chain_id: Option<u64>,
    pub amount_in: String,
    pub amount_in_base_units: String,
    pub deposit_address: Option<String>,
    pub deadline: Option<String>,
    pub requested_usd_cents: u64,
    pub quoted_zat: u64,
    pub quote_rate_e6: u64,
    pub funded_usd_cents: Option<u64>,
    pub zec_acquired_zat: Option<u64>,
    pub rate_usd_per_zec_e6: Option<u64>,
    pub delivered_txids: Vec<String>,
    pub deposit_tx_hash: Option<String>,
    pub venue_ref: Option<String>,
    pub venue_status: Option<String>,
    pub refund_reason: Option<String>,
}

#[derive(Clone, Debug)]
pub struct QuoteRequest {
    pub usd_cents: u64,
    pub origin_chain: String,
    pub refund_address: Option<String>,
    pub recipient: String,
}

#[derive(Debug, thiserror::Error)]
pub enum VenueError {
    #[error("{message}")]
    Rejected {
        code: &'static str,
        message: String,
        hint: String,
    },
    #[error("the swap venue did not answer: {0}")]
    Unavailable(String),
}

impl VenueError {
    fn rejected(code: &'static str, message: impl Into<String>, hint: impl Into<String>) -> Self {
        VenueError::Rejected {
            code,
            message: message.into(),
            hint: hint.into(),
        }
    }
}

#[async_trait]
pub trait SwapVenue: Send + Sync {
    fn kind(&self) -> VenueKind;
    /// Current USD per ZEC (times 1e6) for sizing a request before quoting.
    async fn indicative_rate_e6(&self) -> Result<u64, VenueError>;
    /// Requests a quote and deposit instructions.
    async fn quote(&self, req: &QuoteRequest) -> Result<Funding, VenueError>;
    /// Refreshes `funding` from the venue. Returns the updated copy.
    async fn status(&self, funding: &Funding) -> Result<Funding, VenueError>;
    /// Optional: tells the venue which transaction carried the deposit.
    async fn submit_deposit(&self, funding: &Funding, tx_hash: &str) -> Result<Funding, VenueError>;
}

pub fn build(cfg: &Config) -> anyhow::Result<Arc<dyn SwapVenue>> {
    Ok(match cfg.venue {
        VenueKind::NearIntents => Arc::new(NearIntents1Click::new(
            cfg.near_intents_api_url.clone(),
            cfg.near_intents_jwt.clone(),
        )?),
        VenueKind::Maya => Arc::new(Maya::new(cfg.maya_api_url.clone())?),
        VenueKind::TestnetFixedRate => {
            anyhow::ensure!(
                cfg.network == crate::config::ZcashNetwork::Testnet,
                "TestnetVenue requires ZCASH_NETWORK=testnet"
            );
            Arc::new(TestnetVenue {
                rate_e6: cfg.testnet_rate_e6,
            })
        }
    })
}

fn rfc3339(t: OffsetDateTime) -> String {
    t.replace_nanosecond(0)
        .unwrap_or(t)
        .format(&Rfc3339)
        .unwrap_or_default()
}

// ---------------------------------------------------------------------------------------------
// Testnet

/// Testnet only: no market exists for TAZ, so the run's ZEC comes from the treasury's faucet
/// balance at a fixed, configured rate. Never constructed on mainnet.
pub struct TestnetVenue {
    pub rate_e6: u64,
}

#[async_trait]
impl SwapVenue for TestnetVenue {
    fn kind(&self) -> VenueKind {
        VenueKind::TestnetFixedRate
    }

    async fn indicative_rate_e6(&self) -> Result<u64, VenueError> {
        Ok(self.rate_e6)
    }

    async fn quote(&self, req: &QuoteRequest) -> Result<Funding, VenueError> {
        let zat = money::usd_cents_to_zat(req.usd_cents, self.rate_e6)
            .ok_or_else(|| VenueError::rejected("invalid_amount", "Amount out of range", "Use a smaller amount."))?;
        Ok(Funding {
            venue: VenueKind::TestnetFixedRate.as_str().into(),
            status: "success".into(),
            origin_asset: "USD (testnet fixed rate)".into(),
            amount_in: money::format_usd(req.usd_cents),
            amount_in_base_units: req.usd_cents.to_string(),
            requested_usd_cents: req.usd_cents,
            quoted_zat: zat,
            quote_rate_e6: self.rate_e6,
            funded_usd_cents: Some(req.usd_cents),
            zec_acquired_zat: Some(zat),
            rate_usd_per_zec_e6: Some(self.rate_e6),
            venue_status: Some("FIXED_RATE".into()),
            ..Default::default()
        })
    }

    async fn status(&self, funding: &Funding) -> Result<Funding, VenueError> {
        Ok(funding.clone())
    }

    async fn submit_deposit(&self, funding: &Funding, _tx_hash: &str) -> Result<Funding, VenueError> {
        Ok(funding.clone())
    }
}

// ---------------------------------------------------------------------------------------------
// NEAR Intents 1Click

pub struct OriginChain {
    pub key: &'static str,
    pub asset_id: &'static str,
    pub token_address: &'static str,
    pub chain_id: u64,
}

/// USDC origins the web wallet can pay from (verified in the 1Click token list, 5 Oct 2026).
pub const NEAR_ORIGINS: &[OriginChain] = &[
    OriginChain {
        key: "base",
        asset_id: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
        token_address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        chain_id: 8453,
    },
    OriginChain {
        key: "arb",
        asset_id: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near",
        token_address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        chain_id: 42161,
    },
    OriginChain {
        key: "eth",
        asset_id: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near",
        token_address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        chain_id: 1,
    },
];

pub const NEAR_ZEC_ASSET: &str = "nep141:zec.omft.near";

pub struct NearIntents1Click {
    base: String,
    jwt: Option<String>,
    http: reqwest::Client,
}

impl NearIntents1Click {
    pub fn new(base: String, jwt: Option<String>) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .user_agent("payslip/0.1 (+https://github.com/pratikasr/payslip)")
            .build()?;
        Ok(NearIntents1Click {
            base: base.trim_end_matches('/').to_string(),
            jwt,
            http,
        })
    }

    fn req(&self, b: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.jwt {
            Some(t) => b.bearer_auth(t),
            None => b,
        }
    }

    async fn send(&self, b: reqwest::RequestBuilder) -> Result<Value, VenueError> {
        let resp = self
            .req(b)
            .send()
            .await
            .map_err(|e| VenueError::Unavailable(e.to_string()))?;
        let status = resp.status();
        let body: Value = resp
            .json()
            .await
            .map_err(|e| VenueError::Unavailable(format!("invalid response: {e}")))?;
        if status.is_success() {
            Ok(body)
        } else if status.is_server_error() || status.as_u16() == 429 {
            Err(VenueError::Unavailable(format!(
                "HTTP {status}: {}",
                body["message"].as_str().unwrap_or("")
            )))
        } else {
            let msg = body["message"].as_str().unwrap_or("request rejected").to_string();
            let hint = if msg.contains("too low") {
                "Raise the run total: the venue's minimum deposit is about 2 USDC.".to_string()
            } else if msg.contains("recipient") {
                "The treasury address was rejected; it must be a unified address with an Orchard receiver.".to_string()
            } else {
                "Check the amount and addresses, then request a new quote.".to_string()
            };
            Err(VenueError::rejected("venue_rejected", msg, hint))
        }
    }

    /// Maps a 1Click status string to Payslip's funding status.
    pub fn map_status(s: &str) -> &'static str {
        match s {
            "PENDING_DEPOSIT" => "awaiting_deposit",
            "KNOWN_DEPOSIT_TX" => "deposit_seen",
            "PROCESSING" => "processing",
            "SUCCESS" => "success",
            "REFUNDED" => "refunded",
            "FAILED" => "failed",
            "INCOMPLETE_DEPOSIT" => "incomplete",
            _ => "processing",
        }
    }

    fn apply_status(funding: &Funding, body: &Value) -> Funding {
        let mut f = funding.clone();
        let raw = body["status"].as_str().unwrap_or("").to_string();
        f.status = Self::map_status(&raw).into();
        f.venue_status = Some(raw);
        let d = &body["swapDetails"];
        if let Some(arr) = d["destinationChainTxHashes"].as_array() {
            f.delivered_txids = arr
                .iter()
                .filter_map(|h| h["hash"].as_str().map(|s| s.trim_start_matches("0x").to_string()))
                .collect();
        }
        if let Some(amount_in) = d["amountIn"].as_str() {
            // USDC has 6 decimals; 1 USDC is 100 cents.
            if let Ok(units) = amount_in.parse::<u128>() {
                f.funded_usd_cents = u64::try_from(units / 10_000).ok();
            }
        }
        if let Some(reason) = d["refundReason"].as_str() {
            f.refund_reason = Some(reason.to_string());
        }
        f
    }
}

#[async_trait]
impl SwapVenue for NearIntents1Click {
    fn kind(&self) -> VenueKind {
        VenueKind::NearIntents
    }

    async fn indicative_rate_e6(&self) -> Result<u64, VenueError> {
        let tokens = self.send(self.http.get(format!("{}/v0/tokens", self.base))).await?;
        let price = tokens
            .as_array()
            .and_then(|a| a.iter().find(|t| t["assetId"] == NEAR_ZEC_ASSET))
            .and_then(|t| t["price"].as_f64())
            .filter(|p| *p > 0.0)
            .ok_or_else(|| VenueError::Unavailable("ZEC price missing from the token list".into()))?;
        Ok((price * 1_000_000.0).round() as u64)
    }

    async fn quote(&self, req: &QuoteRequest) -> Result<Funding, VenueError> {
        let origin = NEAR_ORIGINS.iter().find(|o| o.key == req.origin_chain).ok_or_else(|| {
            VenueError::rejected(
                "unsupported_origin_chain",
                format!("USDC on {} is not supported.", req.origin_chain),
                "Fund from Base, Arbitrum or Ethereum.",
            )
        })?;
        let refund = req.refund_address.clone().ok_or_else(|| {
            VenueError::rejected(
                "refund_address_required",
                "The venue needs a refund address on the origin chain.",
                "Connect the wallet you will pay from; its address is used for refunds.",
            )
        })?;
        // USDC base units: 6 decimals, so cents * 10^4.
        let base_units = (req.usd_cents as u128) * 10_000;
        let deadline = rfc3339(OffsetDateTime::now_utc() + time::Duration::hours(1));
        let body = json!({
            "dry": false,
            "swapType": "EXACT_INPUT",
            "slippageTolerance": 100,
            "originAsset": origin.asset_id,
            "depositType": "ORIGIN_CHAIN",
            "destinationAsset": NEAR_ZEC_ASSET,
            "amount": base_units.to_string(),
            "refundTo": refund,
            "refundType": "ORIGIN_CHAIN",
            "recipient": req.recipient,
            "recipientType": "DESTINATION_CHAIN",
            "deadline": deadline,
        });
        let resp = self
            .send(self.http.post(format!("{}/v0/quote", self.base)).json(&body))
            .await?;
        let q = &resp["quote"];
        let quoted_zat: u64 = q["amountOut"].as_str().and_then(|s| s.parse().ok()).unwrap_or(0);
        let deposit = q["depositAddress"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| VenueError::Unavailable("quote has no deposit address".into()))?;
        Ok(Funding {
            venue: VenueKind::NearIntents.as_str().into(),
            status: "awaiting_deposit".into(),
            origin_asset: "USDC".into(),
            origin_chain: Some(origin.key.into()),
            token_address: Some(origin.token_address.into()),
            chain_id: Some(origin.chain_id),
            amount_in: q["amountInFormatted"].as_str().unwrap_or("").to_string(),
            amount_in_base_units: base_units.to_string(),
            deposit_address: Some(deposit),
            deadline: q["deadline"].as_str().map(String::from).or(Some(deadline)),
            requested_usd_cents: req.usd_cents,
            quoted_zat,
            quote_rate_e6: money::fill_rate_e6(req.usd_cents, quoted_zat).unwrap_or(0),
            venue_ref: resp["correlationId"].as_str().map(String::from),
            venue_status: Some("PENDING_DEPOSIT".into()),
            ..Default::default()
        })
    }

    async fn status(&self, funding: &Funding) -> Result<Funding, VenueError> {
        let addr = funding
            .deposit_address
            .as_deref()
            .ok_or_else(|| VenueError::Unavailable("no deposit address".into()))?;
        let body = self
            .send(
                self.http
                    .get(format!("{}/v0/status", self.base))
                    .query(&[("depositAddress", addr)]),
            )
            .await?;
        Ok(Self::apply_status(funding, &body))
    }

    async fn submit_deposit(&self, funding: &Funding, tx_hash: &str) -> Result<Funding, VenueError> {
        let addr = funding
            .deposit_address
            .as_deref()
            .ok_or_else(|| VenueError::Unavailable("no deposit address".into()))?;
        let body = self
            .send(
                self.http
                    .post(format!("{}/v0/deposit/submit", self.base))
                    .json(&json!({"txHash": tx_hash, "depositAddress": addr})),
            )
            .await?;
        let mut f = Self::apply_status(funding, &body);
        f.deposit_tx_hash = Some(tx_hash.to_string());
        Ok(f)
    }
}

// ---------------------------------------------------------------------------------------------
// Maya (fallback; quote only from the service, deposit through the Maya router)

pub struct Maya {
    base: String,
    http: reqwest::Client,
}

impl Maya {
    pub fn new(base: String) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder().timeout(Duration::from_secs(30)).build()?;
        Ok(Maya {
            base: base.trim_end_matches('/').to_string(),
            http,
        })
    }
}

#[async_trait]
impl SwapVenue for Maya {
    fn kind(&self) -> VenueKind {
        VenueKind::Maya
    }

    async fn indicative_rate_e6(&self) -> Result<u64, VenueError> {
        let body: Value = self
            .http
            .get("https://midgard.mayachain.info/v2/pool/ZEC.ZEC")
            .send()
            .await
            .map_err(|e| VenueError::Unavailable(e.to_string()))?
            .json()
            .await
            .map_err(|e| VenueError::Unavailable(e.to_string()))?;
        let price: f64 = body["assetPriceUSD"]
            .as_str()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.0);
        if price <= 0.0 {
            return Err(VenueError::Unavailable("ZEC pool price unavailable".into()));
        }
        Ok((price * 1_000_000.0).round() as u64)
    }

    async fn quote(&self, req: &QuoteRequest) -> Result<Funding, VenueError> {
        let from = match req.origin_chain.as_str() {
            "eth" => "ETH.USDC-0XA0B86991C6218B36C1D19D4A2E9EB0CE3606EB48",
            "arb" => "ARB.USDC-0XAF88D065E77C8CC2239327C5EDB3A432268E5831",
            other => {
                return Err(VenueError::rejected(
                    "unsupported_origin_chain",
                    format!("Maya has no USDC pool on {other}."),
                    "Fund from Ethereum (the deepest Maya USDC pool).",
                ))
            }
        };
        // Maya amounts use 8 decimals.
        let amount = (req.usd_cents as u128) * 1_000_000;
        let resp = self
            .http
            .get(format!("{}/mayachain/quote/swap", self.base))
            .query(&[
                ("from_asset", from),
                ("to_asset", "ZEC.ZEC"),
                ("amount", &amount.to_string()),
                ("destination", &req.recipient),
            ])
            .send()
            .await
            .map_err(|e| VenueError::Unavailable(e.to_string()))?;
        let body: Value = resp.json().await.map_err(|e| VenueError::Unavailable(e.to_string()))?;
        if let Some(err) = body["error"].as_str() {
            return Err(VenueError::rejected(
                "venue_rejected",
                err.to_string(),
                "Maya delivers through Sapling; use a unified address with a Sapling receiver.",
            ));
        }
        let quoted_zat: u64 = body["expected_amount_out"]
            .as_str()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        Ok(Funding {
            venue: VenueKind::Maya.as_str().into(),
            status: "awaiting_deposit".into(),
            origin_asset: "USDC".into(),
            origin_chain: Some(req.origin_chain.clone()),
            amount_in: money::format_usd(req.usd_cents),
            amount_in_base_units: amount.to_string(),
            deposit_address: body["inbound_address"].as_str().map(String::from),
            requested_usd_cents: req.usd_cents,
            quoted_zat,
            quote_rate_e6: money::fill_rate_e6(req.usd_cents, quoted_zat).unwrap_or(0),
            venue_ref: body["memo"].as_str().map(String::from),
            venue_status: Some("QUOTED".into()),
            ..Default::default()
        })
    }

    async fn status(&self, funding: &Funding) -> Result<Funding, VenueError> {
        let Some(hash) = funding.deposit_tx_hash.as_deref() else {
            return Ok(funding.clone());
        };
        let body: Value = self
            .http
            .get(format!(
                "{}/mayachain/tx/status/{}",
                self.base,
                hash.trim_start_matches("0x")
            ))
            .send()
            .await
            .map_err(|e| VenueError::Unavailable(e.to_string()))?
            .json()
            .await
            .map_err(|e| VenueError::Unavailable(e.to_string()))?;
        let mut f = funding.clone();
        let done = body["stages"]["outbound_signed"]["completed"]
            .as_bool()
            .unwrap_or(false);
        f.status = if done { "success".into() } else { "processing".into() };
        if let Some(out) = body["out_txs"].as_array() {
            f.delivered_txids = out
                .iter()
                .filter_map(|t| t["id"].as_str().map(|s| s.to_ascii_lowercase()))
                .collect();
        }
        Ok(f)
    }

    async fn submit_deposit(&self, funding: &Funding, tx_hash: &str) -> Result<Funding, VenueError> {
        let mut f = funding.clone();
        f.deposit_tx_hash = Some(tx_hash.to_string());
        f.status = "deposit_seen".into();
        Ok(f)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn near_status_mapping_covers_every_documented_value() {
        for (raw, mapped) in [
            ("PENDING_DEPOSIT", "awaiting_deposit"),
            ("KNOWN_DEPOSIT_TX", "deposit_seen"),
            ("PROCESSING", "processing"),
            ("SUCCESS", "success"),
            ("REFUNDED", "refunded"),
            ("FAILED", "failed"),
            ("INCOMPLETE_DEPOSIT", "incomplete"),
        ] {
            assert_eq!(NearIntents1Click::map_status(raw), mapped);
        }
    }

    #[test]
    fn near_status_extracts_fill() {
        let f = Funding {
            venue: "near-intents-1click".into(),
            deposit_address: Some("0xabc".into()),
            ..Default::default()
        };
        let body = json!({
            "status": "SUCCESS",
            "swapDetails": {
                "amountIn": "28462150000",
                "destinationChainTxHashes": [{"hash": "c3be8e48498c92aaa67361289eec08272f9c74631da3bf8d2bd3529d005db5b2", "explorerUrl": ""}]
            }
        });
        let g = NearIntents1Click::apply_status(&f, &body);
        assert_eq!(g.status, "success");
        assert_eq!(g.funded_usd_cents, Some(2_846_215));
        assert_eq!(
            g.delivered_txids,
            vec!["c3be8e48498c92aaa67361289eec08272f9c74631da3bf8d2bd3529d005db5b2".to_string()]
        );
    }

    #[tokio::test]
    async fn testnet_venue_fills_at_the_fixed_rate() {
        let v = TestnetVenue {
            rate_e6: 1_350_000_000_000,
        };
        let f = v
            .quote(&QuoteRequest {
                usd_cents: 135_000,
                origin_chain: "testnet".into(),
                refund_address: None,
                recipient: "utest1".into(),
            })
            .await
            .unwrap();
        // $1,350.00 at $1,350,000 per TAZ is 0.001 TAZ.
        assert_eq!(f.zec_acquired_zat, Some(100_000));
        assert_eq!(f.status, "success");
    }
}
