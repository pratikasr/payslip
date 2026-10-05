/*
  Types and pure helpers for the accountant workspace. The service returns a few fields the shared
  client does not type yet (the funding records per run, the run index, the account on unlabelled
  rows); they are typed here, as optional, so nothing breaks if a deployment omits them.
*/

import type {
  FundingLine,
  Network,
  Reconciliation,
  ReconciliationLine,
  ReconciliationRun,
  ReconciliationStatus,
  RunRef,
  UnlabelledLine,
} from "@/lib/api";
import type { KeyClassification } from "@/lib/keys";
import { classifyKey } from "@/lib/keys";
import { formatPeriodLabel } from "@/lib/format";

/** The funding record a run writes on its allocation transaction (memo PS1 run funding). */
export interface RunFundingRecord {
  date: string | null;
  height: number | null;
  txid: string;
  run_id: string;
  period: string;
  funded_usd_cents: number;
  zec_acquired_zat: number;
  rate_usd_per_zec_e6: number;
}

export type BooksUnlabelled = UnlabelledLine & {
  label?: string | null;
  account?: string;
  explorer_url?: string | null;
};

export type BooksFunding = FundingLine & { explorer_url?: string | null };

export type BooksResult = Omit<Reconciliation, "unlabelled" | "funding"> & {
  unlabelled: BooksUnlabelled[];
  funding?: BooksFunding[];
  run_records?: RunFundingRecord[];
  run_index?: Record<string, RunRef>;
};

export interface BooksPeriod {
  from: string;
  to: string;
}

export type KeyRole = "treasury" | "contractor" | "unknown";

/** One viewing key held for this tab. The label and role are shown here only and never sent. */
export interface BookKey {
  ufvk: string;
  label: string | null;
  role: KeyRole | null;
}

export interface StagedKey {
  raw: string;
  label: string | null;
  role: KeyRole | null;
  result: KeyClassification;
}

/* ---------- Keys ---------- */

/**
 * Parse the company's key file (the JSON from GET /api/viewing-keys, also what Payslip access
 * exports). Same rules as the statement key collection, keeping the role as well as the label.
 */
export function parseKeyFile(text: string): { keys: StagedKey[]; network: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON. Use the .json key file the company exported.");
  }
  if (typeof data !== "object" || data === null || !Array.isArray((data as { keys?: unknown }).keys)) {
    throw new Error("This file is not a Payslip viewing key file. Ask the company for the file from Payslip access.");
  }
  const d = data as { network?: unknown; keys: unknown[] };
  const keys = d.keys.flatMap((k): StagedKey[] => {
    if (typeof k !== "object" || k === null) return [];
    const entry = k as { ufvk?: unknown; label?: unknown; role?: unknown };
    if (typeof entry.ufvk !== "string") return [];
    const role = entry.role === "treasury" || entry.role === "contractor" ? entry.role : null;
    return [
      {
        raw: entry.ufvk,
        label: typeof entry.label === "string" && entry.label ? entry.label : null,
        role,
        result: classifyKey(entry.ufvk),
      },
    ];
  });
  if (keys.length === 0) throw new Error("The file has no viewing keys in it. Ask the company to export it again.");
  return { keys, network: typeof d.network === "string" ? d.network : "" };
}

/** Keys that can be sent: full viewing keys for the service's network. */
export function usableKeys(staged: StagedKey[], network?: Network): BookKey[] {
  return staged.flatMap((k) =>
    k.result.kind === "ufvk" && (!network || k.result.network === network)
      ? [{ ufvk: k.result.value, label: k.label, role: k.role }]
      : [],
  );
}

export function mergeKeys(existing: BookKey[], added: BookKey[]): BookKey[] {
  const out = [...existing];
  for (const k of added) {
    const at = out.findIndex((e) => e.ufvk === k.ufvk);
    if (at < 0) out.push(k);
    else if (!out[at].label && k.label) out[at] = { ...out[at], label: k.label, role: k.role ?? out[at].role };
  }
  return out;
}

/**
 * Labels and roles for display. The service answers `accounts` in the order the keys were sent
 * (after removing duplicates), so when the counts agree the i-th account belongs to the i-th key.
 */
export function describeKeys(keys: BookKey[], result: BooksResult | null): BookKey[] {
  const accounts = result?.accounts ?? [];
  const aligned = accounts.length === keys.length;
  return keys.map((k, i) => {
    const a = aligned ? accounts[i] : undefined;
    return { ...k, label: k.label ?? a?.label ?? null, role: k.role ?? a?.role ?? null };
  });
}

/** "Treasury and 6 contractors", "3 keys", "Treasury, 2 contractors and 1 other". */
export function keySetSummary(keys: BookKey[]): string {
  const treasury = keys.filter((k) => k.role === "treasury").length;
  const contractors = keys.filter((k) => k.role === "contractor").length;
  const other = keys.length - treasury - contractors;
  if (treasury + contractors === 0) return keys.length === 1 ? "1 key" : `${keys.length} keys`;
  const parts: string[] = [];
  if (treasury) parts.push(treasury === 1 ? "Treasury" : `${treasury} treasuries`);
  if (contractors) parts.push(contractors === 1 ? "1 contractor" : `${contractors} contractors`);
  if (other) parts.push(other === 1 ? "1 other" : `${other} others`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
}

/* ---------- Runs ---------- */

/** Variance minus explained, from the service when it sends it. Null when either side is missing. */
export function differenceOf(run: ReconciliationRun): number | null {
  if (run.difference_usd_cents !== undefined) return run.difference_usd_cents;
  if (run.variance_usd_cents === null || run.explained_usd_cents === null) return null;
  return run.variance_usd_cents - run.explained_usd_cents;
}

export type StatusTone = "neutral" | "warning" | "danger";

export interface StatusView {
  label: string;
  tone: StatusTone;
  help: string;
}

const STATUS: Record<ReconciliationStatus, StatusView> = {
  reconciled: {
    label: "Reconciled",
    tone: "neutral",
    help: "Funded minus paid equals the coin not paid out, valued at the run's fill rate.",
  },
  variance_unexplained: {
    label: "Unexplained variance",
    tone: "danger",
    help: "Funded minus paid is more than network fees and unspent coin can explain.",
  },
  missing_funding_record: {
    label: "No funding record",
    tone: "warning",
    help: "Payments were found but no funding record for this run in the period. Load the Treasury key, or widen the period.",
  },
  incomplete: {
    label: "Incomplete",
    tone: "warning",
    help: "Some payments in this run are not mined yet, or not visible with these keys.",
  },
};

/** The label a run's status shows, with "within rounding" when a reconciled run's cents differ. */
export function statusView(run: ReconciliationRun): StatusView {
  const base = STATUS[run.status] ?? { label: run.status, tone: "neutral" as const, help: "" };
  const diff = differenceOf(run);
  if (run.status === "reconciled" && diff !== null && diff !== 0) {
    const tolerance = run.rounding_tolerance_cents;
    return {
      label: "Reconciled within rounding",
      tone: "neutral",
      help: `Each payment's coin amount is rounded to the zatoshi, so up to ${tolerance ?? run.lines + 1} cents can differ. This run differs by ${Math.abs(diff)} ${Math.abs(diff) === 1 ? "cent" : "cents"}.`,
    };
  }
  return base;
}

/** Order runs newest first: by the funding record's height, else by the latest payment. */
export function sortRuns(r: BooksResult): ReconciliationRun[] {
  const heightOf = (run: ReconciliationRun) => {
    const record = r.run_records?.find((x) => x.run_id === run.run_id);
    if (record?.height) return record.height;
    const lines = r.lines.filter((l) => l.run_id === run.run_id);
    return Math.max(0, ...lines.map((l) => l.height ?? Number.MAX_SAFE_INTEGER));
  };
  return [...r.runs].sort((a, b) => heightOf(b) - heightOf(a) || b.period.localeCompare(a.period));
}

/** The day a run was paid: its latest mined payment, else its funding record. */
export function paidDateOf(r: BooksResult, runId: string): string | null {
  const dates = r.lines
    .filter((l) => l.run_id === runId)
    .map((l) => l.block_time ?? l.date)
    .filter(Boolean)
    .sort();
  if (dates.length) return dates[dates.length - 1];
  return r.run_records?.find((x) => x.run_id === runId)?.date ?? null;
}

export function runName(period: string, runId: string): string {
  return `${formatPeriodLabel(period)} · ${runId.slice(0, 8)}`;
}

/* ---------- Totals ---------- */

export interface BooksTotals {
  funded: number;
  paid: number;
  variance: number;
  explained: number;
  unexplained: number;
  /** Parts of `unexplained`, each in cents. */
  rounding: number;
  unexplainedRuns: number;
  incompleteRuns: number;
  /** Paid by runs that have no funding record (a negative contribution to unexplained). */
  unrecorded: number;
  zecAcquired: number;
  paidZat: number;
  feesZat: number;
  unspentZat: number;
  payments: number;
}

export function totalsOf(r: BooksResult): BooksTotals {
  const sum = (f: (run: ReconciliationRun) => number) => r.runs.reduce((acc, run) => acc + f(run), 0);
  const diffWhere = (status: ReconciliationStatus) =>
    sum((run) => (run.status === status ? (differenceOf(run) ?? 0) : 0));
  const explained = sum((run) => run.explained_usd_cents ?? 0);
  const variance = r.totals.variance_usd_cents;
  return {
    funded: r.totals.funded_usd_cents,
    paid: r.totals.paid_usd_cents,
    variance,
    explained,
    unexplained: variance - explained,
    rounding: diffWhere("reconciled"),
    unexplainedRuns: diffWhere("variance_unexplained"),
    incompleteRuns: diffWhere("incomplete"),
    unrecorded: sum((run) => (run.funded_usd_cents === null ? run.paid_usd_cents : 0)),
    zecAcquired: sum((run) => run.zec_acquired_zat ?? 0),
    paidZat: r.totals.paid_zat,
    feesZat: sum((run) => run.network_fees_zat ?? 0),
    unspentZat: sum((run) => run.unspent_zat ?? 0),
    payments: r.totals.count,
  };
}

/* ---------- Exceptions ---------- */

export interface ExceptionGroups {
  noFunding: ReconciliationRun[];
  unexplained: ReconciliationRun[];
  incomplete: ReconciliationRun[];
  unlabelled: BooksUnlabelled[];
  total: number;
}

export function exceptionsOf(r: BooksResult): ExceptionGroups {
  const noFunding = r.runs.filter((run) => run.status === "missing_funding_record");
  const unexplained = r.runs.filter((run) => run.status === "variance_unexplained");
  const incomplete = r.runs.filter((run) => run.status === "incomplete");
  const unlabelled = r.unlabelled;
  return {
    noFunding,
    unexplained,
    incomplete,
    unlabelled,
    total: noFunding.length + unexplained.length + incomplete.length + unlabelled.length,
  };
}

export const UNLABELLED_REASON: Record<string, { label: string; detail: string }> = {
  no_memo: {
    label: "No memo",
    detail: "Moved without a note, such as a faucet deposit or a manual transfer.",
  },
  unknown_prefix: {
    label: "Not a Payslip memo",
    detail: "Carries a note, but not one Payslip wrote.",
  },
  malformed: {
    label: "Unreadable Payslip memo",
    detail: "Starts like a Payslip memo but its fields could not be read.",
  },
  non_text: {
    label: "Binary memo",
    detail: "The memo holds data, not text.",
  },
};

/* ---------- Ledger ---------- */

export type LedgerLine = ReconciliationLine & { pending: boolean };

export function ledgerOf(r: BooksResult): LedgerLine[] {
  const mined = r.lines.map((l) => ({ ...l, pending: false }));
  const pending = (r.pending ?? []).map((l) => ({ ...l, pending: true }));
  const time = (l: LedgerLine) => l.block_time ?? l.date ?? "";
  return [
    ...pending.sort((a, b) => time(b).localeCompare(time(a))),
    ...mined.sort((a, b) => time(b).localeCompare(time(a)) || (b.height ?? 0) - (a.height ?? 0)),
  ];
}

/* ---------- Periods ---------- */

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function todayIso(now = new Date()): string {
  return iso(now);
}

function endOfMonth(isoDate: string): string {
  const [y, m] = isoDate.split("-").map(Number);
  return iso(new Date(Date.UTC(y, m, 0)));
}

/**
 * The period of a run, as the books need it: from the start of its payroll period to the day it
 * was paid (payments for a month are usually mined after the month ends), capped at today.
 */
export function runPeriod(
  periodStart: string,
  periodEnd: string,
  paidOn: string | null,
  now = new Date(),
): BooksPeriod {
  const today = todayIso(now);
  const paid = paidOn ? paidOn.slice(0, 10) : null;
  let to = paid && paid > periodEnd ? paid : periodEnd;
  if (to > today) to = today;
  const from = periodStart > to ? to : periodStart;
  return { from, to };
}

/** "2026-09" -> 1 Sep to 30 Sep 2026. */
export function labelToRange(label: string): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m) return null;
  const start = `${m[1]}-${m[2]}-01`;
  return { start, end: endOfMonth(start) };
}

export function isValidPeriod(p: BooksPeriod): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.from) || !/^\d{4}-\d{2}-\d{2}$/.test(p.to) || p.from > p.to) return false;
  const days = (Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / 86_400_000;
  return days <= 366;
}

/** "1 Sep to 5 Oct 2026", "1 to 30 Sep 2026", "5 Oct 2026". */
export function shortRange(p: BooksPeriod): string {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [fy, fm, fd] = p.from.split("-").map(Number);
  const [ty, tm, td] = p.to.split("-").map(Number);
  if (p.from === p.to) return `${td} ${MONTHS[tm - 1]} ${ty}`;
  if (fy === ty && fm === tm) return `${fd} to ${td} ${MONTHS[tm - 1]} ${ty}`;
  if (fy === ty) return `${fd} ${MONTHS[fm - 1]} to ${td} ${MONTHS[tm - 1]} ${ty}`;
  return `${fd} ${MONTHS[fm - 1]} ${fy} to ${td} ${MONTHS[tm - 1]} ${ty}`;
}

export function presetPeriods(now = new Date()): { id: string; label: string; period: BooksPeriod }[] {
  const today = todayIso(now);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const firstThis = iso(new Date(Date.UTC(y, m, 1)));
  const firstPrev = iso(new Date(Date.UTC(y, m - 1, 1)));
  const lastPrev = iso(new Date(Date.UTC(y, m, 0)));
  const ninety = iso(new Date(now.getTime() - 89 * 86_400_000));
  return [
    { id: "this-month", label: "This month", period: { from: firstThis, to: today } },
    { id: "last-month", label: "Last month", period: { from: firstPrev, to: lastPrev } },
    { id: "90d", label: "Last 90 days", period: { from: ninety, to: today } },
    { id: "ytd", label: "Year to date", period: { from: `${y}-01-01`, to: today } },
  ];
}

/** A wide window used to find the latest run when the service cannot list runs. */
export function lookbackPeriod(now = new Date()): BooksPeriod {
  return { from: iso(new Date(now.getTime() - 365 * 86_400_000)), to: todayIso(now) };
}

/** The latest run visible in a reconciliation, with its period, for the default period. */
export function latestRunIn(r: BooksResult): { runId: string; label: string; period: BooksPeriod } | null {
  const runs = sortRuns(r);
  const run = runs[0];
  if (!run) return null;
  const known = r.run_index?.[run.run_id];
  const range = known
    ? { start: known.period_start, end: known.period_end }
    : (labelToRange(run.period) ?? { start: r.period.from, end: r.period.to });
  return {
    runId: run.run_id,
    label: run.period,
    period: runPeriod(range.start, range.end, paidDateOf(r, run.run_id)),
  };
}
