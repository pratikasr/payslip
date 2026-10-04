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

## Verified facts

Append one line per fact, with the date checked and the source. Agents append here as M0 items are resolved.

- 5 Oct 2026: `zcash_client_backend` newest stable 0.24.0 (19 Aug 2026); pre-release 0.25.0-pre.0 (2 Oct 2026). Source: crates.io API.
- 4 Oct 2026: Ironwood shielded pool live on mainnet since 28 Jul 2026. Source: zodl.com/ironwood-is-live-on-zcash.
- 4 Oct 2026: NU7 activation: testnet 6 Oct 2026, mainnet 5 Nov 2026; 25-second blocks after activation. Source: forum.zcashcommunity.com/t/nu7-timeline/57655.
- 4 Oct 2026: Colosseum submission and registration both close 12 Oct 2026 11:59pm PT. Source: colosseum.com/hackathon and rules PDF.
