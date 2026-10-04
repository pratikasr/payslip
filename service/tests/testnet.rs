//! Integration tests against live Zcash testnet lightwalletd (ADR-010).
//!
//! They run only when `ZCASH_NETWORK=testnet` and `LIGHTWALLETD_URL` are set, and are skipped
//! otherwise (CI does not set them):
//!
//! ```text
//! ZCASH_NETWORK=testnet LIGHTWALLETD_URL=https://testnet.zec.rocks:443 cargo test --test testnet
//! ```
//!
//! The viewing keys below are testnet keys published on purpose: they reveal only the testnet
//! payments of Payslip's first testnet run (9145b60b, 5 Oct 2026) and carry no spending power.

use std::path::PathBuf;

use payslip::{
    config::{Config, VenueKind, ZcashNetwork},
    memo::{self, Decoded, PayslipMemo},
    viewer::{ViewerRegistry, ViewingKey},
    wallet::lwd,
};
use zcash_protocol::consensus::{BlockHeight, BranchId, Network};

const AMARA_UFVK: &str = "uvftest1qg2spl3ttr6w3c2etja9f4au9lp70hmjn3hnuy2z8s6cpwcd3ch9ag7swu2yzw4sehf9fppdpc68y4ddrl3e7m8wx6n92w7zfg6x84ea2jy93kxfq8dsfzcg3sn0f47prv6dpuwmxggh55ammjauhevg8d5t0ddzhfh38hsz0q8vf7u20wule5vjl22um8ve3a6fs4vusrdtwm70p0zqzpu43j6qqz50rfs7ls57euvcd708lt4umw5z32xyf70uzpvvxwrt9fn6asr60l4jvlngr9clvsz3fx9v0tdfv33pwqrwrv049ffz6e9znlu3q0tttgwy44jstytr2nrup25yphp7hckv8xzlw72r40nxpxgjpre7zaavjfshrdxfg94q2g6lkf50r5y2vmpwsdt4sq785xmj782n4lzmwth2w9r2wwqg0hf6rcw6pqa4umkfvtk64qll0aka88hmw8udkyjfdrlxayam6lurfd4lc4rc8s4jlfec";
const AMARA_BIRTHDAY: u32 = 4_465_657;
const AMARA_PAYMENT_TXID: &str = "3c5513c5aaee0def9244a5fb02a32681a0c9b0046a0e1a16b1964c8ede83bd08";
const AMARA_PAYMENT_HEIGHT: u32 = 4_465_671;
const RUN_ID: &str = "9145b60b-f19a-4467-ad8a-78a14bd642f6";

const TREASURY_UFVK: &str = "uvftest108jjqghjkj538myrap9fhuf8050tl3w0q5x8y5fggz2dn50f50t6qc3c0ggw7pyh83mcjjwr5ez8qcye3ceknndmy4uultadqh4uee74zzu85w0w9k2l2lg8yv608x5psspqhtph3e9uytsv0f3x7syycpyevwg6fkc32604t7m9nd68nl2faam4rlq6gkq5eh79kp99ctr65lt3ty9unnu024w5w4hy2qg28d47lkdv2c6zwdxkf0aqfsgwatujgkqdfdelzymccm400ss4lrrn6yzqv4kcpe4200xzpzeqhc0z452mlw79gypfazm2qrj2xmttmzhzvhxvqjp9y7k37myfe2qytqan7r37gm5zg7axlyp39jnr9dvlpak2n44vn70zn9xt7lpxfz9efj5y76mly0vjnt2kzccwd68axudqtvp7rrlvrgwvtrsj2tqe2cwzqlaertqfxc6fm40xtucfqxmfweq2cxt5jned4tpufs7zdqn6";
const TREASURY_BIRTHDAY: u32 = 4_465_629;

fn testnet_url() -> Option<String> {
    let net = std::env::var("ZCASH_NETWORK").ok()?;
    if net != "testnet" {
        return None;
    }
    std::env::var("LIGHTWALLETD_URL").ok().filter(|u| !u.is_empty())
}

macro_rules! require_testnet {
    () => {
        match testnet_url() {
            Some(u) => u,
            None => {
                eprintln!("skipped: set ZCASH_NETWORK=testnet and LIGHTWALLETD_URL to run");
                return;
            }
        }
    };
}

fn config(url: &str, dir: PathBuf) -> Config {
    Config {
        network: ZcashNetwork::Testnet,
        lightwalletd_url: url.to_string(),
        data_dir: dir,
        bind: "127.0.0.1:0".parse().unwrap(),
        web_origin: "http://localhost:3000".into(),
        seed_passphrase: None,
        venue: VenueKind::TestnetFixedRate,
        testnet_rate_e6: payslip::config::DEFAULT_TESTNET_RATE_E6,
        near_intents_api_url: String::new(),
        near_intents_jwt: None,
        maya_api_url: String::new(),
        min_confirmations: 1,
        birthday_height: None,
    }
}

#[tokio::test]
async fn lightwalletd_branch_id_matches_the_pinned_protocol_schedule() {
    let url = require_testnet!();
    let mut client = lwd::connect(&url).unwrap();
    let info = lwd::info(&mut client).await.unwrap();
    assert_eq!(info.chain_name, "test");
    let tip = BlockHeight::from_u32(info.block_height as u32);
    let ours = u32::from(BranchId::for_height(&Network::TestNetwork, tip + 1));
    assert_eq!(
        info.consensus_branch_id,
        format!("{ours:08x}"),
        "the wallet would sign with the wrong branch id"
    );
    assert_eq!(ours, 0x77190ad9, "testnet is on NU7");
}

#[tokio::test]
async fn contractor_key_recovers_the_payment_and_its_memo() {
    let url = require_testnet!();
    let dir = tempfile::tempdir().unwrap();
    let registry = ViewerRegistry::new(&config(&url, dir.path().to_path_buf()));
    let key = ViewingKey::parse(&ZcashNetwork::Testnet, AMARA_UFVK).unwrap();
    let scan = registry
        .scan(vec![(key, "Amara Okafor".into(), AMARA_BIRTHDAY)])
        .await
        .unwrap();
    assert!(scan.scanned_to_height >= AMARA_PAYMENT_HEIGHT);
    let payment = scan
        .outputs
        .iter()
        .find(|o| o.txid == AMARA_PAYMENT_TXID && o.from_account.is_some() && !o.is_change)
        .expect("the payment from Amara's account is visible to her key");
    assert_eq!(payment.mined_height, Some(AMARA_PAYMENT_HEIGHT));
    match memo::decode_bytes(payment.memo.as_deref()) {
        Decoded::Payslip(PayslipMemo::PayLine(m)) => {
            assert_eq!(m.run_id.to_string(), RUN_ID);
            assert_eq!(m.invoice_ref, "INV-2026-014");
            assert_eq!(m.usd_basis_cents, 480_000);
            assert_eq!(m.period.to_string(), "2026-09");
        }
        other => panic!("memo did not decode as a pay line: {other:?}"),
    }
    // The key sees nothing it should not: every output involves Amara's account.
    assert!(scan
        .outputs
        .iter()
        .all(|o| o.from_account.is_some() || o.to_account.is_some()));
}

#[tokio::test]
async fn treasury_key_reads_the_run_funding_record() {
    let url = require_testnet!();
    let dir = tempfile::tempdir().unwrap();
    let registry = ViewerRegistry::new(&config(&url, dir.path().to_path_buf()));
    let key = ViewingKey::parse(&ZcashNetwork::Testnet, TREASURY_UFVK).unwrap();
    let scan = registry
        .scan(vec![(key, "Treasury".into(), TREASURY_BIRTHDAY)])
        .await
        .unwrap();
    let record = scan
        .outputs
        .iter()
        .filter_map(|o| match memo::decode_bytes(o.memo.as_deref()) {
            Decoded::Payslip(PayslipMemo::RunFunding(r)) if r.run_id.to_string() == RUN_ID => Some((o.is_change, r)),
            _ => None,
        })
        .next()
        .expect("the run funding record is on the treasury change output");
    assert!(record.0, "carried by the change output");
    assert_eq!(record.1.funded_usd_cents, 1_766_501);
    assert_eq!(record.1.zec_acquired_zat, 1_308_519);
}

#[tokio::test]
async fn contractor_key_cannot_see_the_run_funding_record() {
    let url = require_testnet!();
    let dir = tempfile::tempdir().unwrap();
    let registry = ViewerRegistry::new(&config(&url, dir.path().to_path_buf()));
    let key = ViewingKey::parse(&ZcashNetwork::Testnet, AMARA_UFVK).unwrap();
    let scan = registry
        .scan(vec![(key, "Amara Okafor".into(), AMARA_BIRTHDAY)])
        .await
        .unwrap();
    assert!(scan.outputs.iter().all(|o| !matches!(
        memo::decode_bytes(o.memo.as_deref()),
        Decoded::Payslip(PayslipMemo::RunFunding(_))
    )));
}
