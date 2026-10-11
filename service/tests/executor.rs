//! Run executor tests against a deterministic in-memory chain (no network).
//!
//! The fake chain models what matters for safety: a transaction is stored when built, spends
//! (locks) its inputs at once, reaches recipients only when mined, and unlocks its inputs if it
//! expires unmined. Crashes are simulated by dropping or panicking the executor task at chosen
//! points and starting a fresh executor over the same database and chain.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use async_trait::async_trait;
use payslip::{
    config::{VenueKind, ZcashNetwork},
    db::{self, NewContractor, NewLine, Pool},
    memo,
    prices::{self, MarketRate, RateAt},
    runs::{ChainOps, Executor, Pay, LINE_FEE_ZAT},
    statements::{self, KeyInfo},
    venue::{Funding, QuoteRequest, SwapVenue, TestnetVenue, TreasuryVenue, VenueError},
    viewer::ScanOutput,
    wallet::SpendError,
};
use serde_json::json;

const RATE: u64 = 1_350_000_000_000;
const EXPIRY_DELTA: u32 = 100;
/// The fake chain's block times: block h was mined at BLOCK_T0 + 75 h (Zcash's target spacing).
const BLOCK_T0: i64 = 1_790_000_000;

fn block_time(h: i64) -> String {
    statements::block_time_rfc3339(BLOCK_T0 + 75 * h).unwrap()
}

#[derive(Clone, Debug)]
struct FakeTx {
    from: u32,
    pays: Vec<Pay>,
    change_memo: Option<String>,
    fee: u64,
    expiry: u32,
    broadcast: bool,
    mined_at: Option<u32>,
    dropped: bool,
}

#[derive(Default)]
struct State {
    tip: u32,
    spendable: HashMap<u32, u64>,
    /// Received but not yet confirmed to the executor's depth (counted in `total`, not in
    /// `spendable`): a deposit on its way in.
    pending: HashMap<u32, u64>,
    external: HashMap<String, u64>,
    txs: HashMap<String, FakeTx>,
    order: Vec<String>,
}

#[derive(Default)]
struct Hooks {
    /// Panic inside create_transfer after storing the tx (crash before payslip.db records it).
    panic_after_create_from: Option<u32>,
    /// Never complete the first broadcast from this account (the task is dropped mid-await).
    hang_broadcast_from: Option<u32>,
    /// Drop (never mine) the first tx from this account, as if evicted from the mempool.
    drop_first_from: Option<u32>,
    /// create_transfer fails like a full disk.
    disk_full: bool,
    /// Charge a converting payment (one transparent output plus memo-carrying change) the
    /// real ZIP-317 fee, CONVERT_FEE_ZAT, as the wallet does.
    convert_fee: bool,
    /// ZEC the venue delivered to the treasury, per txid (the mainnet path of record_fill).
    received: HashMap<String, u64>,
    /// lightwalletd refuses every broadcast from this account.
    reject_broadcast_from: Option<u32>,
    /// Every payment from this account fails for lack of spendable funds.
    insufficient_from: Option<u32>,
    /// Block time lookups fail, as when lightwalletd is unreachable.
    block_time_fails: bool,
}

#[derive(Default, Clone)]
struct FakeChain {
    s: Arc<Mutex<State>>,
    hooks: Arc<Mutex<Hooks>>,
    counter: Arc<AtomicU32>,
}

impl FakeChain {
    fn new(treasury: u64) -> Self {
        let c = FakeChain::default();
        c.s.lock().unwrap().tip = 1000;
        c.s.lock().unwrap().spendable.insert(0, treasury);
        c
    }

    /// Mines one block: every broadcast, unmined, unexpired, non-dropped tx is included.
    fn mine(&self) {
        let mut s = self.s.lock().unwrap();
        s.tip += 1;
        let tip = s.tip;
        let ids: Vec<String> = s.order.clone();
        for id in ids {
            let tx = s.txs.get(&id).unwrap().clone();
            if tx.broadcast && tx.mined_at.is_none() && !tx.dropped && tip <= tx.expiry {
                s.txs.get_mut(&id).unwrap().mined_at = Some(tip);
                for p in &tx.pays {
                    if let Some(i) = p.to.strip_prefix("acct:") {
                        *s.spendable.entry(i.parse().unwrap()).or_default() += p.zat;
                    } else {
                        *s.external.entry(p.to.clone()).or_default() += p.zat;
                    }
                }
            }
        }
        // Expired, unmined transactions release their inputs.
        let expired: Vec<String> = s
            .order
            .iter()
            .filter(|id| {
                let t = &s.txs[*id];
                t.mined_at.is_none() && tip > t.expiry && t.fee != u64::MAX
            })
            .cloned()
            .collect();
        for id in expired {
            let tx = s.txs.get_mut(&id).unwrap();
            let refund: u64 = tx.pays.iter().map(|p| p.zat).sum::<u64>() + tx.fee;
            tx.fee = u64::MAX; // mark released
            let from = tx.from;
            *s.spendable.entry(from).or_default() += refund;
        }
    }

    /// Removes the last `n` blocks: their transactions return to the mempool (still broadcast)
    /// and their credits are undone.
    fn reorg(&self, n: u32) {
        let mut s = self.s.lock().unwrap();
        let cut = s.tip - n;
        let ids: Vec<String> = s.order.clone();
        for id in ids {
            let tx = s.txs.get(&id).unwrap().clone();
            if tx.mined_at.is_some_and(|h| h > cut) {
                s.txs.get_mut(&id).unwrap().mined_at = None;
                for p in &tx.pays {
                    if let Some(i) = p.to.strip_prefix("acct:") {
                        *s.spendable.get_mut(&i.parse::<u32>().unwrap()).unwrap() -= p.zat;
                    } else {
                        *s.external.get_mut(&p.to).unwrap() -= p.zat;
                    }
                }
            }
        }
        s.tip = cut;
    }

    fn external(&self, addr: &str) -> u64 {
        self.s.lock().unwrap().external.get(addr).copied().unwrap_or(0)
    }

    /// A deposit from outside that is already confirmed (spendable).
    fn receive(&self, account: u32, zat: u64) {
        *self.s.lock().unwrap().spendable.entry(account).or_default() += zat;
    }

    /// A deposit from outside that is seen but not yet confirmed.
    fn receive_pending(&self, account: u32, zat: u64) {
        *self.s.lock().unwrap().pending.entry(account).or_default() += zat;
    }

    /// Every pending deposit reaches the confirmation depth.
    fn confirm_pending(&self) {
        let mut s = self.s.lock().unwrap();
        let pending: Vec<(u32, u64)> = s.pending.drain().collect();
        for (account, zat) in pending {
            *s.spendable.entry(account).or_default() += zat;
        }
    }

    fn txs_from(&self, account: u32) -> Vec<FakeTx> {
        let s = self.s.lock().unwrap();
        s.order
            .iter()
            .map(|id| s.txs[id].clone())
            .filter(|t| t.from == account)
            .collect()
    }
}

#[async_trait]
impl ChainOps for FakeChain {
    async fn sync(&self) -> anyhow::Result<()> {
        Ok(())
    }
    async fn tip(&self) -> anyhow::Result<u32> {
        Ok(self.s.lock().unwrap().tip)
    }
    async fn spendable(&self, account: u32) -> anyhow::Result<u64> {
        Ok(self.s.lock().unwrap().spendable.get(&account).copied().unwrap_or(0))
    }
    async fn total(&self, account: u32) -> anyhow::Result<u64> {
        let s = self.s.lock().unwrap();
        Ok(s.spendable.get(&account).copied().unwrap_or(0) + s.pending.get(&account).copied().unwrap_or(0))
    }
    async fn account_address(&self, account: u32) -> anyhow::Result<String> {
        Ok(format!("acct:{account}"))
    }
    async fn transparent_address(&self, account: u32) -> anyhow::Result<String> {
        Ok(format!("tsink:{account}"))
    }
    async fn create_transfer(
        &self,
        from: u32,
        pays: Vec<Pay>,
        change_memo: Option<String>,
    ) -> anyhow::Result<Result<String, SpendError>> {
        if self.hooks.lock().unwrap().disk_full {
            anyhow::bail!("database or disk is full");
        }
        if self.hooks.lock().unwrap().insufficient_from == Some(from) {
            return Ok(Err(SpendError::InsufficientFunds {
                available: 0,
                required: pays.iter().map(|p| p.zat).sum(),
            }));
        }
        let converting = pays.len() == 1 && pays[0].memo.is_none() && change_memo.is_some();
        let fee = if converting && self.hooks.lock().unwrap().convert_fee {
            payslip::runs::CONVERT_FEE_ZAT
        } else if pays.len() <= 1 {
            LINE_FEE_ZAT
        } else {
            5_000 * (pays.len() as u64 + 1)
        };
        let need: u64 = pays.iter().map(|p| p.zat).sum::<u64>() + fee;
        let id = format!("{:064x}", self.counter.fetch_add(1, Ordering::SeqCst) + 1);
        {
            let mut s = self.s.lock().unwrap();
            let have = s.spendable.get(&from).copied().unwrap_or(0);
            if have < need {
                return Ok(Err(SpendError::InsufficientFunds {
                    available: have,
                    required: need,
                }));
            }
            *s.spendable.get_mut(&from).unwrap() -= need;
            let expiry = s.tip + EXPIRY_DELTA;
            s.txs.insert(
                id.clone(),
                FakeTx {
                    from,
                    pays,
                    change_memo,
                    fee,
                    expiry,
                    broadcast: false,
                    mined_at: None,
                    dropped: false,
                },
            );
            s.order.push(id.clone());
        }
        let panic_now = {
            let mut h = self.hooks.lock().unwrap();
            if h.panic_after_create_from == Some(from) {
                h.panic_after_create_from = None;
                true
            } else {
                false
            }
        };
        if panic_now {
            panic!("simulated crash after building {id}");
        }
        let drop_it = {
            let mut h = self.hooks.lock().unwrap();
            if h.drop_first_from == Some(from) {
                h.drop_first_from = None;
                true
            } else {
                false
            }
        };
        if drop_it {
            self.s.lock().unwrap().txs.get_mut(&id).unwrap().dropped = true;
        }
        Ok(Ok(id))
    }
    async fn broadcast(&self, txid: &str) -> anyhow::Result<()> {
        let hang = {
            let from = self.s.lock().unwrap().txs.get(txid).map(|t| t.from);
            let mut h = self.hooks.lock().unwrap();
            if from.is_some() && h.hang_broadcast_from == from {
                h.hang_broadcast_from = None;
                true
            } else {
                false
            }
        };
        if hang {
            std::future::pending::<()>().await;
        }
        {
            let from = self.s.lock().unwrap().txs.get(txid).map(|t| t.from);
            if from.is_some() && self.hooks.lock().unwrap().reject_broadcast_from == from {
                return Err(anyhow::Error::new(payslip::wallet::lwd::BroadcastError {
                    code: -26,
                    message: "bad-txns-orchard-anchor-invalid".into(),
                }));
            }
        }
        let mut s = self.s.lock().unwrap();
        let tx = s.txs.get_mut(txid).ok_or_else(|| anyhow::anyhow!("unknown tx"))?;
        if tx.fee == u64::MAX {
            anyhow::bail!("transaction expired");
        }
        tx.broadcast = true;
        Ok(())
    }
    async fn mined_height(&self, txid: &str) -> anyhow::Result<Option<u32>> {
        Ok(self.s.lock().unwrap().txs.get(txid).and_then(|t| t.mined_at))
    }
    async fn expiry_height(&self, txid: &str) -> anyhow::Result<Option<u32>> {
        Ok(self.s.lock().unwrap().txs.get(txid).map(|t| t.expiry))
    }
    async fn tx_fee(&self, txid: &str) -> anyhow::Result<Option<u64>> {
        Ok(self
            .s
            .lock()
            .unwrap()
            .txs
            .get(txid)
            .map(|t| if t.fee == u64::MAX { 0 } else { t.fee }))
    }
    async fn received_in_tx(&self, txid: &str, _account: u32) -> anyhow::Result<u64> {
        Ok(self.hooks.lock().unwrap().received.get(txid).copied().unwrap_or(0))
    }
    async fn block_time(&self, height: u32) -> anyhow::Result<i64> {
        if self.hooks.lock().unwrap().block_time_fails {
            anyhow::bail!("GetBlock at {height}: transport error");
        }
        Ok(BLOCK_T0 + 75 * i64::from(height))
    }
}

async fn fresh_db() -> (tempfile::TempDir, Pool) {
    let dir = tempfile::tempdir().unwrap();
    let pool = db::open(&dir.path().join("payslip.db")).await.unwrap();
    (dir, pool)
}

const PEOPLE: [(&str, u64, &str); 3] = [
    ("Amara Okafor", 480_000, "INV-2026-014"),
    ("Mateo Fernandez", 625_000, "MF-0923"),
    ("Priya Raman", 540_000, "PR-INV-31"),
];

async fn seed_run(pool: &Pool) -> String {
    let mut lines = vec![];
    for (i, (name, cents, inv)) in PEOPLE.iter().enumerate() {
        let c = db::insert_contractor(
            pool,
            &NewContractor {
                name: name.to_string(),
                email: None,
                unified_address: format!("contractor:{i}"),
                settlement_choice: "hold_zec".into(),
                payout_chain: None,
                payout_address: None,
            },
            i as u32 + 1,
            1000,
        )
        .await
        .unwrap();
        lines.push(NewLine {
            contractor_id: c.id,
            amount_usd_cents: *cents,
            invoice_ref: inv.to_string(),
        });
    }
    db::insert_run(pool, Some("key-1"), "2026-09-01", "2026-09-30", &lines)
        .await
        .unwrap()
        .unwrap()
}

fn executor(pool: &Pool, chain: &FakeChain, venue: Arc<dyn SwapVenue>) -> Executor {
    executor_depth(pool, chain, venue, 1)
}

fn executor_depth(pool: &Pool, chain: &FakeChain, venue: Arc<dyn SwapVenue>, depth: u32) -> Executor {
    executor_with(
        pool,
        chain,
        venue,
        Arc::new(TreasuryVenue::new(Arc::new(SeriesRates))),
        depth,
    )
}

fn executor_with(
    pool: &Pool,
    chain: &FakeChain,
    venue: Arc<dyn SwapVenue>,
    treasury: Arc<TreasuryVenue>,
    depth: u32,
) -> Executor {
    Executor::with_chain(
        ZcashNetwork::Testnet,
        pool.clone(),
        Arc::new(chain.clone()),
        venue,
        treasury,
        Duration::from_millis(5),
        depth,
    )
}

/// The ZEC market price at a five-minute mark: it moves with time, so the rate a run records
/// depends on which block funded it, and no two marks within an hour share a price.
fn price_at_mark(mark: i64) -> f64 {
    1_300.0 + ((mark / 300) % 7) as f64 * 3.25
}

/// The five-minute price points around `t`, as CoinGecko answers a short range: what the
/// statement engine would see when valuing a payment mined at `t`.
fn series_around(t: i64) -> Vec<(i64, f64)> {
    let first = t.div_euclid(300) * 300 - 900;
    (0..7)
        .map(|i| (first + 300 * i, price_at_mark(first + 300 * i)))
        .collect()
}

/// The executor's rate source in these tests: the price point nearest a block time, read the
/// way the statement engine values a payment at receipt.
struct SeriesRates;

#[async_trait]
impl MarketRate for SeriesRates {
    async fn usd_rate_at(&self, unix: i64) -> anyhow::Result<Option<RateAt>> {
        Ok(prices::rate_at(&series_around(unix), unix, prices::DAY_MAX_GAP))
    }
}

/// The rate the executor records for a run funded at `height`, computed the way the tests
/// expect it: from the block's time through the same series and lookup.
fn rate_at_height(height: u32) -> RateAt {
    let t = BLOCK_T0 + 75 * i64::from(height);
    prices::rate_at(&series_around(t), t, prices::DAY_MAX_GAP).unwrap()
}

fn testnet_venue() -> Arc<dyn SwapVenue> {
    Arc::new(TestnetVenue { rate_e6: RATE })
}

/// Mines a block every few milliseconds until the run reaches a terminal state.
async fn run_to_end(pool: &Pool, chain: &FakeChain, exec: &Executor, run_id: &str) -> String {
    exec.start(run_id).await.unwrap();
    for _ in 0..4000 {
        chain.mine();
        tokio::time::sleep(Duration::from_millis(4)).await;
        let r = db::get_run(pool, run_id).await.unwrap().unwrap();
        if (r.status == "paid" || r.status == "failed") && !exec.is_running(run_id) {
            return r.status;
        }
    }
    panic!("run did not finish");
}

async fn assert_paid_exactly_once(pool: &Pool, chain: &FakeChain, run_id: &str) {
    let lines = db::lines(pool, run_id).await.unwrap();
    assert_eq!(lines.len(), 3);
    for l in &lines {
        assert_eq!(l.status, "confirmed", "{l:?}");
        assert!(l.txid.is_some() && l.confirmed_height.is_some());
        // The contractor received exactly the line amount, once.
        assert_eq!(
            chain.external(&l.unified_address),
            l.amount_zec.unwrap() as u64,
            "{}",
            l.contractor_name
        );
        let mined: Vec<FakeTx> = chain
            .txs_from(l.account_index as u32)
            .into_iter()
            .filter(|t| t.mined_at.is_some())
            .collect();
        assert_eq!(
            mined.len(),
            1,
            "exactly one mined payment from account {}",
            l.account_index
        );
        assert!(l
            .memo
            .as_deref()
            .unwrap()
            .starts_with(&format!("PS1|{run_id}|2026-09|")));
    }
    // Contractor accounts end at zero: allocation = amount + fee.
    for i in 1..=3 {
        assert_eq!(chain.spendable(i).await.unwrap(), 0, "account {i} drained");
    }
}

#[tokio::test]
async fn happy_path_pays_every_line_once() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed_run(&pool).await;
    exec.fund(&run_id, None, None).await.unwrap();
    assert_eq!(run_to_end(&pool, &chain, &exec, &run_id).await, "paid");
    assert_paid_exactly_once(&pool, &chain, &run_id).await;
    let r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
    assert_eq!(r.zec_usd_rate.map(|v| v as u64 / 1_000_000), Some(RATE / 1_000_000));
    assert!(r.allocation_height.is_some());
    assert!(r.fees_zat >= 3 * LINE_FEE_ZAT as i64);
    let events: Vec<String> = db::events(&pool, &run_id)
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.message)
        .collect();
    assert!(events.iter().any(|m| m.starts_with("Run paid")));
}

#[tokio::test]
async fn crash_after_building_payment_before_recording_it_never_pays_twice() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    chain.hooks.lock().unwrap().panic_after_create_from = Some(2);
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed_run(&pool).await;
    exec.fund(&run_id, None, None).await.unwrap();
    exec.start(&run_id).await.unwrap();
    // Let the first executor run until it crashes on account 2's payment.
    for _ in 0..2000 {
        chain.mine();
        tokio::time::sleep(Duration::from_millis(4)).await;
        if !exec.is_running(&run_id) {
            break;
        }
    }
    assert!(!exec.is_running(&run_id), "executor task should have crashed");
    let line2 = db::lines(&pool, &run_id)
        .await
        .unwrap()
        .into_iter()
        .find(|l| l.account_index == 2)
        .unwrap();
    assert!(line2.txid.is_none(), "the crash happened before the txid was recorded");
    // A new process resumes. The orphaned transaction holds account 2's note until it expires,
    // then the payment is rebuilt.
    let exec2 = executor(&pool, &chain, testnet_venue());
    assert_eq!(run_to_end(&pool, &chain, &exec2, &run_id).await, "paid");
    assert_paid_exactly_once(&pool, &chain, &run_id).await;
    let orphan = &chain.txs_from(2)[0];
    assert!(
        !orphan.broadcast && orphan.mined_at.is_none(),
        "the orphan was never broadcast"
    );
}

#[tokio::test]
async fn crash_before_broadcast_rebroadcasts_the_same_transaction() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    chain.hooks.lock().unwrap().hang_broadcast_from = Some(0);
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed_run(&pool).await;
    exec.fund(&run_id, None, None).await.unwrap();
    // Drive until the allocation broadcast hangs, then drop the executor mid-await (a crash).
    let e1 = exec.clone();
    let rid = run_id.clone();
    let task = tokio::spawn(async move { e1.drive(&rid).await });
    // Wait for the exact crash point (allocation stored, its broadcast hanging), however slow
    // the machine, then kill the task.
    let mut r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
    for _ in 0..2000 {
        // The hook is consumed only once the broadcast is in progress (and hanging).
        if r.status == "allocating"
            && !chain.txs_from(0).is_empty()
            && chain.hooks.lock().unwrap().hang_broadcast_from.is_none()
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
        r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
    }
    task.abort();
    let _ = task.await;
    assert_eq!(r.status, "allocating");
    assert!(
        !chain.txs_from(0)[0].broadcast,
        "the crash happened before the broadcast completed"
    );
    let alloc = r.allocation_txid.clone().unwrap();
    let exec2 = executor(&pool, &chain, testnet_venue());
    assert_eq!(run_to_end(&pool, &chain, &exec2, &run_id).await, "paid");
    let r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
    assert_eq!(
        r.allocation_txid.as_deref(),
        Some(alloc.as_str()),
        "same allocation transaction, not a second one"
    );
    assert_eq!(chain.txs_from(0).len(), 1);
    assert_paid_exactly_once(&pool, &chain, &run_id).await;
}

#[tokio::test]
async fn expired_payment_is_rebuilt_and_paid_once() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    chain.hooks.lock().unwrap().drop_first_from = Some(3);
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed_run(&pool).await;
    exec.fund(&run_id, None, None).await.unwrap();
    assert_eq!(run_to_end(&pool, &chain, &exec, &run_id).await, "paid");
    assert_paid_exactly_once(&pool, &chain, &run_id).await;
    let from3 = chain.txs_from(3);
    assert_eq!(from3.len(), 2, "the dropped payment was rebuilt");
    assert!(from3[0].mined_at.is_none());
    let line3 = db::lines(&pool, &run_id)
        .await
        .unwrap()
        .into_iter()
        .find(|l| l.account_index == 3)
        .unwrap();
    assert_eq!(line3.attempts, 2);
}

#[tokio::test]
async fn duplicate_execute_starts_one_executor() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed_run(&pool).await;
    exec.fund(&run_id, None, None).await.unwrap();
    for _ in 0..5 {
        exec.start(&run_id).await.unwrap();
    }
    assert_eq!(run_to_end(&pool, &chain, &exec, &run_id).await, "paid");
    assert_eq!(chain.txs_from(0).len(), 1, "one allocation");
    assert_paid_exactly_once(&pool, &chain, &run_id).await;
    // Funding again is refused once funded.
    assert_eq!(
        exec.fund(&run_id, None, None).await.unwrap_err().body.code,
        "run_already_funded"
    );
}

#[tokio::test]
async fn insufficient_treasury_is_refused_with_the_address_to_top_up() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(1_000);
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed_run(&pool).await;
    let err = exec.fund(&run_id, None, None).await.unwrap_err();
    assert_eq!(err.body.code, "treasury_insufficient");
    assert!(err.body.hint.contains("acct:0"));
    assert_eq!(db::get_run(&pool, &run_id).await.unwrap().unwrap().status, "draft");
}

#[tokio::test]
async fn disk_full_fails_the_run_and_resumes_after_space_is_freed() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    chain.hooks.lock().unwrap().disk_full = true;
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed_run(&pool).await;
    exec.fund(&run_id, None, None).await.unwrap();
    assert_eq!(run_to_end(&pool, &chain, &exec, &run_id).await, "failed");
    let r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
    assert_eq!(r.error_code.as_deref(), Some("disk_full"));
    assert!(r.error_hint.unwrap().contains("Free space"));
    chain.hooks.lock().unwrap().disk_full = false;
    assert_eq!(run_to_end(&pool, &chain, &exec, &run_id).await, "paid");
    assert_paid_exactly_once(&pool, &chain, &run_id).await;
}

/// A venue whose status follows a script, for the 1Click failure modes.
struct ScriptedVenue {
    statuses: Mutex<Vec<Result<&'static str, ()>>>,
}

#[async_trait]
impl SwapVenue for ScriptedVenue {
    fn kind(&self) -> VenueKind {
        VenueKind::NearIntents
    }
    async fn indicative_rate_e6(&self) -> Result<u64, VenueError> {
        Ok(1_354_930_000)
    }
    async fn quote(&self, req: &QuoteRequest) -> Result<Funding, VenueError> {
        Ok(Funding {
            venue: "near-intents-1click".into(),
            status: "awaiting_deposit".into(),
            deposit_address: Some("0xdeposit".into()),
            requested_usd_cents: req.usd_cents,
            ..Default::default()
        })
    }
    async fn status(&self, f: &Funding) -> Result<Funding, VenueError> {
        let next = {
            let mut s = self.statuses.lock().unwrap();
            if s.len() > 1 {
                s.remove(0)
            } else {
                s[0]
            }
        };
        match next {
            Ok(st) => Ok(Funding {
                status: st.into(),
                ..f.clone()
            }),
            Err(()) => Err(VenueError::Unavailable("timed out".into())),
        }
    }
    async fn submit_deposit(&self, f: &Funding, _tx: &str) -> Result<Funding, VenueError> {
        Ok(f.clone())
    }
}

async fn venue_outcome(statuses: Vec<Result<&'static str, ()>>) -> (String, Option<String>) {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    let venue: Arc<dyn SwapVenue> = Arc::new(ScriptedVenue {
        statuses: Mutex::new(statuses),
    });
    let exec = executor(&pool, &chain, venue);
    let run_id = seed_run(&pool).await;
    exec.fund(&run_id, Some("base".into()), Some("0xrefund".into()))
        .await
        .unwrap();
    assert_eq!(
        db::get_run(&pool, &run_id).await.unwrap().unwrap().status,
        "awaiting_funds"
    );
    exec.start(&run_id).await.unwrap();
    for _ in 0..500 {
        tokio::time::sleep(Duration::from_millis(5)).await;
        if !exec.is_running(&run_id) {
            break;
        }
    }
    let r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
    (r.status, r.error_code)
}

#[tokio::test]
async fn venue_timeouts_are_retried_not_fatal() {
    let (status, code) = venue_outcome(vec![Err(()), Err(()), Err(()), Ok("refunded")]).await;
    // Three timeouts were retried; the run only failed when the venue gave a final answer.
    assert_eq!(status, "failed");
    assert_eq!(code.as_deref(), Some("venue_refunded"));
}

#[tokio::test]
async fn venue_partial_fill_fails_with_a_fix() {
    let (status, code) = venue_outcome(vec![Ok("deposit_seen"), Ok("incomplete")]).await;
    assert_eq!(status, "failed");
    assert_eq!(code.as_deref(), Some("deposit_incomplete"));
}

#[tokio::test]
async fn reorg_after_a_payment_is_mined_is_detected_and_reconfirmed() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    let exec = executor_depth(&pool, &chain, testnet_venue(), 2);
    let run_id = seed_run(&pool).await;
    exec.fund(&run_id, None, None).await.unwrap();
    exec.start(&run_id).await.unwrap();
    // Mine until every payment is mined once, then reorg the block that carried them.
    let mut reorged = false;
    for _ in 0..4000 {
        tokio::time::sleep(Duration::from_millis(4)).await;
        let lines = db::lines(&pool, &run_id).await.unwrap();
        let all_mined = !reorged && lines.iter().all(|l| l.txid.is_some()) && futures_all_mined(&chain, &lines).await;
        if all_mined {
            chain.reorg(1);
            reorged = true;
        } else {
            chain.mine();
        }
        let r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
        if r.status == "paid" && !exec.is_running(&run_id) {
            break;
        }
    }
    assert!(reorged, "the test reorged the chain");
    assert_eq!(db::get_run(&pool, &run_id).await.unwrap().unwrap().status, "paid");
    assert_paid_exactly_once(&pool, &chain, &run_id).await;
    for l in db::lines(&pool, &run_id).await.unwrap() {
        let h = chain.mined_height(l.txid.as_deref().unwrap()).await.unwrap();
        assert_eq!(
            h.map(|h| h as i64),
            l.confirmed_height,
            "recorded height matches the chain after the reorg"
        );
        assert_eq!(
            l.confirmed_at,
            l.confirmed_height.map(block_time),
            "the block time goes with the height"
        );
    }
}

/// A confirmed pay line carries its block's time, formatted the way statements format it: the
/// run and the contractor's statement show the same time and date for the same txid.
#[tokio::test]
async fn a_confirmed_line_carries_its_block_time_as_statements_show_it() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed_run(&pool).await;
    let draft = exec.run_view(&run_id).await.unwrap();
    for l in draft["lines"].as_array().unwrap() {
        assert!(l.as_object().unwrap().contains_key("confirmed_at"));
        assert!(l["confirmed_at"].is_null(), "null until confirmed");
    }
    exec.fund(&run_id, None, None).await.unwrap();
    assert_eq!(run_to_end(&pool, &chain, &exec, &run_id).await, "paid");
    let view = exec.run_view(&run_id).await.unwrap();
    let lines = db::lines(&pool, &run_id).await.unwrap();
    for (l, shown) in lines.iter().zip(view["lines"].as_array().unwrap()) {
        let h = l.confirmed_height.unwrap();
        let at = l.confirmed_at.clone().expect("recorded when the line confirmed");
        assert_eq!(at, block_time(h));
        assert_eq!(shown["confirmed_at"], json!(at));
        // The contractor's statement, built from a scan of the same payment.
        let scanned = ScanOutput {
            txid: l.txid.clone().unwrap(),
            mined_height: Some(h as u32),
            block_time: Some(BLOCK_T0 + 75 * h),
            expiry_height: Some(h as u32 + 40),
            pool: 4,
            output_index: 0,
            from_account: Some("contractor-key".into()),
            to_account: None,
            to_address: Some(l.unified_address.clone()),
            value_zat: l.amount_zec.unwrap() as u64,
            is_change: false,
            memo: Some(
                memo::to_memo_bytes(l.memo.as_deref().unwrap())
                    .unwrap()
                    .as_slice()
                    .to_vec(),
            ),
            fee_zat: Some(LINE_FEE_ZAT),
        };
        let keys = [KeyInfo {
            fingerprint: "contractor-key".into(),
            account_index: Some(l.account_index as u32),
            label: Some(l.contractor_name.clone()),
            role: "contractor".into(),
        }];
        let statement = statements::classify(ZcashNetwork::Testnet, &[scanned], &keys, h as u32 + 10, None);
        assert_eq!(statement.lines.len(), 1, "{}", l.contractor_name);
        let line = &statement.lines[0];
        assert_eq!(Some(&line.txid), l.txid.as_ref());
        assert_eq!(line.block_time.as_deref(), Some(at.as_str()));
        assert_eq!(line.date.as_deref(), Some(&at[..10]));
    }
}

/// A line confirmed while its block time could not be looked up (lightwalletd down), or before
/// times were recorded, gets its time on a later read or at start-up; once recorded it is kept,
/// and only a reorg that takes the payment out clears it, with the height.
#[tokio::test]
async fn a_missing_block_time_is_filled_in_later_and_then_kept() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    chain.hooks.lock().unwrap().block_time_fails = true;
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed_run(&pool).await;
    exec.fund(&run_id, None, None).await.unwrap();
    assert_eq!(run_to_end(&pool, &chain, &exec, &run_id).await, "paid");
    let lines = db::lines(&pool, &run_id).await.unwrap();
    assert!(
        lines
            .iter()
            .all(|l| l.confirmed_height.is_some() && l.confirmed_at.is_none()),
        "confirmed without a time"
    );
    // Reading the run still answers while the lookup fails.
    let view = exec.run_view(&run_id).await.unwrap();
    assert!(view["lines"][0]["confirmed_at"].is_null());
    // lightwalletd is back: the first read after the pause (six 5 ms polls) fills every line.
    chain.hooks.lock().unwrap().block_time_fails = false;
    tokio::time::sleep(Duration::from_millis(40)).await;
    let view = exec.run_view(&run_id).await.unwrap();
    for (l, shown) in lines.iter().zip(view["lines"].as_array().unwrap()) {
        assert_eq!(shown["confirmed_at"], json!(block_time(l.confirmed_height.unwrap())));
    }
    // A line from before the migration is filled in at start-up by a fresh executor.
    let first = &lines[0];
    let h = first.confirmed_height.unwrap();
    sqlx::query("UPDATE pay_lines SET confirmed_at = NULL WHERE id = ?")
        .bind(&first.id)
        .execute(&pool)
        .await
        .unwrap();
    let restarted = executor(&pool, &chain, testnet_venue());
    assert_eq!(restarted.backfill_confirmed_at(None).await.unwrap(), 1);
    assert_eq!(restarted.backfill_confirmed_at(None).await.unwrap(), 0);
    // Recorded once, never rewritten.
    assert!(!db::set_line_confirmed_at(&pool, &first.id, h, "2000-01-01T00:00:00Z")
        .await
        .unwrap());
    let kept = &db::lines(&pool, &run_id).await.unwrap()[0];
    assert_eq!(kept.confirmed_at, Some(block_time(h)));
    // A reorg that takes the payment out of the chain clears it together with the height.
    db::unconfirm_line(&pool, &first.id).await.unwrap();
    let reorged = &db::lines(&pool, &run_id).await.unwrap()[0];
    assert!(reorged.confirmed_height.is_none() && reorged.confirmed_at.is_none());
}

async fn futures_all_mined(chain: &FakeChain, lines: &[db::LineRow]) -> bool {
    for l in lines {
        if chain.mined_height(l.txid.as_deref().unwrap()).await.unwrap().is_none() {
            return false;
        }
    }
    true
}

#[tokio::test]
async fn converting_line_pays_the_venue_deposit_and_carries_the_memo_on_change() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed_run(&pool).await;
    // Switch the second contractor to convert to USDC on Base.
    let lines = db::lines(&pool, &run_id).await.unwrap();
    let mateo = lines.iter().find(|l| l.account_index == 2).unwrap();
    db::update_contractor(
        &pool,
        &mateo.contractor_id,
        &NewContractor {
            name: mateo.contractor_name.clone(),
            email: None,
            unified_address: mateo.unified_address.clone(),
            settlement_choice: "convert_usdc".into(),
            payout_chain: Some("base".into()),
            payout_address: Some("0x2527D02599Ba641c19FEa793cD0F167589a0f10D".into()),
        },
    )
    .await
    .unwrap();
    exec.fund(&run_id, None, None).await.unwrap();
    assert_eq!(run_to_end(&pool, &chain, &exec, &run_id).await, "paid");
    let line = db::lines(&pool, &run_id)
        .await
        .unwrap()
        .into_iter()
        .find(|l| l.account_index == 2)
        .unwrap();
    let mined: Vec<FakeTx> = chain.txs_from(2).into_iter().filter(|t| t.mined_at.is_some()).collect();
    assert_eq!(mined.len(), 1);
    let tx = &mined[0];
    // The ZEC went to the venue's deposit address, with no memo on that transparent output...
    assert_eq!(
        tx.pays,
        vec![Pay {
            to: "tsink:0".into(),
            zat: line.amount_zec.unwrap() as u64,
            memo: None
        }]
    );
    // ...and the pay line memo rides on the change, readable by the contractor's key.
    assert_eq!(tx.change_memo.as_deref(), line.memo.as_deref());
    assert!(line.memo.unwrap().starts_with("PS1|"));
    let conv: serde_json::Value = serde_json::from_str(line.settlement_state.as_deref().unwrap()).unwrap();
    assert_eq!(conv["status"], "processing");
    assert_eq!(conv["simulated"], true);
    assert_eq!(conv["deposit_address"], "tsink:0");
    // The other lines are unaffected.
    assert_eq!(
        chain.external("contractor:0"),
        db::lines(&pool, &run_id).await.unwrap()[0].amount_zec.unwrap() as u64
    );
    exec.refresh_conversions(&run_id).await.unwrap();
    let line = db::lines(&pool, &run_id)
        .await
        .unwrap()
        .into_iter()
        .find(|l| l.account_index == 2)
        .unwrap();
    let conv: serde_json::Value = serde_json::from_str(line.settlement_state.as_deref().unwrap()).unwrap();
    assert_eq!(conv["status"], "simulated");
}

/// A 1Click-like venue whose status follows a script, one entry per poll (the last repeats).
struct PollVenue {
    script: Mutex<Vec<&'static str>>,
}

#[async_trait]
impl SwapVenue for PollVenue {
    fn kind(&self) -> VenueKind {
        VenueKind::NearIntents
    }
    async fn indicative_rate_e6(&self) -> Result<u64, VenueError> {
        Ok(400_000_000)
    }
    async fn quote(&self, req: &QuoteRequest) -> Result<Funding, VenueError> {
        Ok(Funding {
            venue: "near-intents-1click".into(),
            status: "awaiting_deposit".into(),
            deposit_address: Some("0xdep".into()),
            requested_usd_cents: req.usd_cents,
            ..Default::default()
        })
    }
    async fn status(&self, f: &Funding) -> Result<Funding, VenueError> {
        let next = {
            let mut s = self.script.lock().unwrap();
            if s.len() > 1 {
                s.remove(0)
            } else {
                s[0]
            }
        };
        Ok(Funding {
            status: next.into(),
            ..f.clone()
        })
    }
    async fn submit_deposit(&self, f: &Funding, tx: &str) -> Result<Funding, VenueError> {
        Ok(Funding {
            status: "deposit_seen".into(),
            deposit_tx_hash: Some(tx.into()),
            ..f.clone()
        })
    }
}

/// The web moves to the Pay step only when the run turns `funded`. That must happen whatever
/// venue statuses the 5-second polls happen to observe (audit finding SL-01).
#[tokio::test]
async fn funding_completes_whatever_statuses_the_polls_see() {
    for (label, report_deposit, script) in [
        (
            "web wallet reports the deposit, then polls",
            true,
            vec!["deposit_seen", "processing", "success"],
        ),
        (
            "the deposit is seen between two polls",
            false,
            vec!["processing", "success"],
        ),
        (
            "a poll lands on deposit_seen",
            false,
            vec!["deposit_seen", "processing", "success"],
        ),
    ] {
        let (_d, pool) = fresh_db().await;
        let chain = FakeChain::new(0);
        let exec = executor(
            &pool,
            &chain,
            Arc::new(PollVenue {
                script: Mutex::new(script),
            }),
        );
        let run_id = seed_run(&pool).await;
        exec.fund(&run_id, Some("base".into()), Some("0xrefund".into()))
            .await
            .unwrap();
        if report_deposit {
            exec.submit_deposit(&run_id, &format!("0x{}", "ab".repeat(32)))
                .await
                .unwrap();
        }
        for _ in 0..4 {
            exec.refresh_funding(&run_id).await.unwrap();
        }
        let r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
        assert_eq!(r.status, "funded", "{label}");
    }
}

// =============================================================================================
// Audit fixes (service-logic SL-02 to SL-12, 5 Oct 2026). Several are ported from the auditor's
// tests; each asserts the corrected behaviour.

use payslip::runs::{CHANGE_CARRY_ZAT, CONVERT_FEE_ZAT};

/// `n` contractors starting at account `first`, the first `convert` of them converting to USDC.
async fn seed(pool: &Pool, first: u32, n: u32, convert: u32, key: &str) -> String {
    let mut lines = vec![];
    for i in 0..n {
        let conv = i < convert;
        let c = db::insert_contractor(
            pool,
            &NewContractor {
                name: format!("C{}", first + i),
                email: None,
                unified_address: format!("contractor:{}", first + i),
                settlement_choice: if conv { "convert_usdc" } else { "hold_zec" }.into(),
                payout_chain: conv.then(|| "base".into()),
                payout_address: conv.then(|| "0x2527D02599Ba641c19FEa793cD0F167589a0f10D".into()),
            },
            first + i,
            1000,
        )
        .await
        .unwrap();
        lines.push(NewLine {
            contractor_id: c.id,
            amount_usd_cents: 480_000 + 1_000 * i as u64,
            invoice_ref: format!("INV-{}", first + i),
        });
    }
    db::insert_run(pool, Some(key), "2026-09-01", "2026-09-30", &lines)
        .await
        .unwrap()
        .unwrap()
}

/// Mines a block every few milliseconds for up to `ticks` blocks or until the run settles.
async fn drive_for(pool: &Pool, chain: &FakeChain, exec: &Executor, run_id: &str, ticks: u32) -> db::RunRow {
    for _ in 0..ticks {
        chain.mine();
        tokio::time::sleep(Duration::from_millis(4)).await;
        let r = db::get_run(pool, run_id).await.unwrap().unwrap();
        if (r.status == "paid" || r.status == "failed") && !exec.is_running(run_id) {
            return r;
        }
    }
    db::get_run(pool, run_id).await.unwrap().unwrap()
}

fn funding_of(r: &db::RunRow) -> Funding {
    serde_json::from_str(r.venue_state.as_deref().unwrap()).unwrap()
}

/// A 1Click-like venue whose quotes carry `deadline` and whose status is always `status`.
struct DeadlineVenue {
    status: &'static str,
    deadline: String,
    quotes: AtomicU32,
}

impl DeadlineVenue {
    fn lapsed(status: &'static str) -> Self {
        DeadlineVenue {
            status,
            deadline: "2026-01-01T00:00:00Z".into(),
            quotes: AtomicU32::new(0),
        }
    }
}

#[async_trait]
impl SwapVenue for DeadlineVenue {
    fn kind(&self) -> VenueKind {
        VenueKind::NearIntents
    }
    async fn indicative_rate_e6(&self) -> Result<u64, VenueError> {
        Ok(1_354_930_000)
    }
    async fn quote(&self, req: &QuoteRequest) -> Result<Funding, VenueError> {
        let n = self.quotes.fetch_add(1, Ordering::SeqCst);
        Ok(Funding {
            venue: "near-intents-1click".into(),
            status: "awaiting_deposit".into(),
            deposit_address: Some(format!("0xdeposit{n}")),
            deadline: Some(self.deadline.clone()),
            requested_usd_cents: req.usd_cents,
            ..Default::default()
        })
    }
    async fn status(&self, f: &Funding) -> Result<Funding, VenueError> {
        Ok(Funding {
            status: self.status.into(),
            ..f.clone()
        })
    }
    async fn submit_deposit(&self, f: &Funding, _tx: &str) -> Result<Funding, VenueError> {
        Ok(f.clone())
    }
}

/// SL-02: a quote that lapsed (deadline passed, venue says expired, or refunded) fails the run
/// with the hint "Fund the run again". The payer can do exactly that, or cancel the run, after
/// which its contractors can be archived.
#[tokio::test]
async fn a_lapsed_quote_can_be_funded_again_or_cancelled() {
    for status in ["awaiting_deposit", "expired", "refunded"] {
        let (_d, pool) = fresh_db().await;
        let chain = FakeChain::new(100_000_000);
        let exec = executor(&pool, &chain, Arc::new(DeadlineVenue::lapsed(status)));
        let run_id = seed(&pool, 1, 3, 0, "k").await;
        exec.fund(&run_id, Some("base".into()), Some("0xrefund".into()))
            .await
            .unwrap();
        exec.start(&run_id).await.unwrap();
        let r = drive_for(&pool, &chain, &exec, &run_id, 200).await;
        assert_eq!(r.status, "failed", "[{status}]");
        assert!(
            r.error_hint.as_deref().unwrap().contains("Fund the run again"),
            "[{status}] {r:?}"
        );
        // Fund again: a fresh quote and deposit address.
        exec.fund(&run_id, Some("base".into()), Some("0xrefund".into()))
            .await
            .unwrap_or_else(|e| panic!("[{status}] fund again: {e:?}"));
        let r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
        assert_eq!(r.status, "awaiting_funds", "[{status}]");
        assert_eq!(funding_of(&r).deposit_address.as_deref(), Some("0xdeposit1"));
        assert!(r.error_code.is_none());
        // Or give up on it: cancelled, and no longer an active run.
        exec.cancel(&run_id).await.unwrap();
        let r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
        assert_eq!(r.status, "cancelled");
        let line = db::lines(&pool, &run_id).await.unwrap().remove(0);
        assert!(!db::contractor_in_active_run(&pool, &line.contractor_id).await.unwrap());
        assert_eq!(exec.start(&run_id).await.unwrap_err().body.code, "run_cancelled");
        assert_eq!(
            exec.fund(&run_id, None, None).await.unwrap_err().body.code,
            "run_cancelled"
        );
    }
}

/// SL-02: the web wallet reported the deposit, then the venue refunded it. "Request a new
/// deposit address" (fund again) works.
#[tokio::test]
async fn a_refunded_deposit_can_be_requoted() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(0);
    let exec = executor(
        &pool,
        &chain,
        Arc::new(PollVenue {
            script: Mutex::new(vec!["refunded"]),
        }),
    );
    let run_id = seed(&pool, 1, 3, 0, "k").await;
    exec.fund(&run_id, Some("base".into()), Some("0xrefund".into()))
        .await
        .unwrap();
    exec.submit_deposit(&run_id, &format!("0x{}", "ab".repeat(32)))
        .await
        .unwrap();
    exec.refresh_funding(&run_id).await.unwrap();
    assert_eq!(
        funding_of(&db::get_run(&pool, &run_id).await.unwrap().unwrap()).status,
        "refunded"
    );
    exec.fund(&run_id, Some("base".into()), Some("0xrefund".into()))
        .await
        .unwrap();
    let f = funding_of(&db::get_run(&pool, &run_id).await.unwrap().unwrap());
    assert_eq!((f.status.as_str(), f.deposit_tx_hash), ("awaiting_deposit", None));
}

/// SL-10: while the first quote's deposit address is open, a second fund call does not
/// replace it (a deposit already sent there would be tracked by no run).
#[tokio::test]
async fn a_live_deposit_address_is_not_replaced() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(0);
    let deadline = (time::OffsetDateTime::now_utc() + time::Duration::hours(1))
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    let exec = executor(
        &pool,
        &chain,
        Arc::new(DeadlineVenue {
            status: "awaiting_deposit",
            deadline,
            quotes: AtomicU32::new(0),
        }),
    );
    let run_id = seed(&pool, 1, 3, 0, "k").await;
    exec.fund(&run_id, Some("base".into()), Some("0xrefund".into()))
        .await
        .unwrap();
    let err = exec
        .fund(&run_id, Some("arb".into()), Some("0xrefund".into()))
        .await
        .unwrap_err();
    assert_eq!(err.body.code, "quote_still_open");
    assert!(err.body.message.contains("0xdeposit0"));
    let f = funding_of(&db::get_run(&pool, &run_id).await.unwrap().unwrap());
    assert_eq!(f.deposit_address.as_deref(), Some("0xdeposit0"));
}

/// SL-11: GET /funding past the venue's deadline reports the quote expired instead of
/// offering a dead deposit address.
#[tokio::test]
async fn polling_after_the_deadline_reports_expiry() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(0);
    let exec = executor(&pool, &chain, Arc::new(DeadlineVenue::lapsed("awaiting_deposit")));
    let run_id = seed(&pool, 1, 3, 0, "k").await;
    exec.fund(&run_id, Some("base".into()), Some("0xrefund".into()))
        .await
        .unwrap();
    exec.refresh_funding(&run_id).await.unwrap();
    let r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
    assert_eq!(funding_of(&r).status, "expired");
    assert_eq!(r.status, "awaiting_funds");
}

/// SL-02 cancel: refused while the venue holds a deposit for the run, allowed for an open
/// address (the log says where a late deposit goes), a testnet run funded by mistake, and
/// never for a run that received ZEC.
#[tokio::test]
async fn cancel_only_runs_that_received_no_money() {
    // The venue is swapping the deposit: cancelling would leave that money untracked.
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(0);
    let exec = executor(
        &pool,
        &chain,
        Arc::new(PollVenue {
            script: Mutex::new(vec!["processing"]),
        }),
    );
    let run_id = seed(&pool, 1, 3, 0, "k").await;
    exec.fund(&run_id, Some("base".into()), Some("0xrefund".into()))
        .await
        .unwrap();
    assert_eq!(exec.cancel(&run_id).await.unwrap_err().body.code, "deposit_in_progress");
    assert_eq!(
        db::get_run(&pool, &run_id).await.unwrap().unwrap().status,
        "awaiting_funds"
    );

    // An open deposit address with nothing sent: cancel, and a deposit report is refused.
    let (_d, pool) = fresh_db().await;
    let exec = executor(
        &pool,
        &chain,
        Arc::new(PollVenue {
            script: Mutex::new(vec!["awaiting_deposit"]),
        }),
    );
    let run_id = seed(&pool, 1, 3, 0, "k").await;
    exec.fund(&run_id, Some("base".into()), Some("0xrefund".into()))
        .await
        .unwrap();
    exec.cancel(&run_id).await.unwrap();
    exec.cancel(&run_id).await.unwrap(); // idempotent
    assert_eq!(db::get_run(&pool, &run_id).await.unwrap().unwrap().status, "cancelled");
    assert_eq!(
        exec.submit_deposit(&run_id, &format!("0x{}", "cd".repeat(32)))
            .await
            .unwrap_err()
            .body
            .code,
        "run_cancelled"
    );
    let events: Vec<String> = db::events(&pool, &run_id)
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.message)
        .collect();
    assert!(events.iter().any(|m| m.contains("unassigned balance")), "{events:?}");

    // Testnet: funded from the treasury's own balance, nothing moved yet.
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed_run(&pool).await;
    exec.fund(&run_id, None, None).await.unwrap();
    assert_eq!(db::get_run(&pool, &run_id).await.unwrap().unwrap().status, "funded");
    exec.cancel(&run_id).await.unwrap();
    assert_eq!(db::get_run(&pool, &run_id).await.unwrap().unwrap().status, "cancelled");

    // A paid run stays on record.
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed_run(&pool).await;
    exec.fund(&run_id, None, None).await.unwrap();
    assert_eq!(run_to_end(&pool, &chain, &exec, &run_id).await, "paid");
    assert_eq!(exec.cancel(&run_id).await.unwrap_err().body.code, "run_has_funds");
}

/// A mainnet-like 1Click fill for exactly the requested USD, with USDC conversions. The test
/// decides how much ZEC arrives.
struct FillVenue;

#[async_trait]
impl SwapVenue for FillVenue {
    fn kind(&self) -> VenueKind {
        VenueKind::NearIntents
    }
    async fn indicative_rate_e6(&self) -> Result<u64, VenueError> {
        Ok(400_000_000) // $400 per ZEC
    }
    async fn quote(&self, req: &QuoteRequest) -> Result<Funding, VenueError> {
        Ok(Funding {
            venue: "near-intents-1click".into(),
            status: "awaiting_deposit".into(),
            deposit_address: Some("0xdep".into()),
            requested_usd_cents: req.usd_cents,
            ..Default::default()
        })
    }
    async fn status(&self, f: &Funding) -> Result<Funding, VenueError> {
        Ok(Funding {
            status: "success".into(),
            funded_usd_cents: Some(f.requested_usd_cents),
            delivered_txids: vec!["d1".into()],
            ..f.clone()
        })
    }
    async fn submit_deposit(&self, f: &Funding, _tx: &str) -> Result<Funding, VenueError> {
        Ok(f.clone())
    }
    async fn quote_conversion(
        &self,
        req: &payslip::venue::ConversionRequest,
    ) -> Result<payslip::venue::Conversion, VenueError> {
        Ok(payslip::venue::Conversion {
            venue: "near-intents-1click".into(),
            status: "quoted".into(),
            deposit_address: "t1venue".into(),
            amount_zat: req.amount_zat,
            payout_chain: req.payout_chain.clone(),
            payout_address: req.payout_address.clone(),
            ..Default::default()
        })
    }
}

/// SL-04: the USD the service asks for always covers the run it funds, however many lines
/// convert to USDC (each needs 25,000 zat of overhead, not 10,000), into a fresh treasury,
/// even when the fill comes in 3% under the indicative price.
#[tokio::test]
async fn the_funding_request_covers_converting_lines() {
    for factor_pct in [100u64, 97] {
        for convert in [0u32, 3, 4, 6] {
            let (_d, pool) = fresh_db().await;
            let chain = FakeChain::new(0);
            chain.hooks.lock().unwrap().convert_fee = true;
            let exec = executor(&pool, &chain, Arc::new(FillVenue));
            let run_id = seed(&pool, 1, 6, convert, "k").await;
            exec.fund(&run_id, Some("base".into()), Some("0xrefund".into()))
                .await
                .unwrap();
            let f = funding_of(&db::get_run(&pool, &run_id).await.unwrap().unwrap());
            let delivered =
                payslip::money::usd_cents_to_zat(f.requested_usd_cents, 400_000_000).unwrap() * factor_pct / 100;
            chain.hooks.lock().unwrap().received.insert("d1".into(), delivered);
            chain.s.lock().unwrap().spendable.insert(0, delivered);
            exec.start(&run_id).await.unwrap();
            let r = drive_for(&pool, &chain, &exec, &run_id, 600).await;
            assert_eq!(
                (r.status.as_str(), r.error_code.as_deref()),
                ("paid", None),
                "{convert} of 6 converting at {factor_pct}% of the indicative fill: {:?}",
                r.error_message
            );
            // Converting accounts keep exactly the change carry; held ones end at zero.
            for i in 1..=6u32 {
                let left = chain.spendable(i).await.unwrap();
                let expect = if i <= convert { CHANGE_CARRY_ZAT } else { 0 };
                assert_eq!(left, expect, "account {i}");
            }
        }
    }
    let _ = CONVERT_FEE_ZAT;
}

/// SL-05: switching a contractor to Convert to USDC after their run was funded does not
/// change that run: it pays the way it was funded (held ZEC to their address) and finishes.
#[tokio::test]
async fn a_settlement_change_after_funding_does_not_change_the_run() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    chain.hooks.lock().unwrap().convert_fee = true;
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed(&pool, 1, 3, 0, "k").await;
    exec.fund(&run_id, None, None).await.unwrap();
    let line = db::lines(&pool, &run_id).await.unwrap().remove(0);
    db::update_contractor(
        &pool,
        &line.contractor_id,
        &NewContractor {
            name: line.contractor_name.clone(),
            email: None,
            unified_address: "contractor:new".into(),
            settlement_choice: "convert_usdc".into(),
            payout_chain: Some("base".into()),
            payout_address: Some("0x000000000000000000000000000000000000dEaD".into()),
        },
    )
    .await
    .unwrap();
    exec.start(&run_id).await.unwrap();
    let r = drive_for(&pool, &chain, &exec, &run_id, 3000).await;
    assert_eq!(r.status, "paid", "{r:?}");
    let l = db::lines(&pool, &run_id).await.unwrap().remove(0);
    assert_eq!(l.settlement_choice, "hold_zec");
    assert_eq!(chain.external("contractor:1"), l.amount_zec.unwrap() as u64);
    assert_eq!(chain.external("contractor:new"), 0);
}

/// SL-05: a payment its account cannot cover does not wait silently for ever: the line and
/// the run carry `line_underfunded` with a hint.
#[tokio::test]
async fn an_underfunded_payment_fails_with_an_error() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    chain.hooks.lock().unwrap().insufficient_from = Some(2);
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed(&pool, 1, 3, 0, "k").await;
    exec.fund(&run_id, None, None).await.unwrap();
    exec.start(&run_id).await.unwrap();
    let r = drive_for(&pool, &chain, &exec, &run_id, 3000).await;
    assert_eq!(
        (r.status.as_str(), r.error_code.as_deref()),
        ("failed", Some("line_underfunded"))
    );
    let l = db::lines(&pool, &run_id)
        .await
        .unwrap()
        .into_iter()
        .find(|l| l.account_index == 2)
        .unwrap();
    assert_eq!(l.error_code.as_deref(), Some("line_underfunded"));
    // Fixed, then executed again: it resumes and pays.
    chain.hooks.lock().unwrap().insufficient_from = None;
    exec.start(&run_id).await.unwrap();
    assert_eq!(drive_for(&pool, &chain, &exec, &run_id, 3000).await.status, "paid");
}

/// SL-07: lightwalletd refuses one contractor's payment every time. The line shows the node's
/// reason at once, and after three refused rebuilds the run stops with `broadcast_rejected`.
#[tokio::test]
async fn a_payment_the_node_keeps_refusing_fails_the_run_with_its_reason() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    chain.hooks.lock().unwrap().reject_broadcast_from = Some(2);
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed(&pool, 1, 3, 0, "k").await;
    exec.fund(&run_id, None, None).await.unwrap();
    exec.start(&run_id).await.unwrap();
    // Soon after the payment is built the line carries the node's reason.
    let mut flagged = false;
    for _ in 0..400 {
        chain.mine();
        tokio::time::sleep(Duration::from_millis(4)).await;
        let l = db::lines(&pool, &run_id)
            .await
            .unwrap()
            .into_iter()
            .find(|l| l.account_index == 2)
            .unwrap();
        if l.error_code.as_deref() == Some("broadcast_rejected") {
            assert!(l.error_message.unwrap().contains("bad-txns-orchard-anchor-invalid"));
            assert_eq!(l.status, "broadcast");
            flagged = true;
            break;
        }
    }
    assert!(flagged, "the refusal shows on the line");
    let r = drive_for(&pool, &chain, &exec, &run_id, 1500).await;
    assert_eq!(
        (r.status.as_str(), r.error_code.as_deref()),
        ("failed", Some("broadcast_rejected"))
    );
    assert!(r.error_message.unwrap().contains("bad-txns-orchard-anchor-invalid"));
    assert_eq!(chain.txs_from(2).len(), 3, "built three times, then stopped");
    // The other lines were paid.
    let paid = db::lines(&pool, &run_id)
        .await
        .unwrap()
        .into_iter()
        .filter(|l| l.status == "confirmed")
        .count();
    assert_eq!(paid, 2);
}

/// SL-08: fees_zat is the fees of mined transactions; a payment that expired unmined and was
/// rebuilt paid no fee.
#[tokio::test]
async fn fees_count_only_mined_transactions() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    chain.hooks.lock().unwrap().drop_first_from = Some(2);
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed(&pool, 1, 3, 0, "k").await;
    exec.fund(&run_id, None, None).await.unwrap();
    exec.start(&run_id).await.unwrap();
    let r = drive_for(&pool, &chain, &exec, &run_id, 4000).await;
    assert_eq!(r.status, "paid");
    assert_eq!(chain.txs_from(2).len(), 2, "one payment was dropped and rebuilt");
    let s = chain.s.lock().unwrap();
    let mined_fees: u64 = s.txs.values().filter(|t| t.mined_at.is_some()).map(|t| t.fee).sum();
    assert_eq!(r.fees_zat as u64, mined_fees);
}

/// SL-09: a contractor archived after a draft run was created is not paid by it: funding is
/// refused with a hint to discard the draft.
#[tokio::test]
async fn an_archived_contractor_is_not_paid_by_a_draft_run() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed(&pool, 1, 3, 0, "k").await;
    let line = db::lines(&pool, &run_id).await.unwrap().remove(0);
    db::archive_contractor(&pool, &line.contractor_id).await.unwrap();
    let err = exec.fund(&run_id, None, None).await.unwrap_err();
    assert_eq!(err.body.code, "contractor_archived");
    assert!(err.body.hint.contains("Discard"));
    assert_eq!(db::get_run(&pool, &run_id).await.unwrap().unwrap().status, "draft");
    assert!(db::delete_draft_run(&pool, &run_id).await.unwrap());
}

/// SL-12: after a restart, a run the payer executed while it awaited its deposit is resumed;
/// a run that was only funded (never executed) is not paid by a restart.
#[tokio::test]
async fn resume_all_resumes_executed_runs_only() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    let venue = || -> Arc<dyn SwapVenue> {
        Arc::new(PollVenue {
            script: Mutex::new(vec!["awaiting_deposit"]),
        })
    };
    let exec = executor(&pool, &chain, venue());
    let waiting = seed(&pool, 1, 3, 0, "a").await;
    exec.fund(&waiting, Some("base".into()), Some("0xrefund".into()))
        .await
        .unwrap();
    exec.start(&waiting).await.unwrap();
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert!(exec.is_running(&waiting));
    // Funded on testnet but never executed.
    let texec = executor(&pool, &chain, testnet_venue());
    let funded_only = seed(&pool, 4, 3, 0, "b").await;
    texec.fund(&funded_only, None, None).await.unwrap();
    // The process restarts.
    let exec2 = executor(&pool, &chain, venue());
    exec2.resume_all().await;
    assert!(exec2.is_running(&waiting), "the executed run resumes");
    assert!(!exec2.is_running(&funded_only), "funding alone never pays");
}

/// A crash after the allocation is built and stored, before its txid reaches payslip.db: the
/// restarted service pays every line once.
#[tokio::test]
async fn crash_after_building_the_allocation_pays_once() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    chain.hooks.lock().unwrap().panic_after_create_from = Some(0);
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed(&pool, 1, 3, 0, "k").await;
    exec.fund(&run_id, None, None).await.unwrap();
    exec.start(&run_id).await.unwrap();
    for _ in 0..200 {
        tokio::time::sleep(Duration::from_millis(4)).await;
        if !exec.is_running(&run_id) {
            break;
        }
    }
    assert!(db::get_run(&pool, &run_id)
        .await
        .unwrap()
        .unwrap()
        .allocation_txid
        .is_none());
    let exec2 = executor(&pool, &chain, testnet_venue());
    exec2.resume_all().await;
    let r = drive_for(&pool, &chain, &exec2, &run_id, 4000).await;
    assert_eq!(r.status, "paid");
    let mined = chain.txs_from(0).iter().filter(|t| t.mined_at.is_some()).count();
    assert_eq!(mined, 1, "one allocation mined");
    for l in db::lines(&pool, &run_id).await.unwrap() {
        assert_eq!(chain.external(&l.unified_address), l.amount_zec.unwrap() as u64);
    }
}

/// Two runs funded against a treasury that covers one: the second fails with
/// `treasury_insufficient` and a hint instead of waiting for ever.
#[tokio::test]
async fn a_second_run_on_a_short_treasury_fails_with_a_hint() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(1_300_000);
    let exec = executor(&pool, &chain, testnet_venue());
    let a = seed(&pool, 1, 3, 0, "a").await;
    let b = seed(&pool, 4, 3, 0, "b").await;
    exec.fund(&a, None, None).await.unwrap();
    if exec.fund(&b, None, None).await.is_err() {
        return; // refused up front: fine
    }
    exec.start(&a).await.unwrap();
    exec.start(&b).await.unwrap();
    for _ in 0..3000 {
        chain.mine();
        tokio::time::sleep(Duration::from_millis(4)).await;
        let ra = db::get_run(&pool, &a).await.unwrap().unwrap();
        let rb = db::get_run(&pool, &b).await.unwrap().unwrap();
        let done = |r: &db::RunRow, id: &str| (r.status == "paid" || r.status == "failed") && !exec.is_running(id);
        if done(&ra, &a) && done(&rb, &b) {
            break;
        }
    }
    let rb = db::get_run(&pool, &b).await.unwrap().unwrap();
    assert!(rb.status == "failed" || rb.status == "paid", "{rb:?}");
}

// ---------------------------------------------------------------------------------------------
// Fund with ZEC (ADR-025)

use payslip::{
    money,
    runs::{fee_estimate_zat, FundMethod, FundRequest},
};

fn zec() -> FundRequest {
    FundRequest {
        method: FundMethod::Zec,
        ..Default::default()
    }
}

/// What the treasury must hold for `run_id` at the rate of `height`: each line at that rate
/// plus the fee reserve, as `watch_treasury` and `record_fill` count it.
async fn need_at(pool: &Pool, run_id: &str, height: u32) -> u64 {
    let rate = rate_at_height(height).rate_e6;
    let lines = db::lines(pool, run_id).await.unwrap();
    lines
        .iter()
        .map(|l| money::usd_cents_to_zat(l.amount_usd_basis as u64, rate).unwrap())
        .sum::<u64>()
        + fee_estimate_zat(lines.len(), 0)
}

/// The payer sends the ZEC asked for; while it is unconfirmed the run shows it as pending and
/// is not funded; once it confirms the run is funded at the rate of that block, the rate is the
/// USD basis of every line and of the funding record on chain, and the run pays as usual.
#[tokio::test]
async fn zec_funding_funds_the_run_when_the_treasury_balance_confirms() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(0);
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed_run(&pool).await;
    exec.fund_with(&run_id, zec()).await.unwrap();
    let r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
    assert_eq!(r.status, "awaiting_funds");
    let f = funding_of(&r);
    assert_eq!(f.venue, "treasury");
    assert_eq!(f.status, "awaiting_deposit");
    assert_eq!(f.treasury_address.as_deref(), Some("acct:0"));
    assert_eq!(f.deposit_address.as_deref(), Some("acct:0"));
    assert!(f.deadline.is_some());
    let asked = f.zec_required_zat.unwrap();
    assert_eq!(asked, f.quoted_zat);
    // The request covers the run at the current rate with the 2 percent buffer.
    assert!(asked > need_at(&pool, &run_id, 1000).await, "{asked}");
    assert_eq!(f.zec_received_zat, Some(0));
    assert_eq!(f.zec_shortfall_zat, Some(need_at(&pool, &run_id, 1000).await));

    // Seen but not confirmed: not funded, shown as pending.
    chain.receive_pending(0, asked);
    exec.refresh_funding(&run_id).await.unwrap();
    let r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
    assert_eq!(r.status, "awaiting_funds");
    let f = funding_of(&r);
    assert_eq!(f.status, "deposit_seen");
    assert_eq!(f.zec_pending_zat, Some(asked));
    assert_eq!(f.zec_received_zat, Some(0));
    assert_eq!(f.venue_status.as_deref(), Some("CONFIRMING"));

    // Confirmed at block 1000: funded at that block's rate.
    chain.confirm_pending();
    exec.refresh_funding(&run_id).await.unwrap();
    let r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
    assert_eq!(r.status, "funded");
    let f = funding_of(&r);
    let expected = rate_at_height(1000);
    assert_eq!(f.status, "success");
    assert_eq!(f.funded_at_height, Some(1000));
    assert_eq!(f.rate_usd_per_zec_e6, Some(expected.rate_e6));
    assert_eq!(f.priced_at, Some(expected.priced_at.clone()));
    assert_eq!(f.zec_acquired_zat, Some(asked));
    assert_eq!(f.zec_shortfall_zat, Some(0));
    assert_eq!(
        f.funded_usd_cents,
        Some(money::zat_to_usd_cents(asked, expected.rate_e6))
    );
    // Funding alone never pays.
    assert!(!exec.is_running(&run_id));

    assert_eq!(run_to_end(&pool, &chain, &exec, &run_id).await, "paid");
    assert_paid_exactly_once(&pool, &chain, &run_id).await;
    let r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
    assert_eq!(r.zec_usd_rate, Some(expected.rate_e6 as i64));
    assert_eq!(r.zec_acquired, Some(asked as i64));
    assert_eq!(r.funding_amount, f.funded_usd_cents.map(|c| c as i64));
    // Every line's ZEC is its USD at the funding block's rate, and valuing that ZEC the way a
    // statement values a payment received in that block gives the same USD, to the cent.
    let t = BLOCK_T0 + 75 * 1000;
    for l in db::lines(&pool, &run_id).await.unwrap() {
        let zat = l.amount_zec.unwrap() as u64;
        assert_eq!(
            zat,
            money::usd_cents_to_zat(l.amount_usd_basis as u64, expected.rate_e6).unwrap()
        );
        let market = prices::value_at(&series_around(t), t, zat, prices::DAY_MAX_GAP, "usd").unwrap();
        assert_eq!(market.value_cents, money::zat_to_usd_cents(zat, expected.rate_e6));
        assert_eq!(market.price_cents * 10_000, expected.rate_e6);
    }
    // The funding record on chain carries the same figures, so Books reconciles it as any run.
    let allocation = chain.txs_from(0).into_iter().find(|t| t.mined_at.is_some()).unwrap();
    match memo::decode_str(allocation.change_memo.as_deref().unwrap()) {
        memo::Decoded::Payslip(memo::PayslipMemo::RunFunding(m)) => {
            assert_eq!(m.funded_usd_cents, f.funded_usd_cents.unwrap());
            assert_eq!(m.zec_acquired_zat, asked);
            assert_eq!(m.rate_e6, expected.rate_e6);
        }
        other => panic!("{other:?}"),
    }
}

/// Part of the ZEC arrives: the run says what is still missing at the current rate and waits;
/// the rest funds it.
#[tokio::test]
async fn zec_funding_shows_the_shortfall_until_the_rest_arrives() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(0);
    let exec = executor(&pool, &chain, testnet_venue());
    let run_id = seed_run(&pool).await;
    exec.fund_with(&run_id, zec()).await.unwrap();
    let need = need_at(&pool, &run_id, 1000).await;
    let half = need / 2;
    chain.receive(0, half);
    exec.refresh_funding(&run_id).await.unwrap();
    let r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
    assert_eq!(r.status, "awaiting_funds");
    let f = funding_of(&r);
    assert_eq!(f.status, "deposit_seen");
    assert_eq!(f.zec_received_zat, Some(half));
    assert_eq!(f.zec_pending_zat, Some(0));
    assert_eq!(f.zec_shortfall_zat, Some(need - half));
    assert_eq!(f.venue_status.as_deref(), Some("PARTIAL"));
    // The payer sends the rest (and a little more): funded with what is free, at least the
    // need, at most what was asked for; the surplus stays in the treasury.
    chain.receive(0, need - half + 1_000);
    exec.refresh_funding(&run_id).await.unwrap();
    let r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
    assert_eq!(r.status, "funded");
    let f = funding_of(&r);
    assert_eq!(f.status, "success");
    assert_eq!(f.zec_shortfall_zat, Some(0));
    assert_eq!(f.zec_acquired_zat, Some(need + 1_000));
    assert_eq!(run_to_end(&pool, &chain, &exec, &run_id).await, "paid");
    assert_paid_exactly_once(&pool, &chain, &run_id).await;
}

/// Past the deadline an unfunded request is expired: executing fails the run with
/// `funding_expired`; the run can be funded again (ZEC already in the treasury counts) or
/// cancelled through the existing endpoints.
#[tokio::test]
async fn an_expired_zec_request_can_be_funded_again_or_cancelled() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(0);
    let lapsed = Arc::new(TreasuryVenue::new(Arc::new(SeriesRates)).with_deadline(time::Duration::minutes(-20)));
    let exec = executor_with(&pool, &chain, testnet_venue(), lapsed, 1);
    let a = seed(&pool, 1, 3, 0, "a").await;
    let b = seed(&pool, 4, 3, 0, "b").await;
    for run_id in [&a, &b] {
        exec.fund_with(run_id, zec()).await.unwrap();
        exec.refresh_funding(run_id).await.unwrap();
        let r = db::get_run(&pool, run_id).await.unwrap().unwrap();
        assert_eq!(r.status, "awaiting_funds");
        assert_eq!(funding_of(&r).status, "expired");
        exec.start(run_id).await.unwrap();
        assert_eq!(drive_for(&pool, &chain, &exec, run_id, 50).await.status, "failed");
        let r = db::get_run(&pool, run_id).await.unwrap().unwrap();
        assert_eq!(r.error_code.as_deref(), Some("funding_expired"));
        assert!(r.error_hint.as_deref().unwrap().contains("Fund the run again"));
    }
    // A: funded again, from a service whose deadline is the usual 24 hours; the ZEC that
    // arrived meanwhile (20 ZEC, more than the $14,430 run needs) funds it at once.
    chain.receive(0, 2_000_000_000);
    let exec2 = executor(&pool, &chain, testnet_venue());
    exec2.fund_with(&a, zec()).await.unwrap();
    let r = db::get_run(&pool, &a).await.unwrap().unwrap();
    assert_eq!(r.status, "funded", "{r:?}");
    assert_eq!(run_to_end(&pool, &chain, &exec2, &a).await, "paid");
    // B: cancelled instead.
    exec2.cancel(&b).await.unwrap();
    assert_eq!(db::get_run(&pool, &b).await.unwrap().unwrap().status, "cancelled");
}

/// PAYSLIP_MAX_RUN_USD_CENTS: a payroll over the cap is refused with `run_over_cap`, whichever
/// method funds it; one under it goes through.
#[tokio::test]
async fn a_run_over_the_cap_is_refused() {
    let (_d, pool) = fresh_db().await;
    // 20 ZEC: covers the $16,450.00 run at the test rate.
    let chain = FakeChain::new(2_000_000_000);
    let run_id = seed_run(&pool).await;
    let exec = executor(&pool, &chain, testnet_venue()).with_run_cap(Some(1_000_000));
    for req in [zec(), FundRequest::default()] {
        let err = exec.fund_with(&run_id, req).await.unwrap_err();
        assert_eq!(err.status, axum::http::StatusCode::BAD_REQUEST);
        assert_eq!(err.body.code, "run_over_cap");
        assert!(err.body.message.contains("16450.00") && err.body.message.contains("10000.00"));
        assert!(err.body.hint.contains("PAYSLIP_MAX_RUN_USD_CENTS"));
    }
    assert_eq!(db::get_run(&pool, &run_id).await.unwrap().unwrap().status, "draft");
    let exec = executor(&pool, &chain, testnet_venue()).with_run_cap(Some(1_645_000));
    exec.fund_with(&run_id, zec()).await.unwrap();
    assert_eq!(db::get_run(&pool, &run_id).await.unwrap().unwrap().status, "funded");
}

// =============================================================================================
// Recorded approvals (migration 0007): the executor moves no money on a run short of them.

use payslip::auth::{store, Claims, Role};

/// A member of the organisation, as the guard would create one from a sign-in token.
async fn member(pool: &Pool, email: &str, name: &str) -> store::User {
    let claims = Claims {
        sub: format!("user-{}", email.split('@').next().unwrap()),
        email: Some(email.into()),
        email_verified: true,
        name: Some(name.into()),
        picture: None,
        google_sub: None,
        sid: None,
        exp: 0,
    };
    store::find_or_create_user(pool, &claims, email).await.unwrap().unwrap()
}

/// The service-side transition from `funded` to `swapping` waits for the approvals: a run driven
/// short of them (as a restart resumes a run executed under an earlier policy) stays funded,
/// says so once, and pays once the approval is recorded. `start` refuses it meanwhile, naming
/// what is missing.
#[tokio::test]
async fn the_swap_is_recorded_only_once_the_run_is_approved() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(100_000_000);
    let exec = executor(&pool, &chain, testnet_venue()).with_approvals_required(1);
    let run_id = seed_run(&pool).await;
    exec.fund(&run_id, None, None).await.unwrap();
    assert_eq!(db::get_run(&pool, &run_id).await.unwrap().unwrap().status, "funded");
    let err = exec.start(&run_id).await.unwrap_err();
    assert_eq!(err.body.code, "approvals_required");
    assert!(err.body.message.contains("1 more approval"), "{}", err.body.message);
    assert!(!exec.is_running(&run_id));
    assert_eq!(db::get_run(&pool, &run_id).await.unwrap().unwrap().status, "funded");
    // Driven anyway: the run waits in `funded`, and the log says so once.
    let driver = {
        let exec = exec.clone();
        let run_id = run_id.clone();
        tokio::spawn(async move { exec.drive(&run_id).await })
    };
    for _ in 0..30 {
        chain.mine();
        tokio::time::sleep(Duration::from_millis(4)).await;
    }
    assert!(!driver.is_finished());
    let r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
    assert_eq!(r.status, "funded");
    assert!(r.allocation_txid.is_none());
    let waits = db::events(&pool, &run_id)
        .await
        .unwrap()
        .into_iter()
        .filter(|e| e.message == "Waiting for 1 more approval before the swap is recorded")
        .count();
    assert_eq!(waits, 1, "said once, not once per poll");
    // The approval arrives; the same driver records the swap and pays.
    let owner = member(&pool, "owner@acme.test", "Owner").await;
    exec.approve(&run_id, &owner, Role::Admin).await.unwrap();
    let again = exec.approve(&run_id, &owner, Role::Admin).await.unwrap_err();
    assert_eq!(again.body.code, "already_approved");
    for _ in 0..4000 {
        chain.mine();
        tokio::time::sleep(Duration::from_millis(4)).await;
        if driver.is_finished() {
            break;
        }
    }
    assert!(driver.is_finished(), "the run did not finish");
    driver.await.unwrap();
    assert_eq!(db::get_run(&pool, &run_id).await.unwrap().unwrap().status, "paid");
    assert_paid_exactly_once(&pool, &chain, &run_id).await;
    let messages: Vec<String> = db::events(&pool, &run_id)
        .await
        .unwrap()
        .into_iter()
        .map(|e| e.message)
        .collect();
    assert!(
        messages.contains(&"Approved by Owner (admin), approval 1 of 1".to_string()),
        "{messages:?}"
    );
    // A paid run can no longer be approved.
    let other = member(&pool, "other@acme.test", "Other").await;
    let late = exec.approve(&run_id, &other, Role::Approver).await.unwrap_err();
    assert_eq!(late.body.code, "run_not_approvable");
}

/// The same on the USDC path: a venue already swapping the deposit does not move the run to
/// `swapping` until the approvals are in; a restart that resumes the run finds it waiting. With
/// two required, the creator's approval is refused and one of two is not enough.
#[tokio::test]
async fn a_resumed_run_waits_for_its_approvals_before_the_swap_is_recorded() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(0);
    let venue: Arc<dyn SwapVenue> = Arc::new(PollVenue {
        script: Mutex::new(vec!["processing"]),
    });
    let exec = executor(&pool, &chain, venue).with_approvals_required(2);
    let run_id = seed_run(&pool).await;
    exec.fund(&run_id, Some("base".into()), Some("0xrefund".into()))
        .await
        .unwrap();
    // Executed under an earlier policy, then the service restarts.
    db::set_execute_requested(&pool, &run_id, true).await.unwrap();
    exec.resume_all().await;
    tokio::time::sleep(Duration::from_millis(60)).await;
    assert!(exec.is_running(&run_id));
    let r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
    assert_eq!(r.status, "awaiting_funds", "never swapping without approvals");
    let waits = db::events(&pool, &run_id)
        .await
        .unwrap()
        .into_iter()
        .filter(|e| e.message == "Waiting for 2 more approvals before the swap is recorded")
        .count();
    assert_eq!(waits, 1);
    // The creator cannot be one of the two.
    let owner = member(&pool, "owner@acme.test", "Owner").await;
    sqlx::query("UPDATE runs SET created_by = ? WHERE id = ?")
        .bind(&owner.id)
        .bind(&run_id)
        .execute(&pool)
        .await
        .unwrap();
    let refused = exec.approve(&run_id, &owner, Role::Admin).await.unwrap_err();
    assert_eq!(refused.body.code, "creator_cannot_approve");
    let ann = member(&pool, "ann@acme.test", "Ann").await;
    let ben = member(&pool, "ben@acme.test", "Ben").await;
    exec.approve(&run_id, &ann, Role::Approver).await.unwrap();
    tokio::time::sleep(Duration::from_millis(40)).await;
    assert_eq!(
        db::get_run(&pool, &run_id).await.unwrap().unwrap().status,
        "awaiting_funds",
        "one of two is not enough"
    );
    exec.approve(&run_id, &ben, Role::Admin).await.unwrap();
    for _ in 0..100 {
        tokio::time::sleep(Duration::from_millis(5)).await;
        if db::get_run(&pool, &run_id).await.unwrap().unwrap().status == "swapping" {
            break;
        }
    }
    assert_eq!(db::get_run(&pool, &run_id).await.unwrap().unwrap().status, "swapping");
    let approvals = db::approvals(&pool, &run_id).await.unwrap();
    assert_eq!(
        approvals.iter().map(|a| a.role.as_str()).collect::<Vec<_>>(),
        ["approver", "admin"]
    );
}

/// Two runs await ZEC and one deposit arrives: the earlier run takes it, the later one keeps
/// waiting with the earlier run's claim held back from what it sees, and a second deposit funds
/// it. Both then pay from the one treasury.
#[tokio::test]
async fn two_runs_awaiting_zec_claim_the_balance_in_order() {
    let (_d, pool) = fresh_db().await;
    let chain = FakeChain::new(0);
    let exec = executor(&pool, &chain, testnet_venue());
    let a = seed(&pool, 1, 3, 0, "a").await;
    let b = seed(&pool, 4, 3, 0, "b").await;
    exec.fund_with(&a, zec()).await.unwrap();
    exec.fund_with(&b, zec()).await.unwrap();
    let asked_a = funding_of(&db::get_run(&pool, &a).await.unwrap().unwrap())
        .zec_required_zat
        .unwrap();
    let asked_b = funding_of(&db::get_run(&pool, &b).await.unwrap().unwrap())
        .zec_required_zat
        .unwrap();
    chain.receive(0, asked_a);
    // B looks first and sees nothing free: A's request comes before it.
    exec.refresh_funding(&b).await.unwrap();
    let rb = db::get_run(&pool, &b).await.unwrap().unwrap();
    assert_eq!(rb.status, "awaiting_funds");
    let fb = funding_of(&rb);
    assert_eq!(fb.status, "awaiting_deposit");
    assert_eq!(fb.zec_received_zat, Some(0));
    assert_eq!(fb.zec_shortfall_zat, Some(need_at(&pool, &b, 1000).await));
    exec.refresh_funding(&a).await.unwrap();
    assert_eq!(db::get_run(&pool, &a).await.unwrap().unwrap().status, "funded");
    // Still nothing free for B: A, funded but not yet allocated, holds its ZEC.
    exec.refresh_funding(&b).await.unwrap();
    assert_eq!(
        funding_of(&db::get_run(&pool, &b).await.unwrap().unwrap()).zec_received_zat,
        Some(0)
    );
    chain.receive(0, asked_b);
    exec.refresh_funding(&b).await.unwrap();
    let rb = db::get_run(&pool, &b).await.unwrap().unwrap();
    assert_eq!(rb.status, "funded");
    assert_eq!(funding_of(&rb).zec_acquired_zat, Some(asked_b));
    exec.start(&a).await.unwrap();
    exec.start(&b).await.unwrap();
    for _ in 0..4000 {
        chain.mine();
        tokio::time::sleep(Duration::from_millis(4)).await;
        let ra = db::get_run(&pool, &a).await.unwrap().unwrap();
        let rb = db::get_run(&pool, &b).await.unwrap().unwrap();
        if ra.status == "paid" && rb.status == "paid" && !exec.is_running(&a) && !exec.is_running(&b) {
            break;
        }
    }
    for run_id in [&a, &b] {
        let r = db::get_run(&pool, run_id).await.unwrap().unwrap();
        assert_eq!(r.status, "paid", "{r:?}");
        for l in db::lines(&pool, run_id).await.unwrap() {
            assert_eq!(l.status, "confirmed");
            assert_eq!(chain.external(&l.unified_address), l.amount_zec.unwrap() as u64);
        }
    }
}
