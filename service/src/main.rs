use anyhow::{anyhow, Context};
use clap::{Parser, Subcommand};
use tracing_subscriber::EnvFilter;

use payslip::{config::Config, money, payer::Payer, seed::SeedFile};

#[derive(Parser)]
#[command(name = "payslip-service", version, about = "Payslip: private payroll on Zcash")]
struct Cli {
    #[command(subcommand)]
    command: Option<Command>,
}

#[derive(Subcommand)]
enum Command {
    /// Run the HTTP API (the default).
    Serve,
    /// Create the encrypted payer seed and the treasury account. With --import, reads a
    /// 24-word mnemonic from stdin instead of generating one.
    Init {
        #[arg(long)]
        import: bool,
    },
    /// Print the treasury's unified address (for funding on testnet). Works without
    /// PAYSLIP_SEED_PASSPHRASE, as do sync, fvk and account-address: they only read.
    Address,
    /// Print the treasury seed's 24-word recovery phrase (needs PAYSLIP_SEED_PASSPHRASE). Write it
    /// down and keep it off this machine: with it, any Zcash wallet can recover the treasury and
    /// every contractor account, with or without Payslip.
    SeedPhrase,
    /// Sync the payer wallet to the chain tip and print balances.
    Sync,
    /// Print the unified full viewing key of ZIP-32 account N.
    Fvk {
        #[arg(long, default_value_t = 0)]
        account: u32,
    },
    /// Send a shielded payment with a memo from account N (development helper).
    Send {
        #[arg(long, default_value_t = 0)]
        from: u32,
        #[arg(long)]
        to: String,
        #[arg(long)]
        zat: u64,
        #[arg(long)]
        memo: Option<String>,
    },
    /// Send the whole spendable balance of account N (minus the fee) to an address.
    Sweep {
        #[arg(long, default_value_t = 0)]
        from: u32,
        #[arg(long)]
        to: String,
    },
    /// Scan the chain with a viewing key and print every output with its decoded memo.
    Scan {
        #[arg(long)]
        ufvk: String,
        #[arg(long)]
        birthday: Option<u32>,
    },
    /// Print N unified addresses from the separate demo contractor seed (mainnet needs
    /// --allow-mainnet).
    DevContractors {
        #[arg(long, default_value_t = 6)]
        count: u32,
        #[arg(long)]
        allow_mainnet: bool,
    },
    /// Print the payer-side unified address of ZIP-32 account N.
    AccountAddress {
        #[arg(long)]
        account: u32,
    },
    /// Testing helper: print a mainnet UFVK derived from an all-zero test seed (no funds).
    DevMainnetUfvk,
    /// Development helper: create ZIP-32 account N of the payer seed scanning from a given height,
    /// to recover funds received before the account existed in this wallet.
    DevEnsureAccount {
        #[arg(long)]
        account: u32,
        #[arg(long)]
        birthday: u32,
    },
    /// Sweep the demo contractor wallets back to the treasury (mainnet needs --allow-mainnet).
    DevSweep {
        #[arg(long, default_value_t = 6)]
        count: u32,
        #[arg(long)]
        allow_mainnet: bool,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,zcash_client_backend=warn,zcash_client_sqlite=warn")),
        )
        .with_writer(std::io::stderr)
        .init();
    let cli = Cli::parse();
    let cfg = Config::from_env()?;

    match cli.command.unwrap_or(Command::Serve) {
        Command::Serve => payslip::api::serve(cfg).await,
        Command::Init { import } => {
            let passphrase = cfg
                .seed_passphrase
                .clone()
                .ok_or_else(|| anyhow!("set PAYSLIP_SEED_PASSPHRASE (12+ characters) first"))?;
            let seed = SeedFile::new(cfg.seed_path());
            if import {
                let mut phrase = String::new();
                std::io::stdin().read_line(&mut phrase)?;
                seed.import(&phrase, &passphrase)?;
            } else {
                seed.create(&passphrase)?;
            }
            println!("Encrypted seed written to {}", seed.path().display());
            let payer = Payer::open(&cfg).await?;
            let info = payer.wallet_info().await?;
            println!("Network: {}", cfg.network.as_str());
            println!("Wallet birthday height: {}", info.birthday_height);
            println!("Treasury address: {}", info.treasury.unified_address);
            Ok(())
        }
        Command::Address => {
            let payer = Payer::open_any(&cfg).await?;
            println!("{}", payer.wallet_info().await?.treasury.unified_address);
            Ok(())
        }
        Command::SeedPhrase => {
            use secrecy::ExposeSecret as _;
            let passphrase = cfg
                .seed_passphrase
                .clone()
                .ok_or_else(|| anyhow!("set PAYSLIP_SEED_PASSPHRASE first"))?;
            let seed = SeedFile::new(cfg.seed_path());
            let phrase = seed.phrase(&passphrase)?;
            eprintln!(
                "Recovery phrase for the {} treasury in {}. Anyone with these 24 words can spend it.",
                cfg.network.as_str(),
                seed.path().display()
            );
            println!("{}", phrase.expose_secret());
            Ok(())
        }
        Command::Sync => {
            let payer = Payer::open_any(&cfg).await?;
            let report = payer.sync().await?;
            println!("Chain tip {} / scanned {}", report.chain_tip, report.fully_scanned);
            let info = payer.wallet_info().await?;
            println!(
                "Treasury: spendable {} ZEC, pending {} ZEC, total {} ZEC",
                money::format_zec(info.treasury.spendable_zat),
                money::format_zec(info.treasury.pending_zat),
                money::format_zec(info.treasury.total_zat)
            );
            for a in payer.account_balances().await? {
                println!(
                    "Account {}: spendable {} total {}",
                    a.0,
                    money::format_zec(a.1.spendable_zat),
                    money::format_zec(a.1.total_zat)
                );
            }
            Ok(())
        }
        Command::Fvk { account } => {
            let payer = Payer::open_any(&cfg).await?;
            println!("{}", payer.ufvk(account).await?);
            Ok(())
        }
        Command::Send { from, to, zat, memo } => {
            let payer = Payer::open(&cfg).await?;
            payer.sync().await?;
            let txid = payer.send_simple(from, &to, zat, memo.as_deref()).await?;
            println!("{txid}");
            println!("{}", cfg.network.explorer_tx_url(&txid));
            Ok(())
        }
        Command::Sweep { from, to } => {
            let payer = Payer::open(&cfg).await?;
            payer.sync().await?;
            let txid = payer.sweep(from, &to).await?;
            println!("{txid}");
            println!("{}", cfg.network.explorer_tx_url(&txid));
            Ok(())
        }
        Command::Scan { ufvk, birthday } => {
            let registry = payslip::viewer::ViewerRegistry::new(&cfg);
            let default_birthday = match birthday {
                Some(b) => b,
                None => Payer::open_any(&cfg).await?.wallet_info().await?.birthday_height,
            };
            let key = payslip::viewer::ViewingKey::parse(&cfg.network, &ufvk).map_err(|e| anyhow!(e.body.message))?;
            let scan = registry.scan(vec![(key, "cli".into(), default_birthday)]).await?;
            println!("Scanned to height {}", scan.scanned_to_height);
            for o in scan.outputs {
                println!(
                    "{} height={:?} {} {} ZEC change={} memo={:?}",
                    o.txid,
                    o.mined_height,
                    if o.from_account.is_some() { "out" } else { "in " },
                    money::format_zec(o.value_zat),
                    o.is_change,
                    payslip::memo::decode_bytes(o.memo.as_deref())
                );
            }
            Ok(())
        }
        Command::AccountAddress { account } => {
            let payer = Payer::open_any(&cfg).await?;
            println!("{}", payer.address(account).await?);
            Ok(())
        }
        Command::DevEnsureAccount { account, birthday } => {
            let payer = Payer::open(&cfg).await?;
            let (ufvk, b) = payer
                .ensure_account_from(account, format!("account-{account}"), birthday)
                .await?;
            println!("account {account} birthday {b}\n{ufvk}");
            Ok(())
        }
        Command::DevMainnetUfvk => {
            let params = zcash_protocol::consensus::Network::MainNetwork;
            let usk = zcash_keys::keys::UnifiedSpendingKey::from_seed(&params, &[0u8; 32], zip32::AccountId::ZERO)
                .map_err(|e| anyhow!("{e:?}"))?;
            println!("{}", usk.to_unified_full_viewing_key().encode(&params));
            Ok(())
        }
        Command::DevSweep { count, allow_mainnet } => {
            let passphrase = cfg
                .seed_passphrase
                .clone()
                .ok_or_else(|| anyhow!("set PAYSLIP_SEED_PASSPHRASE first"))?;
            let payer = Payer::open(&cfg).await?;
            let info = payer.wallet_info().await?;
            drop(payer);
            for (i, txid) in payslip::devseed::sweep_to_treasury(
                &cfg,
                &passphrase,
                count,
                &info.treasury.unified_address,
                info.birthday_height,
                allow_mainnet,
            )
            .await?
            {
                println!("dev account {i} swept: {txid}");
            }
            Ok(())
        }
        Command::DevContractors { count, allow_mainnet } => {
            let passphrase = cfg
                .seed_passphrase
                .clone()
                .ok_or_else(|| anyhow!("set PAYSLIP_SEED_PASSPHRASE first"))?;
            for (i, ua) in payslip::devseed::contractor_addresses(&cfg, &passphrase, count, allow_mainnet)
                .await?
                .iter()
                .enumerate()
            {
                println!("{i}\t{ua}");
            }
            Ok(())
        }
    }
    .with_context(|| "payslip-service failed".to_string())
}
