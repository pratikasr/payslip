# Colosseum submission

Draft answers for the Crypto World's Fair submission form, Zcash track. Registration and submission both close 12 Oct 2026, 11:59pm PT (13 Oct, 12:29 IST). Fields marked "Team" need information only the team has; everything else is ready to paste. The owner's order for the last day, form included, is [RUN-DAY.md](RUN-DAY.md).

## Checklist (from docs/SPEC.md)

| Item | State |
| --- | --- |
| Register every team member on colosseum.com | Team: needs each member's account |
| Repository link | https://github.com/pratikasr/payslip (private today; the owner adds hackathon@colosseum.com as a Read collaborator, RUN-DAY.md item 1; open source is encouraged and making it public is the owner's call) |
| Pre-existing code disclosed | Ready, see below |
| Pitch video, 2 minutes at most, English | Team: record; script in [LAUNCH.md](LAUNCH.md), Pitch video (273 spoken words) |
| Product demo video, 3 minutes at most, English | Team: record during the mainnet run; script and shot list in [DEMO.md](DEMO.md), Demo video |
| Team backgrounds, location, logo, go-to-market, demand validation | Logo, go-to-market ready below; backgrounds, location and demand validation need the team |
| Track: Zcash, one submission per team | Ready |
| Prize payout in Phantom CASH after KYC to the team leader's wallet | Team |

## Form fields the owner fills

These have no draft here; the owner types them into the form at https://colosseum.com.

- **Country.** The country the team leader lives in.
- **Telegram.** The owner's Telegram handle.
- **X.** The owner's X handle.
- **Pitch video link.** https://youtu.be/sU6VdhTUpE4
- **Demo video link.** https://youtu.be/SdRff7535hI

## Fields

**Project name.** Payslip

**One-liner.** Private payroll on Zcash: shielded payments to the world, a viewing key per contractor, and statements your accountant can reconcile from the chain.

**Track.** Zcash

**Description.**

Teams that pay contractors on-chain publish every salary to anyone with a block explorer. Payslip pays them on Zcash instead, and keeps the books intact.

The payer funds a run in one of two ways. With ZEC sent from their own wallet to Payslip's shielded treasury: the run is funded when it confirms, at the market price of that block, and no public chain shows the payroll total. Or with USDC from any EVM wallet, which NEAR Intents swaps into native ZEC delivered straight into Zcash's shielded Ironwood pool. Payslip then pays each contractor with one shielded transaction from a dedicated ZIP-32 account, with an encrypted memo carrying the run, period, invoice reference and USD basis.

Because each contractor has their own account, that account's viewing key shows their pay and nothing else. The contractor opens their portal with it and gets a statement of earnings ready for tax, with each payment's market value when it arrived and exports for Koinly and CoinTracker. The accountant holds every key and gets a reconciliation per run: funded USD against paid USD, the variance explained by network fees and unspent ZEC, read straight from the chain and exported to Xero or QuickBooks. To prove one payment to a landlord, bank or visa office, a contractor sends a link that opens that payment, checked against the chain, and nothing else.

A company runs it as a team: Google sign-in, admins, approvers, accountants and viewers, recorded approvals before any money moves, and an audit log of every change. A pay schedule drafts each payroll before pay day, and contractors send payment requests from their portal that become pay lines once approved. Nothing is funded or paid without a person.

Every screen is printed on paper: a payslip is a pay advice, and what the explorer sees is its yellow carbon copy with everything the chain hides inked out.

Contractors who would rather have dollars can have their pay converted to USDC on receipt, and Payslip states plainly what that leg reveals.

Private to the world, transparent to your accountant.

**How it uses Zcash.** Shielded payments into the Ironwood pool (NU6.3) in v6 transactions, one per contractor; funding in ZEC sent shielded to the treasury and priced at the block that confirms it, so no public chain shows the payroll total or the payer; one ZIP-32 account per contractor, so a ZIP-316 unified full viewing key reveals exactly one person's payments (also given in the Revision 0 form that released wallets import); ZIP-302 memos as the record of each pay line, allocation and funding, the funding record readable only with the treasury's key; single-payment proofs built from the output's outgoing cipher key and verified against the note commitment on chain; view-only wallets that scan with supplied keys to build statements and reconciliations; lightwalletd and `zcash_client_backend` 0.25.0-pre.0 for sync, note management, transaction building and proving.

**Technical stack.** Rust service: axum, sqlx on SQLite, `zcash_client_backend` 0.25.0-pre.0 and `zcash_client_sqlite` over lightwalletd gRPC, the seed encrypted at rest with age, `jsonwebtoken` checking the web app's EdDSA sign-in tokens. Next.js 15 web app: React 19, TypeScript, Tailwind CSS 4, shadcn/ui on Radix, Better Auth 1.7.7 for Google sign-in, wagmi, viem and RainbowKit for the USDC deposit. NEAR Intents 1Click for USDC to ZEC, CoinGecko for market prices. Hosting: Docker compose on one AWS EC2 instance behind two CloudFront distributions, encrypted backups to S3. Tests: cargo test and Playwright.

**Live product link.** https://app.payslip.cash: the company console on Zcash mainnet (sign in with any Google account; a new account joins Payslip Labs as a viewer and sees the paid run of 12 Oct 2026). The public statements page is https://payslip.cash (Books: Load the judge kit; the contractor portal; payment proofs). One copy of Payslip serves one company; another company runs its own copy with deploy/README.md.

**Proof.** Mainnet run dfdc9d29-75a3-4197-8bb4-21b2f6175fea, paid on the hosted app on 12 Oct 2026: allocation 4c0d68d29664a08de2928363631327c91cac7c59ac8d62874d74b037e0515109 at height 3,514,840 and the payment 53f87ab55c51590a1ee38767ce1f45476ff0ee6347c005f00a1a6b48b838c8bc at 3,514,845, both shielded Ironwood transactions on https://zecblock.com. The mainnet judge kit (docs/judge/judge-kit-mainnet.json) reads them back: Books on https://payslip.cash reconciles the run (funded $10.70, paid $10.00, $0.70 explained by fees and unspent change), the portal shows Biqtor's payslip, and the kit's payment_proof opens at https://payslip.cash/verify#<token>. Read-back record: docs/proof/mainnet-dfdc9d29.json. Testnet runs with txids and heights are in the README and docs/DEMO.md.

**Demo video.** https://youtu.be/SdRff7535hI (Unlisted): the owner's 3-minute recording of the live product on mainnet, narrated; made 13 Oct 2026.

**Presentation video.** https://youtu.be/sU6VdhTUpE4 (Unlisted): the 1:59 pitch rendered from the fourteen-slide deck in the paper design (video/ holds the tooling).

**Go-to-market.** Start with DAOs and remote-first crypto teams that already pay contractors in stablecoins or ZEC and hand-assemble statements for tax: Zcash ecosystem grantees and teams, then teams paying through public-chain payroll tools today. Sign-in with roles, recorded approvals and an audit log are what a finance team asks for before it lets a tool move money. Pricing: 19 USD per active contractor per month hosted, plus 0.25% on the USDC to ZEC funding swap (collected through NEAR Intents app fees; funding with ZEC carries no swap fee); self-hosting is free under MIT; contractors and accountants never pay. Deel and Rise list 49 USD per contractor per month for contractor payroll, and payroll through them is still public on chain when paid in crypto. Distribution through the Zcash community (Zcash Community Grants recipients, Zodl users) and accountants who serve crypto teams, since the accountant's reconciliation is the feature that replaces their manual work.

**Demand validation.** The founder ran the first real payroll on the hosted product on 12 Oct 2026: funded with ZEC from his own Zodl wallet, one contractor paid $10.00 into a Zodl wallet, read back with the published viewing keys (README, Proof). No outside team has run a payroll yet; the outreach drafts for Zcash teams, grantees and an accountant are in docs/LAUNCH.md and go out after the submission.

**Pre-existing code.** None. Everything in the repository was written for this hackathon. Third-party libraries are dependencies listed in `service/Cargo.lock` and `web/pnpm-lock.yaml`. The `zcash/zcash-devtool` repository was read as a reference for how to call the wallet crates; no code was copied.

**AI tools.** Claude (Anthropic), through Claude Code and Cowork, used for research, specification and code generation.

**Logo.** `web/src/app/icon.svg` (a payslip mark on a dark tile with the Zcash yellow accent).

**Team, backgrounds and location.** Team: names, roles, backgrounds, location.

**License.** MIT
