//! HTTP API (docs/API.md).

mod contractors;
mod runs;
mod statements;

use std::{sync::Arc, time::Duration};

use anyhow::{bail, Context};
use axum::{
    extract::State,
    http::{HeaderValue, Method},
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use crate::{
    config::Config,
    db::{self, Pool},
    error::ApiResult,
    payer::{Payer, WalletInfo},
    runs::Executor,
    venue::{self, SwapVenue},
    viewer::ViewerRegistry,
};

pub struct AppState {
    pub cfg: Config,
    pub db: Pool,
    pub payer: Payer,
    pub viewers: ViewerRegistry,
    pub venue: Arc<dyn SwapVenue>,
    pub executor: Executor,
    pub contractor_lock: tokio::sync::Mutex<()>,
}

pub type AppStateRef = Arc<AppState>;

/// Builds the state: opens databases, unlocks the payer wallet, refuses to mix networks.
pub async fn build_state(cfg: Config) -> anyhow::Result<AppStateRef> {
    let db = db::open(&cfg.app_db_path()).await?;
    match db::setting(&db, "network").await? {
        Some(n) if n != cfg.network.as_str() => {
            bail!(
                "{} holds {n} data but ZCASH_NETWORK={}; use a separate PAYSLIP_DATA_DIR per network",
                cfg.data_dir.display(),
                cfg.network.as_str()
            )
        }
        Some(_) => {}
        None => db::set_setting(&db, "network", cfg.network.as_str()).await?,
    }
    let payer = Payer::open(&cfg).await.context("opening the payer wallet")?;
    let venue = venue::build(&cfg)?;
    let executor = Executor::new(cfg.clone(), db.clone(), payer.clone(), venue.clone());
    Ok(Arc::new(AppState {
        viewers: ViewerRegistry::new(&cfg),
        cfg,
        db,
        payer,
        venue,
        executor,
        contractor_lock: tokio::sync::Mutex::new(()),
    }))
}

pub fn router(state: AppStateRef) -> Router {
    let origin = state
        .cfg
        .web_origin
        .parse::<HeaderValue>()
        .unwrap_or_else(|_| HeaderValue::from_static("http://localhost:3000"));
    let cors = CorsLayer::new()
        .allow_origin(origin)
        .allow_methods([Method::GET, Method::POST, Method::PATCH, Method::DELETE])
        .allow_headers([axum::http::header::CONTENT_TYPE]);
    Router::new()
        .route("/api/health", get(health))
        .route("/api/wallet", get(wallet))
        .route("/api/wallet/sync", post(wallet_sync))
        .merge(contractors::routes())
        .merge(runs::routes())
        .merge(statements::routes())
        .layer(cors)
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

pub async fn serve(cfg: Config) -> anyhow::Result<()> {
    let bind = cfg.bind;
    let state = build_state(cfg).await?;
    // Keep the payer wallet near the tip so funding and balances are current.
    let bg = state.clone();
    tokio::spawn(async move {
        loop {
            if let Err(e) = bg.payer.sync().await {
                tracing::warn!("background sync failed: {e:#}");
            }
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });
    state.executor.resume_all().await;
    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .with_context(|| format!("binding {bind}"))?;
    tracing::info!(
        "Payslip service on http://{bind} ({}, venue {})",
        state.cfg.network.as_str(),
        state.venue.kind().as_str()
    );
    axum::serve(listener, router(state))
        .with_graceful_shutdown(shutdown())
        .await?;
    Ok(())
}

async fn shutdown() {
    let _ = tokio::signal::ctrl_c().await;
}

#[derive(Serialize)]
struct Health {
    status: &'static str,
    network: &'static str,
    lightwalletd: String,
    chain_tip: Option<u32>,
    wallet_synced_height: u32,
    birthday_height: u32,
    venue: &'static str,
    version: &'static str,
    lightwalletd_error: Option<String>,
    /// Server clock minus the tip block's timestamp. Blocks lag real time by up to a few
    /// block intervals, so only a large value means the server clock is wrong.
    clock_skew_seconds: Option<i64>,
    warnings: Vec<String>,
}

/// Skew beyond which the server clock is reported as wrong (block times lag by minutes).
const MAX_CLOCK_SKEW_SECONDS: i64 = 15 * 60;

pub fn clock_warning(skew: i64) -> Option<String> {
    (skew.abs() > MAX_CLOCK_SKEW_SECONDS).then(|| {
        format!(
            "The server clock is {} minutes {} the chain. Statements use block times and are unaffected, but venue deadlines are checked against this clock. Sync the server clock with NTP.",
            skew.abs() / 60,
            if skew > 0 { "ahead of" } else { "behind" }
        )
    })
}

async fn health(State(s): State<AppStateRef>) -> ApiResult<Json<Health>> {
    let info = s.payer.wallet_info().await?;
    let tip = tokio::time::timeout(Duration::from_secs(10), s.payer.tip_time()).await;
    let (chain_tip, skew, err) = match tip {
        Ok(Ok((t, time))) => (
            Some(t),
            Some(time::OffsetDateTime::now_utc().unix_timestamp() - time),
            None,
        ),
        Ok(Err(e)) => (None, None, Some(format!("{e:#}"))),
        Err(_) => (None, None, Some("lightwalletd did not answer within 10 seconds".into())),
    };
    let warnings: Vec<String> = skew.and_then(clock_warning).into_iter().collect();
    Ok(Json(Health {
        status: if err.is_none() && warnings.is_empty() {
            "ok"
        } else {
            "degraded"
        },
        network: s.cfg.network.as_str(),
        lightwalletd: s.cfg.lightwalletd_url.clone(),
        chain_tip,
        wallet_synced_height: info.synced_height,
        birthday_height: info.birthday_height,
        venue: s.venue.kind().as_str(),
        version: env!("CARGO_PKG_VERSION"),
        lightwalletd_error: err,
        clock_skew_seconds: skew,
        warnings,
    }))
}

async fn wallet(State(s): State<AppStateRef>) -> ApiResult<Json<WalletInfo>> {
    Ok(Json(s.payer.wallet_info().await?))
}

async fn wallet_sync(State(s): State<AppStateRef>) -> ApiResult<Json<WalletInfo>> {
    s.payer.sync().await?;
    Ok(Json(s.payer.wallet_info().await?))
}

#[cfg(test)]
mod tests {
    use super::clock_warning;

    #[test]
    fn clock_skew_is_flagged_only_beyond_normal_block_lag() {
        assert!(clock_warning(300).is_none());
        assert!(clock_warning(-600).is_none());
        assert!(clock_warning(3_600).unwrap().contains("60 minutes ahead"));
        assert!(clock_warning(-7_200).unwrap().contains("120 minutes behind"));
    }
}
