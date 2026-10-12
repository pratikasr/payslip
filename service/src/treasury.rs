//! Treasury key control (ADR-030): who can make the treasury sign, and when.
//!
//! The seed file (`payer.seed.age`, see [`crate::seed`]) is the company's key. Three ways to run:
//!
//! - **Unlocked by the environment.** `PAYSLIP_SEED_PASSPHRASE` is set: the seed is decrypted at
//!   start and stays in memory, as every release before this one. Nothing here changes that; the
//!   API's lock, unlock and key endpoints answer `unlocked_by_env`.
//! - **Locked.** The seed file exists and no passphrase is set: the wallet opens without the seed.
//!   It syncs, receives, and serves every read (statements, Books, proofs, run drafting), but
//!   anything that signs (allocation, payments, a sweep) answers `409 treasury_locked`, and the
//!   executor parks a run at the step that needs a signature instead of failing it. An admin
//!   unlocks it with the passphrase for a few hours (`POST /api/treasury/unlock`); a timer, a
//!   lock request or a restart locks it again.
//! - **No key.** No seed file: the service starts, reads work, and spending and funding answer
//!   `409 no_treasury_key` until an admin uploads one (`POST /api/treasury/key`): an armored age
//!   file the browser produced by encrypting the 24 words with the company's passphrase.
//!
//! Replacing the key sweeps the old treasury to the new one, retires the old seed file and
//! wallet, and derives every contractor's account again from the new seed (same indices, so the
//! contractor rows keep their ids; each gets `key_rotated_at`). Past runs stay readable with the
//! old viewing keys the accountant already holds. `POST /api/treasury/move` sweeps the treasury
//! to an outside shielded address: the way out of Payslip.
//!
//! While locked, nobody can spend the treasury, including the operator of this server. While an
//! admin has unlocked it for payroll, the server process can sign; an operator with root on the
//! host could read the key from memory during that time. For full control, self-host.

use std::{
    path::PathBuf,
    sync::{Arc, Mutex, Weak},
    time::Duration,
};

use anyhow::anyhow;
use async_trait::async_trait;
use axum::http::StatusCode;
use secrecy08::SecretVec;
use serde::Serialize;
use serde_json::{json, Value};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

use crate::{
    config::Config,
    db::{self, Pool},
    error::{ApiError, ApiResult},
    payer::{self, Payer, SeedMismatch, WalletInfo, TREASURY_INDEX},
    runs::{ChainOps, Pay, PayerChain},
    seed::{self, SeedFile, WrongPassphrase},
    wallet::SpendError,
};

/// How long an unlock lasts when the request does not say.
pub const DEFAULT_UNLOCK_HOURS: u32 = 8;
/// The longest an unlock may last.
pub const MAX_UNLOCK_HOURS: u32 = 72;
/// The pause after a wrong passphrase, on top of scrypt's own second: a guess through the API
/// costs at least this long, and attempts are tried one at a time.
const WRONG_PASSPHRASE_DELAY: Duration = Duration::from_secs(2);

/// Whether the treasury can sign, and why.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum KeyState {
    /// PAYSLIP_SEED_PASSPHRASE unlocked the seed at start; it stays in memory.
    UnlockedByEnv,
    /// An admin unlocked it until `until`.
    Unlocked { until: OffsetDateTime },
    /// The seed file exists; the seed is not in memory.
    Locked,
    /// No seed file.
    NoKey,
}

impl KeyState {
    pub fn as_str(&self) -> &'static str {
        match self {
            KeyState::UnlockedByEnv => "unlocked_by_env",
            KeyState::Unlocked { .. } => "unlocked",
            KeyState::Locked => "locked",
            KeyState::NoKey => "no_key",
        }
    }

    pub fn can_sign(&self) -> bool {
        matches!(self, KeyState::UnlockedByEnv | KeyState::Unlocked { .. })
    }
}

/// `GET /api/treasury/key`.
#[derive(Clone, Debug, Serialize)]
pub struct KeyView {
    pub state: &'static str,
    pub unlocked_until: Option<String>,
    pub address: Option<String>,
    pub birthday_height: Option<u32>,
    pub storage: Storage,
    pub created_at: Option<String>,
    /// 0 before any key; 1 for the first, up by one at each replacement.
    pub key_version: i64,
}

#[derive(Clone, Debug, Serialize)]
pub struct Storage {
    pub path: String,
    pub format: &'static str,
}

/// `POST /api/treasury/key/replace`.
#[derive(Clone, Debug, Serialize)]
pub struct ReplaceView {
    pub key: KeyView,
    pub old_address: Option<String>,
    pub new_address: String,
    /// The sweep of the old treasury to the new one; None when the balance was below the fee.
    pub sweep_txid: Option<String>,
    pub sweep_explorer_url: Option<String>,
    pub retired: Vec<String>,
    /// Contractors whose account was derived again, and so need the new viewing key.
    pub contractors_rotated: usize,
}

/// `POST /api/treasury/move`.
#[derive(Clone, Debug, Serialize)]
pub struct MoveView {
    pub txid: String,
    pub explorer_url: String,
    pub to_address: String,
    /// What left the treasury, after the fee; None when the wallet did not record the fee.
    pub amount_zat: Option<u64>,
    pub fee_zat: Option<u64>,
}

/// The wallet behind the key manager. The service implements it with [`Payer`]; API tests
/// implement it in memory, since a real wallet cannot create an account without lightwalletd.
#[async_trait]
pub trait WalletBackend: Send + Sync {
    /// Opens the existing wallet at start, with the seed (env mode) or without (locked).
    async fn open(&self, seed: Option<SecretVec<u8>>) -> anyhow::Result<()>;
    /// Opens a new wallet for a new seed (a key just created or replacing the old one) and
    /// creates its treasury account, born at `birthday` or near the tip.
    async fn open_fresh(&self, seed: SecretVec<u8>, birthday: Option<u32>) -> anyhow::Result<()>;
    async fn install_seed(&self, seed: SecretVec<u8>) -> anyhow::Result<()>;
    async fn drop_seed(&self) -> anyhow::Result<()>;
    /// Closes the wallet and moves its database files aside as `<name>.retired-<stamp>`.
    async fn close_and_retire(&self, stamp: &str) -> anyhow::Result<Vec<PathBuf>>;
    /// The wallet's figures (address, birthday, balances); None before the treasury account
    /// exists (a wallet opened locked and never unlocked).
    async fn wallet_info(&self) -> anyhow::Result<Option<WalletInfo>>;
    async fn sync(&self) -> anyhow::Result<()>;
    /// Sends the treasury's whole spendable balance to `to`, broadcast at once; the wallet's own
    /// refusal (not enough for the fee) comes back as a value.
    async fn sweep_treasury(&self, to: &str) -> anyhow::Result<Result<String, SpendError>>;
    async fn tx_fee(&self, txid: &str) -> anyhow::Result<Option<u64>>;
    /// Creates ZIP-32 account `index` if needed; returns its UFVK and birthday.
    async fn ensure_account(&self, index: u32, name: String) -> anyhow::Result<(String, u32)>;
    /// The wallet, for handlers; None before a key exists.
    fn payer(&self) -> Option<Payer>;
    /// The chain operations for the executor; None before a key exists.
    fn chain(&self) -> Option<Arc<dyn ChainOps>>;
}

/// The service's backend: one [`Payer`] at a time, replaced when the key is.
pub struct PayerBackend {
    cfg: Config,
    current: std::sync::RwLock<Option<Payer>>,
}

impl PayerBackend {
    pub fn new(cfg: Config) -> Self {
        PayerBackend {
            cfg,
            current: std::sync::RwLock::new(None),
        }
    }

    fn current(&self) -> anyhow::Result<Payer> {
        self.current
            .read()
            .map_err(|_| anyhow!("wallet lock poisoned"))?
            .clone()
            .ok_or_else(|| anyhow!("no treasury key"))
    }

    fn set(&self, payer: Option<Payer>) -> anyhow::Result<Option<Payer>> {
        let mut slot = self.current.write().map_err(|_| anyhow!("wallet lock poisoned"))?;
        Ok(std::mem::replace(&mut *slot, payer))
    }

    /// Moves `wallet.db` and its journal files aside; the database must be closed.
    fn retire_db_files(&self, stamp: &str) -> anyhow::Result<Vec<PathBuf>> {
        let db = self.cfg.wallet_db_path();
        let mut retired = vec![];
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let mut name = db.file_name().unwrap_or_default().to_os_string();
            name.push(suffix);
            let path = db.with_file_name(name);
            if path.exists() {
                let to = seed::retired_path(&path, stamp);
                std::fs::rename(&path, &to)
                    .map_err(|e| anyhow!("retiring {} as {}: {e}", path.display(), to.display()))?;
                retired.push(to);
            }
        }
        Ok(retired)
    }
}

#[async_trait]
impl WalletBackend for PayerBackend {
    async fn open(&self, seed: Option<SecretVec<u8>>) -> anyhow::Result<()> {
        let payer = Payer::open_with(&self.cfg, &self.cfg.wallet_db_path(), seed, self.cfg.birthday_height).await?;
        self.set(Some(payer))?;
        Ok(())
    }

    async fn open_fresh(&self, seed: SecretVec<u8>, birthday: Option<u32>) -> anyhow::Result<()> {
        // A wallet left behind without its seed file (deleted by hand) cannot be reused: its
        // accounts came from another seed. Move it aside rather than fail.
        let stamp = stamp_now();
        for p in self.retire_db_files(&stamp)? {
            tracing::warn!("a wallet database with no seed file was moved aside as {}", p.display());
        }
        let payer = Payer::open_with(&self.cfg, &self.cfg.wallet_db_path(), Some(seed), birthday).await?;
        self.set(Some(payer))?;
        Ok(())
    }

    async fn install_seed(&self, seed: SecretVec<u8>) -> anyhow::Result<()> {
        self.current()?.install_seed(seed).await
    }

    async fn drop_seed(&self) -> anyhow::Result<()> {
        self.current()?.drop_seed().await
    }

    async fn close_and_retire(&self, stamp: &str) -> anyhow::Result<Vec<PathBuf>> {
        if let Some(payer) = self.set(None)? {
            payer.close().await?;
        }
        self.retire_db_files(stamp)
    }

    async fn wallet_info(&self) -> anyhow::Result<Option<WalletInfo>> {
        self.current()?.wallet_info_opt().await
    }

    async fn sync(&self) -> anyhow::Result<()> {
        self.current()?.sync().await.map(|_| ())
    }

    async fn sweep_treasury(&self, to: &str) -> anyhow::Result<Result<String, SpendError>> {
        self.current()?.try_sweep(TREASURY_INDEX, to).await
    }

    async fn tx_fee(&self, txid: &str) -> anyhow::Result<Option<u64>> {
        self.current()?.tx_fee(txid).await
    }

    async fn ensure_account(&self, index: u32, name: String) -> anyhow::Result<(String, u32)> {
        self.current()?.ensure_account(index, name).await
    }

    fn payer(&self) -> Option<Payer> {
        self.current().ok()
    }

    fn chain(&self) -> Option<Arc<dyn ChainOps>> {
        self.current()
            .ok()
            .map(|p| Arc::new(PayerChain(p)) as Arc<dyn ChainOps>)
    }
}

/// When an unlock that starts now and lasts `duration` ends, to the second, as every other
/// timestamp the API writes.
fn until_after(duration: Duration) -> OffsetDateTime {
    let end = OffsetDateTime::now_utc() + time::Duration::try_from(duration).unwrap_or(time::Duration::hours(1));
    end.replace_nanosecond(0).unwrap_or(end)
}

/// `YYYYMMDDTHHMMSSZ`, for retired file names.
pub fn stamp_now() -> String {
    let f = time::macros::format_description!("[year][month][day]T[hour][minute][second]Z");
    OffsetDateTime::now_utc().format(&f).unwrap_or_else(|_| "now".into())
}

/// The key manager: the seed file, the wallet behind it and the lock state.
pub struct Treasury {
    cfg: Config,
    db: Pool,
    seed_file: SeedFile,
    backend: Arc<dyn WalletBackend>,
    state: Mutex<KeyState>,
    /// The task that locks the treasury again when the unlock runs out.
    timer: Mutex<Option<tokio::task::JoinHandle<()>>>,
    /// Passphrase attempts, one at a time.
    attempts: tokio::sync::Mutex<()>,
    /// Creating, replacing and moving the key, one at a time.
    ops: tokio::sync::Mutex<()>,
}

impl Treasury {
    /// Opens the wallet for whatever the data folder holds: the seed decrypted with
    /// PAYSLIP_SEED_PASSPHRASE (as before), the seed file without a passphrase (locked), or
    /// nothing (no key). A wrong env passphrase still refuses to start, as before.
    pub async fn open(cfg: Config, db: Pool, backend: Arc<dyn WalletBackend>) -> anyhow::Result<Arc<Self>> {
        let seed_file = SeedFile::new(cfg.seed_path());
        let state = if !seed_file.exists() {
            KeyState::NoKey
        } else if let Some(passphrase) = cfg.seed_passphrase.clone() {
            let seed = seed_file.unlock(&passphrase)?;
            backend.open(Some(seed)).await?;
            KeyState::UnlockedByEnv
        } else {
            backend.open(None).await?;
            KeyState::Locked
        };
        let t = Arc::new(Treasury {
            cfg,
            db,
            seed_file,
            backend,
            state: Mutex::new(state),
            timer: Mutex::new(None),
            attempts: tokio::sync::Mutex::new(()),
            ops: tokio::sync::Mutex::new(()),
        });
        t.record_history().await?;
        Ok(t)
    }

    /// Keeps `treasury_keys` in step with the seed file: a deployment from before migration
    /// 0008 gets a version 1 row the first time it starts, and a key whose address was unknown
    /// when it was recorded (uploaded without its passphrase) gets it once the wallet has it.
    async fn record_history(&self) -> anyhow::Result<()> {
        if self.state() == KeyState::NoKey {
            return Ok(());
        }
        let address = self.treasury().await.ok().flatten().map(|(a, _)| a);
        match db::current_treasury_key(&self.db).await? {
            None => {
                let created = self.seed_file.created_at().unwrap_or_else(db::now);
                db::insert_treasury_key(&self.db, &created, address.as_deref()).await?;
            }
            Some(k) if k.retired_at.is_none() && k.address.is_none() => {
                if let Some(a) = address {
                    db::set_treasury_key_address(&self.db, k.version, &a).await?;
                }
            }
            Some(_) => {}
        }
        Ok(())
    }

    pub fn state(&self) -> KeyState {
        self.state.lock().map(|s| s.clone()).unwrap_or(KeyState::Locked)
    }

    fn set_state(&self, state: KeyState) {
        if let Ok(mut s) = self.state.lock() {
            *s = state;
        }
    }

    pub fn can_sign(&self) -> bool {
        self.state().can_sign()
    }

    pub fn seed_path(&self) -> PathBuf {
        self.seed_file.path().to_path_buf()
    }

    /// The wallet, for handlers that read or sync; 409 `no_treasury_key` before a key exists.
    pub fn payer(&self) -> ApiResult<Payer> {
        self.backend.payer().ok_or_else(no_key_error)
    }

    pub fn payer_opt(&self) -> Option<Payer> {
        self.backend.payer()
    }

    /// The wallet's figures, or the error that says why there are none yet.
    pub async fn wallet_info(&self) -> ApiResult<WalletInfo> {
        self.require_key()?;
        self.backend
            .wallet_info()
            .await?
            .ok_or_else(|| locked_error("show the treasury: its account is created on the first unlock"))
    }

    /// The treasury's address and birthday; None before a key or before its account exists.
    async fn treasury(&self) -> anyhow::Result<Option<(String, u32)>> {
        if self.state() == KeyState::NoKey {
            return Ok(None);
        }
        Ok(self
            .backend
            .wallet_info()
            .await?
            .map(|i| (i.treasury.unified_address, i.birthday_height)))
    }

    /// The treasury's (spendable, pending) zatoshis.
    async fn treasury_balance(&self) -> anyhow::Result<(u64, u64)> {
        Ok(self
            .backend
            .wallet_info()
            .await?
            .map(|i| (i.treasury.spendable_zat, i.treasury.pending_zat))
            .unwrap_or((0, 0)))
    }

    /// Syncs the wallet to the chain tip; works locked (scanning needs viewing keys only).
    pub async fn sync(&self) -> ApiResult<()> {
        self.require_key()?;
        Ok(self.backend.sync().await?)
    }

    /// Creates ZIP-32 account `index` for a contractor; needs the seed in memory.
    pub async fn ensure_account(&self, index: u32, name: String) -> ApiResult<(String, u32)> {
        self.require_unlocked("add a contractor: their account and viewing key are derived from the treasury seed")?;
        Ok(self.backend.ensure_account(index, name).await?)
    }

    /// 409 `no_treasury_key` before a key exists.
    pub fn require_key(&self) -> ApiResult<()> {
        if self.state() == KeyState::NoKey {
            return Err(no_key_error());
        }
        Ok(())
    }

    /// 409 `no_treasury_key` or `treasury_locked` unless the treasury can sign; `what` says
    /// what the caller wanted, in the error's message.
    pub fn require_unlocked(&self, what: &str) -> ApiResult<()> {
        match self.state() {
            KeyState::NoKey => Err(no_key_error()),
            KeyState::Locked => Err(locked_error(what)),
            _ => Ok(()),
        }
    }

    pub async fn key_view(&self) -> ApiResult<KeyView> {
        let state = self.state();
        let treasury = match state {
            KeyState::NoKey => None,
            _ => self.treasury().await?,
        };
        let row = db::current_treasury_key(&self.db).await?;
        let created_at = match (&state, &row) {
            (KeyState::NoKey, _) => None,
            (_, Some(k)) if k.retired_at.is_none() => Some(k.created_at.clone()),
            _ => self.seed_file.created_at(),
        };
        Ok(KeyView {
            state: state.as_str(),
            unlocked_until: match state {
                KeyState::Unlocked { until } => until.format(&Rfc3339).ok(),
                _ => None,
            },
            address: treasury.as_ref().map(|(a, _)| a.clone()),
            birthday_height: treasury.map(|(_, b)| b),
            storage: Storage {
                path: self.seed_file.path().display().to_string(),
                format: seed::FORMAT,
            },
            created_at,
            key_version: match (&state, row) {
                (KeyState::NoKey, _) => 0,
                (_, Some(k)) => k.version,
                (_, None) => 0,
            },
        })
    }

    /// Decrypts the seed file with `passphrase` off the async threads; a wrong passphrase is
    /// answered after a pause, with attempts taken one at a time.
    async fn decrypt_seed(&self, ciphertext: Vec<u8>, passphrase: String) -> ApiResult<SecretVec<u8>> {
        let _one_at_a_time = self.attempts.lock().await;
        let decrypted = tokio::task::spawn_blocking(move || {
            seed::decrypt_phrase(&ciphertext, &passphrase).and_then(|p| {
                use secrecy::ExposeSecret as _;
                seed::seed_from_phrase(p.expose_secret())
            })
        })
        .await
        .map_err(|e| ApiError::internal(format!("decrypting the seed: {e}")))?;
        match decrypted {
            Ok(seed) => Ok(seed),
            Err(e) if e.downcast_ref::<WrongPassphrase>().is_some() => {
                tracing::warn!("treasury: a wrong passphrase was tried");
                tokio::time::sleep(WRONG_PASSPHRASE_DELAY).await;
                Err(wrong_passphrase_error())
            }
            Err(e) => Err(ApiError::bad_request(
                "invalid_ciphertext",
                format!("{e:#}"),
                "Upload an armored age file that holds the 24-word phrase encrypted with the passphrase.",
            )),
        }
    }

    /// `POST /api/treasury/unlock`: puts the seed in memory for `hours` (1 to 72).
    pub async fn unlock(self: &Arc<Self>, passphrase: &str, hours: u32) -> ApiResult<KeyView> {
        if hours == 0 || hours > MAX_UNLOCK_HOURS {
            return Err(ApiError::bad_request(
                "invalid_hours",
                format!("The unlock must last between 1 and {MAX_UNLOCK_HOURS} hours."),
                format!(
                    "Leave hours out for {DEFAULT_UNLOCK_HOURS}, or send a whole number from 1 to {MAX_UNLOCK_HOURS}."
                ),
            ));
        }
        self.unlock_for(passphrase, Duration::from_secs(u64::from(hours) * 3600))
            .await
    }

    /// [`Treasury::unlock`] for any length of time (tests use seconds).
    pub async fn unlock_for(self: &Arc<Self>, passphrase: &str, duration: Duration) -> ApiResult<KeyView> {
        match self.state() {
            KeyState::NoKey => return Err(no_key_error()),
            KeyState::UnlockedByEnv => return Err(env_error("unlock")),
            _ => {}
        }
        let ciphertext = std::fs::read(self.seed_file.path())
            .map_err(|e| ApiError::internal(format!("reading {}: {e}", self.seed_file.path().display())))?;
        let seed = self.decrypt_seed(ciphertext, passphrase.to_string()).await?;
        self.install(seed, duration).await?;
        self.key_view().await
    }

    /// Puts a seed the passphrase just decrypted into the wallet and starts the lock timer.
    async fn install(self: &Arc<Self>, seed: SecretVec<u8>, duration: Duration) -> ApiResult<()> {
        self.backend.install_seed(seed).await.map_err(|e| {
            if e.downcast_ref::<SeedMismatch>().is_some() {
                ApiError::conflict(
                    "seed_mismatch",
                    "The passphrase decrypted a seed that is not the one this wallet's accounts came from.",
                    "The seed file was replaced by hand. Restore the original file, or retire the wallet database next to it so the service can create a wallet for this seed.",
                )
            } else {
                ApiError::from(e)
            }
        })?;
        let until = until_after(duration);
        self.set_state(KeyState::Unlocked { until });
        self.arm_timer(duration, until);
        tracing::info!("treasury unlocked until {}", until.format(&Rfc3339).unwrap_or_default());
        self.record_history().await?;
        Ok(())
    }

    fn arm_timer(self: &Arc<Self>, duration: Duration, until: OffsetDateTime) {
        let weak: Weak<Treasury> = Arc::downgrade(self);
        let task = tokio::spawn(async move {
            tokio::time::sleep(duration).await;
            if let Some(t) = weak.upgrade() {
                // Only the unlock this timer belongs to; a newer one armed its own.
                if t.state() == (KeyState::Unlocked { until }) {
                    if let Err(e) = t.lock_now().await {
                        tracing::error!("treasury: the unlock ran out but the seed could not be dropped: {e:#}");
                    } else {
                        tracing::info!("treasury locked again: the unlock ran out");
                    }
                }
            }
        });
        if let Ok(mut timer) = self.timer.lock() {
            if let Some(old) = timer.replace(task) {
                old.abort();
            }
        }
    }

    async fn lock_now(&self) -> anyhow::Result<()> {
        self.backend.drop_seed().await?;
        self.set_state(KeyState::Locked);
        Ok(())
    }

    /// `POST /api/treasury/lock`: drops the seed from memory now.
    pub async fn lock(&self) -> ApiResult<KeyView> {
        match self.state() {
            KeyState::NoKey => return Err(no_key_error()),
            KeyState::UnlockedByEnv => return Err(env_error("lock")),
            KeyState::Locked => {}
            KeyState::Unlocked { .. } => {
                self.lock_now().await?;
                if let Ok(mut timer) = self.timer.lock() {
                    if let Some(t) = timer.take() {
                        t.abort();
                    }
                }
                tracing::info!("treasury locked by an admin");
            }
        }
        self.key_view().await
    }

    /// `POST /api/treasury/key`: stores an uploaded ciphertext as the seed file and opens the
    /// wallet. With the passphrase the file is verified and the treasury unlocked at once;
    /// without it the wallet opens locked and the first unlock creates the treasury account.
    pub async fn create_key(self: &Arc<Self>, ciphertext: &str, passphrase: Option<&str>) -> ApiResult<KeyView> {
        let _one_at_a_time = self.ops.lock().await;
        if self.state() != KeyState::NoKey || self.seed_file.exists() {
            return Err(key_exists_error());
        }
        seed::validate_ciphertext(ciphertext).map_err(invalid_ciphertext)?;
        let passphrase = match (&self.cfg.seed_passphrase, passphrase) {
            // With the passphrase in the environment the key must open with it, or the next
            // start would fail.
            (Some(env), Some(p)) if env == p => Some(p),
            (Some(_), _) => {
                return Err(ApiError::conflict(
                    "passphrase_mismatch",
                    "This server reads the treasury passphrase from PAYSLIP_SEED_PASSPHRASE, and the key must be encrypted with that same passphrase.",
                    "Encrypt the 24 words with the passphrase set on the server and send it in the request, or remove PAYSLIP_SEED_PASSPHRASE and restart to manage the key from here.",
                ))
            }
            (None, p) => p,
        };
        let seed = match passphrase {
            Some(p) => Some(self.decrypt_seed(ciphertext.as_bytes().to_vec(), p.to_string()).await?),
            None => None,
        };
        self.seed_file.write_ciphertext(ciphertext).map_err(|e| {
            if e.to_string().contains("already exists") {
                key_exists_error()
            } else {
                ApiError::from(e)
            }
        })?;
        match seed {
            Some(seed) => {
                if let Err(e) = self.backend.open_fresh(seed, self.cfg.birthday_height).await {
                    // Leave no half-made key behind: the upload can be tried again.
                    let _ = std::fs::remove_file(self.seed_file.path());
                    return Err(ApiError::from(e));
                }
                if self.cfg.seed_passphrase.is_some() {
                    self.set_state(KeyState::UnlockedByEnv);
                } else {
                    let duration = Duration::from_secs(u64::from(DEFAULT_UNLOCK_HOURS) * 3600);
                    let until = until_after(duration);
                    self.set_state(KeyState::Unlocked { until });
                    self.arm_timer(duration, until);
                }
            }
            None => {
                if let Err(e) = self.backend.open(None).await {
                    let _ = std::fs::remove_file(self.seed_file.path());
                    return Err(ApiError::from(e));
                }
                self.set_state(KeyState::Locked);
            }
        }
        let address = self.treasury().await.ok().flatten().map(|(a, _)| a);
        db::insert_treasury_key(&self.db, &db::now(), address.as_deref()).await?;
        tracing::info!("treasury key created ({})", self.state().as_str());
        self.key_view().await
    }

    /// `POST /api/treasury/key/replace`: a new seed takes over. The old treasury's spendable
    /// balance is swept to the new treasury address (skipped below the fee), the old seed file
    /// and wallet are retired, the new wallet is opened and every contractor's account derived
    /// again from the new seed.
    pub async fn replace_key(self: &Arc<Self>, ciphertext: &str, passphrase: &str) -> ApiResult<ReplaceView> {
        let _one_at_a_time = self.ops.lock().await;
        match self.state() {
            KeyState::NoKey => {
                return Err(ApiError::conflict(
                    "no_treasury_key",
                    "There is no treasury key to replace.",
                    "Create one with POST /api/treasury/key.",
                ))
            }
            KeyState::UnlockedByEnv => return Err(env_error("replace")),
            _ => {}
        }
        seed::validate_ciphertext(ciphertext).map_err(invalid_ciphertext)?;
        let new_seed = self
            .decrypt_seed(ciphertext.as_bytes().to_vec(), passphrase.to_string())
            .await?;
        let params = self.cfg.network.params();
        let new_address = {
            use secrecy08::ExposeSecret as _;
            payer::treasury_address_of_seed(&params, new_seed.expose_secret())?
        };
        let running = db::runs_in_progress(&self.db).await?;
        if !running.is_empty() {
            return Err(runs_in_progress_error(&running));
        }
        let old = self.treasury().await?;
        if old.as_ref().is_some_and(|(a, _)| *a == new_address) {
            return Err(ApiError::conflict(
                "same_key",
                "The uploaded file holds the key this treasury already uses.",
                "Upload a file made from a different 24-word phrase.",
            ));
        }
        // What the old treasury holds, after a sync so the figure is current.
        let mut sweep_txid = None;
        if old.is_some() {
            self.backend.sync().await?;
            let (spendable, pending) = self.treasury_balance().await?;
            if pending > 0 {
                return Err(ApiError::conflict(
                    "treasury_pending",
                    format!(
                        "{} ZEC is still confirming in the treasury.",
                        crate::money::format_zec(pending)
                    ),
                    "Wait for it to confirm (a few minutes), then replace the key, so nothing is left behind.",
                ));
            }
            if spendable > 0 {
                self.require_unlocked("move the old treasury's balance to the new key")?;
                match self.backend.sweep_treasury(&new_address).await? {
                    Ok(txid) => {
                        tracing::info!("treasury swept to the new key in {txid}");
                        sweep_txid = Some(txid);
                    }
                    Err(SpendError::InsufficientFunds { .. }) => {
                        tracing::info!("treasury balance below the fee; nothing swept");
                    }
                    Err(e) => return Err(ApiError::internal(format!("sweeping the old treasury: {e}"))),
                }
            }
        }
        // From here on the old key is being retired; a failure leaves the retired files in
        // place with their names in the error, so the operator can put them back.
        let stamp = stamp_now();
        let mut retired: Vec<String> = vec![];
        let outcome: anyhow::Result<usize> = async {
            for p in self.backend.close_and_retire(&stamp).await? {
                retired.push(p.display().to_string());
            }
            let seed_retired = self.seed_file.retire(&stamp)?;
            retired.push(seed_retired.display().to_string());
            self.seed_file.write_ciphertext(ciphertext)?;
            self.backend.open_fresh(new_seed, None).await?;
            let now = db::now();
            let mut rotated = 0;
            for c in db::all_contractors(&self.db).await? {
                let (ufvk, birthday) = self
                    .backend
                    .ensure_account(c.account_index as u32, c.name.clone())
                    .await?;
                let fingerprint = zcash_keys::keys::UnifiedFullViewingKey::decode(&params, &ufvk)
                    .ok()
                    .map(|k| crate::viewer::fingerprint_of(&params, &k));
                db::rotate_contractor_key(&self.db, &c.id, birthday, fingerprint.as_deref(), &now).await?;
                rotated += 1;
            }
            Ok(rotated)
        }
        .await;
        let rotated = match outcome {
            Ok(n) => n,
            Err(e) => {
                tracing::error!("treasury key replacement failed after retiring files {retired:?}: {e:#}");
                self.set_state(KeyState::NoKey);
                return Err(ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "replace_incomplete",
                    format!("The key could not be replaced: {e:#}"),
                    format!(
                        "The old key was retired as {} in the data folder. Put the retired files back under their original names and restart the service, then try again.",
                        retired.join(", ")
                    ),
                ));
            }
        };
        let now = db::now();
        if let Some(k) = db::current_treasury_key(&self.db).await? {
            db::retire_treasury_key(&self.db, k.version, &now).await?;
        }
        db::insert_treasury_key(&self.db, &now, Some(&new_address)).await?;
        let duration = Duration::from_secs(u64::from(DEFAULT_UNLOCK_HOURS) * 3600);
        let until = until_after(duration);
        self.set_state(KeyState::Unlocked { until });
        self.arm_timer(duration, until);
        tracing::info!("treasury key replaced; {rotated} contractor accounts derived again");
        Ok(ReplaceView {
            key: self.key_view().await?,
            old_address: old.map(|(a, _)| a),
            sweep_explorer_url: sweep_txid.as_ref().map(|t| self.cfg.network.explorer_tx_url(t)),
            sweep_txid,
            new_address,
            retired,
            contractors_rotated: rotated,
        })
    }

    /// `POST /api/treasury/move`: sweeps the treasury to an outside shielded address.
    pub async fn move_funds(&self, to: &str) -> ApiResult<MoveView> {
        let _one_at_a_time = self.ops.lock().await;
        let params = self.cfg.network.params();
        let to = to.trim();
        if crate::wallet::parse_shielded_address(&params, to).is_err() {
            use std::str::FromStr as _;
            let parses = zcash_address::ZcashAddress::from_str(to).is_ok();
            return Err(if parses {
                ApiError::bad_request(
                    "address_not_shielded",
                    "That address has no shielded receiver, so the treasury would leave the shielded pool in public.",
                    "Send the treasury to a unified address with an Orchard or Sapling receiver (any recent Zashi, Zodl or Ledger address).",
                )
            } else {
                ApiError::bad_request(
                    "invalid_address",
                    format!("That is not a {} Zcash address.", self.cfg.network.as_str()),
                    "Paste the receiving address from the wallet the treasury should move to.",
                )
            });
        }
        self.require_unlocked("move the treasury")?;
        let running = db::runs_in_progress(&self.db).await?;
        if !running.is_empty() {
            return Err(runs_in_progress_error(&running));
        }
        self.backend.sync().await?;
        let (spendable, pending) = self.treasury_balance().await?;
        if pending > 0 {
            return Err(ApiError::conflict(
                "treasury_pending",
                format!(
                    "{} ZEC is still confirming in the treasury.",
                    crate::money::format_zec(pending)
                ),
                "Wait for it to confirm (a few minutes), then move the treasury, so nothing is left behind.",
            ));
        }
        let empty = || {
            ApiError::conflict(
                "treasury_empty",
                format!(
                    "The treasury holds {} ZEC spendable, not enough to pay the network fee.",
                    crate::money::format_zec(spendable)
                ),
                "There is nothing to move.",
            )
        };
        if spendable == 0 {
            return Err(empty());
        }
        let txid = match self.backend.sweep_treasury(to).await? {
            Ok(t) => t,
            Err(SpendError::InsufficientFunds { .. }) => return Err(empty()),
            Err(e) => return Err(ApiError::internal(format!("sweeping the treasury: {e}"))),
        };
        let fee = self.backend.tx_fee(&txid).await.ok().flatten();
        tracing::info!("treasury moved out in {txid}");
        Ok(MoveView {
            explorer_url: self.cfg.network.explorer_tx_url(&txid),
            txid,
            to_address: to.to_string(),
            amount_zat: fee.map(|f| spendable.saturating_sub(f)),
            fee_zat: fee,
        })
    }

    /// Audit details for the key endpoints: never the passphrase or the ciphertext.
    pub fn audit_details(&self, view: &KeyView) -> Value {
        json!({
            "state": view.state,
            "unlocked_until": view.unlocked_until,
            "key_version": view.key_version,
            "address": view.address,
        })
    }
}

/// The executor's chain operations go through the current wallet, so a replaced key is used
/// from the next step on, and `can_sign` follows the lock state.
#[async_trait]
impl ChainOps for Treasury {
    async fn can_sign(&self) -> bool {
        self.can_sign()
    }
    async fn sync(&self) -> anyhow::Result<()> {
        self.chain()?.sync().await
    }
    async fn tip(&self) -> anyhow::Result<u32> {
        self.chain()?.tip().await
    }
    async fn spendable(&self, account: u32) -> anyhow::Result<u64> {
        self.chain()?.spendable(account).await
    }
    async fn total(&self, account: u32) -> anyhow::Result<u64> {
        self.chain()?.total(account).await
    }
    async fn account_address(&self, account: u32) -> anyhow::Result<String> {
        self.chain()?.account_address(account).await
    }
    async fn transparent_address(&self, account: u32) -> anyhow::Result<String> {
        self.chain()?.transparent_address(account).await
    }
    async fn create_transfer(
        &self,
        from: u32,
        pays: Vec<Pay>,
        change_memo: Option<String>,
    ) -> anyhow::Result<Result<String, SpendError>> {
        self.chain()?.create_transfer(from, pays, change_memo).await
    }
    async fn broadcast(&self, txid: &str) -> anyhow::Result<()> {
        self.chain()?.broadcast(txid).await
    }
    async fn mined_height(&self, txid: &str) -> anyhow::Result<Option<u32>> {
        self.chain()?.mined_height(txid).await
    }
    async fn expiry_height(&self, txid: &str) -> anyhow::Result<Option<u32>> {
        self.chain()?.expiry_height(txid).await
    }
    async fn tx_fee(&self, txid: &str) -> anyhow::Result<Option<u64>> {
        self.chain()?.tx_fee(txid).await
    }
    async fn received_in_tx(&self, txid: &str, account: u32) -> anyhow::Result<u64> {
        self.chain()?.received_in_tx(txid, account).await
    }
    async fn block_time(&self, height: u32) -> anyhow::Result<i64> {
        self.chain()?.block_time(height).await
    }
}

impl Treasury {
    fn chain(&self) -> anyhow::Result<Arc<dyn ChainOps>> {
        self.backend
            .chain()
            .ok_or_else(|| anyhow!("no treasury key: create one under Settings, Treasury key"))
    }
}

// ---------------------------------------------------------------------------------------------
// Errors

pub fn no_key_error() -> ApiError {
    ApiError::conflict(
        "no_treasury_key",
        "This Payslip has no treasury key yet.",
        "An admin creates one under Settings, Treasury key: write down 24 words, choose a passphrase, and upload the encrypted key (POST /api/treasury/key).",
    )
}

/// 409 `treasury_locked`: `what` is what the caller wanted, in plain words.
pub fn locked_error(what: &str) -> ApiError {
    ApiError::conflict(
        "treasury_locked",
        format!("The treasury is locked, so Payslip cannot {what}."),
        "An admin unlocks it under Settings, Treasury key with the company's passphrase (POST /api/treasury/unlock); it locks again after the hours chosen.",
    )
}

fn env_error(what: &str) -> ApiError {
    ApiError::conflict(
        "unlocked_by_env",
        format!("This server unlocks the treasury from PAYSLIP_SEED_PASSPHRASE at start, so there is nothing to {what} here."),
        "To manage the key from the console, remove PAYSLIP_SEED_PASSPHRASE from the service's environment and restart it; the treasury then starts locked.",
    )
}

pub fn wrong_passphrase_error() -> ApiError {
    ApiError::new(
        StatusCode::FORBIDDEN,
        "wrong_passphrase",
        "The passphrase does not decrypt the treasury key.",
        "Type the passphrase chosen when the key was created. If it is lost, the key cannot be opened on this server; replace it from the 24-word phrase (Settings, Treasury key, Replace).",
    )
}

fn key_exists_error() -> ApiError {
    ApiError::conflict(
        "key_exists",
        "This Payslip already has a treasury key.",
        "To change it, use Replace key (POST /api/treasury/key/replace), which sweeps the balance to the new key and keeps the old one on file.",
    )
}

fn invalid_ciphertext(e: anyhow::Error) -> ApiError {
    ApiError::bad_request(
        "invalid_ciphertext",
        format!("The uploaded key could not be read: {e}."),
        "Upload the armored age file the console produced: the 24 words encrypted with the passphrase, beginning with -----BEGIN AGE ENCRYPTED FILE-----.",
    )
}

fn runs_in_progress_error(runs: &[db::RunRow]) -> ApiError {
    let listed = runs
        .iter()
        .map(|r| format!("{} ({})", r.id, r.status))
        .collect::<Vec<_>>()
        .join(", ");
    ApiError::conflict(
        "runs_in_progress",
        format!(
            "{} run{} in progress: {listed}.",
            runs.len(),
            if runs.len() == 1 { " is" } else { "s are" }
        ),
        "Let the run finish (or cancel it if it received no money), then try again. The treasury is not moved while payroll is being paid.",
    )
    .with_runs(runs.iter().map(|r| r.id.clone()).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn states_say_whether_they_sign() {
        assert!(KeyState::UnlockedByEnv.can_sign());
        assert!(KeyState::Unlocked {
            until: OffsetDateTime::now_utc()
        }
        .can_sign());
        assert!(!KeyState::Locked.can_sign());
        assert!(!KeyState::NoKey.can_sign());
        assert_eq!(KeyState::NoKey.as_str(), "no_key");
        assert_eq!(KeyState::Locked.as_str(), "locked");
    }

    #[test]
    fn stamps_are_file_name_safe() {
        let s = stamp_now();
        assert_eq!(s.len(), 16, "{s}");
        assert!(s.chars().all(|c| c.is_ascii_alphanumeric()), "{s}");
    }
}
