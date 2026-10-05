-- Follow-ups for the web (docs/API.md):
-- 1. A pay line keeps the block time of its confirmed height (`confirmed_at`, RFC 3339 UTC), set
--    together with `confirmed_height` and cleared with it on a reorg. Lines confirmed before this
--    migration stay NULL until the service fills them in from the payer wallet's block records
--    or lightwalletd (at start-up, and when their run is read).
-- 2. A run created with an idempotency key keeps a SHA-256 of its canonical create request
--    (period and lines), so the same key sent with a different body is refused. Runs created
--    before this migration have none and keep the old behaviour: the key returns the run.

ALTER TABLE pay_lines ADD COLUMN confirmed_at TEXT;

ALTER TABLE runs ADD COLUMN idempotency_hash TEXT;
