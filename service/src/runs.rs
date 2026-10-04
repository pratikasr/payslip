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
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};

use async_trait::async_trait;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use time::{format_description::well_known::Rfc3339, Date, OffsetDateTime};
use tokio::sync::broadcast;
use uuid::Uuid;

use crate::{
    config::{Config, ZcashNetwork},
    db::{self, LineRow, Pool, RunRow},
    error::ApiError,
    memo::{AllocationMemo, PayLineMemo, PayslipMemo, Period, RunFundingMemo},
    money,
    payer::{Payer, TREASURY_INDEX},
    venue::{Funding, QuoteRequest, SwapVenue, VenueError},
    wallet::SpendError,
};

/// ZIP-317 fee of one pay line transaction: one note in, one output (padded to two actions).
/// Verified on testnet: a one-input, one-output Ironwood transaction paid 10,000 zat.
pub const LINE_FEE_ZAT: u64 = 10_000;
/// ZIP-317 marginal fee per logical action.
pub const MARGINAL_FEE_ZAT: u64 = 5_000;

/// Upper estimate of all network fees for a run with `n` lines: n pay line transactions and one
/// allocation transaction with n + 1 outputs and up to two extra inputs.
pub fn fee_estimate_zat(n: usize) -> u64 {
    n as u64 * LINE_FEE_ZAT + MARGINAL_FEE_ZAT * (n as u64 + 3).max(2)
}

/// USD to request from the venue: the payroll plus 1.5 times the fee estimate at `rate_e6`,
/// rounded up to the cent. The surplus stays in the treasury and is reported as unspent.
pub fn funding_request_cents(total_usd_cents: u64, n: usize, rate_e6: u64) -> u64 {
    let fee_cents = money::zat_to_usd_cents(fee_estimate_zat(n) * 3 / 2, rate_e6).max(1);
    total_usd_cents + fee_cents + 1
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
                to: crate::wallet::parse_shielded_address(&params, &p.to)?,
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
        "explorer_url": l.txid.as_ref().map(|t| network.explorer_tx_url(t)),
        "memo": l.memo,
        "settlement_choice": l.settlement_choice,
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
    venue: Arc<dyn SwapVenue>,
    running: Mutex<HashSet<String>>,
    changes: broadcast::Sender<String>,
    poll: Duration,
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
    pub fn new(cfg: Config, db: Pool, payer: Payer, venue: Arc<dyn SwapVenue>) -> Self {
        Self::with_chain(
            cfg.network,
            db,
            Arc::new(PayerChain(payer)),
            venue,
            Duration::from_secs(10),
        )
    }

    pub fn with_chain(
        network: ZcashNetwork,
        db: Pool,
        chain: Arc<dyn ChainOps>,
        venue: Arc<dyn SwapVenue>,
        poll: Duration,
    ) -> Self {
        let (changes, _) = broadcast::channel(256);
        Executor {
            inner: Arc::new(Inner {
                network,
                db,
                chain,
                venue,
                running: Mutex::new(HashSet::new()),
                changes,
                poll,
            }),
        }
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
        let lines = db::lines(&self.inner.db, run_id).await?;
        Ok(run_json(self.inner.network, &r, &lines))
    }

    /// Requests funding from the venue. Valid in `draft`, or in `awaiting_funds` when the quote
    /// expired or failed before any deposit (a fresh quote replaces it).
    pub async fn fund(
        &self,
        run_id: &str,
        origin_chain: Option<String>,
        refund_address: Option<String>,
    ) -> Result<(), ApiError> {
        let db = &self.inner.db;
        let run = db::get_run(db, run_id)
            .await?
            .ok_or_else(|| ApiError::not_found("Run"))?;
        let current: Option<Funding> = run.venue_state.as_deref().and_then(|s| serde_json::from_str(s).ok());
        let requotable = run.status == "awaiting_funds"
            && current
                .as_ref()
                .map(|f| {
                    matches!(
                        f.status.as_str(),
                        "awaiting_deposit" | "expired" | "refunded" | "failed"
                    )
                })
                .unwrap_or(true)
            && current.as_ref().map(|f| f.deposit_tx_hash.is_none()).unwrap_or(true);
        if run.status != "draft" && !requotable {
            return Err(ApiError::conflict(
                "run_already_funded",
                format!("This run is {} and cannot be funded again.", run.status),
                "Open the run to follow its progress.",
            ));
        }
        let lines = db::lines(db, run_id).await?;
        let total: u64 = lines.iter().map(|l| l.amount_usd_basis as u64).sum();
        let testnet = self.inner.venue.kind() == crate::config::VenueKind::TestnetFixedRate;
        let indicative = match self.inner.venue.indicative_rate_e6().await {
            Ok(r) => r,
            Err(e) => return Err(venue_api_error(e)),
        };
        let request_cents = funding_request_cents(total, lines.len(), indicative);
        let recipient = self.inner.chain.account_address(TREASURY_INDEX).await?;
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
                origin_chain: origin_chain.unwrap_or_else(|| "base".into()),
                refund_address,
                recipient,
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
        let to = if testnet { "funded" } else { "awaiting_funds" };
        db::transition(db, run_id, &["draft", "awaiting_funds"], to).await?;
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

    /// Polls the venue once and stores the result.
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
        if matches!(run.status.as_str(), "awaiting_funds" | "funded" | "swapping") {
            let g = self.inner.venue.status(&f).await.map_err(venue_api_error)?;
            if g != f {
                db::set_venue(
                    db,
                    run_id,
                    &g.venue,
                    &serde_json::to_value(&g).map_err(anyhow::Error::from)?,
                )
                .await?;
                if g.status == "deposit_seen" {
                    db::transition(db, run_id, &["awaiting_funds"], "funded").await?;
                }
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
        let g = self
            .inner
            .venue
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
        self.log(run_id, format!("Deposit transaction {tx_hash} reported to the venue"))
            .await;
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
            "failed" => {
                let back = run.failed_from.clone().unwrap_or_else(|| "funded".into());
                db::transition(db, run_id, &["failed"], &back).await?;
                self.log(run_id, format!("Resuming from {back}")).await;
            }
            _ => {}
        }
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

    /// Restarts every run that was executing when the service stopped.
    pub async fn resume_all(&self) {
        let Ok(runs) = db::list_runs(&self.inner.db).await else {
            return;
        };
        for r in runs {
            if matches!(
                r.status.as_str(),
                "funded" | "swapping" | "swapped" | "allocating" | "paying"
            ) {
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
        let f = match self.inner.venue.status(&f).await {
            Ok(g) => {
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
            "awaiting_deposit" => {
                if let Some(deadline) = f
                    .deadline
                    .as_deref()
                    .and_then(|d| OffsetDateTime::parse(d, &Rfc3339).ok())
                {
                    if OffsetDateTime::now_utc() > deadline + time::Duration::minutes(10) {
                        return Err(permanent(
                            "funding_expired",
                            "The venue's deposit window closed before a deposit arrived.",
                            "Fund the run again to get a fresh quote and deposit address.",
                        ));
                    }
                }
                Ok(Outcome::Wait(poll))
            }
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
                "The USDC went back to the refund address. Fund the run again.",
            )),
            "incomplete" => Err(permanent(
                "deposit_incomplete",
                "The deposit was smaller than the quote required.",
                "Send the remaining USDC to the same deposit address, or wait for the refund and fund again.",
            )),
            "expired" => Err(permanent(
                "funding_expired",
                "The quote expired.",
                "Fund the run again to get a fresh quote.",
            )),
            _ => Err(permanent(
                "venue_failed",
                "The venue reported that the swap failed.",
                "Check the venue's explorer for the deposit, then fund the run again.",
            )),
        }
    }

    /// The venue filled: measure the ZEC that actually arrived, fix the rate and line amounts.
    async fn record_fill(&self, run: &RunRow, f: &Funding) -> Result<Outcome, StepError> {
        let db = &self.inner.db;
        let chain = &self.inner.chain;
        if db::transition(db, &run.id, &["awaiting_funds", "funded"], "swapping").await? {
            self.log(&run.id, "Venue reports the swap complete").await;
        }
        let testnet = f.venue == crate::config::VenueKind::TestnetFixedRate.as_str();
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
        let rate = money::fill_rate_e6(funded_cents, acquired).ok_or_else(|| {
            permanent(
                "invalid_fill",
                "The venue reported an empty fill.",
                "Check the venue status, then fund again.",
            )
        })?;
        db::set_fill(db, &run.id, funded_cents, acquired, rate).await?;
        let lines = db::lines(db, &run.id).await?;
        let period = Period::parse(&period_label(&run.period_start))
            .ok_or_else(|| permanent("invalid_period", "The run period is invalid.", "Create a new run."))?;
        let run_uuid = Uuid::parse_str(&run.id).map_err(|e| anyhow::anyhow!(e))?;
        let mut need = MARGINAL_FEE_ZAT * (lines.len() as u64 + 3);
        for l in &lines {
            let zat = money::usd_cents_to_zat(l.amount_usd_basis as u64, rate)
                .ok_or_else(|| permanent("invalid_amount", "A line amount is out of range.", "Edit the run."))?;
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
            db::set_line_amount(db, &l.id, zat, LINE_FEE_ZAT, &memo, &memo_hash(&memo)).await?;
            need += zat + LINE_FEE_ZAT;
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
                db::set_allocation(db, &run.id, Some(&txid), None).await?;
                if let Some(fee) = chain.tx_fee(&txid).await? {
                    db::add_fees(db, &run.id, fee).await?;
                }
                db::transition(db, &run.id, &["swapped"], "allocating").await?;
                self.log(&run.id, format!("Allocation transaction built: {txid}")).await;
                if let Err(e) = chain.broadcast(&txid).await {
                    self.log(&run.id, format!("Allocation broadcast will be retried: {e:#}"))
                        .await;
                } else {
                    self.log(&run.id, "Allocation transaction broadcast").await;
                }
                Ok(Outcome::Continue)
            }
            Err(SpendError::SyncRequired) => {
                chain.sync().await?;
                Ok(Outcome::Continue)
            }
            Err(SpendError::InsufficientFunds { available, required }) => {
                self.log(
                    &run.id,
                    format!(
                        "Waiting for spendable treasury funds ({} of {} ZEC)",
                        money::format_zec(available),
                        money::format_zec(required)
                    ),
                )
                .await;
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
                        chain.sync().await?;
                        db::set_allocation(db, &run.id, None, None).await?;
                        db::transition(db, &run.id, &["allocating"], "swapped").await?;
                        self.log(
                            &run.id,
                            format!("Allocation {txid} expired unmined at {exp}; rebuilding"),
                        )
                        .await;
                        return Ok(Outcome::Continue);
                    }
                }
                let _ = chain.broadcast(&txid).await;
                Ok(Outcome::Wait(self.inner.poll))
            }
            Some(h) => {
                if run.allocation_height.is_none() {
                    db::set_allocation(db, &run.id, Some(&txid), Some(h)).await?;
                    self.log(&run.id, format!("Allocation confirmed at height {h}")).await;
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
        for l in &lines {
            if l.status == "confirmed" {
                continue;
            }
            pending += 1;
            match &l.txid {
                None => {
                    let memo = l
                        .memo
                        .clone()
                        .ok_or_else(|| permanent("missing_memo", "A line has no memo.", "Execute the run again."))?;
                    let pay = Pay {
                        to: l.unified_address.clone(),
                        zat: l.amount_zec.unwrap_or(0) as u64,
                        memo: Some(memo),
                    };
                    match chain.create_transfer(l.account_index as u32, vec![pay], None).await? {
                        Ok(txid) => {
                            let exp = chain.expiry_height(&txid).await?;
                            db::set_line_tx(db, &l.id, Some(&txid), exp, "broadcast").await?;
                            if let Some(fee) = chain.tx_fee(&txid).await? {
                                db::add_fees(db, &run.id, fee).await?;
                            }
                            match chain.broadcast(&txid).await {
                                Ok(()) => self.log(&run.id, format!("Paid {}: {txid}", l.contractor_name)).await,
                                Err(e) => {
                                    self.log(
                                        &run.id,
                                        format!("Broadcast for {} will be retried: {e:#}", l.contractor_name),
                                    )
                                    .await
                                }
                            }
                        }
                        Err(SpendError::InsufficientFunds { .. }) | Err(SpendError::SyncRequired) => {
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
                        db::confirm_line(db, &l.id, h).await?;
                        pending -= 1;
                        self.log(&run.id, format!("{} confirmed at height {h}", l.contractor_name))
                            .await;
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
                        if exp.is_some_and(|e| t > e) {
                            chain.sync().await?;
                            db::set_line_tx(db, &l.id, None, None, "allocated").await?;
                            self.log(
                                &run.id,
                                format!("Payment to {} expired unmined; rebuilding", l.contractor_name),
                            )
                            .await;
                        } else {
                            let _ = chain.broadcast(txid).await;
                        }
                    }
                },
            }
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
    Ok((s, e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fee_estimate_covers_observed_fees() {
        // Six lines: six 10,000 zat payments plus an allocation with seven outputs.
        assert!(fee_estimate_zat(6) >= 6 * 10_000 + 7 * 5_000);
        assert_eq!(fee_estimate_zat(1), 10_000 + 20_000);
    }

    #[test]
    fn funding_request_adds_fee_headroom() {
        let rate = 1_354_930_000;
        let req = funding_request_cents(2_845_000, 6, rate);
        assert!(req > 2_845_000);
        // Headroom is small relative to payroll: under $3 at today's price.
        assert!(req - 2_845_000 < 300);
    }

    #[test]
    fn period_validation() {
        assert!(validate_period("2026-09-01", "2026-09-30").is_ok());
        assert!(validate_period("2026-09-30", "2026-09-01").is_err());
        assert!(validate_period("2026-02-30", "2026-03-01").is_err());
        assert!(validate_period("2025-01-01", "2026-09-01").is_err());
        assert_eq!(period_label("2026-09-01"), "2026-09");
    }
}
