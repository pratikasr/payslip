//! Testnet only: a separate development seed that stands in for six contractors' own wallets,
//! so the full flow runs on testnet with no outside input. It is never used on mainnet and
//! never holds payer funds.

use anyhow::{anyhow, bail};
use secrecy08::ExposeSecret;
use zcash_keys::keys::{UnifiedAddressRequest, UnifiedSpendingKey};

use crate::{
    config::{Config, ZcashNetwork},
    payer::encode_ua_r0,
    seed::SeedFile,
};

pub struct DevContractorWallet {
    pub address: String,
    pub ufvk: String,
}

/// Derives `count` contractor wallets (ZIP-32 accounts 0..count of the dev seed), creating the
/// encrypted dev seed on first use.
pub fn contractor_wallets(cfg: &Config, passphrase: &str, count: u32) -> anyhow::Result<Vec<DevContractorWallet>> {
    if cfg.network != ZcashNetwork::Testnet {
        bail!("the dev contractor seed exists only on testnet");
    }
    let file = SeedFile::new(cfg.data_dir.join("dev-contractors.seed.age"));
    if !file.exists() {
        file.create(passphrase)?;
    }
    let seed = file.unlock(passphrase)?;
    let params = cfg.network.params();
    (0..count)
        .map(|i| {
            let idx = zip32::AccountId::try_from(i).map_err(|_| anyhow!("invalid account index"))?;
            let usk = UnifiedSpendingKey::from_seed(&params, seed.expose_secret(), idx).map_err(|e| anyhow!("{e:?}"))?;
            let ufvk = usk.to_unified_full_viewing_key();
            let (ua, _) = ufvk
                .default_address(UnifiedAddressRequest::SHIELDED)
                .map_err(|e| anyhow!("deriving address: {e:?}"))?;
            Ok(DevContractorWallet { address: encode_ua_r0(&params, &ua)?, ufvk: ufvk.encode(&params) })
        })
        .collect()
}

pub async fn contractor_addresses(cfg: &Config, passphrase: &str, count: u32) -> anyhow::Result<Vec<String>> {
    Ok(contractor_wallets(cfg, passphrase, count)?.into_iter().map(|w| w.address).collect())
}
