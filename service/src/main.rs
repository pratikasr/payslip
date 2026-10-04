use anyhow::{anyhow, bail, Context};
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
    /// Print the treasury's unified address (for funding on testnet).
    Address,
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
    /// Scan the chain with a viewing key and print every output with its decoded memo.
    Scan {
        #[arg(long)]
        ufvk: String,
        #[arg(long)]
        birthday: Option<u32>,
    },
    /// Testnet only: print N unified addresses from the separate dev contractor seed.
    DevContractors {
        #[arg(long, default_value_t = 6)]
        count: u32,
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
            let payer = Payer::open(&cfg).await?;
            println!("{}", payer.wallet_info().await?.treasury.unified_address);
            Ok(())
        }
        Command::Sync => {
            let payer = Payer::open(&cfg).await?;
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
            let payer = Payer::open(&cfg).await?;
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
        Command::Scan { ufvk, birthday } => {
            let registry = payslip::viewer::ViewerRegistry::new(&cfg);
            let default_birthday = match birthday {
                Some(b) => b,
                None => Payer::open(&cfg).await?.wallet_info().await?.birthday_height,
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
        Command::DevContractors { count } => {
            if cfg.network != payslip::config::ZcashNetwork::Testnet {
                bail!("dev-contractors is a testnet helper");
            }
            let passphrase = cfg
                .seed_passphrase
                .clone()
                .ok_or_else(|| anyhow!("set PAYSLIP_SEED_PASSPHRASE first"))?;
            for (i, ua) in payslip::devseed::contractor_addresses(&cfg, &passphrase, count)
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
