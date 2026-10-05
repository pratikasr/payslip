# Demo

The 90-second demo script from `docs/SPEC.md`, the exact click path that performs it in the redesigned app (docs/DESIGN.md section 15), the timed testnet rehearsals from clean databases, and the runbook for the recorded mainnet run.

## Click path

Start: the service running (`payslip-service serve`), the web app running (`pnpm start`), and a funded treasury. On testnet the treasury holds faucet coins and the fixed-rate testnet venue stands in for the swap; on mainnet the payer deposits USDC at step 4.

| # | Where | Click | What the viewer sees |
| --- | --- | --- | --- |
| 1 | `/` | Try the live demo | The company console. The dark bar's "Viewing as" menu switches between Company, Contractor and Accountant |
| 2 | `/console/people` | Add contractor, then Name, Email, Unified address, Hold ZEC (or Convert to USDC with chain and payout address), Add contractor. Repeat for six | Six people, accounts 1 to 6, each with their own ZIP-32 account. Adding one opens their detail drawer |
| 3 | `/console/access` | QR code and link on one contractor | An invite link that carries that person's viewing key in the URL fragment, as text and QR |
| 4 | `/console/runs/new` (Run payroll) | Amounts: the month and each person's USD and invoice reference, Continue | Review and approve: the total for six contractors, funding source and rate, what contractors get, fees and every pay line |
| 5 | Review step | Approve | Nothing moved before this. The run is created and the flow moves to Fund |
| 6 | Fund step | Testnet: Fund from treasury, then confirm. Mainnet: choose the USDC chain, get the quote (rate locked, "You send exactly", "Contractors get", fees), Connect Wallet and send; the deposit address and amount are pre-filled | Funding moves to funded; the fill rate becomes the run's USD basis |
| 7 | Pay step | Pay 6 contractors, then confirm in the dialog that restates people, total, ZEC and fees | Live progress: "N of 6 confirmed", each row turning Confirmed with its txid and block, then "Paid to 6 contractors" and View run |
| 8 | Run page, Privacy view tab | Open any txid's explorer link | Left: what a public chain would show (illustration). Right and in the explorer: shielded transactions, no amount, no parties |
| 9 | Contractor portal from the invite link (step 3) | Payslips, then a payslip, Share proof | That person's payslips only; the payslip document; a proof link that opens one payment at `/verify` |
| 10 | `/books` (Viewing as Accountant) | Load this company's keys (or Import key file) | Reconciliation: Every run reconciled, funded, paid, variance, explained and unexplained, with any cent of rounding shown under Difference |
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

Rehearsal 3, through the redesigned app, from a new seed whose wallet holds no other runs (so the contractor, the accountant and the company see the same single run), 5 Oct 2026: run 09019bd8-d31d-400b-a779-050afeb3083e, allocation 91087ec36cce... at 4,466,910 (full record: [proof/rehearsal-3.json](proof/rehearsal-3.json)). Timings in seconds: onboard six 7, approve 0, fund 5, pay and six confirmations 80, explorer check 1, contractor portal 5, accountant books 25, CSV 3; 2.2 minutes wall clock.

| Contractor | Txid | Height |
| --- | --- | ---: |
| Amara Okafor | b597daba92b76495421d44c22b7c6282ca8f053cad6de06fdcb648a01d2bf0c3 | 4,466,912 |
| Mateo Fernandez | 24e99d9802a6cb0573ea309e4e2e614477ce933ebf879971fce86f7f19b2216a | 4,466,912 |
| Priya Raman | 4a90a0894343a365e7a116457c0230bb57a350a70df82a6209c91078ff110498 | 4,466,912 |
| Jonas Lindqvist | f2e6094e0bed1b4784e9d778bd38f30dc89beb2f5b907d4d861b73f6dcfa0919 | 4,466,912 |
| Mei Chen | 866266aeab8424ad048492bdc7027a9e6f900beabf4fd5b5f25d5c221705289c | 4,466,912 |
| Kwame Mensah | 04cffca310a3362df7fd53ccea6e8938a15c2bcd3e57c489bb856adaa96d32c4 | 4,466,912 |

Earlier testnet runs of the same flow: the driver script `scripts/mainnet-demo.sh` (run 284c2421, [proof/testnet-rehearsal-284c2421.md](proof/testnet-rehearsal-284c2421.md)) and the Round 2 end-to-end test (run 85ea4bdc, [proof/e2e-round2-85ea4bdc.json](proof/e2e-round2-85ea4bdc.json)).

## Mainnet run

Mainnet differs from the rehearsals in three ways: funding is a real USDC deposit swapped by NEAR Intents 1Click; blocks are 75 seconds and the service waits for three confirmations before spending (`PAYSLIP_MIN_CONFIRMATIONS=3`), so execution takes roughly ten minutes instead of two; and a converting contractor's USDC is delivered by the venue about eight minutes after their payment confirms.

### Prerequisites

- An EVM wallet in the browser (for example MetaMask) holding the USDC deposit on Base (or Arbitrum or Ethereum) plus a little ETH for gas on that chain.
- `scripts/demo/mainnet.env`, copied from `scripts/demo/mainnet.env.example`. It holds the mainnet passphrase and is ignored by git.
- `scripts/demo/contractors.mainnet.json`, copied from `scripts/demo/contractors.mainnet.example.json`: the six names, unified addresses, USD amounts and invoice references. With `DEMO_GENERATED_WALLETS=yes` the empty addresses are filled from generated demo wallets whose payouts can be swept back to the treasury afterwards; otherwise every contractor needs a real unified address. The example converts Priya's pay to USDC delivered to `DEMO_REFUND_ADDRESS`, so that leg returns to the payer.

### Funding amount

The service asks the venue for the payroll plus 1.5 times the estimated network fees, valued at the venue's current price; the surplus stays in the treasury and is reported as unspent. With the example amounts (payroll $30.38) and ZEC at $1,354.93 (5 Oct 2026) that is about $32.52 USDC. The exact figure and the deposit address are printed by the script and shown on the Fund step when the run is funded; the deposit address is valid for one hour.

### Commands

```
cd service && cargo build --release
scripts/mainnet-demo.sh scripts/demo/mainnet.env          # stops before funding; prints the plan
scripts/mainnet-demo.sh scripts/demo/mainnet.env --yes    # requests the deposit address and waits
```

Then in the browser open the run (`http://127.0.0.1:3000/console/runs/new?run=<run id>`, the id is printed). The deposit request already exists, so the Fund step shows the deposit address: Connect Wallet, then Send <amount> USDC. The script follows the venue and the payments and writes `scripts/demo/out/proof-mainnet-<run>.md` with the six txids and heights, plus the statement and reconciliation CSVs. Copy the proof table into the README.

After recording, generated contractor wallets can be swept back: `cd service && ./target/release/payslip-service dev-sweep --allow-mainnet`.

### Recording (product demo, three minutes at most)

The word-for-word narration, timed against this click path, is in [LAUNCH.md](LAUNCH.md), along with the presentation video script. It adds two steps after the contractor statement: Prove this payment, opening the `/verify` link, and the Koinly and Xero exports.
