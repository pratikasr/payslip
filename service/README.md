# Payslip service

Rust service: wallet core on `zcash_client_backend` 0.25.0-pre.0, run executor, swap venue clients, statement engine and the HTTP API described in [docs/API.md](../docs/API.md).

## Run

```
cp .env.example .env          # then set ZCASH_NETWORK=testnet and PAYSLIP_SEED_PASSPHRASE
cargo build --release
./target/release/payslip-service init      # creates the encrypted payer seed and prints the treasury address
./target/release/payslip-service serve     # HTTP API on 127.0.0.1:8080
```

Every command (`./target/release/payslip-service --help` prints the same list):

| Command | What it does |
| --- | --- |
| `serve` | The HTTP API (the default). `PAYSLIP_MODE=statements` serves statements and payment proofs only, with no seed |
| `init [--import]` | Creates the encrypted payer seed and the treasury account; `--import` reads a 24-word mnemonic from stdin |
| `address` | Prints the treasury's unified address |
| `seed-phrase` | Prints the treasury seed's 24-word recovery phrase (needs `PAYSLIP_SEED_PASSPHRASE`); write it down and keep it off the machine |
| `sync` | Syncs the payer wallet to the chain tip and prints balances |
| `fvk --account N` | Prints the unified full viewing key of ZIP-32 account N |
| `account-address --account N` | Prints the payer-side unified address of account N |
| `send --from N --to ADDR --zat N [--memo TEXT]` | Sends a shielded payment with a memo from account N (development helper) |
| `sweep --from N --to ADDR` | Sends the whole spendable balance of account N, minus the fee, to an address |
| `scan --ufvk KEY [--birthday H]` | Scans the chain with a viewing key and prints every output with its decoded memo |
| `dev-contractors [--count N] [--allow-mainnet]` | Prints N addresses from the separate demo contractor seed; mainnet needs `--allow-mainnet` |
| `dev-sweep [--count N] [--allow-mainnet]` | Sweeps the demo contractor wallets back to the treasury; mainnet needs `--allow-mainnet` |
| `dev-mainnet-ufvk` | Testing helper: prints a mainnet viewing key derived from an all-zero test seed, which holds no funds |

## Test

```
cargo test                       # unit and executor tests, no network
ZCASH_NETWORK=testnet LIGHTWALLETD_URL=https://testnet.zec.rocks:443 cargo test --test testnet -- --ignored   # live testnet tests
cargo clippy --all-targets -- -D warnings
```

Layout: `src/wallet` (one SQLite wallet per thread, sync with memo enhancement, transfers), `src/payer.rs` (treasury and contractor accounts), `src/viewer.rs` (view-only scanning with supplied keys), `src/runs.rs` (state machine and executor), `src/statements.rs` (statements and reconciliation), `src/venue.rs` (NEAR Intents 1Click, Maya, testnet fixed-rate venue), `src/api` (axum routes), `migrations/` (app tables).
