//! Integration tests against live Zcash testnet lightwalletd (ADR-010).
//!
//! They are `#[ignore]`d, so a plain `cargo test` (and CI) reports them as ignored rather than
//! passed. Run them explicitly; they then require `ZCASH_NETWORK=testnet` and `LIGHTWALLETD_URL`:
//!
//! ```text
//! ZCASH_NETWORK=testnet LIGHTWALLETD_URL=https://testnet.zec.rocks:443 cargo test --test testnet -- --ignored
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

const NEEDS_TESTNET: &str = "needs ZCASH_NETWORK=testnet and LIGHTWALLETD_URL";

macro_rules! require_testnet {
    () => {
        testnet_url().unwrap_or_else(|| panic!("this live test {NEEDS_TESTNET}"))
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
        maya_midgard_url: String::new(),
        min_confirmations: 1,
        birthday_height: None,
        statements_only: true,
        viewer_birthday_height: Some(4_134_000),
        price_api_url: None,
        price_api_key: None,
        app_fee_bps: 0,
        app_fee_recipient: None,
        max_run_usd_cents: None,
        allowed_hosts: vec![],
        allow_remote_payer: false,
        auth: payslip::config::AuthConfig::off(),
    }
}

#[tokio::test]
#[ignore = "needs ZCASH_NETWORK=testnet and LIGHTWALLETD_URL"]
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
#[ignore = "needs ZCASH_NETWORK=testnet and LIGHTWALLETD_URL"]
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
#[ignore = "needs ZCASH_NETWORK=testnet and LIGHTWALLETD_URL"]
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
#[ignore = "needs ZCASH_NETWORK=testnet and LIGHTWALLETD_URL"]
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

#[tokio::test]
#[ignore = "needs ZCASH_NETWORK=testnet and LIGHTWALLETD_URL"]
async fn payment_proof_discloses_one_payment_and_rejects_tampering() {
    use payslip::proof::{self, ProofToken};
    let url = require_testnet!();
    let mut client = lwd::connect(&url).unwrap();
    let tip = lwd::tip(&mut client).await.unwrap();
    let txid = payslip::wallet::parse_txid(AMARA_PAYMENT_TXID).unwrap();
    let (tx, height) = lwd::fetch_tx(&mut client, &Network::TestNetwork, tip, txid)
        .await
        .unwrap()
        .expect("the payment is on testnet");
    assert_eq!(height, Some(BlockHeight::from_u32(AMARA_PAYMENT_HEIGHT)));

    // Amara's key opens exactly one payment in the transaction; change is left out.
    let key = ViewingKey::parse(&ZcashNetwork::Testnet, AMARA_UFVK).unwrap();
    let sent = proof::sent_outputs(&key.ufvk, &tx);
    assert_eq!(sent.len(), 1, "one payment, no change");
    let out = &sent[0];
    assert_eq!(out.value_zat, 355_555);

    // The proof alone, with no key, opens the same output.
    let token = ProofToken {
        mainnet: false,
        pool: out.pool,
        action_index: out.action_index,
        txid,
        ock: out.ock,
    };
    let decoded = ProofToken::decode(&token.encode()).unwrap();
    let opened = proof::open_with_proof(&decoded, &tx).unwrap();
    assert_eq!(opened.value_zat, 355_555);
    assert_eq!(opened.recipient, out.recipient);
    match memo::decode_bytes(Some(&opened.memo)) {
        Decoded::Payslip(PayslipMemo::PayLine(m)) => assert_eq!(m.invoice_ref, "INV-2026-014"),
        other => panic!("memo did not decode as a pay line: {other:?}"),
    }
    assert!(proof::recipient_address(&Network::TestNetwork, opened.recipient).starts_with("utest1"));

    // A changed key, or the right key pointed at another output, opens nothing.
    let mut wrong_key = decoded.clone();
    wrong_key.ock[0] ^= 1;
    assert!(proof::open_with_proof(&wrong_key, &tx).is_err());
    let mut wrong_output = decoded.clone();
    wrong_output.action_index ^= 1;
    assert!(proof::open_with_proof(&wrong_output, &tx).is_err());

    // The treasury key did not send this payment, so it has nothing to prove here.
    let treasury = ViewingKey::parse(&ZcashNetwork::Testnet, TREASURY_UFVK).unwrap();
    assert!(proof::sent_outputs(&treasury.ufvk, &tx).is_empty());
}

// ---------------------------------------------------------------------------------------------
// The statements API end to end over the published judge kit (docs/judge/judge-kit-testnet.json):
// three demo runs of six contractors each, all paid on 5 Oct 2026.

struct Live {
    base: String,
    http: reqwest::Client,
    _dir: tempfile::TempDir,
}

/// A statements-only service on a free port, reading live testnet, knowing no keys.
async fn live_service(url: &str) -> Live {
    let dir = tempfile::tempdir().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let mut cfg = config(url, dir.path().to_path_buf());
    cfg.bind = addr;
    cfg.viewer_birthday_height = None;
    let state = payslip::api::build_state(cfg).await.unwrap();
    tokio::spawn(async move { axum::serve(listener, payslip::api::router(state)).await.unwrap() });
    Live {
        base: format!("http://{addr}"),
        http: reqwest::Client::new(),
        _dir: dir,
    }
}

impl Live {
    async fn post(&self, path: &str, body: serde_json::Value) -> (u16, serde_json::Value) {
        let r = self
            .http
            .post(format!("{}{path}", self.base))
            .json(&body)
            .send()
            .await
            .unwrap();
        (r.status().as_u16(), r.json().await.unwrap())
    }
}

struct Kit {
    birthday: u32,
    keys: Vec<(String, String)>,
}

fn kit() -> Kit {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../docs/judge/judge-kit-testnet.json");
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    Kit {
        birthday: v["birthday_height"].as_u64().unwrap() as u32,
        keys: v["keys"]
            .as_array()
            .unwrap()
            .iter()
            .map(|k| {
                (
                    k["label"].as_str().unwrap().to_string(),
                    k["ufvk"].as_str().unwrap().to_string(),
                )
            })
            .collect(),
    }
}

impl Kit {
    fn key(&self, label: &str) -> String {
        self.keys.iter().find(|k| k.0 == label).unwrap().1.clone()
    }
}

/// Audit SL-03, PBL-01, JD-02: with every kit key each run reconciles and the treasury key is
/// recognised although a statements-only service knows no key; with the treasury and only two
/// contractors, each run is `incomplete_keys` with the four missing accounts counted, and the
/// treasury's unspent ZEC is the same as with every key.
#[tokio::test]
#[ignore = "needs ZCASH_NETWORK=testnet and LIGHTWALLETD_URL"]
async fn the_judge_kit_reconciles_and_a_partial_key_set_is_flagged() {
    let url = require_testnet!();
    let svc = live_service(&url).await;
    let kit = kit();
    let all: Vec<String> = kit.keys.iter().map(|k| k.1.clone()).collect();
    let body = |keys: Vec<String>| serde_json::json!({"ufvks": keys, "from": "2026-10-01", "to": "2026-10-05", "birthday_height": kit.birthday});
    let (st, full) = svc.post("/api/statements/accountant", body(all)).await;
    assert_eq!(st, 200, "{full}");
    assert_eq!(full["treasury_key_present"], true);
    assert_eq!(full["scanned_from_height"], kit.birthday);
    let runs = full["runs"].as_array().unwrap();
    assert_eq!(runs.len(), 3, "{full}");
    for r in runs {
        assert_eq!(r["status"], "reconciled", "{r}");
        assert_eq!(
            (r["allocations"].as_u64(), r["lines"].as_u64()),
            (Some(6), Some(6)),
            "{r}"
        );
        assert_eq!(r["missing_accounts"], 0);
    }
    let roles: Vec<&str> = full["accounts"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["role"].as_str().unwrap())
        .collect();
    assert_eq!(roles.iter().filter(|r| **r == "treasury").count(), 1, "{roles:?}");

    let partial = vec![kit.key("Treasury"), kit.key("Amara Okafor"), kit.key("Mateo Fernandez")];
    let (st, part) = svc.post("/api/statements/accountant", body(partial)).await;
    assert_eq!(st, 200, "{part}");
    let runs_p = part["runs"].as_array().unwrap();
    assert_eq!(runs_p.len(), 3);
    for r in runs_p {
        assert_eq!(r["status"], "incomplete_keys", "{r}");
        assert_eq!(
            (r["missing_accounts"].as_u64(), r["lines"].as_u64()),
            (Some(4), Some(2)),
            "{r}"
        );
        let same = runs.iter().find(|f| f["run_id"] == r["run_id"]).unwrap();
        assert_eq!(
            r["unspent_zat"], same["unspent_zat"],
            "unspent is the treasury's, not inferred"
        );
    }
}

/// Audit JD-01, SL-13, PBL-08, SL-14: an unknown key first scanned from a later birthday is
/// rescanned when a request asks for an earlier one (its payments appear), recipients read in
/// the Revision 0 form proofs use, and a birthday above the tip is a 400.
#[tokio::test]
#[ignore = "needs ZCASH_NETWORK=testnet and LIGHTWALLETD_URL"]
async fn an_earlier_birthday_rescans_a_cached_key() {
    let url = require_testnet!();
    let svc = live_service(&url).await;
    let kit = kit();
    let amara = kit.key("Amara Okafor");
    let req =
        |b: u32| serde_json::json!({"ufvk": amara, "from": "2026-10-01", "to": "2026-10-05", "birthday_height": b});
    // After her last kit payment (4,467,196): nothing to see.
    let (st, late) = svc.post("/api/statements/contractor", req(4_467_197)).await;
    assert_eq!(st, 200, "{late}");
    assert_eq!(late["totals"]["count"], 0, "{late}");
    // The same cached key, asked from the kit's birthday: all three payments.
    let (st, early) = svc.post("/api/statements/contractor", req(kit.birthday)).await;
    assert_eq!(st, 200, "{early}");
    assert_eq!(early["totals"]["count"], 3, "{early}");
    assert_eq!(early["scanned_from_height"], kit.birthday);
    for l in early["lines"].as_array().unwrap() {
        assert!(l["to_address"].as_str().unwrap().starts_with("utest1"), "{l}");
    }
    // Without a birthday the cached scan is reused, not restarted from Ironwood activation.
    let (st, again) = svc
        .post(
            "/api/statements/contractor",
            serde_json::json!({"ufvk": amara, "from": "2026-10-01", "to": "2026-10-05"}),
        )
        .await;
    assert_eq!(st, 200, "{again}");
    assert_eq!(
        (again["totals"]["count"].as_u64(), again["scanned_from_height"].as_u64()),
        (Some(3), Some(kit.birthday as u64))
    );
    let (st, err) = svc.post("/api/statements/contractor", req(99_999_999)).await;
    assert_eq!(
        (st, err["error"]["code"].as_str()),
        (400, Some("invalid_birthday_height")),
        "{err}"
    );
}
