/*
  Pure helpers about payroll runs as a whole: which run is the latest, which pay period comes
  next, and which runs cover the same period. "Latest" always means the latest pay period, never
  the latest creation time: a run created today for July is not newer than September's.
*/
import type { PayLine, Run, RunStatus } from "@/lib/api";
import { previousMonth } from "@/lib/period";

/** Runs that are closed without paying anyone: they never count as a payroll for their period. */
export function isCancelled(run: Pick<Run, "status">): boolean {
  return run.status === "cancelled";
}

/** Latest pay period first: by the period's end, then its start, then the newer run. */
export function byPeriodDesc(
  a: Pick<Run, "period_start" | "period_end" | "created_at">,
  b: Pick<Run, "period_start" | "period_end" | "created_at">,
): number {
  return (
    b.period_end.localeCompare(a.period_end) ||
    b.period_start.localeCompare(a.period_start) ||
    b.created_at.localeCompare(a.created_at)
  );
}

/** A copy of the runs, latest pay period first. */
export function latestPeriodFirst<T extends Pick<Run, "period_start" | "period_end" | "created_at">>(runs: T[]): T[] {
  return runs.slice().sort(byPeriodDesc);
}

/** Statuses whose period is taken care of: paid, or money committed and payments on their way. */
const COVERED: ReadonlySet<RunStatus> = new Set(["paid", "funded", "swapping", "swapped", "allocating", "paying"]);

const DAY_MS = 86_400_000;

function parseDay(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The last day of the month that contains `day` (YYYY-MM-DD). */
export function monthEndOf(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return isoDay(Date.UTC(y, m, 0));
}

export interface PayPeriod {
  from: string;
  to: string;
}

/**
 * The period the next payroll should cover: from the day after the latest paid (or paying) run's
 * period to the end of that month, so a September payroll is followed by October and a
 * 1 to 15 September run by 16 to 30 September. With no such run, the last full calendar month.
 */
export function nextPayPeriod(runs: Run[], now = new Date()): PayPeriod {
  const covered = latestPeriodFirst(runs.filter((r) => COVERED.has(r.status)))[0];
  if (!covered) return previousMonth(now);
  const from = isoDay(parseDay(covered.period_end) + DAY_MS);
  return { from, to: monthEndOf(from) };
}

/** True when two inclusive date ranges share at least one day. */
export function periodsOverlap(a: PayPeriod, b: PayPeriod): boolean {
  return a.from <= b.to && b.from <= a.to;
}

/** Runs (not cancelled) whose period shares a day with `period`, latest period first. */
export function overlappingRuns(runs: Run[], period: PayPeriod, excludeId?: string): Run[] {
  return latestPeriodFirst(
    runs.filter(
      (r) =>
        r.id !== excludeId && !isCancelled(r) && periodsOverlap({ from: r.period_start, to: r.period_end }, period),
    ),
  );
}

/** True when the period ends after today (UTC): paying it now is paying in advance. */
export function endsAfterToday(period: PayPeriod, now = new Date()): boolean {
  return period.to > now.toISOString().slice(0, 10);
}

/**
 * When a pay line was paid: the block time the service reports (`confirmed_at`, newer services),
 * else, for a confirmed line, when its run last changed (for a paid run, when its last payment was
 * confirmed). Null for a line that is not confirmed.
 */
export function lineConfirmedAt(
  line: Pick<PayLine, "status" | "confirmed_at">,
  run: Pick<Run, "updated_at">,
): string | null {
  if (line.status !== "confirmed") return null;
  return line.confirmed_at || run.updated_at;
}

/** True when the time came from the chain (confirmed_at), not from the run's last update. */
export function hasBlockTime(line: Pick<PayLine, "confirmed_at">): boolean {
  return !!line.confirmed_at;
}

/** When a run was paid: the latest confirmation among its lines, for a paid run. */
export function runPaidAt(run: Pick<Run, "status" | "updated_at" | "lines">): string | null {
  if (run.status !== "paid") return null;
  let latest: string | null = null;
  for (const l of run.lines) {
    const at = lineConfirmedAt(l, run);
    if (at && (!latest || at > latest)) latest = at;
  }
  return latest ?? run.updated_at;
}

/*
  The service's fee reserve (service/src/runs.rs, fee_estimate_zat and funding_request_cents):
  each held line's payment fee (10,000 zat), each converting line's fee and change carry
  (15,000 + 10,000 zat), and the allocation's marginal fee (5,000 zat per output plus three),
  set aside at 1.5 times. What the run does not spend stays in the treasury.
*/
const LINE_FEE_ZAT = 10_000;
const CONVERT_LINE_ZAT = 15_000 + 10_000;
const MARGINAL_FEE_ZAT = 5_000;

/** The coin a run sets aside for network fees on top of its payments, as the service computes it. */
export function feeReserveZat(lines: number, converting = 0): number {
  const c = Math.min(converting, lines);
  const estimate = (lines - c) * LINE_FEE_ZAT + c * CONVERT_LINE_ZAT + MARGINAL_FEE_ZAT * (lines + 3);
  return Math.floor((estimate * 3) / 2);
}

/**
 * A run's coin after it was paid: what the funding set aside, what reached contractors, the
 * network fees, and what the treasury kept (the unspent part of the fee reserve). Null parts are
 * not known yet.
 */
export function runCoin(run: Pick<Run, "funding" | "total_zat" | "fees_zat" | "status">) {
  const acquired = run.funding?.zec_acquired_zat ?? null;
  const paid = run.total_zat ?? null;
  const fees = run.fees_zat ?? null;
  const reserve = acquired !== null && paid !== null ? Math.max(0, acquired - paid) : null;
  const unspent = run.status === "paid" && reserve !== null && fees !== null ? Math.max(0, reserve - fees) : null;
  return { acquired, paid, fees, reserve, unspent };
}
