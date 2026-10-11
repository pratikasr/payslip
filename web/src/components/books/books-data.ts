/*
  Types and pure helpers for the accountant workspace. The service returns a few fields the shared
  client does not type yet (the funding records per run, the run index, the account on lines and
  unlabelled rows, the allocation counts per run); they are typed here, as optional, so nothing
  breaks if a deployment omits them.
*/

import type {
  FundingLine,
  Network,
  Reconciliation,
  ReconciliationAccount,
  ReconciliationLine,
  ReconciliationRun,
  RunRef,
  UnlabelledLine,
} from "@/lib/api";
import type { KeyClassification } from "@/lib/keys";
import { classifyKey } from "@/lib/keys";
import { formatPeriodLabel } from "@/lib/format";
import { keyFingerprint } from "@/components/books/fingerprint";

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

/** A pay line with the account fingerprint the service puts on every line. */
export type BooksLine = ReconciliationLine & {
  account?: string;
  /** Where the name shown came from: the service's own records, or the imported key file. */
  labelSource?: "service" | "key file";
};

/**
 * A run as the service reconciles it. Newer services count the run's allocation outputs (what
 * the Treasury key shows it sent) and how many went to accounts whose keys were not supplied.
 * The count's name changed during development, so both spellings are read.
 */
export type BooksRun = Omit<ReconciliationRun, "status"> & {
  status: string;
  allocations?: number;
  allocated_zat?: number;
  missing_accounts?: number;
  missing_key_lines?: number;
  missing_zat?: number;
  unpaid_accounts?: number;
  unpaid_lines?: number;
  funding_date?: string | null;
};

export type BooksResult = Omit<Reconciliation, "unlabelled" | "funding" | "runs" | "lines" | "pending"> & {
  runs: BooksRun[];
  lines: BooksLine[];
  pending?: BooksLine[];
  unlabelled: BooksUnlabelled[];
  funding?: BooksFunding[];
  run_records?: RunFundingRecord[];
  run_index?: Record<string, RunRef>;
  /** The lowest block any key was scanned from (newer services). */
  scanned_from_height?: number | null;
};

export interface BooksPeriod {
  from: string;
  to: string;
}

export type KeyRole = "treasury" | "contractor" | "unknown";

/** One viewing key held for this tab. The label, role and birthday are kept here and never sent. */
export interface BookKey {
  ufvk: string;
  label: string | null;
  role: KeyRole | null;
  /** The block its account was created at, from the key file: where a scan can start. */
  birthday?: number | null;
  accountIndex?: number | null;
}

export interface StagedKey {
  raw: string;
  label: string | null;
  role: KeyRole | null;
  birthday?: number | null;
  accountIndex?: number | null;
  result: KeyClassification;
}

/* ---------- Keys ---------- */

const height = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v > 0 ? v : typeof v === "string" && /^\d+$/.test(v) ? +v : null;

/**
 * Parse the company's key file (the JSON from GET /api/viewing-keys, also what Payslip access
 * exports, and the judge kit). Keeps each key's label, role and birthday: the file's
 * `birthday_height`, or the key's own when it has one.
 */
export function parseKeyFile(text: string): { keys: StagedKey[]; network: string; birthday: number | null } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON. Use the .json key file the company exported.");
  }
  if (typeof data !== "object" || data === null || !Array.isArray((data as { keys?: unknown }).keys)) {
    throw new Error("This file is not a Payslip viewing key file. Ask the company for the file from Payslip access.");
  }
  const d = data as { network?: unknown; birthday_height?: unknown; keys: unknown[] };
  const fileBirthday = height(d.birthday_height);
  const keys = d.keys.flatMap((k): StagedKey[] => {
    if (typeof k !== "object" || k === null) return [];
    const entry = k as {
      ufvk?: unknown;
      label?: unknown;
      role?: unknown;
      birthday_height?: unknown;
      account_index?: unknown;
    };
    if (typeof entry.ufvk !== "string") return [];
    const role = entry.role === "treasury" || entry.role === "contractor" ? entry.role : null;
    return [
      {
        raw: entry.ufvk,
        label: typeof entry.label === "string" && entry.label.trim() ? entry.label.trim() : null,
        role,
        birthday: height(entry.birthday_height) ?? fileBirthday,
        accountIndex: typeof entry.account_index === "number" ? entry.account_index : null,
        result: classifyKey(entry.ufvk),
      },
    ];
  });
  if (keys.length === 0) throw new Error("The file has no viewing keys in it. Ask the company to export it again.");
  return { keys, network: typeof d.network === "string" ? d.network : "", birthday: fileBirthday };
}

/** Keys that can be sent: full viewing keys for the service's network. */
export function usableKeys(staged: StagedKey[], network?: Network): BookKey[] {
  return staged.flatMap((k) =>
    k.result.kind === "ufvk" && (!network || k.result.network === network)
      ? [
          {
            ufvk: k.result.value,
            label: k.label,
            role: k.role,
            birthday: k.birthday ?? null,
            accountIndex: k.accountIndex ?? null,
          },
        ]
      : [],
  );
}

/** Two keys are the same when their text matches, or when both have the same fingerprint. */
function sameKey(a: string, b: string): boolean {
  if (a === b) return true;
  const fa = keyFingerprint(a);
  return fa !== null && fa === keyFingerprint(b);
}

export function mergeKeys(existing: BookKey[], added: BookKey[]): BookKey[] {
  const out = [...existing];
  for (const k of added) {
    const at = out.findIndex((e) => sameKey(e.ufvk, k.ufvk));
    if (at < 0) {
      out.push(k);
      continue;
    }
    const e = out[at];
    out[at] = {
      ...e,
      label: e.label ?? k.label,
      role: e.role ?? k.role,
      birthday: e.birthday && k.birthday ? Math.min(e.birthday, k.birthday) : (e.birthday ?? k.birthday ?? null),
      accountIndex: e.accountIndex ?? k.accountIndex ?? null,
    };
  }
  return out;
}

/** How many of `added` are not in `existing` yet. */
export function countNew(existing: BookKey[], added: BookKey[]): number {
  return added.filter(
    (k, i) => !existing.some((e) => sameKey(e.ufvk, k.ufvk)) && added.findIndex((x) => sameKey(x.ufvk, k.ufvk)) === i,
  ).length;
}

/**
 * Where a scan of these keys should start, sent as `birthday_height`: the earliest birthday, but
 * only when every key has one. A key with no known birthday (pasted on its own) is left to the
 * service's default, which starts early enough for any Payslip payment.
 */
export function scanBirthday(keys: BookKey[]): number | null {
  if (keys.length === 0 || keys.some((k) => !k.birthday)) return null;
  return Math.min(...keys.map((k) => k.birthday as number));
}

/**
 * Which account the service returned for each key. Keys in the canonical form are matched by
 * fingerprint. The rest (another encoding) are matched by elimination, in order, when exactly as
 * many accounts are left over as keys; when every account is taken, a leftover key is the same
 * account as another key in a different encoding (`duplicate`).
 */
export function alignKeys(
  keys: BookKey[],
  accounts: ReconciliationAccount[],
): { account: ReconciliationAccount | null; duplicate: boolean }[] {
  const byFp = new Map(accounts.map((a) => [a.fingerprint, a]));
  const out = keys.map((k) => {
    const fp = keyFingerprint(k.ufvk);
    return { account: (fp && byFp.get(fp)) || null, duplicate: false };
  });
  // The same account twice (two copies of one key in the canonical form): the later one is extra.
  const seen = new Set<string>();
  for (const o of out) {
    if (!o.account) continue;
    if (seen.has(o.account.fingerprint)) o.duplicate = true;
    seen.add(o.account.fingerprint);
  }
  const free = accounts.filter((a) => !seen.has(a.fingerprint));
  const left = out.map((o, i) => (o.account ? -1 : i)).filter((i) => i >= 0);
  if (accounts.length > 0 && free.length === left.length) left.forEach((ki, j) => (out[ki].account = free[j]));
  else if (accounts.length > 0 && free.length === 0) left.forEach((ki) => (out[ki].duplicate = true));
  return out;
}

export type DescribedKey = BookKey & { duplicate: boolean };

/** Labels and roles for display: the key file's first, then what the service knows. */
export function describeKeys(keys: BookKey[], result: BooksResult | null): DescribedKey[] {
  const aligned = alignKeys(keys, result?.accounts ?? []);
  return keys.map((k, i) => {
    const a = aligned[i].account;
    return {
      ...k,
      label: k.label ?? a?.label ?? null,
      role: k.role ?? a?.role ?? null,
      accountIndex: k.accountIndex ?? a?.account_index ?? null,
      duplicate: aligned[i].duplicate,
    };
  });
}

/**
 * The reconciliation with names filled in from the key file, joined by fingerprint: every line,
 * pending line and unlabelled row, and the accounts. A statements-only service knows no names, so
 * without this every payment reads "Unknown account".
 */
export function labelResult(r: BooksResult, keys: BookKey[]): BooksResult {
  const described = describeKeys(keys, r);
  const aligned = alignKeys(keys, r.accounts);
  const byFp = new Map<string, { label: string | null; role: KeyRole | null; index: number | null }>();
  for (const a of r.accounts)
    byFp.set(a.fingerprint, { label: a.label, role: a.role === "unknown" ? null : a.role, index: a.account_index });
  aligned.forEach(({ account }, i) => {
    if (!account) return;
    const k = described[i];
    const cur = byFp.get(account.fingerprint);
    byFp.set(account.fingerprint, {
      label: keys[i].label ?? cur?.label ?? null,
      role: (k.role === "unknown" ? null : k.role) ?? cur?.role ?? null,
      index: cur?.index ?? k.accountIndex ?? null,
    });
  });
  const line = (l: BooksLine): BooksLine => {
    const info = l.account ? byFp.get(l.account) : undefined;
    if (!info) return { ...l, labelSource: l.label ? "service" : undefined };
    const label = info.label ?? l.label;
    return {
      ...l,
      label,
      account_index: l.account_index ?? info.index,
      labelSource: label && label !== l.label ? "key file" : l.label ? "service" : undefined,
    };
  };
  return {
    ...r,
    accounts: r.accounts.map((a) => {
      const info = byFp.get(a.fingerprint);
      return {
        ...a,
        label: info?.label ?? a.label,
        role: info?.role ?? a.role,
        account_index: a.account_index ?? info?.index ?? null,
      };
    }),
    lines: r.lines.map(line),
    pending: r.pending?.map(line),
    unlabelled: r.unlabelled.map((u) => {
      const info = u.account ? byFp.get(u.account) : undefined;
      return info?.label ? { ...u, label: u.label ?? info.label } : u;
    }),
  };
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
export function differenceOf(run: BooksRun): number | null {
  if (run.difference_usd_cents !== undefined) return run.difference_usd_cents;
  if (run.variance_usd_cents === null || run.explained_usd_cents === null) return null;
  return run.variance_usd_cents - run.explained_usd_cents;
}

/** Allocations to accounts whose keys are not in the set, when the service counts them. */
export function missingAccountsOf(run: BooksRun): number | null {
  const n = run.missing_accounts ?? run.missing_key_lines;
  return typeof n === "number" ? n : null;
}

/** Funded accounts that show no payment for the run, when the service counts them. */
export function unpaidAccountsOf(run: BooksRun): number | null {
  const n = run.unpaid_accounts ?? run.unpaid_lines;
  return typeof n === "number" ? n : null;
}

export type StatusTone = "neutral" | "warning" | "danger";

export interface StatusView {
  label: string;
  tone: StatusTone;
  help: string;
}

const STATUS: Record<string, StatusView> = {
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
    help: "Some payments in this run are not mined yet.",
  },
  incomplete_keys: {
    label: "Keys missing",
    tone: "warning",
    help: "The Treasury paid accounts whose viewing keys are not loaded, so their payments cannot be seen or checked. Load every contractor's key.",
  },
  unpaid: {
    label: "Unpaid",
    tone: "danger",
    help: "An account this run funded shows no payment for it. Ask the company about the missing payment.",
  },
};

/** Statuses Books knows; anything else a newer service sends is listed as an exception. */
const KNOWN = new Set(Object.keys(STATUS));

/** The label a run's status shows, with "within rounding" when a reconciled run's cents differ. */
export function statusView(run: BooksRun): StatusView {
  const base = STATUS[run.status] ?? {
    label: run.status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
    tone: "warning" as const,
    help: "A status this version of Books does not describe yet. Check the run with the company.",
  };
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

/** The last day of a "2026-09" period label, or the label itself when it is not one. */
function periodEndOf(r: BooksResult, run: BooksRun): string {
  return r.run_index?.[run.run_id]?.period_end ?? labelToRange(run.period)?.end ?? run.period;
}

function periodStartOf(r: BooksResult, run: BooksRun): string {
  return r.run_index?.[run.run_id]?.period_start ?? labelToRange(run.period)?.start ?? run.period;
}

/**
 * Latest pay period first (a run created today for July is not newer than September's), then by
 * the funding record's height, else by the latest payment.
 */
export function sortRuns(r: BooksResult): BooksRun[] {
  const heightOf = (run: BooksRun) => {
    const record = r.run_records?.find((x) => x.run_id === run.run_id);
    if (record?.height) return record.height;
    const lines = r.lines.filter((l) => l.run_id === run.run_id);
    return Math.max(0, ...lines.map((l) => l.height ?? Number.MAX_SAFE_INTEGER));
  };
  return [...r.runs].sort(
    (a, b) =>
      periodEndOf(r, b).localeCompare(periodEndOf(r, a)) ||
      periodStartOf(r, b).localeCompare(periodStartOf(r, a)) ||
      heightOf(b) - heightOf(a),
  );
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
  return `${formatPeriodLabel(period)}, run ${runId.slice(0, 8)}`;
}

/** True when any run in the result has a funding record: what was funded can be read. */
export function hasFundingRecords(r: BooksResult): boolean {
  return (r.run_records?.length ?? 0) > 0 || r.runs.some((run) => run.funded_usd_cents !== null);
}

/** True when a key in the set is the Treasury's, by the key file or by the service. */
export function hasTreasuryKey(r: BooksResult, keys: BookKey[]): boolean {
  return (
    r.treasury_key_present === true ||
    keys.some((k) => k.role === "treasury") ||
    r.accounts.some((a) => a.role === "treasury")
  );
}

/* ---------- Totals ---------- */

export interface BooksTotals {
  funded: number;
  /** False when no run has a funding record: funded, variance and explained cannot be read. */
  fundingKnown: boolean;
  paid: number;
  variance: number;
  explained: number;
  unexplained: number;
  /** Parts of `unexplained`, each in cents. */
  rounding: number;
  unexplainedRuns: number;
  incompleteRuns: number;
  missingKeyRuns: number;
  unpaidRuns: number;
  /** Paid by runs that have no funding record (a negative contribution to unexplained). */
  unrecorded: number;
  zecAcquired: number;
  paidZat: number;
  feesZat: number;
  unspentZat: number;
  payments: number;
}

export function totalsOf(r: BooksResult): BooksTotals {
  const sum = (f: (run: BooksRun) => number) => r.runs.reduce((acc, run) => acc + f(run), 0);
  const diffWhere = (status: string) => sum((run) => (run.status === status ? (differenceOf(run) ?? 0) : 0));
  const explained = sum((run) => run.explained_usd_cents ?? 0);
  const variance = r.totals.variance_usd_cents;
  return {
    funded: r.totals.funded_usd_cents,
    fundingKnown: hasFundingRecords(r),
    paid: r.totals.paid_usd_cents,
    variance,
    explained,
    unexplained: variance - explained,
    rounding: diffWhere("reconciled"),
    unexplainedRuns: diffWhere("variance_unexplained"),
    incompleteRuns: diffWhere("incomplete"),
    missingKeyRuns: diffWhere("incomplete_keys"),
    unpaidRuns: diffWhere("unpaid"),
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
  noFunding: BooksRun[];
  unexplained: BooksRun[];
  incomplete: BooksRun[];
  /** The Treasury paid accounts whose keys are not loaded (status incomplete_keys). */
  missingKeys: BooksRun[];
  /** A funded account shows no payment (status unpaid). */
  unpaid: BooksRun[];
  /** Statuses this version of Books does not know: never dropped, never called reconciled. */
  other: BooksRun[];
  unlabelled: BooksUnlabelled[];
  total: number;
}

export function exceptionsOf(r: BooksResult): ExceptionGroups {
  const by = (status: string) => r.runs.filter((run) => run.status === status);
  const noFunding = by("missing_funding_record");
  const unexplained = by("variance_unexplained");
  const incomplete = by("incomplete");
  const missingKeys = by("incomplete_keys");
  const unpaid = by("unpaid");
  const other = r.runs.filter((run) => !KNOWN.has(run.status));
  const unlabelled = r.unlabelled;
  return {
    noFunding,
    unexplained,
    incomplete,
    missingKeys,
    unpaid,
    other,
    unlabelled,
    total:
      noFunding.length +
      unexplained.length +
      incomplete.length +
      missingKeys.length +
      unpaid.length +
      other.length +
      unlabelled.length,
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
  unexpected_direction: {
    label: "Unexpected direction",
    detail: "A Payslip memo moving the wrong way for its account, such as a pay line sent from a contractor.",
  },
};

/* ---------- Ledger ---------- */

export type LedgerLine = BooksLine & { pending: boolean };

export function ledgerOf(r: BooksResult): LedgerLine[] {
  const mined = r.lines.map((l) => ({ ...l, pending: false }));
  const pending = (r.pending ?? []).map((l) => ({ ...l, pending: true }));
  const time = (l: LedgerLine) => l.block_time ?? l.date ?? "";
  return [
    ...pending.sort((a, b) => time(b).localeCompare(time(a))),
    ...mined.sort((a, b) => time(b).localeCompare(time(a)) || (b.height ?? 0) - (a.height ?? 0)),
  ];
}

/** A stable key for the account a line belongs to: its fingerprint, else its number or name. */
export function accountKeyOf(l: BooksLine): string {
  if (l.account) return `f${l.account}`;
  if (l.account_index !== null && l.account_index !== undefined) return `a${l.account_index}`;
  return `l${l.label ?? ""}`;
}

/** Who a line was paid to, for display: its name, its account number, or its fingerprint. */
export function payeeOf(l: BooksLine): string {
  if (l.label) return l.label;
  if (l.account_index !== null && l.account_index !== undefined) return `Account ${l.account_index}`;
  return l.account ? `Unlabelled account ${l.account.slice(0, 8)}` : "Unlabelled account";
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
