-- Pay schedule and payment requests (docs/superpowers/specs/2026-10-11-launch-plan-design.md,
-- "Pay schedule" and "Payment requests"; ADR-028). Everything here is off chain.
--
-- `org_id` is nullable on both tables: organisations arrive with sign-in (0005_auth.sql), and
-- until then one deployment is one organisation, so there is one schedule and every request
-- belongs to it. Nothing here references the auth tables.

-- A contractor's usual pay, so a scheduled draft can be prefilled without a request.
ALTER TABLE contractors ADD COLUMN default_amount_usd_cents INTEGER
    CHECK (default_amount_usd_cents IS NULL OR default_amount_usd_cents > 0);

-- The fingerprint of the account's unified full viewing key (viewer.rs, the same 16 hex
-- characters statements use), so a viewing key sent to the portal maps to its contractor with
-- one lookup. Contractors created before this migration have NULL until the service fills it in
-- from the payer wallet the first time a key is looked up.
ALTER TABLE contractors ADD COLUMN key_fingerprint TEXT;

CREATE INDEX contractors_key_fingerprint ON contractors (key_fingerprint);

CREATE TABLE pay_schedules (
    id                  TEXT PRIMARY KEY,
    org_id              TEXT,
    cadence             TEXT NOT NULL CHECK (cadence IN ('weekly', 'biweekly', 'monthly')),
    -- weekly and biweekly: the weekday the period ends on and is paid (monday .. sunday);
    -- monthly: the day of the month the period is paid, '1' .. '28' or 'last'.
    pay_day             TEXT NOT NULL,
    draft_days_before   INTEGER NOT NULL DEFAULT 5 CHECK (draft_days_before BETWEEN 0 AND 28),
    next_period_start   TEXT NOT NULL,
    next_period_end     TEXT NOT NULL,
    active              INTEGER NOT NULL DEFAULT 1,
    -- The run the scheduler drafted last (or found covering the period), and its pay day: the
    -- console's "drafted, review by" line, and `overdue` once that pay day has passed unpaid.
    -- Not a foreign key: a discarded draft is deleted, and the schedule then simply has none.
    last_run_id         TEXT,
    last_pay_day        TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE TABLE payment_requests (
    id                  TEXT PRIMARY KEY,
    org_id              TEXT,
    contractor_id       TEXT NOT NULL REFERENCES contractors (id),
    amount_usd_cents    INTEGER NOT NULL CHECK (amount_usd_cents > 0),
    period_start        TEXT NOT NULL,
    period_end          TEXT NOT NULL,
    invoice_ref         TEXT NOT NULL,
    due_date            TEXT,
    note                TEXT,
    status              TEXT NOT NULL CHECK (status IN ('submitted', 'approved', 'rejected', 'paid')),
    -- Set when an approved request is taken into a run: the run and the line that pays it.
    run_id              TEXT REFERENCES runs (id),
    line_id             TEXT REFERENCES pay_lines (id),
    -- A recurring request creates its successor for the next period when it is paid.
    recurring           TEXT CHECK (recurring IS NULL OR recurring IN ('weekly', 'biweekly', 'monthly')),
    -- The payer's note on approval or rejection, shown to the contractor.
    decision_note       TEXT,
    created_at          TEXT NOT NULL,
    decided_at          TEXT,
    decided_by          TEXT
);

CREATE INDEX payment_requests_contractor ON payment_requests (contractor_id, created_at);
CREATE INDEX payment_requests_status ON payment_requests (status, created_at);
CREATE INDEX payment_requests_run ON payment_requests (run_id);
