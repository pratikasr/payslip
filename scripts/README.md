# scripts

Development and demo helpers. Each script starts with a header comment that says what it does and how to call it. Run them from the repository root.

| Script | What it does |
| --- | --- |
| `mainnet-demo.sh <config.env> [--yes]` | The six-contractor demo end to end: builds the service, creates the seed if needed, starts the service (or reuses one only when it holds the same treasury), onboards, creates, funds and pays the run, then writes the proof, statement CSVs and a judge kit to `scripts/demo/out/`. Configs: `demo/testnet-rehearsal.env` (its own port 8180 and data directory) and `demo/mainnet.env`, copied from `demo/mainnet.env.example` (git-ignored, holds its own passphrase). |
| `seed-testnet-contractors.sh <API_URL>` | Adds the six demo contractors, with addresses from the dev contractor seed, to the testnet service at that URL. The URL is required. |
| `fresh-testnet-env.sh <name>` | Creates `service/data/<name>` with empty databases and copies of the testnet seeds, for a clean end-to-end run or rehearsal. |
| `e2e-treasury-key.sh` | Browser tests for the treasury key made in the browser (`web/e2e/treasury-key.spec.ts`): a service started with no seed file and `PAYSLIP_AUTH=required` on port 8097, the web app with the test login on 3322. Skips itself on a service whose health does not report `treasury`. |
| `adversarial-testnet.py` | The adversarial scenarios of docs/TEST-REPORT.md Round 3 against a testnet service; `--skip-chain` leaves out the ones that spend testnet coins. |
| `demo/contractors.example.json`, `demo/contractors.mainnet.example.json` | The six demo contractors with testnet and small mainnet amounts. |

None of them should be pointed at a wallet you care about: `mainnet-demo.sh` and `seed-testnet-contractors.sh` write to the service they reach.
