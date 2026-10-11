-- Recorded approvals (launch plan increment 2, extends ADR-026): a run is approved by named
-- members before money moves.
--
-- run_approvals:   one row per member per run: who approved it, as which role, when. The service
--                  refuses to execute a run (and to record its swap) until it holds
--                  PAYSLIP_APPROVALS_REQUIRED rows.
-- runs.created_by: the signed-in user who created the run; NULL with sign-in off. When two or
--                  more approvals are required the creator cannot be one of the approvers.

CREATE TABLE run_approvals (
    run_id  TEXT NOT NULL REFERENCES runs (id),
    user_id TEXT NOT NULL REFERENCES users (id),
    role    TEXT NOT NULL CHECK (role IN ('admin', 'approver')),
    at      TEXT NOT NULL,
    PRIMARY KEY (run_id, user_id)
);

ALTER TABLE runs ADD COLUMN created_by TEXT REFERENCES users (id);
