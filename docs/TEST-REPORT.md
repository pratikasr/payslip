# Test report

Every round runs against real Zcash testnet (NU7, `testnet.zec.rocks:443`) unless it says otherwise. Dates are UTC. Commands run from the repository root unless a directory is given.

## Round 1: unit and integration

| Date | Command | Outcome |
| --- | --- | --- |
| 2026-10-05 | `cd service && cargo fmt --check` | clean |
| 2026-10-05 | `cd service && cargo clippy --all-targets -- -D warnings` | clean, zero warnings |
| 2026-10-05 | `cd service && cargo test` | 36 unit tests and 10 executor tests passed; the 4 testnet tests skip without network variables |
| 2026-10-05 | `cd service && ZCASH_NETWORK=testnet LIGHTWALLETD_URL=https://testnet.zec.rocks:443 cargo test --test testnet` | 4 passed against live testnet lightwalletd |
| 2026-10-05 | `cd service && cargo audit` | 1,290 advisories checked against 531 crates: no vulnerabilities, exit 0 |
| pending | `cd web && pnpm lint && pnpm typecheck && pnpm build` | recorded when the web app lands |

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
