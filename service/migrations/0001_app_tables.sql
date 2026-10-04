-- Payslip app tables (SPEC.md data model). Wallet state lives separately in wallet.db.
-- Amounts: *_zat in zatoshis, *_usd_cents in US cents, *_rate_e6 in USD per ZEC times 1e6.

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE contractors (
    id                      TEXT PRIMARY KEY,
    name                    TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    email                   TEXT,
    unified_address         TEXT NOT NULL,
    zip32_account_index     INTEGER NOT NULL UNIQUE CHECK (zip32_account_index >= 1),
    account_birthday_height INTEGER NOT NULL,
    settlement_choice       TEXT NOT NULL CHECK (settlement_choice IN ('hold_zec', 'convert_usdc')),
    payout_chain            TEXT,
    payout_address          TEXT,
    fvk_shared_at           TEXT,
    created_at              TEXT NOT NULL,
    archived_at             TEXT
);

CREATE UNIQUE INDEX contractors_active_address ON contractors (unified_address) WHERE archived_at IS NULL;

CREATE TABLE runs (
    id                  TEXT PRIMARY KEY,
    idempotency_key     TEXT UNIQUE,
    period_start        TEXT NOT NULL,
    period_end          TEXT NOT NULL,
    funding_asset       TEXT NOT NULL DEFAULT 'USDC',
    funding_amount      INTEGER,            -- funded USD in cents, set when the venue fills
    zec_acquired        INTEGER,            -- zatoshis that arrived in the treasury for this run
    zec_usd_rate        INTEGER,            -- fill rate, USD per ZEC times 1e6
    status              TEXT NOT NULL CHECK (status IN ('draft', 'awaiting_funds', 'funded', 'swapping', 'swapped',
                                                        'allocating', 'paying', 'paid', 'failed')),
    failed_from         TEXT,               -- the status the run was in when it failed, for resume
    venue               TEXT,
    venue_state         TEXT,               -- JSON: quote, deposit address, venue status
    allocation_txid     TEXT,
    allocation_height   INTEGER,
    fees_zat            INTEGER NOT NULL DEFAULT 0,
    error_code          TEXT,
    error_message       TEXT,
    error_hint          TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE TABLE pay_lines (
    id                  TEXT PRIMARY KEY,
    run_id              TEXT NOT NULL REFERENCES runs (id),
    contractor_id       TEXT NOT NULL REFERENCES contractors (id),
    position            INTEGER NOT NULL,
    invoice_ref         TEXT NOT NULL,
    amount_usd_basis    INTEGER NOT NULL CHECK (amount_usd_basis > 0),   -- cents
    amount_zec          INTEGER,                                          -- zatoshis, set at swap fill
    fee_zat             INTEGER,
    memo                TEXT,
    memo_hash           TEXT,
    status              TEXT NOT NULL CHECK (status IN ('pending', 'allocated', 'broadcast', 'confirmed', 'failed')),
    txid                TEXT,
    expiry_height       INTEGER,
    confirmed_height    INTEGER,
    attempts            INTEGER NOT NULL DEFAULT 0,
    error_code          TEXT,
    error_message       TEXT,
    error_hint          TEXT,
    UNIQUE (run_id, contractor_id)
);

CREATE INDEX pay_lines_run ON pay_lines (run_id);

CREATE TABLE statements (
    id                  TEXT PRIMARY KEY,
    scope               TEXT NOT NULL CHECK (scope IN ('contractor', 'accountant')),
    contractor_id       TEXT REFERENCES contractors (id),   -- set for a contractor statement whose key is known
    subject             TEXT NOT NULL,                        -- key fingerprint(s)
    period_start        TEXT NOT NULL,
    period_end          TEXT NOT NULL,
    scanned_to_height   INTEGER NOT NULL,
    generated_at        TEXT NOT NULL,
    csv_hash            TEXT
);

CREATE TABLE run_events (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id  TEXT NOT NULL REFERENCES runs (id),
    at      TEXT NOT NULL,
    message TEXT NOT NULL
);

CREATE INDEX run_events_run ON run_events (run_id, id);
