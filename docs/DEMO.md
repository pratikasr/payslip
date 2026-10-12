# Demo

The 90-second demo script from `docs/SPEC.md`, the exact click path that performs it in the redesigned app (docs/DESIGN.md section 15), the timed testnet rehearsals from clean databases, the runbook for the recorded mainnet run, and the demo video script (clicks, narration and shot list) at the end. The owner's run-day order is in [RUN-DAY.md](RUN-DAY.md).

## Click path

Start: the service running (`payslip-service serve`), the web app running (`pnpm start`), and a funded treasury. On testnet the treasury holds faucet coins and the fixed-rate testnet venue stands in for the swap; on mainnet the payer deposits USDC at step 4.

| # | Where | Click | What the viewer sees |
| --- | --- | --- | --- |
| 1 | `/` | Try the live demo | The company console. The dark bar's "Viewing as" menu switches between Company, Contractor and Accountant |
| 2 | `/console/people` | Add contractor, then Name, Email, Unified address, Hold ZEC (or Convert to USDC with chain and payout address), Add contractor. Repeat for six | Six people, accounts 1 to 6, each with their own ZIP-32 account. Adding one opens their detail drawer |
| 3 | `/console/access` | QR code and link on one contractor | An invite link that carries that person's viewing key in the URL fragment, as text and QR |
| 4 | `/console/runs/new` (Run payroll) | Amounts: the month and each person's USD and invoice reference, Continue | Review and approve: the total for six contractors, funding source and rate, what contractors get, fees and every pay line |
| 5 | Review step | Approve | Nothing moved before this. The run is created and the flow moves to Fund |
| 6 | Fund step | Testnet: Fund from treasury, then confirm (or Fund with ZEC under it, the mainnet path, priced at the market rate). Mainnet, first option: Fund with ZEC, which shows the treasury's unified address as text and QR, the exact ZEC amount and a progress line; send that amount from your own wallet. Second option: Fund with USDC, choose the chain, get the quote (rate locked, "You send exactly", "Contractors get", fees), Connect Wallet and send; the deposit address and amount are pre-filled | Funding moves to funded. With ZEC, the market price at the funding block becomes the run's USD basis; with USDC, the fill rate does |
| 7 | Pay step | Pay 6 contractors, then confirm in the dialog that restates people, total, ZEC and fees | Live progress: "N of 6 confirmed", each row turning Confirmed with its txid and block, then "Paid to 6 contractors" and View run |
| 8 | Run page, Privacy view tab | Open any txid's explorer link | Left: what a public chain would show (illustration). Right and in the explorer: shielded transactions, no amount, no parties |
| 9 | Contractor portal from the invite link (step 3) | Payslips, then a payslip, Share proof | That person's payslips only; the payslip document; a proof link that opens one payment at `/verify` |
| 10 | `/books` (Viewing as Accountant) | Load the judge kit on testnet; on a full Payslip, Load this company's keys; on a statements-only Payslip without a published kit, Import key file with `docs/judge/judge-kit-<network>.json` | Reconciliation: Every run reconciled, funded, paid, variance, explained and unexplained, with any cent of rounding shown under Difference |
| 11 | Books, Exports | Payslip CSV, Xero or QuickBooks | The reconciliation and every line as CSV in the chosen layout |

The same path is automated in `web/e2e/demo.spec.ts`, which is how the rehearsals below were run and timed.

## Testnet rehearsals

Rehearsals 1 and 2 ran through the first version of the web app; rehearsal 3 through the redesigned one. Rehearsals 1 and 2 used a clean database (`scripts/fresh-testnet-env.sh`, which keeps only the encrypted seeds), one straight after the other, on 5 Oct 2026 UTC. Times in seconds; "wall clock" covers the whole path including waiting for the chain.

| Step | Rehearsal 1 | Rehearsal 2 |
| --- | ---: | ---: |
| Onboard six contractors | 6 | 6 |
| Create the run | 0 | 0 |
| Fund (testnet fixed-rate venue) | 7 | 7 |
| Execute and wait for six confirmations | 105 | 125 |
| Check six txids and heights on testnet.zecblock.com | 2 | 2 |
| Contractor statement from one viewing key | 4 | 5 |
| Accountant reconciliation from the exported key file | 27 | 34 |
| CSV export | 6 | 3 |
| Wall clock | 160 | 185 |

Rehearsal 1, run 61e7687c-51b4-49c3-8836-b86570e9c8f8, allocation 98977de93e11... at 4,465,896 (full record: [proof/rehearsal-1.json](proof/rehearsal-1.json)):

| Contractor | Txid | Height |
| --- | --- | ---: |
| Amara Okafor | cad00d2ffc7395f6efbce3c8e85cc1e8f1cb9097f4159e7efe41d02243253072 | 4,465,898 |
| Mateo Fernandez | 49c338336bc94dfeb21239f4faf2595cd2004e7f4df968013ac0e43a50faae70 | 4,465,899 |
| Priya Raman | 2da6e11c026837da7565a2988093942b44f0a1bff4a6b3e669eeeb557451433b | 4,465,899 |
| Jonas Lindqvist | c34fb793b524e621251c34fa2785ee547d360dd2a99b3b2509e515035fd3e0ef | 4,465,899 |
| Mei Chen | aa68a24e60821142e41c3abe4253085c5d01f18c62481f83a6ad8199ba43adba | 4,465,899 |
| Kwame Mensah | acfd8d4b1d97d044011e0f93ee484bf5b5bbd48a600e9438695b2feb2049d65f | 4,465,899 |

Rehearsal 2, run 2c3c69da-45f1-4a8c-92ef-6f61f0d991f4, allocation 73620ccfad58... at 4,465,907 (full record: [proof/rehearsal-2.json](proof/rehearsal-2.json)):

| Contractor | Txid | Height |
| --- | --- | ---: |
| Amara Okafor | c9af878a2502c3357f513fa35924edfe38d314b8515a7d675505e419d67572dc | 4,465,909 |
| Mateo Fernandez | c799afa886a1eb68b721742e2cac022c416bdab89301c503e70b981a5babc202 | 4,465,909 |
| Priya Raman | 9bf11723bfd3ad2b1a2ce1f722a1138044c2ecd298da09e3322a2472b6739c1e | 4,465,909 |
| Jonas Lindqvist | 01b3f8180282d4057cb68e3cfa083314176f7dd769abef4b9f5c576d0540cc85 | 4,465,909 |
| Mei Chen | eb0290bd999ad7d8ca9fb1af4a871a6056e6f4786e2c6e6270d7171bbcd11fdf | 4,465,911 |
| Kwame Mensah | 36b5db028e261887534a28d9f559965bf2bf99e95365c25ecd1e1952dd30f338 | 4,465,911 |

Rehearsal 3, through the redesigned app, from a new seed (the clean demo wallet behind the judge kit), 5 Oct 2026: run 09019bd8-d31d-400b-a779-050afeb3083e, allocation 91087ec36cce... at 4,466,910 (full record: [proof/rehearsal-3.json](proof/rehearsal-3.json)). Timings in seconds: onboard six 7, approve 0, fund 5, pay and six confirmations 80, explorer check 1, contractor portal 5, accountant books 25, CSV 3; 2.2 minutes wall clock.

| Contractor | Txid | Height |
| --- | --- | ---: |
| Amara Okafor | b597daba92b76495421d44c22b7c6282ca8f053cad6de06fdcb648a01d2bf0c3 | 4,466,912 |
| Mateo Fernandez | 24e99d9802a6cb0573ea309e4e2e614477ce933ebf879971fce86f7f19b2216a | 4,466,912 |
| Priya Raman | 4a90a0894343a365e7a116457c0230bb57a350a70df82a6209c91078ff110498 | 4,466,912 |
| Jonas Lindqvist | f2e6094e0bed1b4784e9d778bd38f30dc89beb2f5b907d4d861b73f6dcfa0919 | 4,466,912 |
| Mei Chen | 866266aeab8424ad048492bdc7027a9e6f900beabf4fd5b5f25d5c221705289c | 4,466,912 |
| Kwame Mensah | 04cffca310a3362df7fd53ccea6e8938a15c2bcd3e57c489bb856adaa96d32c4 | 4,466,912 |

After rehearsal 3 the same wallet paid the demo company's July and August payrolls through the API, also on 5 Oct 2026, to give the demo company history: run a738f61a-9a7a-4c65-912f-329b0c509e9b (July, six payments at 4,467,188) and run 67dd4c2e-0268-4da1-846a-729379f6278d (August, six payments at 4,467,193 to 4,467,196). Every txid is in [proof/demo-wallet-runs.json](proof/demo-wallet-runs.json). The wallet holds these three runs and nothing else, so the contractor, the accountant and the company see the same three runs, each paid on 5 Oct 2026.

Earlier testnet runs of the same flow: the driver script `scripts/mainnet-demo.sh` (run 284c2421, [proof/testnet-rehearsal-284c2421.md](proof/testnet-rehearsal-284c2421.md)) and the Round 2 end-to-end test (run 85ea4bdc, [proof/e2e-round2-85ea4bdc.json](proof/e2e-round2-85ea4bdc.json)).

### Rehearsal 4: Fund with ZEC, 11 Oct 2026

The mainnet flow on testnet, funded with ZEC (ADR-025), first through the driver script and then through the web app the way the demo video shows it. A new wallet from `scripts/demo/testnet-rehearsal.env` (its own data directory `service/data/testnet-rehearsal`, port 127.0.0.1:8180, one confirmation; birthday 4,489,138). Its treasury `utest1jzrqzrxytvjmnztgajpaux2zkx0x9ln6a0h20a8we8cj0vlyxm57v2n5fhafw4u2mmx58dnqdw2ksseraq3anp2xnt449unl2vpqc63s` took 0.125 TAZ from the Valar testnet faucet (`POST https://faucet.testnet.valargroup.dev/api/claim`, txid c6d0379188a63b65a4eefc5ef9e3ede0d61a56682a16f25cf2edcab32c0cde24 at 4,489,153). Three generated demo contractors, all Hold ZEC: the testnet venue cannot convert to USDC (`conversion_unsupported`). Fund with ZEC prices testnet coins at CoinGecko's ZEC price, $1,231.43 for both runs. Every txid below was checked on api.testnet.zecblock.com at the height shown.

**Script.** `DEMO_FUNDING=zec DEMO_CONTRACTORS_FILE=<three-person file> DEMO_GENERATED_WALLETS=yes scripts/mainnet-demo.sh scripts/demo/testnet-rehearsal.env`. Run b89cc0e1-2f65-445f-ac7a-7af7699de37a, Sep 2026, payroll $16.45. The ZEC request asked 0.01423762 ZEC (payroll, fee reserve and 2 percent); the treasury's free balance already covered it, so the fund call answered funded at block 4,489,154 ($17.53). Allocation a22a20332d46... at 4,489,155. Seconds from the start: onboard three 9, run created 9, funded 12, allocation confirmed 60, payments sent 78, three confirmed 178 (165 from execute), proof, statements and judge kit written 191. Books: reconciled, variance $1.08, all explained.

| Contractor | USD | Txid | Height |
| --- | ---: | --- | ---: |
| Amara Okafor | 4.80 | b2195cede6a879012dc36ebdb8bd3447d76433b13fb38d7bf0ebc2f535f6af85 | 4,489,158 |
| Mateo Fernandez | 6.25 | 6e2341fb37d7faed91949dba37728a3beaa380405a51b3b37bcb53d134cb922a | 4,489,158 |
| Priya Raman | 5.40 | 330c569b7f4297befdcbc30c1df2a02d409ed8817312ebdc9a606233e8613a27 | 4,489,158 |

**Web app.** A production build of `web/` with `NEXT_PUBLIC_PAYSLIP_API_URL=http://127.0.0.1:8180` on 127.0.0.1:3320, clicked by Playwright at 1440 by 900. Run dc895add-7383-4d6b-81b5-6f843b2f9196, Oct 2026, payroll $10.10. Fund with ZEC asked 0.00897789 ZEC; the treasury held 0.11114154 TAZ free, so the run was funded within the second at block 4,489,167 ($11.06). Allocation b81c12d345b7... at 4,489,170. Books, with the treasury key and the three contractor keys: both runs reconciled, October's variance $0.96, all explained. 2.2 minutes wall clock; Playwright clicks as soon as a page allows, so a person takes longer on every step but the chain wait.

| Step | Seconds |
| --- | ---: |
| Console home, People | 0.4 |
| Run payroll: Oct 2026, three amounts and invoices | 0.3 |
| Review | 0.2 |
| Approve | 0.2 |
| Fund with ZEC (straight to funded from the free balance) | 1.1 |
| Pay 3 contractors and confirm | 0.3 |
| Three confirmations | 115.2 |
| Run page, the two copies | 0.3 |
| Contractor portal from the invite link | 4.4 |
| Share proof | 0.9 |
| /verify | 2.1 |
| Books, Load this company's keys | 5.9 |

| Contractor | USD | Txid | Height |
| --- | ---: | --- | ---: |
| Amara Okafor | 3.10 | c6b6dbfb6e6296327fb2209e0b7c23120c0604a257d22632d34b34c7609e621f | 4,489,171 |
| Mateo Fernandez | 4.25 | 46a50c3cc57dbb48f502171ecb6417ecbb36b0cb3d6e67af3f39808feff50624 | 4,489,171 |
| Priya Raman | 2.75 | b0996d994734d313114b7129cfc9f7e5f65af72de4b248921c7a702697c1baa9 | 4,489,171 |

Fixed during the rehearsal: the testnet Fund step offered only Fund from treasury, so Fund with ZEC could not be clicked on testnet although the service offers it there (it now sits under Fund from treasury; `web/e2e/zec-fund.spec.ts` covers it); a ZEC-funded testnet run was labelled with the simulated rate on the Pay step, the run page, the pay line drawer, the audit trail and the run summary (they now follow the funding venue); and `scripts/mainnet-demo.sh` let the config's empty `DEMO_CONTRACTORS_FILE=` or `DEMO_FUNDING=` override the value given on the command line (the command line now wins for the `DEMO_*` settings). Left as they are, testnet only: /verify, Books and the payslip call any testnet rate simulated, a ZEC-funded run's included, and the ZEC request card writes ZEC where the rest of testnet writes TAZ.

What to watch for on mainnet:

- **Empty treasury before the take.** ZEC already in the treasury counts toward the request. If its free balance covers the run, Fund with ZEC funds at once, as here, and the Zashi send never happens on camera. The Treasury page must show less than the run needs.
- **Wait for the two Fund cards.** The Fund step shows a placeholder until `/api/health` answers (it asks lightwalletd for the tip; 0.5 to 2.8 seconds here), then Fund with ZEC and Fund with USDC.
- **Send exactly the card's amount**, from Zashi's shielded balance, with Zashi's own network fee on top. The card's rate is the price at the request; the run is funded at the price of the block in which the treasury's balance covers it after three confirmations. If ZEC falls more than the 2 percent buffer meanwhile, the line reads "still needed at the current rate": send that remainder to the same address.
- **One unlabelled transaction in Books.** The deposit into the treasury carries no Payslip memo, so Books lists it under Exceptions and the banner reads "1 unlabelled transaction to review", as the faucet deposit did here. That is expected in the 2:40 shot.
- **Funded is more than paid.** The ZEC set aside includes the fee reserve and the 2 percent buffer; Books shows it as variance, all explained, and the run page as Back in treasury ($0.96 on a $10.10 payroll here).
- **A one-second flash.** When the treasury already covers the run, the Fund card can show Awaiting ZEC for a moment before Pay, because the run stream reports the request before the fund call answers. With an empty treasury the card stays, which is the shot the video wants.
- **The script with ZEC.** `DEMO_FUNDING=zec` on the command line now wins over the config (`mainnet.env.example` lists it empty). Each run of the script rewrites `scripts/demo/out/judge-kit-<network>.json` and the reconciliation and statement CSVs; copy them before a second run.

## Mainnet run

Mainnet differs from the rehearsals in three ways: funding is real money, either ZEC sent from the owner's own Zashi wallet to the treasury (Fund with ZEC, the first option since the 11 Oct launch plan, docs/superpowers/specs/2026-10-11-launch-plan-design.md) or a USDC deposit swapped by NEAR Intents 1Click (Fund with USDC); blocks are 75 seconds and the service waits for three confirmations before spending (`PAYSLIP_MIN_CONFIRMATIONS=3`), so funding confirms in about four minutes and execution takes roughly ten minutes instead of two; and a converting contractor's USDC is delivered by the venue about eight minutes after their payment confirms. The recorded run pays three real people with Zashi addresses, small amounts, on the hosted app with sign-in on; their viewing keys are published in the mainnet judge kit and each person is told.

### Prerequisites

- A throwaway seed. The mainnet judge kit publishes every viewing key of the demo seed, which makes all of that seed's payments readable for good. The demo uses its own data directory (`service/data/mainnet`) for that reason; real payroll, such as the first real users in [LAUNCH.md](LAUNCH.md), runs on a separate seed and data directory whose keys are never published.
- For Fund with ZEC: the owner's own Zashi holding about 0.05 ZEC in its shielded balance (how to get it: RUN-DAY.md). Funding from a shielded balance keeps the payroll total off every public chain; an exchange withdrawal sent straight to the treasury would be public.
- For Fund with USDC only: an EVM wallet in the browser (for example MetaMask) holding the USDC deposit on Base (or Arbitrum or Ethereum) plus a little ETH for gas on that chain.
- `scripts/demo/mainnet.env`, copied from `scripts/demo/mainnet.env.example`. It holds the mainnet passphrase (`PAYSLIP_SEED_PASSPHRASE`, a new one) and is ignored by git. The passphrase must be in this file: on mainnet the script refuses to fall back to the testnet passphrase in `service/.env`.
- `scripts/demo/contractors.mainnet.json`, copied from `scripts/demo/contractors.mainnet.example.json`: the names, unified addresses, USD amounts and invoice references (three real people for the recorded run; the example lists six, and the script takes however many the file holds). With `DEMO_GENERATED_WALLETS=yes` the empty addresses are filled from generated demo wallets whose payouts can be swept back to the treasury afterwards; otherwise every contractor needs a real unified address. The example converts Priya's pay to USDC delivered to `DEMO_REFUND_ADDRESS`, so that leg returns to the payer.
- Nothing else on 127.0.0.1:8080. The web app's Fund step talks to the service there, and the script stops if that port holds a service for another network or another wallet.
- **Back up before funding.** The first run of the script (below, without `--yes`) creates the encrypted seed `service/data/mainnet/payer.seed.age`, and `dev-contractors.seed.age` beside it when `DEMO_GENERATED_WALLETS=yes`. Copy both off this machine and keep the passphrase separately, for example in a password manager. `init` shows no recovery phrase: the encrypted file and its passphrase together are the only way back to the treasury and to the generated contractor wallets.

### Funding amount

The service asks the venue for the payroll plus 1.5 times the estimated network fees, valued at the venue's current price; the surplus stays in the treasury and is reported as unspent. With the example amounts (payroll $30.38), the mainnet dry run on 5 Oct 2026 was quoted 32.51 USDC, with ZEC at about $1,354.93 that day (docs/TECH-DECISIONS.md, Verified facts). The exact figure and the deposit address are printed by the script and shown on the Fund step when the run is funded; the deposit address is valid for one hour.

Fund with ZEC asks for the payroll at CoinGecko's current price, plus the fee reserve, plus 2 percent for price moves, rounded up; what is not spent stays in the treasury. In rehearsal 4 a $10.10 payroll asked 0.00897789 ZEC and a $16.45 one 0.01423762 ZEC, both at $1,231.43. The treasury address and the amount are printed by the script and shown on the Fund with ZEC card; the request stays open for 24 hours.

### Commands

```
cd service && cargo build --release
scripts/mainnet-demo.sh scripts/demo/mainnet.env          # creates the seed and the run, stops before funding
                                                          # back up the seed and passphrase now (Prerequisites)
DEMO_FUNDING=zec scripts/mainnet-demo.sh scripts/demo/mainnet.env --yes   # Fund with ZEC: prints the treasury address and amount, waits
scripts/mainnet-demo.sh scripts/demo/mainnet.env --yes    # or Fund with USDC: requests the deposit address and waits
```

`DEMO_FUNDING=zec` may also go in `scripts/demo/mainnet.env`; given on the command line it wins over the file, whose example lists it empty. The run is the same in both calls (its key comes from the config and the contractor file), so the second call funds the run the first one created.

With ZEC the script asks `POST /api/runs/{id}/fund` with `{"method": "zec"}` and prints the treasury's unified address, the exact ZEC to send and the deadline, then reads `GET /api/runs/{id}/funding` every 10 seconds and prints what is confirmed, what is still confirming and what is still needed. Send that amount from Zashi's shielded balance. The same address, as text and QR with Copy amount, is on the Fund step in the browser (`http://127.0.0.1:3000/console/runs/new?run=<run id>`, the id is printed). The run is funded once the treasury's confirmed balance (three confirmations) covers it at the market price of that block, and ZEC already in the treasury counts, so a treasury that already covers the run is funded at once. Rehearsal 4 ran this path on testnet.

With USDC open the run in the browser at the same address. The deposit request already exists, so the Fund step shows the deposit address: Connect Wallet, then Send <amount> USDC.

Either way the script then pays, follows the payments and writes `scripts/demo/out/proof-mainnet-<run>.md` with every txid and height, plus the statement and reconciliation CSVs and `scripts/demo/out/judge-kit-mainnet.json`. Copy the proof table into the README and the kit to `docs/judge/`.

The recorded demo itself goes through the console on the hosted app (RUN-DAY.md item 7): People, Run payroll, Approve, Fund with ZEC, send from Zashi, Pay. Its run id is the last path segment of the run page URL (`https://<app hostname>/console/runs/<run id>`, the hostname from `deploy/aws/provision.sh`), and that page lists every txid and block for the README. The kit for a console run comes from the same script's kit step against the hosted service: VERIFY: `sed -n 274,330p scripts/mainnet-demo.sh` shows the statements and kit calls to reuse.

After recording, generated contractor wallets can be swept back: `cd service && ./target/release/payslip-service dev-sweep --allow-mainnet`.

## Demo video (3 minutes at most, English)

The submission form's rule: at most 3 minutes, in English, the live product, not slides or code. It is recorded during the mainnet run, on the hosted app, browser only, in one continuous take; the waits for confirmations are cut in the edit. The pitch video script is in [LAUNCH.md](LAUNCH.md).

Hostnames: the app (landing page, console, portal) and Books are the two CloudFront hostnames that `deploy/aws/provision.sh` prints (VERIFY: run it, or read `deploy/README.md`). The mainnet run id and txids: VERIFY: `ls scripts/demo/out/proof-mainnet-*.md` when the script drove the run, otherwise the run page `https://<app hostname>/console/runs/<run id>`, whose last path segment is the run id and whose pay lines list every txid and block.

Budget: 180 seconds in seven blocks, 10, 10, 40, 30, 40, 30 and 20. Spoken sentences at 140 words per minute; each row's sentence fits inside its slot.

### Script

| Time | Where | Clicks | Say |
| --- | --- | --- | --- |
| 0:00 | Landing page: `https://app.payslip.cash/` | None. Let the hero sit: one mainnet payment shown twice, what the explorer sees on the left, what the viewing key sees on the right | "This is one payroll payment on Zcash mainnet, seen twice: what the explorer sees, and what the contractor's viewing key sees." |
| 0:10 | Sign-in | Sign in (header), then Sign in with Google, pick the Payslip Labs account. The console home opens with the company name | "The company signs in with Google. This is Payslip Labs, with roles for who can approve and who can only read." |
| 0:20 | `/console/people` | People in the sidebar. Three people, each with an account number | "Three people, each with their own Zcash account, so each key shows one person's pay and nobody else's." |
| 0:28 | Run payroll, Amounts step | Run payroll. The month, then each person's USD amount and invoice reference, then Continue | "Run payroll: the month, each person's amount in dollars and their invoice reference." |
| 0:40 | Review and approve | Scroll the review once: total, funding source, what contractors get, fees, every pay line | "Review before anything moves: the total, what each person gets, and the network fees." |
| 0:52 | Review and approve | Approve. The flow moves to Fund | "Approve. Nothing has moved yet." |
| 1:00 | Fund step | Fund with ZEC. The card shows the treasury's unified address as text and QR, the exact ZEC amount and Copy | "Fund with ZEC: the treasury's shielded address and the exact amount. I send it from my own wallet, off camera." |
| 1:12 | Fund step | Send the amount from Zodl now. The card's incoming line changes as the deposit is seen and counts the confirmations; cut the wait for three confirmations; resume when it reads funded | "Nothing on any public chain shows the payroll total, because the treasury is shielded too." |
| 1:22 | Fund step, funded | None. The card reads funded with the rate | "Funded after three confirmations; the price at that block becomes the dollar basis for the books." |
| 1:30 | Pay step | Pay 3 contractors, then confirm in the dialog that restates people, total, ZEC and fees | "One click pays everyone: one shielded transaction per person, each with an encrypted memo carrying the period, the invoice and the dollar amount." |
| 1:42 | Pay step | Cut the wait. Resume as rows turn Confirmed with txid and block, then "Paid to 3 contractors", then View run | "Each line confirms with its transaction id and block." |
| 1:50 | Run page | The two-view panel at the top of the run page: what the world sees beside what the key sees | "The run page shows the same payment two ways. The left is all the world gets." |
| 1:58 | Run page, then zecblock.com | Click the first pay line, then Open in explorer. The explorer tab shows a shielded transaction | "Here is that transaction in a public explorer: shielded, no amount, no sender, no recipient." |
| 2:10 | `/portal` | Try it with a demo key, or paste one person's invite link (from Payslip access, opened off camera). The portal home opens with their payslips | "The contractor opens their payslips with their own viewing key: their pay, read from the chain, and nobody else's." |
| 2:20 | Portal, one payslip | Payslips, then the latest payslip. The document shows the amount, the dollar basis, the memo fields and What the world sees | "Each payslip carries the dollar value when the payment arrived, ready for tax." |
| 2:28 | Payslip, Share proof | Share proof, copy the link, open it in a new tab: the public proof page at `/verify#...` | "Share proof makes a link that opens this one payment, checked against the chain, for a landlord or a bank, and nothing else." |
| 2:40 | Books: `https://payslip.cash/books` | Import key file with `docs/judge/judge-kit-mainnet.json` (on the recording machine). The reconciliation loads: Every run reconciled, funded, paid, difference | "The accountant loads every key and gets every run reconciled: funded against paid, with the difference explained." |
| 2:52 | Books, Exports | Exports, then Xero. The file downloads | "Export it to Xero. Private to the world, transparent to your accountant." |

### Shot list (screen recording, 1440 by 900, browser only)

1. Browser: a fresh profile with no extensions and no bookmarks bar, one window sized 1440 by 900, zoom 100 percent, the address bar visible so every hostname is on screen. On macOS, QuickTime Player, File, New Screen Recording, drag the region to the window; or Cmd-Shift-5 with the same region. No camera, no desktop, no terminal.
2. Tabs, opened as the script reaches them so the viewer sees each URL: app.payslip.cash (landing, console, portal), zecblock.com for the explorer shot, the proof link, payslip.cash for Books.
3. One continuous take from the landing page to Exports. Two cuts only, both on a still screen: the funding wait (after the ZEC is sent, before the card reads funded) and the payment wait (after the Pay dialog, before the rows read Confirmed). Never cut inside a click or a page load.
4. Off camera: the Zodl send on the phone (said aloud at 1:00), and opening Payslip access if an invite link is used instead of the demo key (the keys are published in the kit, so nothing needs blurring, but the access page is not part of the story).
5. Narration: the Say column, recorded over the cut video, or live during the take if the room is quiet. One sentence per row, no ad-libs.
6. Before the take: the people are already onboarded, the treasury key is unlocked (Settings, Treasury key), Zodl holds the amount the Fund card will ask for plus a little, and the kit file `docs/judge/judge-kit-mainnet.json` is on the recording machine. The take can also show the paid run of 12 Oct 2026 (dfdc9d29) instead of a new one: from 0:28, Payroll in the sidebar, then that run; the rows 0:28 to 1:42 collapse into the run page at 1:50.
7. After the take: export at 1440 by 900, H.264, the three minutes at most; check the explorer tab shows the txid that the run page lists; upload per RUN-DAY.md.
