//! HTTP API behaviour that needs no chain, driven over a real socket: a statements-only service
//! whose lightwalletd is unreachable (every answer must come before any scan), and a full-mode
//! service with no payer wallet whose executor runs on a stub chain (endpoints that only read and
//! write payslip.db).

use std::{net::SocketAddr, path::Path, sync::Arc, time::Duration};

use async_trait::async_trait;
use payslip::{
    api::{self, AppState},
    config::{Config, VenueKind, ZcashNetwork},
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
        schedule_lock: tokio::sync::Mutex::new(()),
        lwd: tokio::sync::Mutex::new(payslip::wallet::lwd::connect(&cfg.lightwalletd_url).unwrap()),
        last_wallet: std::sync::Mutex::new(None),
        prices: Arc::new(payslip::prices::Prices::new(None, None)),
        scan_slots: tokio::sync::Semaphore::new(3),
        sse_slots: Arc::new(tokio::sync::Semaphore::new(api::MAX_EVENT_STREAMS)),
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

/// A real testnet unified address (shielded receivers), distinct per seed, so a contractor's
/// record passes the same checks a PATCH re-runs on it.
fn testnet_address(seed: u8) -> String {
    let params = Network::TestNetwork;
    let ufvk = zcash_keys::keys::UnifiedSpendingKey::from_seed(&params, &[seed; 32], zip32::AccountId::ZERO)
        .unwrap()
        .to_unified_full_viewing_key();
    let (ua, _) = ufvk
        .default_address(zcash_keys::keys::UnifiedAddressRequest::SHIELDED)
        .unwrap();
    payslip::payer::encode_ua_r0(&params, &ua).unwrap()
}

async fn contractor(pool: &Pool, i: u32) -> String {
    db::insert_contractor(
        pool,
        &NewContractor {
            name: format!("Contractor {i}"),
            email: None,
            unified_address: testnet_address(i as u8),
            settlement_choice: "hold_zec".into(),
            payout_chain: None,
            payout_address: None,
            default_amount_usd_cents: None,
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

// ---------------------------------------------------------------------------------------------
// Payment requests and the pay schedule (ADR-028)

impl Service {
    async fn put(&self, path: &str, body: Value) -> (u16, Value) {
        let r = self
            .http
            .put(format!("{}{path}", self.base))
            .header("content-type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .unwrap();
        let s = r.status().as_u16();
        (s, r.json().await.unwrap_or(Value::Null))
    }

    async fn patch(&self, path: &str, body: Value) -> (u16, Value) {
        let r = self
            .http
            .patch(format!("{}{path}", self.base))
            .header("content-type", "application/json")
            .body(body.to_string())
            .send()
            .await
            .unwrap();
        let s = r.status().as_u16();
        (s, r.json().await.unwrap_or(Value::Null))
    }
}

fn fingerprint(ufvk: &str) -> String {
    ViewingKey::parse(&ZcashNetwork::Testnet, ufvk).unwrap().fingerprint
}

/// A contractor whose viewing key is `testnet_ufvk(seed)`, as the portal resolves it.
async fn keyed_contractor(pool: &Pool, i: u32, seed: u8) -> (String, String) {
    let id = contractor(pool, i).await;
    let key = testnet_ufvk(seed);
    db::set_contractor_fingerprint(pool, &id, &fingerprint(&key))
        .await
        .unwrap();
    (id, key)
}

fn request_body(key: &str, cents: i64, inv: &str, start: &str, end: &str) -> Value {
    json!({"ufvk": key, "amount_usd_cents": cents, "period_start": start, "period_end": end, "invoice_ref": inv})
}

/// The portal endpoints exist on a statements-only deployment (a contractor can reach them),
/// but it knows no keys; the payer's request and schedule endpoints are gated like the rest.
#[tokio::test]
async fn statements_mode_gates_the_payer_request_endpoints_and_knows_no_keys() {
    let s = start().await;
    let (st, v) = s
        .post(
            "/api/portal/requests",
            request_body(&testnet_ufvk(1), 480_000, "INV-1", "2026-10-01", "2026-10-31"),
        )
        .await;
    assert_eq!((st, code(&v)), (404, "unknown_key"), "{v}");
    assert!(v["error"]["hint"].as_str().unwrap().contains("statements only"));
    let (st, v) = s
        .post("/api/portal/requests/list", json!({"ufvk": testnet_ufvk(1)}))
        .await;
    assert_eq!((st, code(&v)), (404, "unknown_key"), "{v}");
    for path in ["/api/requests", "/api/schedule", "/api/requests?status=submitted"] {
        let (st, v) = s.get(path).await;
        assert_eq!((st, code(&v)), (404, "statements_only"), "{path}: {v}");
    }
    let (st, v) = s.post("/api/requests/abc/approve", json!({})).await;
    assert_eq!((st, code(&v)), (404, "statements_only"), "{v}");
    let (st, v) = s
        .put("/api/schedule", json!({"cadence": "monthly", "pay_day": "last"}))
        .await;
    assert_eq!((st, code(&v)), (404, "statements_only"), "{v}");
}

/// A contractor's key maps to them by fingerprint; any other key is `unknown_key`; the fields
/// are checked as a pay line's are.
#[tokio::test]
async fn a_request_is_keyed_by_the_contractors_viewing_key_and_validated() {
    let (s, pool) = start_full().await;
    let (id, key) = keyed_contractor(&pool, 1, 1).await;
    let (st, v) = s
        .post(
            "/api/portal/requests",
            request_body(&testnet_ufvk(2), 480_000, "INV-1", "2026-10-01", "2026-10-31"),
        )
        .await;
    assert_eq!((st, code(&v)), (404, "unknown_key"), "{v}");
    assert!(has_hint(&v));
    for (body, want) in [
        (
            request_body(&key, 0, "INV-1", "2026-10-01", "2026-10-31"),
            "invalid_amount",
        ),
        (
            request_body(&key, 1_000_000_001, "INV-1", "2026-10-01", "2026-10-31"),
            "invalid_amount",
        ),
        (
            request_body(&key, 100, "INV-1", "2026-10-31", "2026-10-01"),
            "invalid_period",
        ),
        (
            request_body(&key, 100, "", "2026-10-01", "2026-10-31"),
            "invalid_invoice_ref",
        ),
        (
            request_body(&key, 100, "a|b", "2026-10-01", "2026-10-31"),
            "invalid_invoice_ref",
        ),
        (
            request_body(&key, 100, &"x".repeat(65), "2026-10-01", "2026-10-31"),
            "invoice_ref_too_long",
        ),
    ] {
        let (st, v) = s.post("/api/portal/requests", body).await;
        assert_eq!((st, code(&v)), (400, want), "{v}");
        assert!(has_hint(&v));
    }
    let mut body = request_body(&key, 100, "INV-1", "2026-10-01", "2026-10-31");
    body["due_date"] = json!("soon");
    let (st, v) = s.post("/api/portal/requests", body.clone()).await;
    assert_eq!((st, code(&v)), (400, "invalid_due_date"), "{v}");
    body["due_date"] = json!("2026-11-05");
    body["recurring"] = json!("yearly");
    let (st, v) = s.post("/api/portal/requests", body.clone()).await;
    assert_eq!((st, code(&v)), (400, "invalid_recurring"), "{v}");
    body["recurring"] = json!("monthly");
    body["note"] = json!("  October retainer  ");
    let (st, v) = s.post("/api/portal/requests", body).await;
    assert_eq!(st, 201, "{v}");
    assert_eq!(v["status"], json!("submitted"));
    assert_eq!(v["contractor_id"], json!(id));
    assert_eq!(v["contractor_name"], json!("Contractor 1"));
    assert_eq!(v["note"], json!("October retainer"));
    assert_eq!(v["recurring"], json!("monthly"));
    assert_eq!(v["due_date"], json!("2026-11-05"));
    assert_eq!(v["txid"], Value::Null);
    // The contractor's list shows it.
    let (st, mine) = s.post("/api/portal/requests/list", json!({"ufvk": key})).await;
    assert_eq!(st, 200, "{mine}");
    assert_eq!(mine["contractor"]["name"], json!("Contractor 1"));
    assert_eq!(mine["requests"].as_array().unwrap().len(), 1);
    assert_eq!(mine["requests"][0]["id"], v["id"]);
}

/// The payer's queue: submitted to approved (with a note) or rejected; the decision rules.
#[tokio::test]
async fn requests_are_approved_or_rejected_from_the_queue() {
    let (s, pool) = start_full().await;
    let (_, key) = keyed_contractor(&pool, 1, 1).await;
    let mut ids = vec![];
    for inv in ["R-1", "R-2", "R-3"] {
        let (st, v) = s
            .post(
                "/api/portal/requests",
                request_body(&key, 50_000, inv, "2026-10-01", "2026-10-31"),
            )
            .await;
        assert_eq!(st, 201, "{v}");
        ids.push(v["id"].as_str().unwrap().to_string());
    }
    let (st, v) = s.get("/api/requests?status=submitted").await;
    assert_eq!(st, 200, "{v}");
    assert_eq!(v["requests"].as_array().unwrap().len(), 3);
    assert_eq!(v["counts"]["submitted"], json!(3));
    let (st, v) = s.get("/api/requests?status=paid").await;
    assert_eq!((st, v["requests"].as_array().unwrap().len()), (200, 0));
    let (st, v) = s.get("/api/requests?status=done").await;
    assert_eq!((st, code(&v)), (400, "invalid_status"));

    let (st, v) = s
        .post(&format!("/api/requests/{}/approve", ids[0]), json!({"note": "Thanks"}))
        .await;
    assert_eq!((st, v["status"].as_str()), (200, Some("approved")), "{v}");
    assert_eq!(v["decision_note"], json!("Thanks"));
    assert!(v["decided_at"].is_string());
    // Approving again is a no-op; rejecting an approved request that no run took is allowed.
    let (st, v) = s.post(&format!("/api/requests/{}/approve", ids[0]), json!({})).await;
    assert_eq!((st, v["status"].as_str()), (200, Some("approved")));
    let (st, v) = s
        .post(
            &format!("/api/requests/{}/reject", ids[1]),
            json!({"note": "Not this month"}),
        )
        .await;
    assert_eq!((st, v["status"].as_str()), (200, Some("rejected")), "{v}");
    assert_eq!(v["decision_note"], json!("Not this month"));
    let (st, v) = s.post(&format!("/api/requests/{}/approve", ids[1]), json!({})).await;
    assert_eq!((st, code(&v)), (409, "request_decided"), "{v}");
    let (st, v) = s.post("/api/requests/nope/approve", json!({})).await;
    assert_eq!((st, code(&v)), (404, "not_found"));
    let (st, v) = s
        .post(
            &format!("/api/requests/{}/reject", ids[2]),
            json!({"note": "x".repeat(1001)}),
        )
        .await;
    assert_eq!((st, code(&v)), (400, "note_too_long"), "{v}");
    // The contractor sees the outcomes and the payer's notes.
    let (_, mine) = s.post("/api/portal/requests/list", json!({"ufvk": key})).await;
    let statuses: Vec<&str> = mine["requests"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["status"].as_str().unwrap())
        .collect();
    assert_eq!(statuses, vec!["submitted", "rejected", "approved"]);
    let (_, all) = s.get("/api/requests").await;
    assert_eq!(all["counts"], json!({"submitted": 1, "approved": 1}));
}

/// Approved requests join a run made by hand: onto the contractor's own line when the body has
/// one, else as a line of their own; discarding the draft gives them back.
#[tokio::test]
async fn approved_requests_join_a_run_for_their_period() {
    let (s, pool) = start_full().await;
    let (a, key_a) = keyed_contractor(&pool, 1, 1).await;
    let (b, key_b) = keyed_contractor(&pool, 2, 2).await;
    let c = contractor(&pool, 3).await;
    let mut approved = vec![];
    for (key, inv, cents) in [(&key_a, "A-1", 30_000), (&key_b, "B-1", 40_000), (&key_b, "B-2", 5_000)] {
        let (_, v) = s
            .post(
                "/api/portal/requests",
                request_body(key, cents, inv, "2026-10-01", "2026-10-31"),
            )
            .await;
        let id = v["id"].as_str().unwrap().to_string();
        let (st, _) = s.post(&format!("/api/requests/{id}/approve"), json!({})).await;
        assert_eq!(st, 200);
        approved.push(id);
    }
    // A request for another period, and one still submitted, are not taken.
    let (_, other) = s
        .post(
            "/api/portal/requests",
            request_body(&key_a, 1, "A-NOV", "2026-11-01", "2026-11-30"),
        )
        .await;
    s.post(
        &format!("/api/requests/{}/approve", other["id"].as_str().unwrap()),
        json!({}),
    )
    .await;
    s.post(
        "/api/portal/requests",
        request_body(&key_a, 1, "A-LATER", "2026-10-01", "2026-10-31"),
    )
    .await;

    let mut body = run_body(
        "2026-10-01",
        "2026-10-31",
        &[(&a, 99_000, "A-EDITED"), (&c, 10_000, "C-1")],
        "k-req",
    );
    body["include_requests"] = json!(true);
    let (st, run) = s.post("/api/runs", body).await;
    assert_eq!(st, 201, "{run}");
    let lines = run["lines"].as_array().unwrap();
    assert_eq!(lines.len(), 3, "{run}");
    let line_a = lines.iter().find(|l| l["contractor_id"] == json!(a)).unwrap();
    assert_eq!(
        line_a["amount_usd_cents"],
        json!(99_000),
        "the payer's own line is kept"
    );
    let line_b = lines.iter().find(|l| l["contractor_id"] == json!(b)).unwrap();
    assert_eq!(line_b["amount_usd_cents"], json!(45_000), "two requests make one line");
    assert_eq!(line_b["invoice_ref"], json!("B-1, B-2"));
    let (_, v) = s.get("/api/requests?status=approved").await;
    let taken: Vec<(&str, bool, bool)> = v["requests"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r["invoice_ref"].as_str().unwrap(),
                r["run_id"] == run["id"],
                r["line_id"].is_string(),
            )
        })
        .collect();
    assert!(taken.contains(&("A-1", true, true)), "{taken:?}");
    assert!(taken.contains(&("B-1", true, true)));
    assert!(taken.contains(&("B-2", true, true)));
    assert!(taken.contains(&("A-NOV", false, false)));
    let (_, log) = s.get(&format!("/api/runs/{}/log", run["id"].as_str().unwrap())).await;
    assert!(log["events"].as_array().unwrap().iter().any(|e| e["message"]
        .as_str()
        .unwrap()
        .contains("3 approved payment requests taken")));
    // A request already in a run cannot be rejected, and cannot join another run.
    let (st, v) = s
        .post(&format!("/api/requests/{}/reject", approved[0]), json!({}))
        .await;
    assert_eq!((st, code(&v)), (409, "request_in_run"), "{v}");
    let mut again = run_body("2026-10-01", "2026-10-31", &[(&c, 1, "C-2")], "k-req-2");
    again["allow_overlap"] = json!(true);
    again["request_ids"] = json!([approved[0]]);
    let (st, v) = s.post("/api/runs", again).await;
    assert_eq!((st, code(&v)), (409, "request_not_available"), "{v}");
    // Discarding the draft releases them for the next run.
    let (st, _) = s
        .delete(
            &format!("/api/runs/{}", run["id"].as_str().unwrap()),
            Some("application/json"),
            "",
        )
        .await;
    assert_eq!(st, 204);
    let (_, v) = s.get("/api/requests?status=approved").await;
    assert!(v["requests"]
        .as_array()
        .unwrap()
        .iter()
        .all(|r| r["run_id"].is_null() && r["line_id"].is_null()));
    // Exactly the named ones: the rest wait.
    let mut named = run_body("2026-10-01", "2026-10-31", &[(&c, 1, "C-3")], "k-req-3");
    named["request_ids"] = json!([approved[1]]);
    let (st, run) = s.post("/api/runs", named).await;
    assert_eq!(st, 201, "{run}");
    assert_eq!(run["lines"].as_array().unwrap().len(), 2);
    let (_, v) = s.get("/api/requests?status=approved").await;
    let in_run: Vec<&str> = v["requests"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|r| r["run_id"] == run["id"])
        .map(|r| r["invoice_ref"].as_str().unwrap())
        .collect();
    assert_eq!(in_run, vec!["B-1"]);
    let mut unknown = run_body("2026-12-01", "2026-12-31", &[(&c, 1, "C-4")], "k-req-4");
    unknown["request_ids"] = json!(["nope"]);
    let (st, v) = s.post("/api/runs", unknown).await;
    assert_eq!((st, code(&v)), (400, "unknown_request"), "{v}");
}

/// A contractor's default amount: set, cleared, validated, and left alone by other edits.
#[tokio::test]
async fn a_contractors_default_amount_is_edited_through_patch() {
    let (s, pool) = start_full().await;
    let id = contractor(&pool, 1).await;
    let path = format!("/api/contractors/{id}");
    let (st, v) = s.get(&path).await;
    assert_eq!((st, &v["default_amount_usd_cents"]), (200, &Value::Null));
    let (st, v) = s.patch(&path, json!({"default_amount_usd_cents": 480_000})).await;
    assert_eq!((st, &v["default_amount_usd_cents"]), (200, &json!(480_000)), "{v}");
    let (_, v) = s.patch(&path, json!({"name": "Renamed"})).await;
    assert_eq!(v["default_amount_usd_cents"], json!(480_000), "absent leaves it: {v}");
    for bad in [json!(0), json!(-5), json!(12.5), json!("4800"), json!(1_000_000_001)] {
        let (st, v) = s.patch(&path, json!({"default_amount_usd_cents": bad})).await;
        assert_eq!((st, code(&v)), (400, "invalid_default_amount"), "{bad}: {v}");
    }
    let (_, v) = s.patch(&path, json!({"default_amount_usd_cents": null})).await;
    assert_eq!(v["default_amount_usd_cents"], Value::Null, "null clears it: {v}");
}

fn today() -> time::Date {
    time::OffsetDateTime::now_utc().date()
}

fn iso(d: time::Date) -> String {
    payslip::schedule::iso(d)
}

/// This calendar month as a period.
fn this_month() -> (String, String) {
    let first = time::Date::from_calendar_date(today().year(), today().month(), 1).unwrap();
    let last = first.replace_day(first.month().length(first.year())).unwrap();
    (iso(first), iso(last))
}

/// A monthly schedule whose pay day is today, drafting on the day: the draft is due at once.
fn due_today() -> Value {
    let day = today().day();
    json!({
        "cadence": "monthly",
        "pay_day": if day <= 28 { day.to_string() } else { "last".into() },
        "draft_days_before": 0,
    })
}

/// Saving a schedule inside its draft window drafts the period at once, with one line per
/// contractor who has a default amount or an approved request; the schedule then moves on and
/// names the draft until it is paid.
#[tokio::test]
async fn the_schedule_drafts_from_defaults_and_approved_requests() {
    let (s, pool) = start_full().await;
    let (st, v) = s.get("/api/schedule").await;
    assert_eq!((st, &v["schedule"]), (200, &Value::Null));
    let (st, v) = s
        .put("/api/schedule", json!({"cadence": "yearly", "pay_day": "1"}))
        .await;
    assert_eq!((st, code(&v)), (400, "invalid_cadence"), "{v}");
    let (st, v) = s
        .put("/api/schedule", json!({"cadence": "weekly", "pay_day": "25"}))
        .await;
    assert_eq!((st, code(&v)), (400, "invalid_pay_day"), "{v}");
    let (st, v) = s
        .put(
            "/api/schedule",
            json!({"cadence": "monthly", "pay_day": "last", "draft_days_before": 40}),
        )
        .await;
    assert_eq!((st, code(&v)), (400, "invalid_draft_days"), "{v}");

    let (a, key_a) = keyed_contractor(&pool, 1, 1).await;
    let b = contractor(&pool, 2).await;
    let _nobody = contractor(&pool, 3).await;
    for (id, cents) in [(&a, 100_000), (&b, 250_000)] {
        let (st, _) = s
            .patch(
                &format!("/api/contractors/{id}"),
                json!({"default_amount_usd_cents": cents}),
            )
            .await;
        assert_eq!(st, 200);
    }
    let (start, end) = this_month();
    // An approved request from A for this month replaces A's default amount.
    let (_, r) = s
        .post(
            "/api/portal/requests",
            request_body(&key_a, 123_400, "A-OCT", &start, &end),
        )
        .await;
    s.post(
        &format!("/api/requests/{}/approve", r["id"].as_str().unwrap()),
        json!({}),
    )
    .await;

    let (st, v) = s.put("/api/schedule", due_today()).await;
    assert_eq!(st, 200, "{v}");
    let sched = &v["schedule"];
    assert_eq!(sched["cadence"], json!("monthly"));
    assert_eq!(sched["draft_days_before"], json!(0));
    assert_eq!(sched["active"], json!(true));
    let drafted = &sched["drafted"];
    assert_eq!(drafted["period_start"], json!(start), "{v}");
    assert_eq!(drafted["period_end"], json!(end));
    assert_eq!(drafted["pay_day"], json!(iso(today())));
    assert_eq!(drafted["status"], json!("draft"));
    assert_eq!(sched["overdue"], json!(false));
    // The next period is the month after; its pay day and draft day are reported.
    assert!(sched["next_period_start"].as_str().unwrap() > end.as_str(), "{v}");
    assert!(sched["next_pay_day"].is_string() && sched["drafts_on"].is_string());

    let run_id = drafted["run_id"].as_str().unwrap();
    let (st, run) = s.get(&format!("/api/runs/{run_id}")).await;
    assert_eq!((st, run["status"].as_str()), (200, Some("draft")), "{run}");
    let lines = run["lines"].as_array().unwrap();
    assert_eq!(lines.len(), 2, "A by request, B by default, nobody for C: {run}");
    let line_a = lines.iter().find(|l| l["contractor_id"] == json!(a)).unwrap();
    assert_eq!(line_a["amount_usd_cents"], json!(123_400));
    assert_eq!(line_a["invoice_ref"], json!("A-OCT"));
    let line_b = lines.iter().find(|l| l["contractor_id"] == json!(b)).unwrap();
    assert_eq!(line_b["amount_usd_cents"], json!(250_000));
    assert_eq!(line_b["invoice_ref"], json!(format!("{start} to {end}")));
    let (_, v) = s.get("/api/requests?status=approved").await;
    assert_eq!(v["requests"][0]["run_id"], json!(run_id), "the request is in the draft");
    let (_, log) = s.get(&format!("/api/runs/{run_id}/log")).await;
    assert!(log["events"].as_array().unwrap().iter().any(|e| e["message"]
        .as_str()
        .unwrap()
        .starts_with("Drafted by the pay schedule")));

    // Saving again does not draft the period twice: it is covered, so the schedule moves on.
    let (st, v) = s.put("/api/schedule", due_today()).await;
    assert_eq!(st, 200, "{v}");
    assert_eq!(v["schedule"]["drafted"]["run_id"], json!(run_id));
    let (_, runs) = s.get("/api/runs").await;
    assert_eq!(runs["runs"].as_array().unwrap().len(), 1);
    let (st, v) = s.get("/api/schedule").await;
    assert_eq!((st, v["schedule"]["drafted"]["run_id"].as_str()), (200, Some(run_id)));
}

/// A run made by hand that covers the period is left alone: no draft, the schedule moves on and
/// names that run instead.
#[tokio::test]
async fn the_schedule_skips_a_period_a_run_already_covers() {
    let (s, pool) = start_full().await;
    let a = contractor(&pool, 1).await;
    let (st, _) = s
        .patch(
            &format!("/api/contractors/{a}"),
            json!({"default_amount_usd_cents": 1000}),
        )
        .await;
    assert_eq!(st, 200);
    let (start, end) = this_month();
    let (st, by_hand) = s
        .post("/api/runs", run_body(&start, &end, &[(&a, 777, "HAND")], "k-hand"))
        .await;
    assert_eq!(st, 201, "{by_hand}");
    let (st, v) = s.put("/api/schedule", due_today()).await;
    assert_eq!(st, 200, "{v}");
    assert_eq!(v["schedule"]["drafted"]["run_id"], by_hand["id"]);
    let (_, runs) = s.get("/api/runs").await;
    assert_eq!(runs["runs"].as_array().unwrap().len(), 1, "no second run");
    assert!(v["schedule"]["next_period_start"].as_str().unwrap() > end.as_str());
    // Switched off, the schedule drafts nothing more.
    let mut off = due_today();
    off["active"] = json!(false);
    let (st, v) = s.put("/api/schedule", off).await;
    assert_eq!((st, v["schedule"]["active"].as_bool()), (200, Some(false)), "{v}");
}
