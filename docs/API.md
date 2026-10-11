# Payslip service API

REST over JSON, served by `service/` (default `http://127.0.0.1:8080`). The web app calls it directly with CORS (origin from `PAYSLIP_WEB_ORIGIN`), or, with sign-in on, through its own same-origin proxy at `/api/svc`, which attaches the signed-in member's token (see Sign-in and roles). Run progress streams over Server-Sent Events.

## Conventions

- Amounts are integers. ZEC in zatoshis (`*_zat`, 1 ZEC = 100,000,000 zat). USD in cents (`*_usd_cents`). Rates in USD per ZEC times 1,000,000 (`rate_usd_per_zec_e6`).
- Heights are block heights. Txids are 64 hex characters in display order (the order explorers use).
- Dates are `YYYY-MM-DD` (UTC). Timestamps are RFC 3339 UTC.
- Every error is `{"error": {"code": "...", "message": "...", "hint": "..."}}` with a 4xx or 5xx status. `hint` always names the fix. That includes requests the service refuses before any handler runs:

  | Status | Code | When |
  | --- | --- | --- |
  | 400 | `invalid_json` | the body is not well-formed JSON |
  | 400 | `invalid_query` | a query parameter cannot be read |
  | 401 | `unauthenticated` | sign-in is required and the request carries no valid token (missing, expired, signed by an unknown key, for another issuer or audience); the message says which |
  | 403 | `forbidden` | the signed-in person is not a member, or their role cannot do this; the message names the role and the hint says who can change it |
  | 404 | `not_found` | no such endpoint |
  | 404 | `statements_only` | a payer endpoint on a statements-only deployment |
  | 405 | `method_not_allowed` | the endpoint exists but not with this method (the `Allow` header lists the methods) |
  | 413 | `body_too_large` | the body is over 2 MB |
  | 415 | `json_required` | a POST, PATCH, PUT or DELETE without `Content-Type: application/json` (a bodyless request still sends the header) |
  | 421 | `host_not_allowed` | the `Host` header is not the service's own address or one in `PAYSLIP_ALLOWED_HOSTS` |
  | 422 | `invalid_body` | a field is missing or has the wrong type; the message names the field |
  | 503 | `auth_unavailable` | sign-in is required and the service cannot fetch the web app's signing keys (`PAYSLIP_AUTH_JWKS_URL`) |

- An error about particular runs also names them in `error.runs`, a list of run ids (`period_overlap`, `idempotency_mismatch`); other errors have no `runs` field.
- The payer endpoints (wallet, contractors, runs) are meant for the payer's own host, or for signed-in members when sign-in is on. The statement endpoints take viewing keys only and never accept a spending key.

## Sign-in and roles

Off by default (`PAYSLIP_AUTH=off`): every payer endpoint is open on the payer's own host, as in the testnet demo. With `PAYSLIP_AUTH=required` (ADR-026):

- Every payer endpoint (wallet, contractors, viewing keys, runs, run progress) and every endpoint below needs `Authorization: Bearer <token>`. The token is a short EdDSA JWT minted by the web app for a signed-in person (Google sign-in through Better Auth); the service checks it against the web app's published keys (`PAYSLIP_AUTH_JWKS_URL`, cached, fetched again on an unknown key id), its issuer (`PAYSLIP_AUTH_ISSUER`), audience (`PAYSLIP_AUTH_AUDIENCE`, `payslip-service`) and expiry, 30 seconds of leeway. The web app's proxy at `/api/svc/api/...` attaches it; the browser never holds it.
- Health, statements, exports and payment proofs stay public: they are key-based.
- The token's person becomes a `user` on first sight (matched by Google account id, then token subject, then verified email). The first verified sign-in with `PAYSLIP_BOOTSTRAP_ADMIN_EMAIL`, while the organisation has no admin, creates the organisation (named after the email's domain until renamed) and makes that person its admin. Every later membership comes from an invitation.
- Roles. A signed-in person who is not a member gets `403 forbidden` everywhere but `GET /api/me` and invitation acceptance.

  | Endpoint | admin | approver | accountant | viewer |
  | --- | --- | --- | --- | --- |
  | `GET` wallet, contractors, runs, run funding, progress, log, `/api/org`, `/api/org/members`, `/api/me` | yes | yes | yes | yes |
  | `GET /api/contractors/{id}/viewing-key`, `GET /api/viewing-keys` | yes | | yes | |
  | `POST /api/wallet/sync` | yes | | | |
  | `POST`, `PATCH`, `DELETE` contractors; mark a key shared or not | yes | | | |
  | `POST /api/runs`, discard, fund, deposit-tx, execute, cancel | yes | yes | | |
  | `PATCH /api/org`, members (role, remove), invitations (list, create, revoke) | yes | | | |
  | `GET /api/org/audit` | yes | | yes | |

- Audit log. Every successful write under sign-in adds a row (who, their role, the action, the target id, the time, details), and so do the two viewing-key reads (`contractor.key_view`, `keys.export`). Actions: `org.bootstrap`, `org.update`, `member.role`, `member.remove`, `invitation.create`, `invitation.revoke`, `invitation.accept`, `wallet.sync`, `contractor.create|update|archive|key_view|key_shared|key_unshared`, `keys.export`, `run.create|discard|fund|deposit_tx|execute|cancel`. The target of a create is the new id; an invitation's target is its id, never its token.

### GET /api/me

```json
{"auth": "required",
 "user": {"id": "...", "email": "amara@acme.test", "name": "Amara", "picture_url": "https://..." | null},
 "membership": {"role": "admin" | "approver" | "accountant" | "viewer",
                "org": {"id": "uuid", "name": "Acme Robotics", "logo_url": "https://..." | null, "created_at": "..."},
                "since": "2026-10-11T09:00:00Z"} | null}
```

### GET /api/org, PATCH /api/org

`GET` returns the organisation (`id`, `name`, `logo_url`, `created_at`). `PATCH` (admin) with `{name?, logo_url?}` returns it updated: `name` 1 to 120 characters (`400 invalid_name`); `logo_url` an http or https URL of at most 2,048 characters, or `null` to remove it (`400 invalid_logo_url`).

### Members

- `GET /api/org/members` returns `{"members": [{"user_id", "email", "name", "picture_url", "role", "created_at"}]}`.
- `POST /api/org/members` (admin) with `{"user_id", "role"}` changes a member's role and returns the member. `400 invalid_role`, `404 not_found` (not a member), `409 last_admin` (the only admin cannot be demoted).
- `DELETE /api/org/members/{user_id}` (admin) removes a member: `204`. `409 last_admin` for the only admin.

### Invitations

Invitations are copy-paste links; the service keeps only the SHA-256 of the token.

- `POST /api/org/invitations` (admin) with `{"email", "role"}` returns `201` and `{"id", "email", "role", "status": "pending", "expires_at", "accepted_at": null, "created_at", "token"}`. The token appears only here: the web app turns it into `<web origin>/invite/<token>`. A link lasts 7 days. An earlier open invitation for the same email is revoked. `400 invalid_email`, `400 invalid_role`, `409 already_a_member`.
- `GET /api/org/invitations` (admin) returns `{"invitations": [...]}` without tokens, newest first, each with `status` `pending`, `accepted` or `expired` (revoked ones are left out).
- `DELETE /api/org/invitations/{id}` (admin) revokes an open invitation: `204`. `409 invitation_closed` if it was already accepted or revoked.
- `POST /api/org/invitations/{token}/accept` needs a signed-in person (any token, no membership) whose verified email is the invited one. Returns `{"membership": {...}}` as in `/api/me`. `404 not_found` (unknown or revoked link), `409 invitation_used`, `409 invitation_expired`, `403 forbidden` (signed in with another email; the message names both), `409 already_a_member`.

### GET /api/org/audit

Admin and accountant. `?limit=` (1 to 500, default 100) and `?before=<id>` for older pages.

```json
{"entries": [{"id": 42, "at": "2026-10-11T09:05:12Z",
              "user": {"id": "...", "email": "owner@acme.test", "name": "Owner"} | null,
              "role": "admin", "action": "invitation.create", "target": "uuid",
              "details": {"email": "amara@acme.test", "role": "viewer", "expires_at": "..."} | null}]}
```

## Health and wallet

### GET /api/health

```json
{"status": "ok", "network": "testnet", "lightwalletd": "https://testnet.zec.rocks:443",
 "chain_tip": 4465100, "wallet_synced_height": 4465100, "venue": "testnet-fixed-rate",
 "birthday_height": 4460000, "version": "0.1.0", "mode": "full" | "statements",
 "app_fee_bps": 0, "market_prices": true, "simulated_rate_usd_per_zec": 1350000.0 | null,
 "auth": "off" | "required"}
```

`auth` is `required` when payer endpoints need a signed-in member (Sign-in and roles above).

`mode` is `statements` when the service runs with `PAYSLIP_MODE=statements`: it holds no wallet, answers statements, payment proofs and health, and every payer endpoint (wallet, contractors, viewing keys and runs, reads included) returns 404 `statements_only`. Such a deployment is safe to host publicly for contractors, accountants and judges. `app_fee_bps` is Payslip's own fee on the USDC to ZEC funding swap (0 when none; ADR-020). `market_prices` says whether statements carry the market value of each payment at receipt (ADR-022). `simulated_rate_usd_per_zec` is the testnet venue's fixed rate in USD per ZEC (`PAYSLIP_TESTNET_RATE_USD`, default 1,350,000), the same value the run executor's venue funds every testnet run at, so a client can estimate a run's ZEC before any fill: `amount_usd_cents / 100 / simulated_rate_usd_per_zec` ZEC. It is `null` on mainnet, with any other venue, and in statements mode.

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
- `POST /api/contractors` with `{name, unified_address, settlement_choice, email?, payout_chain?, payout_address?}` returns `201` and the Contractor. The service allocates the next ZIP-32 account. Errors: `invalid_address` (not a unified address for this network), `address_without_shielded_receiver`, `duplicate_address`, `payout_address_required`, `invalid_payout_address` (Base, Arbitrum and Ethereum: `0x` and 40 hex characters; Solana: a base58 public key of exactly 32 bytes).
- `GET /api/contractors/{id}` returns the Contractor.
- `PATCH /api/contractors/{id}` with any of the create fields returns the Contractor. The unified address, settlement choice, payout chain and payout address cannot change while a run that pays the contractor is in progress (`409 contractor_in_active_run`); the name and email can. A run in progress is one that is not `draft`, `paid` or `cancelled`. A run pays each contractor with the details they had when it was funded.
- `DELETE /api/contractors/{id}` archives the contractor. `409 contractor_in_active_run` if a run that includes them is in progress. A draft that includes an archived contractor cannot be funded (`409 contractor_archived`); discard it and create a new one.
- `GET /api/contractors/{id}/viewing-key` returns `{"contractor_id", "account_index", "ufvk", "ufvk_wallet", "birthday_height", "network"}`. The `ufvk` string (ZIP 316 Revision 2, `uvf`/`uvftest`) is also the QR payload. `ufvk_wallet` is the same key in the Revision 0 form (`uview`/`uviewtest`) that released wallets such as Zingo and Zkool import; Payslip accepts either.
- `POST /api/contractors/{id}/viewing-key/shared` records `fvk_shared_at` and returns the Contractor.
- `DELETE /api/contractors/{id}/viewing-key/shared` undoes it: clears `fvk_shared_at` and returns `200` and the Contractor (also when it was not set). Like every write it needs `Content-Type: application/json`; the body may be `{}` or empty. It changes only the record: a key already handed over still reads the contractor's payments. `404 not_found` for an unknown or archived contractor.
- `GET /api/viewing-keys` returns the accountant export: `{"network", "birthday_height", "keys": [{"label": "Treasury" | contractor name, "role": "treasury" | "contractor", "account_index", "ufvk", "contractor_id": "uuid" | null}]}`.

## Runs

```json
Run = {
  "id": "uuid", "status": "draft" | "awaiting_funds" | "funded" | "swapping" | "swapped"
                         | "allocating" | "paying" | "paid" | "failed" | "cancelled",
  "period_start": "2026-09-01", "period_end": "2026-09-30", "period_label": "2026-09",
  "total_usd_cents": 2845000, "total_zat": 2100000000,
  "funding": null | {
    "venue": "near-intents-1click" | "maya" | "testnet-fixed-rate",
    "status": "awaiting_deposit" | "deposit_seen" | "processing" | "success" | "incomplete"
              | "refunded" | "failed" | "expired",
    "origin_asset": "USDC", "origin_chain": "base", "token_address": "0x8335...",
    "chain_id": 8453, "amount_in": "28462.150000", "amount_in_base_units": "28462150000",
    "deposit_address": "0x...", "deadline": "2026-10-05T11:00:00Z",
    "funded_usd_cents": 2846215, "zec_acquired_zat": 2101000000,
    "rate_usd_per_zec_e6": 1354930000, "venue_ref": "...",
    "router": "0x..." | null, "deposit_memo": "=:z:..." | null
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
  "confirmed_height": 4465123 | null, "confirmed_at": "2026-10-05T11:42:10Z" | null,
  "explorer_url": "https://..." | null,
  "memo": "PS1|...", "error": null | {"code", "message", "hint"}
}
```

A line's `settlement_choice`, `payout_chain` and the address it pays are the contractor's as they were when the run was funded; a draft shows the current ones.

`confirmed_at` is the block time (RFC 3339 UTC) of `confirmed_height`: `null` until the line is confirmed, set together with `confirmed_height`, and stored, so it does not change while the line stays confirmed. A reorg that takes the payment out of the chain clears both until it confirms again. The time is the block header's, the same time statements show as `block_time` for that txid, formatted the same way, so the date is the same on the run and on every statement. The service reads it from the payer wallet's record of the blocks it scanned, or else asks lightwalletd once. Lines confirmed before the service recorded block times, or while lightwalletd could not answer, get theirs at start-up or the next time their run is read (any of the run endpoints, the list, or the SSE snapshot); until then the field is `null` next to a `confirmed_height`.

`fees_zat` is the network fees of the run's mined transactions: the allocation once it is mined and each confirmed payment. A transaction that expired unmined paid no fee and is not counted, so the figure grows as the run confirms.

`funding.status` past the quote's `deadline` (plus 10 minutes' grace for a deposit sent at the last moment) is `expired` while no deposit has arrived: the address is dead. `router` and `deposit_memo` are set for Maya only: a USDC deposit goes through the router contract's `depositWithExpiry(deposit_address, asset, amount, deposit_memo, expiry)`, and the deadline is Maya's quote expiry.

A pay line's `error` can be set while the line is still in progress, as a warning: `broadcast_rejected` (the node refused the payment; it is rebuilt when it expires) or `waiting_for_funds` (the contractor account cannot cover the payment yet). A run stops with `failed` and one of these codes when the cause does not go away: `broadcast_rejected` (the node refused the same payment, or the allocation, three times), `line_underfunded` (a payment waited 120 blocks for funds), `treasury_insufficient` (the treasury no longer holds the allocation, for example because another run used it), or the funding codes below.

- `GET /api/runs` returns `{"runs": [Run]}` newest first.
- `POST /api/runs` with `{"period_start", "period_end", "lines": [{"contractor_id", "amount_usd_cents", "invoice_ref"}], "idempotency_key": "client-uuid", "allow_overlap": false}` returns `201` and the Run in `draft`. `idempotency_key` and `allow_overlap` are optional. Errors: `invalid_amount` (zero or negative, or over $10,000,000 for one line), `invalid_period`, `unknown_contractor`, `duplicate_contractor_line`, `invoice_ref_too_long` (over 64 characters), `invalid_invoice_ref` (empty, or a character outside printable ASCII, or `|`, which separates memo fields), `invalid_idempotency_key` (empty or over 100 characters), and the two `409`s below. Every line needs an invoice reference because it is written into the encrypted memo.
  - Idempotency: the service stores a SHA-256 of the request's period and lines (each line's `contractor_id`, `amount_usd_cents` and trimmed `invoice_ref`; line order does not matter) with the key. Repeating the key with the same period and lines returns `200` and the existing Run, before any other check, so a retry never fails on validation or overlap. Repeating it with a different period or different lines is `409 idempotency_mismatch`, with the existing run's id in the message and in `error.runs`; use a new key for a new run. `allow_overlap` is not part of the comparison. A run created before the service stored request hashes keeps the old behaviour: its key returns it whatever the body.
  - Overlap: a run whose period shares at least one day (inclusive) with a run that is not `cancelled` (drafts count) is `409 period_overlap`, after every other check passed. The message lists each overlapping run's id, period and status, and `error.runs` holds their ids, earliest period first. Send `"allow_overlap": true` to create the run anyway, for an extra run such as a bonus or a correction. The check is part of the insert, so two requests at once cannot both pass it.

  ```json
  {"error": {"code": "period_overlap",
             "message": "2026-09-15 to 2026-10-15 overlaps a run that is not cancelled: 7c1e... (2026-09-01 to 2026-09-30, paid).",
             "hint": "Paying a period twice pays these people twice. Finish, discard or cancel the other run, or choose another period. For an extra run (a bonus or a correction), send the request again with \"allow_overlap\": true.",
             "runs": ["7c1e..."]}}
  ```
- `GET /api/runs/{id}` returns the Run.
- `DELETE /api/runs/{id}` discards a run that is still a `draft` and returns `204`; any other status returns `409 run_not_draft`.
- `POST /api/runs/{id}/fund` with `{"origin_chain": "base", "refund_address": "0x..."}` asks the venue for a quote and deposit address and returns the Run in `awaiting_funds`. The USD requested is the payroll plus 1.5 times the network fees and carried change the run needs (each converting line carries 25,000 zat, a held one 10,000), so the run is covered even if the fill comes in up to a third under the indicative price. On testnet with the testnet venue no deposit is needed: the run moves to `funded` at once if the treasury holds enough, otherwise `409 treasury_insufficient` with the treasury address in the hint. Funding again is allowed for a run that received no money (no fill, no allocation), in `awaiting_funds`, `funded` or `failed`, once its quote is closed: `expired` (including a deadline that passed), `refunded` or `failed`. The service asks the venue for the quote's current state first. Errors: `quote_still_open` (the deposit address is open until its deadline; pay it or wait), `deposit_in_progress` (the venue holds a deposit for the run, or a partial one: `incomplete`), `run_already_funded` (the run received its ZEC; execute it to resume), `run_cancelled`, `contractor_archived`.
- `POST /api/runs/{id}/funding/deposit-tx` with `{"tx_hash": "0x..."}` tells the venue which transaction carried the deposit. Optional; it speeds up detection. `409 run_cancelled` on a cancelled run.
- `GET /api/runs/{id}/funding` polls the venue and returns the Run. The run moves to `funded` as soon as the venue reports the deposit (`deposit_seen`, `processing` or `success`), whichever a poll sees, and back to `awaiting_funds` if the venue then refunds it or the swap fails before a fill is recorded.
- `POST /api/runs/{id}/execute` starts or resumes the run executor and returns `202` and the Run. Calling it again while the run is executing is a no-op that returns the current Run. `409 run_cancelled` on a cancelled run. After a restart the service resumes every run past the swap and every run in `awaiting_funds` or `funded` that the payer had executed; funding alone never pays.
- `POST /api/runs/{id}/cancel` cancels a run that received no money: no fill recorded and no allocation built, in `draft`, `awaiting_funds`, `funded` or `failed`. It returns `200` and the Run in `cancelled`, which no longer counts as active (its contractors can be edited and archived) and stays on record. Cancelling a cancelled run is a no-op. An open deposit address may be abandoned: a deposit sent to it afterwards still reaches the treasury, as balance no run claims. Errors: `deposit_in_progress` (the venue holds a deposit for the run), `run_has_funds` (ZEC arrived or the allocation was built; execute the run to finish it).
- `GET /api/runs/{id}/events` is an SSE stream. Event `snapshot` carries the full Run JSON on connect and after every change. Event `log` carries `{"at", "message"}`. A comment ping every 15 seconds keeps proxies open. At most 32 streams are open at once; beyond that the request gets `503 too_many_streams`.

## Statements

Both statement endpoints scan the chain with the viewing keys supplied, decode Payslip memos, and join them to runs. Scanning is incremental per key set, so the second request is fast.

Where a scan starts: a key this deployment created (full mode) starts at its account's birthday. Any other key starts at the earlier of the request's `birthday_height` and `PAYSLIP_VIEWER_BIRTHDAY_HEIGHT`, whichever are given, else at Ironwood activation (testnet 4,134,000, mainnet 3,428,143), never at the payer wallet's own birthday. A key already scanned from a later height is scanned again from the earlier one when a request's `birthday_height` asks for it, so asking with an earlier birthday never silently misses payments; a request without `birthday_height` reuses the existing scan. `birthday_height` below Ironwood activation or above the chain tip is `400 invalid_birthday_height`. Every statement reports `scanned_from_height`: nothing before it is included.

Retention: to make the next request incremental, the service keeps a view-only scan of each key set it is sent (`PAYSLIP_DATA_DIR/viewers/<hash>.db`, readable by the service user only). It holds the viewing keys, which cannot spend. `POST /api/statements/forget` deletes it. If the client disconnects, the scan stops at its next request to lightwalletd and resumes with the next statement for the same keys. At most three scans run at once; a request that waits two minutes for a slot gets `503 scanner_busy`. If lightwalletd dropped an idle connection, the service reconnects and tries once more before answering.

### POST /api/statements/contractor

Body `{"ufvk": "uviewtest1...", "from": "2026-09-01", "to": "2026-10-31", "currency": "usd", "birthday_height": 4465600}`. `currency` (optional, default `usd`) is the ISO 4217 code for the market value at receipt; CoinGecko's fiat list is accepted (USD, EUR, GBP, INR, NGN, BRL and 38 more), anything else is 400 `invalid_currency`, checked before any scan. `birthday_height` (optional) is where to start scanning a key this deployment does not know (see above).

```json
Statement = {
  "network": "testnet", "account": {"fingerprint": "8f3a...", "account_index": 1 | null,
                                     "label": "Amara Okafor" | null,
                                     "role": "treasury" | "contractor" | "unknown"},
  "period": {"from": "2026-09-01", "to": "2026-10-31"},
  "scanned_from_height": 4465600, "scanned_to_height": 4465200, "generated_at": "2026-10-05T12:00:00Z",
  "lines": [{"date": "2026-10-05", "block_time": "2026-10-05T11:42:10Z", "height": 4465123,
             "txid": "hex", "amount_zat": 354262000, "usd_basis_cents": 480000,
             "rate_usd_per_zec_e6": 1354930000, "run_id": "uuid", "period": "2026-09",
             "invoice_ref": "INV-2026-014", "running_zat": 354262000,
             "running_usd_cents": 480000, "explorer_url": "https://...",
             "settlement": "held" | "converted", "to_address": "utest1..." | "t1..." | null,
             "market": {"currency": "USD", "price_cents": 135377, "value_cents": 480012,
                        "priced_at": "2026-10-05T11:40:00Z", "source": "coingecko"} | null}],
  "market": {"currency": "USD", "available": true, "total_cents": 480012, "priced_lines": 1,
             "unpriced_lines": 0, "source": "...", "note": "..." | null, "error": "..." | absent},
  "pending": [StatementLine without height],
  "totals": {"count": 1, "zat": 354262000, "usd_cents": 480000},
  "unlabelled": [{"date", "height", "txid", "direction": "in" | "out", "amount_zat",
                  "memo_text": "..." | null,
                  "reason": "no_memo" | "unknown_prefix" | "malformed" | "non_text" | "unexpected_direction"}],
  "funding": [{"date", "height", "txid", "amount_zat", "run_id"}]
}
```

A line is in the period when its block time (UTC) falls on or between `from` and `to`. Unmined payments are listed under `pending` and excluded from totals. A line is a payment the account made; a pay line memo arriving into the account was written by whoever sent it (anyone who knows the address can), so it is listed under `unlabelled` with reason `unexpected_direction` and never counted. `to_address` is the recipient in the ZIP 316 Revision 0 form (`utest1`/`u1`) that payment proofs show, or the venue's transparent deposit address for a converted line. `account.role` is `treasury` for a key that sent a run's allocation even when this deployment does not know it. Errors: `invalid_viewing_key`, `wrong_network`, `spending_key_rejected`, `invalid_period` (also for a year outside 2000 to 2100), `invalid_currency`, `invalid_birthday_height`, `scanner_busy`.

`market` on a line is the payment's value when it was mined: the CoinGecko ZEC price point nearest the block time (five-minute points for statements spanning a day, hourly up to 90 days, daily beyond) times the amount. Most tax authorities count this, not the payer's USD basis, as the contractor's income. A line with no price point near enough has `market: null`. If the price source cannot be reached the statement still returns, with `market.available: false` and an `error`. On testnet `market.note` says that testnet ZEC has no market value, and the figures show what the same amount of mainnet ZEC was worth.

On testnet the CSV exports leave the market value columns empty in every format (Koinly's Net Worth falls back to the USD basis), as the statement screens do: testnet ZEC has no market value.

`POST /api/statements/contractor.csv` takes the same body and returns `text/csv` with columns `date,block_time,height,txid,amount_zec,usd_basis,rate_usd_per_zec,run_id,period,invoice_ref,running_zec,running_usd,market_value_at_receipt,market_currency,market_price_per_zec`. Unlabelled lines follow under a `# unlabelled` section so nothing is dropped. `?format=koinly` returns Koinly's universal CSV (Net Worth is the market value at receipt, else the USD basis) and `?format=cointracker` CoinTracker's CSV; both list mined payments only. Any other format is 400 `invalid_format`.

### POST /api/statements/accountant

Body `{"ufvks": ["uviewtest1...", "..."], "from": "2026-09-01", "to": "2026-10-31", "birthday_height": 4466858}`. `birthday_height` is optional and works as for the contractor statement, for every key in the list.

```json
Reconciliation = {
  "network", "period", "scanned_from_height", "scanned_to_height", "generated_at",
  "accounts": [{"fingerprint", "account_index", "label", "role": "treasury" | "contractor" | "unknown",
                "scanned_from_height": 4466858}],
  "runs": [{"run_id": "uuid", "period": "2026-09", "funding_date": "2026-10-05",
            "funded_usd_cents": 2846215, "zec_acquired_zat": 2101000000,
            "rate_usd_per_zec_e6": 1354930000,
            "paid_usd_cents": 2845000, "paid_zat": 2099727000, "lines": 6, "pending_lines": 0,
            "allocations": 6, "allocated_zat": 2099787000,
            "missing_accounts": 0, "missing_zat": 0, "unpaid_accounts": 0,
            "network_fees_zat": 70000, "unspent_zat": 1203000,
            "variance_usd_cents": 1215, "explained_usd_cents": 1215,
            "difference_usd_cents": 0, "rounding_tolerance_cents": 7,
            "status": "reconciled" | "incomplete_keys" | "unpaid" | "variance_unexplained"
                      | "missing_funding_record" | "incomplete"}],
  "run_records": [...], "lines": [StatementLine plus {"account_index", "label"}],
  "pending": [...], "unlabelled": [...], "funding": [...],
  "totals": {"funded_usd_cents", "paid_usd_cents", "variance_usd_cents", "paid_zat", "count"},
  "run_index": {"<run id>": {"period_start", "period_end", "status"}},
  "treasury_key_present": true
}
```

Each run is reconciled over everything the keys have seen, not only the payments inside the statement period: a run funded at 23:58 on 30 September and paid after midnight is reconciled whole. A run is listed in the period in which its funding record was mined (with no record visible, its first mined output); a run still in progress is listed in every period. `lines`, `pending`, `unlabelled` and `funding` are the period's items. `totals` add up the listed runs.

The treasury key decrypts the allocation transaction, which pays one output to each contractor account in the run. `allocations` counts them and `allocated_zat` sums them; each should have one payment from the account it funded. Statuses, checked in this order:

| Status | Meaning |
| --- | --- |
| `missing_funding_record` | No run funding record (PS1R) is visible: the treasury key was not supplied. |
| `incomplete` | The allocation or a payment is not mined yet (`pending_lines`). |
| `incomplete_keys` | The treasury allocated to accounts whose keys were not supplied (`missing_accounts`, carrying `missing_zat`); their payments cannot be seen, so the run cannot be reconciled. |
| `unpaid` | An allocated account whose key was supplied shows no payment for the run (`unpaid_accounts`). |
| `variance_unexplained` | The variance differs from the explained amount by more than the rounding tolerance. |
| `reconciled` | Every allocation has its payment and the variance is explained to within the tolerance. |

`variance_usd_cents = funded_usd_cents - paid_usd_cents`. `explained_usd_cents` is the ZEC acquired but not paid out, valued at the run's fill rate. `difference_usd_cents` is variance minus explained. Each pay line's ZEC is rounded to the zatoshi, so the two can differ by up to one cent per line plus one; that allowance is `rounding_tolerance_cents`. The difference is always reported, so a one-cent rounding gap is visible rather than hidden. `unspent_zat` is what the treasury kept of the run's ZEC: acquired minus the allocation outputs and the allocation's fee, read from the treasury's own transaction (null without it), so a missing contractor key never turns into "unspent". `treasury_key_present` is true when a supplied key is the treasury's: a key this service knows as the treasury, or one that decrypted a run funding record (a statements-only service knows no key in advance; such a key is also returned with `role: "treasury"`).

`POST /api/statements/accountant.csv` returns the run reconciliation table (with `allocations`, `missing_accounts` and `unpaid_accounts` columns) followed by every line. `?format=xero` returns a Xero bank statement CSV (`Date,Amount,Payee,Description,Reference`, DD/MM/YYYY) and `?format=quickbooks` a QuickBooks three-column bank upload (`Date,Description,Amount`): each run's funding as money in and each pay line as money out, in USD at the basis written on chain.

### POST /api/statements/forget

Body `{"ufvks": ["uviewtest1...", "..."]}`: the same keys a statement used (in any order). Deletes the service's cached scan of exactly that key set and returns `200 {"forgotten": true}`, or `{"forgotten": false}` when there was none. A cache of a different set (one key of the list, say) is kept. The next statement for these keys scans from scratch. Errors: `invalid_viewing_key` (none, or more than 200), the key parsing errors above, `409 scan_in_progress` (a statement for the same keys is being scanned; retry when it finishes).

## Payment proofs

A payment proof discloses one payment, and nothing else, to someone who holds no key: a landlord, a bank, a visa office. It carries the transaction id, the output's position and that output's outgoing cipher key, which opens exactly that output. The verifier fetches the transaction from the chain and the note encryption library checks that the decrypted note matches the note commitment on chain, so a proof cannot be made for a payment that did not happen (ADR-021).

### POST /api/proofs

Body `{"ufvk": "uvftest1...", "txid": "3c5513c5..."}`: the contractor's viewing key and a payment from their statement.

```json
{"network": "testnet", "txid": "3c5513c5...", "height": 4465671, "mined": true,
 "proofs": [{"token": "pp1AQEBAAB...", "pool": "ironwood", "action_index": 0, "amount_zat": 355555,
             "recipient": "utest1...", "memo": {"kind": "pay_line", "run_id": "uuid", "period": "2026-09",
             "invoice_ref": "INV-2026-014", "usd_basis_cents": 480000, "rate_usd_per_zec_e6": 1350000000000,
             "asserted_by_sender": true}}]}
```

One proof per output the key's account sent to someone else in that transaction; change is left out. A proof can be made for a transaction that is not mined yet (`mined: false`); it verifies as valid once the transaction is mined. The viewing key is used for this request only and is not stored. Errors: `invalid_viewing_key`, `invalid_txid`, `tx_not_found` (404), `nothing_to_prove` (the key sent nothing in that transaction).

### GET /api/proofs/{token}

Public, needs no key. Optional `?address=utest1...`: a unified address the verifier expects the payment went to.

```json
{"valid": true, "mined": true, "network": "testnet", "txid": "3c5513c5...", "explorer_url": "https://...",
 "height": 4465671, "confirmations": 157, "block_time": "2026-10-04T23:23:40Z",
 "pool": "ironwood", "amount_zat": 355555, "recipient": "utest1...", "address_matches": true | false | null,
 "memo": {"kind": "pay_line", ...} | {"kind": "text", "text": "..."} | {"kind": "none"},
 "discloses": "This one payment: ...", "proves": "...", "does_not_prove": "..."}
```

`valid` is true when the proof opens a real output of the transaction (the decrypted note matches its commitment on chain) and the transaction is mined. A transaction still in the mempool can be dropped, so its proof answers `valid: false, mined: false` with `height` and `confirmations` null; ask again once it is mined. What a valid proof proves: a shielded payment of this amount to this receiver, with this memo, is in this transaction on chain at the height shown. What it does not prove: who sent it, or that it came from a Payslip payer. The memo's run, period, invoice and USD basis were written by the sender (`memo.asserted_by_sender: true`) and are not checked against any payroll record; anyone can send ZEC with such a memo. `proves` and `does_not_prove` say this in words for the verifier.

`recipient` is the Orchard receiver the note was paid to, as a Revision 0 unified address; `address_matches` compares it with the receivers of `address` (null when no address was given or it is not an address on this network), and `address_valid` is false when `address` could not be read. Errors: `invalid_proof` (400, not a proof), `wrong_network` (400), `tx_not_found` (404), `proof_mismatch` (422: the proof was altered or belongs to another transaction).
