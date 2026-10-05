# Demo

The 90-second demo script from `docs/SPEC.md`, the exact click path that performs it, two timed testnet rehearsals from clean databases, and the runbook for the recorded mainnet run.

## Click path

Start: the service running (`payslip-service serve`), the web app running (`pnpm start`), and a funded treasury. On testnet the treasury holds faucet coins and the fixed-rate testnet venue stands in for the swap; on mainnet the payer deposits USDC at step 4.

| # | Where | Click | What the viewer sees |
| --- | --- | --- | --- |
| 1 | `/app/payer/contractors` | Add contractor, then Name, Email, Unified address, Hold ZEC (or Convert to USDC with chain and payout address), Add contractor. Repeat for six | Six rows, accounts 1 to 6. Each contractor gets their own ZIP-32 account |
| 2 | Same page | Share viewing key on one contractor | The account's unified full viewing key as text and QR, with Copy key and Download |
| 3 | `/app/payer/runs/new` | Fill Amount and Invoice reference per contractor, Create run | The run page for "Run for Sep 2026" with a Fund, Execute, Paid stepper |
| 4 | Run page, Fund step | Testnet: Confirm funding. Mainnet: Pay USDC from (chain), Refund address, Get deposit address, then Connect Wallet and Send <amount> USDC (or Switch to <chain> and send); amount, token and deposit address are pre-filled. Then wait for the venue | Funding status moves through deposit seen and swapping to funded; the fill rate appears in the run summary |
| 5 | Run page | Execute run | Live progress over SSE: allocation broadcast and confirmed, then six payments, each row turning Confirmed with its txid, explorer link and height |
| 6 | Run page, "Who can see this run" | Open any txid's explorer link | Left: what a public chain would show (sender, recipient, amount per line). Right and in the explorer: shielded transactions, no amount, no parties |
| 7 | `/app/contractor` | Paste the key from step 2, Show statement | That contractor's statement only: date, ZEC, USD basis, rate, invoice, period, txid, height, running totals; Export CSV and Print / Save as PDF |
| 8 | `/app/payer/contractors` | Export all viewing keys for accountant, Download JSON | A JSON file with seven keys (treasury and six contractors) |
| 9 | `/app/accountant` | Import file, Choose export file, then Reconcile 7 keys | Per-run reconciliation: funded USD, ZEC acquired, fill rate, paid, fees, unspent, variance and explained, status Reconciled; every pay line; unlabelled transactions listed |
| 10 | Same page | Export CSV | The reconciliation and every line as CSV |

The same path is automated in `web/e2e/demo.spec.ts`, which is how the rehearsals below were run and timed.

## Testnet rehearsals

Both from a clean database (`scripts/fresh-testnet-env.sh`, which keeps only the encrypted seeds), one straight after the other, on 5 Oct 2026 UTC. Times in seconds; "wall clock" covers the whole path including waiting for the chain.

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

Then in the browser open the run page (`http://127.0.0.1:3000/app/payer/runs/<run id>`, the id is printed). The deposit request already exists, so the Fund step shows the deposit address: Connect Wallet, then Send <amount> USDC. The script follows the venue and the payments and writes `scripts/demo/out/proof-mainnet-<run>.md` with the six txids and heights, plus the statement and reconciliation CSVs. Copy the proof table into the README.

After recording, generated contractor wallets can be swept back: `cd service && ./target/release/payslip-service dev-sweep --allow-mainnet`.

### Recording (product demo, three minutes at most)

The word-for-word narration, timed against this click path, is in [LAUNCH.md](LAUNCH.md), along with the presentation video script. It adds two steps after the contractor statement: Prove this payment, opening the `/verify` link, and the Koinly and Xero exports.
