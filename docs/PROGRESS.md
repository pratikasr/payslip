# Progress log

Newest entry first. One entry per session: what moved, commit hashes, what is next, what is blocked and why.

## 11 Oct 2026, Fund with ZEC (ADR-025)

- Built in a worktree for the owner's review; not committed by the agent. Launch plan item 2 (docs/superpowers/specs/2026-10-11-launch-plan-design.md, "Fund with ZEC").
- Service: `TreasuryVenue` (any network) prices a run at the CoinGecko rate and answers the treasury address, the ZEC to send (payroll plus fee reserve plus 2 percent) and a 24-hour deadline; `POST /api/runs/{id}/fund` takes `method: "zec" | "usdc"` (default usdc, testnet fixed-rate flow unchanged); the executor and `GET /api/runs/{id}/funding` watch the treasury's confirmed balance net of other runs' claims (creation order) and fund the run at the rate of the tip block, recorded in `PS1R` as for any venue; partial deposits show the shortfall; expiry, re-fund and cancel through the existing endpoints; `PAYSLIP_MAX_RUN_USD_CENTS` refuses a run over the cap with `run_over_cap`; health reports `fund_with_zec` and `max_run_usd_cents`.
- Web: the Fund step shows two cards off testnet (Fund with ZEC: address with QR, amount with copy, rate line, live progress and shortfall; Fund with USDC: the existing quote), ZEC words on tags, the audit trail and Books sources; `web/e2e/zec-fund.spec.ts` exercises the ZEC card against a service fixture (as the USDC wallet test does), because a real deposit moves money and the testnet service shows the single fixed-rate flow.
- Script: `DEMO_FUNDING=zec` in `scripts/mainnet-demo.sh` prints the address and amount and polls until funded; USDC stays the default.
- Checks: service fmt, clippy, 68 unit, 13 API, 33 executor and 1 prices test; web typecheck, lint, prettier, build; the new browser spec. Verified facts: CoinGecko five-minute points near now; SQLite rowid order.
- Next: the owner reviews and merges; then the mainnet run with `DEMO_FUNDING=zec`.
- Operator notes for the mainnet run: the wallet must be synced before funding (the balance comes from the background sync, every 30 seconds); send the full amount shown, shielded, from a wallet whose change does not come back to the treasury; fund one run at a time, since deposits are not tied to a run and the earliest request takes the balance; the run is funded at the rate of the block in which the ZEC reaches `PAYSLIP_MIN_CONFIRMATIONS`, not the request-time rate; prices must be on (`PAYSLIP_PRICE_API_URL` not `off`).

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
