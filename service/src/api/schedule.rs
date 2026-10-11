//! The pay schedule: read it, set it, and the hourly task that drafts from it.

use std::time::Duration;

use axum::{extract::State, routing::get, Json, Router};
use serde::Deserialize;
use serde_json::{json, Value};

use super::AppStateRef;
use crate::{
    error::ApiResult,
    schedule::{self, TickOutcome},
};

pub fn routes() -> Router<AppStateRef> {
    Router::new().route("/api/schedule", get(read).put(save))
}

async fn view(s: &AppStateRef) -> ApiResult<Value> {
    Ok(match schedule::get(&s.db).await? {
        Some(row) => schedule::json(&s.db, &row, schedule::today()).await?,
        None => Value::Null,
    })
}

async fn read(State(s): State<AppStateRef>) -> ApiResult<Json<Value>> {
    Ok(Json(json!({ "schedule": view(&s).await? })))
}

#[derive(Deserialize)]
struct SaveInput {
    cadence: String,
    pay_day: String,
    draft_days_before: Option<i64>,
    active: Option<bool>,
}

/// Saves the schedule, then runs the scheduler at once, so a pay day already inside the draft
/// window gets its draft without waiting for the hourly pass.
async fn save(State(s): State<AppStateRef>, Json(input): Json<SaveInput>) -> ApiResult<Json<Value>> {
    let parsed = schedule::parse_input(&input.cadence, &input.pay_day, input.draft_days_before, input.active)?;
    let today = schedule::today();
    let _guard = s.schedule_lock.lock().await;
    schedule::upsert(&s.db, &parsed, today).await?;
    let outcome = schedule::tick(&s.db, today).await?;
    if let TickOutcome::Drafted { run_id, .. } = &outcome {
        if let Some(executor) = &s.executor {
            executor.changed(run_id);
        }
    }
    Ok(Json(json!({ "schedule": view(&s).await? })))
}

/// One scheduler pass under the schedule lock; failures are logged, never fatal.
pub async fn run_once(s: &AppStateRef) {
    let _guard = s.schedule_lock.lock().await;
    match schedule::tick(&s.db, schedule::today()).await {
        Ok(TickOutcome::Drafted {
            run_id,
            period_start,
            period_end,
        }) => {
            tracing::info!(run = run_id, "pay schedule: drafted {period_start} to {period_end}");
            if let Some(executor) = &s.executor {
                executor.changed(&run_id);
            }
        }
        Ok(TickOutcome::Skipped {
            period_start,
            period_end,
            reason,
        }) => {
            tracing::info!("pay schedule: {period_start} to {period_end} skipped, {reason}");
        }
        Ok(TickOutcome::Waited) => {}
        Err(e) => tracing::warn!("pay schedule pass failed: {e:#}"),
    }
}

/// Runs the scheduler now and then every hour, for the life of the service.
pub fn spawn_hourly(s: AppStateRef) {
    tokio::spawn(async move {
        let mut every = tokio::time::interval(Duration::from_secs(3600));
        loop {
            every.tick().await;
            run_once(&s).await;
        }
    });
}
