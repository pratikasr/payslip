//! API errors: every error names the fix (`hint`).

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ErrorBody {
    pub code: String,
    pub message: String,
    pub hint: String,
}

#[derive(Clone, Debug)]
pub struct ApiError {
    pub status: StatusCode,
    pub body: ErrorBody,
}

impl ApiError {
    pub fn new(status: StatusCode, code: &str, message: impl Into<String>, hint: impl Into<String>) -> Self {
        ApiError {
            status,
            body: ErrorBody {
                code: code.into(),
                message: message.into(),
                hint: hint.into(),
            },
        }
    }

    pub fn bad_request(code: &str, message: impl Into<String>, hint: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, code, message, hint)
    }

    pub fn not_found(what: &str) -> Self {
        Self::new(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("{what} was not found"),
            "Check the id; list endpoints return every valid id.",
        )
    }

    pub fn conflict(code: &str, message: impl Into<String>, hint: impl Into<String>) -> Self {
        Self::new(StatusCode::CONFLICT, code, message, hint)
    }

    pub fn internal(err: impl std::fmt::Display) -> Self {
        let message = err.to_string();
        let (code, hint) = classify_internal(&message);
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, code, message, hint)
    }

    pub fn unavailable(code: &str, message: impl Into<String>, hint: impl Into<String>) -> Self {
        Self::new(StatusCode::SERVICE_UNAVAILABLE, code, message, hint)
    }
}

/// Maps low-level failures to a code and an actionable hint.
fn classify_internal(message: &str) -> (&'static str, &'static str) {
    let m = message.to_ascii_lowercase();
    if m.contains("database or disk is full") || m.contains("no space left") || m.contains("disk full") {
        ("disk_full", "The service's data disk is full. Free space on the volume holding PAYSLIP_DATA_DIR, then retry; run state is preserved.")
    } else if m.contains("transport error")
        || m.contains("connection refused")
        || m.contains("dns error")
        || m.contains("timed out")
        || m.contains("getlatestblock")
    {
        (
            "lightwalletd_unreachable",
            "The service cannot reach lightwalletd. Check LIGHTWALLETD_URL and network access, then retry.",
        )
    } else if m.contains("database is locked") {
        (
            "database_busy",
            "Another operation holds the database. Retry in a few seconds.",
        )
    } else {
        (
            "internal_error",
            "Check the service log for details, then retry. Runs resume from their last saved step.",
        )
    }
}

impl From<anyhow::Error> for ApiError {
    fn from(e: anyhow::Error) -> Self {
        ApiError::internal(format!("{e:#}"))
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(e: sqlx::Error) -> Self {
        ApiError::internal(e)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        if self.status.is_server_error() {
            tracing::error!(code = %self.body.code, "{}", self.body.message);
        }
        (self.status, Json(serde_json::json!({ "error": self.body }))).into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;
