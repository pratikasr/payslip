//! Pay schedule (ADR-028): when the next payroll is due, and a task that drafts it.
//!
//! One schedule per deployment (one organisation until sign-in arrives). Its cadence and pay
//! day fix every period: weekly and biweekly periods end on the pay day; a monthly period is the
//! calendar month and is paid on a day of that month (1 to 28, or its last day). The scheduler
//! runs once at start and then hourly: when today is `draft_days_before` days or fewer before the
//! next pay day and no run covers the period, it creates a draft run with one line per active
//! contractor who has a default amount or an approved payment request for the period, logs it,
//! and moves the schedule on to the following period. Nothing is funded or paid by it.

use serde_json::{json, Value};
use sqlx::FromRow;
use time::{Date, Duration, Month, Weekday};
use uuid::Uuid;

use crate::{
    db::{self, NewRun, Pool, RunInsert},
    error::ApiError,
    money, requests,
    runs::parse_date,
};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cadence {
    Weekly,
    Biweekly,
    Monthly,
}

impl Cadence {
    pub fn parse(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "weekly" => Some(Cadence::Weekly),
            "biweekly" => Some(Cadence::Biweekly),
            "monthly" => Some(Cadence::Monthly),
            _ => None,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Cadence::Weekly => "weekly",
            Cadence::Biweekly => "biweekly",
            Cadence::Monthly => "monthly",
        }
    }

    /// Days in a period, for the cadences whose periods have a fixed length.
    fn days(&self) -> Option<i64> {
        match self {
            Cadence::Weekly => Some(7),
            Cadence::Biweekly => Some(14),
            Cadence::Monthly => None,
        }
    }
}

/// When a period is paid: a weekday for weekly and biweekly schedules, a day of the month for
/// monthly ones.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PayDay {
    Weekday(Weekday),
    DayOfMonth(u8),
    LastDay,
}

const WEEKDAYS: [(&str, Weekday); 7] = [
    ("monday", Weekday::Monday),
    ("tuesday", Weekday::Tuesday),
    ("wednesday", Weekday::Wednesday),
    ("thursday", Weekday::Thursday),
    ("friday", Weekday::Friday),
    ("saturday", Weekday::Saturday),
    ("sunday", Weekday::Sunday),
];

impl PayDay {
    /// Reads the stored or submitted form: `monday` .. `sunday` for weekly and biweekly,
    /// `1` .. `28` or `last` for monthly.
    pub fn parse(cadence: Cadence, s: &str) -> Result<Self, String> {
        let s = s.trim().to_ascii_lowercase();
        match cadence {
            Cadence::Weekly | Cadence::Biweekly => WEEKDAYS
                .iter()
                .find(|(name, _)| *name == s)
                .map(|(_, w)| PayDay::Weekday(*w))
                .ok_or_else(|| format!("{s:?} is not a weekday; use monday to sunday.")),
            Cadence::Monthly => {
                if s == "last" {
                    return Ok(PayDay::LastDay);
                }
                s.parse::<u8>()
                    .ok()
                    .filter(|d| (1..=28).contains(d))
                    .map(PayDay::DayOfMonth)
                    .ok_or_else(|| format!("{s:?} is not a day of the month; use 1 to 28, or last."))
            }
        }
    }
}

/// The stored form: `friday`, `25`, `last`.
impl std::fmt::Display for PayDay {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PayDay::Weekday(w) => f.write_str(
                WEEKDAYS
                    .iter()
                    .find(|(_, d)| d == w)
                    .map(|(n, _)| *n)
                    .unwrap_or_default(),
            ),
            PayDay::DayOfMonth(d) => write!(f, "{d}"),
            PayDay::LastDay => f.write_str("last"),
        }
    }
}

/// An inclusive pay period.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Period {
    pub start: Date,
    pub end: Date,
}

pub fn iso(d: Date) -> String {
    d.format(&time::macros::format_description!("[year]-[month]-[day]"))
        .unwrap_or_default()
}

fn month_start(d: Date) -> Date {
    d.replace_day(1).unwrap_or(d)
}

fn month_end(d: Date) -> Date {
    d.replace_day(d.month().length(d.year())).unwrap_or(d)
}

fn next_month_start(d: Date) -> Date {
    let (year, month) = match d.month() {
        Month::December => (d.year() + 1, Month::January),
        m => (d.year(), m.next()),
    };
    Date::from_calendar_date(year, month, 1).unwrap_or(d)
}

/// The first date on or after `from` that falls on `weekday`.
fn next_weekday(from: Date, weekday: Weekday) -> Date {
    let ahead = (i64::from(weekday.number_from_monday()) + 7 - i64::from(from.weekday().number_from_monday())) % 7;
    from.saturating_add(Duration::days(ahead))
}

/// The day the period `period` is paid.
pub fn pay_day_of(cadence: Cadence, pay_day: PayDay, period: &Period) -> Date {
    match (cadence, pay_day) {
        // Weekly and biweekly periods end on the pay day.
        (Cadence::Weekly | Cadence::Biweekly, _) => period.end,
        (Cadence::Monthly, PayDay::DayOfMonth(d)) => period.start.replace_day(d).unwrap_or(period.start),
        (Cadence::Monthly, PayDay::LastDay | PayDay::Weekday(_)) => month_end(period.start),
    }
}

/// The first period whose pay day is on or after `today`: what a schedule starts from.
pub fn first_period_from(cadence: Cadence, pay_day: PayDay, today: Date) -> Period {
    match cadence.days() {
        Some(days) => {
            let end = match pay_day {
                PayDay::Weekday(w) => next_weekday(today, w),
                _ => today,
            };
            Period {
                start: end.saturating_sub(Duration::days(days - 1)),
                end,
            }
        }
        None => {
            let this_month = Period {
                start: month_start(today),
                end: month_end(today),
            };
            if pay_day_of(cadence, pay_day, &this_month) >= today {
                this_month
            } else {
                following_period(cadence, pay_day, this_month.end)
            }
        }
    }
}

/// The period after one ending on `period_end`.
pub fn following_period(cadence: Cadence, _pay_day: PayDay, period_end: Date) -> Period {
    match cadence.days() {
        Some(days) => {
            let start = period_end.saturating_add(Duration::days(1));
            Period {
                start,
                end: start.saturating_add(Duration::days(days - 1)),
            }
        }
        None => {
            let start = next_month_start(period_end);
            Period {
                start,
                end: month_end(start),
            }
        }
    }
}

/// The day the draft is made: `draft_days_before` days before the pay day.
pub fn drafts_on(pay_day: Date, draft_days_before: u8) -> Date {
    pay_day.saturating_sub(Duration::days(i64::from(draft_days_before)))
}

/// What the scheduler does for the next period on a given day.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Decision {
    /// Not yet: the draft day is ahead, or the schedule is off.
    Wait,
    /// Create the draft run for the period.
    Draft,
    /// A run already covers the period: move on without drafting.
    Covered,
}

pub fn decide(active: bool, today: Date, drafts_on: Date, covered: bool) -> Decision {
    if !active || today < drafts_on {
        Decision::Wait
    } else if covered {
        Decision::Covered
    } else {
        Decision::Draft
    }
}

// ---------------------------------------------------------------------------------------------
// Storage

#[derive(Clone, Debug, FromRow)]
pub struct ScheduleRow {
    pub id: String,
    pub org_id: Option<String>,
    pub cadence: String,
    pub pay_day: String,
    pub draft_days_before: i64,
    pub next_period_start: String,
    pub next_period_end: String,
    pub active: bool,
    pub last_run_id: Option<String>,
    pub last_pay_day: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl ScheduleRow {
    fn cadence(&self) -> Cadence {
        Cadence::parse(&self.cadence).unwrap_or(Cadence::Monthly)
    }

    fn pay_day(&self) -> PayDay {
        PayDay::parse(self.cadence(), &self.pay_day).unwrap_or(PayDay::LastDay)
    }

    fn period(&self) -> Option<Period> {
        Some(Period {
            start: parse_date(&self.next_period_start)?,
            end: parse_date(&self.next_period_end)?,
        })
    }

    /// The next pay day and the day its draft is made.
    pub fn next_dates(&self) -> Option<(Date, Date)> {
        let period = self.period()?;
        let pay = pay_day_of(self.cadence(), self.pay_day(), &period);
        Some((pay, drafts_on(pay, self.draft_days_before as u8)))
    }
}

/// The validated settings a `PUT /api/schedule` carries.
#[derive(Clone, Debug)]
pub struct ScheduleInput {
    pub cadence: Cadence,
    pub pay_day: PayDay,
    pub draft_days_before: u8,
    pub active: bool,
}

pub async fn get(pool: &Pool) -> anyhow::Result<Option<ScheduleRow>> {
    Ok(
        sqlx::query_as("SELECT * FROM pay_schedules ORDER BY created_at LIMIT 1")
            .fetch_optional(pool)
            .await?,
    )
}

/// Creates or replaces the one schedule. The next period is the first whose pay day is on or
/// after `today`; if a run already covers it, the next tick moves on.
pub async fn upsert(pool: &Pool, input: &ScheduleInput, today: Date) -> anyhow::Result<ScheduleRow> {
    let period = first_period_from(input.cadence, input.pay_day, today);
    let ts = db::now();
    match get(pool).await? {
        Some(existing) => {
            sqlx::query(
                "UPDATE pay_schedules SET cadence = ?, pay_day = ?, draft_days_before = ?, active = ?,
                        next_period_start = ?, next_period_end = ?, updated_at = ? WHERE id = ?",
            )
            .bind(input.cadence.as_str())
            .bind(input.pay_day.to_string())
            .bind(i64::from(input.draft_days_before))
            .bind(input.active)
            .bind(iso(period.start))
            .bind(iso(period.end))
            .bind(&ts)
            .bind(&existing.id)
            .execute(pool)
            .await?;
        }
        None => {
            sqlx::query(
                "INSERT INTO pay_schedules (id, cadence, pay_day, draft_days_before, active, next_period_start,
                                            next_period_end, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(Uuid::new_v4().to_string())
            .bind(input.cadence.as_str())
            .bind(input.pay_day.to_string())
            .bind(i64::from(input.draft_days_before))
            .bind(input.active)
            .bind(iso(period.start))
            .bind(iso(period.end))
            .bind(&ts)
            .bind(&ts)
            .execute(pool)
            .await?;
        }
    }
    get(pool)
        .await?
        .ok_or_else(|| anyhow::anyhow!("the schedule was not stored"))
}

async fn advance(pool: &Pool, s: &ScheduleRow, next: Period, run_id: &str, pay_day: Date) -> anyhow::Result<()> {
    sqlx::query(
        "UPDATE pay_schedules SET next_period_start = ?, next_period_end = ?, last_run_id = ?, last_pay_day = ?,
                updated_at = ? WHERE id = ?",
    )
    .bind(iso(next.start))
    .bind(iso(next.end))
    .bind(run_id)
    .bind(iso(pay_day))
    .bind(db::now())
    .bind(&s.id)
    .execute(pool)
    .await?;
    Ok(())
}

/// What one scheduler pass did.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TickOutcome {
    /// No schedule, the schedule is off, or the draft day is still ahead.
    Waited,
    /// A draft run was created for the period.
    Drafted {
        run_id: String,
        period_start: String,
        period_end: String,
    },
    /// A run already covered the period (or nobody had an amount): the schedule moved on.
    Skipped {
        period_start: String,
        period_end: String,
        reason: String,
    },
}

/// One scheduler pass. Callers hold `AppState::schedule_lock`, so the hourly task and a
/// `PUT /api/schedule` never draft the same period twice.
pub async fn tick(pool: &Pool, today: Date) -> anyhow::Result<TickOutcome> {
    let Some(s) = get(pool).await? else {
        return Ok(TickOutcome::Waited);
    };
    let Some(period) = s.period() else {
        anyhow::bail!("the schedule's next period is not a date");
    };
    let (cadence, pay_day) = (s.cadence(), s.pay_day());
    let pay = pay_day_of(cadence, pay_day, &period);
    let covering = db::overlapping_runs(pool, &s.next_period_start, &s.next_period_end, None).await?;
    match decide(
        s.active,
        today,
        drafts_on(pay, s.draft_days_before as u8),
        !covering.is_empty(),
    ) {
        Decision::Wait => Ok(TickOutcome::Waited),
        Decision::Covered => {
            let run = &covering[0];
            advance(pool, &s, following_period(cadence, pay_day, period.end), &run.id, pay).await?;
            Ok(TickOutcome::Skipped {
                period_start: s.next_period_start.clone(),
                period_end: s.next_period_end.clone(),
                reason: format!("run {} already covers the period", run.id),
            })
        }
        Decision::Draft => {
            let lines = requests::draft_lines(pool, &s.next_period_start, &s.next_period_end).await?;
            if lines.is_empty() {
                tracing::info!(
                    "pay schedule: nobody has a default amount or an approved request for {} to {}; no draft",
                    s.next_period_start,
                    s.next_period_end
                );
                advance(pool, &s, following_period(cadence, pay_day, period.end), "", pay).await?;
                return Ok(TickOutcome::Skipped {
                    period_start: s.next_period_start.clone(),
                    period_end: s.next_period_end.clone(),
                    reason: "nobody has a default amount or an approved request for the period".into(),
                });
            }
            let key = format!("schedule:{}:{}:{}", s.id, s.next_period_start, s.next_period_end);
            let new_lines: Vec<db::NewLine> = lines.iter().map(|l| l.line.clone()).collect();
            let run = NewRun {
                idempotency_key: Some(&key),
                request_hash: None,
                period_start: &s.next_period_start,
                period_end: &s.next_period_end,
                allow_overlap: false,
            };
            let run_id = match db::create_run(pool, &run, &new_lines).await? {
                RunInsert::Created(id) => {
                    requests::link(pool, &id, &lines).await?;
                    db::log_event(
                        pool,
                        &id,
                        &format!(
                            "Drafted by the pay schedule for pay day {}: {} for {}",
                            iso(pay),
                            money::format_usd(new_lines.iter().map(|l| l.amount_usd_cents).sum()),
                            plural(new_lines.len(), "contractor")
                        ),
                    )
                    .await?;
                    id
                }
                // Another pass got there first, or a run was made by hand meanwhile.
                RunInsert::KeyExists(existing) => existing.id,
                RunInsert::Overlaps(runs) => runs[0].id.clone(),
            };
            advance(pool, &s, following_period(cadence, pay_day, period.end), &run_id, pay).await?;
            tracing::info!(
                run = run_id,
                "pay schedule drafted {} to {}",
                s.next_period_start,
                s.next_period_end
            );
            Ok(TickOutcome::Drafted {
                run_id,
                period_start: s.next_period_start.clone(),
                period_end: s.next_period_end.clone(),
            })
        }
    }
}

fn plural(n: usize, one: &str) -> String {
    if n == 1 {
        format!("1 {one}")
    } else {
        format!("{n} {one}s")
    }
}

/// Today's date (UTC): the service's clock, as the scheduler sees it.
pub fn today() -> Date {
    time::OffsetDateTime::now_utc().date()
}

/// The schedule as the API shows it (docs/API.md, Pay schedule).
pub async fn json(pool: &Pool, s: &ScheduleRow, today: Date) -> anyhow::Result<Value> {
    let (pay, draft) = s
        .next_dates()
        .map(|(p, d)| (Some(iso(p)), Some(iso(d))))
        .unwrap_or((None, None));
    // The last drafted run while it still needs the payer; overdue once its pay day has passed.
    let mut drafted = Value::Null;
    let mut overdue = false;
    if let Some(run_id) = s.last_run_id.as_deref().filter(|id| !id.is_empty()) {
        if let Some(run) = db::get_run(pool, run_id).await? {
            if run.status != "paid" && run.status != "cancelled" {
                overdue = s
                    .last_pay_day
                    .as_deref()
                    .and_then(parse_date)
                    .is_some_and(|d| today > d);
                drafted = json!({
                    "run_id": run.id,
                    "period_start": run.period_start,
                    "period_end": run.period_end,
                    "pay_day": s.last_pay_day,
                    "status": run.status,
                });
            }
        }
    }
    Ok(json!({
        "id": s.id,
        "cadence": s.cadence,
        "pay_day": s.pay_day,
        "draft_days_before": s.draft_days_before,
        "active": s.active,
        "next_period_start": s.next_period_start,
        "next_period_end": s.next_period_end,
        "next_pay_day": pay,
        "drafts_on": draft,
        "drafted": drafted,
        "overdue": overdue,
        "created_at": s.created_at,
        "updated_at": s.updated_at,
    }))
}

/// Reads and validates `PUT /api/schedule`'s body.
pub fn parse_input(
    cadence: &str,
    pay_day: &str,
    draft_days_before: Option<i64>,
    active: Option<bool>,
) -> Result<ScheduleInput, ApiError> {
    let cadence = Cadence::parse(cadence).ok_or_else(|| {
        ApiError::bad_request(
            "invalid_cadence",
            format!("{cadence:?} is not a cadence."),
            "Use weekly, biweekly or monthly.",
        )
    })?;
    let pay_day = PayDay::parse(cadence, pay_day).map_err(|m| {
        ApiError::bad_request(
            "invalid_pay_day",
            m,
            "Weekly and biweekly schedules name a weekday (friday); monthly ones a day of the month (25) or last.",
        )
    })?;
    let draft_days_before = match draft_days_before {
        None => 5,
        Some(d) if (0..=28).contains(&d) => d as u8,
        Some(d) => {
            return Err(ApiError::bad_request(
                "invalid_draft_days",
                format!("{d} days before the pay day is outside 0 to 28."),
                "Choose how many days before the pay day the draft is made, from 0 to 28 (5 by default).",
            ))
        }
    };
    Ok(ScheduleInput {
        cadence,
        pay_day,
        draft_days_before,
        active: active.unwrap_or(true),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn d(s: &str) -> Date {
        parse_date(s).unwrap()
    }

    fn p(start: &str, end: &str) -> Period {
        Period {
            start: d(start),
            end: d(end),
        }
    }

    #[test]
    fn weekly_periods_end_on_the_pay_day() {
        // 11 Oct 2026 is a Sunday; the next Friday is 16 Oct.
        let friday = PayDay::Weekday(Weekday::Friday);
        assert_eq!(
            first_period_from(Cadence::Weekly, friday, d("2026-10-11")),
            p("2026-10-10", "2026-10-16")
        );
        // A pay day that is today starts a period ending today.
        assert_eq!(
            first_period_from(Cadence::Weekly, friday, d("2026-10-16")),
            p("2026-10-10", "2026-10-16")
        );
        assert_eq!(
            pay_day_of(Cadence::Weekly, friday, &p("2026-10-10", "2026-10-16")),
            d("2026-10-16")
        );
        assert_eq!(
            following_period(Cadence::Weekly, friday, d("2026-10-16")),
            p("2026-10-17", "2026-10-23")
        );
        assert_eq!(
            first_period_from(Cadence::Biweekly, friday, d("2026-10-11")),
            p("2026-10-03", "2026-10-16")
        );
        assert_eq!(
            following_period(Cadence::Biweekly, friday, d("2026-10-16")),
            p("2026-10-17", "2026-10-30")
        );
    }

    #[test]
    fn monthly_periods_are_calendar_months_paid_on_their_day() {
        let last = PayDay::LastDay;
        assert_eq!(
            first_period_from(Cadence::Monthly, last, d("2026-10-11")),
            p("2026-10-01", "2026-10-31")
        );
        assert_eq!(
            pay_day_of(Cadence::Monthly, last, &p("2026-02-01", "2026-02-28")),
            d("2026-02-28")
        );
        let on_25 = PayDay::DayOfMonth(25);
        assert_eq!(
            pay_day_of(Cadence::Monthly, on_25, &p("2026-10-01", "2026-10-31")),
            d("2026-10-25")
        );
        // Past this month's pay day, the schedule starts from next month.
        assert_eq!(
            first_period_from(Cadence::Monthly, on_25, d("2026-10-26")),
            p("2026-11-01", "2026-11-30")
        );
        assert_eq!(
            first_period_from(Cadence::Monthly, on_25, d("2026-10-25")),
            p("2026-10-01", "2026-10-31")
        );
        assert_eq!(
            following_period(Cadence::Monthly, last, d("2026-12-31")),
            p("2027-01-01", "2027-01-31")
        );
        assert_eq!(drafts_on(d("2026-10-31"), 5), d("2026-10-26"));
        assert_eq!(drafts_on(d("2026-11-01"), 5), d("2026-10-27"));
    }

    #[test]
    fn pay_days_are_validated_per_cadence() {
        assert_eq!(
            PayDay::parse(Cadence::Weekly, "Friday"),
            Ok(PayDay::Weekday(Weekday::Friday))
        );
        assert!(PayDay::parse(Cadence::Weekly, "25").is_err());
        assert_eq!(PayDay::parse(Cadence::Monthly, "last"), Ok(PayDay::LastDay));
        assert_eq!(PayDay::parse(Cadence::Monthly, "28"), Ok(PayDay::DayOfMonth(28)));
        assert!(PayDay::parse(Cadence::Monthly, "29").is_err());
        assert!(PayDay::parse(Cadence::Monthly, "0").is_err());
        assert!(PayDay::parse(Cadence::Monthly, "friday").is_err());
        assert_eq!(PayDay::Weekday(Weekday::Monday).to_string(), "monday");
        assert_eq!(PayDay::DayOfMonth(7).to_string(), "7");
        assert!(parse_input("monthly", "last", Some(40), None).is_err());
        assert!(parse_input("yearly", "last", None, None).is_err());
        let ok = parse_input("biweekly", "friday", None, None).unwrap();
        assert_eq!((ok.draft_days_before, ok.active), (5, true));
    }

    /// The scheduler drafts on the draft day or later, never before, never when the schedule is
    /// off, and moves on without a draft when a run already covers the period.
    #[test]
    fn the_decision_follows_the_draft_day_and_the_cover() {
        let draft_day = d("2026-10-26");
        assert_eq!(decide(true, d("2026-10-25"), draft_day, false), Decision::Wait);
        assert_eq!(decide(true, d("2026-10-26"), draft_day, false), Decision::Draft);
        assert_eq!(decide(true, d("2026-11-03"), draft_day, false), Decision::Draft);
        assert_eq!(decide(true, d("2026-10-26"), draft_day, true), Decision::Covered);
        assert_eq!(decide(false, d("2026-10-26"), draft_day, false), Decision::Wait);
    }
}
