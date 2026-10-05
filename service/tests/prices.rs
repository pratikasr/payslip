//! The price cache against a local stand-in for CoinGecko's market chart API (no network).

use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc,
};

use axum::{routing::get, Router};
use payslip::prices::Prices;

/// Audit SL-20: the same statement (a payment five minutes ago) requested twice a second apart
/// costs one upstream request, not one per request.
#[tokio::test]
async fn recent_statement_prices_are_cached() {
    // Stay clear of a five-minute boundary between the two requests.
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    if now.rem_euclid(300) > 290 {
        tokio::time::sleep(std::time::Duration::from_secs(12)).await;
    }
    let hits = Arc::new(AtomicU32::new(0));
    let h = hits.clone();
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let body = format!(
        r#"{{"prices": [[{}, 1300.0], [{}, 1301.0], [{}, 1302.0]]}}"#,
        (now - 600) * 1000,
        (now - 300) * 1000,
        now * 1000
    );
    let app = Router::new().route(
        "/coins/zcash/market_chart/range",
        get(move || {
            h.fetch_add(1, Ordering::SeqCst);
            let b = body.clone();
            async move { ([("content-type", "application/json")], b) }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let prices = Prices::new(Some(format!("http://{addr}")), None);
    let payment = [(now - 300, 355_556u64)];
    let a = prices.values("usd", &payment).await.unwrap();
    tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
    let b = prices.values("usd", &payment).await.unwrap();
    assert!(a[0].is_some(), "the payment is priced");
    assert_eq!(a, b);
    assert_eq!(
        hits.load(Ordering::SeqCst),
        1,
        "the second request a second later was served from the cache"
    );
}
