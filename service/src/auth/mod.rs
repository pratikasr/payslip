//! Sign-in and roles (ADR-026). The web app signs people in (Google through Better Auth) and
//! mints short EdDSA tokens; this module checks a token against the web app's published keys,
//! maps it to a user and a membership, decides what the role may do on the route, and writes
//! the audit row for every write. Nothing here runs when `PAYSLIP_AUTH=off`.

pub mod store;

use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};

use axum::{
    body::Body,
    extract::{MatchedPath, Request, State},
    http::{header, Method, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
};
use jsonwebtoken::{jwk::JwkSet, Algorithm, DecodingKey, Validation};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{Mutex, RwLock};

use crate::{
    api::AppStateRef,
    config::AuthConfig,
    db::Pool,
    error::{ApiError, ApiResult},
};

pub use store::{Membership, Organisation, Role, User};

// ---------------------------------------------------------------------------------------------
// Tokens

/// What the web app puts in a token (web/src/lib/auth.ts `definePayload`), besides the
/// registered claims that `jsonwebtoken` validates (`iss`, `aud`, `exp`).
#[derive(Clone, Debug, Deserialize)]
pub struct Claims {
    /// The web app's user id.
    pub sub: String,
    #[serde(default)]
    pub email: Option<String>,
    #[serde(default)]
    pub email_verified: bool,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub picture: Option<String>,
    /// Google's stable account id, when the person signed in with Google.
    #[serde(default)]
    pub google_sub: Option<String>,
    /// The web app's session id.
    #[serde(default)]
    pub sid: Option<String>,
    pub exp: u64,
}

/// Checks tokens against the keys at `PAYSLIP_AUTH_JWKS_URL`. Keys are cached; an unknown key
/// id fetches them again, at most once every [`REFRESH_INTERVAL`], so a rotated key is picked up
/// and a flood of bad tokens cannot hammer the web app.
pub struct Verifier {
    cfg: AuthConfig,
    http: reqwest::Client,
    keys: RwLock<HashMap<String, Arc<DecodingKey>>>,
    last_fetch: Mutex<Option<Instant>>,
    validation: Validation,
}

const REFRESH_INTERVAL: Duration = Duration::from_secs(60);
/// Clock difference tolerated between the web app and the service.
const LEEWAY_SECONDS: u64 = 30;

/// Why a token was refused; every variant answers 401 `unauthenticated` with a plain hint.
#[derive(Debug, PartialEq, Eq)]
pub enum Refusal {
    Missing,
    Malformed,
    Expired,
    BadSignature,
    UnknownKey,
    WrongAudience,
    WrongIssuer,
    NoEmail,
}

impl Refusal {
    pub fn into_error(self) -> ApiError {
        let (message, hint) = match self {
            Refusal::Missing => (
                "This request needs a signed-in member.",
                "Sign in to the Payslip web app; it sends the token with every request.",
            ),
            Refusal::Malformed => (
                "The token could not be read.",
                "Sign in again; the web app mints a fresh token.",
            ),
            Refusal::Expired => (
                "The token has expired.",
                "Sign in again; tokens last a few minutes and the web app renews them.",
            ),
            Refusal::BadSignature => (
                "The token's signature does not match the web app's keys.",
                "Check that PAYSLIP_AUTH_JWKS_URL points at the web app that signed people in.",
            ),
            Refusal::UnknownKey => (
                "The token was signed with a key this service does not know.",
                "Check PAYSLIP_AUTH_JWKS_URL; the keys are fetched again on every unknown key id.",
            ),
            Refusal::WrongAudience => (
                "The token was minted for another service.",
                "Set PAYSLIP_AUTH_AUDIENCE to the audience the web app signs for (payslip-service).",
            ),
            Refusal::WrongIssuer => (
                "The token was minted by another web app.",
                "Set PAYSLIP_AUTH_ISSUER to the web app's BETTER_AUTH_URL.",
            ),
            Refusal::NoEmail => (
                "The token carries no email address.",
                "Sign in with an account that has an email address.",
            ),
        };
        ApiError::new(StatusCode::UNAUTHORIZED, "unauthenticated", message, hint)
    }
}

/// The keys could not be fetched: a deployment problem, not the caller's.
fn keys_unavailable(err: &str) -> ApiError {
    ApiError::unavailable(
        "auth_unavailable",
        format!("The service cannot read the web app's signing keys: {err}."),
        "Check that the web app is running and PAYSLIP_AUTH_JWKS_URL points at its /api/auth/jwks.",
    )
}

impl Verifier {
    pub fn new(cfg: &AuthConfig) -> Self {
        let mut validation = Validation::new(Algorithm::EdDSA);
        validation.leeway = LEEWAY_SECONDS;
        validation.set_required_spec_claims(&["exp", "sub", "iss", "aud"]);
        validation.set_issuer(&[cfg.issuer.as_str()]);
        validation.set_audience(&[cfg.audience.as_str()]);
        Verifier {
            cfg: cfg.clone(),
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .build()
                .expect("reqwest client"),
            keys: RwLock::new(HashMap::new()),
            last_fetch: Mutex::new(None),
            validation,
        }
    }

    /// Fetches the key set and replaces the cache. Returns how many usable keys it holds.
    async fn refresh(&self) -> anyhow::Result<usize> {
        let set: JwkSet = self
            .http
            .get(&self.cfg.jwks_url)
            .send()
            .await?
            .error_for_status()?
            .json()
            .await?;
        let mut keys = HashMap::new();
        for jwk in &set.keys {
            if let (Some(kid), Ok(key)) = (jwk.common.key_id.clone(), DecodingKey::from_jwk(jwk)) {
                keys.insert(kid, Arc::new(key));
            }
        }
        let n = keys.len();
        *self.keys.write().await = keys;
        *self.last_fetch.lock().await = Some(Instant::now());
        Ok(n)
    }

    /// The key for `kid`, fetching the set when it is unknown and the last fetch is old enough.
    async fn key(&self, kid: &str) -> Result<Option<Arc<DecodingKey>>, ApiError> {
        if let Some(k) = self.keys.read().await.get(kid) {
            return Ok(Some(k.clone()));
        }
        let due = {
            let last = self.last_fetch.lock().await;
            last.is_none_or(|t| t.elapsed() >= REFRESH_INTERVAL)
        };
        if due {
            self.refresh().await.map_err(|e| keys_unavailable(&format!("{e:#}")))?;
        }
        Ok(self.keys.read().await.get(kid).cloned())
    }

    /// Checks the signature, issuer, audience and expiry, and returns the claims.
    pub async fn verify(&self, token: &str) -> Result<Claims, ApiError> {
        let header = jsonwebtoken::decode_header(token).map_err(|_| Refusal::Malformed.into_error())?;
        if header.alg != Algorithm::EdDSA {
            return Err(Refusal::BadSignature.into_error());
        }
        let kid = header.kid.ok_or_else(|| Refusal::UnknownKey.into_error())?;
        let key = self.key(&kid).await?.ok_or_else(|| Refusal::UnknownKey.into_error())?;
        let data = jsonwebtoken::decode::<Claims>(token, &key, &self.validation).map_err(|e| {
            use jsonwebtoken::errors::ErrorKind::*;
            match e.kind() {
                ExpiredSignature => Refusal::Expired,
                InvalidSignature | InvalidAlgorithm | InvalidEddsaKey | InvalidKeyFormat => Refusal::BadSignature,
                InvalidAudience | MissingRequiredClaim(_) if e.to_string().contains("aud") => Refusal::WrongAudience,
                InvalidAudience => Refusal::WrongAudience,
                InvalidIssuer => Refusal::WrongIssuer,
                _ => Refusal::Malformed,
            }
            .into_error()
        })?;
        Ok(data.claims)
    }
}

/// The bearer token of a request, if any.
fn bearer(req: &Request) -> Option<String> {
    req.headers()
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
}

// ---------------------------------------------------------------------------------------------
// Permissions

/// What a route needs. Roles map to sets of these; the table in [`rule`] maps routes to one.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Permission {
    /// A signed-in person, member or not: `GET /api/me`, accepting an invitation.
    SignedIn,
    /// Read contractors, runs, the wallet balance and the organisation.
    Read,
    /// Read viewing keys (a key cannot be revoked once seen).
    ViewKeys,
    /// Add, edit and archive contractors; mark keys as shared.
    ManageContractors,
    /// Create, fund, execute, cancel and discard runs.
    ManageRuns,
    /// Sync the wallet on demand.
    SyncWallet,
    /// Organisation name and logo, members, roles, invitations.
    ManageOrg,
    /// Read the audit log.
    ViewAudit,
}

impl Role {
    pub fn allows(self, p: Permission) -> bool {
        use Permission::*;
        match self {
            Role::Admin => true,
            Role::Approver => matches!(p, SignedIn | Read | ManageRuns),
            Role::Accountant => matches!(p, SignedIn | Read | ViewKeys | ViewAudit),
            Role::Viewer => matches!(p, SignedIn | Read),
        }
    }

    /// What the role may do, in the words the web app shows.
    pub fn describe(self) -> &'static str {
        match self {
            Role::Admin => "everything: people, payroll, keys, members and settings",
            Role::Approver => "run payroll (create, fund, execute and cancel runs), set the pay schedule, decide payment requests, and read everything else",
            Role::Accountant => "read everything, export viewing keys and the books, and read the audit log",
            Role::Viewer => "read people, runs and the treasury",
        }
    }
}

/// How a route is guarded and, for a write, what its audit row says.
#[derive(Clone, Copy, Debug)]
pub struct Rule {
    pub permission: Permission,
    /// The audit action, for routes that are audited (every write, plus key exports).
    pub action: Option<&'static str>,
}

const fn read() -> Rule {
    Rule {
        permission: Permission::Read,
        action: None,
    }
}

const fn write(permission: Permission, action: &'static str) -> Rule {
    Rule {
        permission,
        action: Some(action),
    }
}

/// The rule for a route, by method and the matched path template. Anything not listed is read
/// for any member when it is a GET, and admin-only otherwise, so a new route is never open by
/// accident.
pub fn rule(method: &Method, template: &str) -> Rule {
    use Permission::*;
    match (method.as_str(), template) {
        ("GET", "/api/me") => Rule {
            permission: SignedIn,
            action: None,
        },
        ("POST", "/api/org/invitations/{token}/accept") => write(SignedIn, "invitation.accept"),
        ("POST", "/api/wallet/sync") => write(SyncWallet, "wallet.sync"),
        ("POST", "/api/contractors") => write(ManageContractors, "contractor.create"),
        ("PATCH", "/api/contractors/{id}") => write(ManageContractors, "contractor.update"),
        ("DELETE", "/api/contractors/{id}") => write(ManageContractors, "contractor.archive"),
        ("GET", "/api/contractors/{id}/viewing-key") => write(ViewKeys, "contractor.key_view"),
        ("POST", "/api/contractors/{id}/viewing-key/shared") => write(ManageContractors, "contractor.key_shared"),
        ("DELETE", "/api/contractors/{id}/viewing-key/shared") => write(ManageContractors, "contractor.key_unshared"),
        ("GET", "/api/viewing-keys") => write(ViewKeys, "keys.export"),
        ("POST", "/api/runs") => write(ManageRuns, "run.create"),
        ("DELETE", "/api/runs/{id}") => write(ManageRuns, "run.discard"),
        ("POST", "/api/runs/{id}/fund") => write(ManageRuns, "run.fund"),
        ("POST", "/api/runs/{id}/funding/deposit-tx") => write(ManageRuns, "run.deposit_tx"),
        ("POST", "/api/runs/{id}/execute") => write(ManageRuns, "run.execute"),
        ("POST", "/api/runs/{id}/cancel") => write(ManageRuns, "run.cancel"),
        // The pay schedule and the request queue (ADR-028): read by any member; set, approve and
        // reject by those who run payroll.
        ("PUT", "/api/schedule") => write(ManageRuns, "schedule.update"),
        ("POST", "/api/requests/{id}/approve") => write(ManageRuns, "request.approve"),
        ("POST", "/api/requests/{id}/reject") => write(ManageRuns, "request.reject"),
        ("PATCH", "/api/org") => write(ManageOrg, "org.update"),
        ("POST", "/api/org/members") => write(ManageOrg, "member.role"),
        ("DELETE", "/api/org/members/{user_id}") => write(ManageOrg, "member.remove"),
        ("GET", "/api/org/invitations") => Rule {
            permission: ManageOrg,
            action: None,
        },
        ("POST", "/api/org/invitations") => write(ManageOrg, "invitation.create"),
        ("DELETE", "/api/org/invitations/{id}") => write(ManageOrg, "invitation.revoke"),
        ("GET", "/api/org/audit") => Rule {
            permission: ViewAudit,
            action: None,
        },
        ("GET", _) => read(),
        _ => write(ManageOrg, "unlisted.write"),
    }
}

// ---------------------------------------------------------------------------------------------
// The guard

/// Who is making the request, for handlers (`Extension<Identity>`).
#[derive(Clone, Debug)]
pub struct Identity {
    pub user: User,
    pub membership: Option<Membership>,
    pub sid: Option<String>,
}

impl Identity {
    /// The membership, or 403 for a signed-in person who is not a member.
    pub fn member(&self) -> ApiResult<&Membership> {
        self.membership.as_ref().ok_or_else(|| not_a_member(&self.user.email))
    }
}

/// What a handler wants the audit row to say, beyond what the route tells: the target (an id,
/// never a secret) and details (JSON). Put it in the response extensions.
#[derive(Clone, Debug, Default)]
pub struct AuditInfo {
    pub target: Option<String>,
    pub details: Option<Value>,
}

fn not_a_member(email: &str) -> ApiError {
    ApiError::new(
        StatusCode::FORBIDDEN,
        "forbidden",
        format!("{email} is signed in but is not a member of this organisation."),
        "Ask an admin for an invitation link, then open it while signed in with this email.",
    )
}

fn role_forbids(role: Role, permission: Permission) -> ApiError {
    let what = match permission {
        Permission::ViewKeys => "see viewing keys",
        Permission::ManageContractors => "add, edit or archive people",
        Permission::ManageRuns => "run payroll",
        Permission::SyncWallet => "sync the wallet",
        Permission::ManageOrg => "change the organisation, its members or invitations",
        Permission::ViewAudit => "read the audit log",
        Permission::Read | Permission::SignedIn => "do this",
    };
    ApiError::new(
        StatusCode::FORBIDDEN,
        "forbidden",
        format!("Your role ({}) cannot {what}.", role.as_str()),
        format!(
            "An admin can change your role under Members. A {} may {}.",
            role.as_str(),
            role.describe()
        ),
    )
}

/// The first path parameter's value: the id a write is about, when the handler sets none.
fn path_param(template: &str, path: &str) -> Option<String> {
    template
        .split('/')
        .zip(path.split('/'))
        .find(|(t, _)| t.starts_with('{'))
        .map(|(_, v)| v.to_string())
}

/// The middleware on every guarded route: token, user, bootstrap, role, then the audit row.
pub async fn guard(State(s): State<AppStateRef>, mut req: Request, next: Next) -> Response {
    match guard_inner(&s, &mut req).await {
        Ok(ctx) => {
            let AuditContext {
                identity,
                rule,
                template,
                path,
            } = ctx;
            req.extensions_mut().insert(identity.clone());
            let method = req.method().clone();
            let res = next.run(req).await;
            match rule.action {
                Some(action) if res.status().is_success() => {
                    record(&s.db, &identity, action, &method, &template, &path, res).await
                }
                _ => res,
            }
        }
        Err(e) => e.into_response(),
    }
}

struct AuditContext {
    identity: Identity,
    rule: Rule,
    template: String,
    path: String,
}

async fn guard_inner(s: &AppStateRef, req: &mut Request) -> ApiResult<AuditContext> {
    let verifier = s
        .auth
        .as_ref()
        .ok_or_else(|| ApiError::internal("the auth guard is mounted but PAYSLIP_AUTH is off; this is a bug"))?;
    let token = bearer(req).ok_or_else(|| Refusal::Missing.into_error())?;
    let claims = verifier.verify(&token).await?;
    let email = claims
        .email
        .as_deref()
        .map(|e| e.trim().to_ascii_lowercase())
        .filter(|e| e.contains('@'))
        .ok_or_else(|| Refusal::NoEmail.into_error())?;
    let user = store::find_or_create_user(&s.db, &claims, &email)
        .await?
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::FORBIDDEN,
                "forbidden",
                format!("{email} belongs to another account, and this sign-in has not verified it."),
                "Sign in with the account that owns the email, or verify the email with the sign-in provider.",
            )
        })?;
    let mut membership = store::membership_of(&s.db, &user.id).await?;
    if membership.is_none() {
        membership = bootstrap(&s.db, &s.cfg.auth, &user, &claims).await?;
    }
    let template = req
        .extensions()
        .get::<MatchedPath>()
        .map(|m| m.as_str().to_string())
        .unwrap_or_else(|| req.uri().path().to_string());
    let rule = rule(req.method(), &template);
    if rule.permission != Permission::SignedIn {
        let m = membership.as_ref().ok_or_else(|| not_a_member(&user.email))?;
        if !m.role.allows(rule.permission) {
            return Err(role_forbids(m.role, rule.permission));
        }
    }
    Ok(AuditContext {
        identity: Identity {
            user,
            membership,
            sid: claims.sid.clone(),
        },
        rule,
        template,
        path: req.uri().path().to_string(),
    })
}

/// The first sign-in with the bootstrap email, while the organisation has no admin, creates
/// the organisation (named after the email's domain until an admin renames it) and makes that
/// person its admin. Every later membership comes from an invitation. The first sign-in's
/// requests arrive together, so both inserts check the database themselves and only the one
/// that made the admin writes the audit row.
async fn bootstrap(pool: &Pool, cfg: &AuthConfig, user: &User, claims: &Claims) -> ApiResult<Option<Membership>> {
    let Some(wanted) = cfg.bootstrap_admin_email.as_deref() else {
        return Ok(None);
    };
    if user.email != wanted || !claims.email_verified {
        return Ok(None);
    }
    let domain = user.email.rsplit('@').next().unwrap_or("payslip").to_string();
    let org = store::create_organisation_if_none(pool, &domain).await?;
    if store::insert_first_admin(pool, &org.id, &user.id).await? {
        store::audit(
            pool,
            &org.id,
            Some(&user.id),
            Role::Admin.as_str(),
            "org.bootstrap",
            Some(&org.id),
            Some(serde_json::json!({ "email": user.email, "name": org.name })),
        )
        .await?;
    }
    Ok(store::membership_of(pool, &user.id).await?)
}

/// Writes the audit row for a successful audited request. The target is what the handler
/// said, else the route's id parameter, else the `id` of the JSON the handler answered with
/// (a create); the body is read for that and sent on unchanged.
async fn record(
    pool: &Pool,
    identity: &Identity,
    action: &str,
    method: &Method,
    template: &str,
    path: &str,
    res: Response,
) -> Response {
    let info = res.extensions().get::<AuditInfo>().cloned().unwrap_or_default();
    let (mut target, details) = (info.target, info.details);
    if target.is_none() {
        target = path_param(template, path);
    }
    let mut res = res;
    if target.is_none() && method != Method::GET {
        let (parts, body) = res.into_parts();
        let bytes = axum::body::to_bytes(body, 4 * 1024 * 1024).await.unwrap_or_default();
        if let Ok(v) = serde_json::from_slice::<Value>(&bytes) {
            target = v.get("id").and_then(|i| i.as_str()).map(|i| i.to_string());
        }
        res = Response::from_parts(parts, Body::from(bytes));
    }
    let (org_id, role) = match &identity.membership {
        Some(m) => (Some(m.org.id.as_str()), m.role.as_str()),
        None => (None, "none"),
    };
    let org_id = match (
        org_id,
        details.as_ref().and_then(|d| d.get("org_id")).and_then(|v| v.as_str()),
    ) {
        (Some(id), _) => Some(id.to_string()),
        (None, Some(id)) => Some(id.to_string()),
        (None, None) => None,
    };
    let role = details
        .as_ref()
        .and_then(|d| d.get("role"))
        .and_then(|v| v.as_str())
        .filter(|_| identity.membership.is_none())
        .map(|r| r.to_string())
        .unwrap_or_else(|| role.to_string());
    if let Err(e) = store::audit(
        pool,
        org_id.as_deref().unwrap_or(""),
        Some(&identity.user.id),
        &role,
        action,
        target.as_deref(),
        details,
    )
    .await
    {
        tracing::error!("audit row for {action} was not written: {e:#}");
    }
    res
}

/// What `GET /api/me` answers.
#[derive(Serialize)]
pub struct Me {
    pub auth: &'static str,
    pub user: store::UserView,
    pub membership: Option<store::MembershipView>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roles_follow_the_matrix() {
        use Permission::*;
        for p in [
            SignedIn,
            Read,
            ViewKeys,
            ManageContractors,
            ManageRuns,
            SyncWallet,
            ManageOrg,
            ViewAudit,
        ] {
            assert!(Role::Admin.allows(p));
        }
        assert!(Role::Approver.allows(ManageRuns));
        assert!(!Role::Approver.allows(ManageContractors));
        assert!(!Role::Approver.allows(ViewKeys));
        assert!(Role::Accountant.allows(ViewKeys));
        assert!(Role::Accountant.allows(ViewAudit));
        assert!(!Role::Accountant.allows(ManageRuns));
        assert!(Role::Viewer.allows(Read));
        assert!(!Role::Viewer.allows(ViewKeys));
        assert!(!Role::Viewer.allows(ManageOrg));
    }

    #[test]
    fn every_payer_write_is_audited_and_reads_are_open_to_members() {
        let r = rule(&Method::POST, "/api/runs/{id}/execute");
        assert_eq!((r.permission, r.action), (Permission::ManageRuns, Some("run.execute")));
        let r = rule(&Method::GET, "/api/runs/{id}/events");
        assert_eq!((r.permission, r.action), (Permission::Read, None));
        let r = rule(&Method::GET, "/api/viewing-keys");
        assert_eq!((r.permission, r.action), (Permission::ViewKeys, Some("keys.export")));
        // A route nobody listed is admin-only when it writes.
        let r = rule(&Method::PUT, "/api/something/new");
        assert_eq!(r.permission, Permission::ManageOrg);
        assert!(r.action.is_some());
    }

    #[test]
    fn the_audit_target_is_the_routes_id_parameter() {
        assert_eq!(
            path_param("/api/runs/{id}/fund", "/api/runs/abc-123/fund").as_deref(),
            Some("abc-123")
        );
        assert_eq!(path_param("/api/runs", "/api/runs"), None);
    }
}
