-- Treasury key control (ADR-030): the company's key, created, unlocked and replaced through
-- the API when PAYSLIP_SEED_PASSPHRASE is not set.
--
-- treasury_keys:            one row per treasury seed this deployment has held: the version the
--                           API reports as `key_version`, when it was created, when it was retired
--                           (NULL for the current one) and its treasury address (NULL until the
--                           wallet derived it). The seed itself is never here: it is the age file.
-- contractors.key_rotated_at: set on every contractor when the key is replaced, because each
--                           account is derived from the seed and so gets a new viewing key; the
--                           web shows "share the new viewing key" until it is marked shared again.

CREATE TABLE treasury_keys (
    version    INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL,
    retired_at TEXT,
    address    TEXT
);

ALTER TABLE contractors ADD COLUMN key_rotated_at TEXT;
