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
    runs::{ChainOps, Executor, Pay, LINE_FEE_ZAT},
    venue::{Funding, QuoteRequest, SwapVenue, TestnetVenue, VenueError},
    wallet::SpendError,
};

const RATE: u64 = 1_350_000_000_000;
const EXPIRY_DELTA: u32 = 40;

#[derive(Clone, Debug)]
struct FakeTx {
    from: u32,
    pays: Vec<Pay>,
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

    fn external(&self, addr: &str) -> u64 {
        self.s.lock().unwrap().external.get(addr).copied().unwrap_or(0)
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
        self.spendable(account).await
    }
    async fn account_address(&self, account: u32) -> anyhow::Result<String> {
        Ok(format!("acct:{account}"))
    }
    async fn create_transfer(
        &self,
        from: u32,
        pays: Vec<Pay>,
        _change_memo: Option<String>,
    ) -> anyhow::Result<Result<String, SpendError>> {
        if self.hooks.lock().unwrap().disk_full {
            anyhow::bail!("database or disk is full");
        }
        let fee = if pays.len() <= 1 {
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
    async fn received_in_tx(&self, _txid: &str, _account: u32) -> anyhow::Result<u64> {
        Ok(0)
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
    Executor::with_chain(
        ZcashNetwork::Testnet,
        pool.clone(),
        Arc::new(chain.clone()),
        venue,
        Duration::from_millis(5),
    )
}

fn testnet_venue() -> Arc<dyn SwapVenue> {
    Arc::new(TestnetVenue { rate_e6: RATE })
}

/// Mines a block every few milliseconds until the run reaches a terminal state.
async fn run_to_end(pool: &Pool, chain: &FakeChain, exec: &Executor, run_id: &str) -> String {
    exec.start(run_id).await.unwrap();
    for _ in 0..4000 {
        chain.mine();
        tokio::time::sleep(Duration::from_millis(2)).await;
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
        tokio::time::sleep(Duration::from_millis(2)).await;
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
    let _ = tokio::time::timeout(Duration::from_millis(300), async move { e1.drive(&rid).await }).await;
    let r = db::get_run(&pool, &run_id).await.unwrap().unwrap();
    assert_eq!(r.status, "allocating");
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
