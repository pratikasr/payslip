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
    /// The usual pay in US cents, prefilled into a scheduled draft; None when the contractor is
    /// paid by request or by hand.
    pub default_amount_usd_cents: Option<i64>,
    pub created_at: String,
    #[serde(skip)]
    pub archived_at: Option<String>,
    /// Fingerprint of the account's viewing key (viewer.rs); None until recorded.
    #[serde(skip)]
    pub key_fingerprint: Option<String>,
    /// When the treasury key was last replaced (ADR-030): the contractor's account was derived
    /// again from the new seed, so they need the new viewing key. None for a contractor whose
    /// key never changed.
    pub key_rotated_at: Option<String>,
}

#[derive(Clone, Debug)]
pub struct NewContractor {
    pub name: String,
    pub email: Option<String>,
    pub unified_address: String,
    pub settlement_choice: String,
    pub payout_chain: Option<String>,
    pub payout_address: Option<String>,
    pub default_amount_usd_cents: Option<i64>,
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
                                  settlement_choice, payout_chain, payout_address, default_amount_usd_cents,
                                  created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
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
    .bind(c.default_amount_usd_cents)
    .bind(now())
    .execute(pool)
    .await?;
    Ok(get_contractor(pool, &id).await?.expect("just inserted"))
}

pub async fn update_contractor(pool: &Pool, id: &str, c: &NewContractor) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE contractors SET name = ?, email = ?, unified_address = ?, settlement_choice = ?, payout_chain = ?,
                                payout_address = ?, default_amount_usd_cents = ? WHERE id = ?",
    )
    .bind(&c.name)
    .bind(&c.email)
    .bind(&c.unified_address)
    .bind(&c.settlement_choice)
    .bind(&c.payout_chain)
    .bind(&c.payout_address)
    .bind(c.default_amount_usd_cents)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Records the fingerprint of the contractor's viewing key, so a key sent to the portal maps to
/// them with one lookup (`find_contractor_by_fingerprint`).
pub async fn set_contractor_fingerprint(pool: &Pool, id: &str, fingerprint: &str) -> anyhow::Result<()> {
    sqlx::query("UPDATE contractors SET key_fingerprint = ? WHERE id = ?")
        .bind(fingerprint)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// The active contractor whose viewing key has this fingerprint. Account indices are never
/// reused, so a fingerprint belongs to at most one contractor.
pub async fn find_contractor_by_fingerprint(pool: &Pool, fingerprint: &str) -> anyhow::Result<Option<Contractor>> {
    Ok(
        sqlx::query_as("SELECT * FROM contractors WHERE key_fingerprint = ? AND archived_at IS NULL")
            .bind(fingerprint)
            .fetch_optional(pool)
            .await?,
    )
}

/// Contractors created before fingerprints were recorded (archived ones included: their keys
/// still exist).
pub async fn contractors_without_fingerprint(pool: &Pool) -> anyhow::Result<Vec<Contractor>> {
    Ok(
        sqlx::query_as("SELECT * FROM contractors WHERE key_fingerprint IS NULL ORDER BY zip32_account_index")
            .fetch_all(pool)
            .await?,
    )
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

/// Undoes [`mark_fvk_shared`]: the key is recorded as not shared.
pub async fn clear_fvk_shared(pool: &Pool, id: &str) -> anyhow::Result<()> {
    sqlx::query("UPDATE contractors SET fvk_shared_at = NULL WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// After the treasury key was replaced (ADR-030): the contractor's account exists again in the
/// new wallet with a new birthday and a new viewing key, which nobody has been given yet.
pub async fn rotate_contractor_key(
    pool: &Pool,
    id: &str,
    birthday: u32,
    fingerprint: Option<&str>,
    at: &str,
) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE contractors SET account_birthday_height = ?, key_fingerprint = ?, key_rotated_at = ?, fvk_shared_at = NULL
         WHERE id = ?",
    )
    .bind(birthday as i64)
    .bind(fingerprint)
    .bind(at)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Treasury keys (migration 0008, ADR-030)

/// One treasury seed this deployment has held.
#[derive(Clone, Debug, Serialize, FromRow)]
pub struct TreasuryKey {
    pub version: i64,
    pub created_at: String,
    pub retired_at: Option<String>,
    pub address: Option<String>,
}

/// The newest key row (the current key, or the last one retired), if any.
pub async fn current_treasury_key(pool: &Pool) -> anyhow::Result<Option<TreasuryKey>> {
    Ok(sqlx::query_as(
        "SELECT version, created_at, retired_at, address FROM treasury_keys ORDER BY version DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await?)
}

/// Records a key as the next version and returns that version.
pub async fn insert_treasury_key(pool: &Pool, created_at: &str, address: Option<&str>) -> anyhow::Result<i64> {
    let next: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(version), 0) + 1 FROM treasury_keys")
        .fetch_one(pool)
        .await?;
    sqlx::query("INSERT INTO treasury_keys (version, created_at, retired_at, address) VALUES (?, ?, NULL, ?)")
        .bind(next)
        .bind(created_at)
        .bind(address)
        .execute(pool)
        .await?;
    Ok(next)
}

pub async fn retire_treasury_key(pool: &Pool, version: i64, retired_at: &str) -> anyhow::Result<()> {
    sqlx::query("UPDATE treasury_keys SET retired_at = ? WHERE version = ? AND retired_at IS NULL")
        .bind(retired_at)
        .bind(version)
        .execute(pool)
        .await?;
    Ok(())
}

/// Records the treasury address of a key once the wallet derived it.
pub async fn set_treasury_key_address(pool: &Pool, version: i64, address: &str) -> anyhow::Result<()> {
    sqlx::query("UPDATE treasury_keys SET address = ? WHERE version = ? AND address IS NULL")
        .bind(address)
        .bind(version)
        .execute(pool)
        .await?;
    Ok(())
}

/// Runs that have started and not finished: not `draft`, `paid` or `cancelled`. The treasury
/// key is not replaced or moved while there are any.
pub async fn runs_in_progress(pool: &Pool) -> anyhow::Result<Vec<RunRow>> {
    Ok(sqlx::query_as(
        "SELECT * FROM runs WHERE status NOT IN ('draft', 'paid', 'cancelled') ORDER BY created_at, rowid",
    )
    .fetch_all(pool)
    .await?)
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
    /// SHA-256 of the canonical create request sent with `idempotency_key`; None for runs
    /// created without a key or before it was recorded.
    pub idempotency_hash: Option<String>,
    /// The signed-in user who created the run (ADR-026); None with sign-in off. With two or
    /// more approvals required, the creator cannot approve their own run.
    pub created_by: Option<String>,
}

/// One member's approval of a run (migration 0007), with who they are as the API shows it.
#[derive(Clone, Debug, Serialize, FromRow)]
pub struct Approval {
    pub user_id: String,
    pub name: Option<String>,
    pub email: String,
    /// The approver's role when they approved: admin or approver.
    pub role: String,
    pub at: String,
}

/// A run's approvals in the order they were recorded (rowid breaks ties within the same second).
pub async fn approvals(pool: &Pool, run_id: &str) -> anyhow::Result<Vec<Approval>> {
    Ok(sqlx::query_as(
        "SELECT a.user_id, u.name, u.email, a.role, a.at
         FROM run_approvals a JOIN users u ON u.id = a.user_id
         WHERE a.run_id = ? ORDER BY a.at, a.rowid",
    )
    .bind(run_id)
    .fetch_all(pool)
    .await?)
}

pub async fn approval_count(pool: &Pool, run_id: &str) -> anyhow::Result<u32> {
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM run_approvals WHERE run_id = ?")
        .bind(run_id)
        .fetch_one(pool)
        .await?;
    Ok(u32::try_from(n).unwrap_or(u32::MAX))
}

/// Records `user_id`'s approval of a run. False when that person already approved it: one
/// approval per member per run, whichever request got there first. The run's `updated_at`
/// moves with it, so clients holding an older copy take the one that carries the approval.
pub async fn add_approval(pool: &Pool, run_id: &str, user_id: &str, role: &str) -> anyhow::Result<bool> {
    let ts = now();
    let mut tx = pool.begin().await?;
    let r = sqlx::query("INSERT OR IGNORE INTO run_approvals (run_id, user_id, role, at) VALUES (?, ?, ?, ?)")
        .bind(run_id)
        .bind(user_id)
        .bind(role)
        .bind(&ts)
        .execute(&mut *tx)
        .await?;
    if r.rows_affected() != 1 {
        tx.rollback().await?;
        return Ok(false);
    }
    sqlx::query("UPDATE runs SET updated_at = ? WHERE id = ?")
        .bind(&ts)
        .bind(run_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(true)
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
    /// Block time of `confirmed_height`, RFC 3339 UTC; set with it, cleared with it.
    pub confirmed_at: Option<String>,
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

#[derive(Clone, Debug)]
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

/// The run an idempotency key already made, if any. A cancelled run never counts, so a draft
/// approved again after a cancel creates a new run (older rows keep their key after cancel).
pub async fn get_run_by_key(pool: &Pool, key: &str) -> anyhow::Result<Option<RunRow>> {
    Ok(
        sqlx::query_as("SELECT * FROM runs WHERE idempotency_key = ? AND status != 'cancelled'")
            .bind(key)
            .fetch_optional(pool)
            .await?,
    )
}

pub async fn list_runs(pool: &Pool) -> anyhow::Result<Vec<RunRow>> {
    Ok(sqlx::query_as("SELECT * FROM runs ORDER BY created_at DESC, id")
        .fetch_all(pool)
        .await?)
}

/// Every run in the order it was created: `created_at` has whole seconds, so the row order
/// breaks ties (runs created in the same second). Fund with ZEC claims the treasury balance in
/// this order (ADR-025).
pub async fn runs_oldest_first(pool: &Pool) -> anyhow::Result<Vec<RunRow>> {
    Ok(sqlx::query_as("SELECT * FROM runs ORDER BY created_at ASC, rowid ASC")
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

/// Inserts a run and its lines atomically, whatever other runs cover its period. Returns
/// `Ok(None)` if the idempotency key exists.
pub async fn insert_run(
    pool: &Pool,
    idempotency_key: Option<&str>,
    period_start: &str,
    period_end: &str,
    new_lines: &[NewLine],
) -> anyhow::Result<Option<String>> {
    let run = NewRun {
        idempotency_key,
        request_hash: None,
        period_start,
        period_end,
        allow_overlap: true,
        created_by: None,
    };
    Ok(match create_run(pool, &run, new_lines).await? {
        RunInsert::Created(id) => Some(id),
        RunInsert::KeyExists(_) | RunInsert::Overlaps(_) => None,
    })
}

pub struct NewRun<'a> {
    pub idempotency_key: Option<&'a str>,
    /// Stored with the key, so a later request with the same key and another body is told apart.
    pub request_hash: Option<&'a str>,
    pub period_start: &'a str,
    pub period_end: &'a str,
    /// Create the run even when a run that is not cancelled covers part of its period.
    pub allow_overlap: bool,
    /// The signed-in user creating it; None with sign-in off.
    pub created_by: Option<&'a str>,
}

#[derive(Debug)]
pub enum RunInsert {
    Created(String),
    /// A run already has this idempotency key.
    KeyExists(Box<RunRow>),
    /// Runs that are not cancelled and cover part of the period, earliest period first.
    Overlaps(Vec<RunRow>),
}

/// Runs that are not cancelled and share at least one day with `start..=end` (dates are
/// `YYYY-MM-DD`, so text order is date order). A run with `exclude_key` as its idempotency key
/// is left out: a retry never overlaps the run it created.
pub async fn overlapping_runs(
    pool: &Pool,
    start: &str,
    end: &str,
    exclude_key: Option<&str>,
) -> anyhow::Result<Vec<RunRow>> {
    Ok(sqlx::query_as(
        "SELECT * FROM runs WHERE status <> 'cancelled' AND period_start <= ? AND period_end >= ?
           AND (? IS NULL OR idempotency_key IS NULL OR idempotency_key <> ?)
         ORDER BY period_start, created_at, id",
    )
    .bind(end)
    .bind(start)
    .bind(exclude_key)
    .bind(exclude_key)
    .fetch_all(pool)
    .await?)
}

/// Inserts a run and its lines atomically. The insert itself checks the idempotency key and,
/// unless `allow_overlap`, that no other run covers part of the period, so two requests at once
/// cannot both pass.
pub async fn create_run(pool: &Pool, run: &NewRun<'_>, new_lines: &[NewLine]) -> anyhow::Result<RunInsert> {
    let id = Uuid::new_v4().to_string();
    let ts = now();
    // A run cancelled between the failed insert and the overlap query leaves nothing to report;
    // the insert is simply tried again.
    let mut attempts = 0;
    let mut tx = loop {
        attempts += 1;
        let mut tx = pool.begin().await?;
        let inserted = sqlx::query(
            "INSERT INTO runs (id, idempotency_key, idempotency_hash, period_start, period_end, status, created_at,
                               updated_at, created_by)
             SELECT ?, ?, ?, ?, ?, 'draft', ?, ?, ?
             WHERE ? OR NOT EXISTS (
                 SELECT 1 FROM runs o WHERE o.status <> 'cancelled' AND o.period_start <= ? AND o.period_end >= ?
                   AND (? IS NULL OR o.idempotency_key IS NULL OR o.idempotency_key <> ?))
             ON CONFLICT (idempotency_key) DO NOTHING",
        )
        .bind(&id)
        .bind(run.idempotency_key)
        .bind(run.idempotency_key.and(run.request_hash))
        .bind(run.period_start)
        .bind(run.period_end)
        .bind(&ts)
        .bind(&ts)
        .bind(run.created_by)
        .bind(run.allow_overlap)
        .bind(run.period_end)
        .bind(run.period_start)
        .bind(run.idempotency_key)
        .bind(run.idempotency_key)
        .execute(&mut *tx)
        .await?;
        if inserted.rows_affected() == 1 {
            break tx;
        }
        tx.rollback().await?;
        if let Some(key) = run.idempotency_key {
            if let Some(existing) = get_run_by_key(pool, key).await? {
                return Ok(RunInsert::KeyExists(Box::new(existing)));
            }
        }
        let overlaps = overlapping_runs(pool, run.period_start, run.period_end, run.idempotency_key).await?;
        if !overlaps.is_empty() {
            return Ok(RunInsert::Overlaps(overlaps));
        }
        anyhow::ensure!(attempts < 3, "the run could not be inserted; retry the request");
    };
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
    Ok(RunInsert::Created(id))
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
    // Requests the draft had taken go back to waiting for the next run for their period.
    sqlx::query("UPDATE payment_requests SET run_id = NULL, line_id = NULL WHERE run_id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM run_approvals WHERE run_id = ?")
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
                error_message = NULL, error_hint = NULL, execute_requested = 0,
                idempotency_key = CASE WHEN idempotency_key IS NULL THEN NULL
                                       ELSE idempotency_key || ':cancelled:' || ? END
         WHERE id = ? AND funding_amount IS NULL AND zec_acquired IS NULL AND allocation_txid IS NULL
           AND status IN ({placeholders})"
    );
    // Only "?" placeholders are interpolated; every value is bound.
    // A cancelled run gives up its idempotency key, so the same draft approved again creates a
    // new run instead of replaying the cancelled one.
    let stamp = now();
    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(stamp.clone())
        .bind(stamp)
        .bind(id);
    for f in from {
        q = q.bind(*f);
    }
    let cancelled = q.execute(pool).await?.rows_affected() == 1;
    if cancelled {
        // Approved requests the run had taken wait for the next run for their period; none of
        // them was paid, since a cancelled run received no money.
        sqlx::query(
            "UPDATE payment_requests SET run_id = NULL, line_id = NULL WHERE run_id = ? AND status = 'approved'",
        )
        .bind(id)
        .execute(pool)
        .await?;
    }
    Ok(cancelled)
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

/// Marks a line confirmed at `height`. `confirmed_at` is that block's time (RFC 3339 UTC), or
/// None when it could not be looked up yet: [`set_line_confirmed_at`] fills it in later.
pub async fn confirm_line(pool: &Pool, line_id: &str, height: u32, confirmed_at: Option<&str>) -> anyhow::Result<()> {
    sqlx::query("UPDATE pay_lines SET status = 'confirmed', confirmed_height = ?, confirmed_at = ? WHERE id = ?")
        .bind(height as i64)
        .bind(confirmed_at)
        .bind(line_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Confirmed lines without a block time: (line id, confirmed height), of one run or of all.
pub async fn lines_missing_confirmed_at(pool: &Pool, run_id: Option<&str>) -> anyhow::Result<Vec<(String, i64)>> {
    Ok(sqlx::query_as(
        "SELECT id, confirmed_height FROM pay_lines
         WHERE confirmed_height IS NOT NULL AND confirmed_at IS NULL AND (? IS NULL OR run_id = ?)
         ORDER BY confirmed_height",
    )
    .bind(run_id)
    .bind(run_id)
    .fetch_all(pool)
    .await?)
}

/// Records the block time of a line's confirmed height, once: only while the line is still
/// confirmed at `height` and has none. Returns whether it was recorded.
pub async fn set_line_confirmed_at(
    pool: &Pool,
    line_id: &str,
    height: i64,
    confirmed_at: &str,
) -> anyhow::Result<bool> {
    let r = sqlx::query(
        "UPDATE pay_lines SET confirmed_at = ? WHERE id = ? AND confirmed_height = ? AND confirmed_at IS NULL",
    )
    .bind(confirmed_at)
    .bind(line_id)
    .bind(height)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() == 1)
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
    sqlx::query("UPDATE pay_lines SET status = 'broadcast', confirmed_height = NULL, confirmed_at = NULL WHERE id = ?")
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
