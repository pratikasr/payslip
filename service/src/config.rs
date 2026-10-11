//! Service configuration from the environment (`.env` is loaded if present).

use std::{env, net::SocketAddr, path::PathBuf};

use anyhow::{bail, Context};
use zcash_protocol::consensus::Network;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ZcashNetwork {
    Mainnet,
    Testnet,
}

impl ZcashNetwork {
    pub fn parse(s: &str) -> anyhow::Result<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "mainnet" | "main" => Ok(ZcashNetwork::Mainnet),
            "testnet" | "test" => Ok(ZcashNetwork::Testnet),
            other => bail!("ZCASH_NETWORK must be mainnet or testnet, got {other:?}"),
        }
    }

    pub fn params(&self) -> Network {
        match self {
            ZcashNetwork::Mainnet => Network::MainNetwork,
            ZcashNetwork::Testnet => Network::TestNetwork,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            ZcashNetwork::Mainnet => "mainnet",
            ZcashNetwork::Testnet => "testnet",
        }
    }

    /// Default public lightwalletd endpoint (see Verified facts in docs/TECH-DECISIONS.md).
    pub fn default_lightwalletd(&self) -> &'static str {
        match self {
            ZcashNetwork::Mainnet => "https://zec.rocks:443",
            ZcashNetwork::Testnet => "https://testnet.zec.rocks:443",
        }
    }

    /// NU6.3 (Ironwood) activation height (Verified facts, 5 Oct 2026): payments start here.
    pub fn ironwood_activation_height(&self) -> u32 {
        match self {
            ZcashNetwork::Mainnet => 3_428_143,
            ZcashNetwork::Testnet => 4_134_000,
        }
    }

    /// Explorer link for a transaction.
    pub fn explorer_tx_url(&self, txid: &str) -> String {
        match self {
            ZcashNetwork::Mainnet => format!("https://zecblock.com/tx/{txid}"),
            ZcashNetwork::Testnet => format!("https://testnet.zecblock.com/tx/{txid}"),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VenueKind {
    NearIntents,
    Maya,
    TestnetFixedRate,
    /// Fund with ZEC (ADR-025): the payer sends ZEC to the treasury and the run is funded at the
    /// market rate when it confirms. Not chosen by `PAYSLIP_SWAP_VENUE`: it is the `zec` funding
    /// method, available on every network beside the configured USDC venue.
    Treasury,
}

impl VenueKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            VenueKind::NearIntents => "near-intents-1click",
            VenueKind::Maya => "maya",
            VenueKind::TestnetFixedRate => "testnet-fixed-rate",
            VenueKind::Treasury => "treasury",
        }
    }
}

/// Whether payer routes need a signed-in member (ADR-026).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AuthMode {
    /// No sign-in: today's behaviour, for the testnet demo and the judge path.
    Off,
    /// Every payer route needs a bearer token minted by the web app for a signed-in member.
    Required,
}

impl AuthMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            AuthMode::Off => "off",
            AuthMode::Required => "required",
        }
    }
}

/// Sign-in settings (ADR-026). The web app signs people in and mints short EdDSA tokens; the
/// service checks them against the web app's published keys and decides what each role may do.
#[derive(Clone, Debug)]
pub struct AuthConfig {
    pub mode: AuthMode,
    /// PAYSLIP_AUTH_JWKS_URL: where the web app publishes the public keys that sign its tokens.
    pub jwks_url: String,
    /// PAYSLIP_AUTH_ISSUER: the `iss` claim tokens must carry (the web app's BETTER_AUTH_URL).
    pub issuer: String,
    /// PAYSLIP_AUTH_AUDIENCE: the `aud` claim tokens must carry.
    pub audience: String,
    /// PAYSLIP_BOOTSTRAP_ADMIN_EMAIL, lower case: the first sign-in with this verified email
    /// creates the organisation and becomes its admin. After that membership is invite-only.
    pub bootstrap_admin_email: Option<String>,
}

/// The audience the web app's JWT plugin is configured with (web/src/lib/auth.ts).
pub const DEFAULT_AUTH_AUDIENCE: &str = "payslip-service";

impl AuthConfig {
    /// No sign-in.
    pub fn off() -> Self {
        AuthConfig {
            mode: AuthMode::Off,
            jwks_url: String::new(),
            issuer: String::new(),
            audience: DEFAULT_AUTH_AUDIENCE.into(),
            bootstrap_admin_email: None,
        }
    }

    pub fn required(&self) -> bool {
        self.mode == AuthMode::Required
    }

    fn from_env() -> anyhow::Result<Self> {
        let mode = match var("PAYSLIP_AUTH").as_deref() {
            None | Some("off") => AuthMode::Off,
            Some("required") => AuthMode::Required,
            Some(other) => bail!("PAYSLIP_AUTH must be off or required, got {other:?}"),
        };
        let jwks_url = var("PAYSLIP_AUTH_JWKS_URL").unwrap_or_else(|| "http://127.0.0.1:3000/api/auth/jwks".into());
        if mode == AuthMode::Required && !(jwks_url.starts_with("http://") || jwks_url.starts_with("https://")) {
            bail!("PAYSLIP_AUTH_JWKS_URL must be an http or https URL, got {jwks_url:?}");
        }
        // Better Auth's default issuer is its base URL, which is the JWKS URL without the
        // /api/auth/jwks part (web/src/lib/auth.ts sets both explicitly to the same values).
        let issuer = var("PAYSLIP_AUTH_ISSUER").unwrap_or_else(|| {
            jwks_url
                .split_once("/api/")
                .map(|(base, _)| base.to_string())
                .unwrap_or_else(|| jwks_url.trim_end_matches('/').to_string())
        });
        Ok(AuthConfig {
            mode,
            jwks_url,
            issuer,
            audience: var("PAYSLIP_AUTH_AUDIENCE").unwrap_or_else(|| DEFAULT_AUTH_AUDIENCE.into()),
            bootstrap_admin_email: var("PAYSLIP_BOOTSTRAP_ADMIN_EMAIL").map(|e| e.to_ascii_lowercase()),
        })
    }
}

#[derive(Clone, Debug)]
pub struct Config {
    pub network: ZcashNetwork,
    pub lightwalletd_url: String,
    pub data_dir: PathBuf,
    pub bind: SocketAddr,
    pub web_origin: String,
    pub seed_passphrase: Option<String>,
    pub venue: VenueKind,
    pub testnet_rate_e6: u64,
    pub near_intents_api_url: String,
    pub near_intents_jwt: Option<String>,
    pub maya_api_url: String,
    /// Maya's Midgard API, for the indicative ZEC price.
    pub maya_midgard_url: String,
    pub min_confirmations: u32,
    pub birthday_height: Option<u32>,
    /// `statements`: no wallet and no seed; serves statements and payment proofs only, so it is
    /// safe to host publicly for judges and contractors.
    pub statements_only: bool,
    /// PAYSLIP_VIEWER_BIRTHDAY_HEIGHT: where view-only scans start for keys this deployment does
    /// not know (None: Ironwood activation, or the request's own birthday). See
    /// [`Config::viewer_scan_start`].
    pub viewer_birthday_height: Option<u32>,
    /// ZEC market price API (CoinGecko v3 base URL); None when PAYSLIP_PRICE_API_URL=off.
    pub price_api_url: Option<String>,
    /// Optional CoinGecko demo API key, for higher rate limits.
    pub price_api_key: Option<String>,
    /// Extra Host header values the API answers for (a public domain for a statements-only
    /// deployment). The bind address, localhost and 127.0.0.1 on the bind port are always allowed.
    pub allowed_hosts: Vec<String>,
    /// Full mode holds a spending wallet and has no login, so it only binds to loopback unless
    /// this is set (for an operator who puts their own authentication in front).
    pub allow_remote_payer: bool,
    /// Payslip's fee on the USDC to ZEC funding swap, in basis points (0 = none).
    pub app_fee_bps: u32,
    /// NEAR account that receives the fee (required when `app_fee_bps` > 0).
    pub app_fee_recipient: Option<String>,
    /// Sign-in (ADR-026): off keeps today's behaviour, required gates every payer route.
    pub auth: AuthConfig,
    /// PAYSLIP_MAX_RUN_USD_CENTS: the largest payroll one run may carry, in cents; None means no
    /// cap. States the custody exposure plainly: one run's money, for minutes (ADR-025).
    pub max_run_usd_cents: Option<u64>,
}

fn var(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let network = ZcashNetwork::parse(&var("ZCASH_NETWORK").unwrap_or_else(|| "testnet".into()))?;
        let venue = match var("PAYSLIP_SWAP_VENUE").as_deref() {
            None if network == ZcashNetwork::Testnet => VenueKind::TestnetFixedRate,
            None | Some("near-intents") | Some("near-intents-1click") => VenueKind::NearIntents,
            Some("maya") => VenueKind::Maya,
            Some("testnet") | Some("testnet-fixed-rate") => VenueKind::TestnetFixedRate,
            Some(other) => bail!("PAYSLIP_SWAP_VENUE must be near-intents, maya or testnet, got {other:?}"),
        };
        if venue == VenueKind::TestnetFixedRate && network != ZcashNetwork::Testnet {
            bail!("The testnet fixed-rate venue can only be used with ZCASH_NETWORK=testnet");
        }
        let testnet_rate_e6 = match var("PAYSLIP_TESTNET_RATE_USD") {
            Some(s) => crate::money::parse_decimal(&s, 6)
                .and_then(|v| u64::try_from(v).ok())
                .filter(|v| *v > 0)
                .context("PAYSLIP_TESTNET_RATE_USD must be a positive decimal such as 1350000.00")?,
            None => DEFAULT_TESTNET_RATE_E6,
        };
        let app_fee_bps = match var("PAYSLIP_APP_FEE_BPS") {
            Some(s) => s
                .parse::<u32>()
                .ok()
                .filter(|v| *v <= 300)
                .context("PAYSLIP_APP_FEE_BPS must be a whole number of basis points from 0 to 300")?,
            None => 0,
        };
        let app_fee_recipient = var("PAYSLIP_APP_FEE_RECIPIENT");
        if app_fee_bps > 0 && app_fee_recipient.is_none() {
            bail!(
                "PAYSLIP_APP_FEE_BPS is set, so PAYSLIP_APP_FEE_RECIPIENT must name the NEAR account that receives it"
            );
        }
        let max_run_usd_cents = var("PAYSLIP_MAX_RUN_USD_CENTS")
            .map(|s| {
                s.parse::<u64>().ok().filter(|v| *v > 0).context(
                    "PAYSLIP_MAX_RUN_USD_CENTS must be a whole number of cents above 0, such as 2500000 for $25,000",
                )
            })
            .transpose()?;
        let min_confirmations = match var("PAYSLIP_MIN_CONFIRMATIONS") {
            Some(s) => s
                .parse::<u32>()
                .ok()
                .filter(|v| *v > 0)
                .context("PAYSLIP_MIN_CONFIRMATIONS must be at least 1")?,
            None => 3,
        };
        Ok(Config {
            network,
            lightwalletd_url: var("LIGHTWALLETD_URL").unwrap_or_else(|| network.default_lightwalletd().into()),
            data_dir: PathBuf::from(var("PAYSLIP_DATA_DIR").unwrap_or_else(|| format!("./data/{}", network.as_str()))),
            bind: var("PAYSLIP_BIND")
                .unwrap_or_else(|| "127.0.0.1:8080".into())
                .parse()
                .context("PAYSLIP_BIND must be host:port")?,
            web_origin: var("PAYSLIP_WEB_ORIGIN")
                .unwrap_or_else(|| "http://localhost:3000,http://127.0.0.1:3000".into()),
            seed_passphrase: var("PAYSLIP_SEED_PASSPHRASE"),
            venue,
            testnet_rate_e6,
            near_intents_api_url: var("NEAR_INTENTS_API_URL")
                .unwrap_or_else(|| "https://1click.chaindefuser.com".into()),
            near_intents_jwt: var("NEAR_INTENTS_JWT"),
            maya_api_url: var("MAYA_API_URL").unwrap_or_else(|| "https://mayanode.mayachain.info".into()),
            maya_midgard_url: var("MAYA_MIDGARD_URL").unwrap_or_else(|| "https://midgard.mayachain.info".into()),
            min_confirmations,
            statements_only: match var("PAYSLIP_MODE").as_deref() {
                None | Some("full") => false,
                Some("statements") => true,
                Some(other) => bail!("PAYSLIP_MODE must be full or statements, got {other:?}"),
            },
            viewer_birthday_height: var("PAYSLIP_VIEWER_BIRTHDAY_HEIGHT")
                .map(|s| s.parse())
                .transpose()
                .context("PAYSLIP_VIEWER_BIRTHDAY_HEIGHT must be a block height")?,
            price_api_url: match var("PAYSLIP_PRICE_API_URL").as_deref() {
                Some("off") => None,
                Some(url) => Some(url.to_string()),
                None => Some("https://api.coingecko.com/api/v3".into()),
            },
            price_api_key: var("PAYSLIP_PRICE_API_KEY"),
            app_fee_bps,
            app_fee_recipient,
            max_run_usd_cents,
            allowed_hosts: var("PAYSLIP_ALLOWED_HOSTS")
                .map(|v| {
                    v.split(',')
                        .map(|h| h.trim().to_ascii_lowercase())
                        .filter(|h| !h.is_empty())
                        .collect()
                })
                .unwrap_or_default(),
            allow_remote_payer: matches!(
                var("PAYSLIP_ALLOW_REMOTE_PAYER").as_deref(),
                Some("1") | Some("yes") | Some("true")
            ),
            birthday_height: var("PAYSLIP_BIRTHDAY_HEIGHT")
                .map(|s| s.parse())
                .transpose()
                .context("PAYSLIP_BIRTHDAY_HEIGHT must be a block height")?,
            auth: AuthConfig::from_env()?,
        })
    }

    pub fn wallet_db_path(&self) -> PathBuf {
        self.data_dir.join("wallet.db")
    }

    /// The testnet venue's fixed rate in USD per ZEC: the rate `venue::build` gives the venue
    /// and every testnet run is funded at, so a client can estimate a run before any fill.
    /// None on mainnet (the testnet venue only exists on testnet), with another venue, and in
    /// statements mode, which funds nothing.
    pub fn simulated_rate_usd_per_zec(&self) -> Option<f64> {
        (!self.statements_only && self.venue == VenueKind::TestnetFixedRate && self.network == ZcashNetwork::Testnet)
            .then(|| self.testnet_rate_e6 as f64 / 1_000_000.0)
    }

    /// Whether `POST /api/runs/{id}/fund` accepts `method: "zec"` (ADR-025): every full-mode
    /// service does, on any network; a statements-only deployment funds nothing.
    pub fn fund_with_zec(&self) -> bool {
        !self.statements_only
    }

    pub fn app_db_path(&self) -> PathBuf {
        self.data_dir.join("payslip.db")
    }

    pub fn seed_path(&self) -> PathBuf {
        self.data_dir.join("payer.seed.age")
    }

    pub fn viewers_dir(&self) -> PathBuf {
        self.data_dir.join("viewers")
    }

    /// The configured viewer birthday, else Ironwood activation (where Payslip payments start).
    pub fn viewer_birthday(&self) -> u32 {
        self.viewer_birthday_height
            .unwrap_or_else(|| self.network.ironwood_activation_height())
    }

    /// Where to start scanning a key this deployment does not know (in either mode): the earlier
    /// of the request's `birthday_height` and PAYSLIP_VIEWER_BIRTHDAY_HEIGHT, whichever are given,
    /// else Ironwood activation. Never the payer wallet's own birthday, which says nothing about
    /// someone else's key.
    pub fn viewer_scan_start(&self, requested: Option<u32>) -> u32 {
        match (requested, self.viewer_birthday_height) {
            (Some(r), Some(c)) => r.min(c),
            (Some(r), None) => r,
            (None, Some(c)) => c,
            (None, None) => self.network.ironwood_activation_height(),
        }
    }
}

/// The testnet venue's fixed rate. TAZ has no market price; the rate is chosen so a realistic
/// USD payroll fits inside what a public faucet hands out. It is never used on mainnet.
pub const DEFAULT_TESTNET_RATE_E6: u64 = 1_350_000_000_000;

#[cfg(test)]
mod tests {
    use super::*;

    fn testnet_config() -> Config {
        Config {
            network: ZcashNetwork::Testnet,
            lightwalletd_url: String::new(),
            data_dir: PathBuf::new(),
            bind: "127.0.0.1:8080".parse().unwrap(),
            web_origin: String::new(),
            seed_passphrase: None,
            venue: VenueKind::TestnetFixedRate,
            testnet_rate_e6: DEFAULT_TESTNET_RATE_E6,
            near_intents_api_url: String::new(),
            near_intents_jwt: None,
            maya_api_url: String::new(),
            maya_midgard_url: String::new(),
            min_confirmations: 1,
            birthday_height: Some(4_467_271),
            statements_only: false,
            viewer_birthday_height: None,
            price_api_url: None,
            price_api_key: None,
            allowed_hosts: vec![],
            allow_remote_payer: false,
            app_fee_bps: 0,
            app_fee_recipient: None,
            auth: AuthConfig::off(),
            max_run_usd_cents: None,
        }
    }

    /// Audit JD-01: an unknown key starts at the earlier of the request's birthday and the
    /// configured viewer birthday, else at Ironwood activation.
    #[test]
    fn unknown_keys_scan_from_the_earliest_known_start() {
        let mut cfg = testnet_config();
        assert_eq!(cfg.viewer_scan_start(None), 4_134_000);
        assert_eq!(cfg.viewer_scan_start(Some(4_466_858)), 4_466_858);
        cfg.viewer_birthday_height = Some(4_466_000);
        assert_eq!(cfg.viewer_scan_start(None), 4_466_000);
        assert_eq!(cfg.viewer_scan_start(Some(4_466_858)), 4_466_000);
        assert_eq!(cfg.viewer_scan_start(Some(4_465_600)), 4_465_600);
        assert_eq!(cfg.viewer_birthday(), 4_466_000);
    }

    /// GET /api/health reports the testnet venue's fixed rate where that venue funds runs.
    #[tokio::test]
    async fn the_simulated_rate_is_the_testnet_venues_own() {
        let mut cfg = testnet_config();
        assert_eq!(cfg.simulated_rate_usd_per_zec(), Some(1_350_000.0));
        cfg.testnet_rate_e6 = 42_500_000;
        assert_eq!(cfg.simulated_rate_usd_per_zec(), Some(42.5));
        // The executor's venue is built from the same config and funds runs at that rate.
        let venue = crate::venue::build(&cfg).unwrap();
        assert_eq!(venue.kind(), VenueKind::TestnetFixedRate);
        assert_eq!(venue.indicative_rate_e6().await.unwrap(), 42_500_000);
        cfg.statements_only = true;
        assert_eq!(cfg.simulated_rate_usd_per_zec(), None);
        cfg.statements_only = false;
        cfg.venue = VenueKind::NearIntents;
        assert_eq!(cfg.simulated_rate_usd_per_zec(), None);
        cfg.network = ZcashNetwork::Mainnet;
        assert_eq!(cfg.simulated_rate_usd_per_zec(), None);
    }
}
