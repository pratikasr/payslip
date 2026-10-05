/*
  Pure helpers for the company console (Home, People, Payslip access, Treasury). Everything is
  derived from GET /api/wallet, /api/contractors and /api/runs: integers throughout, USD in cents
  and coin in zatoshis.
*/
import { ApiError, type Contractor, type PayLine, type Run } from "@/lib/api";
import { settlementName } from "@/lib/format";
import { isCancelled, latestPeriodFirst, lineConfirmedAt, nextPayPeriod } from "@/lib/payroll";
import { periodTitle, runTag } from "@/components/runs/run-meta";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Retry a read once when the service could not reach lightwalletd, before showing the error. */
export async function retryOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError && err.code === "lightwalletd_unreachable") return fn();
    throw err;
  }
}

/** "Holds TAZ" (testnet) or "Holds ZEC", or "Converts to USDC": how a person is paid. */
export function settlementLabel(c: Pick<Contractor, "settlement_choice">, coin: "ZEC" | "TAZ"): string {
  return settlementName(c.settlement_choice, coin);
}

/** A run's state in the console's one vocabulary (the run page, the list and Home agree). */
export function runStateLabel(run: Run): string {
  return runTag(run).label;
}

/** Paid runs, latest pay period first (a back-dated run is not the latest payroll). */
export function paidRuns(runs: Run[]): Run[] {
  return latestPeriodFirst(runs.filter((r) => r.status === "paid"));
}

/**
 * The run that still needs the payer, latest pay period first: a draft, one waiting for funds,
 * one in progress or one that failed. Cancelled runs are closed and never count.
 */
export function openRun(runs: Run[]): Run | undefined {
  return latestPeriodFirst(runs).find((r) => r.status !== "paid" && !isCancelled(r));
}

function monthIndex(label: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? Number(m[1]) * 12 + month - 1 : null;
}

/** The next payroll to run, as a title ("Oct 2026"): the period after the latest paid one. */
export function nextPeriodTitle(runs: Run[], now = new Date()): string {
  const p = nextPayPeriod(runs, now);
  return periodTitle(p.from, p.to);
}

/** The calendar year of a run's pay period ("2026"), from the day it ends. */
export function periodYear(run: Pick<Run, "period_end">): string {
  return run.period_end.slice(0, 4);
}

/** Confirmed pay lines of paid runs, summed; only runs whose period ends in `year` when given. */
export function paidTotals(runs: Run[], year?: string) {
  let cents = 0;
  let zat = 0;
  let payments = 0;
  let fundedCents = 0;
  let feesZat = 0;
  let payrolls = 0;
  for (const run of runs) {
    if (run.status !== "paid") continue;
    if (year && periodYear(run) !== year) continue;
    payrolls += 1;
    for (const line of run.lines) {
      if (line.status !== "confirmed") continue;
      cents += line.amount_usd_cents;
      zat += line.amount_zat ?? 0;
      payments += 1;
    }
    fundedCents += run.funding?.funded_usd_cents ?? 0;
    feesZat += run.fees_zat ?? 0;
  }
  return { cents, zat, payments, fundedCents, feesZat, payrolls };
}

export interface PeriodPoint {
  /** YYYY-MM */
  period: string;
  /** "Sep" */
  label: string;
  cents: number;
  /** Paid runs in this month: more than one means an extra run (a bonus, a correction). */
  runs: number;
}

/**
 * Paid USD per month (by the month the period ends) for paid runs, oldest first, as a continuous
 * window of at most 12 months. With `year`, only that year's months: the chart then shows exactly
 * what the year's total counts.
 */
export function paidByPeriod(runs: Run[], year?: string): PeriodPoint[] {
  const totals = new Map<number, { cents: number; runs: number }>();
  for (const run of runs) {
    if (run.status !== "paid") continue;
    if (year && periodYear(run) !== year) continue;
    const i = monthIndex(run.period_end.slice(0, 7));
    if (i === null) continue;
    const paid = run.lines.reduce((s, l) => s + (l.status === "confirmed" ? l.amount_usd_cents : 0), 0);
    const t = totals.get(i) ?? { cents: 0, runs: 0 };
    totals.set(i, { cents: t.cents + paid, runs: t.runs + 1 });
  }
  const keys = [...totals.keys()].sort((a, b) => a - b);
  if (keys.length === 0) return [];
  const last = keys[keys.length - 1];
  const first = Math.max(keys[0], last - 11);
  const out: PeriodPoint[] = [];
  for (let i = first; i <= last; i++) {
    const t = totals.get(i);
    out.push({
      period: `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`,
      label: MONTHS[i % 12],
      cents: t?.cents ?? 0,
      runs: t?.runs ?? 0,
    });
  }
  return out;
}

export interface LastPaid {
  cents: number;
  zat: number | null;
  date: string;
  /** The run's period as a title: "Sep 2026", or "1 Sep to 15 Sep 2026". */
  period: string;
  runId: string;
  /** Everything confirmed to this person, in cents, across every run. */
  totalCents: number;
}

/**
 * The latest confirmed payment to each contractor, by pay period (a back-dated run is not the
 * latest), with what they were paid in total. The date is when the payment was mined
 * (`confirmed_at`, newer services), else when its run last changed.
 */
export function lastPaidByContractor(runs: Run[]): Map<string, LastPaid> {
  const out = new Map<string, LastPaid>();
  for (const run of latestPeriodFirst(runs)) {
    for (const line of run.lines) {
      if (line.status !== "confirmed") continue;
      const seen = out.get(line.contractor_id);
      if (seen) {
        seen.totalCents += line.amount_usd_cents;
        continue;
      }
      out.set(line.contractor_id, {
        cents: line.amount_usd_cents,
        zat: line.amount_zat,
        date: lineConfirmedAt(line, run) ?? run.updated_at,
        period: periodTitle(run.period_start, run.period_end),
        runId: run.id,
        totalCents: line.amount_usd_cents,
      });
    }
  }
  return out;
}

export interface LineWithRun {
  line: PayLine;
  run: Run;
}

/** Every pay line with its run, latest pay period first. */
export function linesWithRuns(runs: Run[]): LineWithRun[] {
  return latestPeriodFirst(runs).flatMap((run) => run.lines.map((line) => ({ line, run })));
}

export function isPendingLine(line: PayLine): boolean {
  return line.status === "pending" || line.status === "allocated" || line.status === "broadcast";
}

/** True when the run was funded through the testnet venue, whose rate is fixed and not a price. */
export function isSimulated(run: Run): boolean {
  return run.funding?.venue === "testnet-fixed-rate";
}

/**
 * Where a run's money came from, in words: "USDC on Base", or on testnet "From the
 * testnet treasury" (the testnet venue earmarks coins already in the treasury; no money arrives).
 */
export function fundingSource(run: Run): string {
  const f = run.funding;
  if (!f) return "Not funded";
  if (f.venue === "testnet-fixed-rate") return "From the testnet treasury";
  const chain = f.origin_chain ? f.origin_chain.charAt(0).toUpperCase() + f.origin_chain.slice(1) : null;
  return chain ? `${f.origin_asset} on ${chain}` : f.origin_asset;
}

/**
 * The most recent fill rate, for valuing the treasury in dollars. Unlike every "latest payroll"
 * choice, this one goes by time, not pay period: a back-dated run funded today carries today's
 * price.
 */
export function latestFillRate(runs: Run[]): number | null {
  const byFundingTime = runs.slice().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  for (const run of byFundingTime) {
    const rate = run.funding?.rate_usd_per_zec_e6;
    if (run.funding?.status === "success" && rate && rate > 0) return rate;
  }
  return null;
}

/** zat valued at a rate (USD per ZEC times 1e6), in cents. */
export function zatToCents(zat: number, rateE6: number): number {
  return Math.round((zat * rateE6) / 1e12);
}

/** "Mei Chen and Kwame Mensah", "Amara Okafor, Mateo Fernandez and 3 more". */
export function nameList(names: string[], max = 2): string {
  if (names.length === 0) return "";
  if (names.length <= max) return names.length === 2 ? `${names[0]} and ${names[1]}` : names[0];
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

/**
 * The link a contractor opens to read their payslips, on `origin` (publicOrigin(): the configured
 * portal, else this page). The key rides in the fragment, which browsers never send, with the
 * person's name (so the portal greets them) and the account's birthday height (so the first scan
 * starts where their payments can begin). The portal and Books read both; only `key` is required.
 */
export function inviteLink(
  origin: string,
  ufvk: string,
  extra: { name?: string | null; birthday?: number | null } = {},
): string {
  let link = `${origin}/portal#key=${encodeURIComponent(ufvk)}`;
  const name = extra.name?.trim();
  if (name) link += `&name=${encodeURIComponent(name)}`;
  if (extra.birthday && Number.isInteger(extra.birthday) && extra.birthday > 0) link += `&birthday=${extra.birthday}`;
  return link;
}

export const AUDITOR_DOWNLOAD_KEY = "payslip.auditorPackageAt";
