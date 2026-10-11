//! Payment requests (ADR-028): a contractor asks to be paid for a period; the payer approves or
//! rejects; an approved request becomes a pay line in the next run for its period (scheduled or
//! made by hand); when that line confirms the request is paid, and a recurring one creates its
//! successor for the following period. All off chain; nothing here touches a key.

use std::collections::HashMap;

use serde_json::{json, Value};
use sqlx::FromRow;
use time::{Date, Duration};
use uuid::Uuid;

use crate::{
    config::ZcashNetwork,
    db::{self, NewLine, Pool},
    memo,
    runs::parse_date,
    schedule::{following_period, iso, Cadence, PayDay},
};

pub const STATUSES: [&str; 4] = ["submitted", "approved", "rejected", "paid"];

/// A note (from the contractor, or the payer's decision) is at most this long.
pub const MAX_NOTE_CHARS: usize = 1000;

#[derive(Clone, Debug, FromRow)]
pub struct RequestRow {
    pub id: String,
    pub org_id: Option<String>,
    pub contractor_id: String,
    pub amount_usd_cents: i64,
    pub period_start: String,
    pub period_end: String,
    pub invoice_ref: String,
    pub due_date: Option<String>,
    pub note: Option<String>,
    pub status: String,
    pub run_id: Option<String>,
    pub line_id: Option<String>,
    pub recurring: Option<String>,
    pub decision_note: Option<String>,
    pub created_at: String,
    pub decided_at: Option<String>,
    pub decided_by: Option<String>,
    // joined
    pub contractor_name: String,
    pub contractor_archived: bool,
    pub txid: Option<String>,
    pub confirmed_at: Option<String>,
}

const SELECT: &str = "SELECT r.*, c.name AS contractor_name, c.archived_at IS NOT NULL AS contractor_archived,
                             l.txid AS txid, l.confirmed_at AS confirmed_at
                      FROM payment_requests r
                      JOIN contractors c ON c.id = r.contractor_id
                      LEFT JOIN pay_lines l ON l.id = r.line_id";

#[derive(Clone, Debug)]
pub struct NewRequest {
    pub contractor_id: String,
    pub amount_usd_cents: u64,
    pub period_start: String,
    pub period_end: String,
    pub invoice_ref: String,
    pub due_date: Option<String>,
    pub note: Option<String>,
    pub recurring: Option<Cadence>,
}

pub async fn insert(pool: &Pool, r: &NewRequest) -> anyhow::Result<RequestRow> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO payment_requests (id, contractor_id, amount_usd_cents, period_start, period_end, invoice_ref,
                                       due_date, note, status, recurring, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?)",
    )
    .bind(&id)
    .bind(&r.contractor_id)
    .bind(r.amount_usd_cents as i64)
    .bind(&r.period_start)
    .bind(&r.period_end)
    .bind(&r.invoice_ref)
    .bind(&r.due_date)
    .bind(&r.note)
    .bind(r.recurring.map(|c| c.as_str()))
    .bind(db::now())
    .execute(pool)
    .await?;
    get(pool, &id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("the request was not stored"))
}

pub async fn get(pool: &Pool, id: &str) -> anyhow::Result<Option<RequestRow>> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!("{SELECT} WHERE r.id = ?")))
        .bind(id)
        .fetch_optional(pool)
        .await?)
}

/// Every request, newest first; `status` narrows the list.
pub async fn list(pool: &Pool, status: Option<&str>) -> anyhow::Result<Vec<RequestRow>> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{SELECT} WHERE (? IS NULL OR r.status = ?) ORDER BY r.created_at DESC, r.rowid DESC"
    )))
    .bind(status)
    .bind(status)
    .fetch_all(pool)
    .await?)
}

/// One contractor's requests, newest first.
pub async fn list_for_contractor(pool: &Pool, contractor_id: &str) -> anyhow::Result<Vec<RequestRow>> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{SELECT} WHERE r.contractor_id = ? ORDER BY r.created_at DESC, r.rowid DESC"
    )))
    .bind(contractor_id)
    .fetch_all(pool)
    .await?)
}

pub async fn count_by_status(pool: &Pool, status: &str) -> anyhow::Result<i64> {
    Ok(
        sqlx::query_scalar("SELECT COUNT(*) FROM payment_requests WHERE status = ?")
            .bind(status)
            .fetch_one(pool)
            .await?,
    )
}

/// Records the payer's decision (`approved` or `rejected`) on a request in `from`. Returns false
/// if the request was not in one of those statuses.
pub async fn decide(pool: &Pool, id: &str, from: &[&str], to: &str, note: Option<&str>) -> anyhow::Result<bool> {
    let placeholders = from.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "UPDATE payment_requests SET status = ?, decision_note = ?, decided_at = ?, decided_by = NULL
         WHERE id = ? AND status IN ({placeholders})"
    );
    // Only "?" placeholders are interpolated; every value is bound.
    let mut q = sqlx::query(sqlx::AssertSqlSafe(sql))
        .bind(to)
        .bind(note)
        .bind(db::now())
        .bind(id);
    for f in from {
        q = q.bind(*f);
    }
    Ok(q.execute(pool).await?.rows_affected() == 1)
}

/// Approved requests not yet in a run whose period shares a day with `start..=end`, from active
/// contractors, oldest first.
pub async fn approved_for_period(pool: &Pool, start: &str, end: &str) -> anyhow::Result<Vec<RequestRow>> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{SELECT} WHERE r.status = 'approved' AND r.run_id IS NULL AND c.archived_at IS NULL
                    AND r.period_start <= ? AND r.period_end >= ?
         ORDER BY r.created_at, r.rowid"
    )))
    .bind(end)
    .bind(start)
    .fetch_all(pool)
    .await?)
}

/// The requests with these ids, in the order given; ids that do not exist are left out.
pub async fn by_ids(pool: &Pool, ids: &[String]) -> anyhow::Result<Vec<RequestRow>> {
    let mut out = vec![];
    for id in ids {
        if let Some(r) = get(pool, id).await? {
            out.push(r);
        }
    }
    Ok(out)
}

/// A line of a run and the requests it pays.
#[derive(Clone, Debug)]
pub struct DraftLine {
    pub line: NewLine,
    pub request_ids: Vec<String>,
}

/// An invoice reference for a line that pays several requests: the references joined, or the
/// first and how many more when they do not fit the memo.
fn joined_invoice_ref(refs: &[&str]) -> String {
    let joined = refs.join(", ");
    if joined.len() <= memo::MAX_INVOICE_REF_LEN {
        return joined;
    }
    let more = format!(" +{}", refs.len() - 1);
    let room = memo::MAX_INVOICE_REF_LEN.saturating_sub(more.len());
    let first: String = refs[0].chars().take(room).collect();
    format!("{first}{more}")
}

/// Attaches approved requests to the lines of a run being created: a request joins its
/// contractor's line when the body has one (the payer saw that line and may have edited it), and
/// otherwise adds a line for the request's amount and invoice reference. Several requests from
/// one contractor make one line (one line per contractor per run).
pub fn merge_lines(given: Vec<NewLine>, requests: &[RequestRow]) -> Vec<DraftLine> {
    let mut lines: Vec<DraftLine> = given
        .into_iter()
        .map(|line| DraftLine {
            line,
            request_ids: vec![],
        })
        .collect();
    let mut added: HashMap<String, usize> = HashMap::new();
    for r in requests {
        if let Some(existing) = lines.iter_mut().find(|l| l.line.contractor_id == r.contractor_id) {
            existing.request_ids.push(r.id.clone());
            if let Some(&i) = added.get(&r.contractor_id) {
                // A line this merge added: it pays every request of the contractor.
                let l = &mut lines[i];
                l.line.amount_usd_cents += r.amount_usd_cents as u64;
                let refs: Vec<&str> = requests
                    .iter()
                    .filter(|x| l.request_ids.contains(&x.id))
                    .map(|x| x.invoice_ref.as_str())
                    .collect();
                l.line.invoice_ref = joined_invoice_ref(&refs);
            }
            continue;
        }
        added.insert(r.contractor_id.clone(), lines.len());
        lines.push(DraftLine {
            line: NewLine {
                contractor_id: r.contractor_id.clone(),
                amount_usd_cents: r.amount_usd_cents as u64,
                invoice_ref: r.invoice_ref.clone(),
            },
            request_ids: vec![r.id.clone()],
        });
    }
    lines
}

/// The lines of a scheduled draft for `start..=end`: every active contractor with an approved
/// request for the period (the request's amount and reference) or, failing that, a default
/// amount (with the period as the reference).
pub async fn draft_lines(pool: &Pool, start: &str, end: &str) -> anyhow::Result<Vec<DraftLine>> {
    let requests = approved_for_period(pool, start, end).await?;
    let mut lines = merge_lines(vec![], &requests);
    for c in db::list_contractors(pool).await? {
        if lines.iter().any(|l| l.line.contractor_id == c.id) {
            continue;
        }
        if let Some(cents) = c.default_amount_usd_cents.filter(|v| *v > 0) {
            lines.push(DraftLine {
                line: NewLine {
                    contractor_id: c.id.clone(),
                    amount_usd_cents: cents as u64,
                    invoice_ref: format!("{start} to {end}"),
                },
                request_ids: vec![],
            });
        }
    }
    Ok(lines)
}

/// Records which run and line each request of `lines` is paid by, once the run exists.
pub async fn link(pool: &Pool, run_id: &str, lines: &[DraftLine]) -> anyhow::Result<()> {
    for l in lines.iter().filter(|l| !l.request_ids.is_empty()) {
        let line_id: Option<String> =
            sqlx::query_scalar("SELECT id FROM pay_lines WHERE run_id = ? AND contractor_id = ?")
                .bind(run_id)
                .bind(&l.line.contractor_id)
                .fetch_optional(pool)
                .await?;
        for id in &l.request_ids {
            sqlx::query(
                "UPDATE payment_requests SET run_id = ?, line_id = ? WHERE id = ? AND status = 'approved' AND run_id IS NULL",
            )
            .bind(run_id)
            .bind(&line_id)
            .bind(id)
            .execute(pool)
            .await?;
        }
    }
    Ok(())
}

/// The period a recurring request repeats for: the calendar month after a monthly one, the next
/// seven or fourteen days after a weekly or biweekly one.
pub fn successor_period(cadence: Cadence, period_end: Date) -> (Date, Date) {
    let p = following_period(cadence, PayDay::LastDay, period_end);
    (p.start, p.end)
}

/// The successor's invoice reference: a trailing number goes up by one, keeping its width
/// (INV-014 becomes INV-015); a reference without one gets -2, then -3.
pub fn successor_invoice_ref(invoice_ref: &str) -> String {
    let digits = invoice_ref.chars().rev().take_while(|c| c.is_ascii_digit()).count();
    if digits == 0 {
        let out = format!("{invoice_ref}-2");
        return if out.len() > memo::MAX_INVOICE_REF_LEN {
            let keep: String = invoice_ref.chars().take(memo::MAX_INVOICE_REF_LEN - 2).collect();
            format!("{keep}-2")
        } else {
            out
        };
    }
    let split = invoice_ref.len() - digits;
    let (head, tail) = invoice_ref.split_at(split);
    let next = tail.parse::<u64>().map(|n| n + 1).unwrap_or(1);
    let bumped = format!("{head}{next:0width$}", width = tail.len());
    if bumped.len() > memo::MAX_INVOICE_REF_LEN {
        bumped.chars().take(memo::MAX_INVOICE_REF_LEN).collect()
    } else {
        bumped
    }
}

/// Marks the requests paid by `line_id` as paid and creates the successor of each recurring one.
/// Returns how many were paid now and the successors created. Safe to call again: a request
/// already paid is left alone.
pub async fn mark_paid_for_line(pool: &Pool, line_id: &str) -> anyhow::Result<(usize, Vec<RequestRow>)> {
    let rows: Vec<RequestRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{SELECT} WHERE r.line_id = ? AND r.status = 'approved'"
    )))
    .bind(line_id)
    .fetch_all(pool)
    .await?;
    let mut successors = vec![];
    let mut paid = 0;
    for r in rows {
        let changed = sqlx::query("UPDATE payment_requests SET status = 'paid' WHERE id = ? AND status = 'approved'")
            .bind(&r.id)
            .execute(pool)
            .await?
            .rows_affected()
            == 1;
        if !changed {
            continue;
        }
        paid += 1;
        let Some(cadence) = r.recurring.as_deref().and_then(Cadence::parse) else {
            continue;
        };
        let Some(end) = parse_date(&r.period_end) else {
            continue;
        };
        let (next_start, next_end) = successor_period(cadence, end);
        let shift = next_end - end;
        let due = r
            .due_date
            .as_deref()
            .and_then(parse_date)
            .map(|d| iso(d.saturating_add(Duration::days(shift.whole_days()))));
        let next = insert(
            pool,
            &NewRequest {
                contractor_id: r.contractor_id.clone(),
                amount_usd_cents: r.amount_usd_cents as u64,
                period_start: iso(next_start),
                period_end: iso(next_end),
                invoice_ref: successor_invoice_ref(&r.invoice_ref),
                due_date: due,
                note: r.note.clone(),
                recurring: Some(cadence),
            },
        )
        .await?;
        successors.push(next);
    }
    Ok((paid, successors))
}

/// A request as the API shows it (docs/API.md, Payment requests).
pub fn json(network: ZcashNetwork, r: &RequestRow) -> Value {
    json!({
        "id": r.id,
        "contractor_id": r.contractor_id,
        "contractor_name": r.contractor_name,
        "amount_usd_cents": r.amount_usd_cents,
        "period_start": r.period_start,
        "period_end": r.period_end,
        "invoice_ref": r.invoice_ref,
        "due_date": r.due_date,
        "note": r.note,
        "status": r.status,
        "run_id": r.run_id,
        "line_id": r.line_id,
        "recurring": r.recurring,
        "decision_note": r.decision_note,
        "created_at": r.created_at,
        "decided_at": r.decided_at,
        "decided_by": r.decided_by,
        "txid": r.txid,
        "explorer_url": r.txid.as_ref().map(|t| network.explorer_tx_url(t)),
        "paid_at": r.confirmed_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(id: &str, contractor: &str, cents: i64, inv: &str) -> RequestRow {
        RequestRow {
            id: id.into(),
            org_id: None,
            contractor_id: contractor.into(),
            amount_usd_cents: cents,
            period_start: "2026-10-01".into(),
            period_end: "2026-10-31".into(),
            invoice_ref: inv.into(),
            due_date: None,
            note: None,
            status: "approved".into(),
            run_id: None,
            line_id: None,
            recurring: None,
            decision_note: None,
            created_at: String::new(),
            decided_at: None,
            decided_by: None,
            contractor_name: "Someone".into(),
            contractor_archived: false,
            txid: None,
            confirmed_at: None,
        }
    }

    #[test]
    fn requests_join_their_contractors_line_or_add_one() {
        let given = vec![NewLine {
            contractor_id: "a".into(),
            amount_usd_cents: 100,
            invoice_ref: "edited".into(),
        }];
        let reqs = [
            request("r1", "a", 250, "A-1"),
            request("r2", "b", 300, "B-1"),
            request("r3", "b", 50, "B-2"),
        ];
        let lines = merge_lines(given, &reqs);
        assert_eq!(lines.len(), 2);
        // The payer's own line keeps its amount and reference; the request rides on it.
        assert_eq!(lines[0].line.amount_usd_cents, 100);
        assert_eq!(lines[0].line.invoice_ref, "edited");
        assert_eq!(lines[0].request_ids, vec!["r1"]);
        // Two requests from one contractor make one added line with both references.
        assert_eq!(lines[1].line.contractor_id, "b");
        assert_eq!(lines[1].line.amount_usd_cents, 350);
        assert_eq!(lines[1].line.invoice_ref, "B-1, B-2");
        assert_eq!(lines[1].request_ids, vec!["r2", "r3"]);
    }

    #[test]
    fn joined_references_fit_the_memo() {
        let long = "X".repeat(40);
        let refs = [long.as_str(), long.as_str(), long.as_str()];
        let joined = joined_invoice_ref(&refs);
        assert!(joined.len() <= memo::MAX_INVOICE_REF_LEN);
        assert!(joined.ends_with(" +2"));
        assert!(memo::validate_invoice_ref(&joined).is_ok());
    }

    #[test]
    fn successors_follow_the_period_and_count_the_invoice_up() {
        assert_eq!(successor_invoice_ref("INV-014"), "INV-015");
        assert_eq!(successor_invoice_ref("INV-099"), "INV-100");
        assert_eq!(successor_invoice_ref("Retainer"), "Retainer-2");
        assert_eq!(successor_invoice_ref("Retainer-2"), "Retainer-3");
        assert_eq!(successor_invoice_ref("9"), "10");
        let end = parse_date("2026-10-31").unwrap();
        let (s, e) = successor_period(Cadence::Monthly, end);
        assert_eq!((iso(s), iso(e)), ("2026-11-01".to_string(), "2026-11-30".to_string()));
        let (s, e) = successor_period(Cadence::Weekly, parse_date("2026-10-16").unwrap());
        assert_eq!((iso(s), iso(e)), ("2026-10-17".to_string(), "2026-10-23".to_string()));
        let (s, e) = successor_period(Cadence::Biweekly, parse_date("2026-10-16").unwrap());
        assert_eq!((iso(s), iso(e)), ("2026-10-17".to_string(), "2026-10-30".to_string()));
    }
}
