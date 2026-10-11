//! Swap venues behind one trait (ADR-005, ADR-015).
//!
//! - [`NearIntents1Click`]: primary. USDC on Base, Arbitrum or Ethereum into native ZEC,
//!   delivered into the Ironwood pool at the treasury's unified address.
//! - [`Maya`]: fallback quote source (Sapling delivery only).
//! - [`TestnetVenue`]: testnet only. Records a fixed rate and draws ZEC from the treasury's
//!   existing testnet balance. The config refuses it on mainnet.
//! - [`TreasuryVenue`]: Fund with ZEC (ADR-025), on any network. The payer sends ZEC to the
//!   treasury address; the run is funded at the market rate of the block in which the
//!   treasury's confirmed balance covers it. Chosen per run with `method: "zec"`, not by
//!   `PAYSLIP_SWAP_VENUE`.

use std::{sync::Arc, time::Duration};

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

use crate::{
    config::{Config, VenueKind},
    money,
    prices::{MarketRate, RateAt},
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
    /// Maya only: the router contract a token deposit goes through
    /// (`depositWithExpiry(deposit_address, asset, amount, deposit_memo, expiry)`).
    #[serde(default)]
    pub router: Option<String>,
    /// Maya only: the memo the deposit must carry, or the swap is not made.
    #[serde(default)]
    pub deposit_memo: Option<String>,
    /// Fund with ZEC only (ADR-025): the treasury unified address the payer sends ZEC to (the
    /// same value as `deposit_address`).
    #[serde(default)]
    pub treasury_address: Option<String>,
    /// Fund with ZEC only: the ZEC asked for at request time (the payroll at the rate then, the
    /// fee reserve and a 2 percent buffer, rounded up). Fixed for the request; the shortfall
    /// says what is still missing at the current rate.
    #[serde(default)]
    pub zec_required_zat: Option<u64>,
    /// Fund with ZEC only: the treasury's confirmed balance available to this run at the last
    /// check (net of what other runs hold a claim on).
    #[serde(default)]
    pub zec_received_zat: Option<u64>,
    /// Fund with ZEC only: ZEC seen in the treasury but not yet confirmed to
    /// `PAYSLIP_MIN_CONFIRMATIONS`.
    #[serde(default)]
    pub zec_pending_zat: Option<u64>,
    /// Fund with ZEC only: what the run still needs at the current rate, 0 once it is funded.
    /// None when the market price could not be read at the last check.
    #[serde(default)]
    pub zec_shortfall_zat: Option<u64>,
    /// Fund with ZEC only: the block at whose rate the run was funded.
    #[serde(default)]
    pub funded_at_height: Option<u32>,
    /// Fund with ZEC only: when the price point behind `rate_usd_per_zec_e6` was taken.
    #[serde(default)]
    pub priced_at: Option<String>,
}

/// A contractor-side conversion of one pay line from ZEC to USDC (ADR-018). Stored as JSON in
/// `pay_lines.settlement_state`.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Conversion {
    pub venue: String,
    /// quoted, processing, success, refunded, failed, simulated
    pub status: String,
    /// Where the pay line's ZEC goes. 1Click issues a transparent address for ZEC input, so
    /// this leg's amount is public (ADR-018).
    pub deposit_address: String,
    pub amount_zat: u64,
    pub payout_chain: String,
    pub payout_address: String,
    pub quoted_out: String,
    pub delivered_out: Option<String>,
    pub delivered_tx: Option<String>,
    pub venue_ref: Option<String>,
    pub simulated: bool,
    pub refund_reason: Option<String>,
    /// Unix seconds of the last status check, to rate-limit polling.
    pub checked_at: Option<i64>,
}

#[derive(Clone, Debug)]
pub struct ConversionRequest {
    pub amount_zat: u64,
    pub payout_chain: String,
    pub payout_address: String,
    /// Where the venue refunds ZEC if it cannot deliver: the contractor's unified address.
    pub refund_to: String,
    /// Testnet only: the transparent address that stands in for the venue's deposit address.
    pub testnet_sink: Option<String>,
}

/// USDC destination assets on 1Click per payout chain (token list, 5 Oct 2026).
pub fn near_usdc_asset(chain: &str) -> Option<&'static str> {
    match chain {
        "base" => Some("nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near"),
        "arb" => Some("nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near"),
        "eth" => Some("nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near"),
        "sol" => Some("nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near"),
        _ => None,
    }
}

#[derive(Clone, Debug)]
pub struct QuoteRequest {
    /// For a swap venue: the USD to deposit, payroll and fee headroom included. For the
    /// treasury venue: the payroll alone; the reserve comes separately in `reserve_zat`.
    pub usd_cents: u64,
    pub origin_chain: String,
    pub refund_address: Option<String>,
    pub recipient: String,
    /// ZEC the run needs on top of its payroll (payment fees, carried change and the allocation
    /// fee), for the venue that draws from the treasury. Swap venues ignore it: their headroom
    /// is already in `usd_cents`.
    pub reserve_zat: u64,
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
    /// Quotes converting one pay line's ZEC into USDC for the contractor.
    async fn quote_conversion(&self, req: &ConversionRequest) -> Result<Conversion, VenueError> {
        let _ = req;
        Err(VenueError::rejected(
            "conversion_unsupported",
            "This venue cannot convert ZEC to USDC.",
            "Use NEAR Intents (PAYSLIP_SWAP_VENUE=near-intents) or set the contractor to Hold ZEC.",
        ))
    }
    /// Refreshes a conversion from the venue.
    async fn conversion_status(&self, c: &Conversion) -> Result<Conversion, VenueError> {
        Ok(c.clone())
    }
}

pub fn build(cfg: &Config) -> anyhow::Result<Arc<dyn SwapVenue>> {
    Ok(match cfg.venue {
        VenueKind::NearIntents => Arc::new(
            NearIntents1Click::new(cfg.near_intents_api_url.clone(), cfg.near_intents_jwt.clone())?
                .with_app_fee(cfg.app_fee_recipient.clone(), cfg.app_fee_bps),
        ),
        VenueKind::Maya => Arc::new(Maya::new(cfg.maya_api_url.clone(), cfg.maya_midgard_url.clone())?),
        VenueKind::TestnetFixedRate => {
            anyhow::ensure!(
                cfg.network == crate::config::ZcashNetwork::Testnet,
                "TestnetVenue requires ZCASH_NETWORK=testnet"
            );
            Arc::new(TestnetVenue {
                rate_e6: cfg.testnet_rate_e6,
            })
        }
        // Not a configured venue: the executor holds it beside the configured one for
        // `method: "zec"` (ADR-025), and `Config::from_env` never produces it.
        VenueKind::Treasury => {
            anyhow::bail!("PAYSLIP_SWAP_VENUE cannot be treasury: Fund with ZEC is a per-run method")
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

    /// Testnet has no USDC venue: the line's ZEC goes to a transparent address the payer owns,
    /// which exercises the same transaction shape as a real conversion, and the outcome is
    /// marked simulated.
    async fn quote_conversion(&self, req: &ConversionRequest) -> Result<Conversion, VenueError> {
        let sink = req.testnet_sink.clone().ok_or_else(|| {
            VenueError::rejected(
                "conversion_unsupported",
                "No testnet conversion address.",
                "Set the contractor to Hold ZEC.",
            )
        })?;
        Ok(Conversion {
            venue: VenueKind::TestnetFixedRate.as_str().into(),
            status: "quoted".into(),
            deposit_address: sink,
            amount_zat: req.amount_zat,
            payout_chain: req.payout_chain.clone(),
            payout_address: req.payout_address.clone(),
            quoted_out: money::format_usd(money::zat_to_usd_cents(req.amount_zat, self.rate_e6)),
            simulated: true,
            ..Default::default()
        })
    }

    async fn conversion_status(&self, c: &Conversion) -> Result<Conversion, VenueError> {
        let mut c = c.clone();
        if c.status == "processing" {
            c.status = "simulated".into();
            c.delivered_out = Some(c.quoted_out.clone());
        }
        Ok(c)
    }
}

// ---------------------------------------------------------------------------------------------
// Fund with ZEC (ADR-025)

/// Headroom over the payroll and the fee reserve, in basis points, so a small price move between
/// the request and the confirmation does not leave the run short.
pub const ZEC_BUFFER_BPS: u64 = 200;
/// How long the payer has to send the ZEC before the request expires.
pub const ZEC_DEADLINE_HOURS: i64 = 24;

/// The venue behind `method: "zec"`: no swap. The payer sends ZEC to the treasury address and
/// the executor (`runs::zec_funding`) funds the run when the treasury's confirmed balance, net of
/// other runs' claims, covers it at the market rate of that block. This venue prices the request
/// and says what to send; it moves nothing. Available on every network.
pub struct TreasuryVenue {
    rates: Arc<dyn MarketRate>,
    deadline: time::Duration,
}

impl TreasuryVenue {
    pub fn new(rates: Arc<dyn MarketRate>) -> Self {
        TreasuryVenue {
            rates,
            deadline: time::Duration::hours(ZEC_DEADLINE_HOURS),
        }
    }

    /// Another deadline than 24 hours (tests use a deadline already in the past).
    pub fn with_deadline(mut self, deadline: time::Duration) -> Self {
        self.deadline = deadline;
        self
    }

    /// ZEC to ask the payer for: the payroll at the rate, the fee reserve, plus the buffer,
    /// rounded up to the zatoshi.
    pub fn required_zat(payroll_zat: u64, reserve_zat: u64) -> u64 {
        let base = payroll_zat as u128 + reserve_zat as u128;
        let with_buffer = base * (10_000 + ZEC_BUFFER_BPS as u128);
        u64::try_from(with_buffer.div_ceil(10_000)).unwrap_or(u64::MAX)
    }

    /// The market rate at `unix`: the price point nearest it, as statements value a payment
    /// received then. Unavailable when the source cannot be reached or has no point near enough.
    pub async fn rate_at(&self, unix: i64) -> Result<RateAt, VenueError> {
        match self.rates.usd_rate_at(unix).await {
            Ok(Some(r)) => Ok(r),
            Ok(None) => Err(VenueError::Unavailable(format!(
                "no ZEC market price within {} minutes of {}",
                crate::prices::DAY_MAX_GAP / 60,
                OffsetDateTime::from_unix_timestamp(unix)
                    .map(rfc3339)
                    .unwrap_or_default()
            ))),
            Err(e) => Err(VenueError::Unavailable(format!("{e:#}"))),
        }
    }
}

#[async_trait]
impl SwapVenue for TreasuryVenue {
    fn kind(&self) -> VenueKind {
        VenueKind::Treasury
    }

    async fn indicative_rate_e6(&self) -> Result<u64, VenueError> {
        Ok(self.rate_at(OffsetDateTime::now_utc().unix_timestamp()).await?.rate_e6)
    }

    /// Prices the request at the current market rate and states the ZEC to send, where to, and
    /// by when. Nothing is reserved yet: the executor's watch does that when the ZEC confirms.
    async fn quote(&self, req: &QuoteRequest) -> Result<Funding, VenueError> {
        let now = OffsetDateTime::now_utc();
        let rate = self.rate_at(now.unix_timestamp()).await?;
        let payroll_zat = money::usd_cents_to_zat(req.usd_cents, rate.rate_e6)
            .filter(|z| *z > 0)
            .ok_or_else(|| VenueError::rejected("invalid_amount", "Amount out of range", "Use a smaller amount."))?;
        let required = Self::required_zat(payroll_zat, req.reserve_zat);
        Ok(Funding {
            venue: VenueKind::Treasury.as_str().into(),
            status: "awaiting_deposit".into(),
            origin_asset: "ZEC".into(),
            amount_in: money::format_zec(required),
            amount_in_base_units: required.to_string(),
            deposit_address: Some(req.recipient.clone()),
            treasury_address: Some(req.recipient.clone()),
            deadline: Some(rfc3339(now + self.deadline)),
            requested_usd_cents: req.usd_cents,
            quoted_zat: required,
            quote_rate_e6: rate.rate_e6,
            rate_usd_per_zec_e6: Some(rate.rate_e6),
            zec_required_zat: Some(required),
            zec_received_zat: Some(0),
            zec_pending_zat: Some(0),
            zec_shortfall_zat: Some(required),
            priced_at: Some(rate.priced_at),
            venue_status: Some("AWAITING_ZEC".into()),
            ..Default::default()
        })
    }

    /// The treasury's balance is the status; the executor reads it (`runs::zec_funding`).
    async fn status(&self, funding: &Funding) -> Result<Funding, VenueError> {
        Ok(funding.clone())
    }

    async fn submit_deposit(&self, _funding: &Funding, _tx_hash: &str) -> Result<Funding, VenueError> {
        Err(VenueError::rejected(
            "deposit_tx_not_needed",
            "This run is funded with ZEC sent straight to the treasury; there is no venue to report a transaction to.",
            "Wait for the ZEC to confirm; the run page follows the treasury balance.",
        ))
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
    /// Payslip's own fee on the funding swap: NEAR account and basis points (ADR-020).
    app_fee: Option<(String, u32)>,
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
            app_fee: None,
        })
    }

    /// Adds an application fee to every funding quote. 1Click deducts it from the deposit, so it
    /// lands in the run's fill rate and USD basis like the venue's own fee.
    pub fn with_app_fee(mut self, recipient: Option<String>, bps: u32) -> Self {
        self.app_fee = recipient.filter(|_| bps > 0).map(|r| (r, bps));
        self
    }

    /// The `appFees` field of a quote request.
    pub fn app_fees_json(&self) -> Value {
        match &self.app_fee {
            Some((recipient, bps)) => json!([{ "recipient": recipient, "fee": bps }]),
            None => json!([]),
        }
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
            "appFees": self.app_fees_json(),
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

    async fn quote_conversion(&self, req: &ConversionRequest) -> Result<Conversion, VenueError> {
        let dest = near_usdc_asset(&req.payout_chain).ok_or_else(|| {
            VenueError::rejected(
                "invalid_payout_chain",
                format!("No USDC route to {}.", req.payout_chain),
                "Choose base, arb, eth or sol.",
            )
        })?;
        let deadline = rfc3339(OffsetDateTime::now_utc() + time::Duration::hours(2));
        let body = json!({
            "dry": false,
            "swapType": "EXACT_INPUT",
            "slippageTolerance": 100,
            "originAsset": NEAR_ZEC_ASSET,
            "depositType": "ORIGIN_CHAIN",
            "destinationAsset": dest,
            "amount": req.amount_zat.to_string(),
            "refundTo": req.refund_to,
            "refundType": "ORIGIN_CHAIN",
            "recipient": req.payout_address,
            "recipientType": "DESTINATION_CHAIN",
            "deadline": deadline,
        });
        let resp = self
            .send(self.http.post(format!("{}/v0/quote", self.base)).json(&body))
            .await?;
        let q = &resp["quote"];
        Ok(Conversion {
            venue: VenueKind::NearIntents.as_str().into(),
            status: "quoted".into(),
            deposit_address: q["depositAddress"]
                .as_str()
                .map(String::from)
                .ok_or_else(|| VenueError::Unavailable("quote has no deposit address".into()))?,
            amount_zat: req.amount_zat,
            payout_chain: req.payout_chain.clone(),
            payout_address: req.payout_address.clone(),
            quoted_out: q["amountOutFormatted"].as_str().unwrap_or("").to_string(),
            venue_ref: resp["correlationId"].as_str().map(String::from),
            ..Default::default()
        })
    }

    async fn conversion_status(&self, c: &Conversion) -> Result<Conversion, VenueError> {
        let body = self
            .send(
                self.http
                    .get(format!("{}/v0/status", self.base))
                    .query(&[("depositAddress", c.deposit_address.as_str())]),
            )
            .await?;
        let mut c = c.clone();
        let raw = body["status"].as_str().unwrap_or("");
        c.status = match Self::map_status(raw) {
            "success" => "success",
            "refunded" => "refunded",
            "failed" => "failed",
            _ => "processing",
        }
        .into();
        let d = &body["swapDetails"];
        if let Some(out) = d["amountOutFormatted"].as_str() {
            c.delivered_out = Some(out.to_string());
        }
        if let Some(h) = d["destinationChainTxHashes"]
            .as_array()
            .and_then(|a| a.first())
            .and_then(|h| h["hash"].as_str())
        {
            c.delivered_tx = Some(h.to_string());
        }
        if let Some(r) = d["refundReason"].as_str() {
            c.refund_reason = Some(r.to_string());
        }
        Ok(c)
    }
}

// ---------------------------------------------------------------------------------------------
// Maya (fallback; quote only from the service, deposit through the Maya router)

pub struct Maya {
    base: String,
    midgard: String,
    http: reqwest::Client,
}

impl Maya {
    pub fn new(base: String, midgard: String) -> anyhow::Result<Self> {
        let http = reqwest::Client::builder().timeout(Duration::from_secs(30)).build()?;
        Ok(Maya {
            base: base.trim_end_matches('/').to_string(),
            midgard: midgard.trim_end_matches('/').to_string(),
            http,
        })
    }

    /// Maps a `/mayachain/tx/status/{hash}` answer onto the funding (verified against mayanode,
    /// 5 Oct 2026): ZEC delivered by out_txs whose memo starts `OUT:`, returned by ones that
    /// start `REFUND:`; done once `stages.outbound_signed.completed`.
    pub fn apply_status(funding: &Funding, body: &Value) -> Funding {
        let mut f = funding.clone();
        let observed = body["stages"]["inbound_observed"]["completed"]
            .as_bool()
            .unwrap_or(false);
        let signed = body["stages"]["outbound_signed"]["completed"]
            .as_bool()
            .unwrap_or(false);
        let outs = body["out_txs"].as_array().cloned().unwrap_or_default();
        let memo_of = |o: &Value| o["memo"].as_str().unwrap_or("").to_ascii_uppercase();
        let delivered: Vec<String> = outs
            .iter()
            .filter(|o| o["chain"].as_str() == Some("ZEC") && memo_of(o).starts_with("OUT:"))
            .filter_map(|o| o["id"].as_str().map(|s| s.to_ascii_lowercase()))
            .collect();
        let refunded = outs.iter().any(|o| memo_of(o).starts_with("REFUND:"));
        f.status = if !observed {
            "deposit_seen"
        } else if signed && !delivered.is_empty() {
            "success"
        } else if signed && refunded {
            "refunded"
        } else {
            "processing"
        }
        .into();
        f.venue_status = Some(
            if signed {
                "OUTBOUND_SIGNED"
            } else if observed {
                "INBOUND_OBSERVED"
            } else {
                "PENDING"
            }
            .into(),
        );
        if !delivered.is_empty() {
            f.delivered_txids = delivered;
        }
        if f.status == "refunded" {
            f.refund_reason = Some("Maya refunded the deposit".into());
        }
        f
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
            .get(format!("{}/v2/pool/ZEC.ZEC", self.midgard))
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
        // The quote's `expiry` (Unix seconds): Maya refuses deposits sent after it.
        let deadline = body["expiry"]
            .as_i64()
            .and_then(|t| OffsetDateTime::from_unix_timestamp(t).ok())
            .map(rfc3339);
        Ok(Funding {
            venue: VenueKind::Maya.as_str().into(),
            status: "awaiting_deposit".into(),
            origin_asset: "USDC".into(),
            origin_chain: Some(req.origin_chain.clone()),
            amount_in: money::format_usd(req.usd_cents),
            amount_in_base_units: amount.to_string(),
            deposit_address: body["inbound_address"].as_str().map(String::from),
            deadline,
            requested_usd_cents: req.usd_cents,
            quoted_zat,
            quote_rate_e6: money::fill_rate_e6(req.usd_cents, quoted_zat).unwrap_or(0),
            venue_ref: body["memo"].as_str().map(String::from),
            venue_status: Some("QUOTED".into()),
            router: body["router"].as_str().map(String::from),
            deposit_memo: body["memo"].as_str().map(String::from),
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
        Ok(Self::apply_status(funding, &body))
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
    fn app_fee_goes_into_the_quote_only_when_configured() {
        let v = NearIntents1Click::new("https://x".into(), None).unwrap();
        assert_eq!(v.app_fees_json(), json!([]));
        let v = v.with_app_fee(Some("payslip.near".into()), 50);
        assert_eq!(v.app_fees_json(), json!([{"recipient": "payslip.near", "fee": 50}]));
        let v = NearIntents1Click::new("https://x".into(), None)
            .unwrap()
            .with_app_fee(Some("payslip.near".into()), 0);
        assert_eq!(v.app_fees_json(), json!([]));
    }

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

    /// Audit SL-24: a Maya swap that was refunded fails the run instead of showing
    /// `processing` for ever; delivery txids are the ZEC `OUT:` transactions only. The shapes
    /// are mayanode `/mayachain/tx/status` answers (5 Oct 2026).
    #[test]
    fn maya_status_maps_delivery_and_refund() {
        let f = Funding {
            venue: "maya".into(),
            status: "deposit_seen".into(),
            deposit_tx_hash: Some("0xabc".into()),
            ..Default::default()
        };
        let stages = |signed: bool| {
            json!({"inbound_observed": {"completed": true}, "swap_finalised": {"completed": true},
                   "outbound_signed": {"completed": signed}})
        };
        let refunded = Maya::apply_status(
            &f,
            &json!({"stages": stages(true), "out_txs": [
                {"id": "B1AE82", "chain": "ETH", "memo": "REFUND:506F45", "to_address": "0xpayer"}]}),
        );
        assert_eq!(refunded.status, "refunded");
        assert!(refunded.delivered_txids.is_empty());
        let delivered = Maya::apply_status(
            &f,
            &json!({"stages": stages(true), "out_txs": [
                {"id": "94E4B9", "chain": "ZEC", "memo": "OUT:506F45", "to_address": "zs1..."}]}),
        );
        assert_eq!(delivered.status, "success");
        assert_eq!(delivered.delivered_txids, vec!["94e4b9".to_string()]);
        let swapping = Maya::apply_status(&f, &json!({"stages": stages(false)}));
        assert_eq!(swapping.status, "processing");
        let unseen = Maya::apply_status(&f, &json!({"stages": {"inbound_observed": {"completed": false}}}));
        assert_eq!(unseen.status, "deposit_seen");
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
                reserve_zat: 0,
            })
            .await
            .unwrap();
        // $1,350.00 at $1,350,000 per TAZ is 0.001 TAZ.
        assert_eq!(f.zec_acquired_zat, Some(100_000));
        assert_eq!(f.status, "success");
    }

    struct FixedRate(u64);

    #[async_trait]
    impl MarketRate for FixedRate {
        async fn usd_rate_at(&self, _unix: i64) -> anyhow::Result<Option<RateAt>> {
            Ok(Some(RateAt {
                rate_e6: self.0,
                priced_at: "2026-10-11T10:10:00Z".into(),
            }))
        }
    }

    /// ADR-025: the ZEC asked for is the payroll at the market rate plus the reserve plus 2
    /// percent, rounded up; the request names the treasury address and a 24-hour deadline.
    #[tokio::test]
    async fn treasury_venue_prices_the_request_with_the_buffer() {
        assert_eq!(TreasuryVenue::required_zat(1_000_000, 50_000), 1_071_000);
        assert_eq!(TreasuryVenue::required_zat(1, 0), 2);
        let v = TreasuryVenue::new(Arc::new(FixedRate(1_234_420_000)));
        let f = v
            .quote(&QuoteRequest {
                usd_cents: 3_038,
                origin_chain: "zcash".into(),
                refund_address: None,
                recipient: "u1treasury".into(),
                reserve_zat: 112_500,
            })
            .await
            .unwrap();
        // $30.38 at $1,234.42 is 2,461,075 zat; plus the reserve, plus 2 percent, rounded up.
        let payroll = money::usd_cents_to_zat(3_038, 1_234_420_000).unwrap();
        assert_eq!(payroll, 2_461_075);
        let required = (payroll + 112_500) * 102 / 100 + 1;
        assert_eq!(f.zec_required_zat, Some(required));
        assert_eq!(f.quoted_zat, required);
        assert_eq!(f.zec_shortfall_zat, Some(required));
        assert_eq!(f.amount_in, money::format_zec(required));
        assert_eq!(f.treasury_address.as_deref(), Some("u1treasury"));
        assert_eq!(f.deposit_address.as_deref(), Some("u1treasury"));
        assert_eq!(f.rate_usd_per_zec_e6, Some(1_234_420_000));
        assert_eq!(f.status, "awaiting_deposit");
        let deadline = OffsetDateTime::parse(f.deadline.as_deref().unwrap(), &Rfc3339).unwrap();
        let hours = (deadline - OffsetDateTime::now_utc()).whole_minutes();
        assert!((23 * 60..=24 * 60).contains(&hours), "{hours} minutes");
        assert!(matches!(
            v.submit_deposit(&f, "abc").await,
            Err(VenueError::Rejected {
                code: "deposit_tx_not_needed",
                ..
            })
        ));
    }
}
