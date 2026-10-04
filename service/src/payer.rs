//! The payer wallet: one seed, ZIP-32 account 0 is the treasury, account i >= 1 pays
//! contractor i only (ADR-006). The seed is decrypted at start-up and stays in memory.

use std::collections::BTreeMap;

use anyhow::{anyhow, Context};
use serde::Serialize;
use zcash_address::unified::{self, Encoding as _};
use zcash_client_sqlite::AccountUuid;
use zcash_keys::address::UnifiedAddress;
use zcash_primitives::transaction::TxId;
use zcash_protocol::{
    consensus::{BlockHeight, Network, Parameters},
    memo::MemoBytes,
    value::Zatoshis,
};

use crate::{
    config::{Config, ZcashNetwork},
    memo,
    seed::SeedFile,
    wallet::{self, AccountBalances, PaymentSpec, SpendError, SyncReport, WalletCore, WalletHandle},
};

pub const TREASURY_INDEX: u32 = 0;

#[derive(Clone, Debug, Serialize)]
pub struct TreasuryInfo {
    pub account_index: u32,
    pub unified_address: String,
    pub spendable_zat: u64,
    pub pending_zat: u64,
    pub total_zat: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct WalletInfo {
    pub network: &'static str,
    pub chain_tip: u32,
    pub synced_height: u32,
    pub birthday_height: u32,
    pub treasury: TreasuryInfo,
    pub contractor_accounts: usize,
}

#[derive(Clone)]
pub struct Payer {
    wallet: WalletHandle,
    network: ZcashNetwork,
    params: Network,
    db_path: std::path::PathBuf,
}

/// Encodes a unified address as ZIP 316 Revision 0 (`u1...` / `utest1...`), the form every
/// wallet, faucet and swap venue we checked accepts. Shielded receivers only.
pub fn encode_ua_r0(params: &Network, ua: &UnifiedAddress) -> anyhow::Result<String> {
    let mut items = vec![];
    if let Some(o) = ua.orchard() {
        items.push(unified::Uitem::Data(unified::Receiver::Orchard(
            o.to_raw_address_bytes(),
        )));
    }
    if let Some(s) = ua.sapling() {
        items.push(unified::Uitem::Data(unified::Receiver::Sapling(s.to_bytes())));
    }
    let r0 =
        unified::Address::try_from_items(unified::Revision::R0, items).map_err(|e| anyhow!("encoding address: {e}"))?;
    Ok(r0.encode(&params.network_type()))
}

impl Payer {
    /// Unlocks the seed, opens `wallet.db` and makes sure the treasury account exists.
    pub async fn open(cfg: &Config) -> anyhow::Result<Self> {
        let passphrase = cfg
            .seed_passphrase
            .clone()
            .ok_or_else(|| anyhow!("set PAYSLIP_SEED_PASSPHRASE to unlock the payer seed"))?;
        let seed_file = SeedFile::new(cfg.seed_path());
        if !seed_file.exists() {
            anyhow::bail!(
                "no payer seed at {}; run `payslip-service init` first",
                seed_file.path().display()
            );
        }
        let seed = seed_file.unlock(&passphrase)?;
        let params = cfg.network.params();
        let (path, url, min_conf) = (
            cfg.wallet_db_path(),
            cfg.lightwalletd_url.clone(),
            cfg.min_confirmations,
        );
        let wallet = WalletHandle::spawn("payer-wallet".into(), move || {
            WalletCore::open(params, &path, &url, Some(seed), min_conf)
        })?;
        let payer = Payer {
            wallet,
            network: cfg.network,
            params,
            db_path: cfg.wallet_db_path(),
        };
        let configured_birthday = cfg.birthday_height;
        payer
            .wallet
            .run(move |w| {
                Box::pin(async move {
                    if w.hd_accounts()?.contains_key(&TREASURY_INDEX) {
                        return Ok(());
                    }
                    let tip = w.chain_tip().await?;
                    let birthday = configured_birthday.map(BlockHeight::from_u32).unwrap_or(tip - 10);
                    w.ensure_hd_account(TREASURY_INDEX, "Treasury", birthday)
                        .await
                        .map(|_| ())
                })
            })
            .await?
            .context("creating the treasury account")?;
        Ok(payer)
    }

    pub fn network(&self) -> ZcashNetwork {
        self.network
    }

    pub fn params(&self) -> Network {
        self.params
    }

    pub fn handle(&self) -> &WalletHandle {
        &self.wallet
    }

    pub async fn sync(&self) -> anyhow::Result<SyncReport> {
        self.wallet.run(|w| Box::pin(w.sync())).await?
    }

    pub async fn chain_tip(&self) -> anyhow::Result<u32> {
        Ok(u32::from(self.wallet.run(|w| Box::pin(w.chain_tip())).await??))
    }

    /// Height and Unix time of the chain tip, from lightwalletd.
    pub async fn tip_time(&self) -> anyhow::Result<(u32, i64)> {
        self.wallet.run(|w| Box::pin(wallet::lwd::tip_time(w.client()))).await?
    }

    pub async fn wallet_info(&self) -> anyhow::Result<WalletInfo> {
        let network = self.network.as_str();
        self.wallet
            .run(move |w| {
                Box::pin(async move {
                    let accounts = w.hd_accounts()?;
                    let treasury = *accounts
                        .get(&TREASURY_INDEX)
                        .ok_or_else(|| anyhow!("treasury account missing"))?;
                    let ua = w.address(treasury)?;
                    let address = encode_ua_r0(w.params(), &ua)?;
                    let balances = w.balances()?;
                    let b = balances.get(&treasury).copied().unwrap_or_default();
                    let summary = w.db_summary_heights()?;
                    Ok(WalletInfo {
                        network,
                        chain_tip: summary.0,
                        synced_height: summary.1,
                        birthday_height: u32::from(w.birthday(treasury)?),
                        treasury: TreasuryInfo {
                            account_index: TREASURY_INDEX,
                            unified_address: address,
                            spendable_zat: b.spendable_zat,
                            pending_zat: b.pending_zat,
                            total_zat: b.total_zat,
                        },
                        contractor_accounts: accounts.len().saturating_sub(1),
                    })
                })
            })
            .await?
    }

    /// Balances per ZIP-32 account index.
    pub async fn account_balances(&self) -> anyhow::Result<BTreeMap<u32, AccountBalances>> {
        self.wallet
            .run(|w| {
                Box::pin(async move {
                    let accounts = w.hd_accounts()?;
                    let balances = w.balances()?;
                    Ok(accounts
                        .into_iter()
                        .map(|(i, id)| (i, balances.get(&id).copied().unwrap_or_default()))
                        .collect())
                })
            })
            .await?
    }

    /// Creates ZIP-32 account `index` if needed; returns its UFVK and birthday height.
    pub async fn ensure_account(&self, index: u32, name: String) -> anyhow::Result<(String, u32)> {
        self.wallet
            .run(move |w| {
                Box::pin(async move {
                    let tip = w.chain_tip().await?;
                    let id = w.ensure_hd_account(index, &name, tip - 10).await?;
                    let ufvk = w.ufvk(id)?.encode(w.params());
                    Ok((ufvk, u32::from(w.birthday(id)?)))
                })
            })
            .await?
    }

    pub async fn ufvk(&self, index: u32) -> anyhow::Result<String> {
        self.wallet
            .run(move |w| {
                Box::pin(async move {
                    let id = account_id(w, index)?;
                    Ok(w.ufvk(id)?.encode(w.params()))
                })
            })
            .await?
    }

    pub async fn account_birthday(&self, index: u32) -> anyhow::Result<u32> {
        self.wallet
            .run(move |w| Box::pin(async move { Ok(u32::from(w.birthday(account_id(w, index)?)?)) }))
            .await?
    }

    /// Unified address (Revision 0) of account `index`.
    pub async fn address(&self, index: u32) -> anyhow::Result<String> {
        self.wallet
            .run(move |w| {
                Box::pin(async move {
                    let id = account_id(w, index)?;
                    let ua = w.address(id)?;
                    encode_ua_r0(w.params(), &ua)
                })
            })
            .await?
    }

    /// The default external transparent address of account `index`.
    pub async fn transparent_address(&self, index: u32) -> anyhow::Result<String> {
        use zcash_transparent::keys::IncomingViewingKey;
        self.wallet
            .run(move |w| {
                Box::pin(async move {
                    let ufvk = w.ufvk(account_id(w, index)?)?;
                    let tpk = ufvk.p2pkh().ok_or_else(|| anyhow!("account has no transparent key"))?;
                    let (taddr, _) = tpk
                        .derive_external_ivk()
                        .map_err(|e| anyhow!("{e:?}"))?
                        .default_address();
                    Ok(zcash_keys::address::Address::Transparent(taddr).encode(w.params()))
                })
            })
            .await?
    }

    /// Builds and stores one transaction from account `from`; does not broadcast.
    pub async fn create_transfer(
        &self,
        from: u32,
        payments: Vec<PaymentSpec>,
        change_memo: Option<MemoBytes>,
    ) -> anyhow::Result<Result<TxId, SpendError>> {
        self.wallet
            .run(move |w| Box::pin(async move { w.create_transfer(from, payments, change_memo) }))
            .await
    }

    pub async fn broadcast(&self, txid: TxId) -> anyhow::Result<()> {
        self.wallet.run(move |w| Box::pin(w.broadcast(txid))).await?
    }

    pub async fn mined_height(&self, txid: TxId) -> anyhow::Result<Option<u32>> {
        Ok(self
            .wallet
            .run(move |w| Box::pin(w.mined_height(txid)))
            .await??
            .map(u32::from))
    }

    pub async fn expiry_height(&self, txid: TxId) -> anyhow::Result<Option<u32>> {
        Ok(self
            .wallet
            .run(move |w| Box::pin(async move { w.expiry_height(txid) }))
            .await??
            .map(u32::from))
    }

    fn read_conn(&self) -> anyhow::Result<rusqlite::Connection> {
        Ok(rusqlite::Connection::open_with_flags(
            &self.db_path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )?)
    }

    /// The fee the wallet recorded for a transaction it knows, in zatoshis.
    pub async fn tx_fee(&self, txid_hex: &str) -> anyhow::Result<Option<u64>> {
        let txid = wallet::parse_txid(txid_hex)?;
        let conn = self.read_conn()?;
        let fee: Option<Option<i64>> = conn
            .query_row(
                "SELECT fee FROM transactions WHERE txid = ?",
                [txid.as_ref().to_vec()],
                |r| r.get(0),
            )
            .map(Some)
            .or_else(|e| {
                if matches!(e, rusqlite::Error::QueryReturnedNoRows) {
                    Ok(None)
                } else {
                    Err(e)
                }
            })?;
        Ok(fee.flatten().map(|f| f as u64))
    }

    /// Value received by ZIP-32 account `index` in transaction `txid` (not counting change).
    pub async fn received_in_tx(&self, txid_hex: &str, index: u32) -> anyhow::Result<u64> {
        let txid = wallet::parse_txid(txid_hex)?;
        let uuid = self
            .wallet
            .run(move |w| Box::pin(async move { account_id(w, index).map(|a| a.expose_uuid()) }))
            .await??;
        let conn = self.read_conn()?;
        let mut stmt =
            conn.prepare("SELECT o.to_account_uuid, o.value, o.is_change FROM v_tx_outputs o WHERE o.txid = ?")?;
        let mut rows = stmt.query([txid.as_ref().to_vec()])?;
        let mut total = 0u64;
        while let Some(r) = rows.next()? {
            let to: Option<Vec<u8>> = r.get(0)?;
            let is_change: bool = r.get::<_, Option<bool>>(2)?.unwrap_or(false);
            if !is_change && to.as_deref().and_then(|b| uuid::Uuid::from_slice(b).ok()) == Some(uuid) {
                total += r.get::<_, i64>(1)? as u64;
            }
        }
        Ok(total)
    }

    /// Development helper behind the `send` CLI command: one payment, broadcast at once.
    pub async fn send_simple(&self, from: u32, to: &str, zat: u64, memo_text: Option<&str>) -> anyhow::Result<String> {
        let to = wallet::parse_shielded_address(&self.params, to)?;
        let memo = memo_text
            .map(memo::to_memo_bytes)
            .transpose()
            .map_err(|e| anyhow!("{e}"))?;
        let amount = Zatoshis::from_u64(zat).map_err(|_| anyhow!("invalid amount"))?;
        let txid = self
            .create_transfer(from, vec![PaymentSpec { to, amount, memo }], None)
            .await?
            .map_err(|e| anyhow!("{e}"))?;
        self.broadcast(txid).await?;
        Ok(wallet::txid_hex(&txid))
    }
}

fn account_id(w: &WalletCore, index: u32) -> anyhow::Result<AccountUuid> {
    w.hd_accounts()?
        .get(&index)
        .copied()
        .ok_or_else(|| anyhow!("account {index} does not exist"))
}
