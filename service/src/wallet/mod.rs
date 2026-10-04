//! Wallet core on `zcash_client_backend` + `zcash_client_sqlite` (ADR-002, ADR-013).
//!
//! A [`WalletHandle`] owns one SQLite wallet on a dedicated thread (the database connection
//! is not `Sync`, and scanning and proving are CPU-bound). Every operation is a job sent to
//! that thread, so wallet state is only ever touched by one operation at a time.
//!
//! The same core serves two roles:
//! - the payer wallet (`wallet.db`): one seed, account 0 is the treasury, account i >= 1 pays
//!   contractor i only (ADR-006);
//! - view-only wallets for statements: the UFVKs a contractor or accountant supplied, and no
//!   seed.

pub mod cache;
pub mod lwd;

use std::{
    collections::{BTreeMap, BTreeSet},
    future::Future,
    panic::AssertUnwindSafe,
    path::Path,
    pin::Pin,
    str::FromStr,
};

use anyhow::{anyhow, bail, Context};
use futures_util::FutureExt;
use rand::{rand_core::UnwrapErr, rngs::SysRng};
use secrecy08::{ExposeSecret, SecretVec};
use zcash_address::ZcashAddress;
use zcash_client_backend::{
    data_api::{
        wallet::{
            create_proposed_transactions, decrypt_and_store_transaction,
            input_selection::{GreedyInputSelector, SpendPolicy},
            propose_transfer, ConfirmationsPolicy, SpendingKeys,
        },
        Account, AccountBirthday, AccountPurpose, TransactionDataRequest, TransactionStatus, WalletRead, WalletWrite,
    },
    fees::{zip317, DustOutputPolicy, StandardFeeRule},
    wallet::OvkPolicy,
};
use zcash_client_sqlite::{util::SystemClock, wallet::init::init_wallet_db, AccountUuid, WalletDb};
use zcash_keys::keys::{UnifiedAddressRequest, UnifiedFullViewingKey, UnifiedSpendingKey};
use zcash_primitives::transaction::TxId;
use zcash_proofs::prover::LocalTxProver;
use zcash_protocol::{
    consensus::{BlockHeight, Network},
    memo::MemoBytes,
    value::Zatoshis,
    ShieldedPool,
};
use zip321::{Payment, TransactionRequest};

pub use cache::MemoryBlockCache;

pub type Rng = UnwrapErr<SysRng>;
pub type Db = WalletDb<rusqlite::Connection, Network, SystemClock, Rng>;

const SCAN_BATCH: u32 = 1000;

/// Balances of one account, in zatoshis.
#[derive(Clone, Copy, Debug, Default, serde::Serialize)]
pub struct AccountBalances {
    pub spendable_zat: u64,
    pub pending_zat: u64,
    pub total_zat: u64,
}

#[derive(Clone, Debug)]
pub struct PaymentSpec {
    pub to: ZcashAddress,
    pub amount: Zatoshis,
    pub memo: Option<MemoBytes>,
}

#[derive(Clone, Copy, Debug, serde::Serialize)]
pub struct SyncReport {
    pub chain_tip: u32,
    pub fully_scanned: u32,
}

/// Errors that a caller handles specifically; everything else is `Other`.
#[derive(Debug, thiserror::Error)]
pub enum SpendError {
    #[error("insufficient spendable funds: {available} zat available, {required} zat required")]
    InsufficientFunds { available: u64, required: u64 },
    #[error("the wallet must sync before it can spend")]
    SyncRequired,
    #[error("{0}")]
    Other(String),
}

pub struct WalletCore {
    params: Network,
    db: Db,
    client: lwd::Client,
    seed: Option<SecretVec<u8>>,
    conf: ConfirmationsPolicy,
    prover: Option<LocalTxProver>,
}

impl WalletCore {
    /// Opens (creating if needed) a wallet database. Must be called inside a Tokio runtime.
    pub fn open(
        params: Network,
        path: &Path,
        lightwalletd_url: &str,
        seed: Option<SecretVec<u8>>,
        min_confirmations: u32,
    ) -> anyhow::Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let mut db = WalletDb::for_path(path, params, SystemClock, UnwrapErr(SysRng))
            .with_context(|| format!("opening wallet database {}", path.display()))?;
        init_wallet_db(
            &mut db,
            seed.as_ref().map(|s| SecretVec::new(s.expose_secret().clone())),
        )
        .map_err(|e| anyhow!("initialising wallet database {}: {e}", path.display()))?;
        let n = std::num::NonZeroU32::new(min_confirmations.max(1)).expect("nonzero");
        Ok(WalletCore {
            params,
            db,
            client: lwd::connect(lightwalletd_url)?,
            seed,
            conf: ConfirmationsPolicy::new_symmetrical(n, true),
            prover: None,
        })
    }

    pub fn params(&self) -> &Network {
        &self.params
    }

    pub fn client(&mut self) -> &mut lwd::Client {
        &mut self.client
    }

    pub fn db(&self) -> &Db {
        &self.db
    }

    pub async fn chain_tip(&mut self) -> anyhow::Result<BlockHeight> {
        lwd::tip(&mut self.client).await
    }

    /// The account birthday for an account first used at `height`: the chain state at
    /// `height - 1`.
    pub async fn birthday_at(&mut self, height: BlockHeight) -> anyhow::Result<AccountBirthday> {
        let ts = lwd::tree_state(&mut self.client, height - 1).await?;
        AccountBirthday::from_treestate(ts, None).map_err(|e| anyhow!("invalid tree state at {height}: {e:?}"))
    }

    /// All accounts, keyed by their ZIP-32 index for HD accounts.
    pub fn hd_accounts(&self) -> anyhow::Result<BTreeMap<u32, AccountUuid>> {
        let mut out = BTreeMap::new();
        for id in self.db.get_account_ids()? {
            if let Some(acct) = self.db.get_account(id)? {
                if let Some(d) = acct.source().key_derivation() {
                    out.insert(u32::from(d.account_index()), id);
                }
            }
        }
        Ok(out)
    }

    pub fn account_ids(&self) -> anyhow::Result<Vec<AccountUuid>> {
        Ok(self.db.get_account_ids()?)
    }

    /// Creates ZIP-32 account `index` from the seed if it does not exist yet.
    pub async fn ensure_hd_account(
        &mut self,
        index: u32,
        name: &str,
        birthday_height: BlockHeight,
    ) -> anyhow::Result<AccountUuid> {
        if let Some(id) = self.hd_accounts()?.get(&index) {
            return Ok(*id);
        }
        let seed = self.seed.as_ref().ok_or_else(|| anyhow!("this wallet has no seed"))?;
        let seed = SecretVec::new(seed.expose_secret().clone());
        let birthday = self.birthday_at(birthday_height).await?;
        let idx = zip32::AccountId::try_from(index).map_err(|_| anyhow!("invalid account index {index}"))?;
        let (acct, _usk) = self
            .db
            .import_account_hd(name, &seed, idx, &birthday, None)
            .map_err(|e| anyhow!("creating account {index}: {e}"))?;
        Ok(acct.id())
    }

    /// Imports a viewing key as a view-only account if it is not tracked yet.
    pub async fn ensure_ufvk_account(
        &mut self,
        name: &str,
        ufvk: &UnifiedFullViewingKey,
        birthday_height: BlockHeight,
    ) -> anyhow::Result<AccountUuid> {
        if let Some(acct) = self.db.get_account_for_ufvk(ufvk)? {
            return Ok(acct.id());
        }
        let birthday = self.birthday_at(birthday_height).await?;
        let acct = self
            .db
            .import_account_ufvk(name, ufvk, &birthday, AccountPurpose::ViewOnly, None)
            .map_err(|e| anyhow!("importing viewing key: {e}"))?;
        Ok(acct.id())
    }

    pub fn ufvk(&self, account: AccountUuid) -> anyhow::Result<UnifiedFullViewingKey> {
        let acct = self
            .db
            .get_account(account)?
            .ok_or_else(|| anyhow!("unknown account"))?;
        acct.ufvk()
            .cloned()
            .ok_or_else(|| anyhow!("account has no unified full viewing key"))
    }

    pub fn birthday(&self, account: AccountUuid) -> anyhow::Result<BlockHeight> {
        Ok(self.db.get_account_birthday(account)?)
    }

    /// A shielded unified address for the account (Orchard and Sapling receivers). After NU6.3
    /// value sent to the Orchard receiver lands in the Ironwood pool.
    pub fn address(&mut self, account: AccountUuid) -> anyhow::Result<zcash_keys::address::UnifiedAddress> {
        if let Some(ua) = self
            .db
            .get_last_generated_address_matching(account, UnifiedAddressRequest::SHIELDED)?
        {
            return Ok(ua);
        }
        let (ua, _) = self
            .db
            .get_next_available_address(account, UnifiedAddressRequest::SHIELDED)?
            .ok_or_else(|| anyhow!("could not derive an address for the account"))?;
        Ok(ua)
    }

    /// Scans to the chain tip, then fetches full transactions for memos (enhancement).
    pub async fn sync(&mut self) -> anyhow::Result<SyncReport> {
        let cache = MemoryBlockCache::new();
        zcash_client_backend::sync::run(&mut self.client, &self.params, &cache, &mut self.db, SCAN_BATCH)
            .await
            .map_err(|e| anyhow!("sync failed: {e}"))?;
        self.enhance().await?;
        let summary = self.db.get_wallet_summary(self.conf)?;
        let (tip, scanned) = summary
            .map(|s| (u32::from(s.chain_tip_height()), u32::from(s.fully_scanned_height())))
            .unwrap_or((0, 0));
        Ok(SyncReport {
            chain_tip: tip,
            fully_scanned: scanned,
        })
    }

    async fn enhance(&mut self) -> anyhow::Result<()> {
        let Some(tip) = self.db.chain_height()? else {
            return Ok(());
        };
        let mut done = BTreeSet::new();
        loop {
            let mut progressed = false;
            for request in self.db.transaction_data_requests()? {
                if !done.insert(format!("{request:?}")) {
                    continue;
                }
                progressed = true;
                match request {
                    TransactionDataRequest::GetStatus(txid) => {
                        let status = match lwd::fetch_tx(&mut self.client, &self.params, tip, txid).await? {
                            None => TransactionStatus::TxidNotRecognized,
                            Some((_, Some(h))) => TransactionStatus::Mined(h),
                            Some((_, None)) => TransactionStatus::NotInMainChain,
                        };
                        self.db.set_transaction_status(txid, status)?;
                    }
                    TransactionDataRequest::Enhancement(txid) => {
                        match lwd::fetch_tx(&mut self.client, &self.params, tip, txid).await? {
                            None => self
                                .db
                                .set_transaction_status(txid, TransactionStatus::TxidNotRecognized)?,
                            Some((tx, mined)) => {
                                decrypt_and_store_transaction(&self.params, &mut self.db, &tx, mined)
                                    .map_err(|e| anyhow!("storing transaction {txid}: {e}"))?;
                            }
                        }
                    }
                    // Transparent address history is not used by Payslip: every payment is shielded.
                    _ => {}
                }
            }
            if !progressed {
                return Ok(());
            }
        }
    }

    /// (chain tip, fully scanned height) as last recorded by sync; zeros before the first sync.
    pub fn db_summary_heights(&self) -> anyhow::Result<(u32, u32)> {
        Ok(self
            .db
            .get_wallet_summary(self.conf)?
            .map(|s| (u32::from(s.chain_tip_height()), u32::from(s.fully_scanned_height())))
            .unwrap_or((0, 0)))
    }

    pub fn balances(&self) -> anyhow::Result<BTreeMap<AccountUuid, AccountBalances>> {
        let mut out = BTreeMap::new();
        if let Some(summary) = self.db.get_wallet_summary(self.conf)? {
            for (id, b) in summary.account_balances() {
                let spendable = u64::from(b.spendable_value());
                let total = u64::from(b.total());
                out.insert(
                    *id,
                    AccountBalances {
                        spendable_zat: spendable,
                        pending_zat: total.saturating_sub(spendable),
                        total_zat: total,
                    },
                );
            }
        }
        Ok(out)
    }

    /// Builds, proves and stores (but does not broadcast) one transaction from the HD account
    /// `from_index` paying `payments`. Returns the txid.
    pub fn create_transfer(
        &mut self,
        from_index: u32,
        payments: Vec<PaymentSpec>,
        change_memo: Option<MemoBytes>,
    ) -> Result<TxId, SpendError> {
        let other = |e: &dyn std::fmt::Display| SpendError::Other(e.to_string());
        let accounts = self.hd_accounts().map_err(|e| other(&e))?;
        let from = *accounts
            .get(&from_index)
            .ok_or_else(|| SpendError::Other(format!("account {from_index} does not exist")))?;
        let seed = self
            .seed
            .as_ref()
            .ok_or_else(|| SpendError::Other("this wallet has no seed".into()))?;
        let idx =
            zip32::AccountId::try_from(from_index).map_err(|_| SpendError::Other("invalid account index".into()))?;
        let usk = UnifiedSpendingKey::from_seed(&self.params, seed.expose_secret(), idx)
            .map_err(|e| other(&format!("{e:?}")))?;

        let payments = payments
            .into_iter()
            .map(|p| Payment::new(p.to, Some(p.amount), p.memo, None, None, vec![]))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| other(&format!("invalid payment: {e:?}")))?;
        let request = TransactionRequest::new(payments).map_err(|e| other(&format!("invalid request: {e:?}")))?;
        let change_strategy = zip317::SingleOutputChangeStrategy::new(
            StandardFeeRule::Zip317,
            change_memo,
            ShieldedPool::Ironwood,
            DustOutputPolicy::default(),
        );
        let input_selector = GreedyInputSelector::new();
        let proposal = propose_transfer::<_, _, _, _, std::convert::Infallible>(
            &mut self.db,
            &self.params,
            from,
            &input_selector,
            &change_strategy,
            request,
            self.conf,
            &SpendPolicy::default(),
            None,
            None,
        )
        .map_err(|e| match e {
            zcash_client_backend::data_api::error::Error::InsufficientFunds { available, required } => {
                SpendError::InsufficientFunds {
                    available: available.into(),
                    required: required.into(),
                }
            }
            zcash_client_backend::data_api::error::Error::ScanRequired => SpendError::SyncRequired,
            e => SpendError::Other(format!("could not propose the transfer: {e}")),
        })?;

        let params = self.params;
        let prover = self.prover.take().unwrap_or_else(LocalTxProver::bundled);
        let result = create_proposed_transactions::<_, _, std::convert::Infallible, _, std::convert::Infallible, _>(
            &mut self.db,
            &params,
            &SystemClock,
            &mut UnwrapErr(SysRng),
            &prover,
            &prover,
            &SpendingKeys::from_unified_spending_key(usk),
            OvkPolicy::Sender,
            &proposal,
            None,
        );
        self.prover = Some(prover);
        let txids = result.map_err(|e| SpendError::Other(format!("could not build the transaction: {e}")))?;
        if txids.len() != 1 {
            return Err(SpendError::Other(
                "the transfer needs more than one transaction; this is not supported".into(),
            ));
        }
        Ok(*txids.first())
    }

    /// Sends the whole spendable balance of HD account `from_index` (minus the fee) to `to`.
    pub fn sweep(&mut self, from_index: u32, to: ZcashAddress, memo: Option<MemoBytes>) -> Result<TxId, SpendError> {
        use zcash_client_backend::data_api::{
            wallet::{input_selection::LockedInputPolicy, propose_send_max_transfer},
            MaxSpendMode,
        };
        let other = |e: &dyn std::fmt::Display| SpendError::Other(e.to_string());
        let accounts = self.hd_accounts().map_err(|e| other(&e))?;
        let from = *accounts
            .get(&from_index)
            .ok_or_else(|| SpendError::Other(format!("account {from_index} does not exist")))?;
        let seed = self
            .seed
            .as_ref()
            .ok_or_else(|| SpendError::Other("this wallet has no seed".into()))?;
        let idx =
            zip32::AccountId::try_from(from_index).map_err(|_| SpendError::Other("invalid account index".into()))?;
        let usk = UnifiedSpendingKey::from_seed(&self.params, seed.expose_secret(), idx)
            .map_err(|e| other(&format!("{e:?}")))?;
        let proposal = propose_send_max_transfer::<_, _, _, std::convert::Infallible>(
            &mut self.db,
            &self.params,
            from,
            &[ShieldedPool::Ironwood, ShieldedPool::Orchard, ShieldedPool::Sapling],
            &StandardFeeRule::Zip317,
            to,
            memo,
            MaxSpendMode::MaxSpendable,
            self.conf,
            &LockedInputPolicy::Exclude,
            None,
        )
        .map_err(|e| match e {
            zcash_client_backend::data_api::error::Error::InsufficientFunds { available, required } => {
                SpendError::InsufficientFunds {
                    available: available.into(),
                    required: required.into(),
                }
            }
            e => SpendError::Other(format!("could not propose the sweep: {e}")),
        })?;
        let params = self.params;
        let prover = self.prover.take().unwrap_or_else(LocalTxProver::bundled);
        let result = create_proposed_transactions::<_, _, std::convert::Infallible, _, std::convert::Infallible, _>(
            &mut self.db,
            &params,
            &SystemClock,
            &mut UnwrapErr(SysRng),
            &prover,
            &prover,
            &SpendingKeys::from_unified_spending_key(usk),
            OvkPolicy::Sender,
            &proposal,
            None,
        );
        self.prover = Some(prover);
        let txids = result.map_err(|e| SpendError::Other(format!("could not build the sweep: {e}")))?;
        Ok(*txids.first())
    }

    /// Serialized bytes of a transaction the wallet created.
    pub fn raw_tx(&self, txid: TxId) -> anyhow::Result<Vec<u8>> {
        let tx = self
            .db
            .get_transaction(txid)?
            .ok_or_else(|| anyhow!("transaction {txid} is not in the wallet"))?;
        let mut raw = vec![];
        tx.write(&mut raw)?;
        Ok(raw)
    }

    pub async fn broadcast(&mut self, txid: TxId) -> anyhow::Result<()> {
        let raw = self.raw_tx(txid)?;
        match lwd::broadcast(&mut self.client, raw).await? {
            Ok(()) => Ok(()),
            Err(e) if e.is_duplicate() => Ok(()),
            Err(e) => Err(e.into()),
        }
    }

    /// Mined height from lightwalletd (authoritative, independent of local scan progress).
    pub async fn mined_height(&mut self, txid: TxId) -> anyhow::Result<Option<BlockHeight>> {
        lwd::mined_height(&mut self.client, txid).await
    }

    /// The expiry height of a transaction the wallet created.
    pub fn expiry_height(&self, txid: TxId) -> anyhow::Result<Option<BlockHeight>> {
        Ok(self.db.get_transaction(txid)?.map(|tx| tx.expiry_height()))
    }
}

/// Parses a txid in display (explorer) order.
pub fn parse_txid(hex_str: &str) -> anyhow::Result<TxId> {
    let mut bytes: [u8; 32] = hex::decode(hex_str)
        .context("txid is not hex")?
        .try_into()
        .map_err(|_| anyhow!("txid must be 32 bytes"))?;
    bytes.reverse();
    Ok(TxId::from_bytes(bytes))
}

pub fn txid_hex(txid: &TxId) -> String {
    txid.to_string()
}

/// Parses a recipient for this network. Transparent recipients (a swap venue's deposit
/// address) are allowed only when the payment carries no memo.
pub fn parse_recipient(params: &Network, s: &str, allow_transparent: bool) -> anyhow::Result<ZcashAddress> {
    if !allow_transparent {
        return parse_shielded_address(params, s);
    }
    let addr = ZcashAddress::from_str(s.trim()).map_err(|e| anyhow!("not a Zcash address: {e}"))?;
    if zcash_keys::address::Address::decode(params, s.trim()).is_none() {
        bail!("address is not valid for this network");
    }
    Ok(addr)
}

/// Parses an address and checks it is for this network and can receive a shielded memo.
pub fn parse_shielded_address(params: &Network, s: &str) -> anyhow::Result<ZcashAddress> {
    use zcash_protocol::consensus::Parameters;
    let addr = ZcashAddress::from_str(s.trim()).map_err(|e| anyhow!("not a Zcash address: {e}"))?;
    if !addr.can_receive_as(zcash_protocol::PoolType::Shielded(ShieldedPool::Orchard))
        && !addr.can_receive_as(zcash_protocol::PoolType::Shielded(ShieldedPool::Sapling))
    {
        bail!("address has no shielded receiver");
    }
    let net = params.network_type();
    let decoded = zcash_keys::address::Address::decode(params, s.trim());
    if decoded.is_none() {
        bail!("address is not valid for {net:?}");
    }
    Ok(addr)
}

type Job = Box<dyn for<'a> FnOnce(&'a mut WalletCore) -> Pin<Box<dyn Future<Output = ()> + 'a>> + Send>;

/// Handle to a wallet running on its own thread.
#[derive(Clone)]
pub struct WalletHandle {
    tx: std::sync::mpsc::Sender<Job>,
}

impl WalletHandle {
    /// Spawns the wallet thread. `init` runs on that thread inside its runtime.
    pub fn spawn<F>(name: String, init: F) -> anyhow::Result<Self>
    where
        F: FnOnce() -> anyhow::Result<WalletCore> + Send + 'static,
    {
        let (tx, rx) = std::sync::mpsc::channel::<Job>();
        let (ready_tx, ready_rx) = std::sync::mpsc::channel::<anyhow::Result<()>>();
        std::thread::Builder::new().name(name).spawn(move || {
            let rt = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
                Ok(rt) => rt,
                Err(e) => {
                    let _ = ready_tx.send(Err(e.into()));
                    return;
                }
            };
            let mut core = {
                let _guard = rt.enter();
                match init() {
                    Ok(core) => {
                        let _ = ready_tx.send(Ok(()));
                        core
                    }
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                }
            };
            while let Ok(job) = rx.recv() {
                // A panicking job drops its reply channel, so the caller sees an error; the
                // wallet thread keeps serving. SQLite transactions keep the database consistent.
                let _ = rt.block_on(AssertUnwindSafe(job(&mut core)).catch_unwind());
            }
        })?;
        ready_rx
            .recv()
            .map_err(|_| anyhow!("wallet thread exited during start-up"))??;
        Ok(WalletHandle { tx })
    }

    /// Runs `f` on the wallet thread and returns its result.
    pub async fn run<R, F>(&self, f: F) -> anyhow::Result<R>
    where
        R: Send + 'static,
        F: for<'a> FnOnce(&'a mut WalletCore) -> Pin<Box<dyn Future<Output = R> + 'a>> + Send + 'static,
    {
        let (otx, orx) = tokio::sync::oneshot::channel();
        let job: Job = Box::new(move |core| {
            Box::pin(async move {
                let r = f(core).await;
                let _ = otx.send(r);
            })
        });
        self.tx.send(job).map_err(|_| anyhow!("wallet thread has stopped"))?;
        orx.await
            .map_err(|_| anyhow!("wallet operation panicked; see the service log"))
    }
}
