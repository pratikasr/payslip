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
        treasury: None,
        venue,
        executor: Some(executor),
        contractor_lock: tokio::sync::Mutex::new(()),
        schedule_lock: tokio::sync::Mutex::new(()),
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
async fn a_cancelled_run_does_not_replay_for_the_same_draft() {
    let (s, pool) = start_full().await;
    let a = contractor(&pool, 1).await;
    let body = run_body("2026-10-01", "2026-10-31", &[(&a, 1_000, "INV-9")], "key-cancel");
    let (st, first) = s.post("/api/runs", body.clone()).await;
    assert_eq!(st, 201, "{first}");
    let id = first["id"].as_str().unwrap().to_string();
    let (st, v) = s.post(&format!("/api/runs/{id}/cancel"), json!({})).await;
    assert_eq!((st, v["status"].as_str()), (200, Some("cancelled")), "{v}");
    // The same draft approved again is a new run, not the cancelled one.
    let mut again = body;
    again["allow_overlap"] = json!(true);
    let (st, second) = s.post("/api/runs", again).await;
    assert_eq!(st, 201, "{second}");
    assert_ne!(second["id"].as_str(), Some(id.as_str()));
    assert_eq!(second["status"].as_str(), Some("draft"));
}

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
    use payslip::{
        auth::Role,
        config::{AuthConfig, AuthMode},
    };

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

    /// A full-mode service with sign-in required, checking tokens against `jwks_url`, with the
    /// default approval policy (one approval per run).
    pub async fn start(jwks_url: &str, bootstrap: Option<&str>) -> (Service, Pool) {
        start_with(jwks_url, bootstrap, 1).await
    }

    /// As [`start`], requiring `approvals_required` approvals before a run is paid.
    pub async fn start_with(jwks_url: &str, bootstrap: Option<&str>, approvals_required: u32) -> (Service, Pool) {
        start_auth(jwks_url, bootstrap, approvals_required, None).await
    }

    /// As [`start`], with open membership (PAYSLIP_OPEN_MEMBERSHIP): every verified sign-in is
    /// given `role` on first sight once the organisation exists.
    pub async fn start_open(jwks_url: &str, bootstrap: Option<&str>, role: Role) -> (Service, Pool) {
        start_auth(jwks_url, bootstrap, 1, Some(role)).await
    }

    async fn start_auth(
        jwks_url: &str,
        bootstrap: Option<&str>,
        approvals_required: u32,
        open_membership: Option<Role>,
    ) -> (Service, Pool) {
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
            approvals_required,
            open_membership,
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
        .with_run_cap(cfg.max_run_usd_cents)
        .with_approvals_required(cfg.auth.approvals_required);
        let state = Arc::new(AppState {
            viewers: ViewerRegistry::new(&cfg),
            db: db.clone(),
            treasury: None,
            venue,
            executor: Some(executor),
            contractor_lock: tokio::sync::Mutex::new(()),
            schedule_lock: tokio::sync::Mutex::new(()),
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
        ("POST", "/api/runs/{id}/approve", json!({}), RUNS, Need::None),
        ("POST", "/api/runs/{id}/cancel", json!({}), RUNS, Need::DraftRun),
        ("GET", "/api/runs/{id}/events", Value::Null, ALL, Need::None),
        ("GET", "/api/runs/{id}/log", Value::Null, ALL, Need::None),
        // The treasury key (ADR-030): its state for every member, every change admin-only.
        ("GET", "/api/treasury/key", Value::Null, ALL, Need::None),
        (
            "POST",
            "/api/treasury/unlock",
            json!({ "passphrase": "x" }),
            ADMIN,
            Need::None,
        ),
        ("POST", "/api/treasury/lock", json!({}), ADMIN, Need::None),
        (
            "POST",
            "/api/treasury/key",
            json!({ "ciphertext": "x" }),
            ADMIN,
            Need::None,
        ),
        (
            "POST",
            "/api/treasury/key/replace",
            json!({ "ciphertext": "x", "passphrase": "x", "sweep_to": "new" }),
            ADMIN,
            Need::None,
        ),
        (
            "POST",
            "/api/treasury/move",
            json!({ "to_address": "x" }),
            ADMIN,
            Need::None,
        ),
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
    assert_eq!(checked, 39 * 4);
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

// =============================================================================================
// Recorded approvals (migration 0007): named members approve a run before money moves.

/// Admins and approvers approve a run once each (the guard refuses the other roles); with two
/// approvals required the run's creator cannot be one of them; the run JSON lists who approved
/// and how many are required; every approval is on the audit log and in the run's log.
#[tokio::test]
async fn approvals_by_each_role_once_each_and_never_the_creator_at_two() {
    let key = Key::new("k1", 1);
    let jwks = signin::jwks_server(&[&key]).await;
    let (s, pool) = signin::start_with(&jwks, Some("owner@acme.test"), 2).await;
    let (_, h) = s.get("/api/health").await;
    assert_eq!(h["approvals_required"], json!(2));
    let admin = key.token("owner@acme.test", 300, json!({ "name": "Owner" }));
    signin::me(&s, &admin).await;
    let approver = key.token("approver@acme.test", 300, json!({ "name": "Ann Approver" }));
    signin::join(&s, &admin, "approver@acme.test", "approver", &approver).await;
    let second = key.token("second@acme.test", 300, json!({}));
    signin::join(&s, &admin, "second@acme.test", "admin", &second).await;
    let accountant = key.token("accountant@acme.test", 300, json!({}));
    signin::join(&s, &admin, "accountant@acme.test", "accountant", &accountant).await;
    let viewer = key.token("viewer@acme.test", 300, json!({}));
    signin::join(&s, &admin, "viewer@acme.test", "viewer", &viewer).await;
    let c = contractor(&pool, 1).await;
    let (st, run) = s
        .req(
            "POST",
            "/api/runs",
            Some(&admin),
            Some(run_body("2026-09-01", "2026-09-30", &[(&c, 480_000, "INV-1")], "k-1")),
        )
        .await;
    assert_eq!(st, 201, "{run}");
    let run_id = run["id"].as_str().unwrap().to_string();
    assert_eq!(run["approvals"], json!([]));
    assert_eq!(run["approvals_required"], json!(2));
    assert_eq!(run["created_by"], json!("user-owner"), "the creator is recorded");
    let path = format!("/api/runs/{run_id}/approve");
    // The guard: accountants and viewers cannot approve.
    for (role, token) in [("accountant", &accountant), ("viewer", &viewer)] {
        let (st, v) = s.req("POST", &path, Some(token), Some(json!({}))).await;
        assert_eq!((st, code(&v)), (403, "forbidden"), "{role}: {v}");
    }
    // The creator, with two required.
    let (st, v) = s.req("POST", &path, Some(&admin), Some(json!({}))).await;
    assert_eq!((st, code(&v)), (403, "creator_cannot_approve"), "{v}");
    assert!(has_hint(&v));
    // One approval per member.
    let (st, v) = s.req("POST", &path, Some(&approver), Some(json!({}))).await;
    assert_eq!(st, 200, "{v}");
    let a = v["approvals"].as_array().unwrap();
    assert_eq!(a.len(), 1, "{v}");
    assert_eq!(a[0]["user_id"], json!("user-approver"));
    assert_eq!(a[0]["name"], json!("Ann Approver"));
    assert_eq!(a[0]["email"], json!("approver@acme.test"));
    assert_eq!(a[0]["role"], json!("approver"));
    assert!(a[0]["at"].as_str().unwrap().ends_with('Z'));
    let (st, v) = s.req("POST", &path, Some(&approver), Some(json!({}))).await;
    assert_eq!((st, code(&v)), (409, "already_approved"), "{v}");
    assert!(has_hint(&v));
    let (st, v) = s.req("POST", &path, Some(&second), Some(json!({}))).await;
    assert_eq!(st, 200, "{v}");
    let a = v["approvals"].as_array().unwrap();
    assert_eq!(a.len(), 2, "{v}");
    assert_eq!(a[1]["user_id"], json!("user-second"));
    assert_eq!(a[1]["role"], json!("admin"));
    assert_eq!(v["approvals_required"], json!(2));
    // Reads carry the same.
    let (_, v) = s.req("GET", &format!("/api/runs/{run_id}"), Some(&viewer), None).await;
    assert_eq!(v["approvals"].as_array().unwrap().len(), 2);
    // The audit log: one row per approval, by whom, as which role, with the count.
    let (st, v) = s.req("GET", "/api/org/audit", Some(&admin), None).await;
    assert_eq!(st, 200, "{v}");
    let rows: Vec<&Value> = v["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["action"] == json!("run.approve"))
        .collect();
    assert_eq!(rows.len(), 2, "{v}");
    // Newest first.
    assert_eq!(rows[0]["user"]["email"], json!("second@acme.test"));
    assert_eq!(rows[0]["role"], json!("admin"));
    assert_eq!(rows[0]["target"], json!(run_id));
    assert_eq!(rows[0]["details"]["approvals"], json!(2));
    assert_eq!(rows[0]["details"]["approvals_required"], json!(2));
    assert_eq!(rows[1]["user"]["email"], json!("approver@acme.test"));
    assert_eq!(rows[1]["role"], json!("approver"));
    assert_eq!(rows[1]["details"]["approvals"], json!(1));
    // Refused approvals leave no row: two run.approve rows for six attempts.
    let recorded: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE action = 'run.approve'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(recorded, 2);
    // The run's own log names each approval, for the audit trail on the run page.
    let (_, v) = s
        .req("GET", &format!("/api/runs/{run_id}/log"), Some(&admin), None)
        .await;
    let messages: Vec<&str> = v["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["message"].as_str().unwrap())
        .collect();
    assert!(
        messages.contains(&"Approved by Ann Approver (approver), approval 1 of 2"),
        "{messages:?}"
    );
    assert!(
        messages.contains(&"Approved by second (admin), approval 2 of 2"),
        "{messages:?}"
    );
}

/// Execute is refused with `approvals_required`, naming how many are missing, until the
/// approvals are in, whatever else the run still needs; then it is accepted. A run can only be
/// approved before it is paid: not once cancelled, nor once past its swap.
#[tokio::test]
async fn execute_is_refused_until_the_approvals_are_in() {
    let key = Key::new("k1", 1);
    let jwks = signin::jwks_server(&[&key]).await;
    let (s, pool) = signin::start_with(&jwks, Some("owner@acme.test"), 2).await;
    let admin = key.token("owner@acme.test", 300, json!({ "name": "Owner" }));
    signin::me(&s, &admin).await;
    let approver = key.token("approver@acme.test", 300, json!({ "name": "Ann" }));
    signin::join(&s, &admin, "approver@acme.test", "approver", &approver).await;
    let second = key.token("second@acme.test", 300, json!({ "name": "Ben" }));
    signin::join(&s, &admin, "second@acme.test", "approver", &second).await;
    let c = contractor(&pool, 1).await;
    let (st, run) = s
        .req(
            "POST",
            "/api/runs",
            Some(&admin),
            Some(run_body("2026-09-01", "2026-09-30", &[(&c, 480_000, "INV-1")], "k-1")),
        )
        .await;
    assert_eq!(st, 201, "{run}");
    let run_id = run["id"].as_str().unwrap().to_string();
    let execute = format!("/api/runs/{run_id}/execute");
    let approve = format!("/api/runs/{run_id}/approve");
    let (st, v) = s.req("POST", &execute, Some(&admin), Some(json!({}))).await;
    assert_eq!((st, code(&v)), (409, "approvals_required"), "{v}");
    let message = v["error"]["message"].as_str().unwrap();
    assert!(
        message.contains("2 more approvals") && message.contains("0 of 2"),
        "{v}"
    );
    assert!(has_hint(&v));
    // Funding is not held up by approvals. The testnet venue needs a chain this service does not
    // have, so the run is marked funded directly, as a venue's deposit would.
    assert!(db::transition(&pool, &run_id, &["draft"], "funded").await.unwrap());
    let (st, v) = s.req("POST", &approve, Some(&approver), Some(json!({}))).await;
    assert_eq!(st, 200, "{v}");
    assert_eq!(v["status"], json!("funded"));
    let (st, v) = s.req("POST", &execute, Some(&approver), Some(json!({}))).await;
    assert_eq!((st, code(&v)), (409, "approvals_required"), "{v}");
    let message = v["error"]["message"].as_str().unwrap();
    assert!(message.contains("1 more approval") && message.contains("1 of 2"), "{v}");
    assert_eq!(db::get_run(&pool, &run_id).await.unwrap().unwrap().status, "funded");
    // A refused execute leaves the run alone, and no audit row.
    let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE action = 'run.execute'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rows, 0);
    let (st, v) = s.req("POST", &approve, Some(&second), Some(json!({}))).await;
    assert_eq!(st, 200, "{v}");
    let (st, v) = s.req("POST", &execute, Some(&admin), Some(json!({}))).await;
    assert_eq!(st, 202, "{v}");
    assert_eq!(v["approvals"].as_array().unwrap().len(), 2);
    let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE action = 'run.execute'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(rows, 1);
    // Only a run that has not been paid can be approved.
    let (st, other) = s
        .req(
            "POST",
            "/api/runs",
            Some(&admin),
            Some(run_body("2026-10-01", "2026-10-31", &[(&c, 480_000, "INV-2")], "k-2")),
        )
        .await;
    assert_eq!(st, 201, "{other}");
    let other_id = other["id"].as_str().unwrap().to_string();
    let other_approve = format!("/api/runs/{other_id}/approve");
    assert!(db::transition(&pool, &other_id, &["draft"], "paid").await.unwrap());
    let (st, v) = s.req("POST", &other_approve, Some(&approver), Some(json!({}))).await;
    assert_eq!((st, code(&v)), (409, "run_not_approvable"), "{v}");
    assert!(db::transition(&pool, &other_id, &["paid"], "cancelled").await.unwrap());
    let (st, v) = s.req("POST", &other_approve, Some(&approver), Some(json!({}))).await;
    assert_eq!((st, code(&v)), (409, "run_cancelled"), "{v}");

    // With one approval required the creator approves their own run, as the Review step does.
    let (s1, pool1) = signin::start_with(&jwks, Some("owner@acme.test"), 1).await;
    signin::me(&s1, &admin).await;
    let c1 = contractor(&pool1, 1).await;
    let (st, run) = s1
        .req(
            "POST",
            "/api/runs",
            Some(&admin),
            Some(run_body("2026-09-01", "2026-09-30", &[(&c1, 480_000, "INV-1")], "k-1")),
        )
        .await;
    assert_eq!(st, 201, "{run}");
    let id1 = run["id"].as_str().unwrap().to_string();
    let execute1 = format!("/api/runs/{id1}/execute");
    let (st, v) = s1.req("POST", &execute1, Some(&admin), Some(json!({}))).await;
    assert_eq!((st, code(&v)), (409, "approvals_required"), "{v}");
    let (st, v) = s1
        .req(
            "POST",
            &format!("/api/runs/{id1}/approve"),
            Some(&admin),
            Some(json!({})),
        )
        .await;
    assert_eq!(st, 200, "{v}");
    assert_eq!(v["approvals"][0]["user_id"], json!("user-owner"));
    // Approved; what the run still needs is funding.
    let (st, v) = s1.req("POST", &execute1, Some(&admin), Some(json!({}))).await;
    assert_eq!((st, code(&v)), (409, "not_funded"), "{v}");
}

/// With sign-in off nothing changes: runs need no approvals and carry none, execute answers as
/// before, and an approval cannot be recorded. With sign-in on and the policy at 0, the same.
#[tokio::test]
async fn auth_off_needs_no_approvals() {
    let (s, pool) = start_full().await;
    let (_, h) = s.get("/api/health").await;
    assert_eq!(h["approvals_required"], json!(0));
    let c = contractor(&pool, 1).await;
    let (st, run) = s
        .post(
            "/api/runs",
            run_body("2026-09-01", "2026-09-30", &[(&c, 480_000, "INV-1")], "k-1"),
        )
        .await;
    assert_eq!(st, 201, "{run}");
    let run_id = run["id"].as_str().unwrap().to_string();
    assert_eq!(run["approvals"], json!([]));
    assert_eq!(run["approvals_required"], json!(0));
    assert_eq!(run["created_by"], Value::Null);
    let (st, v) = s.post(&format!("/api/runs/{run_id}/execute"), json!({})).await;
    assert_eq!((st, code(&v)), (409, "not_funded"), "{v}");
    let (st, v) = s.post(&format!("/api/runs/{run_id}/approve"), json!({})).await;
    assert_eq!((st, code(&v)), (409, "signin_off"), "{v}");
    assert!(has_hint(&v));
    let (st, _) = s
        .delete(&format!("/api/runs/{run_id}"), Some("application/json"), "")
        .await;
    assert_eq!(st, 204);

    let key = Key::new("k1", 1);
    let jwks = signin::jwks_server(&[&key]).await;
    let (s, pool) = signin::start_with(&jwks, Some("owner@acme.test"), 0).await;
    let admin = key.token("owner@acme.test", 300, json!({}));
    signin::me(&s, &admin).await;
    let c = contractor(&pool, 1).await;
    let (st, run) = s
        .req(
            "POST",
            "/api/runs",
            Some(&admin),
            Some(run_body("2026-09-01", "2026-09-30", &[(&c, 480_000, "INV-1")], "k-1")),
        )
        .await;
    assert_eq!(st, 201, "{run}");
    let run_id = run["id"].as_str().unwrap().to_string();
    assert_eq!(run["created_by"], json!("user-owner"));
    assert_eq!(run["approvals_required"], json!(0));
    let (st, v) = s
        .req(
            "POST",
            &format!("/api/runs/{run_id}/approve"),
            Some(&admin),
            Some(json!({})),
        )
        .await;
    assert_eq!((st, code(&v)), (409, "approvals_off"), "{v}");
    let (st, v) = s
        .req(
            "POST",
            &format!("/api/runs/{run_id}/execute"),
            Some(&admin),
            Some(json!({})),
        )
        .await;
    assert_eq!((st, code(&v)), (409, "not_funded"), "{v}");
}

/// A draft that was approved can still be discarded: its approvals go with it.
#[tokio::test]
async fn an_approved_draft_can_be_discarded() {
    let key = Key::new("k1", 1);
    let jwks = signin::jwks_server(&[&key]).await;
    let (s, pool) = signin::start(&jwks, Some("owner@acme.test")).await;
    let admin = key.token("owner@acme.test", 300, json!({}));
    signin::me(&s, &admin).await;
    let c = contractor(&pool, 1).await;
    let (st, run) = s
        .req(
            "POST",
            "/api/runs",
            Some(&admin),
            Some(run_body("2026-09-01", "2026-09-30", &[(&c, 480_000, "INV-1")], "k-1")),
        )
        .await;
    assert_eq!(st, 201, "{run}");
    let run_id = run["id"].as_str().unwrap().to_string();
    let (st, v) = s
        .req(
            "POST",
            &format!("/api/runs/{run_id}/approve"),
            Some(&admin),
            Some(json!({})),
        )
        .await;
    assert_eq!(st, 200, "{v}");
    let (st, v) = s
        .req("DELETE", &format!("/api/runs/{run_id}"), Some(&admin), Some(json!({})))
        .await;
    assert_eq!(st, 204, "{v}");
    let left: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM run_approvals")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0);
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

// =============================================================================================
// Treasury key control (ADR-030): locked, unlocked, no key, create, replace, move.

use secrecy08::ExposeSecret as _;

mod keys {
    use super::*;
    pub use payslip::seed::SeedFile;
    use payslip::{
        payer::{treasury_address_of_seed, ufvk_of_seed, Payer, TreasuryInfo, WalletInfo},
        seed,
        treasury::{Treasury, WalletBackend},
    };
    use secrecy08::SecretVec;
    use std::{
        path::PathBuf,
        sync::{Mutex, MutexGuard},
    };

    /// The BIP-39 test vector: not a secret.
    pub const PHRASE: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art";
    pub const PASS: &str = "correct horse battery";
    pub const FEE: u64 = 10_000;
    pub const SWEEP_TXID: &str = "abababababababababababababababababababababababababababababababab";

    /// A fresh 24-word phrase, for the key that replaces the first.
    pub fn new_phrase() -> String {
        <bip0039::Mnemonic<bip0039::English>>::generate(bip0039::Count::Words24)
            .phrase()
            .to_string()
    }

    pub fn seed_of(phrase: &str) -> Vec<u8> {
        seed::seed_from_phrase(phrase).unwrap().expose_secret().clone()
    }

    pub fn address_of(phrase: &str) -> String {
        treasury_address_of_seed(&Network::TestNetwork, &seed_of(phrase)).unwrap()
    }

    pub fn ufvk_of(phrase: &str, index: u32) -> String {
        ufvk_of_seed(&Network::TestNetwork, &seed_of(phrase), index).unwrap()
    }

    /// `phrase` encrypted to `pass` as the browser would send it, at a low scrypt work factor
    /// so a test does not spend a second per file; the service accepts any factor up to its
    /// limit. Armored, one scrypt stanza: the same shape as `age -p -a`.
    pub fn ciphertext(phrase: &str, pass: &str) -> String {
        let mut recipient = age::scrypt::Recipient::new(secrecy::SecretString::from(pass.to_string()));
        recipient.set_work_factor(10);
        age::encrypt_and_armor(&recipient, phrase.as_bytes()).unwrap()
    }

    /// The default external transparent address of a testnet seed: what `move` must refuse.
    pub fn transparent_address(seed: u8) -> String {
        use zcash_transparent::keys::IncomingViewingKey as _;
        let params = Network::TestNetwork;
        let ufvk = zcash_keys::keys::UnifiedSpendingKey::from_seed(&params, &[seed; 32], zip32::AccountId::ZERO)
            .unwrap()
            .to_unified_full_viewing_key();
        let (taddr, _) = ufvk.p2pkh().unwrap().derive_external_ivk().unwrap().default_address();
        zcash_keys::address::Address::Transparent(taddr).encode(&params)
    }

    #[derive(Default)]
    pub struct FakeState {
        pub opened: bool,
        pub seed: Option<Vec<u8>>,
        pub treasury: Option<(String, u32)>,
        pub spendable: u64,
        pub pending: u64,
        /// (to, amount after the fee) of every sweep.
        pub sweeps: Vec<(String, u64)>,
        pub accounts: Vec<(u32, String)>,
        pub retired: Vec<String>,
        pub fresh_opens: u32,
    }

    /// The wallet behind the key manager, in memory: it derives real keys and addresses from
    /// the seed it holds and keeps a balance, and nothing reaches a chain.
    #[derive(Default)]
    pub struct FakeWallet {
        s: Mutex<FakeState>,
    }

    impl FakeWallet {
        pub fn new() -> Arc<Self> {
            Arc::new(FakeWallet::default())
        }

        /// As a wallet database that already holds `phrase`'s treasury account (the service ran
        /// with the seed before), with `spendable` zatoshis confirmed.
        pub fn with_treasury(phrase: &str, spendable: u64) -> Arc<Self> {
            let w = FakeWallet::default();
            {
                let mut s = w.s.lock().unwrap();
                s.treasury = Some((address_of(phrase), 4_467_000));
                s.spendable = spendable;
            }
            Arc::new(w)
        }

        pub fn state(&self) -> MutexGuard<'_, FakeState> {
            self.s.lock().unwrap()
        }

        fn info(s: &FakeState) -> Option<WalletInfo> {
            s.treasury.as_ref().map(|(address, birthday)| WalletInfo {
                network: "testnet",
                chain_tip: STUB_TIP,
                synced_height: STUB_TIP,
                birthday_height: *birthday,
                treasury: TreasuryInfo {
                    account_index: 0,
                    unified_address: address.clone(),
                    spendable_zat: s.spendable,
                    pending_zat: s.pending,
                    total_zat: s.spendable + s.pending,
                },
                contractor_accounts: s.accounts.len(),
            })
        }
    }

    #[async_trait]
    impl WalletBackend for FakeWallet {
        async fn open(&self, seed: Option<SecretVec<u8>>) -> anyhow::Result<()> {
            let mut s = self.state();
            s.opened = true;
            if let Some(seed) = seed {
                let address = treasury_address_of_seed(&Network::TestNetwork, seed.expose_secret())?;
                s.treasury = Some((address, 4_467_000));
                s.seed = Some(seed.expose_secret().clone());
            }
            Ok(())
        }
        async fn open_fresh(&self, seed: SecretVec<u8>, _birthday: Option<u32>) -> anyhow::Result<()> {
            let mut s = self.state();
            let address = treasury_address_of_seed(&Network::TestNetwork, seed.expose_secret())?;
            s.opened = true;
            s.fresh_opens += 1;
            s.accounts.clear();
            s.spendable = 0;
            s.pending = 0;
            s.treasury = Some((address, STUB_TIP - 10));
            s.seed = Some(seed.expose_secret().clone());
            Ok(())
        }
        async fn install_seed(&self, seed: SecretVec<u8>) -> anyhow::Result<()> {
            let mut s = self.state();
            if !s.opened {
                anyhow::bail!("wallet not open");
            }
            let address = treasury_address_of_seed(&Network::TestNetwork, seed.expose_secret())?;
            if let Some((a, _)) = &s.treasury {
                if *a != address {
                    return Err(anyhow::Error::new(payslip::payer::SeedMismatch));
                }
            } else {
                s.treasury = Some((address, STUB_TIP - 10));
            }
            s.seed = Some(seed.expose_secret().clone());
            Ok(())
        }
        async fn drop_seed(&self) -> anyhow::Result<()> {
            self.state().seed = None;
            Ok(())
        }
        async fn close_and_retire(&self, stamp: &str) -> anyhow::Result<Vec<PathBuf>> {
            let mut s = self.state();
            s.opened = false;
            s.seed = None;
            let p = PathBuf::from(format!("wallet.db.retired-{stamp}"));
            s.retired.push(p.display().to_string());
            Ok(vec![p])
        }
        async fn wallet_info(&self) -> anyhow::Result<Option<WalletInfo>> {
            let s = self.state();
            if !s.opened {
                anyhow::bail!("wallet not open");
            }
            Ok(Self::info(&s))
        }
        async fn sync(&self) -> anyhow::Result<()> {
            Ok(())
        }
        async fn sweep_treasury(&self, to: &str) -> anyhow::Result<Result<String, SpendError>> {
            let mut s = self.state();
            if s.seed.is_none() {
                anyhow::bail!("this wallet has no seed");
            }
            if s.spendable <= FEE {
                return Ok(Err(SpendError::InsufficientFunds {
                    available: s.spendable,
                    required: FEE,
                }));
            }
            let amount = s.spendable - FEE;
            s.sweeps.push((to.to_string(), amount));
            s.spendable = 0;
            Ok(Ok(SWEEP_TXID.into()))
        }
        async fn tx_fee(&self, _txid: &str) -> anyhow::Result<Option<u64>> {
            Ok(Some(FEE))
        }
        async fn ensure_account(&self, index: u32, name: String) -> anyhow::Result<(String, u32)> {
            let mut s = self.state();
            let seed = s
                .seed
                .clone()
                .ok_or_else(|| anyhow::anyhow!("this wallet has no seed"))?;
            let ufvk = ufvk_of_seed(&Network::TestNetwork, &seed, index)?;
            s.accounts.push((index, name));
            Ok((ufvk, STUB_TIP - 10))
        }
        fn payer(&self) -> Option<Payer> {
            None
        }
        fn chain(&self) -> Option<Arc<dyn ChainOps>> {
            None
        }
    }

    /// The stub chain, with `can_sign` read from the key manager, as the service's chain does.
    struct GatedStub(Arc<Treasury>);

    #[async_trait]
    impl ChainOps for GatedStub {
        async fn can_sign(&self) -> bool {
            self.0.can_sign()
        }
        async fn sync(&self) -> anyhow::Result<()> {
            StubChain.sync().await
        }
        async fn tip(&self) -> anyhow::Result<u32> {
            StubChain.tip().await
        }
        async fn spendable(&self, a: u32) -> anyhow::Result<u64> {
            StubChain.spendable(a).await
        }
        async fn total(&self, a: u32) -> anyhow::Result<u64> {
            StubChain.total(a).await
        }
        async fn account_address(&self, a: u32) -> anyhow::Result<String> {
            StubChain.account_address(a).await
        }
        async fn transparent_address(&self, a: u32) -> anyhow::Result<String> {
            StubChain.transparent_address(a).await
        }
        async fn create_transfer(
            &self,
            f: u32,
            p: Vec<Pay>,
            m: Option<String>,
        ) -> anyhow::Result<Result<String, SpendError>> {
            StubChain.create_transfer(f, p, m).await
        }
        async fn broadcast(&self, t: &str) -> anyhow::Result<()> {
            StubChain.broadcast(t).await
        }
        async fn mined_height(&self, t: &str) -> anyhow::Result<Option<u32>> {
            StubChain.mined_height(t).await
        }
        async fn expiry_height(&self, t: &str) -> anyhow::Result<Option<u32>> {
            StubChain.expiry_height(t).await
        }
        async fn tx_fee(&self, t: &str) -> anyhow::Result<Option<u64>> {
            StubChain.tx_fee(t).await
        }
        async fn received_in_tx(&self, t: &str, a: u32) -> anyhow::Result<u64> {
            StubChain.received_in_tx(t, a).await
        }
        async fn block_time(&self, h: u32) -> anyhow::Result<i64> {
            StubChain.block_time(h).await
        }
    }

    pub struct Keyed {
        pub s: Service,
        pub pool: Pool,
        pub treasury: Arc<Treasury>,
        pub fake: Arc<FakeWallet>,
    }

    /// A full-mode service over `fake`. `seed_file` writes a seed file first (the words and the
    /// passphrase they are encrypted with); `env_pass` sets PAYSLIP_SEED_PASSPHRASE; `auth`
    /// puts sign-in in front of the payer routes.
    pub async fn start(
        fake: Arc<FakeWallet>,
        seed_file: Option<(&str, &str)>,
        env_pass: Option<&str>,
        auth: Option<AuthConfig>,
    ) -> Keyed {
        let dir = tempfile::tempdir().unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let mut cfg = config(dir.path(), addr);
        cfg.statements_only = false;
        cfg.seed_passphrase = env_pass.map(|p| p.to_string());
        if let Some(a) = auth {
            cfg.auth = a;
        }
        if let Some((phrase, pass)) = seed_file {
            SeedFile::new(cfg.seed_path())
                .write_ciphertext(&ciphertext(phrase, pass))
                .unwrap();
        }
        let db = db::open(&cfg.app_db_path()).await.unwrap();
        let treasury = Treasury::open(cfg.clone(), db.clone(), fake.clone()).await.unwrap();
        let venue = payslip::venue::build(&cfg).unwrap();
        let executor = Executor::with_chain(
            cfg.network,
            db.clone(),
            Arc::new(GatedStub(treasury.clone())),
            venue.clone(),
            Arc::new(TreasuryVenue::new(Arc::new(StubRates))),
            Duration::from_millis(5),
            1,
        )
        .with_approvals_required(cfg.auth.approvals_required);
        let auth = cfg
            .auth
            .required()
            .then(|| Arc::new(payslip::auth::Verifier::new(&cfg.auth)));
        let state = Arc::new(AppState {
            viewers: ViewerRegistry::new(&cfg),
            db: db.clone(),
            treasury: Some(treasury.clone()),
            venue,
            executor: Some(executor),
            contractor_lock: tokio::sync::Mutex::new(()),
            schedule_lock: tokio::sync::Mutex::new(()),
            lwd: tokio::sync::Mutex::new(payslip::wallet::lwd::connect(&cfg.lightwalletd_url).unwrap()),
            last_wallet: std::sync::Mutex::new(None),
            prices: Arc::new(payslip::prices::Prices::new(None, None)),
            scan_slots: tokio::sync::Semaphore::new(3),
            sse_slots: Arc::new(tokio::sync::Semaphore::new(api::MAX_EVENT_STREAMS)),
            auth,
            cfg: cfg.clone(),
        });
        tokio::spawn(async move { axum::serve(listener, api::router(state)).await.unwrap() });
        Keyed {
            s: Service {
                base: format!("http://{addr}"),
                cfg,
                http: reqwest::Client::new(),
                _dir: dir,
            },
            pool: db,
            treasury,
            fake,
        }
    }

    pub async fn key(k: &Keyed) -> Value {
        let (st, v) = k.s.get("/api/treasury/key").await;
        assert_eq!(st, 200, "{v}");
        v
    }

    pub fn mode(path: &std::path::Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }
}

/// Without a seed file the service starts: health says `no_key`, reads work, drafting works,
/// and everything that needs the key (the wallet, adding a contractor, funding, unlocking,
/// replacing, moving) answers 409 `no_treasury_key` with the way to create one.
#[tokio::test]
async fn without_a_key_the_service_starts_and_spending_is_refused() {
    let k = keys::start(keys::FakeWallet::new(), None, None, None).await;
    let (st, h) = k.s.get("/api/health").await;
    assert_eq!((st, h["treasury"].as_str()), (200, Some("no_key")), "{h}");
    let v = keys::key(&k).await;
    assert_eq!(v["state"], json!("no_key"));
    assert_eq!(v["key_version"], json!(0));
    assert!(v["address"].is_null() && v["unlocked_until"].is_null() && v["created_at"].is_null());
    assert!(v["storage"]["path"].as_str().unwrap().ends_with("payer.seed.age"));
    assert_eq!(v["storage"]["format"], json!("age scrypt, BIP-39 24 words"));
    let (st, v) = k.s.get("/api/runs").await;
    assert_eq!(st, 200, "{v}");
    let (st, v) = k.s.get("/api/contractors").await;
    assert_eq!(st, 200, "{v}");
    let (st, v) = k.s.get("/api/wallet").await;
    assert_eq!((st, code(&v)), (409, "no_treasury_key"), "{v}");
    assert!(has_hint(&v));
    let (st, v) =
        k.s.post(
            "/api/contractors",
            json!({ "name": "Amara", "unified_address": testnet_address(1), "settlement_choice": "hold_zec" }),
        )
        .await;
    assert_eq!((st, code(&v)), (409, "no_treasury_key"), "{v}");
    // Drafting a run is bookkeeping and works; funding names the treasury and does not.
    let c = contractor(&k.pool, 1).await;
    let (st, run) =
        k.s.post(
            "/api/runs",
            run_body("2026-09-01", "2026-09-30", &[(&c, 480_000, "INV-1")], "k-nokey"),
        )
        .await;
    assert_eq!(st, 201, "{run}");
    let id = run["id"].as_str().unwrap();
    let (st, v) =
        k.s.post(&format!("/api/runs/{id}/fund"), json!({ "method": "zec" }))
            .await;
    assert_eq!((st, code(&v)), (409, "no_treasury_key"), "{v}");
    let (st, v) = k.s.post(&format!("/api/runs/{id}/execute"), json!({})).await;
    assert_eq!((st, code(&v)), (409, "no_treasury_key"), "{v}");
    for (path, body) in [
        ("/api/treasury/unlock", json!({ "passphrase": keys::PASS })),
        ("/api/treasury/lock", json!({})),
        (
            "/api/treasury/key/replace",
            json!({ "ciphertext": keys::ciphertext(keys::PHRASE, keys::PASS), "passphrase": keys::PASS, "sweep_to": "new" }),
        ),
        ("/api/treasury/move", json!({ "to_address": testnet_address(2) })),
    ] {
        let (st, v) = k.s.post(path, body).await;
        assert_eq!((st, code(&v)), (409, "no_treasury_key"), "{path}: {v}");
        assert!(has_hint(&v), "{path}");
    }
}

/// `POST /api/treasury/key` takes the armored age file the browser made (the 24 words
/// encrypted with the passphrase): with the passphrase the file is checked and the treasury is
/// unlocked at once, the seed file is written readable by the service only, and the address is
/// the one the seed derives; a second key is refused, as are a wrong passphrase and anything
/// that is not such a file. Without the passphrase the key is stored and the wallet opens
/// locked; the first unlock creates the treasury account.
#[tokio::test]
async fn a_key_is_created_from_an_uploaded_ciphertext() {
    let k = keys::start(keys::FakeWallet::new(), None, None, None).await;
    let ciphertext = keys::ciphertext(keys::PHRASE, keys::PASS);
    let (st, v) =
        k.s.post("/api/treasury/key", json!({ "ciphertext": "not an age file" }))
            .await;
    assert_eq!((st, code(&v)), (400, "invalid_ciphertext"), "{v}");
    assert!(has_hint(&v));
    let (st, v) =
        k.s.post(
            "/api/treasury/key",
            json!({ "ciphertext": ciphertext, "passphrase": "not the passphrase" }),
        )
        .await;
    assert_eq!((st, code(&v)), (403, "wrong_passphrase"), "{v}");
    assert!(!k.s.cfg.seed_path().exists(), "a refused upload leaves no file");
    let (st, v) =
        k.s.post(
            "/api/treasury/key",
            json!({ "ciphertext": ciphertext, "passphrase": keys::PASS }),
        )
        .await;
    assert_eq!(st, 201, "{v}");
    assert_eq!(v["state"], json!("unlocked"));
    assert_eq!(v["key_version"], json!(1));
    assert_eq!(v["address"], json!(keys::address_of(keys::PHRASE)));
    assert!(v["unlocked_until"].is_string() && v["created_at"].is_string(), "{v}");
    assert_eq!(keys::mode(&k.s.cfg.seed_path()), 0o600);
    // The file on disk is exactly what was uploaded, and it opens with the passphrase.
    let on_disk = std::fs::read_to_string(k.s.cfg.seed_path()).unwrap();
    assert_eq!(on_disk.trim(), ciphertext.trim());
    let seed = keys::SeedFile::new(k.s.cfg.seed_path()).unlock(keys::PASS).unwrap();
    assert_eq!(seed.expose_secret(), &keys::seed_of(keys::PHRASE));
    let (st, h) = k.s.get("/api/health").await;
    assert_eq!((st, h["treasury"].as_str()), (200, Some("unlocked")), "{h}");
    let (st, w) = k.s.get("/api/wallet").await;
    assert_eq!(st, 200, "{w}");
    assert_eq!(w["treasury"]["unified_address"], json!(keys::address_of(keys::PHRASE)));
    let (st, v) =
        k.s.post(
            "/api/treasury/key",
            json!({ "ciphertext": keys::ciphertext(&keys::new_phrase(), keys::PASS), "passphrase": keys::PASS }),
        )
        .await;
    assert_eq!((st, code(&v)), (409, "key_exists"), "{v}");
    assert!(v["error"]["hint"].as_str().unwrap().contains("Replace"));
    assert_eq!(keys::key(&k).await["address"], json!(keys::address_of(keys::PHRASE)));

    // Uploaded without its passphrase: stored, locked, no account until the first unlock.
    let k2 = keys::start(keys::FakeWallet::new(), None, None, None).await;
    let (st, v) =
        k2.s.post(
            "/api/treasury/key",
            json!({ "ciphertext": keys::ciphertext(keys::PHRASE, keys::PASS) }),
        )
        .await;
    assert_eq!(st, 201, "{v}");
    assert_eq!(v["state"], json!("locked"));
    assert!(v["address"].is_null(), "{v}");
    assert_eq!(v["key_version"], json!(1));
    let (st, v) = k2.s.get("/api/wallet").await;
    assert_eq!((st, code(&v)), (409, "treasury_locked"), "{v}");
    let (st, v) =
        k2.s.post("/api/treasury/unlock", json!({ "passphrase": keys::PASS }))
            .await;
    assert_eq!((st, v["state"].as_str()), (200, Some("unlocked")), "{v}");
    assert_eq!(v["address"], json!(keys::address_of(keys::PHRASE)));
    let (st, w) = k2.s.get("/api/wallet").await;
    assert_eq!(st, 200, "{w}");
}

/// An unlock needs the right passphrase and lasts the hours asked (1 to 72, 8 by default);
/// a lock request or the timer locks the treasury again, and a wrong passphrase is 403.
#[tokio::test]
async fn unlock_takes_the_right_passphrase_and_locks_again() {
    let k = keys::start(
        keys::FakeWallet::with_treasury(keys::PHRASE, 0),
        Some((keys::PHRASE, keys::PASS)),
        None,
        None,
    )
    .await;
    let v = keys::key(&k).await;
    assert_eq!(v["state"], json!("locked"));
    assert_eq!(v["address"], json!(keys::address_of(keys::PHRASE)));
    assert_eq!(v["birthday_height"], json!(4_467_000));
    assert_eq!(
        v["key_version"],
        json!(1),
        "a deployment from before migration 0008 gets version 1"
    );
    assert!(v["created_at"].is_string(), "{v}");
    let (st, h) = k.s.get("/api/health").await;
    assert_eq!((st, h["treasury"].as_str()), (200, Some("locked")), "{h}");
    let (st, v) =
        k.s.post("/api/treasury/unlock", json!({ "passphrase": "not the passphrase" }))
            .await;
    assert_eq!((st, code(&v)), (403, "wrong_passphrase"), "{v}");
    assert!(has_hint(&v));
    assert!(!k.treasury.can_sign());
    let (st, v) =
        k.s.post(
            "/api/treasury/unlock",
            json!({ "passphrase": keys::PASS, "hours": 100 }),
        )
        .await;
    assert_eq!((st, code(&v)), (400, "invalid_hours"), "{v}");
    let (st, v) = k.s.post("/api/treasury/unlock", json!({ "passphrase": "" })).await;
    assert_eq!((st, code(&v)), (400, "passphrase_required"), "{v}");
    let before = time::OffsetDateTime::now_utc();
    let (st, v) =
        k.s.post("/api/treasury/unlock", json!({ "passphrase": keys::PASS }))
            .await;
    assert_eq!((st, v["state"].as_str()), (200, Some("unlocked")), "{v}");
    let until = time::OffsetDateTime::parse(
        v["unlocked_until"].as_str().unwrap(),
        &time::format_description::well_known::Rfc3339,
    )
    .unwrap();
    let hours = (until - before).whole_minutes() as f64 / 60.0;
    assert!((7.9..=8.1).contains(&hours), "default 8 hours, got {hours}");
    assert!(k.treasury.can_sign());
    assert!(k.fake.state().seed.is_some(), "the seed is in the wallet");
    let (st, v) = k.s.post("/api/treasury/lock", json!({})).await;
    assert_eq!((st, v["state"].as_str()), (200, Some("locked")), "{v}");
    assert!(v["unlocked_until"].is_null());
    assert!(!k.treasury.can_sign());
    assert!(k.fake.state().seed.is_none(), "the seed left the wallet");
    // Locking a locked treasury is a no-op.
    let (st, v) = k.s.post("/api/treasury/lock", json!({})).await;
    assert_eq!((st, v["state"].as_str()), (200, Some("locked")), "{v}");
    // The timer: an unlock for a moment locks itself again.
    let v = k
        .treasury
        .unlock_for(keys::PASS, Duration::from_millis(300))
        .await
        .unwrap();
    assert_eq!(v.state, "unlocked");
    assert!(k.treasury.can_sign());
    tokio::time::sleep(Duration::from_millis(700)).await;
    assert!(!k.treasury.can_sign(), "locked again by the timer");
    assert_eq!(keys::key(&k).await["state"], json!("locked"));
    assert!(k.fake.state().seed.is_none());
}

/// While locked: syncing, reading, drafting and funding work; adding a contractor, executing
/// a run and moving the treasury answer 409 `treasury_locked`; after an unlock they go through.
#[tokio::test]
async fn a_locked_treasury_refuses_what_signs_and_serves_the_rest() {
    let k = keys::start(
        keys::FakeWallet::with_treasury(keys::PHRASE, 50_000_000),
        Some((keys::PHRASE, keys::PASS)),
        None,
        None,
    )
    .await;
    let (st, w) = k.s.get("/api/wallet").await;
    assert_eq!(st, 200, "{w}");
    assert_eq!(w["treasury"]["spendable_zat"], json!(50_000_000));
    let (st, w) = k.s.post("/api/wallet/sync", json!({})).await;
    assert_eq!(st, 200, "{w}");
    let (st, v) =
        k.s.post(
            "/api/contractors",
            json!({ "name": "Amara", "unified_address": testnet_address(1), "settlement_choice": "hold_zec" }),
        )
        .await;
    assert_eq!((st, code(&v)), (409, "treasury_locked"), "{v}");
    assert!(v["error"]["message"].as_str().unwrap().contains("add a contractor"));
    assert!(v["error"]["hint"].as_str().unwrap().contains("unlock"));
    // A balance to move to a new key needs the old key in memory.
    let (st, v) = k
        .s
        .post(
            "/api/treasury/key/replace",
            json!({ "ciphertext": keys::ciphertext(&keys::new_phrase(), keys::PASS), "passphrase": keys::PASS, "sweep_to": "new" }),
        )
        .await;
    assert_eq!(
        (st, code(&v)),
        (409, "treasury_locked"),
        "a balance to move needs the old key: {v}"
    );
    let c = contractor(&k.pool, 1).await;
    let (st, run) =
        k.s.post(
            "/api/runs",
            run_body("2026-09-01", "2026-09-30", &[(&c, 480_000, "INV-1")], "k-locked"),
        )
        .await;
    assert_eq!(st, 201, "{run}");
    let id = run["id"].as_str().unwrap().to_string();
    let (st, v) =
        k.s.post(&format!("/api/runs/{id}/fund"), json!({ "method": "zec" }))
            .await;
    assert_eq!(
        (st, v["status"].as_str()),
        (200, Some("awaiting_funds")),
        "funding receives, it does not sign: {v}"
    );
    let (st, v) = k.s.post(&format!("/api/runs/{id}/execute"), json!({})).await;
    assert_eq!((st, code(&v)), (409, "treasury_locked"), "{v}");
    assert!(v["error"]["message"].as_str().unwrap().contains("pay this run"));
    let (st, v) =
        k.s.post("/api/treasury/move", json!({ "to_address": testnet_address(3) }))
            .await;
    assert_eq!((st, code(&v)), (409, "treasury_locked"), "{v}");
    let (st, v) =
        k.s.post("/api/treasury/unlock", json!({ "passphrase": keys::PASS, "hours": 1 }))
            .await;
    assert_eq!((st, v["state"].as_str()), (200, Some("unlocked")), "{v}");
    let (st, v) =
        k.s.post(
            "/api/contractors",
            json!({ "name": "Amara", "unified_address": testnet_address(9), "settlement_choice": "hold_zec" }),
        )
        .await;
    assert_eq!(st, 201, "{v}");
    assert_eq!(v["account_index"], json!(2));
    assert!(v["key_rotated_at"].is_null());
    let (st, v) = k.s.post(&format!("/api/runs/{id}/execute"), json!({})).await;
    assert_eq!(st, 202, "{v}");
}

/// Replacing the key: refused while a run is in progress or for the same key; otherwise the old
/// treasury is swept to the new treasury address, the old seed file and wallet are retired next
/// to the new ones, every contractor (archived ones too) gets an account derived from the new
/// seed with the same index and `key_rotated_at`, the key version goes up, and the new key is
/// unlocked. With nothing in the old treasury there is no sweep.
#[tokio::test]
async fn replacing_the_key_sweeps_retires_and_rotates_every_contractor() {
    let k = keys::start(
        keys::FakeWallet::with_treasury(keys::PHRASE, 5_000_000),
        Some((keys::PHRASE, keys::PASS)),
        None,
        None,
    )
    .await;
    let (st, v) =
        k.s.post("/api/treasury/unlock", json!({ "passphrase": keys::PASS }))
            .await;
    assert_eq!(st, 200, "{v}");
    let c1 = contractor(&k.pool, 1).await;
    let c2 = contractor(&k.pool, 2).await;
    let c3 = contractor(&k.pool, 3).await;
    db::mark_fvk_shared(&k.pool, &c1).await.unwrap();
    db::archive_contractor(&k.pool, &c3).await.unwrap();
    let new_phrase = keys::new_phrase();
    let new_pass = "a new passphrase for the new key";
    let new_cipher = keys::ciphertext(&new_phrase, new_pass);
    let body = |cipher: &str, pass: &str, to: &str| json!({ "ciphertext": cipher, "passphrase": pass, "sweep_to": to });
    let (st, v) =
        k.s.post("/api/treasury/key/replace", body(&new_cipher, new_pass, "elsewhere"))
            .await;
    assert_eq!((st, code(&v)), (400, "invalid_sweep_to"), "{v}");
    let (st, v) =
        k.s.post(
            "/api/treasury/key/replace",
            body(&new_cipher, "wrong passphrase", "new"),
        )
        .await;
    assert_eq!((st, code(&v)), (403, "wrong_passphrase"), "{v}");
    let (st, v) =
        k.s.post(
            "/api/treasury/key/replace",
            body(&keys::ciphertext(keys::PHRASE, keys::PASS), keys::PASS, "new"),
        )
        .await;
    assert_eq!((st, code(&v)), (409, "same_key"), "{v}");
    // A run in progress holds the replacement.
    let (st, run) =
        k.s.post(
            "/api/runs",
            run_body("2026-09-01", "2026-09-30", &[(&c1, 480_000, "INV-1")], "k-rep"),
        )
        .await;
    assert_eq!(st, 201, "{run}");
    let run_id = run["id"].as_str().unwrap().to_string();
    sqlx::query("UPDATE runs SET status = 'paying' WHERE id = ?")
        .bind(&run_id)
        .execute(&k.pool)
        .await
        .unwrap();
    let (st, v) =
        k.s.post("/api/treasury/key/replace", body(&new_cipher, new_pass, "new"))
            .await;
    assert_eq!((st, code(&v)), (409, "runs_in_progress"), "{v}");
    assert_eq!(v["error"]["runs"], json!([run_id]));
    sqlx::query("UPDATE runs SET status = 'paid' WHERE id = ?")
        .bind(&run_id)
        .execute(&k.pool)
        .await
        .unwrap();
    // Nothing happened so far.
    assert!(k.fake.state().sweeps.is_empty());
    assert!(k.s.cfg.seed_path().exists());
    assert_eq!(keys::key(&k).await["key_version"], json!(1));

    let (st, v) =
        k.s.post("/api/treasury/key/replace", body(&new_cipher, new_pass, "new"))
            .await;
    assert_eq!(st, 200, "{v}");
    assert_eq!(v["old_address"], json!(keys::address_of(keys::PHRASE)));
    assert_eq!(v["new_address"], json!(keys::address_of(&new_phrase)));
    assert_eq!(v["sweep_txid"], json!(keys::SWEEP_TXID));
    assert!(v["sweep_explorer_url"].as_str().unwrap().contains(keys::SWEEP_TXID));
    assert_eq!(v["contractors_rotated"], json!(3));
    assert_eq!(v["key"]["state"], json!("unlocked"));
    assert_eq!(v["key"]["key_version"], json!(2));
    assert_eq!(v["key"]["address"], json!(keys::address_of(&new_phrase)));
    let retired: Vec<String> = v["retired"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r.as_str().unwrap().to_string())
        .collect();
    assert_eq!(retired.len(), 2, "{retired:?}");
    assert!(retired.iter().any(|r| r.contains("wallet.db.retired-")), "{retired:?}");
    let old_seed = retired
        .iter()
        .find(|r| r.contains("payer.seed.age.retired-"))
        .expect("the old seed file is kept");
    // The old treasury went to the new one, after the fee.
    assert_eq!(
        k.fake.state().sweeps,
        vec![(keys::address_of(&new_phrase), 5_000_000 - keys::FEE)]
    );
    assert_eq!(k.fake.state().fresh_opens, 1);
    // The files: the new key opens with its passphrase, the retired one with the old.
    let old_seed = std::path::PathBuf::from(old_seed);
    assert_eq!(keys::mode(&old_seed), 0o600);
    assert_eq!(
        keys::SeedFile::new(&old_seed)
            .unlock(keys::PASS)
            .unwrap()
            .expose_secret(),
        &keys::seed_of(keys::PHRASE)
    );
    assert_eq!(
        keys::SeedFile::new(k.s.cfg.seed_path())
            .unlock(new_pass)
            .unwrap()
            .expose_secret(),
        &keys::seed_of(&new_phrase)
    );
    assert_eq!(keys::mode(&k.s.cfg.seed_path()), 0o600);
    // Every contractor's account was derived again, same index, new key, nobody told yet.
    for (id, index) in [(&c1, 1u32), (&c2, 2), (&c3, 3)] {
        let c = db::get_contractor(&k.pool, id).await.unwrap().unwrap();
        assert_eq!(c.account_index as u32, index);
        assert!(c.key_rotated_at.is_some(), "{}", c.name);
        assert!(c.fvk_shared_at.is_none(), "{}", c.name);
        assert_eq!(c.account_birthday_height as u32, STUB_TIP - 10);
        assert_eq!(
            c.key_fingerprint.as_deref(),
            Some(fingerprint(&keys::ufvk_of(&new_phrase, index)).as_str()),
            "{}",
            c.name
        );
    }
    assert_eq!(
        k.fake.state().accounts.iter().map(|(i, _)| *i).collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    let (st, v) = k.s.get("/api/contractors").await;
    assert_eq!(st, 200);
    assert!(v["contractors"][0]["key_rotated_at"].is_string(), "{v}");
    // History: version 1 retired, version 2 current.
    let current = db::current_treasury_key(&k.pool).await.unwrap().unwrap();
    assert_eq!((current.version, current.retired_at.is_none()), (2, true));
    assert_eq!(current.address.as_deref(), Some(keys::address_of(&new_phrase).as_str()));
    let retired_at: Option<String> = sqlx::query_scalar("SELECT retired_at FROM treasury_keys WHERE version = 1")
        .fetch_one(&k.pool)
        .await
        .unwrap();
    assert!(retired_at.is_some());
    let (st, w) = k.s.get("/api/wallet").await;
    assert_eq!(st, 200, "{w}");
    assert_eq!(w["treasury"]["unified_address"], json!(keys::address_of(&new_phrase)));

    // An empty old treasury: no sweep, everything else the same.
    let k2 = keys::start(
        keys::FakeWallet::with_treasury(keys::PHRASE, 0),
        Some((keys::PHRASE, keys::PASS)),
        None,
        None,
    )
    .await;
    let other = keys::new_phrase();
    let (st, v) =
        k2.s.post(
            "/api/treasury/key/replace",
            body(&keys::ciphertext(&other, new_pass), new_pass, "new"),
        )
        .await;
    assert_eq!(st, 200, "a locked key with nothing to sweep can be replaced: {v}");
    assert!(v["sweep_txid"].is_null() && v["sweep_explorer_url"].is_null(), "{v}");
    assert_eq!(v["contractors_rotated"], json!(0));
    assert_eq!(v["key"]["key_version"], json!(2));
    assert!(k2.fake.state().sweeps.is_empty());
    assert_eq!(keys::key(&k2).await["address"], json!(keys::address_of(&other)));
}

/// `POST /api/treasury/move` sends the whole treasury to a shielded address of the company's
/// choosing; a transparent address, an address of another kind, an empty treasury and a run
/// in progress are refused.
#[tokio::test]
async fn moving_the_treasury_out_refuses_transparent_addresses() {
    let k = keys::start(
        keys::FakeWallet::with_treasury(keys::PHRASE, 0),
        Some((keys::PHRASE, keys::PASS)),
        None,
        None,
    )
    .await;
    let (st, v) =
        k.s.post("/api/treasury/unlock", json!({ "passphrase": keys::PASS }))
            .await;
    assert_eq!(st, 200, "{v}");
    let taddr = keys::transparent_address(7);
    assert!(taddr.starts_with("tm"), "{taddr}");
    let (st, v) = k.s.post("/api/treasury/move", json!({ "to_address": taddr })).await;
    assert_eq!((st, code(&v)), (400, "address_not_shielded"), "{v}");
    assert!(has_hint(&v));
    let (st, v) =
        k.s.post("/api/treasury/move", json!({ "to_address": "not an address" }))
            .await;
    assert_eq!((st, code(&v)), (400, "invalid_address"), "{v}");
    let to = testnet_address(5);
    let (st, v) = k.s.post("/api/treasury/move", json!({ "to_address": to })).await;
    assert_eq!((st, code(&v)), (409, "treasury_empty"), "{v}");
    k.fake.state().spendable = 2_500_000;
    k.fake.state().pending = 100;
    let (st, v) = k.s.post("/api/treasury/move", json!({ "to_address": to })).await;
    assert_eq!((st, code(&v)), (409, "treasury_pending"), "{v}");
    k.fake.state().pending = 0;
    let c = contractor(&k.pool, 1).await;
    let (st, run) =
        k.s.post(
            "/api/runs",
            run_body("2026-09-01", "2026-09-30", &[(&c, 480_000, "INV-1")], "k-move"),
        )
        .await;
    assert_eq!(st, 201, "{run}");
    let run_id = run["id"].as_str().unwrap().to_string();
    sqlx::query("UPDATE runs SET status = 'allocating' WHERE id = ?")
        .bind(&run_id)
        .execute(&k.pool)
        .await
        .unwrap();
    let (st, v) = k.s.post("/api/treasury/move", json!({ "to_address": to })).await;
    assert_eq!((st, code(&v)), (409, "runs_in_progress"), "{v}");
    sqlx::query("UPDATE runs SET status = 'cancelled' WHERE id = ?")
        .bind(&run_id)
        .execute(&k.pool)
        .await
        .unwrap();
    let (st, v) = k.s.post("/api/treasury/move", json!({ "to_address": to })).await;
    assert_eq!(st, 200, "{v}");
    assert_eq!(v["txid"], json!(keys::SWEEP_TXID));
    assert_eq!(v["to_address"], json!(to));
    assert_eq!(v["amount_zat"], json!(2_500_000 - keys::FEE));
    assert_eq!(v["fee_zat"], json!(keys::FEE));
    assert!(v["explorer_url"].as_str().unwrap().contains(keys::SWEEP_TXID));
    assert_eq!(k.fake.state().sweeps, vec![(to, 2_500_000 - keys::FEE)]);
}

/// With PAYSLIP_SEED_PASSPHRASE set nothing changes: the seed is decrypted at start, the state
/// is `unlocked_by_env`, the key endpoints that would change that answer `unlocked_by_env`, and
/// a wrong passphrase still refuses to start. A key uploaded in this mode must use the same
/// passphrase, or the next start could not open it.
#[tokio::test]
async fn the_env_passphrase_mode_is_unchanged() {
    let k = keys::start(
        keys::FakeWallet::new(),
        Some((keys::PHRASE, keys::PASS)),
        Some(keys::PASS),
        None,
    )
    .await;
    assert!(k.treasury.can_sign());
    assert!(k.fake.state().seed.is_some(), "the seed was decrypted at start");
    let (st, h) = k.s.get("/api/health").await;
    assert_eq!((st, h["treasury"].as_str()), (200, Some("unlocked_by_env")), "{h}");
    let v = keys::key(&k).await;
    assert_eq!(v["state"], json!("unlocked_by_env"));
    assert!(v["unlocked_until"].is_null());
    assert_eq!(v["address"], json!(keys::address_of(keys::PHRASE)));
    assert_eq!(v["key_version"], json!(1));
    let (st, w) = k.s.get("/api/wallet").await;
    assert_eq!(st, 200, "{w}");
    let (st, v) =
        k.s.post(
            "/api/contractors",
            json!({ "name": "Amara", "unified_address": testnet_address(1), "settlement_choice": "hold_zec" }),
        )
        .await;
    assert_eq!(st, 201, "{v}");
    for (path, body) in [
        ("/api/treasury/unlock", json!({ "passphrase": keys::PASS })),
        ("/api/treasury/lock", json!({})),
        (
            "/api/treasury/key/replace",
            json!({ "ciphertext": keys::ciphertext(&keys::new_phrase(), keys::PASS), "passphrase": keys::PASS, "sweep_to": "new" }),
        ),
    ] {
        let (st, v) = k.s.post(path, body).await;
        assert_eq!((st, code(&v)), (409, "unlocked_by_env"), "{path}: {v}");
        assert!(v["error"]["hint"].as_str().unwrap().contains("PAYSLIP_SEED_PASSPHRASE"));
    }
    assert!(k.treasury.can_sign(), "still unlocked");
    // Moving the treasury out works in this mode too: it only needs a signature.
    let (st, v) =
        k.s.post("/api/treasury/move", json!({ "to_address": testnet_address(4) }))
            .await;
    assert_eq!((st, code(&v)), (409, "treasury_empty"), "{v}");

    // A wrong env passphrase refuses to start, as before.
    let dir = tempfile::tempdir().unwrap();
    let mut cfg = config(dir.path(), "127.0.0.1:1".parse().unwrap());
    cfg.statements_only = false;
    cfg.seed_passphrase = Some("not the passphrase".into());
    keys::SeedFile::new(cfg.seed_path())
        .write_ciphertext(&keys::ciphertext(keys::PHRASE, keys::PASS))
        .unwrap();
    let db = db::open(&cfg.app_db_path()).await.unwrap();
    let err = payslip::treasury::Treasury::open(cfg, db, keys::FakeWallet::new())
        .await
        .err()
        .expect("a wrong PAYSLIP_SEED_PASSPHRASE refuses to start");
    assert!(format!("{err:#}").contains("passphrase"), "{err:#}");

    // No seed file and an env passphrase: the upload must use that passphrase.
    let k3 = keys::start(keys::FakeWallet::new(), None, Some(keys::PASS), None).await;
    assert_eq!(keys::key(&k3).await["state"], json!("no_key"));
    let (st, v) = k3
        .s
        .post(
            "/api/treasury/key",
            json!({ "ciphertext": keys::ciphertext(keys::PHRASE, "another passphrase"), "passphrase": "another passphrase" }),
        )
        .await;
    assert_eq!((st, code(&v)), (409, "passphrase_mismatch"), "{v}");
    let (st, v) =
        k3.s.post(
            "/api/treasury/key",
            json!({ "ciphertext": keys::ciphertext(keys::PHRASE, keys::PASS), "passphrase": keys::PASS }),
        )
        .await;
    assert_eq!((st, v["state"].as_str()), (201, Some("unlocked_by_env")), "{v}");
}

/// With sign-in on: the key's state is read by every member, every change is for admins only,
/// and each change leaves an audit row that never carries the passphrase or the file.
#[tokio::test]
async fn treasury_key_changes_are_admin_only_and_audited() {
    use payslip::config::AuthMode;
    let key = Key::new("k1", 1);
    let jwks = signin::jwks_server(&[&key]).await;
    let auth = AuthConfig {
        mode: AuthMode::Required,
        jwks_url: jwks,
        issuer: ISSUER.into(),
        audience: AUDIENCE.into(),
        bootstrap_admin_email: Some("owner@acme.test".into()),
        approvals_required: 1,
        open_membership: None,
    };
    let k = keys::start(
        keys::FakeWallet::with_treasury(keys::PHRASE, 0),
        Some((keys::PHRASE, keys::PASS)),
        None,
        Some(auth),
    )
    .await;
    let s = &k.s;
    let admin = key.token("owner@acme.test", 300, json!({ "name": "Owner" }));
    signin::me(s, &admin).await;
    let approver = key.token("approver@acme.test", 300, json!({}));
    signin::join(s, &admin, "approver@acme.test", "approver", &approver).await;
    let accountant = key.token("accountant@acme.test", 300, json!({}));
    signin::join(s, &admin, "accountant@acme.test", "accountant", &accountant).await;
    let viewer = key.token("viewer@acme.test", 300, json!({}));
    signin::join(s, &admin, "viewer@acme.test", "viewer", &viewer).await;
    for (role, token) in [
        ("approver", &approver),
        ("accountant", &accountant),
        ("viewer", &viewer),
    ] {
        let (st, v) = s.req("GET", "/api/treasury/key", Some(token), None).await;
        assert_eq!((st, v["state"].as_str()), (200, Some("locked")), "{role}: {v}");
        let (st, v) = s
            .req(
                "POST",
                "/api/treasury/unlock",
                Some(token),
                Some(json!({ "passphrase": keys::PASS })),
            )
            .await;
        assert_eq!((st, code(&v)), (403, "forbidden"), "{role}: {v}");
        assert!(v["error"]["message"].as_str().unwrap().contains(role));
        assert!(!k.treasury.can_sign(), "{role} must not unlock");
    }
    let (st, v) = s
        .req(
            "POST",
            "/api/treasury/unlock",
            Some(&admin),
            Some(json!({ "passphrase": keys::PASS, "hours": 2 })),
        )
        .await;
    assert_eq!((st, v["state"].as_str()), (200, Some("unlocked")), "{v}");
    let (st, v) = s.req("POST", "/api/treasury/lock", Some(&admin), Some(json!({}))).await;
    assert_eq!((st, v["state"].as_str()), (200, Some("locked")), "{v}");
    let (st, v) = s.req("GET", "/api/org/audit", Some(&admin), None).await;
    assert_eq!(st, 200, "{v}");
    let entries = v["entries"].as_array().unwrap();
    let find = |action: &str| {
        entries
            .iter()
            .find(|e| e["action"] == json!(action))
            .cloned()
            .unwrap_or_else(|| panic!("no {action} row in {v}"))
    };
    let unlock = find("treasury.unlock");
    assert_eq!(unlock["role"], json!("admin"));
    assert_eq!(unlock["target"], json!("treasury"));
    assert_eq!(unlock["details"]["hours"], json!(2));
    assert_eq!(unlock["details"]["state"], json!("unlocked"));
    assert!(unlock["details"]["unlocked_until"].is_string(), "{unlock}");
    assert!(
        !unlock.to_string().contains(keys::PASS),
        "no passphrase on the audit log"
    );
    let lock = find("treasury.lock");
    assert_eq!(lock["details"]["state"], json!("locked"));
    let (st, v) = s.req("GET", "/api/org/audit", Some(&accountant), None).await;
    assert_eq!(st, 200, "{v}");
    // A refused unlock by an approver left no row.
    assert_eq!(
        entries
            .iter()
            .filter(|e| e["action"] == json!("treasury.unlock"))
            .count(),
        1
    );
}

/// Open membership (PAYSLIP_OPEN_MEMBERSHIP=viewer, for a public demo): once the organisation
/// exists, a signed-in person with a verified email becomes a viewer on first sight, reads and
/// cannot write, and the join is on the audit log once; an unverified sign-in stays outside, the
/// bootstrap admin rule is unchanged, and health says which role is handed out.
#[tokio::test]
async fn open_membership_makes_every_verified_sign_in_a_viewer_who_reads_and_cannot_write() {
    use payslip::auth::Role;
    let key = Key::new("k1", 1);
    let jwks = signin::jwks_server(&[&key]).await;
    let (s, pool) = signin::start_open(&jwks, Some("owner@acme.test"), Role::Viewer).await;
    let (st, h) = s.req("GET", "/api/health", None, None).await;
    assert_eq!((st, h["open_membership"].as_str()), (200, Some("viewer")), "{h}");
    // Before the organisation exists there is nothing to join.
    let early = key.token("amara@acme.test", 300, json!({}));
    assert!(signin::me(&s, &early).await["membership"].is_null());
    // The bootstrap email is still the admin, not a viewer.
    let owner = key.token("owner@acme.test", 300, json!({ "name": "Owner" }));
    assert_eq!(signin::me(&s, &owner).await["membership"]["role"], json!("admin"));
    // Now a verified newcomer joins as a viewer on their first request.
    let amara = key.token("amara@acme.test", 300, json!({ "name": "Amara" }));
    let v = signin::me(&s, &amara).await;
    assert_eq!(v["membership"]["role"], json!("viewer"), "{v}");
    assert_eq!(v["membership"]["org"]["name"], json!("acme.test"));
    // Reads work.
    for path in ["/api/contractors", "/api/runs", "/api/org", "/api/org/members"] {
        let (st, v) = s.req("GET", path, Some(&amara), None).await;
        assert_eq!(st, 200, "{path}: {v}");
    }
    // Writes, viewing keys and the audit log do not.
    for (method, path, body) in [
        ("POST", "/api/contractors", json!({ "name": "X", "address": "utest1x" })),
        ("POST", "/api/runs", json!({})),
        ("POST", "/api/wallet/sync", json!({})),
        ("GET", "/api/viewing-keys", Value::Null),
        ("GET", "/api/org/audit", Value::Null),
        (
            "POST",
            "/api/org/invitations",
            json!({ "email": "x@acme.test", "role": "viewer" }),
        ),
        ("PATCH", "/api/org", json!({ "name": "Taken over" })),
    ] {
        let (st, v) = s.req(method, path, Some(&amara), Some(body)).await;
        assert_eq!((st, code(&v)), (403, "forbidden"), "{method} {path}: {v}");
        assert!(v["error"]["message"].as_str().unwrap().contains("viewer"), "{v}");
    }
    // An unverified sign-in is not a member.
    let unverified = key.token("bob@acme.test", 300, json!({ "email_verified": false }));
    assert!(signin::me(&s, &unverified).await["membership"].is_null());
    let (st, v) = s.req("GET", "/api/contractors", Some(&unverified), None).await;
    assert_eq!((st, code(&v)), (403, "forbidden"), "{v}");
    // A first sight is often several requests at once: one membership, one audit row.
    let carol = key.token("carol@acme.test", 300, json!({}));
    let (a, b, c) = tokio::join!(
        s.req("GET", "/api/me", Some(&carol), None),
        s.req("GET", "/api/contractors", Some(&carol), None),
        s.req("GET", "/api/runs", Some(&carol), None)
    );
    assert_eq!((a.0, b.0, c.0), (200, 200, 200), "{} {} {}", a.1, b.1, c.1);
    let members: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM memberships")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(members, 3, "owner, amara and carol");
    let (st, v) = s.req("GET", "/api/org/audit", Some(&owner), None).await;
    assert_eq!(st, 200, "{v}");
    let joins: Vec<&Value> = v["entries"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["action"] == json!("member.auto_join"))
        .collect();
    assert_eq!(joins.len(), 2, "{v}");
    let row = joins
        .iter()
        .find(|e| e["user"]["email"] == json!("amara@acme.test"))
        .unwrap();
    assert_eq!(row["role"], json!("viewer"));
    assert_eq!(row["target"], json!("user-amara"));
    assert_eq!(row["details"], json!({ "email": "amara@acme.test", "role": "viewer" }));
    assert!(joins.iter().any(|e| e["user"]["email"] == json!("carol@acme.test")));
    // The owner is still the only admin, and an admin can still change a joined member's role.
    let admins: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM memberships WHERE role = 'admin'")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(admins, 1);
    let (st, v) = s
        .req(
            "POST",
            "/api/org/members",
            Some(&owner),
            Some(json!({ "user_id": "user-amara", "role": "approver" })),
        )
        .await;
    assert_eq!((st, v["role"].as_str()), (200, Some("approver")), "{v}");
    assert_eq!(signin::me(&s, &amara).await["membership"]["role"], json!("approver"));

    // The other allowed role: an accountant, who may also read keys and the audit log, and still
    // cannot run payroll.
    let (s2, _pool2) = signin::start_open(&jwks, Some("owner@acme.test"), Role::Accountant).await;
    let (_, h) = s2.req("GET", "/api/health", None, None).await;
    assert_eq!(h["open_membership"], json!("accountant"));
    assert_eq!(signin::me(&s2, &owner).await["membership"]["role"], json!("admin"));
    let v = signin::me(&s2, &amara).await;
    assert_eq!(v["membership"]["role"], json!("accountant"), "{v}");
    let (st, v) = s2.req("GET", "/api/org/audit", Some(&amara), None).await;
    assert_eq!(st, 200, "{v}");
    let (st, v) = s2.req("POST", "/api/runs", Some(&amara), Some(json!({}))).await;
    assert_eq!((st, code(&v)), (403, "forbidden"), "{v}");
}

/// Without PAYSLIP_OPEN_MEMBERSHIP (the default) nothing changes: a verified newcomer is signed
/// in but outside however often they ask, no join is recorded, an invitation is still the way in,
/// and health reports no open role.
#[tokio::test]
async fn without_open_membership_a_newcomer_stays_outside_until_invited() {
    let key = Key::new("k1", 1);
    let jwks = signin::jwks_server(&[&key]).await;
    let (s, pool) = signin::start(&jwks, Some("owner@acme.test")).await;
    let (st, h) = s.req("GET", "/api/health", None, None).await;
    assert_eq!(st, 200, "{h}");
    assert!(h["open_membership"].is_null(), "{h}");
    let owner = key.token("owner@acme.test", 300, json!({}));
    assert_eq!(signin::me(&s, &owner).await["membership"]["role"], json!("admin"));
    let amara = key.token("amara@acme.test", 300, json!({ "name": "Amara" }));
    for _ in 0..2 {
        assert!(signin::me(&s, &amara).await["membership"].is_null());
    }
    let (st, v) = s.req("GET", "/api/contractors", Some(&amara), None).await;
    assert_eq!((st, code(&v)), (403, "forbidden"), "{v}");
    assert!(v["error"]["hint"].as_str().unwrap().contains("invitation"), "{v}");
    let joins: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM audit_log WHERE action = 'member.auto_join'")
        .fetch_one(&pool)
        .await
        .unwrap();
    let members: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM memberships")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!((joins, members), (0, 1));
    assert_eq!(
        signin::join(&s, &owner, "amara@acme.test", "viewer", &amara).await,
        "viewer"
    );
}

/// PAYSLIP_OPEN_MEMBERSHIP takes viewer or accountant, or nothing. Admin and approver are refused
/// at start (an open demo must not hand out payroll or organisation powers), so is any other
/// word, and so is a role with sign-in off, each with the fix in the message.
#[test]
fn open_membership_accepts_viewer_or_accountant_and_refuses_the_rest() {
    use payslip::{
        auth::Role,
        config::{parse_open_membership, AuthMode},
    };
    assert_eq!(parse_open_membership(None, AuthMode::Required).unwrap(), None);
    assert_eq!(parse_open_membership(Some("  "), AuthMode::Off).unwrap(), None);
    assert_eq!(
        parse_open_membership(Some("viewer"), AuthMode::Required).unwrap(),
        Some(Role::Viewer)
    );
    assert_eq!(
        parse_open_membership(Some(" Accountant "), AuthMode::Required).unwrap(),
        Some(Role::Accountant)
    );
    for bad in ["admin", "approver", "owner", "yes", "1"] {
        let e = parse_open_membership(Some(bad), AuthMode::Required)
            .unwrap_err()
            .to_string();
        assert!(
            e.contains("PAYSLIP_OPEN_MEMBERSHIP") && e.contains("viewer or accountant"),
            "{bad}: {e}"
        );
    }
    let e = parse_open_membership(Some("viewer"), AuthMode::Off)
        .unwrap_err()
        .to_string();
    assert!(e.contains("PAYSLIP_AUTH=required"), "{e}");
}
