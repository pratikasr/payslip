# Colosseum submission

Draft answers for the Crypto World's Fair submission form, Zcash track. Registration and submission both close 12 Oct 2026, 11:59pm PT (13 Oct, 12:29 IST). Fields marked "Team" need information only the team has; everything else is ready to paste.

## Checklist (from docs/SPEC.md)

| Item | State |
| --- | --- |
| Register every team member on colosseum.com | Team: needs each member's account |
| Repository link | https://github.com/pratikasr/payslip (private today; open source is encouraged; if it stays private, grant access to hackathon@colosseum.com) |
| Pre-existing code disclosed | Ready, see below |
| Presentation video, 2 to 3 minutes, English | Team: record; outline below |
| Product demo video, 3 minutes at most, English | Team: record during the mainnet run; shot list in docs/DEMO.md |
| Team backgrounds, location, logo, go-to-market, demand validation | Logo, go-to-market ready below; backgrounds, location and demand validation need the team |
| Track: Zcash, one submission per team | Ready |
| Prize payout in Phantom CASH after KYC to the team leader's wallet | Team |

## Fields

**Project name.** Payslip

**One-liner.** Private payroll on Zcash: shielded payments to the world, a viewing key per contractor, and statements your accountant can reconcile from the chain.

**Track.** Zcash

**Description.**

Teams that pay contractors on-chain publish every salary to anyone with a block explorer. Payslip pays them on Zcash instead, and keeps the books intact.

The payer funds a run in USDC from any wallet. NEAR Intents swaps it to native ZEC straight into Zcash's shielded Ironwood pool, and the fill rate becomes the run's USD basis. Payslip then pays each contractor with one shielded transaction from a dedicated ZIP-32 account. An encrypted memo on each payment carries the run, period, invoice reference and USD basis.

Because each contractor has their own account, that account's viewing key shows their pay and nothing else. The contractor pastes it into Payslip and gets a period statement, ready for tax. The accountant holds every key and gets a reconciliation per run: funded USD against paid USD, with the variance explained by network fees and unspent ZEC, down to rounding of a cent per payment. All of it is read straight from the chain. A block explorer sees shielded transactions with no amounts and no parties.

Each statement line also carries the payment's market value when it arrived, in the contractor's own currency, and exports straight to Koinly or CoinTracker; the accountant's books export to Xero or QuickBooks. To prove a single payment to a landlord, bank or visa office, a contractor sends a link that opens that one payment, checked against the chain, and nothing else.

Contractors who would rather have dollars can choose to have their pay converted to USDC on receipt, and Payslip states plainly what that leg reveals.

Private to the world, transparent to your accountant.

**How it uses Zcash.** Shielded payments into the Ironwood pool (NU6.3) in v6 transactions; single-payment proofs built from the output's outgoing cipher key, verified against the note commitment on chain; one ZIP-32 account per contractor so a ZIP-316 unified full viewing key reveals exactly one person's payments; ZIP-302 memos as the pay line record; view-only wallets that scan with supplied keys to build statements; lightwalletd and `zcash_client_backend` 0.25.0-pre.0 for sync, note management, transaction building and proving.

**Technical stack.** Rust service (axum, `zcash_client_backend` and `zcash_client_sqlite`, SQLite), NEAR Intents 1Click for USDC to ZEC, Next.js 15 web app with wagmi and RainbowKit for the USDC deposit.

**Proof.** Mainnet run: VERIFY: `scripts/mainnet-demo.sh scripts/demo/mainnet.env` writes the six txids for this field and the README. Testnet runs with txids and heights are in the README and docs/DEMO.md.

**Demo video.** VERIFY: link after recording (docs/DEMO.md has the shot list).

**Presentation video.** VERIFY: link after recording. Word-for-word script in docs/LAUNCH.md.

**Go-to-market.** Start with DAOs and remote-first crypto teams that already pay contractors in stablecoins and hand-assemble statements for tax: Zcash ecosystem grantees and teams, then teams paying through public-chain payroll tools today. Pricing: 19 USD per active contractor per month hosted, plus 0.25% on the USDC to ZEC funding swap (collected through NEAR Intents app fees); self-hosting is free under MIT; contractors and accountants never pay. Deel and Rise list 49 USD per contractor per month for contractor payroll, and payroll through them is still public on chain when paid in crypto. Distribution through the Zcash community (Zcash Community Grants recipients, Zodl users) and accountants who serve crypto teams, since the accountant's reconciliation is the feature that replaces their manual work.

**Demand validation.** Team: run the team's own contractor payments through Payslip before submission and show the statements; add who was paid and any feedback from contractors or an accountant. Outreach drafts for Zcash teams, grantees and an accountant are in docs/LAUNCH.md.

**Pre-existing code.** None. Everything in the repository was written for this hackathon. Third-party libraries are dependencies listed in `service/Cargo.lock` and `web/pnpm-lock.yaml`. The `zcash/zcash-devtool` repository was read as a reference for how to call the wallet crates; no code was copied.

**AI tools.** Claude (Anthropic) via Claude Code, used for research, specification and code generation.

**Logo.** `web/src/app/icon.svg` (a payslip mark on a dark tile with the Zcash yellow accent).

**Team, backgrounds and location.** Team: names, roles, backgrounds, location.

**License.** MIT
