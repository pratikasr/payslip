//! The signed-in person, the organisation, its members, invitations and audit log (ADR-026).
//! Mounted only when `PAYSLIP_AUTH=required`; every route runs behind [`crate::auth::guard`].

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Extension, Json, Router,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::Rng as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use time::{format_description::well_known::Rfc3339, Duration, OffsetDateTime};

use super::AppStateRef;
use crate::{
    auth::{
        store::{self, Invitation, MembershipView, Role, UserView},
        AuditInfo, Identity, Me,
    },
    error::{ApiError, ApiResult},
};

pub fn routes() -> Router<AppStateRef> {
    Router::new()
        .route("/api/me", get(me))
        .route("/api/org", get(org).patch(update_org))
        .route("/api/org/members", get(members).post(set_role))
        .route("/api/org/members/{user_id}", axum::routing::delete(remove_member))
        .route("/api/org/invitations", get(invitations).post(invite))
        .route("/api/org/invitations/{id}", axum::routing::delete(revoke))
        .route("/api/org/invitations/{token}/accept", post(accept))
        .route("/api/org/audit", get(audit))
}

/// How long an invitation link works.
const INVITATION_DAYS: i64 = 7;

async fn me(Extension(id): Extension<Identity>) -> Json<Me> {
    Json(Me {
        auth: "required",
        user: UserView::from(&id.user),
        membership: id.membership.as_ref().map(MembershipView::from),
    })
}

async fn org(Extension(id): Extension<Identity>) -> ApiResult<Json<store::Organisation>> {
    Ok(Json(id.member()?.org.clone()))
}

#[derive(Deserialize)]
struct OrgInput {
    name: Option<String>,
    /// A URL, or null to remove the logo.
    #[serde(default, deserialize_with = "deserialize_some")]
    logo_url: Option<Option<String>>,
}

/// Tells "field absent" (None) from "field null" (Some(None)).
fn deserialize_some<'de, D>(d: D) -> Result<Option<Option<String>>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Option::<String>::deserialize(d).map(Some)
}

async fn update_org(
    State(s): State<AppStateRef>,
    Extension(id): Extension<Identity>,
    Json(input): Json<OrgInput>,
) -> ApiResult<Response> {
    let org = &id.member()?.org;
    let name = match input.name {
        Some(n) => {
            let n = n.trim().to_string();
            if n.is_empty() || n.chars().count() > 120 {
                return Err(ApiError::bad_request(
                    "invalid_name",
                    "The organisation name must be 1 to 120 characters.",
                    "Enter the company name as it should appear in the console and on payslips.",
                ));
            }
            n
        }
        None => org.name.clone(),
    };
    let logo_url = match input.logo_url {
        None => org.logo_url.clone(),
        Some(None) => None,
        Some(Some(url)) => {
            let url = url.trim().to_string();
            if url.is_empty() {
                None
            } else {
                if !(url.starts_with("https://") || url.starts_with("http://")) || url.len() > 2048 {
                    return Err(ApiError::bad_request(
                        "invalid_logo_url",
                        "The logo must be an http or https URL of at most 2,048 characters.",
                        "Host the image somewhere the web app can load it and paste its address, or leave it empty.",
                    ));
                }
                Some(url)
            }
        }
    };
    store::update_organisation(&s.db, &org.id, &name, logo_url.as_deref()).await?;
    let updated = store::Organisation {
        name,
        logo_url,
        ..org.clone()
    };
    let mut res = Json(&updated).into_response();
    res.extensions_mut().insert(AuditInfo {
        target: Some(org.id.clone()),
        details: Some(json!({ "name": updated.name, "logo_url": updated.logo_url })),
    });
    Ok(res)
}

async fn members(State(s): State<AppStateRef>, Extension(id): Extension<Identity>) -> ApiResult<Json<Value>> {
    let org = &id.member()?.org;
    Ok(Json(json!({ "members": store::members(&s.db, &org.id).await? })))
}

#[derive(Deserialize)]
struct RoleInput {
    user_id: String,
    role: String,
}

fn parse_role(s: &str) -> ApiResult<Role> {
    Role::parse(s).ok_or_else(|| {
        ApiError::bad_request(
            "invalid_role",
            format!("{s:?} is not a role."),
            "Use admin, approver, accountant or viewer.",
        )
    })
}

fn last_admin() -> ApiError {
    ApiError::conflict(
        "last_admin",
        "This is the organisation's only admin.",
        "Make someone else an admin first.",
    )
}

/// Changes a member's role.
async fn set_role(
    State(s): State<AppStateRef>,
    Extension(id): Extension<Identity>,
    Json(input): Json<RoleInput>,
) -> ApiResult<Response> {
    let org = &id.member()?.org;
    let role = parse_role(&input.role)?;
    let current = store::member_role(&s.db, &org.id, &input.user_id)
        .await?
        .ok_or_else(|| ApiError::not_found("That member"))?;
    if current == Role::Admin && role != Role::Admin && store::admin_count(&s.db, &org.id).await? <= 1 {
        return Err(last_admin());
    }
    store::set_role(&s.db, &org.id, &input.user_id, role).await?;
    let member = store::members(&s.db, &org.id)
        .await?
        .into_iter()
        .find(|m| m.user_id == input.user_id)
        .ok_or_else(|| ApiError::not_found("That member"))?;
    let mut res = Json(&member).into_response();
    res.extensions_mut().insert(AuditInfo {
        target: Some(input.user_id.clone()),
        details: Some(json!({ "email": member.email, "from": current.as_str(), "to": role.as_str() })),
    });
    Ok(res)
}

async fn remove_member(
    State(s): State<AppStateRef>,
    Extension(id): Extension<Identity>,
    Path(user_id): Path<String>,
) -> ApiResult<Response> {
    let org = &id.member()?.org;
    let current = store::member_role(&s.db, &org.id, &user_id)
        .await?
        .ok_or_else(|| ApiError::not_found("That member"))?;
    if current == Role::Admin && store::admin_count(&s.db, &org.id).await? <= 1 {
        return Err(last_admin());
    }
    let email = store::user(&s.db, &user_id).await?.map(|u| u.email);
    store::remove_member(&s.db, &org.id, &user_id).await?;
    let mut res = StatusCode::NO_CONTENT.into_response();
    res.extensions_mut().insert(AuditInfo {
        target: Some(user_id),
        details: Some(json!({ "email": email, "role": current.as_str() })),
    });
    Ok(res)
}

#[derive(Serialize)]
struct InvitationView {
    id: String,
    email: String,
    role: String,
    status: &'static str,
    expires_at: String,
    accepted_at: Option<String>,
    created_at: String,
    /// The invite token, only in the answer to the request that created it.
    #[serde(skip_serializing_if = "Option::is_none")]
    token: Option<String>,
}

fn invitation_view(inv: &Invitation, token: Option<String>) -> InvitationView {
    let status = if inv.accepted_at.is_some() {
        "accepted"
    } else if inv.revoked_at.is_some() {
        "revoked"
    } else if expired(&inv.expires_at) {
        "expired"
    } else {
        "pending"
    };
    InvitationView {
        id: inv.id.clone(),
        email: inv.email.clone(),
        role: inv.role.clone(),
        status,
        expires_at: inv.expires_at.clone(),
        accepted_at: inv.accepted_at.clone(),
        created_at: inv.created_at.clone(),
        token,
    }
}

fn expired(expires_at: &str) -> bool {
    OffsetDateTime::parse(expires_at, &Rfc3339)
        .map(|t| t <= OffsetDateTime::now_utc())
        .unwrap_or(true)
}

async fn invitations(State(s): State<AppStateRef>, Extension(id): Extension<Identity>) -> ApiResult<Json<Value>> {
    let org = &id.member()?.org;
    let list: Vec<InvitationView> = store::invitations(&s.db, &org.id)
        .await?
        .iter()
        .map(|i| invitation_view(i, None))
        .collect();
    Ok(Json(json!({ "invitations": list })))
}

#[derive(Deserialize)]
struct InviteInput {
    email: String,
    role: String,
}

/// SHA-256 of a token, hex: what the database keeps.
pub fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

async fn invite(
    State(s): State<AppStateRef>,
    Extension(id): Extension<Identity>,
    Json(input): Json<InviteInput>,
) -> ApiResult<(StatusCode, Response)> {
    let org = &id.member()?.org;
    let email = input.email.trim().to_ascii_lowercase();
    if !email.contains('@') || email.len() > 254 || email.contains(char::is_whitespace) {
        return Err(ApiError::bad_request(
            "invalid_email",
            "That email address is not valid.",
            "Use the form name@example.com; the person must sign in with exactly this address.",
        ));
    }
    let role = parse_role(&input.role)?;
    if store::is_member_by_email(&s.db, &org.id, &email).await? {
        return Err(ApiError::conflict(
            "already_a_member",
            format!("{email} is already a member."),
            "Change their role under Members instead.",
        ));
    }
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    let token = URL_SAFE_NO_PAD.encode(bytes);
    let expires_at = (OffsetDateTime::now_utc() + Duration::days(INVITATION_DAYS))
        .replace_nanosecond(0)
        .unwrap_or_else(|_| OffsetDateTime::now_utc())
        .format(&Rfc3339)
        .map_err(|e| ApiError::internal(e.to_string()))?;
    let inv = store::create_invitation(
        &s.db,
        &org.id,
        &email,
        role,
        &token_hash(&token),
        &expires_at,
        &id.user.id,
    )
    .await?;
    let mut res = Json(invitation_view(&inv, Some(token))).into_response();
    res.extensions_mut().insert(AuditInfo {
        target: Some(inv.id.clone()),
        details: Some(json!({ "email": email, "role": role.as_str(), "expires_at": expires_at })),
    });
    Ok((StatusCode::CREATED, res))
}

async fn revoke(
    State(s): State<AppStateRef>,
    Extension(id): Extension<Identity>,
    Path(inv_id): Path<String>,
) -> ApiResult<Response> {
    let org = &id.member()?.org;
    let inv = store::invitation(&s.db, &inv_id)
        .await?
        .filter(|i| i.org_id == org.id)
        .ok_or_else(|| ApiError::not_found("That invitation"))?;
    if !store::revoke_invitation(&s.db, &org.id, &inv_id).await? {
        return Err(ApiError::conflict(
            "invitation_closed",
            "This invitation was already accepted or revoked.",
            "Remove the member under Members if they should no longer have access.",
        ));
    }
    let mut res = StatusCode::NO_CONTENT.into_response();
    res.extensions_mut().insert(AuditInfo {
        target: Some(inv_id),
        details: Some(json!({ "email": inv.email, "role": inv.role })),
    });
    Ok(res)
}

/// Accepting needs a signed-in person whose verified email is the invited one. The audit row
/// names the invitation, never the token.
async fn accept(
    State(s): State<AppStateRef>,
    Extension(id): Extension<Identity>,
    Path(token): Path<String>,
) -> ApiResult<Response> {
    let inv = store::invitation_by_hash(&s.db, &token_hash(token.trim()))
        .await?
        .filter(|i| i.revoked_at.is_none())
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "not_found",
                "This invitation link is not valid.",
                "Ask an admin for a new link; a link that was revoked or replaced no longer opens.",
            )
        })?;
    if inv.accepted_at.is_some() {
        return Err(ApiError::conflict(
            "invitation_used",
            "This invitation has already been accepted.",
            "If it was you, open the console; otherwise ask an admin for a new link.",
        ));
    }
    if expired(&inv.expires_at) {
        return Err(ApiError::conflict(
            "invitation_expired",
            format!("This invitation expired on {}.", &inv.expires_at[..10]),
            "Ask an admin for a new link.",
        ));
    }
    if id.user.email != inv.email {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "forbidden",
            format!(
                "This invitation is for {}, but you are signed in as {}.",
                inv.email, id.user.email
            ),
            "Sign out and sign in with the invited address, or ask an admin to invite this one.",
        ));
    }
    if id.membership.is_some() {
        return Err(ApiError::conflict(
            "already_a_member",
            "You are already a member of this organisation.",
            "Ask an admin to change your role under Members instead.",
        ));
    }
    let role = Role::parse(&inv.role).ok_or_else(|| ApiError::internal("invitation role"))?;
    if !store::accept_invitation(&s.db, &inv, &id.user.id, role).await? {
        return Err(ApiError::conflict(
            "invitation_used",
            "This invitation was just used or revoked.",
            "Reload the console; if you are not a member, ask an admin for a new link.",
        ));
    }
    let membership = store::membership_of(&s.db, &id.user.id)
        .await?
        .ok_or_else(|| ApiError::internal("membership after accept"))?;
    let mut res = Json(json!({ "membership": MembershipView::from(&membership) })).into_response();
    res.extensions_mut().insert(AuditInfo {
        target: Some(inv.id.clone()),
        details: Some(json!({ "email": inv.email, "role": inv.role, "org_id": inv.org_id })),
    });
    Ok(res)
}

#[derive(Deserialize)]
struct AuditQuery {
    limit: Option<i64>,
    before: Option<i64>,
}

async fn audit(
    State(s): State<AppStateRef>,
    Extension(id): Extension<Identity>,
    Query(q): Query<AuditQuery>,
) -> ApiResult<Json<Value>> {
    let org = &id.member()?.org;
    let limit = q.limit.unwrap_or(100).clamp(1, 500);
    let entries: Vec<Value> = store::audit_entries(&s.db, &org.id, limit, q.before)
        .await?
        .into_iter()
        .map(|e| {
            json!({
                "id": e.id,
                "at": e.at,
                "user": e.user_id.as_ref().map(|uid| json!({ "id": uid, "email": e.user_email, "name": e.user_name })),
                "role": e.role,
                "action": e.action,
                "target": e.target,
                "details": e.details.as_deref().and_then(|d| serde_json::from_str::<Value>(d).ok()),
            })
        })
        .collect();
    Ok(Json(json!({ "entries": entries })))
}
