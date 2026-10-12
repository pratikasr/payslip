//! HTTP API (docs/API.md).

mod contractors;
mod org;
mod proofs;
pub mod requests;
mod runs;
pub mod schedule;
mod statements;
mod treasury;

use std::{sync::Arc, time::Duration};

use anyhow::{bail, Context};
use axum::{
    extract::{Request, State},
    http::{header, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use tower_http::{cors::CorsLayer, trace::TraceLayer};

use crate::{
    config::Config,
    db::{self, Pool},
    error::{ApiError, ApiResult},
    payer::{Payer, WalletInfo},
    runs::Executor,
    treasury::Treasury,
    venue::{self, SwapVenue},
    viewer::ViewerRegistry,
};

pub struct AppState {
    pub cfg: Config,
    pub db: Pool,
    /// The treasury key and the wallet behind it (ADR-030). None in statements-only mode.
    pub treasury: Option<Arc<Treasury>>,
    pub viewers: ViewerRegistry,
    pub venue: Arc<dyn SwapVenue>,
    /// None in statements-only mode.
    pub executor: Option<Executor>,
    pub contractor_lock: tokio::sync::Mutex<()>,
    /// A lightwalletd connection of its own, so health never waits behind a wallet sync.
    pub lwd: tokio::sync::Mutex<crate::wallet::lwd::Client>,
    /// The last wallet snapshot, served by health while the wallet thread is busy syncing.
    pub last_wallet: std::sync::Mutex<Option<WalletInfo>>,
    /// ZEC market prices for the value of a payment at receipt, and the rate a run funded with
    /// ZEC is recorded at (shared with the executor).
    pub prices: Arc<crate::prices::Prices>,
    /// Chain scans are the expensive requests; at most this many run at once.
    pub scan_slots: tokio::sync::Semaphore,
    /// Open run progress streams (SSE); each holds a connection until the client leaves.
    pub sse_slots: Arc<tokio::sync::Semaphore>,
    /// Held by every pay schedule pass (the hourly task, `PUT /api/schedule`), so one period is
    /// never drafted twice.
    pub schedule_lock: tokio::sync::Mutex<()>,
    /// Checks sign-in tokens (ADR-026); None when PAYSLIP_AUTH=off.
    pub auth: Option<Arc<crate::auth::Verifier>>,
}

pub type AppStateRef = Arc<AppState>;

/// Concurrent statement and reconciliation scans; further requests wait their turn.
const MAX_CONCURRENT_SCANS: usize = 3;

/// Run progress streams open at once. A browser tab holds one per open run page.
pub const MAX_EVENT_STREAMS: usize = 32;

/// A slot for one progress stream, held until the stream is dropped; 503 when all are taken.
pub fn stream_slot(slots: &Arc<tokio::sync::Semaphore>) -> ApiResult<tokio::sync::OwnedSemaphorePermit> {
    slots.clone().try_acquire_owned().map_err(|_| {
        ApiError::unavailable(
            "too_many_streams",
            format!("{MAX_EVENT_STREAMS} run progress streams are already open on this service."),
            "Close run pages you are not watching, or poll GET /api/runs/{id} instead.",
        )
    })
}

/// Owner-only permissions on the data folder and its viewer caches (Unix); a failure is logged.
fn restrict_permissions(dir: &std::path::Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for d in [dir.to_path_buf(), dir.join("viewers")] {
            if d.exists() {
                if let Err(e) = std::fs::set_permissions(&d, std::fs::Permissions::from_mode(0o700)) {
                    tracing::warn!("could not restrict {}: {e}", d.display());
                }
            }
        }
    }
}

fn statements_only_error() -> ApiError {
    ApiError::new(
        axum::http::StatusCode::NOT_FOUND,
        "statements_only",
        "This Payslip deployment serves statements and payment proofs only; it holds no wallet.",
        "To pay contractors, run your own Payslip service: see the Quick start in the README.",
    )
}

impl AppState {
    /// The treasury key manager; 404 `statements_only` without a wallet.
    pub fn treasury(&self) -> ApiResult<&Arc<Treasury>> {
        self.treasury.as_ref().ok_or_else(statements_only_error)
    }

    /// The payer wallet: 404 `statements_only` without one, 409 `no_treasury_key` before a key
    /// exists. A locked wallet still answers every read.
    pub fn payer(&self) -> ApiResult<Payer> {
        self.treasury()?.payer()
    }

    /// The payer wallet when there is one, for endpoints that work without it.
    pub fn payer_opt(&self) -> Option<Payer> {
        self.treasury.as_ref().and_then(|t| t.payer_opt())
    }

    pub fn executor(&self) -> ApiResult<&Executor> {
        self.executor.as_ref().ok_or_else(statements_only_error)
    }
}

/// Builds the state: opens databases, opens the payer wallet (unlocked by the environment,
/// locked, or absent: ADR-030), refuses to mix networks.
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
    let venue = venue::build(&cfg)?;
    let prices = Arc::new(crate::prices::Prices::new(
        cfg.price_api_url.clone(),
        cfg.price_api_key.clone(),
    ));
    let (treasury, executor) = if cfg.statements_only {
        (None, None)
    } else {
        let backend = Arc::new(crate::treasury::PayerBackend::new(cfg.clone()));
        let treasury = Treasury::open(cfg.clone(), db.clone(), backend)
            .await
            .context("opening the payer wallet")?;
        let chain: Arc<dyn crate::runs::ChainOps> = treasury.clone();
        let executor = Executor::new(cfg.clone(), db.clone(), chain, venue.clone(), prices.clone());
        (Some(treasury), Some(executor))
    };
    let lightwalletd_url = cfg.lightwalletd_url.clone();
    let auth = cfg
        .auth
        .required()
        .then(|| Arc::new(crate::auth::Verifier::new(&cfg.auth)));
    Ok(Arc::new(AppState {
        auth,
        prices,
        scan_slots: tokio::sync::Semaphore::new(MAX_CONCURRENT_SCANS),
        sse_slots: Arc::new(tokio::sync::Semaphore::new(MAX_EVENT_STREAMS)),
        viewers: ViewerRegistry::new(&cfg),
        cfg,
        db,
        treasury,
        venue,
        executor,
        contractor_lock: tokio::sync::Mutex::new(()),
        schedule_lock: tokio::sync::Mutex::new(()),
        lwd: tokio::sync::Mutex::new(crate::wallet::lwd::connect(&lightwalletd_url)?),
        last_wallet: std::sync::Mutex::new(None),
    }))
}

pub fn router(state: AppStateRef) -> Router {
    let origins: Vec<HeaderValue> = state
        .cfg
        .web_origin
        .split(',')
        .filter_map(|o| o.trim().parse::<HeaderValue>().ok())
        .collect();
    let cors = CorsLayer::new()
        .allow_origin(origins)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE])
        .allow_headers([axum::http::header::CONTENT_TYPE])
        // Lets the web app name downloaded files the way the service does (per export format).
        .expose_headers([axum::http::header::CONTENT_DISPOSITION]);
    let hosts = Arc::new(allowed_hosts(&state.cfg));
    let statements_only = state.cfg.statements_only;
    let mut app = Router::new().route("/api/health", get(health));
    // A statements-only deployment is meant to be public: it does not even mount the payer routes.
    if !statements_only {
        let mut payer = Router::new()
            .route("/api/wallet", get(wallet))
            .route("/api/wallet/sync", post(wallet_sync))
            .merge(treasury::routes())
            .merge(contractors::routes())
            .merge(runs::routes())
            .merge(requests::routes())
            .merge(schedule::routes());
        // With sign-in required, every payer route (the request queue and the schedule included)
        // and the organisation routes sit behind the guard: token, membership, role, audit row.
        // Statements, proofs and the portal's request endpoints stay key-based.
        if state.auth.is_some() {
            payer = payer
                .merge(org::routes())
                .layer(middleware::from_fn_with_state(state.clone(), crate::auth::guard));
        }
        app = app.merge(payer);
    }
    // A contractor can send a payment request to any Payslip that knows their key.
    app.merge(statements::routes())
        .merge(requests::portal_routes())
        .merge(proofs::routes())
        .fallback(move |req: Request| async move { not_found(statements_only, req.uri().path()) })
        .layer(middleware::from_fn(json_errors))
        .layer(middleware::from_fn(require_json))
        .layer(cors)
        .layer(middleware::from_fn_with_state(hosts, check_host))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

/// Host header values this service answers for: its bind address, localhost and 127.0.0.1 on
/// the bind port, plus PAYSLIP_ALLOWED_HOSTS. Anything else is a DNS-rebinding attempt or a
/// misconfigured proxy.
pub fn allowed_hosts(cfg: &Config) -> Vec<String> {
    let port = cfg.bind.port();
    let mut hosts = vec![
        format!("127.0.0.1:{port}"),
        format!("localhost:{port}"),
        format!("[::1]:{port}"),
    ];
    if !cfg.bind.ip().is_unspecified() {
        hosts.push(cfg.bind.to_string());
    }
    hosts.extend(cfg.allowed_hosts.iter().cloned());
    hosts
}

async fn check_host(State(hosts): State<Arc<Vec<String>>>, req: Request, next: Next) -> Response {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|h| h.to_str().ok())
        .map(|h| h.to_ascii_lowercase());
    match host {
        Some(h) if hosts.contains(&h) => next.run(req).await,
        _ => ApiError::new(
            StatusCode::MISDIRECTED_REQUEST,
            "host_not_allowed",
            "This Payslip service does not answer for that host name.",
            "Use the address the service listens on, or add the host name to PAYSLIP_ALLOWED_HOSTS.",
        )
        .into_response(),
    }
}

/// Every request that changes data must be JSON. A form or text/plain POST from another site is
/// a "simple" request that skips the browser's CORS preflight; requiring JSON forces it.
async fn require_json(req: Request, next: Next) -> Response {
    let writes = matches!(
        *req.method(),
        Method::POST | Method::PATCH | Method::PUT | Method::DELETE
    );
    let json = req
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.trim().to_ascii_lowercase().starts_with("application/json"));
    if writes && !json {
        return ApiError::new(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "json_required",
            "This request must be sent as JSON.",
            "Send the header Content-Type: application/json, with a JSON body or none.",
        )
        .into_response();
    }
    next.run(req).await
}

/// Every error leaves the service as `{"error": {code, message, hint}}`. Handlers answer that way
/// already; this converts the framework's own plain-text rejections: malformed JSON (400), a
/// field of the wrong type or missing (422), a body over the 2 MB limit (413), a method the
/// route does not have (405, empty body), a bad query string or path.
async fn json_errors(req: Request, next: Next) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();
    let res = next.run(req).await;
    let status = res.status();
    let is_json = res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("application/json"));
    if !(status.is_client_error() || status.is_server_error()) || is_json {
        return res;
    }
    let (parts, body) = res.into_parts();
    let text = axum::body::to_bytes(body, 4096)
        .await
        .map(|b| String::from_utf8_lossy(&b).trim().to_string())
        .unwrap_or_default();
    let detail = if text.is_empty() {
        status.canonical_reason().unwrap_or("Request refused").to_string()
    } else {
        text.clone()
    };
    let (code, message, hint): (&str, String, String) = match status {
        StatusCode::METHOD_NOT_ALLOWED => (
            "method_not_allowed",
            format!("{method} is not supported on {path}."),
            "Use one of the methods in the Allow header; docs/API.md lists every endpoint.".into(),
        ),
        StatusCode::PAYLOAD_TOO_LARGE => (
            "body_too_large",
            "The request body is over the 2 MB limit.".into(),
            "Send a smaller request: split long viewing key lists into several requests.".into(),
        ),
        StatusCode::UNSUPPORTED_MEDIA_TYPE => (
            "json_required",
            detail,
            "Send the header Content-Type: application/json with a JSON body.".into(),
        ),
        StatusCode::UNPROCESSABLE_ENTITY => (
            "invalid_body",
            detail,
            "A field is missing or has the wrong type; check the request against docs/API.md.".into(),
        ),
        StatusCode::BAD_REQUEST if text.contains("request body as JSON") => (
            "invalid_json",
            detail,
            "Send a well-formed JSON object; docs/API.md shows each body.".into(),
        ),
        StatusCode::BAD_REQUEST if text.contains("query string") => (
            "invalid_query",
            detail,
            "Check the query parameters against docs/API.md.".into(),
        ),
        StatusCode::NOT_FOUND => (
            "not_found",
            format!("There is no {path} on this service."),
            "Check the address; docs/API.md lists every endpoint.".into(),
        ),
        s if s.is_server_error() => (
            "internal_error",
            detail,
            "Check the service log for details, then retry.".into(),
        ),
        _ => (
            "invalid_request",
            detail,
            "Check the request against docs/API.md.".into(),
        ),
    };
    let mut out = ApiError::new(status, code, message, hint).into_response();
    // Keep the headers that say how to fix it (Allow on a 405).
    if let Some(allow) = parts.headers.get(header::ALLOW) {
        out.headers_mut().insert(header::ALLOW, allow.clone());
    }
    out
}

fn not_found(statements_only: bool, path: &str) -> Response {
    let payer_route = [
        "/api/wallet",
        "/api/treasury",
        "/api/contractors",
        "/api/runs",
        "/api/viewing-keys",
        "/api/requests",
        "/api/schedule",
    ]
    .iter()
    .any(|p| path.starts_with(p));
    if statements_only && payer_route {
        return statements_only_error().into_response();
    }
    ApiError::new(
        StatusCode::NOT_FOUND,
        "not_found",
        format!("There is no {path} on this service."),
        "Check the address; docs/API.md lists every endpoint.",
    )
    .into_response()
}

pub async fn serve(cfg: Config) -> anyhow::Result<()> {
    let bind = cfg.bind;
    if !cfg.statements_only && !bind.ip().is_loopback() && !cfg.allow_remote_payer && !cfg.auth.required() {
        bail!(
            "PAYSLIP_BIND={bind} would expose the payer wallet to the network, and the API has no login. \
             Bind full mode to 127.0.0.1 (or run PAYSLIP_MODE=statements for a public host). Set \
             PAYSLIP_AUTH=required to put sign-in in front of it, or PAYSLIP_ALLOW_REMOTE_PAYER=1 \
             only behind your own authentication."
        );
    }
    if cfg.auth.required() && cfg.auth.bootstrap_admin_email.is_none() {
        tracing::warn!(
            "PAYSLIP_AUTH=required without PAYSLIP_BOOTSTRAP_ADMIN_EMAIL: nobody can become the first admin until it is set"
        );
    }
    // The data folder holds the wallet databases and the scan caches of every viewing key
    // submitted: readable by this user only.
    restrict_permissions(&cfg.data_dir);
    let state = build_state(cfg).await?;
    // Keep the payer wallet near the tip so funding and balances are current. The wallet is
    // read each time: a key created or replaced meanwhile is picked up on the next pass.
    if let Some(treasury) = state.treasury.clone() {
        let bg = state.clone();
        tokio::spawn(async move {
            loop {
                if let Some(payer) = treasury.payer_opt() {
                    if let Err(e) = payer.sync().await {
                        tracing::warn!("background sync failed: {e:#}");
                    }
                    if let Ok(Some(info)) = payer.wallet_info_opt().await {
                        if let Ok(mut last) = bg.last_wallet.lock() {
                            *last = Some(info);
                        }
                    }
                }
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
        });
    }
    if let Some(executor) = &state.executor {
        executor.resume_all().await;
        // Pay lines confirmed before block times were recorded get theirs, in the background.
        let executor = executor.clone();
        tokio::spawn(async move {
            match executor.backfill_confirmed_at(None).await {
                Ok(0) => {}
                Ok(n) => tracing::info!("recorded the block time of {n} confirmed pay lines"),
                Err(e) => tracing::warn!("could not record pay line block times: {e:#}"),
            }
        });
        // The pay schedule drafts the next payroll: once now, then hourly. Never in statements
        // mode, which has no payer routes.
        schedule::spawn_hourly(state.clone());
    }
    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .with_context(|| format!("binding {bind}"))?;
    tracing::info!(
        "Payslip service on http://{bind} ({}, {}, sign-in {}, treasury {})",
        state.cfg.network.as_str(),
        if state.cfg.statements_only {
            "statements only".to_string()
        } else {
            format!("venue {}", state.venue.kind().as_str())
        },
        state.cfg.auth.mode.as_str(),
        state.treasury.as_ref().map(|t| t.state().as_str()).unwrap_or("none")
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
    /// full, or statements (no wallet; statements and payment proofs only)
    mode: &'static str,
    /// Payslip's fee on the funding swap in basis points, 0 when none (NEAR Intents only).
    app_fee_bps: u32,
    /// Whether statements carry the market value of each payment at receipt.
    market_prices: bool,
    /// The testnet venue's fixed rate in USD per ZEC, which runs are funded at; None on
    /// mainnet and whenever that venue is not in use.
    simulated_rate_usd_per_zec: Option<f64>,
    /// off, or required: payer routes need a signed-in member (ADR-026).
    auth: &'static str,
    /// Whether `POST /api/runs/{id}/fund` accepts `method: "zec"` (ADR-025): true in full mode.
    fund_with_zec: bool,
    /// PAYSLIP_MAX_RUN_USD_CENTS, the largest payroll one run may carry; None when no cap.
    max_run_usd_cents: Option<u64>,
    /// PAYSLIP_APPROVALS_REQUIRED: approvals a run needs before it is paid; 0 when none.
    approvals_required: u32,
    /// The treasury key (ADR-030): unlocked_by_env, unlocked, locked, no_key; none in
    /// statements mode.
    treasury: &'static str,
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
    // The wallet thread may be busy with a long sync; answer from the last snapshot rather than
    // keep the caller waiting.
    let (info, syncing) = match s.payer_opt() {
        None => (None, false),
        Some(payer) => match tokio::time::timeout(Duration::from_secs(3), payer.wallet_info_opt()).await {
            Ok(Ok(Some(info))) => {
                if let Ok(mut last) = s.last_wallet.lock() {
                    *last = Some(info.clone());
                }
                (Some(info), false)
            }
            // Locked and never unlocked: no treasury account yet, so no figures.
            Ok(Ok(None)) => (None, false),
            Ok(Err(e)) => return Err(e.into()),
            Err(_) => (s.last_wallet.lock().ok().and_then(|l| l.clone()), true),
        },
    };
    let tip = tokio::time::timeout(Duration::from_secs(10), async {
        let mut client = s.lwd.lock().await;
        crate::wallet::lwd::tip_time(&mut client).await
    })
    .await;
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
        status: if err.is_some() || !warnings.is_empty() {
            "degraded"
        } else if syncing {
            "syncing"
        } else {
            "ok"
        },
        network: s.cfg.network.as_str(),
        lightwalletd: s.cfg.lightwalletd_url.clone(),
        chain_tip,
        wallet_synced_height: info.as_ref().map(|i| i.synced_height).unwrap_or(0),
        birthday_height: info
            .as_ref()
            .map(|i| i.birthday_height)
            .unwrap_or_else(|| s.cfg.viewer_birthday()),
        venue: if s.cfg.statements_only {
            "none"
        } else {
            s.venue.kind().as_str()
        },
        mode: if s.cfg.statements_only { "statements" } else { "full" },
        app_fee_bps: if s.cfg.venue == crate::config::VenueKind::NearIntents && s.cfg.app_fee_recipient.is_some() {
            s.cfg.app_fee_bps
        } else {
            0
        },
        market_prices: s.prices.enabled(),
        simulated_rate_usd_per_zec: s.cfg.simulated_rate_usd_per_zec(),
        auth: s.cfg.auth.mode.as_str(),
        fund_with_zec: s.cfg.fund_with_zec(),
        max_run_usd_cents: s.cfg.max_run_usd_cents,
        approvals_required: s.cfg.auth.approvals_required,
        treasury: s.treasury.as_ref().map(|t| t.state().as_str()).unwrap_or("none"),
        version: env!("CARGO_PKG_VERSION"),
        lightwalletd_error: err,
        clock_skew_seconds: skew,
        warnings,
    }))
}

async fn wallet(State(s): State<AppStateRef>) -> ApiResult<Json<WalletInfo>> {
    Ok(Json(s.treasury()?.wallet_info().await?))
}

async fn wallet_sync(State(s): State<AppStateRef>) -> ApiResult<Json<WalletInfo>> {
    s.treasury()?.sync().await?;
    Ok(Json(s.treasury()?.wallet_info().await?))
}

#[cfg(test)]
mod tests {
    use super::{clock_warning, stream_slot, MAX_EVENT_STREAMS};
    use std::sync::Arc;

    /// Audit SEC-06: run progress streams are capped; closing one frees its slot.
    #[test]
    fn event_streams_are_capped() {
        let slots = Arc::new(tokio::sync::Semaphore::new(MAX_EVENT_STREAMS));
        let held: Vec<_> = (0..MAX_EVENT_STREAMS).map(|_| stream_slot(&slots).unwrap()).collect();
        let err = stream_slot(&slots).unwrap_err();
        assert_eq!(err.status, axum::http::StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(err.body.code, "too_many_streams");
        assert!(!err.body.hint.is_empty());
        drop(held);
        assert!(stream_slot(&slots).is_ok());
    }

    #[test]
    fn clock_skew_is_flagged_only_beyond_normal_block_lag() {
        assert!(clock_warning(300).is_none());
        assert!(clock_warning(-600).is_none());
        assert!(clock_warning(3_600).unwrap().contains("60 minutes ahead"));
        assert!(clock_warning(-7_200).unwrap().contains("120 minutes behind"));
    }
}
