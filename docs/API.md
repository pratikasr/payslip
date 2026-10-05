# Payslip service API

REST over JSON, served by `service/` (default `http://127.0.0.1:8080`). The web app calls it directly with CORS (origin from `PAYSLIP_WEB_ORIGIN`). Run progress streams over Server-Sent Events.

## Conventions

- Amounts are integers. ZEC in zatoshis (`*_zat`, 1 ZEC = 100,000,000 zat). USD in cents (`*_usd_cents`). Rates in USD per ZEC times 1,000,000 (`rate_usd_per_zec_e6`).
- Heights are block heights. Txids are 64 hex characters in display order (the order explorers use).
- Dates are `YYYY-MM-DD` (UTC). Timestamps are RFC 3339 UTC.
- Every error is `{"error": {"code": "...", "message": "...", "hint": "..."}}` with a 4xx or 5xx status. `hint` always names the fix.
- The payer endpoints (wallet, contractors, runs) are meant for the payer's own host. The statement endpoints take viewing keys only and never accept a spending key.

## Health and wallet

### GET /api/health

```json
{"status": "ok", "network": "testnet", "lightwalletd": "https://testnet.zec.rocks:443",
 "chain_tip": 4465100, "wallet_synced_height": 4465100, "venue": "testnet-fixed-rate",
 "birthday_height": 4460000, "version": "0.1.0"}
```

`venue` is `near-intents-1click`, `maya` or `testnet-fixed-rate`. The testnet venue exists only when the service runs on testnet. `status` is `ok`, `degraded` (lightwalletd unreachable or a warning such as clock skew, listed in `warnings`) or `syncing` (the wallet is busy with a sync; heights come from the last snapshot). `clock_skew_seconds` is the server clock minus the tip block's time; blocks lag real time, so only a value past 15 minutes produces a warning. Health never waits for a wallet sync.

### GET /api/wallet

```json
{"network": "testnet", "chain_tip": 4465100, "synced_height": 4465100,
 "treasury": {"account_index": 0, "unified_address": "utest1...", "spendable_zat": 150000000,
              "pending_zat": 0, "total_zat": 150000000},
 "contractor_accounts": 6}
```

### POST /api/wallet/sync

Syncs the payer wallet to the chain tip, then returns the same body as `GET /api/wallet`.

## Contractors

```json
Contractor = {
  "id": "uuid", "name": "Amara Okafor", "email": "amara@example.com",
  "unified_address": "utest1...", "account_index": 1,
  "settlement_choice": "hold_zec" | "convert_usdc",
  "payout_chain": "base" | null, "payout_address": "0x..." | null,
  "fvk_shared_at": "2026-10-05T10:00:00Z" | null,
  "created_at": "2026-10-05T09:00:00Z"
}
```

- `GET /api/contractors` returns `{"contractors": [Contractor]}`.
- `POST /api/contractors` with `{name, unified_address, settlement_choice, email?, payout_chain?, payout_address?}` returns `201` and the Contractor. The service allocates the next ZIP-32 account. Errors: `invalid_address` (not a unified address for this network), `address_without_shielded_receiver`, `duplicate_address`, `payout_address_required`.
- `GET /api/contractors/{id}` returns the Contractor.
- `PATCH /api/contractors/{id}` with any of the create fields returns the Contractor.
- `DELETE /api/contractors/{id}` archives the contractor. `409 contractor_in_active_run` if a run that includes them has not finished.
- `GET /api/contractors/{id}/viewing-key` returns `{"contractor_id", "account_index", "ufvk", "birthday_height", "network"}`. The `ufvk` string is also the QR payload.
- `POST /api/contractors/{id}/viewing-key/shared` records `fvk_shared_at` and returns the Contractor.
- `GET /api/viewing-keys` returns the accountant export: `{"network", "birthday_height", "keys": [{"label": "Treasury" | contractor name, "role": "treasury" | "contractor", "account_index", "ufvk", "contractor_id": "uuid" | null}]}`.

## Runs

```json
Run = {
  "id": "uuid", "status": "draft" | "awaiting_funds" | "funded" | "swapping" | "swapped"
                         | "allocating" | "paying" | "paid" | "failed",
  "period_start": "2026-09-01", "period_end": "2026-09-30", "period_label": "2026-09",
  "total_usd_cents": 2845000, "total_zat": 2100000000,
  "funding": null | {
    "venue": "near-intents-1click" | "maya" | "testnet-fixed-rate",
    "status": "awaiting_deposit" | "processing" | "success" | "refunded" | "failed" | "expired",
    "origin_asset": "USDC", "origin_chain": "base", "token_address": "0x8335...",
    "chain_id": 8453, "amount_in": "28462.150000", "amount_in_base_units": "28462150000",
    "deposit_address": "0x...", "deadline": "2026-10-05T11:00:00Z",
    "funded_usd_cents": 2846215, "zec_acquired_zat": 2101000000,
    "rate_usd_per_zec_e6": 1354930000, "venue_ref": "..."
  },
  "fees_zat": 70000,
  "lines": [PayLine],
  "error": null | {"code", "message", "hint"},
  "created_at", "updated_at"
}

PayLine = {
  "id": "uuid", "contractor_id": "uuid", "contractor_name": "Amara Okafor",
  "account_index": 1, "invoice_ref": "INV-2026-014",
  "amount_usd_cents": 480000, "amount_zat": 354262000,
  "status": "pending" | "allocated" | "broadcast" | "confirmed" | "failed",
  "allocation_txid": "hex" | null, "txid": "hex" | null,
  "confirmed_height": 4465123 | null, "explorer_url": "https://..." | null,
  "memo": "PS1|...", "error": null | {"code", "message", "hint"}
}
```

- `GET /api/runs` returns `{"runs": [Run]}` newest first.
- `POST /api/runs` with `{"period_start", "period_end", "lines": [{"contractor_id", "amount_usd_cents", "invoice_ref"}], "idempotency_key": "client-uuid"}` returns `201` and the Run in `draft`. Repeating the same `idempotency_key` returns `200` and the existing Run. Errors: `invalid_amount` (zero or negative), `invalid_period`, `unknown_contractor`, `duplicate_contractor_line`, `invoice_ref_too_long`.
- `GET /api/runs/{id}` returns the Run.
- `DELETE /api/runs/{id}` discards a run that is still a `draft` and returns `204`; any other status returns `409 run_not_draft`.
- `POST /api/runs/{id}/fund` with `{"origin_chain": "base", "refund_address": "0x..."}` asks the venue for a quote and deposit address and returns the Run in `awaiting_funds`. On testnet with the testnet venue no deposit is needed: the run moves to `funded` at once if the treasury holds enough, otherwise `409 treasury_insufficient` with the treasury address in the hint.
- `POST /api/runs/{id}/funding/deposit-tx` with `{"tx_hash": "0x..."}` tells the venue which transaction carried the deposit. Optional; it speeds up detection.
- `GET /api/runs/{id}/funding` polls the venue and returns the Run (status moves to `funded` when the venue reports success and the ZEC is in the treasury).
- `POST /api/runs/{id}/execute` starts or resumes the run executor and returns `202` and the Run. Calling it again while the run is executing is a no-op that returns the current Run.
- `GET /api/runs/{id}/events` is an SSE stream. Event `snapshot` carries the full Run JSON on connect and after every change. Event `log` carries `{"at", "message"}`. A comment ping every 15 seconds keeps proxies open.

## Statements

Both statement endpoints scan the chain with the viewing keys supplied, decode Payslip memos, and join them to runs. Scanning is incremental per key set, so the second request is fast.

### POST /api/statements/contractor

Body `{"ufvk": "uviewtest1...", "from": "2026-09-01", "to": "2026-10-31"}`.

```json
Statement = {
  "network": "testnet", "account": {"fingerprint": "8f3a...", "account_index": 1 | null,
                                     "label": "Amara Okafor" | null},
  "period": {"from": "2026-09-01", "to": "2026-10-31"},
  "scanned_to_height": 4465200, "generated_at": "2026-10-05T12:00:00Z",
  "lines": [{"date": "2026-10-05", "block_time": "2026-10-05T11:42:10Z", "height": 4465123,
             "txid": "hex", "amount_zat": 354262000, "usd_basis_cents": 480000,
             "rate_usd_per_zec_e6": 1354930000, "run_id": "uuid", "period": "2026-09",
             "invoice_ref": "INV-2026-014", "running_zat": 354262000,
             "running_usd_cents": 480000, "explorer_url": "https://..."}],
  "pending": [StatementLine without height],
  "totals": {"count": 1, "zat": 354262000, "usd_cents": 480000},
  "unlabelled": [{"date", "height", "txid", "direction": "in" | "out", "amount_zat",
                  "memo_text": "..." | null, "reason": "no_memo" | "unknown_prefix" | "malformed"}],
  "funding": [{"date", "height", "txid", "amount_zat", "run_id"}]
}
```

A line is in the period when its block time (UTC) falls on or between `from` and `to`. Unmined payments are listed under `pending` and excluded from totals. Errors: `invalid_viewing_key`, `wrong_network`, `spending_key_rejected`, `invalid_period`.

`POST /api/statements/contractor.csv` takes the same body and returns `text/csv` with columns `date,block_time,height,txid,amount_zec,usd_basis,rate_usd_per_zec,run_id,period,invoice_ref,running_zec,running_usd`. Unlabelled lines follow under a `# unlabelled` section so nothing is dropped.

### POST /api/statements/accountant

Body `{"ufvks": ["uviewtest1...", "..."], "from": "2026-09-01", "to": "2026-10-31"}`.

```json
Reconciliation = {
  "network", "period", "scanned_to_height", "generated_at",
  "accounts": [{"fingerprint", "account_index", "label", "role": "treasury" | "contractor" | "unknown"}],
  "runs": [{"run_id": "uuid", "period": "2026-09", "funded_usd_cents": 2846215,
            "zec_acquired_zat": 2101000000, "rate_usd_per_zec_e6": 1354930000,
            "paid_usd_cents": 2845000, "paid_zat": 2099727000, "lines": 6,
            "network_fees_zat": 70000, "unspent_zat": 1203000,
            "variance_usd_cents": 1215, "explained_usd_cents": 1215,
            "status": "reconciled" | "variance_unexplained" | "missing_funding_record" | "incomplete"}],
  "lines": [StatementLine plus {"account_index", "label"}],
  "unlabelled": [...],
  "totals": {"funded_usd_cents", "paid_usd_cents", "variance_usd_cents", "paid_zat", "count"}
}
```

`variance_usd_cents = funded_usd_cents - paid_usd_cents`. `explained_usd_cents` is the ZEC acquired but not paid out (network fees plus unspent treasury value) valued at the run's fill rate. A run is `reconciled` when the two agree to the cent after rounding.

`POST /api/statements/accountant.csv` returns the run reconciliation table followed by every line.
