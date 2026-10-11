# Test report

Every round runs against real Zcash testnet (NU7, `testnet.zec.rocks:443`) unless it says otherwise. Dates are UTC. Commands run from the repository root unless a directory is given.

Rounds 1 to 5 ran against the first version of the web app, so the screen names in them (Share viewing key, Contractor page, Accountant page, Confirm funding, Execute run, Launch app) are that version's. The redesigned app (docs/DESIGN.md section 15) names them People, Payslip access, the contractor portal, Books, Fund from treasury and Pay N contractors; its click path is in docs/DEMO.md and its tests are in Round 6. Round 7 tests the 11 Oct additions (Fund with ZEC, sign-in, approvals, the pay schedule and payment requests) on the paper look of docs/DESIGN.md section 17.

## Round 1: unit and integration

| Date | Command | Outcome |
| --- | --- | --- |
| 2026-10-05 | `cd service && cargo fmt --check` | clean |
| 2026-10-05 | `cd service && cargo clippy --all-targets -- -D warnings` | clean, zero warnings |
| 2026-10-05 | `cd service && cargo test` | 36 unit tests and 10 executor tests passed; the 4 testnet tests skip without network variables |
| 2026-10-05 | `cd service && ZCASH_NETWORK=testnet LIGHTWALLETD_URL=https://testnet.zec.rocks:443 cargo test --test testnet` | 4 passed against live testnet lightwalletd |
| 2026-10-05 | `cd service && cargo audit` | 1,290 advisories checked against 531 crates: no vulnerabilities, exit 0 |
| 2026-10-05 | `cd web && pnpm lint && pnpm typecheck && pnpm format:check && pnpm build` | clean: eslint with zero warnings allowed, tsc strict, prettier, production build |
| 2026-10-05 | Lighthouse 13 (mobile profile, production build, testnet data) on all nine routes | performance 93 to 96, accessibility 100, best practices 100 (table in docs/DESIGN.md section 11) |
| 2026-10-05 | GitHub Actions on main (service: fmt, clippy, test, audit; web: lint, typecheck, build) | green from 0bc26dc onwards; the workflow was then disabled at the operator's request until the final commit |

What the unit and integration tests cover:

- Memo codec (`src/memo.rs`): spec format, round trip of all three record types through the 512-byte memo field, longest valid pay line fits, length limit enforced on encode and decode, unknown prefix and future version reported as unlabelled, 15 malformed variants (field count, bad UUID, uppercase UUID, impossible month, empty invoice, zero, negative, decimal, leading zero, overflow), empty and binary memos, invoice charset.
- Statement math (`src/statements.rs`): a contractor statement has only that account's lines with running totals; unlabelled lines are listed with their reason; inclusive UTC period boundaries (23:59:59 on the last day in, 00:00:00 the next day out); unmined lines are pending and expired ones vanish; CSV neutralises formula injection.
- Reconciliation: variance equals the unpaid ZEC valued at the fill rate within one cent per line; a missing funding record and pending lines are flagged; an overpayment is an unexplained variance.
- Money (`src/money.rs`): fill rate, USD to zatoshi and back within one cent, formatting to 8 and 2 places.
- Run state machine and executor (`tests/executor.rs`, against a deterministic in-memory chain): happy path pays every line once and drains contractor accounts to zero; crash (panic) after a payment is built but before its txid is recorded never pays twice; crash before broadcast rebroadcasts the same transaction; a payment dropped from the mempool expires and is rebuilt; five concurrent executes start one executor; insufficient treasury names the address to top up; disk full fails the run with a fix and resumes after space returns; venue timeouts are retried, not fatal; venue partial fill fails with a fix; a reorg after a payment is mined is detected, unconfirmed and re-recorded at the new height.
- Testnet integration (`tests/testnet.rs`): lightwalletd's consensus branch id equals the pinned library's NU7 schedule (0x77190AD9); a published contractor viewing key recovers its real payment (3c5513c5..., height 4,465,671) and decodes the memo; the treasury key reads the run funding record; the contractor key cannot.
- Seed file, viewing key parsing (spending keys, seed phrases, incoming-only keys, wrong network), venue status mapping, clock skew threshold.

## Round 2: end to end

| Date | Command | Outcome |
| --- | --- | --- |
| 2026-10-05 | `cd web && E2E_BASE_URL=http://127.0.0.1:3100 E2E_API_URL=http://127.0.0.1:8080 pnpm e2e` against a testnet service on a clean database (`scripts/fresh-testnet-env.sh e2e-2`) | passed in 3.5 minutes |

`web/e2e/demo.spec.ts` walks the SPEC demo script through the browser: onboard six contractors through the Add contractor dialog, create the run with USD amounts and invoice references, Confirm funding (testnet fixed-rate venue), Execute run, wait for all six lines to confirm over SSE, then check every txid on testnet.zecblock.com at the height the run recorded, open a contractor's viewing key from Share viewing key and read their statement on the Contractor page, export all viewing keys as JSON and import the file on the Accountant page, confirm the run row reads Reconciled, and export the CSV and check it contains all six txids.

Result (docs/proof/e2e-round2-85ea4bdc.json): run 85ea4bdc, allocation 892d24141d13bef604cdbea1896c31c8cf2f33e29a14ca6974847095d2bcbffc at 4,465,851, payments at 4,465,853:

| Contractor | Txid |
| --- | --- |
| Amara Okafor | d52d00151afe302b854d75e2280624b4a686efb31e10192f37d0484e4d3e2b6d |
| Mateo Fernandez | 2422da6829685a6ee0991d6f594691bda11e8280ee912bdf185244feeac129a1 |
| Priya Raman | 80217b62f5f3fc81b8203b4e3cf49d8085e23eee0a784f06c0b4372e22b474e6 |
| Jonas Lindqvist | 6f9d47750f1de75492af264a5de8abfb5129793b02af32569bc62f68f2b9a533 |
| Mei Chen | 7882ca13f0390c397df0c44b96253d675dbbd64032830c17b62ad76f6dc17cc8 |
| Kwame Mensah | 7ed690c2b2eba1e82e5927e351f497f6d69520954de528b09000882b15daf92d |

Two earlier attempts failed on test code, not the app: a lookup matched the hidden mobile copy of a list, and the reconciliation table's accessible name sits on its scroll region. Both locators were fixed.

### Browser tests added after Round 5

`cd web && pnpm e2e` now runs four specs. On 5 Oct 2026 the whole suite passed in one run from a clean database (`scripts/fresh-testnet-env.sh final-check-2`): 8 tests in 6.5 minutes, demo run 99bb4eca (allocation at 4,466,042, six payments at 4,466,044, docs/proof/final-check-2.json).

| Spec | What it proves |
| --- | --- |
| `e2e/demo.spec.ts` | The demo script through the browser on testnet (Round 2 above) |
| `e2e/wallet-fund.spec.ts` | The mainnet Fund step with a stand-in EIP-1193 wallet and a fixture of a real 1Click quote: Connect Wallet from an unauthorised wallet, the wallet is switched to Base (0x2105) before anything is sent, and the only transaction requested is `transfer(0x992f...b8467, 32,510,000)` on the Base USDC contract from the payer with no ETH value; the hash is reported to the service. A rejection in the wallet shows "Nothing was sent" and reports nothing. No traffic leaves the machine |
| `e2e/qr-scan.spec.ts` | The QR the payer's Share viewing key dialog renders is captured, converted to a video file and played to the Contractor page as its camera (Chromium fake capture); the page decodes exactly that key and loads the statement from the testnet service |
| `e2e/keyboard.spec.ts` | Keyboard only: skip link, Launch app, a contractor statement, the Add contractor dialog (focus moves in, stays in, Escape closes, focus returns) and the new run form's announced errors; every Tab stop must show a visible outline or ring |

Bugs these tests found and fixed:

- Buttons, text inputs, text areas and tabs showed no focus indicator. In Tailwind 4, `outline-none` sets the outline style variable to `none`, and the focus-visible outline reused it, so a 2 px outline was drawn with style `none`. Buttons now set `focus-visible:outline-solid`; inputs and text areas use their focus ring.
- Date fields lost their focus ring while a day, month or year segment had focus, because Chrome does not match `:focus-visible` on the input then. Inputs also show the ring on `:focus-within`.

## Round 3: adversarial

Run: `python3 scripts/adversarial-testnet.py` against the testnet service (2026-10-05, 20 passed, 0 failed), plus the executor tests above and a real disk-full check.

| # | Scenario | How | Expected and observed |
| --- | --- | --- | --- |
| 1 | Malformed memo in an account | Treasury sent 20,000 zat to Amara's account with memo `PS1|not-a-run|2026-13|x|0|0` (tx 9677a9862d2e..., height 4,465,687) | Statement lists it under unlabelled, reason `malformed`; not counted as a pay line |
| 2 | Memo over 512 bytes | `payslip-service send --memo` with 600 bytes | Refused before any transaction is built |
| 3 | Unlabelled transaction in an account | 20,000 zat with no memo into Mateo's account (ff2aab4d4d...) | Listed as unlabelled, reason `no_memo` |
| 4 | Formula injection in a memo | Memo `=cmd|' /C calc'!A0` into Priya's account (d9404ad9dc...) | Unlabelled `unknown_prefix`; CSV cell written as `'=cmd...` |
| 5 | Venue timeout | Scripted venue times out three times, then answers | Retried as temporary errors; run fails only on the venue's final answer |
| 6 | Venue partial fill | Scripted venue reports `INCOMPLETE_DEPOSIT` | Run fails `deposit_incomplete` with the fix in the hint |
| 7 | Service restart mid-run | SIGKILL of the service while the run was allocating, then restart | Executor resumed; each contractor's statement shows exactly one payment for the run, matching the run's txid |
| 8 | Crash between building and recording a payment | Panic inside the executor after the wallet stored the transaction | Orphan never broadcast; payment rebuilt after expiry; paid once |
| 9 | Crash before broadcast | Executor task aborted while the allocation broadcast hung | Same allocation transaction rebroadcast; one allocation only |
| 10 | Duplicate run submission | Same idempotency key twice, then 8 concurrent requests | One run per key; first 201, the rest 200 with the same id |
| 11 | Duplicate execute | Five `start` calls | One executor, one allocation |
| 12 | Wrong FVK pasted | Garbage, spaces, truncated key | 400 `invalid_viewing_key` with the fix |
| 13 | Spending key or seed phrase pasted | 24-word phrase, `secret-extended-key-...`, mixed into an accountant key list | 400 `spending_key_rejected`; nothing stored |
| 14 | Incoming-only key | `uivktest...` | 400 `incoming_viewing_key`, explains why it cannot make a statement |
| 15 | Key for the other network | Mainnet UFVK on the testnet service | 400 `wrong_network` naming both networks |
| 16 | FVK for another account | Mateo's key on the contractor page | Statement labelled Mateo; no line from any other account |
| 17 | Zero, negative, fractional, huge, string amounts | 0, -500, 12.5, 1,000,000,001 cents, "100" | 400 `invalid_amount` each |
| 18 | Period boundaries | Unit test at 23:59:59 and 00:00:00 UTC; reversed, 30 February, over a year via the API | Inclusive dates; 400 `invalid_period` |
| 19 | Clock skew | Health compares the server clock with the tip block time | Skew reported; warning past 15 minutes; statements use block times only |
| 20 | lightwalletd reorg | In-memory chain removes the block carrying the payments | Lines unconfirmed, rebroadcast, re-recorded at the new heights; paid once |
| 21 | Disk full on the wallet database | Executor test, plus a real scan into a full 4 MB RAM disk | SQLite reports "database or disk is full"; the API and executor map it to `disk_full` with "free space, then resume" |
| 22 | Invoice reference abuse | `INV|14`, non-ASCII, 65 characters | 400 `invalid_invoice_ref` / `invoice_ref_too_long` |
| 23 | Bad contractor address | Garbage, transparent `tm...`, duplicate, mainnet `u1...` | 400 `invalid_address`, 409 `duplicate_address`, 400 `wrong_network` |
| 24 | Treasury too small | Run for 9,999,999.99 USD | 409 `treasury_insufficient`, hint names the treasury address |
| 25 | Order of operations | Execute a draft | 409 `not_funded` |
| 26 | Key list limits | Empty list, 201 keys | 400 with the fix |
| 27 | CORS | Request from a foreign origin | No allow-origin header for it |
| 28 | SSE | Stream for a run; unknown run | Snapshot event first; 404 for unknown |

Failures found and fixed in this round, each with a regression test:

- An executor task that panicked left its run marked as running, so the run could never be executed again until the service restarted. Fixed with a drop guard; covered by `crash_after_building_payment_before_recording_it_never_pays_twice`.
- A payment that left the chain in a reorg would have stayed confirmed at a stale height. Lines now confirm only at the configured depth and are re-verified until the run closes; covered by `reorg_after_a_payment_is_mined_is_detected_and_reconfirmed`.
- The crash-before-broadcast test depended on machine speed and failed on the CI runner. It now waits for the exact crash point.

## Round 4: fresh clone

2026-10-05. Cloned `https://github.com/pratikasr/payslip.git` at 02f1c78 into an empty directory and followed the README Quick start word for word.

| Step | Outcome |
| --- | --- |
| 1. Clone, write `service/.env` with `printf` | ok |
| 2. `cargo build --release`, `payslip-service init` | built in 70 s; printed the treasury address and birthday |
| 3. Fund the treasury | The Valar faucet allows one payout per IP per day and had already paid this machine, so 0.03 TAZ was sent from the project's existing testnet treasury instead (tx 570b35d30e2f56bf30f73c7b6ab919609e7ac9aac5b1b8e7eb2f973871d84c45); spendable after one block |
| 4. `payslip-service serve` | healthy on 127.0.0.1:8080 |
| 5. `pnpm install`, `pnpm build`, `pnpm start` | install 6 s, build 23 s, serving on port 3000 |
| 6. The demo flow in the browser | `pnpm e2e` from the fresh clone against its own service and web app passed in 3.4 minutes (six payments confirmed at 4,465,875); `scripts/seed-testnet-contractors.sh` also works from the fresh clone |

Gaps found and fixed:

- The first draft of the Quick start appended to a copy of `.env.example`, whose empty `PAYSLIP_SEED_PASSPHRASE=` line comes first and wins in dotenv. Fixed before the run: the README writes `.env` with `printf`.
- `http://localhost:3000` opened a different app on this machine: `localhost` resolved to IPv6 `::1`, where another local server listened, while Next.js served on all interfaces. The README now opens `http://127.0.0.1:3000` and explains how to use another port with `PAYSLIP_WEB_ORIGIN`.
- Health waited behind the wallet thread during a long sync. It now uses its own lightwalletd connection and a cached wallet snapshot, answers within three seconds, and reports `syncing`.

## Round 5: demo rehearsal

2026-10-05. The demo script run end to end on testnet twice in a row, each from a clean database (`scripts/fresh-testnet-env.sh rehearsal-1`, then `rehearsal-2`), driving the browser along the click path in `docs/DEMO.md` with `pnpm e2e`.

| Rehearsal | Run | Allocation height | Payment heights | Wall clock | Outcome |
| --- | --- | ---: | --- | ---: | --- |
| 1 | 61e7687c-51b4-49c3-8836-b86570e9c8f8 | 4,465,896 | 4,465,898 to 4,465,899 | 160 s | passed |
| 2 | 2c3c69da-45f1-4a8c-92ef-6f61f0d991f4 | 4,465,907 | 4,465,909 to 4,465,911 | 185 s | passed |

Step timings, every txid and the click path are in `docs/DEMO.md`; the raw records are `docs/proof/rehearsal-1.json` and `docs/proof/rehearsal-2.json`. The driver script `scripts/mainnet-demo.sh` was also rehearsed on testnet (run 284c2421, 392 s including a release build, reconciled).

## Round 6: redesign

2026-10-05, after the redesign (docs/DESIGN.md section 15). Counts measured on 5 Oct 2026.

| Date | Command | Outcome |
| --- | --- | --- |
| 2026-10-05 | `cd service && cargo test --locked`, with no network variables set | 58 unit tests and 26 executor tests passed |
| 2026-10-05 | `cd service && ZCASH_NETWORK=testnet LIGHTWALLETD_URL=https://testnet.zec.rocks:443 cargo test --test testnet -- --ignored` | The 5 live testnet tests. They need `ZCASH_NETWORK=testnet` and `LIGHTWALLETD_URL`, so plain `cargo test` does not run them; with both set they passed 5 of 5 in 28 s during the judge-path audit of 60f4724 |
| 2026-10-05 | `cd web && pnpm exec playwright test --list` | 31 browser tests in 10 specs |
| 2026-10-05 | `cd web && pnpm e2e` | 31 of 31 passed after the redesign; after the dashboard rework 30 of 30, leaving out the demo walkthrough, which needs a clean database (docs/PROGRESS.md) |
| 2026-10-05 | Lighthouse 13.5.0, mobile, on the production build serving the demo wallet, during the judge-path audit | performance 92 to 96, accessibility 100, best practices 100 (table below) |
| 2026-10-11 | `cd web && pnpm exec playwright test --list` | 50 browser tests in 11 specs: the 46 of the suite with sign-in off and the 4 of `e2e/auth.spec.ts` |
| 2026-10-11 | `cd service && cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings && cargo test --locked && cargo audit` after sign-in (ADR-026) | 67 unit, 18 API, 28 executor and 1 price test passed; 7 live testnet tests ignored as usual; clippy clean; audit clean with RUSTSEC-2023-0071 ignored in `service/.cargo/audit.toml` (the `rsa` crate that `jsonwebtoken` compiles in; Payslip verifies EdDSA only). The API tests sign tokens with a test Ed25519 key, serve a JWKS from a test server, and cover token rejection (missing, expired, wrong key, unknown key id, wrong audience and issuer, HS256), the bootstrap admin, every payer and organisation route against every role (32 routes, 4 roles), invitations (wrong email, reuse, expiry, revocation, replacement, last admin) and the audit rows |
| 2026-10-11 | `scripts/e2e-signin.sh` (its own service on 8096 with `PAYSLIP_AUTH=required`, web app on 3304 with the test login, throwaway testnet wallet) | 4 of 4 passed in 3.7 s: the console redirects to sign in and the bootstrap email becomes admin; an admin renames the organisation and makes an invite link; a viewer joins through the link, cannot reach Run payroll and gets 403 from the service through the proxy; the audit log lists the invitation and a run's progress stream arrives through the proxy unbuffered. First runs found two bugs, both fixed with tests: a 500 when a person's first sight came as parallel requests (now race-safe), and Better Auth's production sign-in rate limit tripping the suite (now off for the test login's two paths only) |
| 2026-10-11 | After merging main (Fund with ZEC, company identity, the landing page, hosting) into the sign-in branch: `cargo fmt --check`, clippy, `cargo test --locked`, `cargo audit`; `pnpm typecheck`, `pnpm lint`, `prettier --check`; `pnpm build` with sign-in off serving `e2e/zec-fund.spec.ts` and `e2e/wallet-fund.spec.ts` on 3305 (web app only, the service a browser fixture, as their headers say); `scripts/e2e-signin.sh` with sign-in on | 70 unit, 20 API, 33 executor and 1 price test passed, clippy and audit clean; web checks green; funding specs 3 of 3; sign-in suite 4 of 4 with no service error |
| 2026-10-11 | The existing suite with sign-in off (`pnpm exec playwright test` on every spec but the demo walkthrough), against a service on 8097 and the web app on 3305 built from the same branch, with a fresh testnet wallet that holds no funds and the six demo contractors seeded | 33 passed, 7 skipped by their own data guards, 4 not run (the sign-in spec without `E2E_AUTH=1`), 5 failed, each needing a paid payment this wallet cannot have: the portal's last payment and payslip document, the keyboard tab to a payslip, a payment to prove, and the Books reconciliation of a three-key set. Those five, and the demo walkthrough, need the funded demo wallet of the 5 Oct runs; the branch does not change what they exercise with sign-in off |

| Spec | Tests | What it proves |
| --- | ---: | --- |
| `e2e/demo.spec.ts` | 1 | The demo script through the redesigned app: onboard six, approve, fund, pay, the contractor portal, Books and the CSV. Spends testnet coins; needs a clean data directory |
| `e2e/runs.spec.ts` | 3 | The runs list with status chips; a paid run's page with its figures, pay lines, drawer, Privacy view and Audit trail; the Run payroll flow prefills, validates and reaches Review without creating a run |
| `e2e/console.spec.ts` | 5 | Home renders on the server and matches the service's figures; a People row opens the detail drawer; `?add=1` opens Add contractor and Cancel saves nothing; each Payslip access invite link carries that contractor's key after `/portal#key=`; Treasury shows the receive address and balance |
| `e2e/portal.spec.ts` | 4 | Unlock by pasting a key; an invite link unlocks and the key leaves the address bar; a payslip document matches the chain and prints cleanly; tax documents download as Payslip, Koinly and CoinTracker CSV, then Lock forgets the key |
| `e2e/proof.spec.ts` | 2 | A contractor proves one payment and anyone can verify it; `/verify` asks for a proof when the link carries none |
| `e2e/books.spec.ts` | 4 | Load this company's keys reconciles every run; the key file imports and the ledger filters; every exception is listed and the accounting exports download; a seed phrase is refused and the keys are forgotten on request |
| `e2e/landing.spec.ts` | 5 | Every section is present; the product accordion; the phone layout and menu; every transaction link opens the testnet explorer |
| `e2e/keyboard.spec.ts` | 4 | Skip link and Try the live demo; the portal unlocks by keyboard; the Add contractor dialog traps and returns focus; Run payroll announces its errors |
| `e2e/qr-scan.spec.ts` | 1 | An invite link shown as a QR code is scanned by camera into the contractor portal |
| `e2e/wallet-fund.spec.ts` | 2 | The mainnet Fund step sends exactly the quoted USDC transfer on Base and reports the hash; a rejection in the wallet sends nothing |
| `e2e/auth.spec.ts` | 4 | With sign-in on (`scripts/e2e-signin.sh`): the console needs a sign-in and the bootstrap email is the first admin; an admin renames the organisation and makes an invite link; a viewer joins through the link, sees the console and cannot run payroll (the service answers 403 through the proxy); the audit log lists the invitation and run progress streams through the proxy. Skipped unless `E2E_AUTH=1` |

| Route | Performance | Accessibility | Best practices |
| --- | ---: | ---: | ---: |
| `/` | 96 | 100 | 100 |
| `/console` | 92 | 100 | 100 |
| `/console/runs` | 94 | 100 | 100 |
| `/books` | 92 | 100 | 100 |
| `/portal` | 94 | 100 | 100 |
| `/verify` | 95 | 100 | 100 |

## Round 7, 11 Oct 2026

After the launch-day work merged to main (docs/PROGRESS.md, 11 Oct 2026): Fund with ZEC (ADR-025), sign-in, organisation and roles (ADR-026), the pay schedule and payment requests (ADR-028), recorded approvals (ADR-029) and the paper look (docs/DESIGN.md section 17). Counts on main at 99604de.

| Date | Command | Outcome |
| --- | --- | --- |
| 2026-10-11 | `cd service && cargo fmt --check && cargo clippy --all-targets --locked -- -D warnings` | clean |
| 2026-10-11 | `cd service && cargo test --locked`, with no network variables set | 78 unit, 31 API, 36 executor and 1 prices test passed; the 7 live testnet tests ignored, as they need `ZCASH_NETWORK=testnet` and `LIGHTWALLETD_URL` |
| 2026-10-11 | `cd web && pnpm typecheck && pnpm lint` | clean |
| 2026-10-11 | `cd web && pnpm exec playwright test --list` | 57 browser tests in 13 specs |
| 2026-10-11 | The browser suite with sign-in off against the demo wallet (the sample company of the judge kit: six contractors, three paid runs) | 47 of 47 passed: every spec except the demo walkthrough, which pays from a clean data directory and spends testnet coins, and the two suites below, which run on ports of their own |
| 2026-10-11 | `scripts/e2e-signin.sh` (its own service with `PAYSLIP_AUTH=required`, the web app with the test login, a throwaway testnet wallet) | 5 of 5 passed |
| 2026-10-11 | `scripts/e2e-requests.sh` (its own service with sign-in off, a throwaway testnet wallet with no funds) | 4 of 4 passed |
| 2026-10-11 | axe-core accessibility scan of the paper build | 0 violations |

What the service suites cover, beyond Round 1:

- Unit (78, in `service/src`): the memo codec, statement math and reconciliation, money and the seed file as before; the pay schedule's period rules (weekly periods end on the pay day, monthly periods are calendar months, pay days validated per cadence, the draft decision follows the draft day and what a run already covers); payment requests joining their contractor's line or adding one, joined references that still fit the memo, and successors for the next period with the invoice number counted up; the role matrix, every payer write audited and the audit target; the approvals policy following the sign-in mode; the Fund with ZEC deadline; and the funding rate agreeing with the market value at receipt for the same block time.
- API (31, `service/tests/api.rs`): framework errors as JSON with a hint; statements-only mode has no payer endpoints; idempotency and period overlap; sign-in: tokens checked before anything else, the bootstrap admin then invite-only membership, invitations accepted once by the invited email before they expire, the role matrix over every payer route, every write on the audit log, a first sight that survives parallel requests, and sign-in off keeping the old behaviour; Fund with ZEC answering the treasury address, amount, rate and deadline; a run over the cap refused at creation; approvals by each role once each and never by the creator at two, execute refused until the approvals are in, none needed with sign-in off, an approved draft that can still be discarded; requests keyed by the contractor's viewing key and validated, approved or rejected from the queue, joining a run for their period; a contractor's default amount; the schedule drafting from default amounts and approved requests and passing over a period a run already covers.
- Executor (36, `service/tests/executor.rs`, against the in-memory chain): the Round 1 and Round 3 cases (crashes, rebroadcast, expiry, reorg, disk full, venue timeouts and partial fills) plus Fund with ZEC (the run is funded when the treasury balance confirms, the shortfall shows until the rest arrives, an expired request can be funded again or cancelled, two runs awaiting ZEC claim the balance in creation order, a run over the cap is refused), approvals (the swap is recorded only once the run is approved, and a run resumed after a restart waits for its approvals), and a paid request carrying its txid with a recurring one repeating.
- Prices (1, `service/tests/prices.rs`): recent statement prices are cached.
- Live testnet (7, ignored without network variables): the 5 of Round 6 plus an earlier birthday rescanning a cached key, and the judge kit reconciling while a partial key set is flagged.

| Spec | Tests | What it proves |
| --- | ---: | --- |
| `e2e/demo.spec.ts` | 1 | The demo script through the app: onboard six, approve, fund, pay, the contractor portal, Books and the CSV. Spends testnet coins; needs a clean data directory, so it is not in the 47 |
| `e2e/runs.spec.ts` | 3 | The runs list with its status chips; a paid run's page with its figures, pay lines, drawer, privacy view and audit trail; the Run payroll flow prefills, validates and reaches Review without creating a run |
| `e2e/console.spec.ts` | 10 | Home renders on the server and matches the service's figures; Export makes the payroll CSV and the auditor package; People opens and closes the detail drawer, `?add=1` opens Add contractor and Cancel saves nothing; each Payslip access invite link carries the key, name and birthday, masked until revealed; Treasury shows the receive address and balance; privacy mode blurs amounts, keys and addresses and survives a reload into Run payroll; search finds a person and a run; the demo bar names the network on the first paint, phones included |
| `e2e/portal.spec.ts` | 7 | The first click on Open payslips opens the portal at 1440 and at 375 pixels; the demo key opens the judge kit's contractor by name on any testnet service; a pasted key unlocks; an invite link unlocks and the key leaves the address bar; a payslip document matches the chain and prints cleanly; tax documents download as Payslip, Koinly and CoinTracker CSV, then Lock forgets the key |
| `e2e/proof.spec.ts` | 3 | A contractor proves one payment and anyone can verify it; a viewing key opened as a proof is refused in the browser and never sent; `/verify` asks for a proof when the link carries none |
| `e2e/books.spec.ts` | 7 | The judge kit the web app serves is the published one; Load the judge kit loads it with one click and names every payment; a key set missing contractors never reads as reconciled; Load this company's keys reconciles every run; the key file imports and the ledger filters; every exception is listed and the accounting exports download; a seed phrase is refused and the keys are forgotten on request |
| `e2e/landing.spec.ts` | 7 | Every section is present, in order; the hero shows one payment in two copies; the reveal plays once, and not at all with reduced motion; every transaction link opens the testnet explorer; every focus stop shows focus; the phone menu opens, jumps and closes; the phone header stays reachable after scrolling |
| `e2e/keyboard.spec.ts` | 6 | Skip link and Try the live demo; the portal unlocks by keyboard; the Add contractor dialog and the person drawer take and return focus; Run payroll announces its errors and moves focus to each new step's heading |
| `e2e/qr-scan.spec.ts` | 1 | An invite link shown as a QR code is scanned by camera into the contractor portal |
| `e2e/wallet-fund.spec.ts` | 2 | Fund with USDC sends exactly the quoted transfer on Base and reports the hash; a rejection in the wallet sends nothing (service and wallet are fixtures) |
| `e2e/zec-fund.spec.ts` | 1 | The Fund step offers ZEC and USDC, and the ZEC card shows the treasury address, amount, rate and shortfall (the service is a fixture, since a real deposit moves money) |
| `e2e/auth.spec.ts` | 5 | With sign-in on (`scripts/e2e-signin.sh`): the console needs a sign-in and the bootstrap email is the first admin; an admin renames the organisation and invites a viewer; the viewer joins through the link, sees the console and cannot run payroll; the audit log lists the invitation and run progress streams through the proxy; recorded approvals: the admin's run needs two other approvers before it can be paid. Skipped unless `E2E_AUTH=1` |
| `e2e/treasury-key.spec.ts` | 3 | With `scripts/e2e-treasury-key.sh` (a service with no seed file, sign-in on): the first admin creates the treasury key in the browser, a wrong check word and a short or mismatched passphrase are caught first, only an age ciphertext with one scrypt stanza reaches the service and the address comes back; the admin locks the key, the TREASURY LOCKED stamp shows on every page, a wrong passphrase is refused and the right one unlocks it for an hour; a viewer reads the key page without actions and the service answers 403 to a lock. Skipped unless `E2E_TREASURY=1`, and on a service whose health lacks `treasury` |
| `e2e/requests.spec.ts` | 4 | With `scripts/e2e-requests.sh`: a contractor sends a request from the portal and sees it as Sent; the payer approves one with a note and rejects another; Run payroll offers the approved request as a prefilled line and the run takes it; a pay schedule saved on its draft day drafts this month's payroll from default amounts. No coins needed |
