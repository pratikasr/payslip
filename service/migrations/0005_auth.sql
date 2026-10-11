-- Sign-in, organisation, roles and the audit log (ADR-026). Identity (Google sign-in, sessions)
-- lives in the web app's auth.db; these tables say what a signed-in person may do here.
--
-- users:         one row per person the service has seen a valid token for. `id` is the token
--                subject (the web app's user id); `google_sub` is Google's stable account id when
--                the person signed in with Google. A person is matched by google_sub, then id,
--                then email, so a rebuilt auth.db keeps everyone's membership.
-- organisations: one per deployment today (one wallet seed, one company); the id column keeps
--                the door open to more.
-- memberships:   who belongs to the organisation and in which role.
-- invitations:   copy-paste invite links; only the SHA-256 of the token is stored.
-- audit_log:     who did what, as which role, to what, when. Every write under PAYSLIP_AUTH=required
--                adds a row; details is JSON.

CREATE TABLE users (
    id           TEXT PRIMARY KEY,
    email        TEXT NOT NULL,
    name         TEXT,
    picture_url  TEXT,
    google_sub   TEXT,
    created_at   TEXT NOT NULL,
    last_seen_at TEXT
);

CREATE UNIQUE INDEX users_email ON users (email);
CREATE UNIQUE INDEX users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE organisations (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    logo_url   TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE memberships (
    user_id    TEXT NOT NULL REFERENCES users (id),
    org_id     TEXT NOT NULL REFERENCES organisations (id),
    role       TEXT NOT NULL CHECK (role IN ('admin', 'approver', 'accountant', 'viewer')),
    created_at TEXT NOT NULL,
    PRIMARY KEY (org_id, user_id)
);

CREATE TABLE invitations (
    id          TEXT PRIMARY KEY,
    org_id      TEXT NOT NULL REFERENCES organisations (id),
    email       TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('admin', 'approver', 'accountant', 'viewer')),
    token_hash  TEXT NOT NULL UNIQUE,
    expires_at  TEXT NOT NULL,
    accepted_at TEXT,
    accepted_by TEXT REFERENCES users (id),
    revoked_at  TEXT,
    created_by  TEXT REFERENCES users (id),
    created_at  TEXT NOT NULL
);

CREATE INDEX invitations_org ON invitations (org_id, created_at);

CREATE TABLE audit_log (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id  TEXT REFERENCES organisations (id),
    user_id TEXT REFERENCES users (id),
    role    TEXT NOT NULL,
    action  TEXT NOT NULL,
    target  TEXT,
    at      TEXT NOT NULL,
    details TEXT
);

CREATE INDEX audit_log_org ON audit_log (org_id, id);
