//! App database (`payslip.db`, ADR-004): contractors, runs, pay lines, statements.

use std::{path::Path, str::FromStr, time::Duration};

use anyhow::Context;
use serde::Serialize;
use sqlx::{
    sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous},
    FromRow, SqlitePool,
};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use uuid::Uuid;

pub type Pool = SqlitePool;

pub fn now() -> String {
    OffsetDateTime::now_utc()
        .replace_nanosecond(0)
        .unwrap_or_else(|_| OffsetDateTime::now_utc())
        .format(&Rfc3339)
        .unwrap_or_default()
}

/// Creates `dir` readable by this user only (Unix): wallet databases and viewer caches hold
/// viewing keys.
pub fn create_private_dir(dir: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

pub async fn open(path: &Path) -> anyhow::Result<Pool> {
    if let Some(dir) = path.parent() {
        create_private_dir(dir)?;
    }
    let opts = SqliteConnectOptions::from_str(&format!("sqlite://{}", path.display()))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .foreign_keys(true)
        .busy_timeout(Duration::from_secs(10));
    open_with(opts).await
}

pub async fn open_with(opts: SqliteConnectOptions) -> anyhow::Result<Pool> {
    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(opts)
        .await
        .context("opening payslip.db")?;
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .context("migrating payslip.db")?;
    Ok(pool)
}

pub async fn setting(pool: &Pool, key: &str) -> anyhow::Result<Option<String>> {
    Ok(sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?)
}

pub async fn set_setting(pool: &Pool, key: &str, value: &str) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Contractors

#[derive(Clone, Debug, Serialize, FromRow)]
pub struct Contractor {
    pub id: String,
    pub name: String,
    pub email: Option<String>,
    pub unified_address: String,
    #[sqlx(rename = "zip32_account_index")]
    #[serde(rename = "account_index")]
    pub account_index: i64,
    #[serde(skip)]
    pub account_birthday_height: i64,
    pub settlement_choice: String,
    pub payout_chain: Option<String>,
    pub payout_address: Option<String>,
    pub fvk_shared_at: Option<String>,
    pub created_at: String,
    #[serde(skip)]
    pub archived_at: Option<String>,
}

#[derive(Clone, Debug)]
pub struct NewContractor {
    pub name: String,
    pub email: Option<String>,
    pub unified_address: String,
    pub settlement_choice: String,
    pub payout_chain: Option<String>,
    pub payout_address: Option<String>,
}

pub async fn list_contractors(pool: &Pool) -> anyhow::Result<Vec<Contractor>> {
    Ok(
        sqlx::query_as("SELECT * FROM contractors WHERE archived_at IS NULL ORDER BY zip32_account_index")
            .fetch_all(pool)
            .await?,
    )
}

pub async fn all_contractors(pool: &Pool) -> anyhow::Result<Vec<Contractor>> {
    Ok(sqlx::query_as("SELECT * FROM contractors ORDER BY zip32_account_index")
        .fetch_all(pool)
        .await?)
}

pub async fn get_contractor(pool: &Pool, id: &str) -> anyhow::Result<Option<Contractor>> {
    Ok(sqlx::query_as("SELECT * FROM contractors WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?)
}

pub async fn find_active_by_address(pool: &Pool, address: &str) -> anyhow::Result<Option<Contractor>> {
    Ok(
        sqlx::query_as("SELECT * FROM contractors WHERE unified_address = ? AND archived_at IS NULL")
            .bind(address)
            .fetch_optional(pool)
            .await?,
    )
}

/// The next ZIP-32 account index. Indices are never reused, even after archiving, so a
/// viewing key always maps to exactly one contractor.
pub async fn next_account_index(pool: &Pool) -> anyhow::Result<u32> {
    let max: Option<i64> = sqlx::query_scalar("SELECT MAX(zip32_account_index) FROM contractors")
        .fetch_one(pool)
        .await?;
    Ok(max.map(|m| m as u32 + 1).unwrap_or(1))
}

pub async fn insert_contractor(
    pool: &Pool,
    c: &NewContractor,
    account_index: u32,
    birthday: u32,
) -> anyhow::Result<Contractor> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO contractors (id, name, email, unified_address, zip32_account_index, account_birthday_height,
                                  settlement_choice, payout_chain, payout_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(&c.name)
    .bind(&c.email)
    .bind(&c.unified_address)
    .bind(account_index as i64)
    .bind(birthday as i64)
    .bind(&c.settlement_choice)
    .bind(&c.payout_chain)
    .bind(&c.payout_address)
    .bind(now())
    .execute(pool)
    .await?;
    Ok(get_contractor(pool, &id).await?.expect("just inserted"))
}

pub async fn update_contractor(pool: &Pool, id: &str, c: &NewContractor) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE contractors SET name = ?, email = ?, unified_address = ?, settlement_choice = ?, payout_chain = ?,
                                payout_address = ? WHERE id = ?",
    )
    .bind(&c.name)
    .bind(&c.email)
    .bind(&c.unified_address)
    .bind(&c.settlement_choice)
    .bind(&c.payout_chain)
    .bind(&c.payout_address)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn archive_contractor(pool: &Pool, id: &str) -> anyhow::Result<()> {
    sqlx::query("UPDATE contractors SET archived_at = ? WHERE id = ?")
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn mark_fvk_shared(pool: &Pool, id: &str) -> anyhow::Result<()> {
    sqlx::query("UPDATE contractors SET fvk_shared_at = COALESCE(fvk_shared_at, ?) WHERE id = ?")
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// True if the contractor is in a run that has started and not finished (not a draft, not paid,
/// not cancelled).
pub async fn contractor_in_active_run(pool: &Pool, id: &str) -> anyhow::Result<bool> {
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM pay_lines l JOIN runs r ON r.id = l.run_id
         WHERE l.contractor_id = ? AND r.status NOT IN ('draft', 'paid', 'cancelled')",
    )
    .bind(id)
    .fetch_one(pool)
    .await?;
    Ok(n > 0)
}

// ---------------------------------------------------------------------------------------------
// Runs

#[derive(Clone, Debug, FromRow)]
pub struct RunRow {
    pub id: String,
    pub idempotency_key: Option<String>,
    pub period_start: String,
    pub period_end: String,
    pub funding_asset: String,
    pub funding_amount: Option<i64>,
    pub zec_acquired: Option<i64>,
    pub zec_usd_rate: Option<i64>,
    pub status: String,
    pub failed_from: Option<String>,
    pub venue: Option<String>,
    pub venue_state: Option<String>,
    pub allocation_txid: Option<String>,
    pub allocation_height: Option<i64>,
    pub fees_zat: i64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub error_hint: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// True once the payer executed the run; a restart resumes only such runs.
    pub execute_requested: bool,
}

#[derive(Clone, Debug, FromRow)]
pub struct LineRow {
    pub id: String,
    pub run_id: String,
    pub contractor_id: String,
    pub position: i64,
    pub invoice_ref: String,
    pub amount_usd_basis: i64,
    pub amount_zec: Option<i64>,
    pub fee_zat: Option<i64>,
    pub memo: Option<String>,
    pub memo_hash: Option<String>,
    pub status: String,
    pub txid: Option<String>,
    pub expiry_height: Option<i64>,
    pub confirmed_height: Option<i64>,
    pub attempts: i64,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub error_hint: Option<String>,
    pub settlement_state: Option<String>,
    // joined
    pub contractor_name: String,
    /// True when the contractor was archived after the run was created.
    pub contractor_archived: bool,
    pub account_index: i64,
    pub unified_address: String,
    pub settlement_choice: String,
    pub payout_chain: Option<String>,
    pub payout_address: Option<String>,
}

pub struct NewLine {
    pub contractor_id: String,
    pub amount_usd_cents: u64,
    pub invoice_ref: String,
}

pub async fn get_run(pool: &Pool, id: &str) -> anyhow::Result<Option<RunRow>> {
    Ok(sqlx::query_as("SELECT * FROM runs WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?)
}

pub async fn get_run_by_key(pool: &Pool, key: &str) -> anyhow::Result<Option<RunRow>> {
    Ok(sqlx::query_as("SELECT * FROM runs WHERE idempotency_key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?)
}

pub async fn list_runs(pool: &Pool) -> anyhow::Result<Vec<RunRow>> {
    Ok(sqlx::query_as("SELECT * FROM runs ORDER BY created_at DESC, id")
        .fetch_all(pool)
        .await?)
}

/// A run's lines. The payout details (address, settlement, USDC chain and address) are the ones
/// fixed when the run was funded; a draft shows the contractor's current ones.
pub async fn lines(pool: &Pool, run_id: &str) -> anyhow::Result<Vec<LineRow>> {
    Ok(sqlx::query_as(
        "SELECT l.*, c.name AS contractor_name, c.zip32_account_index AS account_index,
                c.archived_at IS NOT NULL AS contractor_archived,
                COALESCE(l.fixed_unified_address, c.unified_address) AS unified_address,
                COALESCE(l.fixed_settlement_choice, c.settlement_choice) AS settlement_choice,
                CASE WHEN l.fixed_settlement_choice IS NULL THEN c.payout_chain ELSE l.fixed_payout_chain END AS payout_chain,
                CASE WHEN l.fixed_settlement_choice IS NULL THEN c.payout_address ELSE l.fixed_payout_address END AS payout_address
         FROM pay_lines l JOIN contractors c ON c.id = l.contractor_id
         WHERE l.run_id = ? ORDER BY l.position",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?)
}

/// Fixes each line's payout details to the contractor's current ones. Called when a run is
/// funded: from then on edits to the contractor do not change how this run pays them.
pub async fn fix_line_payouts(pool: &Pool, run_id: &str) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE pay_lines SET
            fixed_unified_address = (SELECT c.unified_address FROM contractors c WHERE c.id = pay_lines.contractor_id),
            fixed_settlement_choice = (SELECT c.settlement_choice FROM contractors c WHERE c.id = pay_lines.contractor_id),
            fixed_payout_chain = (SELECT c.payout_chain FROM contractors c WHERE c.id = pay_lines.contractor_id),
            fixed_payout_address = (SELECT c.payout_address FROM contractors c WHERE c.id = pay_lines.contractor_id)
         WHERE run_id = ?",
    )
    .bind(run_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Inserts a run and its lines atomically. Returns `Ok(None)` if the idempotency key exists.
pub async fn insert_run(
    pool: &Pool,
    idempotency_key: Option<&str>,
    period_start: &str,
    period_end: &str,
    new_lines: &[NewLine],
) -> anyhow::Result<Option<String>> {
    let id = Uuid::new_v4().to_string();
    let ts = now();
    let mut tx = pool.begin().await?;
    let inserted = sqlx::query(
        "INSERT INTO runs (id, idempotency_key, period_start, period_end, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'draft', ?, ?) ON CONFLICT (idempotency_key) DO NOTHING",
    )
    .bind(&id)
    .bind(idempotency_key)
    .bind(period_start)
    .bind(period_end)
    .bind(&ts)
    .bind(&ts)
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() == 0 {
        tx.rollback().await?;
        return Ok(None);
    }
    for (i, l) in new_lines.iter().enumerate() {
        sqlx::query(
            "INSERT INTO pay_lines (id, run_id, contractor_id, position, invoice_ref, amount_usd_basis, status)
             VALUES (?, ?, ?, ?, ?, ?, 'pending')",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&id)
        .bind(&l.contractor_id)
        .bind(i as i64)
        .bind(&l.invoice_ref)
        .bind(l.amount_usd_cents as i64)
        .execute(&mut *tx)
        .await?;
    }
    sqlx::query("INSERT INTO run_events (run_id, at, message) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(&ts)
        .bind(format!("Run created with {} lines", new_lines.len()))
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Some(id))
}

/// Deletes a run that never left `draft`. Returns false if it is not a draft.
pub async fn delete_draft_run(pool: &Pool, id: &str) -> anyhow::Result<bool> {
    let mut tx = pool.begin().await?;
    let status: Option<String> = sqlx::query_scalar("SELECT status FROM runs WHERE id = ?")
        .bind(id)
        .fetch_optional(&mut *tx)
        .await?;
    if status.as_deref() != Some("draft") {
        return Ok(false);
    }
    sqlx::query("DELETE FROM run_events WHERE run_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM pay_lines WHERE run_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM runs WHERE id = ? AND status = 'draft'")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(true)
}

/// Compare-and-set on run status. Returns false if the run was not in `from`.
pub async fn transition(pool: &Pool, id: &str, from: &[&str], to: &str) -> anyhow::Result<bool> {
    let placeholders = from.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "UPDATE runs SET status = ?, updated_at = ?, error_code = NULL, error_message = NULL, error_hint = NULL,
                failed_from = NULL WHERE id = ? AND status IN ({placeholders})"
    );
    // Only "?" placeholders are interpolated; every value is bound.
    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql)).bind(to).bind(now()).bind(id);
    for f in from {
        q = q.bind(*f);
    }
    Ok(q.execute(pool).await?.rows_affected() == 1)
}

pub async fn fail_run(pool: &Pool, id: &str, code: &str, message: &str, hint: &str) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE runs SET failed_from = CASE WHEN status = 'failed' THEN failed_from ELSE status END, status = 'failed',
                error_code = ?, error_message = ?, error_hint = ?, updated_at = ? WHERE id = ?",
    )
    .bind(code)
    .bind(message)
    .bind(hint)
    .bind(now())
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn set_venue(pool: &Pool, id: &str, venue: &str, state: &serde_json::Value) -> anyhow::Result<()> {
    sqlx::query("UPDATE runs SET venue = ?, venue_state = ?, updated_at = ? WHERE id = ?")
        .bind(venue)
        .bind(state.to_string())
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_fill(
    pool: &Pool,
    id: &str,
    funded_usd_cents: u64,
    zec_acquired_zat: u64,
    rate_e6: u64,
) -> anyhow::Result<()> {
    // Only while swapping: a run cancelled meanwhile never takes a fill.
    sqlx::query(
        "UPDATE runs SET funding_amount = ?, zec_acquired = ?, zec_usd_rate = ?, updated_at = ? WHERE id = ? AND status = 'swapping'",
    )
        .bind(funded_usd_cents as i64)
        .bind(zec_acquired_zat as i64)
        .bind(rate_e6 as i64)
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_allocation(pool: &Pool, id: &str, txid: Option<&str>, height: Option<u32>) -> anyhow::Result<()> {
    sqlx::query("UPDATE runs SET allocation_txid = ?, allocation_height = ?, updated_at = ? WHERE id = ?")
        .bind(txid)
        .bind(height.map(|h| h as i64))
        .bind(now())
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Sets the run's network fees: the fees of its mined transactions.
pub async fn set_fees(pool: &Pool, id: &str, fee_zat: u64) -> anyhow::Result<()> {
    sqlx::query("UPDATE runs SET fees_zat = ?, updated_at = ? WHERE id = ? AND fees_zat <> ?")
        .bind(fee_zat as i64)
        .bind(now())
        .bind(id)
        .bind(fee_zat as i64)
        .execute(pool)
        .await?;
    Ok(())
}

/// Records whether the payer has asked for the run to be executed.
pub async fn set_execute_requested(pool: &Pool, id: &str, requested: bool) -> anyhow::Result<()> {
    sqlx::query("UPDATE runs SET execute_requested = ? WHERE id = ?")
        .bind(requested)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Cancels a run that never received money: no fill recorded and no allocation built. Returns
/// false if the run is not in one of `from` or money has reached it.
pub async fn cancel_run(pool: &Pool, id: &str, from: &[&str]) -> anyhow::Result<bool> {
    let placeholders = from.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "UPDATE runs SET status = 'cancelled', updated_at = ?, failed_from = NULL, error_code = NULL,
                error_message = NULL, error_hint = NULL, execute_requested = 0
         WHERE id = ? AND funding_amount IS NULL AND zec_acquired IS NULL AND allocation_txid IS NULL
           AND status IN ({placeholders})"
    );
    // Only "?" placeholders are interpolated; every value is bound.
    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql)).bind(now()).bind(id);
    for f in from {
        q = q.bind(*f);
    }
    Ok(q.execute(pool).await?.rows_affected() == 1)
}

pub async fn set_line_amount(
    pool: &Pool,
    line_id: &str,
    amount_zat: u64,
    fee_zat: u64,
    memo: &str,
    memo_hash: &str,
) -> anyhow::Result<()> {
    sqlx::query("UPDATE pay_lines SET amount_zec = ?, fee_zat = ?, memo = ?, memo_hash = ? WHERE id = ?")
        .bind(amount_zat as i64)
        .bind(fee_zat as i64)
        .bind(memo)
        .bind(memo_hash)
        .bind(line_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_lines_status(pool: &Pool, run_id: &str, from: &str, to: &str) -> anyhow::Result<()> {
    sqlx::query("UPDATE pay_lines SET status = ? WHERE run_id = ? AND status = ?")
        .bind(to)
        .bind(run_id)
        .bind(from)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_line_tx(
    pool: &Pool,
    line_id: &str,
    txid: Option<&str>,
    expiry_height: Option<u32>,
    status: &str,
) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE pay_lines SET txid = ?, expiry_height = ?, status = ?, attempts = attempts + (? IS NOT NULL),
                error_code = NULL, error_message = NULL, error_hint = NULL WHERE id = ?",
    )
    .bind(txid)
    .bind(expiry_height.map(|h| h as i64))
    .bind(status)
    .bind(txid)
    .bind(line_id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn confirm_line(pool: &Pool, line_id: &str, height: u32) -> anyhow::Result<()> {
    sqlx::query("UPDATE pay_lines SET status = 'confirmed', confirmed_height = ? WHERE id = ?")
        .bind(height as i64)
        .bind(line_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn set_settlement(pool: &Pool, line_id: &str, state: &serde_json::Value) -> anyhow::Result<()> {
    sqlx::query("UPDATE pay_lines SET settlement_state = ? WHERE id = ?")
        .bind(state.to_string())
        .bind(line_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn unconfirm_line(pool: &Pool, line_id: &str) -> anyhow::Result<()> {
    sqlx::query("UPDATE pay_lines SET status = 'broadcast', confirmed_height = NULL WHERE id = ?")
        .bind(line_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Clears a line's error without changing its status (a warning that no longer applies).
pub async fn clear_line_error(pool: &Pool, line_id: &str, code: &str) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE pay_lines SET error_code = NULL, error_message = NULL, error_hint = NULL WHERE id = ? AND error_code = ?",
    )
    .bind(line_id)
    .bind(code)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn fail_line(pool: &Pool, line_id: &str, code: &str, message: &str, hint: &str) -> anyhow::Result<()> {
    sqlx::query("UPDATE pay_lines SET error_code = ?, error_message = ?, error_hint = ? WHERE id = ?")
        .bind(code)
        .bind(message)
        .bind(hint)
        .bind(line_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn log_event(pool: &Pool, run_id: &str, message: &str) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO run_events (run_id, at, message) VALUES (?, ?, ?)")
        .bind(run_id)
        .bind(now())
        .bind(message)
        .execute(pool)
        .await?;
    Ok(())
}

#[derive(Clone, Debug, Serialize, FromRow)]
pub struct RunEvent {
    pub id: i64,
    pub at: String,
    pub message: String,
}

pub async fn events(pool: &Pool, run_id: &str) -> anyhow::Result<Vec<RunEvent>> {
    Ok(
        sqlx::query_as("SELECT id, at, message FROM run_events WHERE run_id = ? ORDER BY id")
            .bind(run_id)
            .fetch_all(pool)
            .await?,
    )
}

pub async fn record_statement(
    pool: &Pool,
    scope: &str,
    contractor_id: Option<&str>,
    subject: &str,
    period: (&str, &str),
    scanned_to_height: u32,
    csv_hash: Option<&str>,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO statements (id, scope, contractor_id, subject, period_start, period_end, scanned_to_height, generated_at, csv_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(scope)
    .bind(contractor_id)
    .bind(subject)
    .bind(period.0)
    .bind(period.1)
    .bind(scanned_to_height as i64)
    .bind(now())
    .bind(csv_hash)
    .execute(pool)
    .await?;
    Ok(())
}
