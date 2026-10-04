# Payslip: Technical Decisions

Decision log in ADR form. Each entry is a decision that is already made; agents build on it rather than reopening it. To change one, add a new entry that supersedes it and say why. Dates are when the decision was recorded.

## ADR-001 One monorepo, not separate repos (5 Oct 2026)

Decision: `pratikasr/payslip` holds the service, the web app, docs and scripts.

Why: Colosseum takes one repo link per submission and judges read one README. Service and web change together (every API change touches both), and a single commit history is the cleanest proof of work. There is no shared-library or multi-team reason to split. No GitHub organization: two repos under a personal account are easier to connect to build agents and to submit.

Layout:

```
payslip/
  service/      Rust: wallet core, run executor, statement engine, HTTP API
  web/          Next.js: payer, contractor and accountant dashboards
  docs/         SPEC.md, TECH-DECISIONS.md, PROGRESS.md
  scripts/      dev helpers (testnet faucet, demo seeding, release)
  CLAUDE.md     agent guide (AGENTS.md points here)
```

## ADR-002 Service in Rust on `zcash_client_backend` (5 Oct 2026)

Decision: the service is a single Rust binary: `axum` HTTP API, `tokio` runtime, `zcash_client_backend` + `zcash_client_sqlite` for wallet state, `tonic` for the lightwalletd gRPC client, `sqlx` (sqlite) for app tables.

Why: librustzcash is the only maintained implementation of Ironwood/Orchard scanning, note management and transaction building. Every other stack (Zingo, Zodl, mobile SDKs) wraps it. Writing the service in Rust removes an FFI layer and lets us use the crates directly. This is not a preference for Rust; it is where the only library lives.

Versions: `zcash_client_backend` 0.24.0 (stable, 19 Aug 2026) is the default pin. `0.25.0-pre.0` (2 Oct 2026) exists; use it only if M0 shows 0.24.0 lacks Ironwood scanning. Record the chosen pin under Verified facts.

## ADR-003 Web in Next.js 15 with TypeScript (5 Oct 2026)

Decision: `web/` is Next.js 15 (App Router), TypeScript, Tailwind, shadcn/ui. It talks to the service over REST and listens to run progress over Server-Sent Events. No wallet-connect library: the payer's funds move through the service and the swap venue; the web shows a deposit address and QR.

Why: fastest path to a dashboard that looks finished; SSE is enough for one-way progress; no browser wallet is involved in a Zcash shielded flow.

## ADR-004 SQLite for everything (5 Oct 2026)

Decision: wallet state in `wallet.db` (owned by `zcash_client_sqlite`), app tables in `payslip.db` (owned by `sqlx` migrations). One process, no external database.

Why: `zcash_client_sqlite` already requires SQLite; adding Postgres for four app tables is infrastructure with no judging value. Two files keep the library's schema separate from ours.

## ADR-005 Swap venue behind a trait (5 Oct 2026)

Decision: `trait SwapVenue { quote, execute, status }` with two implementations: `NearIntents1Click` (REST) and `Maya` (REST via Midgard/THORNode-style API). Primary venue is chosen by the M0 verification of which one quotes USDC to native ZEC with shielded delivery today. The fill rate returned by the venue is the run's USD basis; no spot oracle.

## ADR-006 Key model and custody (5 Oct 2026)

Decision: one seed, N ZIP-32 accounts, account i pays contractor i only. Contractor receives account i's unified full viewing key; accountant receives all account UFVKs. The spending key lives in an encrypted file on the service host, unlocked with a passphrase from the environment at start, and is used only inside a run. Payslip never holds contractor funds.

Why: this is the only key arrangement on Zcash where a viewing key reveals exactly one contractor's payments (red team finding, SPEC.md).

## ADR-007 Networks (5 Oct 2026)

Decision: develop and test on Zcash testnet (NU7 activates on testnet 6 Oct with 25-second blocks). The final recorded demo run happens on mainnet (Ironwood live since 28 Jul 2026, 75-second blocks). Nothing in the demo video is mocked.

lightwalletd endpoints and their Ironwood support are a VERIFY item (SPEC.md); record the chosen endpoints under Verified facts.

## ADR-008 Memo format (5 Oct 2026)

Decision: ASCII, pipe-separated, versioned: `PS1|<run_id>|<YYYY-MM>|<invoice_ref>|<usd_basis_cents>|<rate_e6>`. Must fit 512 bytes; the codec rejects anything longer. Unknown prefixes are reported as "unlabelled", never dropped.

## ADR-009 Statements (5 Oct 2026)

Decision: the service produces CSV and JSON; the web renders statements and offers PDF through a print stylesheet. No PDF library on the service.

## ADR-010 Testing and CI (5 Oct 2026)

Decision:

- `cargo test` covers the memo codec, statement math, reconciliation and the run state machine with no network.
- Integration tests against testnet run only when `ZCASH_NETWORK=testnet` and a lightwalletd URL are set; they are skipped in CI by default.
- `web/` gets a Playwright smoke test of the three dashboards against a service started with a fixture database.
- GitHub Actions on every push: `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, `pnpm lint`, `pnpm build`. Added in M1 once the scaffolds exist.

## ADR-011 License, pre-existing code, AI tools (5 Oct 2026)

Decision: MIT from the first commit. All code in this repo is written for this hackathon; third-party crates and packages are dependencies, not pre-existing project code, and are listed in `Cargo.lock` and `pnpm-lock.yaml`. Claude (Anthropic) is used for research, specification and code generation through Claude Code and Cowork; this is stated in the README and the submission form.

## ADR-012 Out of scope (5 Oct 2026)

OUSD on Solana rail unless the mint check in SPEC.md passes; the Colosseum accelerator (Solana-only); mobile; any wallet UI for contractors (they use Zodl or Ledger).

## ADR-013 Wallet crate pin: zcash_client_backend 0.25.0-pre.0 (supersedes the default in ADR-002) (5 Oct 2026)

Decision: pin the 0.25.0-pre.0 stack exactly: `zcash_client_backend =0.25.0-pre.0`, `zcash_client_sqlite =0.23.0-pre.0`, `zcash_keys =0.17.0-pre.0`, `zcash_primitives =0.31.0-pre.0`, `zcash_proofs =0.31.0-pre.0` (bundled Sapling parameters), `zcash_protocol =0.11.0-pre.0`, `zcash_address =0.14.0-pre.0`, `zip321 =0.10.0-pre.0`.

Why: 0.24.0 does scan Ironwood (its changelog adds `ScanningKeys::ironwood`, `ScannedBlock::ironwood` and Ironwood bundle decryption), so the ADR-002 rule alone would keep 0.24.0. But 0.24.0 depends on `zcash_protocol` 0.10.x, which has no NU7 activation height for testnet, and testnet activated NU7 at height 4,465,026 on 4 Oct 2026 (branch id 0x77190AD9). A 0.24.0 wallet would sign testnet transactions with the NU6.3 branch id and the network would reject them. Only `zcash_protocol` 0.11.0-pre.0, used by the 0.25.0-pre.0 stack, carries the testnet NU7 height. Mainnet has no NU7 height in either version, so mainnet behaviour is the same. The service must run on testnet for development and on mainnet for the demo, so one pin that works on both wins.

Consequences: Rust 1.94 or newer (sqlx 0.9 requires it; the crates need 1.88). `sqlx` 0.9 and `rusqlite` 0.37 share `libsqlite3-sys` 0.35, so ADR-004 holds. The lightwalletd gRPC client comes pre-generated inside `zcash_client_backend` (`lightwalletd-tonic`), so `protoc` and `tonic-build` are not needed. Keys and addresses are emitted as ZIP 316 Revision 2 (`uvf`/`uvftest` viewing keys, `zu`/`zutest` addresses) by the library; Payslip shows addresses to outside services in Revision 0 (`u1`/`utest1`) because the faucets and 1Click were verified with that form, and accepts either revision on input.

## ADR-014 Memo record types (extends ADR-008) (5 Oct 2026)

Decision: ADR-008's pay line memo is unchanged: `PS1|<run_id>|<YYYY-MM>|<invoice_ref>|<usd_basis_cents>|<rate_e6>`, where `rate_e6` is USD per ZEC times 1,000,000. Two more record types share the version prefix:

- `PS1A|<run_id>`: allocation, on the output from the treasury (account 0) to contractor account i that funds the pay line.
- `PS1R|<run_id>|<YYYY-MM>|<funded_usd_cents>|<zec_acquired_zat>|<rate_e6>`: run funding record, on the treasury's change output of the allocation transaction, readable only with the treasury viewing key (the accountant has it, contractors do not).

Why: the key model (ADR-006) needs value to move from the treasury into contractor account i before account i can pay contractor i, and the accountant's reconciliation needs the funded USD amount on chain. Putting the funding record on the treasury change output keeps the run total away from every contractor key. Invoice references are limited to 64 printable ASCII characters without `|`, so every record fits the 512-byte field with room to spare.

## ADR-015 Swap venues: NEAR Intents 1Click primary, Maya fallback, testnet fixed-rate venue (5 Oct 2026)

Decision: `NearIntents1Click` is the primary `SwapVenue`. It quotes USDC on Base, Arbitrum, Ethereum and Solana into native ZEC and delivers into the Ironwood pool for any unified address with an Orchard receiver (verified on chain, see Verified facts). `Maya` is the fallback; it delivers shielded only through Sapling. On testnet no real venue exists (1Click has no testnet and no plans for one), so a clearly named `TestnetVenue` records a fixed rate (`PAYSLIP_TESTNET_RATE_USD`, default 1,350,000.00 USD per TAZ so a realistic USD payroll fits a faucet balance) and draws the run's ZEC from the treasury's existing testnet balance. The config refuses to start `TestnetVenue` unless `ZCASH_NETWORK=testnet`; it is never used on mainnet and never shown in the demo video.

Fill rate: the run's USD basis is the funded USD divided by the ZEC that actually arrived in the treasury, measured by scanning, not the venue's quoted `amountOut` (on chain the delivered note exceeded `amountOut` by 7,000 zat in three of three traced swaps).

## ADR-016 Web wallet integration (supersedes ADR-003's no-wallet rule) (5 Oct 2026)

Decision: the payer funds a run by sending USDC from a connected EVM wallet (wagmi v2, viem, RainbowKit) to the 1Click deposit address shown on the Fund step, with chain and amount pre-filled; the web submits the deposit tx hash to the service and polls the venue status. Contractors and accountants import viewing keys by paste or by QR scan in the browser. The service never receives a spending key from the web, and the statement endpoints reject anything that looks like a spending key or seed phrase. Wallet libraries load only on the Fund step so other routes stay light.

Why: the human operator decided this for the hackathon run on 5 Oct 2026; it removes the copy-paste deposit step from the demo.

## ADR-017 Run execution: two transactions per pay line (5 Oct 2026)

Decision: a run moves value in two hops. One allocation transaction from the treasury pays every contractor account in the run (memo `PS1A`, change memo `PS1R`); after it confirms, each contractor account i sends one payment to contractor i (memo `PS1`). The allocation for line i is the line amount plus that payment's ZIP-317 fee, so contractor accounts end each run at zero. Run states: `draft`, `awaiting_funds`, `funded`, `swapping`, `swapped`, `allocating`, `paying`, `paid`, `failed` (`allocating` is added to the SPEC list because the allocation confirmation is a real wait). Every transaction is built and stored before it is broadcast and its txid is persisted first, so a restart rebroadcasts the same transaction instead of paying twice; a transaction that passes its expiry height unmined is rebuilt.

## ADR-018 Contractor auto-convert to USDC (5 Oct 2026)

Decision: `settlement_choice` is `hold_zec` (default) or `convert_usdc`. Only `hold_zec` keeps the payment fully shielded end to end. 1Click issues a transparent `t1` deposit address for ZEC input (verified 5 Oct 2026), so a conversion leg reveals that leg's amount and the destination USDC address on the venue's explorer. Payslip records the choice and the payout address, and states this trade-off wherever the option is offered. The conversion leg runs only on mainnet through 1Click; on testnet a `convert_usdc` line is paid in TAZ to the contractor's address and marked as not converted.

## ADR-019 Endpoints and explorers (5 Oct 2026)

Decision: lightwalletd mainnet primary `https://zec.rocks:443` (Zodl's default), fallback `https://zec-node.cakewallet.com:443` (different operator). Testnet `https://testnet.zec.rocks:443`, the only public testnet endpoint that answered on 5 Oct 2026. Explorer links: mainnet `https://zecblock.com/tx/<txid>` (shows Ironwood actions), testnet `https://testnet.zecblock.com/tx/<txid>` (the only testnet explorer serving current blocks).

## Verified facts

Append one line per fact, with the date checked and the source. Agents append here as M0 items are resolved.

- 5 Oct 2026: `zcash_client_backend` newest stable 0.24.0 (19 Aug 2026); pre-release 0.25.0-pre.0 (2 Oct 2026). Source: crates.io API.
- 4 Oct 2026: Ironwood shielded pool live on mainnet since 28 Jul 2026. Source: zodl.com/ironwood-is-live-on-zcash.
- 4 Oct 2026: NU7 activation: testnet 6 Oct 2026, mainnet 5 Nov 2026; 25-second blocks after activation. Source: forum.zcashcommunity.com/t/nu7-timeline/57655.
- 4 Oct 2026: Colosseum submission and registration both close 12 Oct 2026 11:59pm PT. Source: colosseum.com/hackathon and rules PDF.
- 5 Oct 2026: `zcash_client_backend` 0.24.0 scans Ironwood: its CHANGELOG 0.24.0 section adds `ScanningKeys::ironwood`, `ScannedBlock::ironwood`, `WalletRead::get_ironwood_nullifiers`, `AccountBalance::ironwood_balance`, and `decrypt_transaction` decrypts the Ironwood bundle. Source: github.com/zcash/librustzcash tag zcash_client_backend-0.24.0, zcash_client_backend/CHANGELOG.md.
- 5 Oct 2026: NU7 testnet activation height is 4,465,026 and branch id 0x77190AD9 in `zcash_protocol` 0.11.0-pre.0 (published 1 Oct 2026); 0.10.6, the newest stable, has no NU7 testnet height. Source: librustzcash components/zcash_protocol/src/consensus.rs at tag zcash_protocol-0.11.0-pre.0 and its CHANGELOG ("This release sets the NU7 activation height to 4465026 on testnet").
- 5 Oct 2026: testnet is already on NU7. Block 4,465,025 carries branch id 37a5165b and block 4,465,026 (2026-10-04 18:21:45 UTC) carries 77190ad9; `testnet.zec.rocks` GetLightdInfo reports consensusBranchId 77190ad9 on /Zebra:7.0.0-rc.0/. Source: grpcurl GetLightdInfo and GetTransaction against testnet.zec.rocks:443.
- 5 Oct 2026: chosen pin `zcash_client_backend` =0.25.0-pre.0 with `zcash_client_sqlite` =0.23.0-pre.0 (ADR-013). Source: crates.io API dependency lists for both versions.
- 5 Oct 2026: network upgrade table from `zcash_protocol` (librustzcash main a0c73f6d4): NU6 0xC8E71055 mainnet 2,726,400 testnet 2,976,000; NU6.1 0x4DEC4DF0 mainnet 3,146,400 testnet 3,536,500; NU6.2 0x5437F330 mainnet 3,364,600 testnet 4,052,000; NU6.3 (Ironwood) 0x37A5165B mainnet 3,428,143 testnet 4,134,000; NU7 0x77190AD9 mainnet none testnet 4,465,026.
- 5 Oct 2026: after NU6.3 no value may enter the Orchard pool; a payment to a UA's Orchard receiver is delivered into Ironwood in a v6 transaction ("Ironwood shares the Orchard receiver"). Source: zcash_keys src/address.rs and zcash_client_backend src/proposal.rs `OrchardReceiverRequiresIronwood`; zodl.com/ironwood-is-live-on-zcash.
- 5 Oct 2026: per-account UFVK export from a multi-account wallet is supported without any wallet-level key: `WalletRead::get_account(id).ufvk()` returns that account's `UnifiedFullViewingKey`, accounts are created per ZIP-32 index with `WalletWrite::import_account_hd(name, seed, account_index, birthday, key_source)`, and a view-only wallet imports one with `import_account_ufvk(.., AccountPurpose::ViewOnly, ..)`. M2 exercises this against testnet. Source: zcash_client_backend 0.25.0-pre.0 src/data_api.rs.
- 5 Oct 2026: NEAR Intents 1Click quotes USDC to native ZEC (`nep141:zec.omft.near`, 8 decimals) with no API key: EXACT_INPUT 100 USDC on Base returned amountOut 0.07324588 ZEC, timeEstimate 150 s, withdrawFee 32,000 zat; Arbitrum, Ethereum and Solana USDC also quote. Recipients accepted: UA with Orchard receiver, Orchard-only UA, t1; rejected: zs1 and Sapling-only UA ("recipient is not valid"). Minimum EXACT_INPUT about 1.81 USDC. Status values: KNOWN_DEPOSIT_TX, PENDING_DEPOSIT, INCOMPLETE_DEPOSIT, PROCESSING, SUCCESS, REFUNDED, FAILED. Source: POST/GET https://1click.chaindefuser.com/v0/quote and /v0/status; OpenAPI https://1click.chaindefuser.com/docs/v0/openapi.yaml (v0.1.10).
- 5 Oct 2026: 1Click delivery to a UA is shielded into Ironwood: destination txids c3be8e48498c92aaa67361289eec08272f9c74631da3bf8d2bd3529d005db5b2 (block 3,506,516), 8f82254ba806207571f298706c3e2b89604f19c321ce3a16c1826eb739347bda and f3a0e67cc873db91728c2ae6e098008b9948895fab5334a7c10011c41b4a271f are v6 with one Ironwood action and no Orchard or Sapling outputs. In all three the delivered note exceeded the reported amountOut by 7,000 zat. Source: GET /v0/status for each swap, then api.blockchair.com/zcash/raw/transaction/<txid>.
- 5 Oct 2026: 1Click has no testnet ("There is no testnet deployment and no plans for one"). Source: docs.near-intents.org llms-full.txt FAQ.
- 5 Oct 2026: 1Click fees: without an API key the docs state an extra 0.25%; the live quote echoed appFees 20 bps. Source: docs.near-intents.org resources/fees.md and the quote response.
- 5 Oct 2026: 1Click ZEC-input quotes return a transparent deposit address (t1JjCEbkvYSfZvQLM1P8C6eXtQLawVox9PR for a 0.01 ZEC to Base USDC quote). Source: POST /v0/quote with dry=false.
- 5 Oct 2026: Maya ZEC route is live (pool ZEC.ZEC Available, about 2,013 ZEC deep; HALTZECCHAIN 0, HALTZECTRADING 0) and quotes ETH.USDC to ZEC.ZEC (100 USDC to 0.07336939 ZEC, 67 bps). It delivers to t1, zs1 and UAs through the Sapling receiver; it rejects Orchard-only UAs ("Orchard outputs are disabled from NU6.3") and has no Ironwood output and no Base USDC pool. Source: midgard.mayachain.info/v2/pools, mayanode.mayachain.info/mayachain/inbound_addresses, /mayachain/mimir, /mayachain/quote/swap; maya bifrost signer.go.
- 5 Oct 2026: lightwalletd endpoints serving Ironwood: mainnet zec.rocks:443 (LightWalletD v0.5.3, Zebra 6.3.0, branch 37a5165b, tip matched Blockchair at 3,506,519), zec-node.cakewallet.com:443 (v0.5.4, Zakura 1.6.0); both return `ironwoodCommitmentTreeSize` and an Ironwood tree in GetTreeState. Testnet testnet.zec.rocks:443 (v0.5.4, Zebra 7.0.0-rc.0, branch 77190ad9) is the only public testnet endpoint that answered; no public Zcash Foundation lightwalletd endpoint was found; lightwalletd.testnet.electriccoin.co, testnet.lightwalletd.com and zaino.testnet.unsafe.zec.rocks did not. Source: grpcurl GetLightdInfo/GetLatestBlock/GetTreeState.
- 5 Oct 2026: Zodl (formerly Zashi) defaults: mainnet zec.rocks and regional *.zec.rocks, testnet testnet.zec.rocks:443. Source: zodl-inc/zodl-android LightWalletEndpointProvider.kt.
- 5 Oct 2026: testnet faucets: fauzec.com pays 1 TAZ per address per 24 h (API `POST https://fauzec.com/api/v1/claim`), faucet.testnet.valargroup.dev pays 0.125 TAZ per IP per 24 h (`POST /api/claim`); faucet.zecpages.com and testnet.zecfaucet.com are down. Source: the faucet pages and APIs.
- 5 Oct 2026: explorer URL patterns that load real transactions: mainnet https://zecblock.com/tx/<txid>, https://mainnet.zcashexplorer.app/transactions/<txid> (no Ironwood breakdown), https://3xpl.com/zcash/transaction/<txid>; testnet https://testnet.zecblock.com/tx/<txid> only (testnet.zcashexplorer.app stops at 4,331,234).
- 5 Oct 2026: OUSD mint ousd2mJsPEckLHcSCDxyKD7NDGARZcfLbDZkKiatYHB is Token-2022 with ConfidentialTransferMint present, autoApproveNewAccounts false and auditorElgamalPubkey null (no auditor key). Payslip keeps the Solana rail out of scope (ADR-012): it would hide amounts only, not parties, and approval sits with the issuer. Source: Solana mainnet RPC getAccountInfo jsonParsed, slot 453,396,282.
- 5 Oct 2026: ZEC price reference for planning: 1Click token list showed ZEC at 1,354.93 USD. Source: https://1click.chaindefuser.com/v0/tokens.
