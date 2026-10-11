//! HTTP API behaviour that needs no chain, driven over a real socket: a statements-only service
//! whose lightwalletd is unreachable (every answer must come before any scan), and a full-mode
//! service with no payer wallet whose executor runs on a stub chain (endpoints that only read and
//! write payslip.db).

use std::{net::SocketAddr, path::Path, sync::Arc, time::Duration};

use async_trait::async_trait;
use payslip::{
    api::{self, AppState},
    config::{AuthConfig, Config, VenueKind, ZcashNetwork},
    db::{self, NewContractor, Pool},
    prices::{MarketRate, RateAt},
    runs::{ChainOps, Executor, Pay},
    venue::TreasuryVenue,
    viewer::{ViewerRegistry, ViewingKey},
    wallet::SpendError,
};
use serde_json::{json, Value};
use zcash_protocol::consensus::Network;

fn config(dir: &Path, bind: SocketAddr) -> Config {
    Config {
        network: ZcashNetwork::Testnet,
        // Nothing listens on port 9: any request that reached the chain would fail.
        lightwalletd_url: "http://127.0.0.1:9".into(),
        data_dir: dir.to_path_buf(),
        bind,
        web_origin: "http://localhost:3000".into(),
        seed_passphrase: None,
        venue: VenueKind::TestnetFixedRate,
        testnet_rate_e6: payslip::config::DEFAULT_TESTNET_RATE_E6,
        near_intents_api_url: String::new(),
        near_intents_jwt: None,
        maya_api_url: String::new(),
        maya_midgard_url: String::new(),
        min_confirmations: 1,
        birthday_height: None,
        statements_only: true,
        viewer_birthday_height: None,
        price_api_url: None,
        price_api_key: None,
        allowed_hosts: vec![],
        allow_remote_payer: false,
        app_fee_bps: 0,
        app_fee_recipient: None,
        auth: AuthConfig::off(),
        max_run_usd_cents: None,
    }
}

/// A fixed ZEC market rate (1,234.42 USD, CoinGecko on 11 Oct 2026) for runs funded with ZEC.
struct StubRates;

const STUB_RATE_E6: u64 = 1_234_420_000;

#[async_trait]
impl MarketRate for StubRates {
    async fn usd_rate_at(&self, unix: i64) -> anyhow::Result<Option<RateAt>> {
        Ok(Some(RateAt {
            rate_e6: STUB_RATE_E6,
            priced_at: payslip::statements::block_time_rfc3339(unix).unwrap(),
        }))
    }
}

struct Service {
    base: String,
    cfg: Config,
    http: reqwest::Client,
    _dir: tempfile::TempDir,
}

async fn start() -> Service {
    let dir = tempfile::tempdir().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let cfg = config(dir.path(), addr);
    let state = api::build_state(cfg.clone()).await.unwrap();
    tokio::spawn(async move { axum::serve(listener, api::router(state)).await.unwrap() });
    Service {
        base: format!("http://{addr}"),
        cfg,
        http: reqwest::Client::new(),
        _dir: dir,
    }
}

/// A chain that knows block times (block h at 1,790,000,000 + 75 h), its tip, the treasury's
/// address and an empty treasury; anything that would move money fails.
struct StubChain;

const STUB_T0: i64 = 1_790_000_000;
const STUB_TIP: u32 = 4_467_300;
const STUB_TREASURY: &str = "utest1stubtreasury";

#[async_trait]
impl ChainOps for StubChain {
    async fn sync(&self) -> anyhow::Result<()> {
        anyhow::bail!("no chain in this test")
    }
    async fn tip(&self) -> anyhow::Result<u32> {
        Ok(STUB_TIP)
    }
    async fn spendable(&self, _: u32) -> anyhow::Result<u64> {
        Ok(0)
    }
    async fn total(&self, _: u32) -> anyhow::Result<u64> {
        Ok(0)
    }
    async fn account_address(&self, account: u32) -> anyhow::Result<String> {
        if account == 0 {
            Ok(STUB_TREASURY.into())
        } else {
            anyhow::bail!("no chain in this test")
        }
    }
    async fn transparent_address(&self, _: u32) -> anyhow::Result<String> {
        anyhow::bail!("no chain in this test")
    }
    async fn create_transfer(
        &self,
        _: u32,
        _: Vec<Pay>,
        _: Option<String>,
    ) -> anyhow::Result<Result<String, SpendError>> {
        anyhow::bail!("no chain in this test")
    }
    async fn broadcast(&self, _: &str) -> anyhow::Result<()> {
        anyhow::bail!("no chain in this test")
    }
    async fn mined_height(&self, _: &str) -> anyhow::Result<Option<u32>> {
        anyhow::bail!("no chain in this test")
    }
    async fn expiry_height(&self, _: &str) -> anyhow::Result<Option<u32>> {
        anyhow::bail!("no chain in this test")
    }
    async fn tx_fee(&self, _: &str) -> anyhow::Result<Option<u64>> {
        anyhow::bail!("no chain in this test")
    }
    async fn received_in_tx(&self, _: &str, _: u32) -> anyhow::Result<u64> {
        anyhow::bail!("no chain in this test")
    }
    async fn block_time(&self, height: u32) -> anyhow::Result<i64> {
        Ok(STUB_T0 + 75 * i64::from(height))
    }
}

/// A full-mode service (payer routes mounted) without a payer wallet: its executor drives the
/// stub chain. Enough for endpoints that touch only payslip.db.
async fn start_full() -> (Service, Pool) {
    start_full_with(|_| {}).await
}

async fn start_full_with(adjust: impl FnOnce(&mut Config)) -> (Service, Pool) {
    let dir = tempfile::tempdir().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let mut cfg = config(dir.path(), addr);
    cfg.statements_only = false;
    adjust(&mut cfg);
    let db = db::open(&cfg.app_db_path()).await.unwrap();
    let venue = payslip::venue::build(&cfg).unwrap();
    let executor = Executor::with_chain(
        cfg.network,
        db.clone(),
        Arc::new(StubChain),
        venue.clone(),
        Arc::new(TreasuryVenue::new(Arc::new(StubRates))),
        Duration::from_millis(5),
        1,
    )
    .with_run_cap(cfg.max_run_usd_cents);
    let state = Arc::new(AppState {
        viewers: ViewerRegistry::new(&cfg),
        db: db.clone(),
        payer: None,
        venue,
        executor: Some(executor),
        contractor_lock: tokio::sync::Mutex::new(()),
        lwd: tokio::sync::Mutex::new(payslip::wallet::lwd::connect(&cfg.lightwalletd_url).unwrap()),
        last_wallet: std::sync::Mutex::new(None),
        prices: Arc::new(payslip::prices::Prices::new(None, None)),
        scan_slots: tokio::sync::Semaphore::new(3),
        sse_slots: Arc::new(tokio::sync::Semaphore::new(api::MAX_EVENT_STREAMS)),
        auth: None,
        cfg: cfg.clone(),
    });
    tokio::spawn(async move { axum::serve(listener, api::router(state)).await.unwrap() });
    let service = Service {
        base: format!("http://{addr}"),
        cfg,
        http: reqwest::Client::new(),
        _dir: dir,
    };
    (service, db)
}

async fn contractor(pool: &Pool, i: u32) -> String {
    db::insert_contractor(
        pool,
        &NewContractor {
            name: format!("Contractor {i}"),
            email: None,
            unified_address: format!("utest1contractor{i}"),
            settlement_choice: "hold_zec".into(),
            payout_chain: None,
            payout_address: None,
        },
        i,
        4_467_000,
    )
    .await
    .unwrap()
    .id
}

fn run_body(start: &str, end: &str, lines: &[(&str, i64, &str)], key: &str) -> Value {
    json!({
        "period_start": start,
        "period_end": end,
        "lines": lines.iter().map(|(c, cents, inv)| json!({"contractor_id": c, "amount_usd_cents": cents, "invoice_ref": inv})).collect::<Vec<_>>(),
        "idempotency_key": key,
    })
}

fn testnet_ufvk(seed: u8) -> String {
    let params = Network::TestNetwork;
    zcash_keys::keys::UnifiedSpendingKey::from_seed(&params, &[seed; 32], zip32::AccountId::ZERO)
        .unwrap()
        .to_unified_full_viewing_key()
        .encode(&params)
}

impl Service {
    async fn post_raw(&self, path: &str, body: impl Into<reqwest::Body>) -> (u16, reqwest::header::HeaderMap, Value) {
        let r = self
            .http
            .post(format!("{}{path}", self.base))
            .header("content-type", "application/json")
            .body(body)
            .send()
            .await
            .unwrap();
        let status = r.status().as_u16();
        let headers = r.headers().clone();
        (status, headers, r.json().await.unwrap_or(Value::Null))
    }

    async fn post(&self, path: &str, body: Value) -> (u16, Value) {
        let (s, _, v) = self.post_raw(path, body.to_string()).await;
        (s, v)
    }

    async fn get(&self, path: &str) -> (u16, Value) {
        let r = self.http.get(format!("{}{path}", self.base)).send().await.unwrap();
        let s = r.status().as_u16();
        (s, r.json().await.unwrap_or(Value::Null))
    }

    /// DELETE with an optional Content-Type and body, as a browser or a script would send it.
    async fn delete(&self, path: &str, content_type: Option<&str>, body: &str) -> (u16, Value) {
        let mut req = self.http.delete(format!("{}{path}", self.base)).body(body.to_string());
        if let Some(ct) = content_type {
            req = req.header("content-type", ct);
        }
        let r = req.send().await.unwrap();
        let s = r.status().as_u16();
        (s, r.json().await.unwrap_or(Value::Null))
    }
}

fn code(v: &Value) -> &str {
    v["error"]["code"].as_str().unwrap_or("")
}

fn has_hint(v: &Value) -> bool {
    v["error"]["hint"].as_str().is_some_and(|h| !h.is_empty())
}

/// Audit SL-15: the framework's own rejections answer in the documented error shape.
#[tokio::test]
async fn framework_rejections_are_json_errors_with_a_hint() {
    let s = start().await;
    let (st, _, v) = s.post_raw("/api/statements/contractor", "{not json").await;
    assert_eq!((st, code(&v)), (400, "invalid_json"), "{v}");
    assert!(has_hint(&v));
    let (st, v) = s
        .post(
            "/api/statements/contractor",
            json!({"ufvk": 5, "from": "2026-09-01", "to": "2026-09-30"}),
        )
        .await;
    assert_eq!((st, code(&v)), (422, "invalid_body"), "{v}");
    assert!(v["error"]["message"].as_str().unwrap().contains("ufvk"));
    assert!(has_hint(&v));
    let (st, v) = s
        .post("/api/statements/accountant", json!({"from": "2026-09-01"}))
        .await;
    assert_eq!((st, code(&v)), (422, "invalid_body"), "{v}");
    let big = format!("{{\"ufvks\": [\"{}\"]}}", "x".repeat(2_200_000));
    let (st, _, v) = s.post_raw("/api/statements/accountant", big).await;
    assert_eq!((st, code(&v)), (413, "body_too_large"), "{v}");
    assert!(has_hint(&v));
    let r = s
        .http
        .put(format!("{}/api/statements/contractor", s.base))
        .header("content-type", "application/json")
        .body("{}")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status().as_u16(), 405);
    assert!(r.headers().get("allow").is_some(), "the Allow header is kept");
    let v: Value = r.json().await.unwrap();
    assert_eq!(code(&v), "method_not_allowed");
    assert!(has_hint(&v));
    let (st, v) = s.get("/api/nope").await;
    assert_eq!((st, code(&v)), (404, "not_found"));
}

/// Audit SL-16: a bad currency is refused before any chain scan (lightwalletd is unreachable
/// here, so a scan would fail with a 500).
#[tokio::test]
async fn an_invalid_currency_is_refused_before_scanning() {
    let s = start().await;
    let (st, v) = s
        .post(
            "/api/statements/contractor",
            json!({"ufvk": testnet_ufvk(1), "from": "2026-09-01", "to": "2026-09-30", "currency": "btc"}),
        )
        .await;
    assert_eq!((st, code(&v)), (400, "invalid_currency"), "{v}");
    let (st, v) = s
        .post(
            "/api/statements/contractor.csv",
            json!({"ufvk": testnet_ufvk(1), "from": "2026-09-01", "to": "2026-09-30", "currency": "xyz"}),
        )
        .await;
    assert_eq!((st, code(&v)), (400, "invalid_currency"), "{v}");
}

/// Audit SEC-09 and SL-14 (low end): a birthday below Ironwood activation is a 400 with the
/// valid range, before any chain call.
#[tokio::test]
async fn a_birthday_below_activation_is_a_400() {
    let s = start().await;
    for b in [0u32, 1, 4_000_000] {
        let (st, v) = s
            .post(
                "/api/statements/accountant",
                json!({"ufvks": [testnet_ufvk(1)], "from": "2026-09-01", "to": "2026-09-30", "birthday_height": b}),
            )
            .await;
        assert_eq!((st, code(&v)), (400, "invalid_birthday_height"), "{b}: {v}");
        assert!(v["error"]["hint"].as_str().unwrap().contains("4134000"));
    }
}

/// Audit SL-22 and JD-08: a statements-only deployment answers every payer endpoint with 404
/// `statements_only`, reads included.
#[tokio::test]
async fn statements_mode_has_no_payer_endpoints() {
    let s = start().await;
    for path in [
        "/api/contractors",
        "/api/runs",
        "/api/wallet",
        "/api/viewing-keys",
        "/api/runs/abc/events",
    ] {
        let (st, v) = s.get(path).await;
        assert_eq!((st, code(&v)), (404, "statements_only"), "{path}: {v}");
    }
    let (st, v) = s.post("/api/runs", json!({})).await;
    assert_eq!((st, code(&v)), (404, "statements_only"));
    let (st, v) = s.post("/api/runs/abc/cancel", json!({})).await;
    assert_eq!((st, code(&v)), (404, "statements_only"));
    let (st, v) = s.get("/api/health").await;
    assert_eq!((st, v["mode"].as_str()), (200, Some("statements")));
}

/// Audit PBL-14: a key set's cached scan can be deleted; it reports whether there was one.
#[tokio::test]
async fn forget_deletes_the_cached_scan_of_exactly_that_key_set() {
    let s = start().await;
    let (a, b) = (testnet_ufvk(1), testnet_ufvk(2));
    let fp = |k: &str| ViewingKey::parse(&ZcashNetwork::Testnet, k).unwrap().fingerprint;
    let registry = ViewerRegistry::new(&s.cfg);
    let both = registry.cache_file(&[&fp(&a), &fp(&b)]);
    let only_a = registry.cache_file(&[&fp(&a)]);
    std::fs::create_dir_all(both.parent().unwrap()).unwrap();
    std::fs::write(&both, b"cache").unwrap();
    std::fs::write(both.with_extension("db-wal"), b"wal").unwrap();
    std::fs::write(&only_a, b"cache").unwrap();
    // Key order does not matter; the single-key cache is a different set and stays.
    let (st, v) = s.post("/api/statements/forget", json!({"ufvks": [b, a]})).await;
    assert_eq!((st, &v), (200, &json!({"forgotten": true})));
    assert!(!both.exists() && !both.with_extension("db-wal").exists());
    assert!(only_a.exists());
    let (st, v) = s
        .post(
            "/api/statements/forget",
            json!({"ufvks": [testnet_ufvk(2), testnet_ufvk(1)]}),
        )
        .await;
    assert_eq!((st, &v), (200, &json!({"forgotten": false})));
    let (st, v) = s.post("/api/statements/forget", json!({"ufvks": ["abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"]})).await;
    assert_eq!((st, code(&v)), (400, "spending_key_rejected"));
    let (st, v) = s.post("/api/statements/forget", json!({"ufvks": []})).await;
    assert_eq!((st, code(&v)), (400, "invalid_viewing_key"));
}

/// Undo "Mark as shared": DELETE clears `fvk_shared_at` and returns the contractor. The web
/// sends `{}` with the JSON header; an empty body with the header works too, no header is 415.
#[tokio::test]
async fn mark_as_shared_can_be_undone() {
    let (s, pool) = start_full().await;
    let id = contractor(&pool, 1).await;
    let path = format!("/api/contractors/{id}/viewing-key/shared");
    let (st, v) = s.post(&path, json!({})).await;
    assert_eq!(st, 200, "{v}");
    assert!(v["fvk_shared_at"].is_string());
    let (st, v) = s.delete(&path, Some("application/json"), "{}").await;
    assert_eq!(st, 200, "{v}");
    assert_eq!(v["id"], json!(id));
    assert!(v["fvk_shared_at"].is_null(), "{v}");
    let (_, v) = s.get(&format!("/api/contractors/{id}")).await;
    assert!(v["fvk_shared_at"].is_null(), "stored: {v}");
    // Again, with an empty body: still 200, still not shared.
    let (st, v) = s.delete(&path, Some("application/json"), "").await;
    assert_eq!((st, v["fvk_shared_at"].is_null()), (200, true), "{v}");
    // Marking again records a new time.
    let (st, v) = s.post(&path, json!({})).await;
    assert_eq!((st, v["fvk_shared_at"].is_string()), (200, true), "{v}");
    let (st, v) = s.delete(&path, None, "").await;
    assert_eq!((st, code(&v)), (415, "json_required"), "{v}");
    let (st, v) = s
        .delete(
            "/api/contractors/no-such-id/viewing-key/shared",
            Some("application/json"),
            "{}",
        )
        .await;
    assert_eq!((st, code(&v)), (404, "not_found"), "{v}");
}

/// The same idempotency key with another period or other lines is a 409, not the earlier run.
/// The same request (lines in any order) still returns the run; a run stored before request
/// hashes keeps the old behaviour.
#[tokio::test]
async fn a_reused_idempotency_key_with_another_body_is_refused() {
    let (s, pool) = start_full().await;
    let (a, b) = (contractor(&pool, 1).await, contractor(&pool, 2).await);
    let body = run_body(
        "2026-09-01",
        "2026-09-30",
        &[(&a, 480_000, "INV-1"), (&b, 625_000, "INV-2")],
        "key-1",
    );
    let (st, first) = s.post("/api/runs", body.clone()).await;
    assert_eq!(st, 201, "{first}");
    let id = first["id"].as_str().unwrap().to_string();
    let (st, again) = s.post("/api/runs", body).await;
    assert_eq!((st, again["id"].as_str()), (200, Some(id.as_str())));
    // Lines in another order, invoice padded with spaces, allow_overlap added: the same request.
    let mut same = run_body(
        "2026-09-01",
        "2026-09-30",
        &[(&b, 625_000, " INV-2 "), (&a, 480_000, "INV-1")],
        "key-1",
    );
    same["allow_overlap"] = json!(true);
    let (st, v) = s.post("/api/runs", same).await;
    assert_eq!((st, v["id"].as_str()), (200, Some(id.as_str())), "{v}");
    for other in [
        run_body(
            "2026-09-01",
            "2026-09-30",
            &[(&a, 480_001, "INV-1"), (&b, 625_000, "INV-2")],
            "key-1",
        ),
        run_body(
            "2026-09-01",
            "2026-09-29",
            &[(&a, 480_000, "INV-1"), (&b, 625_000, "INV-2")],
            "key-1",
        ),
        run_body("2026-09-01", "2026-09-30", &[(&a, 480_000, "INV-1")], "key-1"),
        run_body(
            "2026-09-01",
            "2026-09-30",
            &[(&a, 480_000, "INV-9"), (&b, 625_000, "INV-2")],
            "key-1",
        ),
    ] {
        let (st, v) = s.post("/api/runs", other).await;
        assert_eq!((st, code(&v)), (409, "idempotency_mismatch"), "{v}");
        assert!(has_hint(&v));
        assert_eq!(v["error"]["runs"], json!([id]));
        assert!(v["error"]["message"].as_str().unwrap().contains(&id));
    }
    let (_, v) = s.get("/api/runs").await;
    assert_eq!(v["runs"].as_array().unwrap().len(), 1, "no run was added");
    // A run created before request hashes were stored: the key returns it, as before.
    sqlx::query("UPDATE runs SET idempotency_hash = NULL WHERE id = ?")
        .bind(&id)
        .execute(&pool)
        .await
        .unwrap();
    let (st, v) = s
        .post(
            "/api/runs",
            run_body("2026-09-01", "2026-09-30", &[(&a, 1, "OTHER")], "key-1"),
        )
        .await;
    assert_eq!((st, v["id"].as_str()), (200, Some(id.as_str())), "{v}");
}

/// A run whose period shares a day with a run that is not cancelled is a 409 naming that run,
/// unless `allow_overlap` is true. Invalid requests still get their own 400 first.
#[tokio::test]
async fn an_overlapping_period_needs_allow_overlap() {
    let (s, pool) = start_full().await;
    let (a, b) = (contractor(&pool, 1).await, contractor(&pool, 2).await);
    let (st, sept) = s
        .post(
            "/api/runs",
            run_body("2026-09-01", "2026-09-30", &[(&a, 480_000, "INV-1")], "k-sept"),
        )
        .await;
    assert_eq!(st, 201, "{sept}");
    let sept = sept["id"].as_str().unwrap().to_string();
    // Shares 30 September with the September run.
    let late = run_body("2026-09-30", "2026-10-15", &[(&b, 100_000, "BONUS-1")], "k-late");
    let (st, v) = s.post("/api/runs", late.clone()).await;
    assert_eq!((st, code(&v)), (409, "period_overlap"), "{v}");
    assert_eq!(v["error"]["runs"], json!([sept]));
    let message = v["error"]["message"].as_str().unwrap();
    assert!(
        message.contains(&sept) && message.contains("2026-09-01 to 2026-09-30"),
        "{message}"
    );
    assert!(v["error"]["hint"].as_str().unwrap().contains("allow_overlap"));
    // A request that is invalid anyway gets its own error, not the overlap.
    let (st, v) = s
        .post(
            "/api/runs",
            run_body("2026-09-01", "2026-09-30", &[(&b, 0, "X")], "k-bad"),
        )
        .await;
    assert_eq!((st, code(&v)), (400, "invalid_amount"), "{v}");
    // An extra run on purpose.
    let mut extra = late;
    extra["allow_overlap"] = json!(true);
    let (st, v) = s.post("/api/runs", extra).await;
    assert_eq!(st, 201, "{v}");
    let bonus = v["id"].as_str().unwrap().to_string();
    // Two runs now cover 30 September; both are named.
    let (st, v) = s
        .post(
            "/api/runs",
            run_body("2026-09-30", "2026-09-30", &[(&a, 1_000, "FIX-1")], "k-fix"),
        )
        .await;
    assert_eq!((st, code(&v)), (409, "period_overlap"), "{v}");
    assert_eq!(v["error"]["runs"], json!([sept, bonus]));
    // The next month is no overlap.
    let (st, v) = s
        .post(
            "/api/runs",
            run_body("2026-10-16", "2026-10-31", &[(&a, 480_000, "INV-2")], "k-oct"),
        )
        .await;
    assert_eq!(st, 201, "{v}");
    // Cancelled runs do not count.
    for id in [&sept, &bonus] {
        let (st, v) = s.post(&format!("/api/runs/{id}/cancel"), json!({})).await;
        assert_eq!((st, v["status"].as_str()), (200, Some("cancelled")), "{v}");
    }
    let (st, v) = s
        .post(
            "/api/runs",
            run_body("2026-09-01", "2026-09-30", &[(&a, 480_000, "INV-1")], "k-sept-2"),
        )
        .await;
    assert_eq!(st, 201, "{v}");
}

/// Pay lines in run JSON carry `confirmed_at`: null until confirmed, then the block time of the
/// confirmed height, filled in when the run is read if it was not recorded (as for lines
/// confirmed before the field existed).
#[tokio::test]
async fn run_lines_carry_their_confirmation_time() {
    let (s, pool) = start_full().await;
    let a = contractor(&pool, 1).await;
    let (st, run) = s
        .post(
            "/api/runs",
            run_body("2026-09-01", "2026-09-30", &[(&a, 480_000, "INV-1")], "k-1"),
        )
        .await;
    assert_eq!(st, 201, "{run}");
    let line = &run["lines"][0];
    assert!(line.as_object().unwrap().contains_key("confirmed_at") && line["confirmed_at"].is_null());
    let id = run["id"].as_str().unwrap();
    let line_id = line["id"].as_str().unwrap();
    db::confirm_line(&pool, line_id, 4_470_000, None).await.unwrap();
    let want = json!(payslip::statements::block_time_rfc3339(STUB_T0 + 75 * 4_470_000).unwrap());
    let (st, v) = s.get(&format!("/api/runs/{id}")).await;
    assert_eq!(st, 200, "{v}");
    assert_eq!(v["lines"][0]["confirmed_height"], json!(4_470_000));
    assert_eq!(v["lines"][0]["confirmed_at"], want);
    let (_, v) = s.get("/api/runs").await;
    assert_eq!(v["runs"][0]["lines"][0]["confirmed_at"], want);
    let stored = db::lines(&pool, id).await.unwrap();
    assert_eq!(stored[0].confirmed_at.as_ref().map(|t| json!(t)), Some(want));
}

/// GET /api/health reports the testnet venue's fixed rate in full mode; a statements-only
/// deployment funds nothing and reports null.
#[tokio::test]
async fn health_reports_the_simulated_rate() {
    let (full, _pool) = start_full().await;
    let (st, v) = full.get("/api/health").await;
    assert_eq!(st, 200, "{v}");
    assert_eq!(v["simulated_rate_usd_per_zec"], json!(1_350_000.0));
    assert_eq!(v["mode"], json!("full"));
    let statements = start().await;
    let (st, v) = statements.get("/api/health").await;
    assert_eq!(st, 200, "{v}");
    assert!(v.as_object().unwrap().contains_key("simulated_rate_usd_per_zec"));
    assert!(v["simulated_rate_usd_per_zec"].is_null());
}

/// Requests at the same moment: the same key makes one run (the others get it back), and
/// different keys for the same period make one run (the others get `period_overlap`). The
/// overlap check is part of the insert, so two requests cannot both pass it.
#[tokio::test]
async fn simultaneous_requests_make_one_run() {
    let (s, pool) = start_full().await;
    let a = contractor(&pool, 1).await;
    let same = run_body("2026-09-01", "2026-09-30", &[(&a, 480_000, "INV-1")], "k-same");
    let answers = futures_util::future::join_all((0..8).map(|_| s.post("/api/runs", same.clone()))).await;
    let ids: std::collections::HashSet<_> = answers
        .iter()
        .map(|(_, v)| v["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(ids.len(), 1, "{answers:?}");
    assert_eq!(answers.iter().filter(|(st, _)| *st == 201).count(), 1);
    assert!(answers.iter().all(|(st, _)| *st == 201 || *st == 200));
    let answers = futures_util::future::join_all((0..8).map(|i| {
        s.post(
            "/api/runs",
            run_body(
                "2026-10-01",
                "2026-10-31",
                &[(&a, 480_000, "INV-2")],
                &format!("k-oct-{i}"),
            ),
        )
    }))
    .await;
    assert_eq!(answers.iter().filter(|(st, _)| *st == 201).count(), 1, "{answers:?}");
    for (st, v) in answers.iter().filter(|(st, _)| *st != 201) {
        assert_eq!((*st, code(v)), (409, "period_overlap"), "{v}");
    }
}

// ---------------------------------------------------------------------------------------------
// Sign-in, roles, invitations and the audit log (ADR-026), against a JWKS served by a test
// server and tokens signed with a test Ed25519 key.

mod signin {
    use super::*;
    use axum::{routing::get, Json, Router};
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use ed25519_dalek::SigningKey;
    use jsonwebtoken::{Algorithm, EncodingKey, Header};
    use payslip::config::{AuthConfig, AuthMode};

    pub const AUDIENCE: &str = "payslip-service";
    pub const ISSUER: &str = "http://web.test:3000";

    /// A signing key with its JWK, as the web app's JWT plugin would publish it.
    pub struct Key {
        pub kid: String,
        signing: SigningKey,
    }

    impl Key {
        pub fn new(kid: &str, seed: u8) -> Key {
            Key {
                kid: kid.into(),
                signing: SigningKey::from_bytes(&[seed; 32]),
            }
        }

        pub fn jwk(&self) -> Value {
            json!({
                "kty": "OKP", "crv": "Ed25519", "alg": "EdDSA", "use": "sig", "kid": self.kid,
                "x": URL_SAFE_NO_PAD.encode(self.signing.verifying_key().to_bytes()),
            })
        }

        /// PKCS#8 v1 DER of the private key (RFC 8410): a fixed 16-byte prefix and the seed.
        fn pkcs8(&self) -> Vec<u8> {
            let mut der = vec![
                0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
            ];
            der.extend_from_slice(&self.signing.to_bytes());
            der
        }

        /// A token for `email` with the registered claims the service expects, `exp` seconds
        /// from now (negative for one already expired). `extra` overrides any claim.
        pub fn token(&self, email: &str, exp_in: i64, extra: Value) -> String {
            self.token_with_kid(&self.kid, email, exp_in, extra)
        }

        pub fn token_with_kid(&self, kid: &str, email: &str, exp_in: i64, extra: Value) -> String {
            let now = time::OffsetDateTime::now_utc().unix_timestamp();
            let mut claims = json!({
                "sub": format!("user-{}", email.split('@').next().unwrap()),
                "email": email,
                "email_verified": true,
                "name": email.split('@').next().unwrap(),
                "sid": "session-1",
                "iss": ISSUER,
                "aud": AUDIENCE,
                "iat": now,
                "exp": now + exp_in,
            });
            for (k, v) in extra.as_object().into_iter().flatten() {
                claims[k] = v.clone();
            }
            let mut header = Header::new(Algorithm::EdDSA);
            header.kid = Some(kid.to_string());
            jsonwebtoken::encode(&header, &claims, &EncodingKey::from_ed_der(&self.pkcs8())).unwrap()
        }
    }

    /// Serves `{keys: [...]}` at /api/auth/jwks, as the web app does.
    pub async fn jwks_server(keys: &[&Key]) -> String {
        let set = json!({ "keys": keys.iter().map(|k| k.jwk()).collect::<Vec<_>>() });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = Router::new().route(
            "/api/auth/jwks",
            get(move || {
                let set = set.clone();
                async move { Json(set) }
            }),
        );
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://{addr}/api/auth/jwks")
    }

    /// A full-mode service with sign-in required, checking tokens against `jwks_url`.
    pub async fn start(jwks_url: &str, bootstrap: Option<&str>) -> (Service, Pool) {
        let dir = tempfile::tempdir().unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let mut cfg = config(dir.path(), addr);
        cfg.statements_only = false;
        cfg.auth = AuthConfig {
            mode: AuthMode::Required,
            jwks_url: jwks_url.to_string(),
            issuer: ISSUER.into(),
            audience: AUDIENCE.into(),
            bootstrap_admin_email: bootstrap.map(|b| b.to_string()),
        };
        let db = db::open(&cfg.app_db_path()).await.unwrap();
        let venue = payslip::venue::build(&cfg).unwrap();
        let executor = Executor::with_chain(
            cfg.network,
            db.clone(),
            Arc::new(StubChain),
            venue.clone(),
            Arc::new(TreasuryVenue::new(Arc::new(StubRates))),
            Duration::from_millis(5),
            1,
        )
        .with_run_cap(cfg.max_run_usd_cents);
        let state = Arc::new(AppState {
            viewers: ViewerRegistry::new(&cfg),
            db: db.clone(),
            payer: None,
            venue,
            executor: Some(executor),
            contractor_lock: tokio::sync::Mutex::new(()),
            lwd: tokio::sync::Mutex::new(payslip::wallet::lwd::connect(&cfg.lightwalletd_url).unwrap()),
            last_wallet: std::sync::Mutex::new(None),
            prices: Arc::new(payslip::prices::Prices::new(None, None)),
            scan_slots: tokio::sync::Semaphore::new(3),
            sse_slots: Arc::new(tokio::sync::Semaphore::new(api::MAX_EVENT_STREAMS)),
            auth: Some(Arc::new(payslip::auth::Verifier::new(&cfg.auth))),
            cfg: cfg.clone(),
        });
        tokio::spawn(async move { axum::serve(listener, api::router(state)).await.unwrap() });
        let service = Service {
            base: format!("http://{addr}"),
            cfg,
            http: reqwest::Client::new(),
            _dir: dir,
        };
        (service, db)
    }

    impl Service {
        /// A request as a signed-in person (`token`), or anonymous (None). Writes carry the JSON
        /// header; the body of a progress stream is never read.
        pub async fn req(&self, method: &str, path: &str, token: Option<&str>, body: Option<Value>) -> (u16, Value) {
            let m = reqwest::Method::from_bytes(method.as_bytes()).unwrap();
            let mut r = self.http.request(m.clone(), format!("{}{path}", self.base));
            if let Some(t) = token {
                r = r.bearer_auth(t);
            }
            if m != reqwest::Method::GET {
                r = r.header("content-type", "application/json");
                r = r.body(body.map(|b| b.to_string()).unwrap_or_default());
            }
            let res = r.send().await.unwrap();
            let status = res.status().as_u16();
            if path.ends_with("/events") {
                return (status, Value::Null);
            }
            (status, res.json().await.unwrap_or(Value::Null))
        }
    }

    pub async fn me(s: &Service, token: &str) -> Value {
        let (st, v) = s.req("GET", "/api/me", Some(token), None).await;
        assert_eq!(st, 200, "{v}");
        v
    }

    /// Invites `email` as `role` (as `admin`) and accepts it with `token`; returns the role.
    pub async fn join(s: &Service, admin: &str, email: &str, role: &str, token: &str) -> String {
        let (st, inv) = s
            .req(
                "POST",
                "/api/org/invitations",
                Some(admin),
                Some(json!({ "email": email, "role": role })),
            )
            .await;
        assert_eq!(st, 201, "{inv}");
        let link = inv["token"].as_str().unwrap().to_string();
        let (st, v) = s
            .req(
                "POST",
                &format!("/api/org/invitations/{link}/accept"),
                Some(token),
                Some(json!({})),
            )
            .await;
        assert_eq!(st, 200, "{v}");
        v["membership"]["role"].as_str().unwrap().to_string()
    }
}

use jsonwebtoken::{Algorithm, Header};
use signin::{Key, AUDIENCE, ISSUER};

/// Without a token, or with one that is expired, signed by another key, by an unknown key, for
/// another audience or issuer, or not EdDSA, every payer route answers 401 `unauthenticated`
/// with a hint. Health, statements and proofs stay public.
#[tokio::test]
async fn tokens_are_checked_before_anything_else() {
    let key = Key::new("k1", 1);
    let other = Key::new("k1", 2);
    let jwks = signin::jwks_server(&[&key]).await;
    let (s, _pool) = signin::start(&jwks, None).await;
    let unauth = |st: u16, v: &Value, what: &str| {
        assert_eq!((st, code(v)), (401, "unauthenticated"), "{what}: {v}");
        assert!(has_hint(v), "{what}");
    };
    let (st, v) = s.req("GET", "/api/runs", None, None).await;
    unauth(st, &v, "no token");
    let (st, v) = s.req("POST", "/api/runs", None, Some(json!({}))).await;
    unauth(st, &v, "no token on a write");
    let (st, _) = s.req("GET", "/api/runs/abc/events", None, None).await;
    assert_eq!(st, 401, "no token on the progress stream");
    let (st, v) = s
        .req(
            "GET",
            "/api/runs",
            Some(&key.token("a@example.test", -120, json!({}))),
            None,
        )
        .await;
    unauth(st, &v, "expired");
    assert!(v["error"]["message"].as_str().unwrap().contains("expired"), "{v}");
    let (st, v) = s
        .req(
            "GET",
            "/api/runs",
            Some(&other.token("a@example.test", 300, json!({}))),
            None,
        )
        .await;
    unauth(st, &v, "another key with the same kid");
    let (st, v) = s
        .req(
            "GET",
            "/api/runs",
            Some(&key.token_with_kid("nope", "a@example.test", 300, json!({}))),
            None,
        )
        .await;
    unauth(st, &v, "unknown kid");
    let (st, v) = s
        .req(
            "GET",
            "/api/runs",
            Some(&key.token("a@example.test", 300, json!({ "aud": "another-service" }))),
            None,
        )
        .await;
    unauth(st, &v, "wrong audience");
    let (st, v) = s
        .req(
            "GET",
            "/api/runs",
            Some(&key.token("a@example.test", 300, json!({ "iss": "http://evil.test" }))),
            None,
        )
        .await;
    unauth(st, &v, "wrong issuer");
    let (st, v) = s
        .req(
            "GET",
            "/api/runs",
            Some(&key.token("a@example.test", 300, json!({ "email": null }))),
            None,
        )
        .await;
    unauth(st, &v, "no email");
    // A token with a symmetric algorithm, whatever it is signed with, is never EdDSA.
    let hs = jsonwebtoken::encode(
        &Header::new(Algorithm::HS256),
        &json!({ "sub": "x", "exp": time::OffsetDateTime::now_utc().unix_timestamp() + 300, "iss": ISSUER, "aud": AUDIENCE }),
        &jsonwebtoken::EncodingKey::from_secret(b"secret"),
    )
    .unwrap();
    let (st, v) = s.req("GET", "/api/runs", Some(&hs), None).await;
    unauth(st, &v, "HS256");
    let (st, v) = s.req("GET", "/api/runs", Some("not.a.token"), None).await;
    unauth(st, &v, "garbage");
    // Public routes answer as before.
    let (st, v) = s.req("GET", "/api/health", None, None).await;
    assert_eq!((st, v["auth"].as_str()), (200, Some("required")), "{v}");
    let (st, v) = s
        .req("POST", "/api/statements/forget", None, Some(json!({ "ufvks": [] })))
        .await;
    assert_eq!((st, code(&v)), (400, "invalid_viewing_key"), "{v}");
    let (st, v) = s.req("GET", "/api/proofs/pp1nothing", None, None).await;
    assert_ne!(st, 401, "{v}");
    // A valid token for someone who is not a member: they can see who they are, nothing else.
    let token = key.token("a@example.test", 300, json!({}));
    let v = signin::me(&s, &token).await;
    assert_eq!(v["user"]["email"], json!("a@example.test"));
    assert!(v["membership"].is_null(), "{v}");
    let (st, v) = s.req("GET", "/api/runs", Some(&token), None).await;
    assert_eq!((st, code(&v)), (403, "forbidden"), "{v}");
    assert!(v["error"]["hint"].as_str().unwrap().contains("invitation"));
    assert_eq!(v["error"].get("runs"), None);
}

/// The first sign-in with the bootstrap email, verified, creates the organisation and makes
/// that person its admin; everyone else needs an invitation, including a second account with
/// the bootstrap email once an admin exists.
#[tokio::test]
async fn the_bootstrap_email_becomes_the_first_admin_then_membership_is_invite_only() {
    let key = Key::new("k1", 1);
    let jwks = signin::jwks_server(&[&key]).await;
    let (s, pool) = signin::start(&jwks, Some("owner@acme.test")).await;
    // Unverified: no bootstrap.
    let unverified = key.token("owner@acme.test", 300, json!({ "email_verified": false }));
    let v = signin::me(&s, &unverified).await;
    assert!(v["membership"].is_null(), "{v}");
    // Someone else first: nothing happens for them.
    let stranger = key.token("other@acme.test", 300, json!({}));
    assert!(signin::me(&s, &stranger).await["membership"].is_null());
    // The owner, verified: admin of an organisation named after the email domain.
    let owner = key.token("owner@acme.test", 300, json!({ "name": "Owner" }));
    let v = signin::me(&s, &owner).await;
    assert_eq!(v["membership"]["role"], json!("admin"), "{v}");
    assert_eq!(v["membership"]["org"]["name"], json!("acme.test"));
    assert_eq!(v["user"]["name"], json!("Owner"));
    let (st, org) = s.req("GET", "/api/org", Some(&owner), None).await;
    assert_eq!((st, org["name"].as_str()), (200, Some("acme.test")));
    // A second account carrying the bootstrap email (another sub) is not made admin: there is one.
    let impostor = key.token(
        "owner@acme.test",
        300,
        json!({ "sub": "user-impostor", "email_verified": true }),
    );
    let v = signin::me(&s, &impostor).await;
    // Same verified email maps to the same user, so this is the owner again, not a new admin.
    assert_eq!(v["user"]["id"], json!("user-owner"));
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM memberships")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(n, 1);
    let stranger_again = key.token("other@acme.test", 300, json!({}));
    let (st, v) = s.req("GET", "/api/contractors", Some(&stranger_again), None).await;
    assert_eq!((st, code(&v)), (403, "forbidden"));
    // The bootstrap is on record.
    let (st, v) = s.req("GET", "/api/org/audit", Some(&owner), None).await;
    assert_eq!(st, 200, "{v}");
    let first = v["entries"].as_array().unwrap().last().unwrap().clone();
    assert_eq!(first["action"], json!("org.bootstrap"));
    assert_eq!(first["user"]["email"], json!("owner@acme.test"));
    assert_eq!(first["role"], json!("admin"));
    // Renaming the organisation and setting a logo.
    let (st, v) = s
        .req(
            "PATCH",
            "/api/org",
            Some(&owner),
            Some(json!({ "name": "Acme Robotics", "logo_url": "https://acme.test/logo.png" })),
        )
        .await;
    assert_eq!((st, v["name"].as_str()), (200, Some("Acme Robotics")), "{v}");
    assert_eq!(v["logo_url"], json!("https://acme.test/logo.png"));
    let (st, v) = s
        .req("PATCH", "/api/org", Some(&owner), Some(json!({ "logo_url": null })))
        .await;
    assert_eq!((st, v["logo_url"].is_null()), (200, true), "{v}");
    assert_eq!(v["name"], json!("Acme Robotics"));
    let (st, v) = s
        .req(
            "PATCH",
            "/api/org",
            Some(&owner),
            Some(json!({ "logo_url": "ftp://x" })),
        )
        .await;
    assert_eq!((st, code(&v)), (400, "invalid_logo_url"));
    let (st, v) = s
        .req("PATCH", "/api/org", Some(&owner), Some(json!({ "name": "  " })))
        .await;
    assert_eq!((st, code(&v)), (400, "invalid_name"));
    assert_eq!(
        signin::me(&s, &owner).await["membership"]["org"]["name"],
        json!("Acme Robotics")
    );
}

/// Invitation links: one per email, accepted only by that verified email, once, before they
/// expire, unless revoked. Members can be re-roled and removed, except the last admin.
#[tokio::test]
async fn invitations_are_accepted_once_by_the_invited_email_before_they_expire() {
    let key = Key::new("k1", 1);
    let jwks = signin::jwks_server(&[&key]).await;
    let (s, pool) = signin::start(&jwks, Some("owner@acme.test")).await;
    let owner = key.token("owner@acme.test", 300, json!({}));
    signin::me(&s, &owner).await;
    let (st, v) = s
        .req(
            "POST",
            "/api/org/invitations",
            Some(&owner),
            Some(json!({ "email": "Viewer@Acme.test ", "role": "viewer" })),
        )
        .await;
    assert_eq!(st, 201, "{v}");
    assert_eq!(v["email"], json!("viewer@acme.test"));
    assert_eq!(v["status"], json!("pending"));
    let link = v["token"].as_str().unwrap().to_string();
    assert!(link.len() >= 40);
    let inv_id = v["id"].as_str().unwrap().to_string();
    // The list never shows tokens; the database holds only a hash.
    let (st, v) = s.req("GET", "/api/org/invitations", Some(&owner), None).await;
    assert_eq!(st, 200, "{v}");
    assert_eq!(v["invitations"][0]["id"], json!(inv_id));
    assert!(v["invitations"][0].get("token").is_none());
    let stored: String = sqlx::query_scalar("SELECT token_hash FROM invitations WHERE id = ?")
        .bind(&inv_id)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_ne!(stored, link);
    assert_eq!(stored.len(), 64);
    // The wrong person cannot accept it.
    let wrong = key.token("someone@acme.test", 300, json!({}));
    let (st, v) = s
        .req(
            "POST",
            &format!("/api/org/invitations/{link}/accept"),
            Some(&wrong),
            Some(json!({})),
        )
        .await;
    assert_eq!((st, code(&v)), (403, "forbidden"), "{v}");
    assert!(v["error"]["message"].as_str().unwrap().contains("viewer@acme.test"));
    // Not without signing in either.
    let (st, v) = s
        .req(
            "POST",
            &format!("/api/org/invitations/{link}/accept"),
            None,
            Some(json!({})),
        )
        .await;
    assert_eq!((st, code(&v)), (401, "unauthenticated"));
    // The invited person accepts it, once.
    let viewer = key.token("viewer@acme.test", 300, json!({}));
    let (st, v) = s
        .req(
            "POST",
            &format!("/api/org/invitations/{link}/accept"),
            Some(&viewer),
            Some(json!({})),
        )
        .await;
    assert_eq!((st, v["membership"]["role"].as_str()), (200, Some("viewer")), "{v}");
    assert_eq!(signin::me(&s, &viewer).await["membership"]["role"], json!("viewer"));
    let (st, v) = s
        .req(
            "POST",
            &format!("/api/org/invitations/{link}/accept"),
            Some(&viewer),
            Some(json!({})),
        )
        .await;
    assert_eq!((st, code(&v)), (409, "invitation_used"), "{v}");
    let (_, v) = s.req("GET", "/api/org/invitations", Some(&owner), None).await;
    assert_eq!(v["invitations"][0]["status"], json!("accepted"));
    // An unknown link, a revoked link, an expired link.
    let (st, v) = s
        .req(
            "POST",
            "/api/org/invitations/not-a-token/accept",
            Some(&viewer),
            Some(json!({})),
        )
        .await;
    assert_eq!((st, code(&v)), (404, "not_found"), "{v}");
    let (st, v) = s
        .req(
            "POST",
            "/api/org/invitations",
            Some(&owner),
            Some(json!({ "email": "approver@acme.test", "role": "approver" })),
        )
        .await;
    assert_eq!(st, 201, "{v}");
    let revoked_link = v["token"].as_str().unwrap().to_string();
    let revoked_id = v["id"].as_str().unwrap().to_string();
    let (st, _) = s
        .req(
            "DELETE",
            &format!("/api/org/invitations/{revoked_id}"),
            Some(&owner),
            None,
        )
        .await;
    assert_eq!(st, 204);
    let approver = key.token("approver@acme.test", 300, json!({}));
    let (st, v) = s
        .req(
            "POST",
            &format!("/api/org/invitations/{revoked_link}/accept"),
            Some(&approver),
            Some(json!({})),
        )
        .await;
    assert_eq!((st, code(&v)), (404, "not_found"), "{v}");
    let (st, v) = s
        .req(
            "POST",
            "/api/org/invitations",
            Some(&owner),
            Some(json!({ "email": "approver@acme.test", "role": "approver" })),
        )
        .await;
    assert_eq!(st, 201, "{v}");
    let expired_link = v["token"].as_str().unwrap().to_string();
    sqlx::query("UPDATE invitations SET expires_at = '2026-01-01T00:00:00Z' WHERE id = ?")
        .bind(v["id"].as_str().unwrap())
        .execute(&pool)
        .await
        .unwrap();
    let (st, v) = s
        .req(
            "POST",
            &format!("/api/org/invitations/{expired_link}/accept"),
            Some(&approver),
            Some(json!({})),
        )
        .await;
    assert_eq!((st, code(&v)), (409, "invitation_expired"), "{v}");
    assert!(has_hint(&v));
    // A new invitation for the same email replaces the old one.
    let (st, v) = s
        .req(
            "POST",
            "/api/org/invitations",
            Some(&owner),
            Some(json!({ "email": "approver@acme.test", "role": "approver" })),
        )
        .await;
    assert_eq!(st, 201, "{v}");
    let fresh = v["token"].as_str().unwrap().to_string();
    let (_, v) = s.req("GET", "/api/org/invitations", Some(&owner), None).await;
    let open: Vec<_> = v["invitations"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|i| i["email"] == json!("approver@acme.test"))
        .collect();
    assert_eq!(open.len(), 1, "earlier invitations for the email are gone: {v}");
    let (st, v) = s
        .req(
            "POST",
            &format!("/api/org/invitations/{fresh}/accept"),
            Some(&approver),
            Some(json!({})),
        )
        .await;
    assert_eq!((st, v["membership"]["role"].as_str()), (200, Some("approver")), "{v}");
    // Bad input.
    let (st, v) = s
        .req(
            "POST",
            "/api/org/invitations",
            Some(&owner),
            Some(json!({ "email": "viewer@acme.test", "role": "admin" })),
        )
        .await;
    assert_eq!((st, code(&v)), (409, "already_a_member"), "{v}");
    let (st, v) = s
        .req(
            "POST",
            "/api/org/invitations",
            Some(&owner),
            Some(json!({ "email": "x@acme.test", "role": "owner" })),
        )
        .await;
    assert_eq!((st, code(&v)), (400, "invalid_role"));
    let (st, v) = s
        .req(
            "POST",
            "/api/org/invitations",
            Some(&owner),
            Some(json!({ "email": "not an email", "role": "viewer" })),
        )
        .await;
    assert_eq!((st, code(&v)), (400, "invalid_email"));
    // Only admins manage invitations and members.
    let (st, v) = s.req("GET", "/api/org/invitations", Some(&viewer), None).await;
    assert_eq!((st, code(&v)), (403, "forbidden"), "{v}");
    assert!(v["error"]["message"].as_str().unwrap().contains("viewer"));
    let (st, _) = s
        .req(
            "POST",
            "/api/org/invitations",
            Some(&viewer),
            Some(json!({ "email": "z@acme.test", "role": "viewer" })),
        )
        .await;
    assert_eq!(st, 403);
    // Members: everyone sees the list; the admin changes roles and removes people.
    let (st, v) = s.req("GET", "/api/org/members", Some(&viewer), None).await;
    assert_eq!(st, 200, "{v}");
    let members = v["members"].as_array().unwrap();
    assert_eq!(members.len(), 3, "{v}");
    let (st, v) = s
        .req(
            "POST",
            "/api/org/members",
            Some(&owner),
            Some(json!({ "user_id": "user-viewer", "role": "accountant" })),
        )
        .await;
    assert_eq!((st, v["role"].as_str()), (200, Some("accountant")), "{v}");
    assert_eq!(signin::me(&s, &viewer).await["membership"]["role"], json!("accountant"));
    let (st, v) = s
        .req(
            "POST",
            "/api/org/members",
            Some(&owner),
            Some(json!({ "user_id": "user-owner", "role": "viewer" })),
        )
        .await;
    assert_eq!((st, code(&v)), (409, "last_admin"), "{v}");
    let (st, v) = s.req("DELETE", "/api/org/members/user-owner", Some(&owner), None).await;
    assert_eq!((st, code(&v)), (409, "last_admin"), "{v}");
    let (st, v) = s
        .req(
            "POST",
            "/api/org/members",
            Some(&owner),
            Some(json!({ "user_id": "user-approver", "role": "admin" })),
        )
        .await;
    assert_eq!(st, 200, "{v}");
    let (st, _) = s.req("DELETE", "/api/org/members/user-owner", Some(&owner), None).await;
    assert_eq!(st, 204, "with a second admin, the first can leave");
    assert!(signin::me(&s, &owner).await["membership"].is_null());
    let (st, v) = s
        .req("DELETE", "/api/org/members/user-nobody", Some(&approver), None)
        .await;
    assert_eq!((st, code(&v)), (404, "not_found"), "{v}");
    let (st, v) = s
        .req("DELETE", "/api/org/members/user-viewer", Some(&viewer), None)
        .await;
    assert_eq!((st, code(&v)), (403, "forbidden"), "{v}");
}

/// Every payer and organisation route against every role. Allowed roles get past the guard
/// (any answer but 401 or 403, since the harness has no wallet); the others get 403.
#[tokio::test]
async fn the_role_matrix_covers_every_payer_route() {
    let key = Key::new("k1", 1);
    let jwks = signin::jwks_server(&[&key]).await;
    let (s, pool) = signin::start(&jwks, Some("owner@acme.test")).await;
    let admin = key.token("owner@acme.test", 300, json!({}));
    signin::me(&s, &admin).await;
    let approver = key.token("approver@acme.test", 300, json!({}));
    let accountant = key.token("accountant@acme.test", 300, json!({}));
    let viewer = key.token("viewer@acme.test", 300, json!({}));
    assert_eq!(
        signin::join(&s, &admin, "approver@acme.test", "approver", &approver).await,
        "approver"
    );
    assert_eq!(
        signin::join(&s, &admin, "accountant@acme.test", "accountant", &accountant).await,
        "accountant"
    );
    assert_eq!(
        signin::join(&s, &admin, "viewer@acme.test", "viewer", &viewer).await,
        "viewer"
    );
    let roles = [
        ("admin", &admin),
        ("approver", &approver),
        ("accountant", &accountant),
        ("viewer", &viewer),
    ];

    let c = contractor(&pool, 1).await;
    let (st, run) = s
        .req(
            "POST",
            "/api/runs",
            Some(&admin),
            Some(run_body(
                "2026-09-01",
                "2026-09-30",
                &[(&c, 480_000, "INV-1")],
                "k-read",
            )),
        )
        .await;
    assert_eq!(st, 201, "{run}");
    let run_id = run["id"].as_str().unwrap().to_string();

    const ALL: &[&str] = &["admin", "approver", "accountant", "viewer"];
    const ADMIN: &[&str] = &["admin"];
    const RUNS: &[&str] = &["admin", "approver"];
    const KEYS: &[&str] = &["admin", "accountant"];
    #[derive(Clone, Copy)]
    enum Need {
        None,
        Contractor,
        DraftRun,
    }
    // (method, path with {id}, body, allowed roles, fixture)
    let rows: Vec<(&str, &str, Value, &[&str], Need)> = vec![
        ("GET", "/api/wallet", Value::Null, ALL, Need::None),
        ("POST", "/api/wallet/sync", json!({}), ADMIN, Need::None),
        ("GET", "/api/contractors", Value::Null, ALL, Need::None),
        ("POST", "/api/contractors", json!({}), ADMIN, Need::None),
        ("GET", "/api/contractors/{id}", Value::Null, ALL, Need::Contractor),
        (
            "PATCH",
            "/api/contractors/{id}",
            json!({ "name": "Renamed" }),
            ADMIN,
            Need::Contractor,
        ),
        ("DELETE", "/api/contractors/{id}", json!({}), ADMIN, Need::Contractor),
        (
            "GET",
            "/api/contractors/{id}/viewing-key",
            Value::Null,
            KEYS,
            Need::Contractor,
        ),
        (
            "POST",
            "/api/contractors/{id}/viewing-key/shared",
            json!({}),
            ADMIN,
            Need::Contractor,
        ),
        (
            "DELETE",
            "/api/contractors/{id}/viewing-key/shared",
            json!({}),
            ADMIN,
            Need::Contractor,
        ),
        ("GET", "/api/viewing-keys", Value::Null, KEYS, Need::None),
        ("GET", "/api/runs", Value::Null, ALL, Need::None),
        ("POST", "/api/runs", json!({}), RUNS, Need::None),
        ("GET", "/api/runs/{id}", Value::Null, ALL, Need::None),
        ("DELETE", "/api/runs/{id}", json!({}), RUNS, Need::DraftRun),
        ("POST", "/api/runs/{id}/fund", json!({}), RUNS, Need::DraftRun),
        ("GET", "/api/runs/{id}/funding", Value::Null, ALL, Need::None),
        (
            "POST",
            "/api/runs/{id}/funding/deposit-tx",
            json!({ "tx_hash": "x" }),
            RUNS,
            Need::None,
        ),
        ("POST", "/api/runs/{id}/execute", json!({}), RUNS, Need::None),
        ("POST", "/api/runs/{id}/cancel", json!({}), RUNS, Need::DraftRun),
        ("GET", "/api/runs/{id}/events", Value::Null, ALL, Need::None),
        ("GET", "/api/runs/{id}/log", Value::Null, ALL, Need::None),
        ("GET", "/api/me", Value::Null, ALL, Need::None),
        ("GET", "/api/org", Value::Null, ALL, Need::None),
        ("PATCH", "/api/org", json!({}), ADMIN, Need::None),
        ("GET", "/api/org/members", Value::Null, ALL, Need::None),
        (
            "POST",
            "/api/org/members",
            json!({ "user_id": "nobody", "role": "viewer" }),
            ADMIN,
            Need::None,
        ),
        ("DELETE", "/api/org/members/nobody", json!({}), ADMIN, Need::None),
        ("GET", "/api/org/invitations", Value::Null, ADMIN, Need::None),
        ("POST", "/api/org/invitations", json!({}), ADMIN, Need::None),
        ("DELETE", "/api/org/invitations/nothing", json!({}), ADMIN, Need::None),
        ("GET", "/api/org/audit", Value::Null, KEYS, Need::None),
    ];
    let mut next_account = 1u32;
    let mut checked = 0;
    for (method, template, body, allowed, need) in rows {
        for (role, token) in roles {
            let id = match need {
                Need::None if template.contains("{id}") => run_id.clone(),
                Need::None => String::new(),
                Need::Contractor => {
                    next_account += 1;
                    contractor(&pool, next_account).await
                }
                Need::DraftRun => {
                    next_account += 1;
                    let c = contractor(&pool, next_account).await;
                    let mut body = run_body(
                        "2026-10-01",
                        "2026-10-31",
                        &[(&c, 100_000, "INV-X")],
                        &format!("k-{next_account}"),
                    );
                    body["allow_overlap"] = json!(true);
                    let (st, v) = s.req("POST", "/api/runs", Some(&admin), Some(body)).await;
                    assert_eq!(st, 201, "{v}");
                    v["id"].as_str().unwrap().to_string()
                }
            };
            let path = template.replace("{id}", &id);
            let b = if method == "GET" { None } else { Some(body.clone()) };
            let (st, v) = s.req(method, &path, Some(token), b).await;
            if allowed.contains(&role) {
                assert!(
                    st != 401 && st != 403,
                    "{role} should get past the guard on {method} {template}, got {st}: {v}"
                );
            } else {
                assert_eq!((st, code(&v)), (403, "forbidden"), "{role} on {method} {template}: {v}");
                assert!(v["error"]["message"].as_str().unwrap().contains(role), "{v}");
                assert!(has_hint(&v));
            }
            checked += 1;
        }
    }
    assert_eq!(checked, 32 * 4);
}

/// Every write leaves an audit row naming who (user and role), what (action and target) and
/// when; key exports too. Admins and accountants read the log, newest first.
#[tokio::test]
async fn every_write_is_on_the_audit_log() {
    let key = Key::new("k1", 1);
    let jwks = signin::jwks_server(&[&key]).await;
    let (s, pool) = signin::start(&jwks, Some("owner@acme.test")).await;
    let admin = key.token("owner@acme.test", 300, json!({ "name": "Owner" }));
    signin::me(&s, &admin).await;
    let approver = key.token("approver@acme.test", 300, json!({}));
    signin::join(&s, &admin, "approver@acme.test", "approver", &approver).await;
    let viewer = key.token("viewer@acme.test", 300, json!({}));
    signin::join(&s, &admin, "viewer@acme.test", "viewer", &viewer).await;
    let c = contractor(&pool, 1).await;
    let (st, v) = s
        .req(
            "POST",
            &format!("/api/contractors/{c}/viewing-key/shared"),
            Some(&admin),
            Some(json!({})),
        )
        .await;
    assert_eq!(st, 200, "{v}");
    let (st, run) = s
        .req(
            "POST",
            "/api/runs",
            Some(&approver),
            Some(run_body("2026-09-01", "2026-09-30", &[(&c, 480_000, "INV-1")], "k-1")),
        )
        .await;
    assert_eq!(st, 201, "{run}");
    let run_id = run["id"].as_str().unwrap().to_string();
    let (st, v) = s
        .req(
            "POST",
            &format!("/api/runs/{run_id}/cancel"),
            Some(&approver),
            Some(json!({})),
        )
        .await;
    assert_eq!(st, 200, "{v}");
    // A refused write leaves no row.
    let (st, _) = s.req("POST", "/api/runs", Some(&viewer), Some(json!({}))).await;
    assert_eq!(st, 403);
    let (st, _) = s.req("POST", "/api/runs", Some(&admin), Some(json!({}))).await;
    assert_eq!(st, 422);
    // Reads leave no row either, except key exports (none succeed here: no wallet).
    let (st, _) = s.req("GET", "/api/runs", Some(&viewer), None).await;
    assert_eq!(st, 200);

    let (st, v) = s.req("GET", "/api/org/audit", Some(&admin), None).await;
    assert_eq!(st, 200, "{v}");
    let entries = v["entries"].as_array().unwrap();
    let actions: Vec<(String, String, String)> = entries
        .iter()
        .map(|e| {
            (
                e["action"].as_str().unwrap().to_string(),
                e["role"].as_str().unwrap().to_string(),
                e["user"]["email"].as_str().unwrap_or("").to_string(),
            )
        })
        .collect();
    let expect = |action: &str, role: &str, email: &str| {
        assert!(
            actions.contains(&(action.into(), role.into(), email.into())),
            "missing {action} by {email} as {role} in {actions:?}"
        );
    };
    expect("org.bootstrap", "admin", "owner@acme.test");
    expect("invitation.create", "admin", "owner@acme.test");
    expect("invitation.accept", "approver", "approver@acme.test");
    expect("invitation.accept", "viewer", "viewer@acme.test");
    expect("contractor.key_shared", "admin", "owner@acme.test");
    expect("run.create", "approver", "approver@acme.test");
    expect("run.cancel", "approver", "approver@acme.test");
    assert_eq!(entries[0]["action"], json!("run.cancel"), "newest first: {v}");
    assert_eq!(entries[0]["target"], json!(run_id));
    let created = entries.iter().find(|e| e["action"] == json!("run.create")).unwrap();
    assert_eq!(created["target"], json!(run_id), "a create names the new id");
    let shared = entries
        .iter()
        .find(|e| e["action"] == json!("contractor.key_shared"))
        .unwrap();
    assert_eq!(shared["target"], json!(c));
    let invited = entries
        .iter()
        .find(|e| e["action"] == json!("invitation.create") && e["details"]["email"] == json!("approver@acme.test"))
        .unwrap();
    assert_eq!(invited["details"]["role"], json!("approver"));
    assert_eq!(
        invited["target"].as_str().unwrap().len(),
        36,
        "the invitation id, never the token"
    );
    for e in entries {
        assert!(e["at"].as_str().unwrap().ends_with('Z'));
        assert!(e["user"]["email"].is_string(), "{e}");
    }
    assert_eq!(entries.len(), 8, "{actions:?}");
    // Paging: the two newest, then the rest from before them.
    let (st, v) = s.req("GET", "/api/org/audit?limit=2", Some(&admin), None).await;
    assert_eq!(st, 200);
    let page = v["entries"].as_array().unwrap();
    assert_eq!(page.len(), 2);
    let before = page[1]["id"].as_i64().unwrap();
    let (_, v) = s
        .req(
            "GET",
            &format!("/api/org/audit?limit=100&before={before}"),
            Some(&admin),
            None,
        )
        .await;
    assert_eq!(v["entries"].as_array().unwrap().len(), 6);
    // Who may read it.
    let (st, v) = s.req("GET", "/api/org/audit", Some(&viewer), None).await;
    assert_eq!((st, code(&v)), (403, "forbidden"), "{v}");
    let accountant = key.token("accountant@acme.test", 300, json!({}));
    signin::join(&s, &admin, "accountant@acme.test", "accountant", &accountant).await;
    let (st, v) = s.req("GET", "/api/org/audit", Some(&accountant), None).await;
    assert_eq!(st, 200, "{v}");
    let (st, v) = s.req("GET", "/api/org/audit", Some(&approver), None).await;
    assert_eq!((st, code(&v)), (403, "forbidden"), "{v}");
}

/// A person's first sight is several requests at once (a console page's parallel fetches): every
/// one succeeds, one user row and one organisation result, and the bootstrap is recorded once.
/// An unverified email that another account holds is refused with a 403, never a 500.
#[tokio::test]
async fn a_first_sight_survives_parallel_requests() {
    let key = Key::new("k1", 1);
    let jwks = signin::jwks_server(&[&key]).await;
    let (s, pool) = signin::start(&jwks, Some("owner@acme.test")).await;
    let owner = key.token("owner@acme.test", 300, json!({ "name": "Owner" }));
    let answers = futures_util::future::join_all((0..8).map(|_| s.req("GET", "/api/me", Some(&owner), None))).await;
    for (st, v) in &answers {
        assert_eq!(*st, 200, "{v}");
        assert_eq!(v["membership"]["role"], json!("admin"), "{v}");
    }
    let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&pool)
        .await
        .unwrap();
    let orgs: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM organisations")
        .fetch_one(&pool)
        .await
        .unwrap();
    let members: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM memberships")
        .fetch_one(&pool)
        .await
        .unwrap();
    let bootstraps: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE action = 'org.bootstrap'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!((users, orgs, members, bootstraps), (1, 1, 1, 1));
    // A newcomer's parallel first sight, without bootstrap.
    let newcomer = key.token("new@acme.test", 300, json!({}));
    let answers = futures_util::future::join_all((0..8).map(|_| s.req("GET", "/api/me", Some(&newcomer), None))).await;
    assert!(answers.iter().all(|(st, _)| *st == 200), "{answers:?}");
    let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(users, 2);
    // Another account carrying the owner's email, unverified: refused, and nothing is created.
    let dup = key.token(
        "owner@acme.test",
        300,
        json!({ "sub": "user-dup", "email_verified": false }),
    );
    let (st, v) = s.req("GET", "/api/me", Some(&dup), None).await;
    assert_eq!((st, code(&v)), (403, "forbidden"), "{v}");
    assert!(has_hint(&v));
    let users: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(users, 2);
}

/// With PAYSLIP_AUTH=off nothing changes: no token is asked for and the organisation routes do
/// not exist.
#[tokio::test]
async fn auth_off_keeps_todays_behaviour() {
    let (s, _pool) = start_full().await;
    let (st, v) = s.get("/api/runs").await;
    assert_eq!(st, 200, "{v}");
    let (st, v) = s.get("/api/me").await;
    assert_eq!((st, code(&v)), (404, "not_found"), "{v}");
    let (st, v) = s.get("/api/health").await;
    assert_eq!((st, v["auth"].as_str()), (200, Some("off")));
}

/// ADR-025: `POST /api/runs/{id}/fund` with `method: "zec"` answers the treasury address, the
/// ZEC to send (payroll at the rate plus the fee reserve plus 2 percent), the rate and a
/// 24-hour deadline, with the run awaiting funds; health says the method exists; the deposit
/// transaction endpoint and an unknown method are refused with a plain message.
#[tokio::test]
async fn fund_with_zec_answers_the_treasury_address_amount_rate_and_deadline() {
    let (s, pool) = start_full().await;
    let (st, h) = s.get("/api/health").await;
    assert_eq!(st, 200);
    assert_eq!(h["fund_with_zec"], json!(true));
    assert!(h["max_run_usd_cents"].is_null());
    let a = contractor(&pool, 1).await;
    let b = contractor(&pool, 2).await;
    let (st, run) = s
        .post(
            "/api/runs",
            run_body(
                "2026-09-01",
                "2026-09-30",
                &[(&a, 480_000, "INV-1"), (&b, 625_000, "INV-2")],
                "k-zec",
            ),
        )
        .await;
    assert_eq!(st, 201, "{run}");
    let id = run["id"].as_str().unwrap().to_string();
    let (st, v) = s
        .post(&format!("/api/runs/{id}/fund"), json!({"method": "bogus"}))
        .await;
    assert_eq!((st, code(&v)), (400, "invalid_method"), "{v}");
    assert!(has_hint(&v));
    let (st, v) = s.post(&format!("/api/runs/{id}/fund"), json!({"method": "zec"})).await;
    assert_eq!(st, 200, "{v}");
    assert_eq!(v["status"], json!("awaiting_funds"));
    let f = &v["funding"];
    assert_eq!(f["venue"], json!("treasury"));
    assert_eq!(f["status"], json!("awaiting_deposit"));
    assert_eq!(f["origin_asset"], json!("ZEC"));
    assert_eq!(f["treasury_address"], json!(STUB_TREASURY));
    assert_eq!(f["deposit_address"], json!(STUB_TREASURY));
    let payroll = payslip::money::usd_cents_to_zat(1_105_000, STUB_RATE_E6).unwrap();
    let reserve = payslip::runs::fee_estimate_zat(2, 0);
    let required = TreasuryVenue::required_zat(payroll, reserve);
    assert_eq!(f["zec_required_zat"], json!(required));
    assert_eq!(f["quoted_zat"], json!(required));
    assert_eq!(f["amount_in"], json!(payslip::money::format_zec(required)));
    assert_eq!(f["rate_usd_per_zec_e6"], json!(STUB_RATE_E6));
    assert_eq!(f["requested_usd_cents"], json!(1_105_000));
    let deadline = time::OffsetDateTime::parse(
        f["deadline"].as_str().unwrap(),
        &time::format_description::well_known::Rfc3339,
    )
    .unwrap();
    let minutes = (deadline - time::OffsetDateTime::now_utc()).whole_minutes();
    assert!((23 * 60..=24 * 60).contains(&minutes), "{minutes}");
    // The empty stub treasury: nothing received, the whole need outstanding at the tip's rate.
    assert_eq!(f["zec_received_zat"], json!(0));
    assert_eq!(f["zec_pending_zat"], json!(0));
    assert_eq!(f["zec_shortfall_zat"], json!(payroll + reserve));
    assert!(f["funded_at_height"].is_null());
    // Polling reads the treasury again and answers the same shape.
    let (st, v) = s.get(&format!("/api/runs/{id}/funding")).await;
    assert_eq!(st, 200, "{v}");
    assert_eq!(v["funding"]["status"], json!("awaiting_deposit"));
    assert_eq!(v["funding"]["zec_required_zat"], json!(required));
    let (st, v) = s
        .post(
            &format!("/api/runs/{id}/funding/deposit-tx"),
            json!({"tx_hash": "ab".repeat(32)}),
        )
        .await;
    assert_eq!((st, code(&v)), (400, "deposit_tx_not_needed"), "{v}");
    // Statements-only deployments fund nothing.
    let statements = start().await;
    let (_, h) = statements.get("/api/health").await;
    assert_eq!(h["fund_with_zec"], json!(false));
}

/// PAYSLIP_MAX_RUN_USD_CENTS: a payroll over the cap is refused when the run is created, with
/// the cap in the message; health reports the cap.
#[tokio::test]
async fn a_run_over_the_cap_is_refused_at_creation() {
    let (s, pool) = start_full_with(|c| c.max_run_usd_cents = Some(100_000)).await;
    let (_, h) = s.get("/api/health").await;
    assert_eq!(h["max_run_usd_cents"], json!(100_000));
    let a = contractor(&pool, 1).await;
    let (st, v) = s
        .post(
            "/api/runs",
            run_body("2026-09-01", "2026-09-30", &[(&a, 480_000, "INV-1")], "k-cap"),
        )
        .await;
    assert_eq!((st, code(&v)), (400, "run_over_cap"), "{v}");
    assert!(v["error"]["message"].as_str().unwrap().contains("1000.00"));
    assert!(has_hint(&v));
    let (st, v) = s
        .post(
            "/api/runs",
            run_body("2026-09-01", "2026-09-30", &[(&a, 100_000, "INV-1")], "k-under"),
        )
        .await;
    assert_eq!(st, 201, "{v}");
}
