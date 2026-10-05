/*
  Pure helpers for the company console (Home, People, Payslip access, Treasury). Everything is
  derived from GET /api/wallet, /api/contractors and /api/runs: integers throughout, USD in cents
  and coin in zatoshis.
*/
import { ApiError, type Contractor, type PayLine, type Run, type RunStatus } from "@/lib/api";
import type { TagTone } from "@/components/ds/tag";

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

/** "2026-10-05T01:58:38Z" -> "5 Oct": table dates, the year is in the run's period. */
export function shortDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function settlementLabel(c: Pick<Contractor, "settlement_choice">): string {
  return c.settlement_choice === "convert_usdc" ? "Converts to USDC" : "Holds ZEC";
}

export function personSubline(c: Pick<Contractor, "settlement_choice" | "account_index">): string {
  return `${settlementLabel(c)} · Account ${c.account_index}`;
}

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  draft: "Draft",
  awaiting_funds: "Awaiting funds",
  funded: "Funded",
  swapping: "Swapping",
  swapped: "Swapped",
  allocating: "Allocating",
  paying: "Paying",
  paid: "Paid",
  failed: "Failed",
};

/** How far a run is through its life, 0 to 1, for the Next payroll bar. */
export function runProgress(status: RunStatus): number {
  switch (status) {
    case "draft":
      return 0.2;
    case "awaiting_funds":
      return 0.4;
    case "funded":
    case "swapping":
    case "swapped":
      return 0.6;
    case "allocating":
    case "paying":
      return 0.8;
    case "paid":
      return 1;
    default:
      return 0;
  }
}

/** Runs newest first by creation time. */
export function newestFirst(runs: Run[]): Run[] {
  return runs.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function paidRuns(runs: Run[]): Run[] {
  return newestFirst(runs).filter((r) => r.status === "paid");
}

/** The newest run that has not been paid: a draft, one waiting for funds, one in progress or failed. */
export function openRun(runs: Run[]): Run | undefined {
  return newestFirst(runs).find((r) => r.status !== "paid");
}

function monthIndex(label: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? Number(m[1]) * 12 + month - 1 : null;
}

function monthLabel(index: number): string {
  return `${MONTHS[index % 12]} ${Math.floor(index / 12)}`;
}

/** The period after the latest run ("Oct 2026"), or last calendar month when there is no run. */
export function nextPeriodLabel(runs: Run[], now = new Date()): string {
  const indices = runs.map((r) => monthIndex(r.period_label)).filter((i): i is number => i !== null);
  if (indices.length > 0) return monthLabel(Math.max(...indices) + 1);
  return monthLabel(now.getUTCFullYear() * 12 + now.getUTCMonth() - 1);
}

/** Confirmed pay lines of paid runs, summed. */
export function paidTotals(runs: Run[]) {
  let cents = 0;
  let zat = 0;
  let payments = 0;
  let fundedCents = 0;
  let feesZat = 0;
  for (const run of runs) {
    if (run.status !== "paid") continue;
    for (const line of run.lines) {
      if (line.status !== "confirmed") continue;
      cents += line.amount_usd_cents;
      zat += line.amount_zat ?? 0;
      payments += 1;
    }
    fundedCents += run.funding?.funded_usd_cents ?? 0;
    feesZat += run.fees_zat ?? 0;
  }
  return { cents, zat, payments, fundedCents, feesZat };
}

/** Paid USD per period (YYYY-MM) for paid runs, oldest first, continuous months, at most 12. */
export function paidByPeriod(runs: Run[]): { period: string; label: string; cents: number }[] {
  const totals = new Map<number, number>();
  for (const run of runs) {
    if (run.status !== "paid") continue;
    const i = monthIndex(run.period_label);
    if (i === null) continue;
    const paid = run.lines.reduce((s, l) => s + (l.status === "confirmed" ? l.amount_usd_cents : 0), 0);
    totals.set(i, (totals.get(i) ?? 0) + paid);
  }
  const keys = [...totals.keys()].sort((a, b) => a - b);
  if (keys.length === 0) return [];
  const last = keys[keys.length - 1];
  const first = Math.max(keys[0], last - 11);
  const out = [];
  for (let i = first; i <= last; i++) {
    out.push({
      period: `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`,
      label: MONTHS[i % 12],
      cents: totals.get(i) ?? 0,
    });
  }
  return out;
}

/** Number of distinct periods with a paid run. */
export function paidPeriodCount(runs: Run[]): number {
  return new Set(runs.filter((r) => r.status === "paid").map((r) => r.period_label)).size;
}

export interface LastPaid {
  cents: number;
  zat: number | null;
  date: string;
  period: string;
  runId: string;
}

/** The latest confirmed payment to each contractor. */
export function lastPaidByContractor(runs: Run[]): Map<string, LastPaid> {
  const out = new Map<string, LastPaid>();
  for (const run of newestFirst(runs)) {
    for (const line of run.lines) {
      if (line.status !== "confirmed" || out.has(line.contractor_id)) continue;
      out.set(line.contractor_id, {
        cents: line.amount_usd_cents,
        zat: line.amount_zat,
        date: run.updated_at,
        period: run.period_label,
        runId: run.id,
      });
    }
  }
  return out;
}

export interface LineWithRun {
  line: PayLine;
  run: Run;
}

/** Every pay line with its run, newest run first. */
export function linesWithRuns(runs: Run[]): LineWithRun[] {
  return newestFirst(runs).flatMap((run) => run.lines.map((line) => ({ line, run })));
}

export function isConverted(line: PayLine): boolean {
  return line.settlement_choice === "convert_usdc" || !!line.settlement;
}

/** The status of one pay line as a tag: gold for a confirmed shielded payment, neutral otherwise. */
export function lineTag(line: PayLine, run: Run): { label: string; tone: TagTone } {
  if (line.status === "failed") return { label: "Failed", tone: "danger" };
  if (line.status === "confirmed") {
    return isConverted(line)
      ? { label: "Converted to USDC", tone: "neutral" }
      : { label: "Shielded", tone: "shielded" };
  }
  if (line.status === "broadcast") return { label: "Sending", tone: "neutral" };
  if (line.status === "allocated") return { label: "Allocated", tone: "neutral" };
  if (run.status === "draft") return { label: "Draft", tone: "neutral" };
  if (run.status === "failed") return { label: "Not sent", tone: "neutral" };
  return { label: "Pending", tone: "neutral" };
}

export function isPendingLine(line: PayLine): boolean {
  return line.status === "pending" || line.status === "allocated" || line.status === "broadcast";
}

/** True when the run was funded through the testnet venue, whose rate is fixed and not a price. */
export function isSimulated(run: Run): boolean {
  return run.funding?.venue === "testnet-fixed-rate";
}

/** Where a run's money came from, in words: "USDC on Base" or "Testnet funding". */
export function fundingSource(run: Run): string {
  const f = run.funding;
  if (!f) return "Not funded";
  if (f.venue === "testnet-fixed-rate") return "Testnet funding";
  const chain = f.origin_chain ? f.origin_chain.charAt(0).toUpperCase() + f.origin_chain.slice(1) : null;
  return chain ? `${f.origin_asset} on ${chain}` : f.origin_asset;
}

/** The fill rate of the newest run that has one, for valuing the treasury on mainnet. */
export function latestFillRate(runs: Run[]): number | null {
  for (const run of newestFirst(runs)) {
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

/** The link a contractor opens to read their payslips. The key rides in the fragment, which browsers never send. */
export function inviteLink(origin: string, ufvk: string): string {
  return `${origin}/portal#key=${encodeURIComponent(ufvk)}`;
}

export const AUDITOR_DOWNLOAD_KEY = "payslip.auditorPackageAt";
