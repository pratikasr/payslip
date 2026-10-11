//! Payroll runs: the state machine and the executor (ADR-017).
//!
//! `draft -> awaiting_funds -> funded -> swapping -> swapped -> allocating -> paying -> paid`,
//! with `failed` reachable from any working state and resumable by executing again.
//!
//! Every step is idempotent and persisted before it has effects outside the process: a
//! transaction is built and stored in the wallet, its txid is written to `payslip.db`, and only
//! then is it broadcast. After a crash the executor finds the txid and rebroadcasts the same
//! transaction instead of paying twice. A transaction that passes its expiry height unmined is
//! rebuilt.

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use async_trait::async_trait;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use time::{format_description::well_known::Rfc3339, Date, OffsetDateTime};
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::{
    config::{Config, VenueKind, ZcashNetwork},
    db::{self, LineRow, Pool, RunRow},
    error::ApiError,
    memo::{AllocationMemo, PayLineMemo, PayslipMemo, Period, RunFundingMemo},
    money,
    payer::{Payer, TREASURY_INDEX},
    prices::MarketRate,
    venue::{Funding, QuoteRequest, SwapVenue, TreasuryVenue, VenueError},
    wallet::SpendError,
};

mod zec_funding;

/// How a run is funded (`POST /api/runs/{id}/fund`, `method`): a USDC deposit swapped by the
/// configured venue (the default, and on testnet the fixed-rate venue), or ZEC sent to the
/// treasury (ADR-025).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FundMethod {
    #[default]
    Usdc,
    Zec,
}

impl FundMethod {
    pub fn parse(s: Option<&str>) -> Result<Self, ApiError> {
        match s.map(|s| s.trim().to_ascii_lowercase()).as_deref() {
            None | Some("") | Some("usdc") => Ok(FundMethod::Usdc),
            Some("zec") => Ok(FundMethod::Zec),
            Some(other) => Err(ApiError::bad_request(
                "invalid_method",
                format!("{other:?} is not a funding method."),
                "Send \"method\": \"zec\" to fund with ZEC sent to the treasury, or \"usdc\" (the default) for a USDC deposit.",
            )),
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            FundMethod::Usdc => "usdc",
            FundMethod::Zec => "zec",
        }
    }
}

/// A funding request from the API.
#[derive(Clone, Debug, Default)]
pub struct FundRequest {
    pub method: FundMethod,
    /// USDC only: the chain the deposit comes from (default base).
    pub origin_chain: Option<String>,
    /// USDC only: where the venue refunds a swap it cannot complete.
    pub refund_address: Option<String>,
}

/// ZIP-317 fee of one pay line transaction: one note in, one output (padded to two actions).
/// Verified on testnet: a one-input, one-output Ironwood transaction paid 10,000 zat.
pub const LINE_FEE_ZAT: u64 = 10_000;
/// ZIP-317 marginal fee per logical action.
pub const MARGINAL_FEE_ZAT: u64 = 5_000;
/// Fee of a converting pay line: one transparent output to the venue plus a padded shielded
/// bundle for the change that carries the memo (three logical actions).
pub const CONVERT_FEE_ZAT: u64 = 15_000;
/// Value left as change on a converting line so a shielded output exists to carry the PS1 memo
/// (the venue's transparent deposit address cannot). It stays in the contractor account.
pub const CHANGE_CARRY_ZAT: u64 = 10_000;

/// True when a line settles by converting to USDC (ADR-018).
pub fn converts(l: &LineRow) -> bool {
    l.settlement_choice == "convert_usdc" && l.payout_address.is_some() && l.payout_chain.is_some()
}

/// Allocation overhead for a line on top of its amount.
pub fn line_overhead_zat(l: &LineRow) -> u64 {
    if converts(l) {
        CONVERT_FEE_ZAT + CHANGE_CARRY_ZAT
    } else {
        LINE_FEE_ZAT
    }
}

/// Venue statuses that mean the deposit has arrived: the run is funded from here on.
fn deposit_received(status: &str) -> bool {
    matches!(status, "deposit_seen" | "processing" | "success")
}

fn conversion_of(l: &LineRow) -> Option<crate::venue::Conversion> {
    l.settlement_state.as_deref().and_then(|s| serde_json::from_str(s).ok())
}

/// Upper estimate of what a run needs on top of its pay lines, for `n` lines of which
/// `converting` convert to USDC: each line's overhead as the allocation funds it (its payment
/// fee, plus the change carry for a converting line, see [`line_overhead_zat`]) and one
/// allocation transaction with n + 1 outputs and up to two extra inputs. This is exactly the
/// overhead `record_fill` checks the treasury against.
pub fn fee_estimate_zat(n: usize, converting: usize) -> u64 {
    let converting = converting.min(n) as u64;
    let held = n as u64 - converting;
    held * LINE_FEE_ZAT + converting * (CONVERT_FEE_ZAT + CHANGE_CARRY_ZAT) + MARGINAL_FEE_ZAT * (n as u64 + 3)
}

/// USD to request from the venue: the payroll plus 1.5 times the overhead estimate at `rate_e6`,
/// rounded up to the cent. Pay lines are converted at the actual fill rate, so the payroll
/// itself is always covered; only the overhead must fit in the headroom. Valued at the fill
/// rate, 1.5 times the estimate still covers it when the venue fee, Payslip's app fee and
/// slippage together take up to a third of the swap. The surplus stays in the treasury and is
/// reported as unspent.
pub fn funding_request_cents(total_usd_cents: u64, n: usize, converting: usize, rate_e6: u64) -> u64 {
    let fee_cents = money::zat_to_usd_cents(fee_estimate_zat(n, converting) * 3 / 2, rate_e6).max(1);
    total_usd_cents + fee_cents + 1
}

/// Minutes after a quote's deadline before Payslip treats it as expired. 1Click refunds a
/// deposit that arrives after the deadline; the grace covers one sent at the last moment.
pub const DEADLINE_GRACE_MINUTES: i64 = 10;

/// A quote still awaiting its deposit after its deadline (plus the grace) is expired: the
/// deposit address is dead and the payer may request a new quote. Any other venue status wins.
pub fn apply_deadline(mut f: Funding, now: OffsetDateTime) -> Funding {
    if f.status == "awaiting_deposit" {
        if let Some(deadline) = f
            .deadline
            .as_deref()
            .and_then(|d| OffsetDateTime::parse(d, &Rfc3339).ok())
        {
            if now > deadline + time::Duration::minutes(DEADLINE_GRACE_MINUTES) {
                f.status = "expired".into();
            }
        }
    }
    f
}

/// Venue statuses after which no money is on its way to the treasury: the quote can be replaced
/// and the run cancelled. (`awaiting_deposit` qualifies only once its deadline passed, which
/// [`apply_deadline`] turns into `expired`.)
fn funding_closed(status: &str) -> bool {
    matches!(status, "expired" | "refunded" | "failed")
}

/// Rebuilds of one transaction that the node refused every time before the run stops with
/// `broadcast_rejected`.
pub const MAX_REJECTED_BUILDS: u32 = 3;

/// Blocks a payment (or an allocation) may wait for spendable funds before the run stops with
/// an error. Longer than a transaction's expiry window (40 blocks by default), because a
/// transaction that expired unmined, for example one built just before a crash, holds its
/// notes until then.
pub const MAX_UNDERFUNDED_BLOCKS: u32 = 120;

/// The node's reason when it refused a transaction, as opposed to not answering.
fn rejection(e: &anyhow::Error) -> Option<String> {
    e.chain()
        .find_map(|c| c.downcast_ref::<crate::wallet::lwd::BroadcastError>())
        .map(|b| b.message.clone())
}

pub fn period_label(period_start: &str) -> String {
    period_start.get(..7).unwrap_or(period_start).to_string()
}

pub fn parse_date(s: &str) -> Option<Date> {
    Date::parse(s, &time::macros::format_description!("[year]-[month]-[day]")).ok()
}

pub fn memo_hash(memo: &str) -> String {
    hex::encode(Sha256::digest(memo.as_bytes()))
}

/// A payment the executor asks the chain to make.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pay {
    pub to: String,
    pub zat: u64,
    pub memo: Option<String>,
}

/// The chain operations the executor needs. The service implements it with the payer wallet;
/// tests implement it with a deterministic in-memory chain.
#[async_trait]
pub trait ChainOps: Send + Sync {
    async fn sync(&self) -> anyhow::Result<()>;
    async fn tip(&self) -> anyhow::Result<u32>;
    async fn spendable(&self, account: u32) -> anyhow::Result<u64>;
    async fn total(&self, account: u32) -> anyhow::Result<u64>;
    async fn account_address(&self, account: u32) -> anyhow::Result<String>;
    async fn transparent_address(&self, account: u32) -> anyhow::Result<String>;
    async fn create_transfer(
        &self,
        from: u32,
        pays: Vec<Pay>,
        change_memo: Option<String>,
    ) -> anyhow::Result<Result<String, SpendError>>;
    async fn broadcast(&self, txid: &str) -> anyhow::Result<()>;
    async fn mined_height(&self, txid: &str) -> anyhow::Result<Option<u32>>;
    async fn expiry_height(&self, txid: &str) -> anyhow::Result<Option<u32>>;
    async fn tx_fee(&self, txid: &str) -> anyhow::Result<Option<u64>>;
    async fn received_in_tx(&self, txid: &str, account: u32) -> anyhow::Result<u64>;
    /// Unix time of the block at `height`: its header time, the time statements show.
    async fn block_time(&self, height: u32) -> anyhow::Result<i64>;
}

pub struct PayerChain(pub Payer);

#[async_trait]
impl ChainOps for PayerChain {
    async fn sync(&self) -> anyhow::Result<()> {
        self.0.sync().await.map(|_| ())
    }
    async fn tip(&self) -> anyhow::Result<u32> {
        self.0.chain_tip().await
    }
    async fn spendable(&self, account: u32) -> anyhow::Result<u64> {
        Ok(self
            .0
            .account_balances()
            .await?
            .get(&account)
            .map(|b| b.spendable_zat)
            .unwrap_or(0))
    }
    async fn total(&self, account: u32) -> anyhow::Result<u64> {
        Ok(self
            .0
            .account_balances()
            .await?
            .get(&account)
            .map(|b| b.total_zat)
            .unwrap_or(0))
    }
    async fn account_address(&self, account: u32) -> anyhow::Result<String> {
        self.0.address(account).await
    }
    async fn transparent_address(&self, account: u32) -> anyhow::Result<String> {
        self.0.transparent_address(account).await
    }
    async fn create_transfer(
        &self,
        from: u32,
        pays: Vec<Pay>,
        change_memo: Option<String>,
    ) -> anyhow::Result<Result<String, SpendError>> {
        let params = self.0.params();
        let mut specs = vec![];
        for p in pays {
            specs.push(crate::wallet::PaymentSpec {
                to: crate::wallet::parse_recipient(&params, &p.to, p.memo.is_none())?,
                amount: zcash_protocol::value::Zatoshis::from_u64(p.zat)
                    .map_err(|_| anyhow::anyhow!("invalid amount {}", p.zat))?,
                memo: p
                    .memo
                    .as_deref()
                    .map(crate::memo::to_memo_bytes)
                    .transpose()
                    .map_err(|e| anyhow::anyhow!("{e}"))?,
            });
        }
        let change = change_memo
            .as_deref()
            .map(crate::memo::to_memo_bytes)
            .transpose()
            .map_err(|e| anyhow::anyhow!("{e}"))?;
        Ok(self
            .0
            .create_transfer(from, specs, change)
            .await?
            .map(|t| crate::wallet::txid_hex(&t)))
    }
    async fn broadcast(&self, txid: &str) -> anyhow::Result<()> {
        self.0.broadcast(crate::wallet::parse_txid(txid)?).await
    }
    async fn mined_height(&self, txid: &str) -> anyhow::Result<Option<u32>> {
        self.0.mined_height(crate::wallet::parse_txid(txid)?).await
    }
    async fn expiry_height(&self, txid: &str) -> anyhow::Result<Option<u32>> {
        self.0.expiry_height(crate::wallet::parse_txid(txid)?).await
    }
    async fn tx_fee(&self, txid: &str) -> anyhow::Result<Option<u64>> {
        self.0.tx_fee(txid).await
    }
    async fn received_in_tx(&self, txid: &str, account: u32) -> anyhow::Result<u64> {
        self.0.received_in_tx(txid, account).await
    }
    async fn block_time(&self, height: u32) -> anyhow::Result<i64> {
        self.0.block_time(height).await
    }
}

// ---------------------------------------------------------------------------------------------
// JSON rendering (docs/API.md)

pub fn line_json(network: ZcashNetwork, l: &LineRow) -> Value {
    let error = l
        .error_code
        .as_ref()
        .map(|c| json!({"code": c, "message": l.error_message, "hint": l.error_hint}));
    json!({
        "id": l.id,
        "contractor_id": l.contractor_id,
        "contractor_name": l.contractor_name,
        "account_index": l.account_index,
        "invoice_ref": l.invoice_ref,
        "amount_usd_cents": l.amount_usd_basis,
        "amount_zat": l.amount_zec,
        "status": l.status,
        "txid": l.txid,
        "confirmed_height": l.confirmed_height,
        "confirmed_at": l.confirmed_at,
        "explorer_url": l.txid.as_ref().map(|t| network.explorer_tx_url(t)),
        "memo": l.memo,
        "settlement_choice": l.settlement_choice,
        "payout_chain": l.payout_chain,
        "settlement": conversion_of(l),
        "error": error,
    })
}

pub fn run_json(network: ZcashNetwork, r: &RunRow, lines: &[LineRow]) -> Value {
    let funding: Option<Value> = r
        .venue_state
        .as_deref()
        .and_then(|s| serde_json::from_str::<Funding>(s).ok())
        .map(|f| {
            let mut v = serde_json::to_value(&f).unwrap_or(Value::Null);
            if let Some(obj) = v.as_object_mut() {
                obj.insert(
                    "funded_usd_cents".into(),
                    json!(r.funding_amount.or(f.funded_usd_cents.map(|x| x as i64))),
                );
                obj.insert(
                    "zec_acquired_zat".into(),
                    json!(r.zec_acquired.or(f.zec_acquired_zat.map(|x| x as i64))),
                );
                obj.insert(
                    "rate_usd_per_zec_e6".into(),
                    json!(r.zec_usd_rate.or(f.rate_usd_per_zec_e6.map(|x| x as i64))),
                );
            }
            v
        });
    let error = r
        .error_code
        .as_ref()
        .map(|c| json!({"code": c, "message": r.error_message, "hint": r.error_hint}));
    let total_usd: i64 = lines.iter().map(|l| l.amount_usd_basis).sum();
    let total_zat: Option<i64> = lines.iter().map(|l| l.amount_zec).sum();
    json!({
        "id": r.id,
        "status": r.status,
        "failed_from": r.failed_from,
        "period_start": r.period_start,
        "period_end": r.period_end,
        "period_label": period_label(&r.period_start),
        "total_usd_cents": total_usd,
        "total_zat": total_zat,
        "funding": funding,
        "allocation_txid": r.allocation_txid,
        "allocation_height": r.allocation_height,
        "allocation_explorer_url": r.allocation_txid.as_ref().map(|t| network.explorer_tx_url(t)),
        "fees_zat": r.fees_zat,
        "lines": lines.iter().map(|l| line_json(network, l)).collect::<Vec<_>>(),
        "error": error,
        "created_at": r.created_at,
        "updated_at": r.updated_at,
    })
}

// ---------------------------------------------------------------------------------------------
// Executor

#[derive(Debug)]
enum Outcome {
    Continue,
    Wait(Duration),
    Done,
}

#[derive(Debug)]
enum StepError {
    /// Retry later; the run stays in its state.
    Transient(String),
    /// Mark the run failed with an actionable error; executing again resumes it.
    Permanent {
        code: String,
        message: String,
        hint: String,
    },
}

fn permanent(code: &str, message: impl Into<String>, hint: impl Into<String>) -> StepError {
    StepError::Permanent {
        code: code.into(),
        message: message.into(),
        hint: hint.into(),
    }
}

impl From<anyhow::Error> for StepError {
    fn from(e: anyhow::Error) -> Self {
        let msg = format!("{e:#}");
        let lower = msg.to_ascii_lowercase();
        if lower.contains("database or disk is full") || lower.contains("no space left") {
            permanent("disk_full", msg, "Free space on the volume holding PAYSLIP_DATA_DIR, then execute the run again; it resumes from its last saved step.")
        } else {
            StepError::Transient(msg)
        }
    }
}

impl From<sqlx::Error> for StepError {
    fn from(e: sqlx::Error) -> Self {
        StepError::from(anyhow::Error::from(e))
    }
}

struct Inner {
    network: ZcashNetwork,
    db: Pool,
    chain: Arc<dyn ChainOps>,
    /// The configured USDC venue (`PAYSLIP_SWAP_VENUE`), behind `method: "usdc"`.
    venue: Arc<dyn SwapVenue>,
    /// Fund with ZEC (ADR-025), behind `method: "zec"` on every network.
    treasury: Arc<TreasuryVenue>,
    /// PAYSLIP_MAX_RUN_USD_CENTS: a run's payroll above it is refused at funding.
    run_cap: Option<u64>,
    running: Mutex<HashSet<String>>,
    changes: broadcast::Sender<String>,
    poll: Duration,
    /// Blocks a payment must be buried under (counting its own) before its line is confirmed.
    confirm_depth: u32,
    /// Per line (or per run, for the allocation): rebuilds whose transaction the node refused.
    /// In memory: a restart only starts the count again.
    rejected_builds: Mutex<HashMap<String, u32>>,
    /// Allocation txids the node refused, with its reason (logged once per transaction).
    rejected_allocations: Mutex<HashMap<String, String>>,
    /// Per line (or per run, for the allocation): the tip when its account first could not cover
    /// the transaction. Cleared when the transaction is built.
    underfunded: Mutex<HashMap<String, u32>>,
    /// After a block time lookup fails, no other is tried before this instant, so reading runs
    /// stays fast while lightwalletd is unreachable.
    block_time_retry_at: Mutex<Option<Instant>>,
}

/// Records the tip at which a shortfall started (if not yet recorded) and returns
/// (blocks it has lasted, whether it just started).
fn shortfall(map: &Mutex<HashMap<String, u32>>, key: &str, tip: u32) -> (u32, bool) {
    let Ok(mut m) = map.lock() else { return (0, true) };
    let mut first = false;
    let start = *m.entry(key.to_string()).or_insert_with(|| {
        first = true;
        tip
    });
    (tip.saturating_sub(start), first)
}

/// Adds one to `key`'s counter and returns the new value.
fn bump(map: &Mutex<HashMap<String, u32>>, key: &str) -> u32 {
    let Ok(mut m) = map.lock() else { return 1 };
    let n = m.entry(key.to_string()).or_insert(0);
    *n += 1;
    *n
}

fn reset(map: &Mutex<HashMap<String, u32>>, key: &str) {
    if let Ok(mut m) = map.lock() {
        m.remove(key);
    }
}

#[derive(Clone)]
pub struct Executor {
    inner: Arc<Inner>,
}

const MAX_TRANSIENT_RETRIES: u32 = 360;

struct RunningGuard {
    exec: Executor,
    run_id: String,
}

impl Drop for RunningGuard {
    fn drop(&mut self) {
        if let Ok(mut running) = self.exec.inner.running.lock() {
            running.remove(&self.run_id);
        }
        self.exec.notify(&self.run_id);
    }
}

impl Executor {
    pub fn new(cfg: Config, db: Pool, payer: Payer, venue: Arc<dyn SwapVenue>, rates: Arc<dyn MarketRate>) -> Self {
        Self::with_chain(
            cfg.network,
            db,
            Arc::new(PayerChain(payer)),
            venue,
            Arc::new(TreasuryVenue::new(rates)),
            Duration::from_secs(10),
            cfg.min_confirmations,
        )
        .with_run_cap(cfg.max_run_usd_cents)
    }

    pub fn with_chain(
        network: ZcashNetwork,
        db: Pool,
        chain: Arc<dyn ChainOps>,
        venue: Arc<dyn SwapVenue>,
        treasury: Arc<TreasuryVenue>,
        poll: Duration,
        confirm_depth: u32,
    ) -> Self {
        let (changes, _) = broadcast::channel(256);
        Executor {
            inner: Arc::new(Inner {
                network,
                db,
                chain,
                venue,
                treasury,
                run_cap: None,
                running: Mutex::new(HashSet::new()),
                changes,
                poll,
                confirm_depth: confirm_depth.max(1),
                rejected_builds: Mutex::new(HashMap::new()),
                rejected_allocations: Mutex::new(HashMap::new()),
                underfunded: Mutex::new(HashMap::new()),
                block_time_retry_at: Mutex::new(None),
            }),
        }
    }

    /// Refuses to fund a run whose payroll is above `cap` cents (PAYSLIP_MAX_RUN_USD_CENTS).
    pub fn with_run_cap(mut self, cap: Option<u64>) -> Self {
        Arc::get_mut(&mut self.inner)
            .expect("with_run_cap is called right after with_chain, before the executor is shared")
            .run_cap = cap;
        self
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.inner.changes.subscribe()
    }

    fn notify(&self, run_id: &str) {
        let _ = self.inner.changes.send(run_id.to_string());
    }

    async fn log(&self, run_id: &str, message: impl AsRef<str>) {
        let m = message.as_ref();
        tracing::info!(run = run_id, "{m}");
        if let Err(e) = db::log_event(&self.inner.db, run_id, m).await {
            tracing::warn!("could not record run event: {e:#}");
        }
        self.notify(run_id);
    }

    pub fn is_running(&self, run_id: &str) -> bool {
        self.inner.running.lock().map(|r| r.contains(run_id)).unwrap_or(false)
    }

    pub async fn run_view(&self, run_id: &str) -> Result<Value, ApiError> {
        let r = db::get_run(&self.inner.db, run_id)
            .await?
            .ok_or_else(|| ApiError::not_found("Run"))?;
        let mut lines = db::lines(&self.inner.db, run_id).await?;
        // Lines confirmed before block times were recorded, or whose lookup failed, get theirs
        // the first time the run is read. A failure here never fails the read.
        if lines
            .iter()
            .any(|l| l.confirmed_height.is_some() && l.confirmed_at.is_none())
        {
            match self.backfill_confirmed_at(Some(run_id)).await {
                Ok(0) => {}
                Ok(_) => lines = db::lines(&self.inner.db, run_id).await?,
                Err(e) => tracing::warn!(run = run_id, "could not record pay line block times: {e:#}"),
            }
        }
        Ok(run_json(self.inner.network, &r, &lines))
    }

    /// Records `confirmed_at` on confirmed lines that have none, of one run or of every run.
    /// Returns how many lines it filled; a height whose time cannot be looked up now is left for
    /// the next read.
    pub async fn backfill_confirmed_at(&self, run_id: Option<&str>) -> anyhow::Result<usize> {
        let db = &self.inner.db;
        let mut times: HashMap<i64, Option<String>> = HashMap::new();
        let mut filled = 0;
        for (line_id, height) in db::lines_missing_confirmed_at(db, run_id).await? {
            let at = match times.get(&height) {
                Some(t) => t.clone(),
                None => {
                    let t = match u32::try_from(height) {
                        Ok(h) => self.confirmed_at(h).await,
                        Err(_) => None,
                    };
                    times.insert(height, t.clone());
                    t
                }
            };
            if let Some(at) = at {
                if db::set_line_confirmed_at(db, &line_id, height, &at).await? {
                    filled += 1;
                }
            }
        }
        Ok(filled)
    }

    /// The block time of `height` as RFC 3339 UTC, formatted as statements format it; None when
    /// it cannot be looked up now (then no lookup is tried for six poll intervals).
    async fn confirmed_at(&self, height: u32) -> Option<String> {
        let paused = self
            .inner
            .block_time_retry_at
            .lock()
            .ok()
            .and_then(|r| *r)
            .is_some_and(|at| Instant::now() < at);
        if paused {
            return None;
        }
        let looked_up = tokio::time::timeout(Duration::from_secs(10), self.inner.chain.block_time(height)).await;
        match looked_up {
            Ok(Ok(t)) => crate::statements::block_time_rfc3339(t),
            failed => {
                let why = match failed {
                    Ok(Err(e)) => format!("{e:#}"),
                    _ => "no answer within 10 seconds".into(),
                };
                tracing::warn!("block time at {height} not available yet: {why}");
                if let Ok(mut r) = self.inner.block_time_retry_at.lock() {
                    *r = Some(Instant::now() + self.inner.poll * 6);
                }
                None
            }
        }
    }

    /// Requests funding from the configured USDC venue (`method: "usdc"`, the default). See
    /// [`Executor::fund_with`].
    pub async fn fund(
        &self,
        run_id: &str,
        origin_chain: Option<String>,
        refund_address: Option<String>,
    ) -> Result<(), ApiError> {
        self.fund_with(
            run_id,
            FundRequest {
                method: FundMethod::Usdc,
                origin_chain,
                refund_address,
            },
        )
        .await
    }

    /// Requests funding. Valid in `draft`, and again for a run that received no money (no fill,
    /// no allocation) once its funding is closed: expired (including a deposit window past its
    /// deadline), refunded or failed. A USDC quote whose deposit address is still open, or whose
    /// deposit is on its way, is never replaced: a deposit already sent to it would then be
    /// tracked by no run. A Fund with ZEC request may be replaced at any time before the run is
    /// funded: ZEC sent to the treasury stays there and counts toward the next request.
    pub async fn fund_with(&self, run_id: &str, req: FundRequest) -> Result<(), ApiError> {
        let db = &self.inner.db;
        let run = db::get_run(db, run_id)
            .await?
            .ok_or_else(|| ApiError::not_found("Run"))?;
        let zec = req.method == FundMethod::Zec;
        // The testnet venue funds at once from the treasury's own balance; a run it funded is
        // not funded again.
        let testnet = !zec && self.inner.venue.kind() == VenueKind::TestnetFixedRate;
        let funding = run
            .venue_state
            .as_deref()
            .and_then(|s| serde_json::from_str::<Funding>(s).ok());
        let set_aside = funding
            .as_ref()
            .is_some_and(|f| f.venue == VenueKind::TestnetFixedRate.as_str() || Self::is_treasury(f));
        match run.status.as_str() {
            "draft" => {}
            "cancelled" => {
                return Err(ApiError::conflict(
                    "run_cancelled",
                    "This run was cancelled.",
                    "Create a new run to pay these contractors.",
                ))
            }
            // `funded` too: the venue saw a deposit, then refunded it.
            "awaiting_funds" | "failed" | "funded"
                if run.funding_amount.is_none()
                    && run.zec_acquired.is_none()
                    && run.allocation_txid.is_none()
                    && !(set_aside && run.status == "funded") =>
            {
                if let Some(f) = &funding {
                    let g = self.current_funding(run_id, f).await?;
                    self.requote_allowed(&g)?;
                }
            }
            "awaiting_funds" | "failed" => {
                return Err(ApiError::conflict(
                    "run_already_funded",
                    "This run already received its ZEC.",
                    "Execute the run again; it resumes from its last saved step.",
                ))
            }
            other => {
                return Err(ApiError::conflict(
                    "run_already_funded",
                    format!("This run is {other}; its funding is complete."),
                    "Open the run to follow its progress.",
                ))
            }
        }
        let lines = db::lines(db, run_id).await?;
        if let Some(l) = lines.iter().find(|l| l.contractor_archived) {
            return Err(ApiError::conflict(
                "contractor_archived",
                format!("{} was archived after this run was created.", l.contractor_name),
                if run.status == "draft" {
                    "Discard this run and create a new one without them."
                } else {
                    "Cancel this run and create a new one without them."
                },
            ));
        }
        let total: u64 = lines.iter().map(|l| l.amount_usd_basis as u64).sum();
        if let Some(cap) = self.inner.run_cap {
            if total > cap {
                return Err(run_over_cap(total, cap));
            }
        }
        let converting = lines.iter().filter(|l| converts(l)).count();
        let recipient = self.inner.chain.account_address(TREASURY_INDEX).await?;
        if zec {
            let quote = self
                .inner
                .treasury
                .quote(&QuoteRequest {
                    usd_cents: total,
                    origin_chain: "zcash".into(),
                    refund_address: None,
                    recipient,
                    reserve_zat: fee_estimate_zat(lines.len(), converting),
                })
                .await
                .map_err(price_api_error)?;
            db::set_venue(
                db,
                run_id,
                &quote.venue,
                &serde_json::to_value(&quote).map_err(anyhow::Error::from)?,
            )
            .await?;
            db::fix_line_payouts(db, run_id).await?;
            db::set_execute_requested(db, run_id, false).await?;
            db::transition(
                db,
                run_id,
                &["draft", "awaiting_funds", "failed", "funded"],
                "awaiting_funds",
            )
            .await?;
            self.log(
                run_id,
                format!(
                    "Fund with ZEC: send {} ZEC to the treasury address {} before {} (1 ZEC = {} USD)",
                    quote.amount_in,
                    quote.treasury_address.clone().unwrap_or_default(),
                    quote.deadline.clone().unwrap_or_default(),
                    money::format_rate(quote.quote_rate_e6)
                ),
            )
            .await;
            // A treasury that already covers the run funds it now; otherwise the answer shows
            // what has arrived so far. A chain that does not answer leaves the request as is.
            if let Some(run) = db::get_run(db, run_id).await? {
                if let Err(e) = self.watch_treasury(&run, &quote, false).await {
                    tracing::warn!(run = run_id, "could not read the treasury balance: {e:#}");
                }
            }
            return Ok(());
        }
        let indicative = match self.inner.venue.indicative_rate_e6().await {
            Ok(r) => r,
            Err(e) => return Err(venue_api_error(e)),
        };
        let request_cents = funding_request_cents(total, lines.len(), converting, indicative);
        if testnet {
            let need = money::usd_cents_to_zat(request_cents, indicative).unwrap_or(u64::MAX);
            self.inner.chain.sync().await.map_err(ApiError::from)?;
            let have = self.inner.chain.spendable(TREASURY_INDEX).await?;
            if have < need {
                return Err(ApiError::conflict(
                    "treasury_insufficient",
                    format!("The testnet treasury holds {} TAZ spendable; this run needs {} TAZ.", money::format_zec(have), money::format_zec(need)),
                    format!("Send at least {} TAZ to the treasury address {recipient} from a testnet faucet, wait for one confirmation, then fund again.", money::format_zec(need - have)),
                ));
            }
        }
        let quote = self
            .inner
            .venue
            .quote(&QuoteRequest {
                usd_cents: request_cents,
                origin_chain: req.origin_chain.unwrap_or_else(|| "base".into()),
                refund_address: req.refund_address,
                recipient,
                reserve_zat: fee_estimate_zat(lines.len(), converting),
            })
            .await
            .map_err(venue_api_error)?;
        db::set_venue(
            db,
            run_id,
            &quote.venue,
            &serde_json::to_value(&quote).map_err(anyhow::Error::from)?,
        )
        .await?;
        // From here on the run pays each contractor the way they were set up now.
        db::fix_line_payouts(db, run_id).await?;
        // A new quote waits for the payer to execute the run again.
        db::set_execute_requested(db, run_id, false).await?;
        let to = if testnet { "funded" } else { "awaiting_funds" };
        db::transition(db, run_id, &["draft", "awaiting_funds", "failed", "funded"], to).await?;
        self.log(
            run_id,
            if testnet {
                format!(
                    "Funded from the testnet treasury at the fixed rate {} USD per TAZ",
                    money::format_rate(quote.quote_rate_e6)
                )
            } else {
                format!(
                    "Quote from {}: deposit {} USDC on {} to {}",
                    quote.venue,
                    quote.amount_in,
                    quote.origin_chain.clone().unwrap_or_default(),
                    quote.deposit_address.clone().unwrap_or_default()
                )
            },
        )
        .await;
        Ok(())
    }

    /// Where a run's funding stands now (deadline applied), stored: the venue's answer for a
    /// USDC quote; for a Fund with ZEC request, the record as it is, expired past its deadline
    /// (the treasury balance is read by [`Executor::watch_treasury`], not here).
    async fn current_funding(&self, run_id: &str, f: &Funding) -> Result<Funding, ApiError> {
        let g = if Self::is_treasury(f) {
            zec_funding::apply_zec_deadline(f.clone(), OffsetDateTime::now_utc())
        } else {
            let g = self.inner.venue.status(f).await.map_err(venue_api_error)?;
            apply_deadline(g, OffsetDateTime::now_utc())
        };
        if &g != f {
            db::set_venue(
                &self.inner.db,
                run_id,
                &g.venue,
                &serde_json::to_value(&g).map_err(anyhow::Error::from)?,
            )
            .await?;
            self.notify(run_id);
        }
        Ok(g)
    }

    /// Whether a quote in state `f` may be replaced (or the run cancelled): only once no money
    /// can still reach the treasury through it. A Fund with ZEC request may always be replaced:
    /// ZEC sent to the treasury stays there, as balance the next request counts.
    fn requote_allowed(&self, f: &Funding) -> Result<(), ApiError> {
        if funding_closed(&f.status) || Self::is_treasury(f) {
            return Ok(());
        }
        Err(match f.status.as_str() {
            "awaiting_deposit" => ApiError::conflict(
                "quote_still_open",
                format!(
                    "The deposit address {} is open until {}.",
                    f.deposit_address.clone().unwrap_or_default(),
                    f.deadline.clone().unwrap_or_else(|| "the venue closes it".into())
                ),
                "Send the deposit to that address, or wait for the quote to expire and request a new one, or cancel the run.",
            ),
            "incomplete" => ApiError::conflict(
                "deposit_in_progress",
                "The venue holds a deposit for this run that is smaller than the quote.",
                "Send the remaining USDC to the same deposit address, or wait for the venue to refund it, then try again.",
            ),
            other => ApiError::conflict(
                "deposit_in_progress",
                format!("The venue has a deposit for this run ({other}); its ZEC is on the way to the treasury."),
                "Wait for the swap to finish, then execute the run.",
            ),
        })
    }

    /// Cancels a run that received no money: no fill recorded and no allocation built, and no
    /// deposit at the venue that could still reach the treasury. The run stays on record with
    /// status `cancelled` and no longer counts as active.
    pub async fn cancel(&self, run_id: &str) -> Result<(), ApiError> {
        let db = &self.inner.db;
        let run = db::get_run(db, run_id)
            .await?
            .ok_or_else(|| ApiError::not_found("Run"))?;
        if run.status == "cancelled" {
            return Ok(());
        }
        let has_money = run.funding_amount.is_some() || run.zec_acquired.is_some() || run.allocation_txid.is_some();
        if has_money || !matches!(run.status.as_str(), "draft" | "awaiting_funds" | "funded" | "failed") {
            return Err(ApiError::conflict(
                "run_has_funds",
                format!(
                    "This run is {} and has received ZEC, so it cannot be cancelled.",
                    run.status
                ),
                "Execute the run to finish paying it; a run that received money stays on record.",
            ));
        }
        if let Some(f) = run
            .venue_state
            .as_deref()
            .and_then(|s| serde_json::from_str::<Funding>(s).ok())
        {
            // The testnet venue moves nothing: its "success" is the treasury's own balance, and
            // ZEC sent for a Fund with ZEC request stays in the treasury either way. An open
            // USDC deposit address may be abandoned; a deposit the venue already holds may not.
            if f.venue != VenueKind::TestnetFixedRate.as_str() && !Self::is_treasury(&f) {
                let g = self.current_funding(run_id, &f).await?;
                if g.status != "awaiting_deposit" {
                    self.requote_allowed(&g)?;
                }
            }
        }
        if !db::cancel_run(db, run_id, &["draft", "awaiting_funds", "funded", "failed"]).await? {
            return Err(ApiError::conflict(
                "run_has_funds",
                "This run changed while it was being cancelled and may have received ZEC.",
                "Open the run to see its state.",
            ));
        }
        self.log(
            run_id,
            if run.status == "awaiting_funds" && !Self::is_treasury_run(&run) {
                "Run cancelled by the payer. A deposit sent to its old address after this still reaches the treasury as unassigned balance."
            } else if run.status == "awaiting_funds" {
                "Run cancelled by the payer. ZEC sent to the treasury for it stays there as balance for the next run."
            } else {
                "Run cancelled by the payer"
            },
        )
        .await;
        Ok(())
    }

    /// Polls the venue once and stores the result. For a Fund with ZEC request, reads the
    /// treasury balance instead and funds the run when it covers it.
    pub async fn refresh_funding(&self, run_id: &str) -> Result<(), ApiError> {
        let db = &self.inner.db;
        let run = db::get_run(db, run_id)
            .await?
            .ok_or_else(|| ApiError::not_found("Run"))?;
        let Some(f) = run
            .venue_state
            .as_deref()
            .and_then(|s| serde_json::from_str::<Funding>(s).ok())
        else {
            return Err(ApiError::conflict(
                "not_funded",
                "This run has no funding request yet.",
                "Fund the run first.",
            ));
        };
        if Self::is_treasury(&f) {
            if run.status == "awaiting_funds" {
                self.watch_treasury(&run, &f, false).await.map_err(ApiError::from)?;
            }
            return Ok(());
        }
        if matches!(run.status.as_str(), "awaiting_funds" | "funded" | "swapping") {
            let g = self.inner.venue.status(&f).await.map_err(venue_api_error)?;
            // Past the deadline the deposit address is dead: say so instead of offering it.
            let g = apply_deadline(g, OffsetDateTime::now_utc());
            let mut changed = false;
            if g != f {
                db::set_venue(
                    db,
                    run_id,
                    &g.venue,
                    &serde_json::to_value(&g).map_err(anyhow::Error::from)?,
                )
                .await?;
                changed = true;
            }
            // Funded as soon as the venue has the deposit, whichever status a poll happens to see
            // (a 5-second poll can miss the brief deposit_seen, and the web wallet's own report
            // stores deposit_seen before any poll).
            if deposit_received(&g.status) && db::transition(db, run_id, &["awaiting_funds"], "funded").await? {
                changed = true;
            }
            // A deposit the venue then refunded (or a swap that failed) leaves the run unfunded
            // again, ready for a new quote, unless the fill was already recorded.
            if funding_closed(&g.status)
                && run.funding_amount.is_none()
                && db::transition(db, run_id, &["funded"], "awaiting_funds").await?
            {
                changed = true;
            }
            if changed {
                self.notify(run_id);
            }
        }
        Ok(())
    }

    pub async fn submit_deposit(&self, run_id: &str, tx_hash: &str) -> Result<(), ApiError> {
        let db = &self.inner.db;
        let run = db::get_run(db, run_id)
            .await?
            .ok_or_else(|| ApiError::not_found("Run"))?;
        let Some(f) = run
            .venue_state
            .as_deref()
            .and_then(|s| serde_json::from_str::<Funding>(s).ok())
        else {
            return Err(ApiError::conflict(
                "not_funded",
                "This run has no funding request yet.",
                "Fund the run first.",
            ));
        };
        if run.status == "cancelled" {
            return Err(ApiError::conflict(
                "run_cancelled",
                "This run was cancelled.",
                "Create a new run; a deposit to the cancelled run's address reaches the treasury unassigned.",
            ));
        }
        let g = self
            .venue_of(&f)
            .submit_deposit(&f, tx_hash)
            .await
            .map_err(venue_api_error)?;
        db::set_venue(
            db,
            run_id,
            &g.venue,
            &serde_json::to_value(&g).map_err(anyhow::Error::from)?,
        )
        .await?;
        if deposit_received(&g.status) {
            db::transition(db, run_id, &["awaiting_funds"], "funded").await?;
        }
        self.log(run_id, format!("Deposit transaction {tx_hash} reported to the venue"))
            .await;
        self.notify(run_id);
        Ok(())
    }

    /// Polls the venue for converting lines whose payment confirmed. At most every 15 seconds
    /// per line; called when a run is viewed, so conversions finish after the run is paid.
    pub async fn refresh_conversions(&self, run_id: &str) -> Result<(), ApiError> {
        let db = &self.inner.db;
        let now = OffsetDateTime::now_utc().unix_timestamp();
        for l in db::lines(db, run_id).await? {
            let Some(c) = conversion_of(&l) else { continue };
            if l.status != "confirmed" || c.status != "processing" || c.checked_at.is_some_and(|t| now - t < 15) {
                continue;
            }
            let mut next = match self.inner.venue.conversion_status(&c).await {
                Ok(n) => n,
                Err(_) => c.clone(),
            };
            next.checked_at = Some(now);
            db::set_settlement(db, &l.id, &serde_json::to_value(&next).map_err(anyhow::Error::from)?).await?;
            if next.status != c.status {
                self.log(run_id, format!("Conversion for {}: {}", l.contractor_name, next.status))
                    .await;
            }
        }
        Ok(())
    }

    /// Starts (or resumes) the executor for a run. A second call while it runs is a no-op.
    pub async fn start(&self, run_id: &str) -> Result<(), ApiError> {
        let db = &self.inner.db;
        let run = db::get_run(db, run_id)
            .await?
            .ok_or_else(|| ApiError::not_found("Run"))?;
        match run.status.as_str() {
            "draft" => {
                return Err(ApiError::conflict(
                    "not_funded",
                    "The run has not been funded.",
                    "Fund the run first, then execute it.",
                ))
            }
            "paid" => return Ok(()),
            "cancelled" => {
                return Err(ApiError::conflict(
                    "run_cancelled",
                    "This run was cancelled.",
                    "Create a new run to pay these contractors.",
                ))
            }
            "failed" => {
                let back = run.failed_from.clone().unwrap_or_else(|| "funded".into());
                db::transition(db, run_id, &["failed"], &back).await?;
                self.log(run_id, format!("Resuming from {back}")).await;
            }
            _ => {}
        }
        // Remembered so a restart resumes this run, and only runs the payer executed.
        db::set_execute_requested(db, run_id, true).await?;
        self.spawn(run_id.to_string());
        Ok(())
    }

    fn spawn(&self, run_id: String) {
        {
            let Ok(mut running) = self.inner.running.lock() else {
                return;
            };
            if !running.insert(run_id.clone()) {
                return;
            }
        }
        let this = self.clone();
        tokio::spawn(async move {
            // Clears the running flag even if the step panics, so the run can be executed again.
            let _guard = RunningGuard {
                exec: this.clone(),
                run_id: run_id.clone(),
            };
            this.drive(&run_id).await;
        });
    }

    /// Restarts every run that was executing when the service stopped. A run waiting for its
    /// deposit, or funded, resumes only if the payer had executed it: funding alone never pays.
    pub async fn resume_all(&self) {
        let Ok(runs) = db::list_runs(&self.inner.db).await else {
            return;
        };
        for r in runs {
            let resume = match r.status.as_str() {
                // Only the executor reaches these.
                "swapping" | "swapped" | "allocating" | "paying" => true,
                "awaiting_funds" | "funded" => r.execute_requested,
                _ => false,
            };
            if resume {
                tracing::info!("resuming run {} in {}", r.id, r.status);
                self.spawn(r.id);
            }
        }
    }

    /// Drives a run until it is paid, fails, or waits on the payer.
    pub async fn drive(&self, run_id: &str) {
        let mut transient = 0u32;
        loop {
            match self.step(run_id).await {
                Ok(Outcome::Continue) => {
                    transient = 0;
                    self.notify(run_id);
                }
                Ok(Outcome::Wait(d)) => {
                    transient = 0;
                    self.notify(run_id);
                    tokio::time::sleep(d).await;
                }
                Ok(Outcome::Done) => return,
                Err(StepError::Transient(msg)) => {
                    transient += 1;
                    self.log(run_id, format!("Retrying after a temporary error: {msg}"))
                        .await;
                    if transient >= MAX_TRANSIENT_RETRIES {
                        let _ = db::fail_run(&self.inner.db, run_id, "retries_exhausted", &msg, "Check lightwalletd and the venue, then execute the run again; it resumes from its last saved step.").await;
                        self.log(run_id, "Run paused after repeated temporary errors").await;
                        return;
                    }
                    tokio::time::sleep(self.inner.poll.min(Duration::from_secs(5)) * transient.min(6)).await;
                }
                Err(StepError::Permanent { code, message, hint }) => {
                    let _ = db::fail_run(&self.inner.db, run_id, &code, &message, &hint).await;
                    self.log(run_id, format!("Run failed: {message}")).await;
                    return;
                }
            }
        }
    }

    async fn step(&self, run_id: &str) -> Result<Outcome, StepError> {
        let run = db::get_run(&self.inner.db, run_id)
            .await?
            .ok_or_else(|| permanent("not_found", "Run not found", "Check the run id."))?;
        match run.status.as_str() {
            "awaiting_funds" | "funded" | "swapping" => self.step_funding(&run).await,
            "swapped" => self.step_allocate(&run).await,
            "allocating" => self.step_allocating(&run).await,
            "paying" => self.step_paying(&run).await,
            "draft" => Err(permanent(
                "not_funded",
                "The run has not been funded.",
                "Fund the run first.",
            )),
            _ => Ok(Outcome::Done),
        }
    }

    async fn step_funding(&self, run: &RunRow) -> Result<Outcome, StepError> {
        let db = &self.inner.db;
        let poll = self.inner.poll;
        let f: Funding = run
            .venue_state
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .ok_or_else(|| permanent("not_funded", "The run has no funding request.", "Fund the run first."))?;
        if Self::is_treasury(&f) {
            return self.step_zec_funding(run, &f).await;
        }
        let f = match self.inner.venue.status(&f).await {
            Ok(g) => {
                let g = apply_deadline(g, OffsetDateTime::now_utc());
                if g != f {
                    db::set_venue(
                        db,
                        &run.id,
                        &g.venue,
                        &serde_json::to_value(&g).map_err(anyhow::Error::from)?,
                    )
                    .await?;
                }
                g
            }
            Err(VenueError::Unavailable(m)) => return Err(StepError::Transient(m)),
            Err(VenueError::Rejected { code, message, hint }) => return Err(permanent(code, message, hint)),
        };
        match f.status.as_str() {
            "awaiting_deposit" => Ok(Outcome::Wait(poll)),
            "deposit_seen" => {
                if db::transition(db, &run.id, &["awaiting_funds"], "funded").await? {
                    self.log(&run.id, "Deposit detected by the venue").await;
                }
                Ok(Outcome::Wait(poll))
            }
            "processing" => {
                if db::transition(db, &run.id, &["awaiting_funds", "funded"], "swapping").await? {
                    self.log(&run.id, "Venue is swapping USDC to ZEC").await;
                }
                Ok(Outcome::Wait(poll))
            }
            "success" => self.record_fill(run, &f).await,
            "refunded" => Err(permanent(
                "venue_refunded",
                format!(
                    "The venue refunded the deposit{}.",
                    f.refund_reason.map(|r| format!(": {r}")).unwrap_or_default()
                ),
                "The USDC went back to the refund address. Fund the run again for a new quote, or cancel it.",
            )),
            "incomplete" => Err(permanent(
                "deposit_incomplete",
                "The deposit was smaller than the quote required.",
                "Send the remaining USDC to the same deposit address and execute the run again, or wait for the venue's refund, then fund the run again or cancel it.",
            )),
            "expired" => Err(permanent(
                "funding_expired",
                "The quote expired before a deposit arrived.",
                "Fund the run again to get a fresh quote and deposit address, or cancel it.",
            )),
            _ => Err(permanent(
                "venue_failed",
                "The venue reported that the swap failed.",
                "Check the venue's explorer for the deposit, then fund the run again or cancel it.",
            )),
        }
    }

    /// The venue filled: measure the ZEC that actually arrived, fix the rate and line amounts.
    /// The testnet venue and a Fund with ZEC request fixed their figures when they funded the
    /// run; those are recorded as they are.
    async fn record_fill(&self, run: &RunRow, f: &Funding) -> Result<Outcome, StepError> {
        let db = &self.inner.db;
        let chain = &self.inner.chain;
        let treasury = Self::is_treasury(f);
        if db::transition(db, &run.id, &["awaiting_funds", "funded"], "swapping").await? {
            self.log(
                &run.id,
                if treasury {
                    "Treasury balance covers the run; recording the funding"
                } else {
                    "Venue reports the swap complete"
                },
            )
            .await;
        }
        // The run may have been cancelled meanwhile; the next step reads its status again.
        if db::get_run(db, &run.id).await?.map(|r| r.status).as_deref() != Some("swapping") {
            return Ok(Outcome::Continue);
        }
        let testnet = f.venue == VenueKind::TestnetFixedRate.as_str() || treasury;
        let (funded_cents, acquired) = if testnet {
            (
                f.funded_usd_cents.unwrap_or(f.requested_usd_cents),
                f.zec_acquired_zat.unwrap_or(f.quoted_zat),
            )
        } else {
            if f.delivered_txids.is_empty() {
                return Ok(Outcome::Wait(self.inner.poll));
            }
            chain.sync().await?;
            let mut got = 0u64;
            for t in &f.delivered_txids {
                got += chain.received_in_tx(t, TREASURY_INDEX).await?;
            }
            if got == 0 {
                return Ok(Outcome::Wait(self.inner.poll));
            }
            (f.funded_usd_cents.unwrap_or(f.requested_usd_cents), got)
        };
        let fill = money::fill_rate_e6(funded_cents, acquired).ok_or_else(|| {
            permanent(
                "invalid_fill",
                "The venue reported an empty fill.",
                "Check the venue's status page for this deposit, then execute the run again.",
            )
        })?;
        // The testnet venue's contract is a fixed rate, and a Fund with ZEC request fixed the
        // market rate of its funding block: record it exactly, not the rounded ratio.
        let rate = if testnet {
            f.rate_usd_per_zec_e6.unwrap_or(fill)
        } else {
            fill
        };
        db::set_fill(db, &run.id, funded_cents, acquired, rate).await?;
        let lines = db::lines(db, &run.id).await?;
        let period = Period::parse(&period_label(&run.period_start))
            .ok_or_else(|| permanent("invalid_period", "The run period is invalid.", "Create a new run."))?;
        let run_uuid = Uuid::parse_str(&run.id).map_err(|e| anyhow::anyhow!(e))?;
        let mut need = MARGINAL_FEE_ZAT * (lines.len() as u64 + 3);
        for l in &lines {
            let zat = money::usd_cents_to_zat(l.amount_usd_basis as u64, rate)
                .filter(|z| *z > 0)
                .ok_or_else(|| {
                    permanent(
                        "invalid_amount",
                        format!(
                            "{}'s amount converts to no whole number of zatoshis at the fill rate {} USD per ZEC.",
                            l.contractor_name,
                            money::format_rate(rate)
                        ),
                        "Check the fill rate in the run log against the market; the ZEC stays in the treasury. Fix the venue setting (PAYSLIP_TESTNET_RATE_USD on testnet), then execute the run again.",
                    )
                })?;
            let memo = PayslipMemo::PayLine(PayLineMemo {
                run_id: run_uuid,
                period,
                invoice_ref: l.invoice_ref.clone(),
                usd_basis_cents: l.amount_usd_basis as u64,
                rate_e6: rate,
            })
            .encode()
            .map_err(|e| {
                permanent(
                    "memo_invalid",
                    e.to_string(),
                    "Shorten the invoice reference and create the run again.",
                )
            })?;
            let overhead = line_overhead_zat(l);
            db::set_line_amount(db, &l.id, zat, overhead, &memo, &memo_hash(&memo)).await?;
            need += zat + overhead;
        }
        let total = chain.total(TREASURY_INDEX).await?;
        if total < need {
            return Err(permanent(
                "treasury_insufficient",
                format!(
                    "The treasury holds {} ZEC but the run needs {} ZEC.",
                    money::format_zec(total),
                    money::format_zec(need)
                ),
                "Top up the treasury address, then execute the run again.",
            ));
        }
        let spendable = chain.spendable(TREASURY_INDEX).await?;
        if spendable < need {
            self.log(
                &run.id,
                format!(
                    "Waiting for treasury confirmations ({} of {} ZEC spendable)",
                    money::format_zec(spendable),
                    money::format_zec(need)
                ),
            )
            .await;
            return Ok(Outcome::Wait(self.inner.poll));
        }
        if db::transition(db, &run.id, &["swapping"], "swapped").await? {
            self.log(
                &run.id,
                format!(
                    "Filled: {} ZEC for {} USD at {} USD per ZEC",
                    money::format_zec(acquired),
                    money::format_usd(funded_cents),
                    money::format_rate(rate)
                ),
            )
            .await;
        }
        Ok(Outcome::Continue)
    }

    /// Logs a failed allocation broadcast. A refusal by the node is remembered (and logged once
    /// per transaction) so its expiry counts towards `broadcast_rejected`; no answer is retried.
    async fn allocation_broadcast_failed(&self, run_id: &str, txid: &str, e: &anyhow::Error) {
        match rejection(e) {
            Some(reason) => {
                let first = self
                    .inner
                    .rejected_allocations
                    .lock()
                    .map(|mut m| m.insert(txid.to_string(), reason.clone()).is_none())
                    .unwrap_or(false);
                if first {
                    self.log(
                        run_id,
                        format!(
                            "The node refused the allocation transaction: {reason}. It is rebuilt when it expires."
                        ),
                    )
                    .await;
                }
            }
            None => {
                self.log(run_id, format!("Allocation broadcast will be retried: {e:#}"))
                    .await
            }
        }
    }

    /// Network fees of the run's mined transactions: the allocation once mined and each
    /// confirmed payment. Fees of transactions that expired unmined were never paid.
    async fn record_fees(&self, run_id: &str) -> Result<(), StepError> {
        let db = &self.inner.db;
        let chain = &self.inner.chain;
        let Some(run) = db::get_run(db, run_id).await? else {
            return Ok(());
        };
        let mut total = 0u64;
        if let (Some(t), Some(_)) = (&run.allocation_txid, run.allocation_height) {
            total += chain.tx_fee(t).await?.unwrap_or(0);
        }
        for l in db::lines(db, run_id).await? {
            if let (Some(t), "confirmed") = (&l.txid, l.status.as_str()) {
                total += chain.tx_fee(t).await?.unwrap_or(0);
            }
        }
        db::set_fees(db, run_id, total).await?;
        Ok(())
    }

    /// Records the node's refusal of a line's payment on the line (status unchanged), once per
    /// transaction, so the payer sees why it is not confirming.
    async fn line_rejected(&self, run_id: &str, l: &LineRow, flagged: bool, reason: &str) -> Result<(), StepError> {
        if flagged {
            return Ok(());
        }
        db::fail_line(
            &self.inner.db,
            &l.id,
            "broadcast_rejected",
            &format!("The node refused this payment: {reason}"),
            "Payslip rebuilds the payment when it expires. If the node keeps refusing it, check LIGHTWALLETD_URL and the service log.",
        )
        .await?;
        self.log(
            run_id,
            format!(
                "The node refused the payment to {}: {reason}. It is rebuilt when it expires.",
                l.contractor_name
            ),
        )
        .await;
        Ok(())
    }

    async fn step_allocate(&self, run: &RunRow) -> Result<Outcome, StepError> {
        let db = &self.inner.db;
        let chain = &self.inner.chain;
        if run.allocation_txid.is_some() {
            db::transition(db, &run.id, &["swapped"], "allocating").await?;
            return Ok(Outcome::Continue);
        }
        let lines = db::lines(db, &run.id).await?;
        let mut pays = vec![];
        for l in &lines {
            let zat = l
                .amount_zec
                .ok_or_else(|| permanent("missing_amount", "A line has no ZEC amount.", "Execute the run again."))?
                as u64;
            pays.push(Pay {
                to: chain.account_address(l.account_index as u32).await?,
                zat: zat + l.fee_zat.unwrap_or(LINE_FEE_ZAT as i64) as u64,
                memo: Some(
                    PayslipMemo::Allocation(AllocationMemo {
                        run_id: Uuid::parse_str(&run.id).map_err(|e| anyhow::anyhow!(e))?,
                    })
                    .encode()
                    .map_err(|e| anyhow::anyhow!("{e}"))?,
                ),
            });
        }
        let change_memo = PayslipMemo::RunFunding(RunFundingMemo {
            run_id: Uuid::parse_str(&run.id).map_err(|e| anyhow::anyhow!(e))?,
            period: Period::parse(&period_label(&run.period_start)).ok_or_else(|| anyhow::anyhow!("invalid period"))?,
            funded_usd_cents: run.funding_amount.unwrap_or(0) as u64,
            zec_acquired_zat: run.zec_acquired.unwrap_or(0) as u64,
            rate_e6: run.zec_usd_rate.unwrap_or(0) as u64,
        })
        .encode()
        .map_err(|e| permanent("memo_invalid", e.to_string(), "Execute the run again."))?;
        match chain.create_transfer(TREASURY_INDEX, pays, Some(change_memo)).await? {
            Ok(txid) => {
                reset(&self.inner.underfunded, &run.id);
                db::set_allocation(db, &run.id, Some(&txid), None).await?;
                db::transition(db, &run.id, &["swapped"], "allocating").await?;
                self.log(&run.id, format!("Allocation transaction built: {txid}")).await;
                match chain.broadcast(&txid).await {
                    Ok(()) => self.log(&run.id, "Allocation transaction broadcast").await,
                    Err(e) => self.allocation_broadcast_failed(&run.id, &txid, &e).await,
                }
                Ok(Outcome::Continue)
            }
            Err(SpendError::SyncRequired) => {
                chain.sync().await?;
                Ok(Outcome::Continue)
            }
            Err(SpendError::InsufficientFunds { available, required }) => {
                // Not even counting unconfirmed value does the treasury hold enough: another run
                // took it. Waiting would never end.
                let total = chain.total(TREASURY_INDEX).await?;
                if total < required {
                    reset(&self.inner.underfunded, &run.id);
                    return Err(permanent(
                        "treasury_insufficient",
                        format!(
                            "The treasury holds {} ZEC but the allocation needs {} ZEC; another run may have used it.",
                            money::format_zec(total),
                            money::format_zec(required)
                        ),
                        "Top up the treasury address, then execute the run again.",
                    ));
                }
                let t = chain.tip().await?;
                let (waited, first) = shortfall(&self.inner.underfunded, &run.id, t);
                if first {
                    self.log(
                        &run.id,
                        format!(
                            "Waiting for spendable treasury funds ({} of {} ZEC)",
                            money::format_zec(available),
                            money::format_zec(required)
                        ),
                    )
                    .await;
                }
                if waited >= MAX_UNDERFUNDED_BLOCKS {
                    reset(&self.inner.underfunded, &run.id);
                    return Err(permanent(
                        "treasury_insufficient",
                        format!(
                            "The treasury has had only {} of {} ZEC spendable for {MAX_UNDERFUNDED_BLOCKS} blocks.",
                            money::format_zec(available),
                            money::format_zec(required)
                        ),
                        "Sync the wallet (POST /api/wallet/sync), check the treasury balance, then execute the run again.",
                    ));
                }
                chain.sync().await?;
                Ok(Outcome::Wait(self.inner.poll))
            }
            Err(SpendError::Other(m)) => Err(permanent(
                "allocation_failed",
                m,
                "Check the service log; execute the run again to retry.",
            )),
        }
    }

    async fn step_allocating(&self, run: &RunRow) -> Result<Outcome, StepError> {
        let db = &self.inner.db;
        let chain = &self.inner.chain;
        let Some(txid) = run.allocation_txid.clone() else {
            db::transition(db, &run.id, &["allocating"], "swapped").await?;
            return Ok(Outcome::Continue);
        };
        match chain.mined_height(&txid).await? {
            None => {
                let tip = chain.tip().await?;
                if let Some(exp) = chain.expiry_height(&txid).await?.filter(|e| *e != 0) {
                    if tip > exp {
                        let refused = self
                            .inner
                            .rejected_allocations
                            .lock()
                            .ok()
                            .and_then(|mut m| m.remove(&txid));
                        if let Some(reason) = refused {
                            if bump(&self.inner.rejected_builds, &run.id) >= MAX_REJECTED_BUILDS {
                                reset(&self.inner.rejected_builds, &run.id);
                                return Err(permanent(
                                    "broadcast_rejected",
                                    format!("The node refused the allocation transaction {MAX_REJECTED_BUILDS} times: {reason}"),
                                    "Check LIGHTWALLETD_URL points at a node on the current network upgrade and the service log, then execute the run again.",
                                ));
                            }
                        }
                        chain.sync().await?;
                        db::set_allocation(db, &run.id, None, None).await?;
                        db::transition(db, &run.id, &["allocating"], "swapped").await?;
                        self.log(
                            &run.id,
                            format!(
                                "Allocation {txid} expired unmined at {}; rebuilding",
                                money::format_count(exp.into())
                            ),
                        )
                        .await;
                        return Ok(Outcome::Continue);
                    }
                }
                match chain.broadcast(&txid).await {
                    Ok(()) => {
                        if let Ok(mut m) = self.inner.rejected_allocations.lock() {
                            m.remove(&txid);
                        }
                    }
                    Err(e) => self.allocation_broadcast_failed(&run.id, &txid, &e).await,
                }
                Ok(Outcome::Wait(self.inner.poll))
            }
            Some(h) => {
                if run.allocation_height.is_none() {
                    db::set_allocation(db, &run.id, Some(&txid), Some(h)).await?;
                    reset(&self.inner.rejected_builds, &run.id);
                    self.record_fees(&run.id).await?;
                    self.log(
                        &run.id,
                        format!("Allocation confirmed at height {}", money::format_count(h.into())),
                    )
                    .await;
                }
                chain.sync().await?;
                let lines = db::lines(db, &run.id).await?;
                for l in &lines {
                    let need = l.amount_zec.unwrap_or(0) as u64 + l.fee_zat.unwrap_or(LINE_FEE_ZAT as i64) as u64;
                    if chain.spendable(l.account_index as u32).await? < need {
                        return Ok(Outcome::Wait(self.inner.poll));
                    }
                }
                db::set_lines_status(db, &run.id, "pending", "allocated").await?;
                db::transition(db, &run.id, &["allocating"], "paying").await?;
                self.log(&run.id, "Contractor accounts funded; paying").await;
                Ok(Outcome::Continue)
            }
        }
    }

    async fn step_paying(&self, run: &RunRow) -> Result<Outcome, StepError> {
        let db = &self.inner.db;
        let chain = &self.inner.chain;
        let lines = db::lines(db, &run.id).await?;
        let mut tip: Option<u32> = None;
        let mut pending = 0;
        // A line confirmed or left the chain: the run's fees change.
        let mut fees_changed = false;
        for l in &lines {
            if l.status == "confirmed" {
                // Re-check until the run is closed: a reorg can take a payment out of the chain.
                let still = match &l.txid {
                    Some(t) => chain.mined_height(t).await?,
                    None => None,
                };
                if still.is_some() && still.map(|h| h as i64) == l.confirmed_height {
                    continue;
                }
                db::unconfirm_line(db, &l.id).await?;
                fees_changed = true;
                self.log(
                    &run.id,
                    format!(
                        "Payment to {} left the chain in a reorg; waiting for it to be mined again",
                        l.contractor_name
                    ),
                )
                .await;
                pending += 1;
                if let Some(t) = &l.txid {
                    let _ = chain.broadcast(t).await;
                }
                continue;
            }
            pending += 1;
            match &l.txid {
                None => {
                    let memo = l
                        .memo
                        .clone()
                        .ok_or_else(|| permanent("missing_memo", "A line has no memo.", "Execute the run again."))?;
                    let amount = l.amount_zec.unwrap_or(0) as u64;
                    // A converting line pays the venue's deposit address (transparent, so no
                    // memo there) and carries the PS1 memo on the account's change output.
                    let mut conversion = None;
                    let (pay, change_memo) = if converts(l) {
                        let conv = match conversion_of(l) {
                            Some(c) => c,
                            None => {
                                let sink = if self.inner.venue.kind() == crate::config::VenueKind::TestnetFixedRate {
                                    Some(chain.transparent_address(TREASURY_INDEX).await?)
                                } else {
                                    None
                                };
                                let req = crate::venue::ConversionRequest {
                                    amount_zat: amount,
                                    payout_chain: l.payout_chain.clone().unwrap_or_default(),
                                    payout_address: l.payout_address.clone().unwrap_or_default(),
                                    refund_to: l.unified_address.clone(),
                                    testnet_sink: sink,
                                };
                                let c = match self.inner.venue.quote_conversion(&req).await {
                                    Ok(c) => c,
                                    Err(VenueError::Unavailable(m)) => return Err(StepError::Transient(m)),
                                    Err(VenueError::Rejected { code, message, hint }) => {
                                        db::fail_line(db, &l.id, code, &message, &hint).await?;
                                        return Err(permanent(code, format!("{}: {message}", l.contractor_name), hint));
                                    }
                                };
                                db::set_settlement(db, &l.id, &serde_json::to_value(&c).map_err(anyhow::Error::from)?)
                                    .await?;
                                self.log(
                                    &run.id,
                                    format!(
                                        "Conversion quote for {}: {} USDC on {}",
                                        l.contractor_name, c.quoted_out, c.payout_chain
                                    ),
                                )
                                .await;
                                c
                            }
                        };
                        let pay = Pay {
                            to: conv.deposit_address.clone(),
                            zat: amount,
                            memo: None,
                        };
                        conversion = Some(conv);
                        (pay, Some(memo))
                    } else {
                        (
                            Pay {
                                to: l.unified_address.clone(),
                                zat: amount,
                                memo: Some(memo),
                            },
                            None,
                        )
                    };
                    match chain
                        .create_transfer(l.account_index as u32, vec![pay], change_memo)
                        .await?
                    {
                        Ok(txid) => {
                            reset(&self.inner.underfunded, &l.id);
                            let exp = chain.expiry_height(&txid).await?;
                            db::set_line_tx(db, &l.id, Some(&txid), exp, "broadcast").await?;
                            if let Some(mut c) = conversion {
                                c.status = "processing".into();
                                db::set_settlement(db, &l.id, &serde_json::to_value(&c).map_err(anyhow::Error::from)?)
                                    .await?;
                            }
                            match chain.broadcast(&txid).await {
                                Ok(()) => self.log(&run.id, format!("Paid {}: {txid}", l.contractor_name)).await,
                                Err(e) => match rejection(&e) {
                                    Some(reason) => self.line_rejected(&run.id, l, false, &reason).await?,
                                    None => {
                                        self.log(
                                            &run.id,
                                            format!("Broadcast for {} will be retried: {e:#}", l.contractor_name),
                                        )
                                        .await
                                    }
                                },
                            }
                        }
                        Err(SpendError::InsufficientFunds { available, required }) => {
                            // The allocation covered this payment. A short wait is normal (a
                            // transaction that expired unmined holds its notes until its expiry
                            // height); one that outlasts that means the notes went elsewhere.
                            let t = chain.tip().await?;
                            let (waited, first) = shortfall(&self.inner.underfunded, &l.id, t);
                            let message = format!(
                                "{}'s account holds {} ZEC spendable but the payment needs {} ZEC.",
                                l.contractor_name,
                                money::format_zec(available),
                                money::format_zec(required)
                            );
                            if first {
                                db::fail_line(
                                    db,
                                    &l.id,
                                    "waiting_for_funds",
                                    &message,
                                    &format!("Payslip waits up to {MAX_UNDERFUNDED_BLOCKS} blocks for the account's notes to unlock, then stops the run."),
                                )
                                .await?;
                                self.log(&run.id, format!("Waiting for funds: {message}")).await;
                            }
                            if waited >= MAX_UNDERFUNDED_BLOCKS {
                                reset(&self.inner.underfunded, &l.id);
                                let hint = "Sync the wallet (POST /api/wallet/sync) and execute the run again. If the shortfall remains, check the service log: the account's notes were spent or locked outside this run.";
                                db::fail_line(db, &l.id, "line_underfunded", &message, hint).await?;
                                return Err(permanent("line_underfunded", message, hint));
                            }
                            chain.sync().await?;
                        }
                        Err(SpendError::SyncRequired) => {
                            chain.sync().await?;
                        }
                        Err(SpendError::Other(m)) => {
                            db::fail_line(
                                db,
                                &l.id,
                                "payment_failed",
                                &m,
                                "Execute the run again to retry this line.",
                            )
                            .await?;
                            return Err(permanent(
                                "payment_failed",
                                format!("Payment to {} could not be built: {m}", l.contractor_name),
                                "Execute the run again to retry the remaining lines.",
                            ));
                        }
                    }
                }
                Some(txid) => match chain.mined_height(txid).await? {
                    Some(h) => {
                        let t = match tip {
                            Some(t) => t,
                            None => {
                                let t = chain.tip().await?;
                                tip = Some(t);
                                t
                            }
                        };
                        if t + 1 >= h + self.inner.confirm_depth {
                            let at = self.confirmed_at(h).await;
                            db::confirm_line(db, &l.id, h, at.as_deref()).await?;
                            db::clear_line_error(db, &l.id, "broadcast_rejected").await?;
                            reset(&self.inner.rejected_builds, &l.id);
                            fees_changed = true;
                            pending -= 1;
                            self.log(
                                &run.id,
                                format!(
                                    "{} confirmed at height {}",
                                    l.contractor_name,
                                    money::format_count(h.into())
                                ),
                            )
                            .await;
                        }
                    }
                    None => {
                        let t = match tip {
                            Some(t) => t,
                            None => {
                                let t = chain.tip().await?;
                                tip = Some(t);
                                t
                            }
                        };
                        let exp = l.expiry_height.map(|e| e as u32).filter(|e| *e != 0);
                        let refused = l.error_code.as_deref() == Some("broadcast_rejected");
                        if exp.is_some_and(|e| t > e) {
                            // A transaction the node refused and never accepted: after a few
                            // rebuilds the refusal is not going away by itself.
                            if refused && bump(&self.inner.rejected_builds, &l.id) >= MAX_REJECTED_BUILDS {
                                reset(&self.inner.rejected_builds, &l.id);
                                return Err(permanent(
                                    "broadcast_rejected",
                                    format!(
                                        "The node refused the payment to {} {MAX_REJECTED_BUILDS} times: {}",
                                        l.contractor_name,
                                        l.error_message.clone().unwrap_or_default()
                                    ),
                                    "Check LIGHTWALLETD_URL points at a node on the current network upgrade and the service log, then execute the run again.",
                                ));
                            }
                            chain.sync().await?;
                            db::set_line_tx(db, &l.id, None, None, "allocated").await?;
                            if conversion_of(l).is_some() {
                                // The venue quote may have lapsed too; quote again on rebuild.
                                db::set_settlement(db, &l.id, &Value::Null).await?;
                            }
                            self.log(
                                &run.id,
                                format!("Payment to {} expired unmined; rebuilding", l.contractor_name),
                            )
                            .await;
                        } else {
                            match chain.broadcast(txid).await {
                                Ok(()) if refused => {
                                    db::clear_line_error(db, &l.id, "broadcast_rejected").await?;
                                }
                                Ok(()) => {}
                                Err(e) => {
                                    if let Some(reason) = rejection(&e) {
                                        self.line_rejected(&run.id, l, refused, &reason).await?;
                                    }
                                }
                            }
                        }
                    }
                },
            }
        }
        if fees_changed {
            self.record_fees(&run.id).await?;
        }
        if pending == 0 {
            if db::transition(db, &run.id, &["paying"], "paid").await? {
                self.log(&run.id, format!("Run paid: {} lines confirmed", lines.len()))
                    .await;
            }
            return Ok(Outcome::Done);
        }
        Ok(Outcome::Wait(self.inner.poll))
    }
}

fn venue_api_error(e: VenueError) -> ApiError {
    match e {
        VenueError::Rejected { code, message, hint } => ApiError::bad_request(code, message, hint),
        VenueError::Unavailable(m) => ApiError::unavailable(
            "venue_unavailable",
            format!("The swap venue did not answer: {m}"),
            "Retry in a minute. If it persists, check the venue's status page.",
        ),
    }
}

/// The treasury venue's only outside dependency is the market price.
fn price_api_error(e: VenueError) -> ApiError {
    match e {
        VenueError::Rejected { code, message, hint } => ApiError::bad_request(code, message, hint),
        VenueError::Unavailable(m) => ApiError::unavailable(
            "price_unavailable",
            format!("The ZEC market price is not available: {m}"),
            "Try again in a minute, or fund the run with USDC.",
        ),
    }
}

/// PAYSLIP_MAX_RUN_USD_CENTS: the run's payroll is over the cap.
pub fn run_over_cap(total_usd_cents: u64, cap_usd_cents: u64) -> ApiError {
    ApiError::bad_request(
        "run_over_cap",
        format!(
            "This run's payroll of {} USD is over the cap of {} USD per run.",
            money::format_usd(total_usd_cents),
            money::format_usd(cap_usd_cents)
        ),
        "Split the payroll into smaller runs, or raise PAYSLIP_MAX_RUN_USD_CENTS on the service.",
    )
}

const MIN_YEAR: i32 = 2000;
const MAX_YEAR: i32 = 2100;

/// Validates a run request; returns (period_start, period_end).
pub fn validate_period(start: &str, end: &str) -> Result<(Date, Date), ApiError> {
    let hint = "Use dates in the form YYYY-MM-DD with the start on or before the end, at most one year apart.";
    let s = parse_date(start)
        .ok_or_else(|| ApiError::bad_request("invalid_period", format!("{start} is not a date."), hint))?;
    let e = parse_date(end)
        .ok_or_else(|| ApiError::bad_request("invalid_period", format!("{end} is not a date."), hint))?;
    if e < s || (e - s).whole_days() > 366 {
        return Err(ApiError::bad_request(
            "invalid_period",
            "The period is reversed or longer than a year.",
            hint,
        ));
    }
    // Catches a mistyped year (0026, 9026) before it reaches a memo or a statement.
    if !(MIN_YEAR..=MAX_YEAR).contains(&s.year()) || !(MIN_YEAR..=MAX_YEAR).contains(&e.year()) {
        return Err(ApiError::bad_request(
            "invalid_period",
            format!("Years must be between {MIN_YEAR} and {MAX_YEAR}."),
            hint,
        ));
    }
    Ok((s, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fee_estimate_covers_observed_fees() {
        // Six lines: six 10,000 zat payments plus an allocation with seven outputs.
        assert!(fee_estimate_zat(6, 0) >= 6 * 10_000 + 7 * 5_000);
        assert_eq!(fee_estimate_zat(1, 0), 10_000 + 20_000);
    }

    /// Audit SL-04: a converting line's allocation carries 25,000 zat (15,000 fee plus 10,000
    /// change), not 10,000. The estimate must equal what `record_fill` checks.
    #[test]
    fn fee_estimate_counts_converting_lines() {
        assert_eq!(
            fee_estimate_zat(6, 4),
            2 * LINE_FEE_ZAT + 4 * (CONVERT_FEE_ZAT + CHANGE_CARRY_ZAT) + 9 * MARGINAL_FEE_ZAT
        );
        assert_eq!(fee_estimate_zat(6, 6) - fee_estimate_zat(6, 0), 6 * 15_000);
        // More converting lines than lines is clamped.
        assert_eq!(fee_estimate_zat(2, 5), fee_estimate_zat(2, 2));
    }

    #[test]
    fn funding_request_adds_fee_headroom() {
        let rate = 1_354_930_000;
        let req = funding_request_cents(2_845_000, 6, 0, rate);
        assert!(req > 2_845_000);
        // Headroom is small relative to payroll: under $3 at today's price.
        assert!(req - 2_845_000 < 300);
        assert!(funding_request_cents(2_845_000, 6, 6, rate) > req);
    }

    #[test]
    fn period_validation() {
        assert!(validate_period("2026-09-01", "2026-09-30").is_ok());
        assert!(validate_period("2026-09-30", "2026-09-01").is_err());
        assert!(validate_period("2026-02-30", "2026-03-01").is_err());
        assert!(validate_period("2025-01-01", "2026-09-01").is_err());
        assert_eq!(period_label("2026-09-01"), "2026-09");
    }

    /// Audit SEC-12: a mistyped year is refused.
    #[test]
    fn period_years_must_be_plausible() {
        assert!(validate_period("0026-09-01", "0026-09-30").is_err());
        assert!(validate_period("9999-01-01", "9999-12-31").is_err());
        assert!(validate_period("2100-12-01", "2100-12-31").is_ok());
    }

    /// Audit SL-11: past its deadline (plus grace) a quote awaiting its deposit is expired;
    /// a venue status that says the deposit arrived always wins.
    #[test]
    fn deadline_expires_only_an_unpaid_quote() {
        let f = Funding {
            status: "awaiting_deposit".into(),
            deadline: Some("2026-10-05T11:00:00Z".into()),
            ..Default::default()
        };
        let at = |s: &str| OffsetDateTime::parse(s, &Rfc3339).unwrap();
        assert_eq!(
            apply_deadline(f.clone(), at("2026-10-05T11:09:00Z")).status,
            "awaiting_deposit"
        );
        assert_eq!(apply_deadline(f.clone(), at("2026-10-05T11:11:00Z")).status, "expired");
        let seen = Funding {
            status: "deposit_seen".into(),
            ..f.clone()
        };
        assert_eq!(apply_deadline(seen, at("2026-10-06T00:00:00Z")).status, "deposit_seen");
        let no_deadline = Funding { deadline: None, ..f };
        assert_eq!(
            apply_deadline(no_deadline, at("2030-01-01T00:00:00Z")).status,
            "awaiting_deposit"
        );
    }
}
