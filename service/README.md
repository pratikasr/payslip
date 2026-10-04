# Payslip service

Rust service: wallet core on `zcash_client_backend` 0.25.0-pre.0, run executor, swap venue clients, statement engine and the HTTP API described in [docs/API.md](../docs/API.md).

## Run

```
cp .env.example .env          # then set ZCASH_NETWORK=testnet and PAYSLIP_SEED_PASSPHRASE
cargo build --release
./target/release/payslip-service init      # creates the encrypted payer seed and prints the treasury address
./target/release/payslip-service serve     # HTTP API on 127.0.0.1:8080
```

Other commands: `address`, `sync`, `fvk --account N`, `send --from N --to ADDR --zat N --memo TEXT`, `scan --ufvk KEY`, `dev-contractors` (testnet only).

## Test

```
cargo test                       # unit tests, no network
cargo clippy --all-targets -- -D warnings
```

Layout: `src/wallet` (one SQLite wallet per thread, sync with memo enhancement, transfers), `src/payer.rs` (treasury and contractor accounts), `src/viewer.rs` (view-only scanning with supplied keys), `src/runs.rs` (state machine and executor), `src/statements.rs` (statements and reconciliation), `src/venue.rs` (NEAR Intents 1Click, Maya, testnet fixed-rate venue), `src/api` (axum routes), `migrations/` (app tables).
