# Payslip: Technical Decisions

Decision log in ADR form. Each entry is a decision that is already made; agents build on it rather than reopening it. To change one, add a new entry that supersedes it and say why. Dates are when the decision was recorded.

## ADR-001 One monorepo, not separate repos (5 Oct 2026)

Decision: `pratikasr/payslip` holds the service, the web app, docs and scripts.

Why: Colosseum takes one repo link per submission and judges read one README. Service and web change together (every API change touches both), and a single commit history is the cleanest proof of work. There is no shared-library or multi-team reason to split. No GitHub organization: one repo under a personal account is easier to connect to build agents and to submit.

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

Decision: develop and test on Zcash testnet (NU7 with 25-second blocks; planned for 6 Oct, a plan the chain overtook: testnet activated it at height 4,465,026 on 4 Oct, see Verified facts). The final recorded demo run happens on mainnet (Ironwood live since 28 Jul 2026, 75-second blocks). Nothing in the demo video is mocked.

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

Decision: `settlement_choice` is `hold_zec` (default) or `convert_usdc` with a payout chain (base, arb, eth, sol) and address. Only `hold_zec` keeps the payment fully shielded end to end. 1Click issues a transparent `t1` deposit address for ZEC input (verified 5 Oct 2026), so a conversion leg reveals that leg's amount and the destination USDC address on the venue's explorer. The web states this trade-off wherever the option is offered.

How it works: for a converting line the executor asks the venue for a ZEC to USDC quote (recipient the contractor's payout address, refunds to the contractor's unified address), then contractor account i sends the line's ZEC to the venue's deposit address. A transparent output cannot carry a memo, so the `PS1` memo goes on the account's change output: the allocation for a converting line is the amount plus 15,000 zat fee plus 10,000 zat change carry, and the carry stays in the contractor account. The contractor's viewing key decrypts the change, and the statement engine pairs the memo with the deposit output of the same transaction (`settlement: converted`). The conversion's outcome (USDC delivered, destination tx) is polled from the venue after the payment confirms. On testnet there is no USDC venue: the line's TAZ goes to the treasury's own transparent address, which exercises the same transaction shape on chain, and the conversion is marked `simulated`.

## ADR-019 Endpoints and explorers (5 Oct 2026)

Decision: lightwalletd mainnet primary `https://zec.rocks:443` (Zodl's default), fallback `https://zec-node.cakewallet.com:443` (different operator). Testnet `https://testnet.zec.rocks:443`, the only public testnet endpoint that answered on 5 Oct 2026. Explorer links: mainnet `https://zecblock.com/tx/<txid>` (shows Ironwood actions), testnet `https://testnet.zecblock.com/tx/<txid>` (the only testnet explorer serving current blocks).

## ADR-020 Payslip's fee on the funding swap (5 Oct 2026)

Decision: the business model is a monthly fee per active contractor plus an optional fee on the USDC to ZEC funding swap. The swap fee uses 1Click's `appFees` (`[{recipient: <NEAR account>, fee: <bps>}]`), set by `PAYSLIP_APP_FEE_BPS` (0 to 300) and `PAYSLIP_APP_FEE_RECIPIENT`; it is off by default and applies to funding quotes only, never to a contractor's conversion. 1Click deducts it from the deposit, so it lands in the run's fill rate and USD basis exactly like the venue's own fee, and it can never leave a run short of ZEC. Health reports the active `app_fee_bps` so the web can state it before the payer deposits.

## ADR-021 Payment proofs (5 Oct 2026)

Decision: a contractor can disclose one payment without handing over their viewing key. For an output their account sent, the service derives the outgoing cipher key `ock = PRF(ovk, cv, cmx, epk)` (the same derivation the sender's wallet uses) and returns a token `pp1 + base64url(version, network, pool, action index, txid, ock)`. Anyone can verify a token at `GET /api/proofs/{token}`: the service fetches the transaction from lightwalletd and opens the output with `try_output_recovery_with_ock`, which also checks the decrypted note against the note commitment in the transaction. The `ock` opens that one output only. The token reveals the amount, the recipient's Orchard receiver and the memo; not the sender, other outputs, or the key. The web puts the token in the URL fragment (`/verify#pp1...`) so it is not sent to the web host in request logs.

## ADR-022 Market value at receipt (5 Oct 2026)

Decision: contractor statements carry each payment's market value when it was mined, in a currency the contractor picks, because tax authorities usually count that (not the payer's USD basis) as income. Prices come from CoinGecko's public `coins/zcash/market_chart/range` (no key required; optional demo key via `PAYSLIP_PRICE_API_KEY`), one request per statement, cached in memory. A price point must be within 15 minutes (statements spanning a day), 2 hours (up to 90 days) or 36 hours (longer) of the block time, or the line has no value. Prices never fail a statement. Testnet statements are labelled: testnet ZEC has no market value, and testnet runs use a fixed venue rate far from the market, so the web shows market values on mainnet only.

## ADR-023 Statements-only deployment and accounting exports (5 Oct 2026)

Decision: `PAYSLIP_MODE=statements` runs the service with no seed and no wallet; it serves statements, reconciliation, payment proofs and health, and payer endpoints return 404 `statements_only`. This is what gets hosted publicly for judges, contractors and accountants. Unknown keys scan from `PAYSLIP_VIEWER_BIRTHDAY_HEIGHT` (default Ironwood activation) or a per-request `birthday_height`. Statements export as Payslip CSV and JSON, Koinly and CoinTracker CSV (contractor) and Xero and QuickBooks bank CSV (accountant). Viewing keys are shown in both ZIP 316 encodings: Revision 2 (`uvf`), canonical in `zcash_keys` 0.17, and Revision 0 (`uview`), which released wallets import.

## ADR-024 Audit fixes: runs that never got money, reconciliation from the treasury's allocation, what a proof proves (5 Oct 2026)

Decisions from the 5 Oct service audits (service-logic, security, judge and docs, portal and books). Each has a regression test; docs/API.md has the details.

- Run lifecycle. A run that received no money (no fill, no allocation) can be funded again once its quote is closed (`expired`, `refunded`, `failed`), and can be cancelled (`POST /api/runs/{id}/cancel`, new status `cancelled`, kept on record, not active). A quote whose deposit address is still open, or whose deposit the venue holds, is never replaced or cancelled away: a deposit already sent would be tracked by no run. A quote past its deadline plus 10 minutes with no deposit is `expired` wherever it is read (poll, executor, fund). Migration 0003 rebuilds `runs` for the new status (SQLite cannot alter a CHECK constraint) and adds `execute_requested`: after a restart only runs the payer executed are resumed in `awaiting_funds` or `funded`, so funding alone never pays.
- Payout details are fixed when a run is funded (`pay_lines.fixed_*`), and the API refuses address and settlement edits while a run that pays the contractor is in progress. The funding request counts each converting line's 25,000 zat overhead; 1.5 times the overhead covers fills up to a third under the indicative price.
- Failure instead of silent waiting. A payment or allocation the node refuses is shown on the line at once and fails the run with `broadcast_rejected` after three refused rebuilds. A payment or allocation that cannot find its funds for 120 blocks (longer than the 40-block expiry that holds the notes of an orphaned transaction) fails with `line_underfunded` or `treasury_insufficient`; an allocation fails at once when even unconfirmed treasury value is short. `fees_zat` counts mined transactions only.
- Reconciliation. Each run is reconciled over the whole scanned history and listed in the period of its funding record. The treasury key's view of the allocation is the expected set of payments: `incomplete_keys` when an allocated account's key is missing, `unpaid` when a supplied account shows no payment. These come before the variance check, so missing keys can no longer read as "explained". `unspent_zat` is what the treasury kept (acquired minus allocation outputs and fee), not acquired minus visible payments. Existing statuses keep their meaning. A key that holds a run funding record is treated as the treasury key in either mode. An inbound PS1 memo is unlabelled (`unexpected_direction`), never pay.
- Payment proofs. `valid` means the proof opens a real output (the note matches its commitment on chain) and the transaction is mined; an unmined one answers `valid: false, mined: false`. A proof does not authenticate the sender: the memo is the sender's claim (`asserted_by_sender`), and the response says so.
- Viewing-key scans. A key the deployment does not know starts at the earlier of the request's `birthday_height` and `PAYSLIP_VIEWER_BIRTHDAY_HEIGHT`, else Ironwood activation, never the payer wallet's birthday. A cached key asked for an earlier birthday is re-imported from it and rescanned. A scan stops when its client disconnects; a dropped lightwalletd connection is rebuilt and the scan retried once; the channel sends HTTP/2 keep-alives. Cached scans are kept for speed and can be deleted with `POST /api/statements/forget`. Statement recipients use the Revision 0 form proofs use; testnet CSVs carry no market values.
- Every error, including the framework's own rejections (malformed JSON, wrong types, oversize bodies, wrong methods), uses the `{error: {code, message, hint}}` shape.

## ADR-026 Sign-in and organisations (11 Oct 2026)

Context: the console had no login, so full mode could only bind to loopback (ADR-024's remote-payer rule). A company that runs Payslip on a host needs sign-in, roles and a record of who did what. A research note (11 Oct 2026) compared Auth.js, Better Auth, Clerk and WorkOS and the Rust crates that would let the service own sign-in itself.

Decision: identity in the web app, authorization in the service.

- The web app uses Better Auth 1.7.7 (pinned exactly): the Google provider with the optional `hd` Workspace lock (`PAYSLIP_GOOGLE_WORKSPACE_DOMAIN`), sessions in `auth.db` (SQLite through `node:sqlite`, so no native module; Node 22.16 or newer), and the JWT plugin, which mints EdDSA (Ed25519) tokens that last 5 minutes with `iss` = `BETTER_AUTH_URL`, `aud` = `payslip-service`, and the claims `email`, `email_verified`, `name`, `picture`, `google_sub`, `sid`; the public keys are at `/api/auth/jwks`. An email-and-password provider exists only when `PAYSLIP_AUTH_TEST_LOGIN=1`, for browser tests.
- The browser talks only to the web app. A Node route handler at `/api/svc/[...path]` attaches the token for the session and streams the service's answer back, Server-Sent Events included; cross-site writes are refused by the Origin check. The token never reaches browser JavaScript. Server renders attach the same token.
- The service (`PAYSLIP_AUTH=required`) checks tokens with `jsonwebtoken` 11.1.0 (`rust_crypto` backend, EdDSA only) against the JWKS at `PAYSLIP_AUTH_JWKS_URL` (cached, fetched again on an unknown key id at most once a minute), and owns `users`, `organisations`, `memberships` (admin, approver, accountant, viewer), `invitations` (token hashes only, 7 days) and `audit_log` (migration 0005). One middleware on the payer and organisation routes does token, user, bootstrap, role and the audit row; a route not in its table is read for members and admin-only to write. Statements and proofs stay public and key-based. `PAYSLIP_BOOTSTRAP_ADMIN_EMAIL` becomes the first admin; after that membership is invite-only. With sign-in required the service may bind beyond loopback.
- `PAYSLIP_AUTH=off` (the default) keeps everything as it was: no login, the "Viewing as" demo bar, the browser calling the service directly, no organisation routes (`/api/me` is 404). The testnet judge path does not change.
- `jsonwebtoken`'s `rust_crypto` backend compiles the `rsa` crate, which carries RUSTSEC-2023-0071 (a timing side channel in RSA private-key operations, no fixed release). Payslip accepts EdDSA tokens only and holds no RSA key, so `service/.cargo/audit.toml` ignores that advisory with the reason; the `aws_lc_rs` backend would avoid it at the price of a C toolchain in every build.
- Roles in this increment: admin everything; approver creates, funds, executes, cancels and discards runs; accountant reads everything, viewing keys and the audit log; viewer reads. Server-side approval, TOTP and passkeys are later increments (docs/superpowers/specs/2026-10-11-launch-plan-design.md).

Why not the alternatives: Auth.js v5 is still a beta in maintenance, has no TOTP and its session token cannot be checked by another service without the shared secret; Clerk and WorkOS cannot be self-hosted, which puts a third party in the sign-in path of a privacy product; Rust owning sign-in would mean hand-writing sessions, CSRF and account linking for no product gain. Better Auth's own organization plugin was not used because a deployment has one wallet seed and so one organisation, and the service is where money moves, so roles sit next to enforcement.

## Verified facts

Append one line per fact, with the date checked and the source. Agents append here as M0 items are resolved.

- 11 Oct 2026: npm `better-auth` latest is 1.7.7 (published 30 Sep 2026); its dependencies include `jose ^6.2.3`, `kysely ^0.28.17 || ^0.29.0`, `@better-auth/core 1.7.7` and `@better-auth/kysely-adapter 1.7.7`; peer `next ^14 || ^15 || ^16`. Source: https://registry.npmjs.org/better-auth and /better-auth/1.7.7.
- 11 Oct 2026: crates.io `jsonwebtoken` newest 11.1.0 (16 Sep 2026, MSRV 1.88); features `rust_crypto` (ed25519-dalek, rsa, p256, p384, hmac) or `aws_lc_rs` select the backend, `use_pem` is the only default. `DecodingKey::from_jwk` handles OKP keys through `from_ed_components`; the EdDSA signer reads a PKCS#8 DER private key. Source: `cargo info jsonwebtoken@11.1.0`, crate sources `src/decoding.rs`, `src/crypto/rust_crypto/eddsa.rs`.
- 11 Oct 2026: Better Auth 1.7.7's kysely adapter (`@better-auth/kysely-adapter/dist/index.mjs`) detects a `node:sqlite` `DatabaseSync` (`"createSession" in db` and `instanceof DatabaseSync`) and uses its own `NodeSqliteDialect`, which calls `statement.columns()`. Node adds `statement.columns()` in v22.16.0 (`node:sqlite` itself is unflagged from v22.13.0, "Stability: 1.1"); the Node 22 line is at v22.23.3. Source: the adapter source in node_modules; https://raw.githubusercontent.com/nodejs/node/v22.x/doc/api/sqlite.md; https://nodejs.org/dist/index.json.
- 11 Oct 2026: Better Auth 1.7.7 JWT plugin: `jwks.keyPairConfig` default `{alg: "EdDSA", crv: "Ed25519"}`, `jwt.expirationTime` default `15m`, `jwt.issuer` and `jwt.audience` default to the configured `baseURL`, `definePayload({user, session})` sets the claims and `sub` is the user id; `auth.api.getToken({headers})` mints a token for a session; the JWKS is served at `<basePath>/jwks` and each entry carries `kid` = the key's id. Private keys are stored encrypted with the secret. Source: `better-auth/dist/plugins/jwt/{types.d.mts,sign.mjs,index.mjs,utils.mjs}`.
- 11 Oct 2026: Better Auth 1.7.7 Google provider: default scopes `email profile openid`; `hd` is sent to Google and checked server-side against the ID token's `hd` claim (a missing or other domain is rejected and logged); the OAuth callback is `<baseURL><basePath>/callback/google`, so with the default base path the redirect URI is `<BETTER_AUTH_URL>/api/auth/callback/google`. The docs say the same: `http://localhost:3000/api/auth/callback/google` for local development and `https://your-domain.com/api/auth/callback/google` in production, with the Google Cloud clicks "APIs & Services, Credentials, Create Credentials, OAuth client ID, Web application, Authorized redirect URIs". Source: `@better-auth/core/dist/social-providers/google.mjs`, `better-auth/dist/api/routes/callback.mjs`, `better-auth/dist/context/create-context.mjs` (`basePath` default `/api/auth`), https://www.better-auth.com/docs/authentication/google.
- 11 Oct 2026: Better Auth 1.7.7 throws "BETTER_AUTH_SECRET is missing" without a secret and refuses the default secret in production; `telemetry.enabled` defaults to false; `emailAndPassword.enabled` defaults to false (`minPasswordLength` 8, `autoSignIn` true); `databaseHooks.user.create.before` may return `{data}` to change the user being created; `getMigrations(options)` from `better-auth/db/migration` returns `runMigrations()`, which creates the tables for the configured plugins. Source: `better-auth/dist/context/create-context.mjs`, `@better-auth/core/dist/types/init-options.d.mts`, `better-auth/dist/db/get-migration.d.mts`.
- 11 Oct 2026: Google's OpenID Connect page: OAuth clients are created and their redirect URIs set on the Cloud Console Clients page ("Create client"); the `hd` request parameter only optimises the account chooser, so the ID token's `hd` claim must be checked, and `sub` is the stable user identifier. Source: https://developers.google.com/identity/openid-connect/openid-connect. The research note (11 Oct 2026) adds, from https://support.google.com/cloud/answer/13463073 and /15549945, that apps asking only for name, email and profile need no verification review and are exempt from the Testing-status user cap.
- 11 Oct 2026: axum 0.8 `MatchedPath` is available to middleware added with `Router::layer` through the request extensions (`req.extensions().get::<MatchedPath>()`), so one guard can decide the role by the route template. Source: axum `src/extract/matched_path.rs` in the cargo registry.

- 5 Oct 2026: `zcash_client_backend` newest stable 0.24.0 (19 Aug 2026); pre-release 0.25.0-pre.0 (2 Oct 2026). Source: crates.io API.
- 4 Oct 2026: Ironwood shielded pool live on mainnet since 28 Jul 2026. Source: zodl.com/ironwood-is-live-on-zcash.
- 4 Oct 2026: NU7 activation plan: testnet 6 Oct 2026, mainnet 5 Nov 2026; 25-second blocks after activation. Source: forum.zcashcommunity.com/t/nu7-timeline/57655. The chain overtook the testnet date: NU7 activated on testnet at height 4,465,026 on 4 Oct 2026 (entries of 5 Oct below).
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
- 5 Oct 2026 (web): npm latest `next` 15.x is 15.5.27 (16.3.8 overall; 15 is pinned); `react` 19.3.0; `tailwindcss` 4.3.3; `wagmi` 2.19.5 is the latest 2.x and `@rainbow-me/rainbowkit` 2.2.11 requires `wagmi ^2.9.0`; `viem` 2.57.2; `@tanstack/react-query` 5.104.1; `qrcode.react` 4.2.0; `barcode-detector` 3.2.2 with `zxing-wasm` 3.1.3; `@playwright/test` 1.63.0. Source: `npm view <pkg> dist-tags`.
- 5 Oct 2026: ZIP 316 prefixes: UFVK `uview` (Revision 0) and `uvf` (Revision 2), testnet `uviewtest` and `uvftest`; UIVK `uivk` and `uvi` (testnet `uivktest`, `uvitest`); addresses `u`, `zu`, `tu` (testnet `utest`, `zutest`, `tutest`); no encoding exists for unified spending keys. ZIP 32 spending keys start `secret-extended-key-` (Sapling) and `secret-orchard-extsk-` (Orchard). Source: https://zips.z.cash/zip-0316, https://zips.z.cash/zip-0032.
- 5 Oct 2026: RainbowKit 2.2.11 `connectorsForWallets` passes the WalletConnect project id only to WalletConnect-based wallets; an injected-only configuration works with an empty id. Source: `@rainbow-me/rainbowkit/dist/index.js`.
- 5 Oct 2026: `@coinbase/cdp-sdk` 1.57.1, pulled in by wagmi's Base Account connector, statically imports optional `@x402/*` peers; `web/next.config.ts` aliases them to empty modules because Payslip never uses that connector.
- 5 Oct 2026: mainnet dry run of `scripts/mainnet-demo.sh` with a throwaway data directory: the service initialised on mainnet through zec.rocks:443 (tip 3,506,633), created six contractor accounts and a run of 30.38 USD, and 1Click issued a Base USDC deposit address for 32.51 USDC with the Payslip mainnet treasury unified address (Revision 0, Orchard and Sapling receivers) as recipient. No deposit was made; the throwaway data was deleted.
- 5 Oct 2026: 1Click minimum for a ZEC input is 132,000 zat ("Amount is too low for bridge, try at least 132000" for 100,000); 200,000 zat to Base USDC quoted 2.675479 USDC with timeEstimate 459 s. Source: POST /v0/quote dry runs.
- 5 Oct 2026: 1Click `appFees` schema is `[{recipient: string (NEAR account), fee: number (bps of amountIn)}]`. A dry USDC (Base) to ZEC quote for 30 USDC with `appFees [{payslip.near, 50}]` echoed `payslip.near 25` plus the 1Click account `25` (without a JWT), and amountOut fell from 2,203,179 to 2,196,409 zat (0.31%) against the same quote with no app fee (1Click 20 bps). Source: https://1click.chaindefuser.com/docs/v0/openapi.yaml (AppFee) and POST /v0/quote with dry=true.
- 5 Oct 2026: CoinGecko `GET https://api.coingecko.com/api/v3/coins/zcash/market_chart/range?vs_currency=<cur>&from=<unix>&to=<unix>` answers without an API key: a two-hour range returned five-minute points, a 30-day range 720 hourly points; ZEC was 1,351.38 USD and 128,978.61 INR. `GET /simple/supported_vs_currencies` lists 44 fiat currencies including usd, eur, gbp, inr, ngn, brl. Source: those requests.
- 5 Oct 2026: a ZIP 316 Revision 2 unified address with only an Orchard receiver encodes as `zutest1...` on testnet (`HRP_UNIFIED_ADDRESS_R2`); Payslip shows recipients in the Revision 0 form (`utest1`/`u1`) that wallets display. Source: zcash_protocol 0.11.0-pre.0 src/constants/testnet.rs.
- 5 Oct 2026: a payment proof built from Amara Okafor's testnet viewing key for txid 3c5513c5aaee0def9244a5fb02a32681a0c9b0046a0e1a16b1964c8ede83bd08 opened exactly one Ironwood output (355,555 zat, memo INV-2026-014) with no key; flipping one bit of the ock or pointing at the other action opened nothing, and the treasury key had nothing to prove in that transaction. Source: `cargo test --test testnet payment_proof` against testnet.zec.rocks:443.
- 5 Oct 2026: competitor pricing: Deel "Hire contractors" 49 USD per contractor per month (Contractor of Record 325); Rise "Global Contractor" 49 USD per contractor per month with fiat and crypto payments (Agent of Record 299). Source: https://www.deel.com/pricing, https://www.riseworks.io/pricing.
- 5 Oct 2026: Maya `GET https://mayanode.mayachain.info/mayachain/quote/swap` (ETH.USDC to ZEC.ZEC) returns `inbound_address`, `router` (0xe3985E6b61b814F7Cdb188766562ba71b446B46d), `memo` (`=:z:<destination>`), `expiry` (Unix seconds) and `expected_amount_out`; its notes say tokens go through `router.depositWithExpiry(inbound_address, asset, amount, memo, expiry)`. `GET /mayachain/tx/status/{hash}` reports `stages.inbound_observed` and `stages.outbound_signed`, and `out_txs` whose memo is `OUT:<hash>` for a delivery and `REFUND:<hash>` for a refund (tx 506F45FB...8374932). Source: those requests.
- 5 Oct 2026: `zcash_client_sqlite` 0.23.0-pre.0 rewinds the wallet to an account's birthday when the account is added (`add_account` calls `rewind_to_chain_state`, queueing a Historic rescan) and implements `WalletWrite::delete_account`; Payslip re-imports a viewing key from an earlier birthday this way, checked live by `cargo test --test testnet -- --ignored an_earlier_birthday_rescans_a_cached_key`. Source: zcash_client_sqlite src/wallet.rs.
- 5 Oct 2026: sqlx 0.9 runs a migration outside a transaction when its first line is `-- no-transaction` (sqlx-core src/migrate/source.rs), used by migration 0003 to rebuild `runs` with foreign keys off; sqlx-core 0.9.0 declares `rust-version = "1.94.0"`. axum-core 0.5.6 limits request bodies to 2,097,152 bytes by default. tonic 0.14 `Endpoint` offers `http2_keep_alive_interval`, `keep_alive_timeout` and `keep_alive_while_idle`. `bs58` 0.5.1 (already in Cargo.lock) decodes Solana addresses. Source: the crate sources in the cargo registry.
- 5 Oct 2026: `zcash_client_sqlite` 0.23.0-pre.0 keeps a `blocks` row (`height`, `hash`, `time` as Unix seconds) for every scanned block, written by `put_block` with the header's `block_time`, and deletes rows above the truncation height on a rewind (`DELETE FROM blocks WHERE height > ?`). Payslip reads a pay line's `confirmed_at` from that row, or from one lightwalletd `GetBlock` when the row is missing. Source: zcash_client_sqlite src/wallet/db.rs (table `blocks`) and src/wallet.rs (`put_block`, truncation).
