# Progress log

Newest entry first. One entry per session: what moved, commit hashes, what is next, what is blocked and why.

## 12 Oct 2026, the first mainnet payroll

- Hosted on mainnet: the server at app.payslip.cash and payslip.cash (deploy/aws/attach-domain.sh, Cloudflare DNS-only records, ACM certificate), `ZCASH_NETWORK=mainnet`, `LIGHTWALLETD_URL=https://zec.rocks:443`, sign-in required with open membership as viewer, the basic-auth gate removed from the console distribution, no `PAYSLIP_SEED_PASSPHRASE`: the owner made the treasury key in the browser (ADR-030) and unlocks it for a run.
- The run: `dfdc9d29-75a3-4197-8bb4-21b2f6175fea`, funded with ZEC from the owner's Zodl wallet ($10.70 at $1,331.56 per ZEC), one contractor (Biqtor, the owner's own address) paid $10.00. Allocation 4c0d68d2... at 3,514,840, payment 53f87ab5... at 3,514,845, both Ironwood with 2 actions and a 0.0001 ZEC fee on api.zecblock.com; "Run paid: 1 lines confirmed" at 05:04 UTC. Written into the README Proof section and Status table.
- Fixes found on the way: a cancelled run was replayed because its idempotency key stayed taken and the stored draft matched it (5188376); a run row's link covered the whole page (fdf44fa); health answers the chain tip from a 20-second cache so the console stops waiting on lightwalletd (18f5bb9); the Fund step shows an incoming line that counts confirmations while a ZEC deposit confirms, with `min_confirmations` in health (306077d); the draft summary's rate and fee lines no longer assume the USDC quote (this commit).
- Docs: the demo video script and shot list point at app.payslip.cash and payslip.cash and allow the take to show the paid run instead of a new one (DEMO.md); the live links in SUBMISSION.md.
- Deployed on the server: fdf44fa. Not yet deployed: 306077d and this commit (web only); the owner asked for no server update until the run completed, and decides when.
- The mainnet judge kit: the owner exported the two viewing keys from Payslip access; a local statements-only service on mainnet (`PAYSLIP_MODE=statements`, zec.rocks, birthday 3,514,687) read Biqtor's statement, the accountant's reconciliation (reconciled, $0.70 variance explained: 0.0002 ZEC fees, 0.00032581 ZEC unspent; the owner's memo-less deposit listed as unlabelled) and the payment proof in 7 seconds. Published as docs/judge/judge-kit-mainnet.json and web/public/judge-kit-mainnet.json, read-back in docs/proof/mainnet-dfdc9d29.json. Books offers Load the judge kit on mainnet too (`judgeKitUrl(network)`).
- The landing page hero is the real payment (Biqtor, $10.00, 0.00750999 ZEC, block 3,514,845, the kit's proof token); the sample company's testnet payrolls stay in the payments table under their own label.
- Two doors: people landed on the wrong host (a contractor signing in on the console, a company on the portal). The landing page now opens with three entrances named by who you are (company console on `NEXT_PUBLIC_PAYSLIP_CONSOLE_URL`, portal and Books on `NEXT_PUBLIC_PAYSLIP_PORTAL_URL`), the header says Run payroll, the sign-in card tells a contractor there is nothing to sign in to and links the portal, and the portal tells a company where the console is. Both web images get `NEXT_PUBLIC_PAYSLIP_CONSOLE_URL=https://APP_HOST` (deploy/compose.yml, Dockerfile.web).
- Checks: `pnpm typecheck` and `pnpm lint` clean; browser: landing 7 of 7, books, portal and sign-in-off 14 of 14 against the local demo wallet.
- Deployed: 7d40890 (kit, hero, two doors) at 06:09 UTC and b078f73 at 06:29 UTC (app-web) and after it (books-web); the service image unchanged, the treasury stayed unlocked. Read back from the hosted site after the deploy: Books loaded the mainnet kit and reconciled the run; the portal opened Biqtor's payslip; the proof page checked the payment.
- Privacy notice and terms of use (b078f73): `/privacy` and `/terms` on both hosts, linked from the footer, for the Google consent screen of a published app. The owner published the Google OAuth app (Audience: In production, External), so any Google account can sign in; with `PAYSLIP_OPEN_MEMBERSHIP=viewer` it joins Payslip Labs as a viewer.
- Submission material: the project graphic and the screenshots of the hosted pages are in the git-ignored `web/screenshots/`; docs/SUBMISSION.md carries the proof, the live links and the access instructions; docs/LAUNCH.md's pitch says "a real payroll", not "real people", because one contractor was paid, and names the one-company-per-copy limit.
- Next: the owner records the two videos, makes the repository public and submits the Colosseum form.

## 12 Oct 2026, the company controls its treasury key (ADR-030)

- Service: `PAYSLIP_SEED_PASSPHRASE` is optional. With it set nothing changes (`unlocked_by_env`). Without it the service starts with the treasury locked (syncing, reads, statements, Books, proofs and drafting work; executing, moving, adding a contractor answer `409 treasury_locked`; the executor parks a run at its next signature and resumes on unlock) or with no key at all (`treasury: "no_key"` in health; spending and funding answer `409 no_treasury_key`). New endpoints under `/api/treasury`: `GET key`, `POST unlock`, `POST lock`, `POST key` (an armored age file the browser encrypted with the company's passphrase), `POST key/replace` (sweeps the old treasury to the new key, retires the old files, derives every contractor account again with `key_rotated_at`), `POST move` (sweeps to an outside shielded address; transparent refused). Admin-only, audited; migration 0008 (`treasury_keys`, `contractors.key_rotated_at`). docs/API.md has a Treasury key section with the trust statement.
- Checks: `cargo fmt --check` and `cargo clippy --all-targets --locked -- -D warnings` clean; `cargo test --locked` 84 unit, 39 API, 38 executor and 1 prices test passed, 7 live testnet tests ignored as usual.
- Next: the web's Settings page for the key (generate 24 words, encrypt with `age-encryption` 0.3.1 in the browser, upload; unlock dialog; "share the new viewing key" from `key_rotated_at`), and `deploy/compose.yml`, which still requires `PAYSLIP_SEED_PASSPHRASE`.
## 12 Oct 2026, the treasury key in the browser (web)

- The company's spending key is made and sealed in the browser (`web/src/lib/treasury-key.ts`): a BIP-39 phrase of 24 English words from Web Crypto randomness (`@scure/bip39` 2.4.0), encrypted with the admin's passphrase in the age format with one scrypt stanza at 2^18, armored (`age-encryption` 0.3.1, typage). Only the ciphertext goes to the service; verified that the service's own `seed-phrase` command (Rust `age` 0.12.1) opens a browser-made file and refuses a wrong passphrase (TECH-DECISIONS, Verified facts, 12 Oct).
- Console: when health says `treasury: "no_key"` the console is the "Create your treasury key" sheet for an admin (Create with the words shown once, a written-down check box and three words asked back, or Import by pasting; a passphrase of 12 or more characters typed twice; the address on success) and a notice for other roles. New page `/console/settings/treasury-key` (state, address, birthday, storage path, "How it is protected", "Who can spend it" word for word, Unlock with hours, Lock now, Replace key with the re-share warning and the sweep, Move treasury confirmed twice; admin actions, others read), linked from Settings and the Treasury page. A red TREASURY LOCKED stamp beside the network badge while locked; the Pay step, the funding cards and a parked run ("Waiting for the treasury to be unlocked") show an Unlock prompt in place; People, the person drawer, Payslip access and the home to-do mark "New viewing key, share again" when `key_rotated_at` is newer than `fvk_shared_at`.
- Types in `lib/api.ts` (`TreasuryKey`, `Health.treasury`, `Contractor.key_rotated_at`, the `treasury_locked`, `no_treasury_key` and `key_exists` codes), `manage_treasury_key` in `lib/roles.ts` (admins), `treasury` in the server's first-paint hint. `web/e2e/treasury-key.spec.ts` with `scripts/e2e-treasury-key.sh` (ports 8097 and 3322, a service with no seed), skipped on a service whose health lacks `treasury`.
- Depends on the service: `GET /api/treasury/key`, `POST /api/treasury/unlock|lock|key|key/replace|move`, `treasury` in health, `key_rotated_at` on contractors, `serve` starting with no seed, and the executor parking a run with error code `treasury_locked` (docs/API.md, Treasury key, once it lands). The browser suite above runs for real once those are in; until then it skips.

## 11 Oct 2026, launch day minus one

- Hosted: deploy/aws/provision.sh run by the owner (EC2 i-04ae135fca593129a, us-east-1), the server installed and started from deploy/README.md; the public statements page answers at https://dkg1ye1jxb6hs.cloudfront.net and the company console at https://d3oq3i7c2bwb9p.cloudfront.net (basic auth). Books loaded the judge kit there and reconciled the three testnet payrolls in 68 seconds on the first scan; the portal demo key opened Amara Okafor's payslips.

The day followed the launch plan agreed with the owner on 11 Oct (`docs/superpowers/specs/2026-10-11-launch-plan-design.md`, kept out of the repo until the owner reviews it). Several engineers worked on branches in parallel and merged to main; this entry replaces their separate notes. Main is at 99604de, 28 commits ahead of origin, every one unsigned because the signing key needs the owner's passphrase.

What moved, with commits:

- Dependencies: postcss and ws pinned to patched versions, which clears the three high advisories from `pnpm audit --prod`; the two moderate ones left run only on the Fund step (91e8429).
- Company identity and sample labels: the employer's name and mark on the console, portal, payslip, Books and proof; on testnet each of those screens says it is a sample company, and on mainnet none of the labels render (35b174c).
- Scripts for the last day: the pitch video script (272 spoken words, under two minutes) in docs/LAUNCH.md, the demo video script and shot list in docs/DEMO.md, and the owner's run-day checklist in docs/RUN-DAY.md (e2cde0c).
- Fund with ZEC (ADR-025): the payer sends ZEC to the treasury; the run is funded when the confirmed balance, net of what other runs claim, covers it, and the rate of that block is the USD basis, recorded in `PS1R` as for any venue; partial deposits show the shortfall, an unfunded request expires after 24 hours, and `PAYSLIP_MAX_RUN_USD_CENTS` caps one run. The Fund step offers Fund with ZEC beside Fund with USDC off testnet; `scripts/mainnet-demo.sh` takes `DEMO_FUNDING=zec` (602b6c2, merged in 95731f5).
- Hosting (ADR-027): `deploy/` with images for the service and the web app, a compose file for the public statements pair and the company pair, a Caddy front that answers only requests carrying the CloudFront origin secret, install and encrypted backup scripts, and `deploy/aws/provision.sh` and `destroy.sh` for one EC2 instance behind two CloudFront distributions. Images built and smoke-tested locally; the AWS scripts were checked against the CLI's help and have not run against an account (88b56e2).
- Sign-in, organisation and roles (ADR-026): Better Auth 1.7.7 with Google in the web app and a same-origin proxy at `/api/svc` that attaches the token; in the service, EdDSA token checks with `jsonwebtoken` 11.1.0, migration 0005 (users, organisations, memberships, invitations, audit log), the roles admin, approver, accountant and viewer per route, and an audit row for every write; Members, Invitations, Audit log and Settings pages. Off by default, so the testnet demo is unchanged (47c5912, merged in 9e25a0b; landing focus test 8bf2c8d).
- Pay schedule and payment requests (ADR-028): migration 0006; a scheduler that drafts the next run from default amounts and approved requests, and never funds or pays; portal requests keyed by the viewing key; the payer's queue with approve and reject; approved requests become prefilled lines, are marked paid with the line's txid, and a recurring one creates its successor (06ca771, merged with sign-in in 1864859).
- Recorded approvals (ADR-029): migration 0007, `POST /api/runs/{id}/approve` and `PAYSLIP_APPROVALS_REQUIRED` (1 with sign-in on, 0 with it off). Execute answers `approvals_required` and the executor will not record the swap for a run short of approvals, including one resumed after a restart; at two or more the run's creator cannot approve it (5123c66, merged in f0ec9e5). A scheduled draft has no creator, so any approver may approve it (d31011a). Approvals list in the order they were recorded, which fixed the sign-in suite's one flaky order (dccc5eb).
- The look, in three steps. The landing page rebuilt around one payment seen two ways (8b428e3); that identity across the console, portal and Books, with one shared two-views component (DESIGN.md section 16: e1eafc5, 3ef3b96, Geist in 26da6f9, merges 475043c, cff0a6c and d19dc4b). The owner then chose the paper look from two rounds of specimens (DESIGN.md section 17, ca05e10): Redaction 35 for inked headlines, Courier Prime for forms and data, DotGothic16 for amounts, Libre Franklin for text; the foundation and the landing page (631df48); the portal, Books and the public proof (242e00c); the company console (99604de). Every payment is a pay advice on paper, and the explorer's view is its yellow carbon copy with the private fields inked out.
- Progress notes during the day (33b2b6d, 3b991fc), folded into this entry.

Checks on main at 99604de:

- Service: `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings` clean; `cargo test --locked` 78 unit, 31 API, 36 executor and 1 prices test passed, 7 live testnet tests ignored as usual (they need `ZCASH_NETWORK=testnet` and `LIGHTWALLETD_URL`).
- Web: `pnpm typecheck` and `pnpm lint` clean. Browser: 57 tests in 13 specs. 47 of 47 passed against the demo wallet (every spec but the demo walkthrough, which pays from a clean data directory, and the two suites that run on their own ports); `scripts/e2e-signin.sh` 5 of 5, the fifth being recorded approvals; `scripts/e2e-requests.sh` 4 of 4. axe-core: 0 violations. Details in docs/TEST-REPORT.md, Round 7.
- Lighthouse was last measured on the section 16 build, before the paper pass: mobile performance 97 on `/`, 94 on `/console`, 92 on `/books` and 92 on `/portal`; accessibility and best practices 100 on all four.

Not done:

- Action counts on the run page, payslip and proof. The service reports none for a run's transactions or a proof; it needs to count each transaction's actions from its wallet database and return them (DESIGN.md section 16, Applied across the app).
- After the deadline, from the launch plan: TOTP and passkeys, the treasury transaction signed on a Ledger through PCZT, padding the allocation transaction so headcount is not visible, the library update that carries the mainnet NU7 height before 5 Nov 2026, and email notifications.

Operator notes for the mainnet run with Fund with ZEC: the wallet must be synced before funding (the balance comes from the background sync, every 30 seconds); send the full amount shown, shielded, from a wallet whose change does not come back to the treasury; fund one run at a time, since deposits are not tied to a run and the earliest request takes the balance; the run is funded at the rate of the block in which the ZEC reaches `PAYSLIP_MIN_CONFIRMATIONS`, not the request-time rate; prices must be on (`PAYSLIP_PRICE_API_URL` not `off`).

Next: the owner works through docs/RUN-DAY.md; then the session copies the mainnet run's txids and heights into the README Proof section, publishes the mainnet judge kit in docs/judge/, and flips M6 and M7 in the README Status table and here, with the submission's confirmation time.

Blocked on the owner:

- The ZEC: about 0.05 ZEC in the shielded balance of the owner's own Zashi (RUN-DAY.md, item 3).
- The three contractors: name, `u1` address and each person's yes to having their viewing key published in the mainnet kit.
- The GitHub collaborator invite for hackathon@colosseum.com, role Read.
- AWS provisioning: `deploy/aws/provision.sh` from the owner's account, then deploy/README.md (this session's permission layer cannot run AWS commands).
- The Google OAuth client and its redirect URI (README, Sign-in).
- The two videos, pitch and demo, and their YouTube links.
- The Colosseum form: country, Telegram, X, the video links (docs/SUBMISSION.md).
- GPG: unlock the signing key, re-sign the 28 commits, then push.

## 5 Oct 2026, a fuller, calmer company dashboard

- The owner found the internal dashboard still not premium. Compared with Mercury's dashboard, it had an empty hero card (one payroll, nothing to chart), counter cards of zeros, coin amounts under every figure, a block height in the top bar, and a gold tag on every row.
- The demo company now has three months of real testnet payroll (July and August paid through the API in the clean demo wallet, September is rehearsal 3; docs/proof/demo-wallet-runs.json), so charts, payslip lists and the books have history.
- Company home rebuilt: a hero with paid-this-year and monthly bars, treasury in dollars with how many payrolls it covers, the next payroll as a dated card, and a to-do list written as sentences; the counter cards and the half-empty "Payroll movement" section are gone. Tables use calm "Paid" tags with one note that every payment is shielded; dollars lead on the treasury and run pages; runs and payslips order by pay period; avatars get a colour per person; the top bar shows only the network.
- Checks: browser suite 30 of 30 (the demo walkthrough needs a clean database and passed in the previous entry); 102 screenshots with no horizontal scroll.

## 5 Oct 2026, redesign in Mercury's style and a clean demo wallet

- The owner judged the first look too basic. Five research agents studied Request Finance, Ontop, Wise, Remitly, Revolut Business, Mercury, Ramp, Brex, Deel, Rippling, the Zcash brand and crypto payroll tools and audited the app; the owner chose a redesign informed by Mercury's banking app (layout conventions), with Payslip's own mark, colour and components. Decision and system recorded in docs/DESIGN.md section 15.
- Rebuilt every screen: the landing page; the company console (home, payroll runs, a full-screen Run payroll flow with a review and approve step before any money moves, the run page with Pay lines, Privacy view and Audit trail, People with a detail drawer, Payslip access with invite links, Treasury); the contractor portal (unlock by key, QR or invite link, home, payslips, payslip document with Share proof, tax downloads); the accountant books (reconciliation, ledger, exceptions, Xero and QuickBooks exports); and the public payslip page. Old /app routes redirect.
- Service: reconciliation now reports `difference_usd_cents` and `rounding_tolerance_cents`, so a cent of rounding is shown rather than hidden; "to the cent" claims removed from the docs. `invalid_invoice_ref` documented.
- Clean demo wallet: a new testnet seed (data folder `demo-clean-2`, birthday 4,466,858) holding the leftover test coins, so the contractor, accountant and company see the same single run. Rehearsal 3 through the new app: run 09019bd8-d31d-400b-a779-050afeb3083e, six payments at 4,466,912, 2.2 minutes (docs/proof/rehearsal-3.json). Judge kit regenerated from this wallet.
- Checks: service fmt, clippy, unit and executor tests; web format, lint, typecheck, build; browser suite 31 of 31 (demo walkthrough, runs, console, portal, proofs, books, landing, keyboard, camera QR, wallet funding); mobile Lighthouse on the main pages 91 to 96 performance, 100 accessibility and best practices; 102 screenshots with no horizontal scroll.
- Next: the owner reviews the screenshots, then push; then the human steps below.
- Blocked: mainnet funds and DEMO_REFUND_ADDRESS; a hosting account for the public statements page; a NEAR account to receive the swap fee (optional); the Colosseum account and videos (human).

## 5 Oct 2026, judge-ready features and frontend polish

- Payment proofs (ADR-021): a contractor creates a link that discloses one payment and nothing else; `GET /api/proofs/{token}` verifies it against the chain with no key. Live testnet test: Amara's payment 3c5513c5... opens with the proof, a one-bit change or the other action opens nothing, the treasury key has nothing to prove. Web: Prove on each statement line, public `/verify#pp1...` page that prints as a payslip with a QR code.
- Market value at receipt (ADR-022): statement lines carry the CoinGecko ZEC price nearest the block time in 44 currencies; shown on mainnet only because testnet runs use a fixed rate.
- Exports (ADR-023): Koinly and CoinTracker for contractors, Xero and QuickBooks for the accountant. Statements-only mode (`PAYSLIP_MODE=statements`) for a public judge deployment; viewing keys also shown in the Revision 0 form wallets import.
- Swap fee (ADR-020): optional 1Click app fee on the funding swap, off by default; a dry quote confirmed 1Click accepts it.
- Repeat a run: the new run form copies the last run's amounts.
- Frontend: richer landing page (unseal animation, roles, every testnet txid, pricing), first-run setup guide, payroll insights charts, live run progress, presenter mode for recordings. Lighthouse mobile on all nine routes: performance 94 to 97, accessibility and best practices 100.
- Judge kit: docs/judge/judge-kit-testnet.json (testnet viewing keys and a payment proof); `scripts/mainnet-demo.sh` writes the mainnet kit. README "Check it yourself" section, pricing (Deel and Rise list 49 USD per contractor per month, verified). docs/LAUNCH.md: presentation and demo video scripts, outreach drafts.
- Commits: 421a520 (service), 9cba25b (web), 3153429 (docs), 4834748 (screenshots).
- Checks: service fmt, clippy, 44 unit, 11 executor and 5 live testnet tests; web format, lint, typecheck, build; browser suite 13 of 13 (proof, keyboard, wallet funding, camera QR, payer guide). No testnet coins spent.
- Next: the human steps below, then the mainnet run and recording.
- Blocked: mainnet funds and DEMO_REFUND_ADDRESS; a hosting account for the public statements page; a NEAR account to receive the swap fee (optional); the Colosseum account and videos (human).

## 5 Oct 2026, frontend gaps closed

- Wallet funding path verified short of signing: a stand-in wallet proves the Fund step switches to Base and requests exactly the quoted USDC transfer to the 1Click deposit address, reports the hash, and handles a rejection (web/e2e/wallet-fund.spec.ts).
- Camera QR verified: a viewing key QR from the share dialog is decoded from a fake camera into a statement (web/e2e/qr-scan.spec.ts).
- Keyboard-only flows verified (web/e2e/keyboard.spec.ts). Found and fixed: no visible focus indicator on buttons, inputs, text areas and tabs; date fields losing their ring.
- Dark mode screenshots for every screen; activity heights formatted.
- Full browser suite (8 tests) passed from a clean database; Lighthouse unchanged or better (performance 94 to 96, accessibility and best practices 100).
- Remaining frontend item: WalletConnect (phone wallets) needs a project id in NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID; browser extension wallets work without it.

## 5 Oct 2026, M1 and M5 done; all five test rounds passed; M6 and M7 prepared

- M1 Scaffold: done. Service, web and CI; CI green on main from 0bc26dc (web job needed pnpm pinned through packageManager). The workflow was then disabled at the operator's request and is re-enabled by the final commit of this session.
- M5 Web: done (778c7cc, 6200163, fa8de28). docs/DESIGN.md research and design system; landing page and the three role apps; USDC funding from a connected EVM wallet (wagmi 2, viem, RainbowKit, loaded only on the Fund step); viewing keys by paste, file or QR; live SSE progress; statements with CSV and print to PDF. Two screenshot reviews at 375, 768 and 1440 px (docs/screenshots, findings in DESIGN.md section 13). Lighthouse mobile on all nine routes: performance 93 to 96, accessibility 100, best practices 100. The demo script runs through the browser on testnet without a terminal.
- Contractor auto-convert to USDC (ADR-018): built and verified on testnet (run d9248c70, tx 118c665f..., memo on the change output, reconciled); on mainnet it runs through 1Click (minimum ZEC input 132,000 zat, about 7.6 minutes per conversion).
- Test rounds (docs/TEST-REPORT.md): Round 1 unit, executor and live testnet integration tests, clippy, audit, web checks, all green. Round 2 Playwright demo script on testnet, passed (run 85ea4bdc). Round 3 28 adversarial scenarios, 20 against the live service including hostile memos on chain and SIGKILL mid-run; three bugs found and fixed with regression tests. Round 4 fresh clone into an empty directory following the README, passed; README gaps fixed. Round 5 two rehearsals from clean databases, 160 s and 185 s, passed (docs/DEMO.md). A last clean-database run after the final web change passed: run 8e8211f1, allocation at 4,465,943, six payments at 4,465,945.
- M6 Mainnet: prepared. scripts/mainnet-demo.sh rehearsed on testnet (run 284c2421) and dry-run on mainnet with a throwaway data directory up to the 1Click deposit address (32.51 USDC on Base for the small example payroll); no funds moved and the throwaway data was deleted. `scripts/demo/mainnet.env` (git-ignored, with a fresh mainnet passphrase and generated demo wallets) and `scripts/demo/contractors.mainnet.json` are ready on this machine. Needs: the USDC deposit and the payer's EVM refund address (DEMO_REFUND_ADDRESS), then the recording.
- M7 Submission: prepared in docs/SUBMISSION.md. Needs: Colosseum registration of every team member, team fields, the two videos, the repo visibility decision (private today).
- Testnet funds: about 0.11 TAZ in the testnet treasury after recycling; enough for several more six-contractor runs.
- Next: the human steps above, then copy the mainnet proof into the README and flip M6 and M7.
- Blocked: mainnet funds and the Colosseum account (human).

## 5 Oct 2026, M2 to M4 on testnet

- M2 Wallet core: done (ddb3004). Seed to ZIP-32 accounts, per-account UFVK export, sync with memo enhancement, shielded send with memo, memo codec with tests. Evidence: service-built tx fe28107b172e6891a21375047515ae691d5725b22f7c876dea18fc767c07b068 (testnet height 4,465,646, v6, two Ironwood actions, fee 10,000 zat) was recovered by `payslip-service scan` with only the exported treasury UFVK, memo decoded as a PS1 pay line.
- M3 Runs: done (4de4284). REST API, SwapVenue trait with NEAR Intents 1Click, Maya quote client and the testnet fixed-rate venue, persisted executor, SSE. Evidence: run 9145b60b-f19a-4467-ad8a-78a14bd642f6 paid three testnet contractors from the API: allocation f5c142569ab980447bd79d4bbb6b3457e9e1789e46e2b3425ee453d608b0400e at 4,465,670; payments 3c5513c5aaee0def9244a5fb02a32681a0c9b0046a0e1a16b1964c8ede83bd08 (4,465,671), a21fabe27fc81085dd47b5e59bf04f466bda90ec12b24f151248484593691b62 and 3952333d5466eed83b3fc3bad1ee82865708e54500c0d0520bad5d90d0464026 (4,465,672).
- M4 Statement engine: done (4de4284). Evidence: Amara Okafor's statement from her account UFVK alone listed exactly her pay line (txid 3c5513c5..., height 4,465,671, 355,555 zat, 4,800.00 USD, INV-2026-014); the accountant reconciliation over all exported keys marked run 9145b60b reconciled with variance 1,215.01 USD equal to the unpaid ZEC at the fill rate; the faucet deposit is listed as unlabelled and the manual M2 test payment as missing a funding record, so nothing is dropped.
- Hardening (90ed68a): executor crash, expiry, reorg and duplicate-execute tests against an in-memory chain; panic left a run stuck as running (fixed); reorg-aware confirmation; clock skew in health; live testnet integration tests; dev-sweep recycles testnet payouts.
- M1 Scaffold: service and CI done; web scaffold in progress, CI web job fails until web/ is committed.
- Testnet funds: Valar faucet paid 0.125 TAZ. fauzec reported a 1 TAZ payout confirmed at height 4,465,299 that no testnet explorer knows; its node appears to be on the pre-NU7 fork, so that payout is unusable. Payouts to the dev contractor wallets are swept back to the treasury between rehearsals.
- Next: commit the web app (closes M1), M5 web against the live testnet service, then the five test rounds.
- Blocked: nothing.

## 5 Oct 2026, M0 Verify

- M0 done. All five VERIFY items in docs/SPEC.md resolved and recorded under Verified facts in docs/TECH-DECISIONS.md, with ADR-013 to ADR-019.
- Wallet pin: `zcash_client_backend` 0.25.0-pre.0 (ADR-013). 0.24.0 scans Ironwood, but testnet activated NU7 at 4,465,026 on 4 Oct and only the 0.25.0-pre.0 stack knows that height.
- Primary swap venue: NEAR Intents 1Click (ADR-015). It delivers USDC to ZEC into the Ironwood pool for any UA with an Orchard receiver. Maya is the fallback (Sapling only). Testnet uses the fixed-rate TestnetVenue because 1Click has no testnet.
- Solana OUSD rail stays out of scope: the mint has confidential transfers but no auditor key.
- Next: M1 scaffold (service, web, CI).
- Blocked: nothing.

## 5 Oct 2026

- Repo initialised with README, docs/SPEC.md, docs/TECH-DECISIONS.md, CLAUDE.md, LICENSE (MIT).
- Current milestone: M0 Verify. Nothing started.
- Next: resolve the five VERIFY items in docs/SPEC.md and record them in docs/TECH-DECISIONS.md under Verified facts.
- Blocked: nothing.
