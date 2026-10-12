"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Contractor, NewRun, PaymentRequest, Run } from "@/lib/api";
import { parseUsdToCents, usdAmountProblem } from "@/lib/format";
import { isValidRange } from "@/lib/period";
import { latestPeriodFirst, nextPayPeriod, overlappingRuns, type PayPeriod } from "@/lib/payroll";
import { joinedInvoiceRef, requestsByContractor } from "@/components/requests/request-meta";
import { monthRange, periodTitle } from "../run-meta";

/*
  The Amounts and Review steps work on a draft that lives in the browser until the payer
  approves; approving creates the run. The draft is kept in sessionStorage so a reload on the
  Review step comes back to the same amounts.

  The idempotency key is the draft's random salt plus a fingerprint of exactly what is being
  approved (period and every line). Approving the same amounts again, after a reload or a lost
  response, sends the same key and gets the run the first approval created. Changing the period
  or any line makes a new key, so an edited draft can never come back as the earlier run.
*/

export const INVOICE_MAX = 64;
const STORAGE_KEY = "payslip:new-run-draft";

export interface LineDraft {
  include: boolean;
  amount: string;
  invoice: string;
}

export interface Draft {
  v: 1;
  /** "YYYY-MM" for a calendar month, or "custom" for a date range. */
  month: string;
  from: string;
  to: string;
  lines: Record<string, LineDraft>;
  /** Random salt for the idempotency key, made once per draft (see idempotencyKey). */
  key: string;
  /** The run the amounts were copied from. */
  source: { id: string; label: string } | null;
  /** Set when the payer continued from Amounts, so Review only ever shows amounts they saw. */
  ready?: boolean;
  /**
   * The runs the payer confirmed this extra run alongside (overlapKey of them). When the
   * overlapping runs change, so does the key, and the payer confirms again.
   */
  overlapAck?: string;
  /** Approved payment requests already prefilled into lines (ADR-028), so each is applied once. */
  requests?: string[];
}

/** crypto.randomUUID needs a secure context; fall back to getRandomValues elsewhere. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** "4800" -> "4,800.00" once the amount is valid; anything else is left as typed. */
export function tidyAmount(value: string): string {
  const cents = parseUsdToCents(value);
  if (cents === null || cents <= 0) return value;
  const whole = Math.floor(cents / 100).toLocaleString("en-US");
  return `${whole}.${String(cents % 100).padStart(2, "0")}`;
}

function amountsFrom(run: Run | undefined, contractors: Contractor[]): Record<string, LineDraft> {
  const byContractor = new Map((run?.lines ?? []).map((l) => [l.contractor_id, l]));
  return Object.fromEntries(
    contractors.map((c) => {
      const l = byContractor.get(c.id);
      if (!run) return [c.id, { include: true, amount: "", invoice: "" }];
      return [c.id, { include: !!l, amount: l ? tidyAmount((l.amount_usd_cents / 100).toFixed(2)) : "", invoice: "" }];
    }),
  );
}

/** "YYYY-MM" when the period is one whole calendar month, else "custom". */
export function monthKey(period: PayPeriod): string {
  const r = monthRange(Number(period.from.slice(0, 4)), Number(period.from.slice(5, 7)) - 1);
  return r.from === period.from && r.to === period.to ? period.from.slice(0, 7) : "custom";
}

/**
 * A new draft for the next unpaid period (the period after the latest paid payroll, the one Home
 * names), with the amounts of `source`.
 */
function freshDraft(contractors: Contractor[], source: Run | undefined, period: PayPeriod): Draft {
  return {
    v: 1,
    month: monthKey(period),
    from: period.from,
    to: period.to,
    lines: amountsFrom(source, contractors),
    key: newIdempotencyKey(),
    source: source ? { id: source.id, label: periodTitle(source.period_start, source.period_end) } : null,
  };
}

function readStored(): Draft | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Draft;
    return d && d.v === 1 && typeof d.key === "string" && d.lines ? d : null;
  } catch {
    return null;
  }
}

function writeStored(d: Draft | null) {
  try {
    if (d) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(d));
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage can be blocked (private windows); the draft then lives only in memory.
  }
}

/**
 * The run whose amounts prefill a new run: the one named in ?repeat=, else the latest paid
 * payroll by pay period, else the latest run with lines (never the latest created).
 */
export function sourceRun(runs: Run[] | undefined, repeatId: string | null): Run | undefined {
  const all = latestPeriodFirst((runs ?? []).filter((r) => r.lines.length > 0 && r.status !== "cancelled"));
  return all.find((r) => r.id === repeatId) ?? all.find((r) => r.status === "paid") ?? all[0];
}

/** Forgets the draft kept in this tab, so the next Run payroll starts from a clean sheet. */
export function clearStoredDraft(): void {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(STORAGE_KEY);
}

export function useDraft(contractors: Contractor[] | undefined, runs: Run[] | undefined, repeatId: string | null) {
  const [draft, setDraftState] = useState<Draft | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !contractors || !runs) return;
    started.current = true;
    const source = sourceRun(runs, repeatId);
    const stored = readStored();
    if (stored && (!repeatId || stored.source?.id === repeatId)) {
      // Keep what was typed; add anyone new and drop anyone archived since.
      const lines = Object.fromEntries(
        contractors.map((c) => [c.id, stored.lines[c.id] ?? { include: false, amount: "", invoice: "" }]),
      );
      setDraftState({ ...stored, lines });
    } else {
      setDraftState(freshDraft(contractors, source, nextPayPeriod(runs)));
    }
  }, [contractors, runs, repeatId]);

  useEffect(() => {
    if (draft) writeStored(draft);
  }, [draft]);

  const setDraft = useCallback((update: (d: Draft) => Draft) => {
    setDraftState((prev) => (prev ? update(prev) : prev));
  }, []);

  const clearStored = useCallback(() => writeStored(null), []);

  return { draft, setDraft, clearStored };
}

/**
 * Prefills a line for each approved request of the draft's period that has not been offered yet:
 * the request's amount and invoice reference, included. A contractor with several requests gets
 * one line for their total. Requests already applied are left alone, so the payer's edits stay.
 */
export function applyRequests(d: Draft, offered: PaymentRequest[]): Draft {
  const applied = new Set(d.requests ?? []);
  const fresh = offered.filter((r) => !applied.has(r.id));
  if (fresh.length === 0) return d;
  const lines = { ...d.lines };
  for (const [contractorId, rs] of requestsByContractor(offered)) {
    if (!rs.some((r) => !applied.has(r.id))) continue;
    const cents = rs.reduce((sum, r) => sum + r.amount_usd_cents, 0);
    lines[contractorId] = {
      include: true,
      amount: tidyAmount((cents / 100).toFixed(2)),
      invoice: joinedInvoiceRef(rs.map((r) => r.invoice_ref)),
    };
  }
  return { ...d, lines, requests: [...applied, ...fresh.map((r) => r.id)] };
}

export function setMonth(d: Draft, key: string): Draft {
  if (key === "custom") return { ...d, month: "custom" };
  const [y, m] = key.split("-").map(Number);
  const r = monthRange(y, m - 1);
  return { ...d, month: key, from: r.from, to: r.to };
}

export function clearAmounts(d: Draft): Draft {
  return {
    ...d,
    source: null,
    lines: Object.fromEntries(Object.keys(d.lines).map((id) => [id, { include: true, amount: "", invoice: "" }])),
  };
}

export function copyAmounts(d: Draft, run: Run, contractors: Contractor[]): Draft {
  const fromRun = amountsFrom(run, contractors);
  return {
    ...d,
    source: { id: run.id, label: periodTitle(run.period_start, run.period_end) },
    lines: Object.fromEntries(
      Object.entries(fromRun).map(([id, l]) => [id, { ...l, invoice: d.lines[id]?.invoice ?? "" }]),
    ),
  };
}

/** The body POST /api/runs gets for this draft (without the key). */
export function runRequest(d: Draft, included: Contractor[]): Omit<NewRun, "idempotency_key"> {
  return {
    period_start: d.from,
    period_end: d.to,
    lines: included.map((c) => ({
      contractor_id: c.id,
      amount_usd_cents: parseUsdToCents(d.lines[c.id].amount) ?? 0,
      invoice_ref: d.lines[c.id].invoice.trim(),
    })),
  };
}

/** cyrb53: a small, stable 53-bit string hash (not for secrets; only to tell bodies apart). */
function hash53(text: string, seed: number): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * The idempotency key for approving `body`: the draft's salt and a fingerprint of the body
 * (period and lines, sorted by contractor). Same draft and same amounts: same key, so a retry
 * returns the run already made. Anything changed: a new key, so a new run.
 */
export function idempotencyKey(salt: string, body: Omit<NewRun, "idempotency_key">): string {
  const lines = [...body.lines]
    .sort((a, b) => a.contractor_id.localeCompare(b.contractor_id))
    .map((l) => [l.contractor_id, l.amount_usd_cents, l.invoice_ref]);
  const canonical = JSON.stringify([body.period_start, body.period_end, lines]);
  return `${salt}.${hash53(canonical, 1)}${hash53(canonical, 2)}`;
}

/**
 * Whether the run the service returned is the one the payer reviewed: same period, same people,
 * same amounts and invoice references. A different answer is never treated as approval.
 */
export function runMatches(run: Run, body: Omit<NewRun, "idempotency_key">): boolean {
  // A cancelled run is never the one just approved, whatever its amounts.
  if (run.status === "cancelled") return false;
  if (run.period_start !== body.period_start || run.period_end !== body.period_end) return false;
  if (run.lines.length !== body.lines.length) return false;
  const want = new Map(body.lines.map((l) => [l.contractor_id, l]));
  return run.lines.every((l) => {
    const w = want.get(l.contractor_id);
    return !!w && w.amount_usd_cents === l.amount_usd_cents && w.invoice_ref === l.invoice_ref.trim();
  });
}

/** Runs already covering any day of the draft's period (cancelled ones excepted). */
export function draftOverlaps(d: Draft | null, runs: Run[] | undefined): Run[] {
  if (!d || !runs || !isValidRange(d.from, d.to)) return [];
  return overlappingRuns(runs, { from: d.from, to: d.to });
}

/** A stable name for a set of overlapping runs, so a confirmation applies to exactly that set. */
export function overlapKey(runs: Run[]): string {
  return runs
    .map((r) => r.id)
    .sort()
    .join(",");
}

export interface DraftCheck {
  included: Contractor[];
  /** One problem per line, and which field it is in. */
  lineErrors: Record<string, { field: "amount" | "invoice"; message: string }>;
  periodError: string | null;
  /** Nobody ticked, or more people than one run can pay. */
  countError: string | null;
  /** Runs that already cover this period. */
  overlaps: Run[];
  /** True when there are overlaps the payer has not confirmed as an extra run. */
  overlapUnconfirmed: boolean;
  totalCents: number;
  valid: boolean;
}

/** The service's ceiling for one line (MAX_LINE_CENTS): $10,000,000. */
const MAX_LINE_CENTS = 1_000_000_000;
/** The service's ceiling for one run (MAX_LINES in api/runs.rs). */
export const MAX_LINES = 50;
/** What the memo can carry: printable ASCII without the "|" separator (memo.rs). */
const INVOICE_CHARS = /^[\x20-\x7e]*$/;

/**
 * The original new-run form's checks, plus the service's own rules for the invoice reference
 * (required, plain characters, no "|"), the per-line ceiling and the 50-line limit, so the payer
 * sees them here instead of as an error after approving. A period that another run already
 * covers needs the payer's confirmation (an extra run, such as a bonus) before going on.
 */
export function useDraftCheck(draft: Draft | null, contractors: Contractor[], runs?: Run[]): DraftCheck {
  return useMemo(() => {
    const included = draft ? contractors.filter((c) => draft.lines[c.id]?.include) : [];
    const lineErrors: DraftCheck["lineErrors"] = {};
    const amountError = (message: string) => ({ field: "amount" as const, message });
    const invoiceError = (message: string) => ({ field: "invoice" as const, message });
    for (const c of included) {
      const l = draft!.lines[c.id];
      const cents = parseUsdToCents(l.amount);
      const invoice = l.invoice.trim();
      if (!l.amount.trim()) lineErrors[c.id] = amountError("Enter an amount, or untick this contractor.");
      else if (cents === null) lineErrors[c.id] = amountError(usdAmountProblem(l.amount) ?? "Check this amount.");
      else if (cents <= 0) lineErrors[c.id] = amountError("The amount must be more than zero.");
      else if (cents > MAX_LINE_CENTS) lineErrors[c.id] = amountError("Keep each amount to $10,000,000 or less.");
      else if (!invoice)
        lineErrors[c.id] = invoiceError("Add an invoice reference. It is sealed in the payment's memo.");
      else if (invoice.length > INVOICE_MAX)
        lineErrors[c.id] = invoiceError(`Keep the invoice reference to ${INVOICE_MAX} characters.`);
      else if (!INVOICE_CHARS.test(invoice) || invoice.includes("|"))
        lineErrors[c.id] = invoiceError(
          "Use plain characters in the invoice reference: no |, no accented letters and no emoji.",
        );
    }
    let periodError: string | null = null;
    if (draft && !isValidRange(draft.from, draft.to))
      periodError = "The period must start on or before the day it ends.";
    else if (draft && Date.parse(draft.to) - Date.parse(draft.from) > 366 * 86_400_000)
      periodError = "Keep the period to a year or less.";
    const countError =
      included.length === 0
        ? "Include at least one contractor."
        : included.length > MAX_LINES
          ? `A run can pay at most ${MAX_LINES} people, and ${included.length} are ticked. Untick some and pay them in a second run.`
          : null;
    const totalCents = included.reduce(
      (sum, c) => sum + Math.max(0, parseUsdToCents(draft!.lines[c.id].amount) ?? 0),
      0,
    );
    const overlaps = periodError ? [] : draftOverlaps(draft, runs);
    const overlapUnconfirmed = overlaps.length > 0 && draft?.overlapAck !== overlapKey(overlaps);
    const valid = !!draft && !periodError && !countError && !overlapUnconfirmed && Object.keys(lineErrors).length === 0;
    return { included, lineErrors, periodError, countError, overlaps, overlapUnconfirmed, totalCents, valid };
  }, [draft, contractors, runs]);
}
