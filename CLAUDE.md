# CLAUDE.md: agent guide for Payslip

You are building Payslip, private payroll on Zcash, for the Zcash track of Colosseum's Crypto World's Fair. Submission closes 12 Oct 2026 11:59pm PT (13 Oct 12:29 IST). Every session works toward a real payroll run on Zcash mainnet, a statement engine that reads it back with viewing keys, and a submission that a judge can verify from the README alone.

## Read first, in this order

1. `docs/PROGRESS.md`: what is done, what is next, what is blocked. Start every session here and end every session by updating it.
2. `docs/SPEC.md`: the product, the key model, the flows, the demo script, the submission checklist, the VERIFY list. This is the source of truth for what to build.
3. `docs/TECH-DECISIONS.md`: stack, layout, networks, testing. These are decided; build on them. To change one, add a superseding ADR with the reason.

## Rules

- Real chain only. Development on Zcash testnet, the final demo run on mainnet. No mocked lightwalletd, no fake txids, no fixture data presented as a demo.
- Secrets never enter the repo: seeds, spending keys, passphrases, venue API keys. `.env` is ignored; `.env.example` lists variable names with empty values and a one-line comment each. Scan your diff for secrets before every commit.
- The spending key stays on the service host. What leaves the service is unified full viewing keys, one per account.
- Commit small and often with messages that say what changed and why. Push after every green milestone. Commit history is part of the submission.
- Verify before you rely. Any external fact you need (crate version, endpoint, API shape, activation height) is checked against the live source first, then recorded in `docs/TECH-DECISIONS.md` under Verified facts with the date. Do not build on memory of how a library used to work.
- No placeholders in user-facing files. If a value is unknown, write `VERIFY:` followed by the exact command or URL that resolves it.
- Keep the README's Status table and `docs/PROGRESS.md` current at the end of every session.
- Do not estimate hours, effort or capacity anywhere in this repo. Report what is done and what is next.
- Ask the human only for the items under Human decisions below, for funds, for account logins, and for anything that spends real money. Everything else, decide, record, proceed.
- Write in plain English. No em-dashes.

## Toolchain

- Rust stable (edition 2021), `cargo`, `clippy`, `rustfmt`.
- Node 22 and `pnpm` for `web/`.
- SQLite 3.
- No Protobuf compiler: the lightwalletd gRPC client comes pre-generated inside `zcash_client_backend` (`lightwalletd-tonic`), so `protoc` and `tonic-build` are not needed (ADR-013).

Commands once scaffolds exist (M1 creates them and updates this section):

```
cd service && cargo build && cargo test
cd web && pnpm install && pnpm dev
```

## Milestones

Work them in order. Each has acceptance criteria; a milestone is done when every criterion is met and `docs/PROGRESS.md` says so with the commit hash.

### M0 Verify

Resolve every VERIFY item in `docs/SPEC.md`. For each: the answer, the date, the source URL or command output, written under Verified facts in `docs/TECH-DECISIONS.md`. Decide the primary swap venue and the `zcash_client_backend` pin, and record both as superseding ADRs if they differ from the defaults.

Done when: all VERIFY boxes in SPEC.md are ticked and the facts are recorded.

### M1 Scaffold

- `service/`: `cargo new`, dependencies from ADR-002, `axum` health route, `sqlx` migrations for the four app tables, `.env.example`, `README.md` with run instructions.
- `web/`: `pnpm create next-app` with TypeScript, Tailwind, App Router; shadcn/ui; one page per role (payer, contractor, accountant) as empty shells; `.env.example`.
- `.github/workflows/ci.yml` per ADR-010.
- Root `README.md` Status table updated.

Done when: CI is green on main and both apps start locally.

### M2 Wallet core

- Seed to N ZIP-32 accounts; create account i on demand.
- Export account i's unified full viewing key as text and QR payload.
- Sync one or many accounts against testnet lightwalletd; persist state in `wallet.db`.
- Build, sign and broadcast one shielded transaction with a memo from account i.
- Memo codec (`PS1|...`) with unit tests for encode, decode, length limit, unknown prefix.

Done when: a testnet transaction sent by the service is visible to a scan with the exported FVK, memo decoded.

### M3 Runs

- REST API: contractors CRUD, runs create/fund/execute/status, pay lines.
- `SwapVenue` trait and the primary venue implementation (ADR-005); fill rate recorded as USD basis.
- Run executor as a state machine: funded, swapping, swapped, paying, paid, failed; resumable after a crash.
- SSE stream of run progress.

Done when: a run with 3 testnet contractors completes end to end from the API, each pay line has a txid and confirmed height.

### M4 Statement engine

- Scan with one FVK (contractor) or all FVKs (accountant); decode memos; join to runs.
- Per-contractor period statement: date, ZEC, USD basis, txid, height, running totals; CSV and JSON.
- Accountant reconciliation: funded USD per run against paid USD per run, variance.
- Unlabelled lines listed, never dropped.

Done when: statements for the M3 run match the run's pay lines exactly and the reconciliation variance equals the swap fill difference.

### M5 Web

- Payer: contractors, runs, fund a run (deposit address and QR), execute, live progress, pay lines with txids.
- Contractor: paste FVK, see statement, export CSV, print to PDF.
- Accountant: paste FVKs, reconciliation table, export CSV.
- Comparison line on the payer page: what a public chain would have shown versus what the explorer shows now.

Done when: the 90-second demo script in SPEC.md can be walked through on testnet without touching a terminal.

### M6 Mainnet demo run

- Switch config to mainnet; fund the payer wallet (human supplies funds).
- Run 6 contractors on mainnet; record run id, six txids and heights in the README Proof section.
- Record the demo video following the SPEC.md script; link it in the README.

Done when: the README has six mainnet shielded txids a judge can open in an explorer and a public video link.

### M7 Submission

- README final: overview, Why Zcash, architecture, proof, disclosures (pre-existing code: none; AI tools: Claude), license.
- Fill the Colosseum submission form fields listed in SPEC.md; track: Zcash.
- Flip the repo to public if it is still private.

Done when: the submission is confirmed on colosseum.com before the deadline and `docs/PROGRESS.md` records the confirmation time.

## Human decisions (ask, do not guess)

- Primary swap venue after M0 if both NEAR Intents and Maya qualify.
- Mainnet funding amount and the USDC source for the demo run.
- The six demo contractor names and whether to use generated unified addresses or real ones he supplies.
- Repo visibility flip date (private now; public is encouraged by the rules).

## Definition of done for any change

Builds, tests pass, no secrets in the diff, docs updated where behaviour changed, `docs/PROGRESS.md` updated if a milestone item moved.

## Session protocol

1. Read `docs/PROGRESS.md`. Pick the first unchecked item in the current milestone.
2. Verify any external fact you are about to depend on. Record it.
3. Build, test, commit, push.
4. Update `docs/PROGRESS.md`: what moved, commit hash, what is next, anything blocked and why.
