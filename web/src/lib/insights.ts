/*
  Payroll insights, derived only from GET /api/runs and GET /api/contractors.
  Integer arithmetic throughout: USD in cents, coin in zatoshis.

  "Paid" means a pay line the service reports as confirmed on chain. Lines of
  runs that are not paid yet (draft, awaiting funds, executing, or failed and
  not resumed) count as "not paid yet", so the two always add up to what was
  scheduled.
*/
import type { Contractor, Network, Run, RunStatus } from "@/lib/api";

export interface PeriodTotal {
  /** YYYY-MM, the period the runs cover (not the payment date). */
  period: string;
  paidCents: number;
  openCents: number;
  runs: number;
  payments: number;
}

export interface ContractorTotal {
  id: string;
  name: string;
  paidCents: number;
  payments: number;
  /** In a run but no longer in the contractor list. */
  archived: boolean;
}

export type StatusGroupId = "open" | "progress" | "paid" | "failed";

export interface StatusGroup {
  id: StatusGroupId;
  label: string;
  statuses: RunStatus[];
  count: number;
}

export interface Insights {
  runCount: number;
  /** Continuous months, oldest first, at most MAX_PERIODS. Months without runs are zero. */
  periods: PeriodTotal[];
  /** True when older periods exist beyond the ones in `periods`. */
  periodsTruncated: boolean;
  /** Paid USD per contractor, highest first. Only contractors with a confirmed payment. */
  contractors: ContractorTotal[];
  paidCents: number;
  openCents: number;
  payments: number;
  paidZat: number;
  feesZat: number;
  /** Fees valued at each run's fill rate. Null on testnet, where the fixed rate is not a price. */
  feesUsdCents: number | null;
  /** Runs that recorded network fees (each run's allocation plus its payment transactions). */
  feeRuns: number;
  statusGroups: StatusGroup[];
}

export const MAX_PERIODS = 12;
const MIN_PERIODS = 6;

export const STATUS_GROUPS: Omit<StatusGroup, "count">[] = [
  { id: "open", label: "To fund", statuses: ["draft", "awaiting_funds"] },
  { id: "progress", label: "In progress", statuses: ["funded", "swapping", "swapped", "allocating", "paying"] },
  { id: "paid", label: "Paid", statuses: ["paid"] },
  { id: "failed", label: "Failed", statuses: ["failed"] },
];

function monthIndex(period: string): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return Number(m[1]) * 12 + (month - 1);
}

function periodOf(index: number): string {
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

export function computeInsights(runs: Run[], contractors: Contractor[], network?: Network): Insights {
  const byPeriod = new Map<number, PeriodTotal>();
  const byContractor = new Map<string, ContractorTotal>();
  const names = new Map(contractors.map((c) => [c.id, c.name]));
  let paidCents = 0;
  let openCents = 0;
  let payments = 0;
  let paidZat = 0;
  let feesZat = 0;
  let feesUsdCents = 0;
  let feesUsdKnown = network === "mainnet";
  let feeRuns = 0;

  for (const run of runs) {
    const idx = monthIndex(run.period_label);
    let bucket: PeriodTotal | undefined;
    if (idx !== null) {
      bucket = byPeriod.get(idx);
      if (!bucket) {
        bucket = { period: periodOf(idx), paidCents: 0, openCents: 0, runs: 0, payments: 0 };
        byPeriod.set(idx, bucket);
      }
      bucket.runs += 1;
    }
    for (const line of run.lines) {
      if (line.status === "confirmed") {
        paidCents += line.amount_usd_cents;
        paidZat += line.amount_zat ?? 0;
        payments += 1;
        if (bucket) {
          bucket.paidCents += line.amount_usd_cents;
          bucket.payments += 1;
        }
        const entry = byContractor.get(line.contractor_id) ?? {
          id: line.contractor_id,
          name: names.get(line.contractor_id) ?? line.contractor_name,
          paidCents: 0,
          payments: 0,
          archived: !names.has(line.contractor_id),
        };
        entry.paidCents += line.amount_usd_cents;
        entry.payments += 1;
        byContractor.set(line.contractor_id, entry);
      } else {
        openCents += line.amount_usd_cents;
        if (bucket) bucket.openCents += line.amount_usd_cents;
      }
    }
    if (run.fees_zat && run.fees_zat > 0) {
      feesZat += run.fees_zat;
      feeRuns += 1;
      const rate = run.funding?.rate_usd_per_zec_e6;
      if (rate && rate > 0) {
        // zat * (USD per ZEC * 1e6) / (1e8 zat per ZEC * 1e6) * 100 cents
        feesUsdCents += Math.round((run.fees_zat * rate) / 1e12);
      } else {
        feesUsdKnown = false;
      }
    }
  }

  // Continuous months so gaps read as gaps, with at least MIN_PERIODS for context.
  const indices = [...byPeriod.keys()].sort((a, b) => a - b);
  const periods: PeriodTotal[] = [];
  let periodsTruncated = false;
  if (indices.length > 0) {
    const last = indices[indices.length - 1];
    let first = Math.min(indices[0], last - (MIN_PERIODS - 1));
    if (last - first + 1 > MAX_PERIODS) {
      first = last - (MAX_PERIODS - 1);
      periodsTruncated = indices[0] < first;
    }
    for (let i = first; i <= last; i++) {
      periods.push(byPeriod.get(i) ?? { period: periodOf(i), paidCents: 0, openCents: 0, runs: 0, payments: 0 });
    }
  }

  return {
    runCount: runs.length,
    periods,
    periodsTruncated,
    contractors: [...byContractor.values()].sort((a, b) => b.paidCents - a.paidCents || a.name.localeCompare(b.name)),
    paidCents,
    openCents,
    payments,
    paidZat,
    feesZat,
    feesUsdCents: feesUsdKnown && feeRuns > 0 ? feesUsdCents : null,
    feeRuns,
    statusGroups: STATUS_GROUPS.map((g) => ({ ...g, count: runs.filter((r) => g.statuses.includes(r.status)).length })),
  };
}

/** A round axis maximum at or above `value`: 1, 2, 2.5 or 5 times a power of ten. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    if (step * power >= value) return step * power;
  }
  return 10 * power;
}

/** "$30.4K", "$1.2M", "$950": for axis ticks only; tables and tooltips show full cents. */
export function formatUsdCompact(cents: number): string {
  const dollars = cents / 100;
  const abs = Math.abs(dollars);
  const trim = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));
  if (abs >= 1_000_000) return `$${trim(dollars / 1_000_000)}M`;
  if (abs >= 1_000) return `$${trim(dollars / 1_000)}K`;
  return `$${trim(dollars)}`;
}
