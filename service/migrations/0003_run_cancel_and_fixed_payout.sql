-- no-transaction
-- Audit fixes (ADR-024):
-- 1. Runs gain the `cancelled` status (a run that never received money can be closed) and an
--    `execute_requested` flag, so a restart resumes only runs the payer actually executed.
--    SQLite cannot alter a CHECK constraint, so `runs` is rebuilt (sqlite.org/lang_altertable.html,
--    "Making Other Kinds Of Table Schema Changes"). Foreign keys must be off while the table is
--    swapped, which cannot be done inside a transaction, hence `no-transaction` above and the
--    explicit BEGIN/COMMIT below.
-- 2. Pay lines keep the contractor's payout details as they were when the run was funded, so an
--    edit during a run cannot change where or how a line is paid.

PRAGMA foreign_keys = OFF;

BEGIN;

CREATE TABLE runs_new (
    id                  TEXT PRIMARY KEY,
    idempotency_key     TEXT UNIQUE,
    period_start        TEXT NOT NULL,
    period_end          TEXT NOT NULL,
    funding_asset       TEXT NOT NULL DEFAULT 'USDC',
    funding_amount      INTEGER,
    zec_acquired        INTEGER,
    zec_usd_rate        INTEGER,
    status              TEXT NOT NULL CHECK (status IN ('draft', 'awaiting_funds', 'funded', 'swapping', 'swapped',
                                                        'allocating', 'paying', 'paid', 'failed', 'cancelled')),
    failed_from         TEXT,
    venue               TEXT,
    venue_state         TEXT,
    allocation_txid     TEXT,
    allocation_height   INTEGER,
    fees_zat            INTEGER NOT NULL DEFAULT 0,
    error_code          TEXT,
    error_message       TEXT,
    error_hint          TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    execute_requested   INTEGER NOT NULL DEFAULT 0   -- 1 once the payer executed the run
);

INSERT INTO runs_new (id, idempotency_key, period_start, period_end, funding_asset, funding_amount, zec_acquired,
                      zec_usd_rate, status, failed_from, venue, venue_state, allocation_txid, allocation_height,
                      fees_zat, error_code, error_message, error_hint, created_at, updated_at, execute_requested)
SELECT id, idempotency_key, period_start, period_end, funding_asset, funding_amount, zec_acquired,
       zec_usd_rate, status, failed_from, venue, venue_state, allocation_txid, allocation_height,
       fees_zat, error_code, error_message, error_hint, created_at, updated_at,
       CASE WHEN status IN ('swapping', 'swapped', 'allocating', 'paying') THEN 1 ELSE 0 END
FROM runs;

DROP TABLE runs;

ALTER TABLE runs_new RENAME TO runs;

ALTER TABLE pay_lines ADD COLUMN fixed_unified_address TEXT;
ALTER TABLE pay_lines ADD COLUMN fixed_settlement_choice TEXT;
ALTER TABLE pay_lines ADD COLUMN fixed_payout_chain TEXT;
ALTER TABLE pay_lines ADD COLUMN fixed_payout_address TEXT;

-- Lines of runs already past draft keep the details they were paid (or are being paid) with.
UPDATE pay_lines
SET fixed_unified_address   = (SELECT c.unified_address FROM contractors c WHERE c.id = pay_lines.contractor_id),
    fixed_settlement_choice = (SELECT c.settlement_choice FROM contractors c WHERE c.id = pay_lines.contractor_id),
    fixed_payout_chain      = (SELECT c.payout_chain FROM contractors c WHERE c.id = pay_lines.contractor_id),
    fixed_payout_address    = (SELECT c.payout_address FROM contractors c WHERE c.id = pay_lines.contractor_id)
WHERE run_id IN (SELECT id FROM runs WHERE status <> 'draft');

COMMIT;

PRAGMA foreign_keys = ON;
