//! Users, the organisation, memberships, invitations and the audit log in payslip.db
//! (migration 0005).

use serde::Serialize;
use sqlx::FromRow;
use uuid::Uuid;

use super::Claims;
use crate::db::{now, Pool};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Admin,
    Approver,
    Accountant,
    Viewer,
}

impl Role {
    pub fn parse(s: &str) -> Option<Role> {
        match s.trim().to_ascii_lowercase().as_str() {
            "admin" => Some(Role::Admin),
            "approver" => Some(Role::Approver),
            "accountant" => Some(Role::Accountant),
            "viewer" => Some(Role::Viewer),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Role::Admin => "admin",
            Role::Approver => "approver",
            Role::Accountant => "accountant",
            Role::Viewer => "viewer",
        }
    }

    pub const ALL: [Role; 4] = [Role::Admin, Role::Approver, Role::Accountant, Role::Viewer];
}

#[derive(Clone, Debug, FromRow)]
pub struct User {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub picture_url: Option<String>,
    pub google_sub: Option<String>,
    pub created_at: String,
    pub last_seen_at: Option<String>,
}

/// What the API shows of a user.
#[derive(Clone, Debug, Serialize)]
pub struct UserView {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub picture_url: Option<String>,
}

impl From<&User> for UserView {
    fn from(u: &User) -> Self {
        UserView {
            id: u.id.clone(),
            email: u.email.clone(),
            name: u.name.clone(),
            picture_url: u.picture_url.clone(),
        }
    }
}

#[derive(Clone, Debug, Serialize, FromRow)]
pub struct Organisation {
    pub id: String,
    pub name: String,
    pub logo_url: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug)]
pub struct Membership {
    pub org: Organisation,
    pub role: Role,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct MembershipView {
    pub role: Role,
    pub org: Organisation,
    pub since: String,
}

impl From<&Membership> for MembershipView {
    fn from(m: &Membership) -> Self {
        MembershipView {
            role: m.role,
            org: m.org.clone(),
            since: m.created_at.clone(),
        }
    }
}

#[derive(FromRow)]
struct MembershipRow {
    org_id: String,
    name: String,
    logo_url: Option<String>,
    org_created_at: String,
    role: String,
    created_at: String,
}

#[derive(Clone, Debug, Serialize, FromRow)]
pub struct MemberRow {
    pub user_id: String,
    pub email: String,
    pub name: Option<String>,
    pub picture_url: Option<String>,
    pub role: String,
    pub created_at: String,
}

#[derive(Clone, Debug, FromRow)]
pub struct Invitation {
    pub id: String,
    pub org_id: String,
    pub email: String,
    pub role: String,
    pub expires_at: String,
    pub accepted_at: Option<String>,
    pub accepted_by: Option<String>,
    pub revoked_at: Option<String>,
    pub created_by: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, FromRow)]
pub struct AuditEntry {
    pub id: i64,
    pub at: String,
    pub user_id: Option<String>,
    pub user_email: Option<String>,
    pub user_name: Option<String>,
    pub role: String,
    pub action: String,
    pub target: Option<String>,
    /// JSON, as stored.
    pub details: Option<String>,
}

// ---------------------------------------------------------------------------------------------
// Users

/// The user a token belongs to: matched by Google account id, then by the token's subject, then
/// by verified email (so a rebuilt auth.db, which gives everyone new ids, keeps their
/// membership).
async fn lookup_user(pool: &Pool, claims: &Claims, email: &str) -> anyhow::Result<Option<User>> {
    if let Some(gs) = claims.google_sub.as_deref() {
        let found: Option<User> = sqlx::query_as("SELECT * FROM users WHERE google_sub = ?")
            .bind(gs)
            .fetch_optional(pool)
            .await?;
        if found.is_some() {
            return Ok(found);
        }
    }
    let found: Option<User> = sqlx::query_as("SELECT * FROM users WHERE id = ?")
        .bind(&claims.sub)
        .fetch_optional(pool)
        .await?;
    if found.is_some() || !claims.email_verified {
        return Ok(found);
    }
    Ok(sqlx::query_as("SELECT * FROM users WHERE email = ?")
        .bind(email)
        .fetch_optional(pool)
        .await?)
}

/// The user a token belongs to (see [`lookup_user`]), created on first sight, with name, picture,
/// Google id and last-seen time refreshed from the token. A person's first sight is often several
/// requests at once (a page's parallel fetches), so the insert tolerates a row that got there
/// first and the lookup decides. None when the token's email is not verified and another account
/// holds it: that person must not take the account over.
pub async fn find_or_create_user(pool: &Pool, claims: &Claims, email: &str) -> anyhow::Result<Option<User>> {
    let ts = now();
    if let Some(u) = lookup_user(pool, claims, email).await? {
        // OR IGNORE: a verified email that moved to an address another row holds leaves the
        // stored one in place rather than failing the request.
        sqlx::query(
            "UPDATE OR IGNORE users SET email = ?, name = COALESCE(?, name), picture_url = COALESCE(?, picture_url),
                    google_sub = COALESCE(?, google_sub), last_seen_at = ? WHERE id = ?",
        )
        .bind(if claims.email_verified { email } else { u.email.as_str() })
        .bind(&claims.name)
        .bind(&claims.picture)
        .bind(&claims.google_sub)
        .bind(&ts)
        .bind(&u.id)
        .execute(pool)
        .await?;
        return user(pool, &u.id).await;
    }
    sqlx::query(
        "INSERT OR IGNORE INTO users (id, email, name, picture_url, google_sub, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&claims.sub)
    .bind(email)
    .bind(&claims.name)
    .bind(&claims.picture)
    .bind(&claims.google_sub)
    .bind(&ts)
    .bind(&ts)
    .execute(pool)
    .await?;
    lookup_user(pool, claims, email).await
}

pub async fn user(pool: &Pool, id: &str) -> anyhow::Result<Option<User>> {
    Ok(sqlx::query_as("SELECT * FROM users WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?)
}

// ---------------------------------------------------------------------------------------------
// Organisation and members

/// The deployment's organisation (one wallet seed, one company).
pub async fn organisation(pool: &Pool) -> anyhow::Result<Option<Organisation>> {
    Ok(
        sqlx::query_as("SELECT * FROM organisations ORDER BY created_at, id LIMIT 1")
            .fetch_optional(pool)
            .await?,
    )
}

/// The organisation, created with `name` if there is none yet. The insert checks for an
/// existing row itself, so requests arriving together still make one organisation.
pub async fn create_organisation_if_none(pool: &Pool, name: &str) -> anyhow::Result<Organisation> {
    sqlx::query(
        "INSERT INTO organisations (id, name, logo_url, created_at)
         SELECT ?, ?, NULL, ? WHERE NOT EXISTS (SELECT 1 FROM organisations)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(name)
    .bind(now())
    .execute(pool)
    .await?;
    organisation(pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("the organisation was not created"))
}

/// Makes `user_id` the organisation's admin if it has none yet, atomically; true when it did.
pub async fn insert_first_admin(pool: &Pool, org_id: &str, user_id: &str) -> anyhow::Result<bool> {
    let r = sqlx::query(
        "INSERT OR IGNORE INTO memberships (user_id, org_id, role, created_at)
         SELECT ?, ?, 'admin', ? WHERE NOT EXISTS (SELECT 1 FROM memberships WHERE org_id = ? AND role = 'admin')",
    )
    .bind(user_id)
    .bind(org_id)
    .bind(now())
    .bind(org_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() == 1)
}

/// Adds `user_id` to the organisation with `role` unless they are already a member, atomically;
/// true when it did. An existing membership keeps its role, whatever it is.
pub async fn insert_member_if_absent(pool: &Pool, org_id: &str, user_id: &str, role: Role) -> anyhow::Result<bool> {
    let r = sqlx::query("INSERT OR IGNORE INTO memberships (user_id, org_id, role, created_at) VALUES (?, ?, ?, ?)")
        .bind(user_id)
        .bind(org_id)
        .bind(role.as_str())
        .bind(now())
        .execute(pool)
        .await?;
    Ok(r.rows_affected() == 1)
}

pub async fn update_organisation(pool: &Pool, id: &str, name: &str, logo_url: Option<&str>) -> anyhow::Result<()> {
    sqlx::query("UPDATE organisations SET name = ?, logo_url = ? WHERE id = ?")
        .bind(name)
        .bind(logo_url)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn membership_of(pool: &Pool, user_id: &str) -> anyhow::Result<Option<Membership>> {
    let row: Option<MembershipRow> = sqlx::query_as(
        "SELECT o.id AS org_id, o.name, o.logo_url, o.created_at AS org_created_at, m.role, m.created_at
         FROM memberships m JOIN organisations o ON o.id = m.org_id
         WHERE m.user_id = ? ORDER BY o.created_at, o.id LIMIT 1",
    )
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.and_then(|r| {
        Some(Membership {
            org: Organisation {
                id: r.org_id,
                name: r.name,
                logo_url: r.logo_url,
                created_at: r.org_created_at,
            },
            role: Role::parse(&r.role)?,
            created_at: r.created_at,
        })
    }))
}

pub async fn members(pool: &Pool, org_id: &str) -> anyhow::Result<Vec<MemberRow>> {
    Ok(sqlx::query_as(
        "SELECT m.user_id, u.email, u.name, u.picture_url, m.role, m.created_at
         FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.org_id = ? ORDER BY m.created_at, u.email",
    )
    .bind(org_id)
    .fetch_all(pool)
    .await?)
}

pub async fn admin_count(pool: &Pool, org_id: &str) -> anyhow::Result<i64> {
    Ok(
        sqlx::query_scalar("SELECT COUNT(*) FROM memberships WHERE org_id = ? AND role = 'admin'")
            .bind(org_id)
            .fetch_one(pool)
            .await?,
    )
}

/// Changes a member's role. Returns false when the person is not a member.
pub async fn set_role(pool: &Pool, org_id: &str, user_id: &str, role: Role) -> anyhow::Result<bool> {
    let r = sqlx::query("UPDATE memberships SET role = ? WHERE org_id = ? AND user_id = ?")
        .bind(role.as_str())
        .bind(org_id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() == 1)
}

pub async fn remove_member(pool: &Pool, org_id: &str, user_id: &str) -> anyhow::Result<bool> {
    let r = sqlx::query("DELETE FROM memberships WHERE org_id = ? AND user_id = ?")
        .bind(org_id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(r.rows_affected() == 1)
}

pub async fn member_role(pool: &Pool, org_id: &str, user_id: &str) -> anyhow::Result<Option<Role>> {
    let role: Option<String> = sqlx::query_scalar("SELECT role FROM memberships WHERE org_id = ? AND user_id = ?")
        .bind(org_id)
        .bind(user_id)
        .fetch_optional(pool)
        .await?;
    Ok(role.and_then(|r| Role::parse(&r)))
}

pub async fn is_member_by_email(pool: &Pool, org_id: &str, email: &str) -> anyhow::Result<bool> {
    let n: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ? AND u.email = ?",
    )
    .bind(org_id)
    .bind(email)
    .fetch_one(pool)
    .await?;
    Ok(n > 0)
}

// ---------------------------------------------------------------------------------------------
// Invitations

/// Creates an invitation and revokes any earlier open one for the same email, so one link per
/// person is live at a time. Only the hash of the token is stored.
pub async fn create_invitation(
    pool: &Pool,
    org_id: &str,
    email: &str,
    role: Role,
    token_hash: &str,
    expires_at: &str,
    created_by: &str,
) -> anyhow::Result<Invitation> {
    let ts = now();
    let id = Uuid::new_v4().to_string();
    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE invitations SET revoked_at = ? WHERE org_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL",
    )
    .bind(&ts)
    .bind(org_id)
    .bind(email)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO invitations (id, org_id, email, role, token_hash, expires_at, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(org_id)
    .bind(email)
    .bind(role.as_str())
    .bind(token_hash)
    .bind(expires_at)
    .bind(created_by)
    .bind(&ts)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(invitation(pool, &id).await?.expect("just inserted"))
}

pub async fn invitation(pool: &Pool, id: &str) -> anyhow::Result<Option<Invitation>> {
    Ok(sqlx::query_as("SELECT * FROM invitations WHERE id = ?")
        .bind(id)
        .fetch_optional(pool)
        .await?)
}

pub async fn invitation_by_hash(pool: &Pool, token_hash: &str) -> anyhow::Result<Option<Invitation>> {
    Ok(sqlx::query_as("SELECT * FROM invitations WHERE token_hash = ?")
        .bind(token_hash)
        .fetch_optional(pool)
        .await?)
}

/// Every invitation that was not revoked, newest first.
pub async fn invitations(pool: &Pool, org_id: &str) -> anyhow::Result<Vec<Invitation>> {
    Ok(
        sqlx::query_as(
            "SELECT * FROM invitations WHERE org_id = ? AND revoked_at IS NULL ORDER BY created_at DESC, id",
        )
        .bind(org_id)
        .fetch_all(pool)
        .await?,
    )
}

/// Marks an invitation accepted and adds the membership, atomically; false if it was already
/// accepted or revoked meanwhile.
pub async fn accept_invitation(pool: &Pool, inv: &Invitation, user_id: &str, role: Role) -> anyhow::Result<bool> {
    let ts = now();
    let mut tx = pool.begin().await?;
    let r = sqlx::query(
        "UPDATE invitations SET accepted_at = ?, accepted_by = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL",
    )
    .bind(&ts)
    .bind(user_id)
    .bind(&inv.id)
    .execute(&mut *tx)
    .await?;
    if r.rows_affected() != 1 {
        tx.rollback().await?;
        return Ok(false);
    }
    sqlx::query("INSERT INTO memberships (user_id, org_id, role, created_at) VALUES (?, ?, ?, ?)")
        .bind(user_id)
        .bind(&inv.org_id)
        .bind(role.as_str())
        .bind(&ts)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(true)
}

pub async fn revoke_invitation(pool: &Pool, org_id: &str, id: &str) -> anyhow::Result<bool> {
    let r = sqlx::query(
        "UPDATE invitations SET revoked_at = ? WHERE id = ? AND org_id = ? AND revoked_at IS NULL AND accepted_at IS NULL",
    )
    .bind(now())
    .bind(id)
    .bind(org_id)
    .execute(pool)
    .await?;
    Ok(r.rows_affected() == 1)
}

// ---------------------------------------------------------------------------------------------
// Audit log

pub async fn audit(
    pool: &Pool,
    org_id: &str,
    user_id: Option<&str>,
    role: &str,
    action: &str,
    target: Option<&str>,
    details: Option<serde_json::Value>,
) -> anyhow::Result<()> {
    sqlx::query(
        "INSERT INTO audit_log (org_id, user_id, role, action, target, at, details) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(if org_id.is_empty() { None } else { Some(org_id) })
    .bind(user_id)
    .bind(role)
    .bind(action)
    .bind(target)
    .bind(now())
    .bind(details.map(|d| d.to_string()))
    .execute(pool)
    .await?;
    Ok(())
}

/// Audit rows of the organisation, newest first, `limit` at a time, from before `before` (an id).
pub async fn audit_entries(
    pool: &Pool,
    org_id: &str,
    limit: i64,
    before: Option<i64>,
) -> anyhow::Result<Vec<AuditEntry>> {
    Ok(sqlx::query_as(
        "SELECT a.id, a.at, a.user_id, u.email AS user_email, u.name AS user_name, a.role, a.action, a.target, a.details
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         WHERE a.org_id = ? AND (? IS NULL OR a.id < ?)
         ORDER BY a.id DESC LIMIT ?",
    )
    .bind(org_id)
    .bind(before)
    .bind(before)
    .bind(limit)
    .fetch_all(pool)
    .await?)
}
