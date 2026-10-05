"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Contractor, Run } from "@/lib/api";
import { parseUsdToCents } from "@/lib/format";
import { isValidRange, previousMonth } from "@/lib/period";
import { monthRange, periodTitle } from "../run-meta";

/*
  The Amounts and Review steps work on a draft that lives in the browser until the payer
  approves; approving creates the run. The draft is kept in sessionStorage so a reload on the
  Review step comes back to the same amounts and the same idempotency key (a second approval
  after a reload returns the run the first one created instead of making another).
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
  /** Idempotency key for POST /api/runs, generated once per draft. */
  key: string;
  /** The run the amounts were copied from. */
  source: { id: string; label: string } | null;
  /** Set when the payer continued from Amounts, so Review only ever shows amounts they saw. */
  ready?: boolean;
}

/** crypto.randomUUID needs a secure context; fall back to getRandomValues elsewhere. */
function newIdempotencyKey(): string {
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

function freshDraft(contractors: Contractor[], source: Run | undefined): Draft {
  const prev = previousMonth();
  return {
    v: 1,
    month: prev.from.slice(0, 7),
    from: prev.from,
    to: prev.to,
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

/** The run whose amounts prefill a new run: the one named in ?repeat=, else the newest with lines. */
export function sourceRun(runs: Run[] | undefined, repeatId: string | null): Run | undefined {
  const all = runs ?? [];
  return (
    all.find((r) => r.id === repeatId) ??
    [...all].sort((a, b) => b.created_at.localeCompare(a.created_at)).find((r) => r.lines.length > 0)
  );
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
      setDraftState(freshDraft(contractors, source));
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

export interface DraftCheck {
  included: Contractor[];
  /** One problem per line, and which field it is in. */
  lineErrors: Record<string, { field: "amount" | "invoice"; message: string }>;
  periodError: string | null;
  noneError: string | null;
  totalCents: number;
  valid: boolean;
}

/** The service's ceiling for one line (MAX_LINE_CENTS): $10,000,000. */
const MAX_LINE_CENTS = 1_000_000_000;
/** What the memo can carry: printable ASCII without the "|" separator (memo.rs). */
const INVOICE_CHARS = /^[\x20-\x7e]*$/;

/**
 * The original new-run form's checks, plus the service's own rules for the invoice reference
 * (required, plain characters, no "|") and the per-line ceiling, so the payer sees them here
 * instead of as an error after approving.
 */
export function useDraftCheck(draft: Draft | null, contractors: Contractor[]): DraftCheck {
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
      else if (cents === null)
        lineErrors[c.id] = amountError("Use a number with up to 2 decimals, like 4800 or 4800.50.");
      else if (cents <= 0) lineErrors[c.id] = amountError("The amount must be more than zero.");
      else if (cents > MAX_LINE_CENTS) lineErrors[c.id] = amountError("Keep each amount to $10,000,000 or less.");
      else if (!invoice)
        lineErrors[c.id] = invoiceError("Add an invoice reference. It is sealed in the payment's memo.");
      else if (invoice.length > INVOICE_MAX)
        lineErrors[c.id] = invoiceError(`Keep the invoice reference to ${INVOICE_MAX} characters.`);
      else if (!INVOICE_CHARS.test(invoice) || invoice.includes("|"))
        lineErrors[c.id] = invoiceError("Use plain letters, digits, spaces and - / . # in the invoice reference.");
    }
    let periodError: string | null = null;
    if (draft && !isValidRange(draft.from, draft.to))
      periodError = "The period must start on or before the day it ends.";
    else if (draft && Date.parse(draft.to) - Date.parse(draft.from) > 366 * 86_400_000)
      periodError = "Keep the period to a year or less.";
    const noneError = included.length === 0 ? "Include at least one contractor." : null;
    const totalCents = included.reduce(
      (sum, c) => sum + Math.max(0, parseUsdToCents(draft!.lines[c.id].amount) ?? 0),
      0,
    );
    const valid = !!draft && !periodError && !noneError && Object.keys(lineErrors).length === 0;
    return { included, lineErrors, periodError, noneError, totalCents, valid };
  }, [draft, contractors]);
}
