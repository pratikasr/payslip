//! HTTP API behaviour that needs no chain: a statements-only service whose lightwalletd is
//! unreachable, driven over a real socket. Every answer here must come before any scan.

use std::{net::SocketAddr, path::Path};

use payslip::{
    api,
    config::{Config, VenueKind, ZcashNetwork},
    viewer::{ViewerRegistry, ViewingKey},
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
