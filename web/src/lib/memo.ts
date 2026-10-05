/*
  Reads the Payslip memo sealed in a payment (service/src/memo.rs, ADR-008):
    PS1|<run_id>|<YYYY-MM>|<invoice_ref>|<usd_basis_cents>|<rate_e6>   a pay line
    PS1A|<run_id>                                                      an allocation
    PS1R|<run_id>|<YYYY-MM>|<funded_usd_cents>|<zec_acquired_zat>|<rate_e6>   a run's funding
  Anything else is returned as "other" with its text, never dropped.
*/

export type DecodedMemo =
  | {
      kind: "pay_line";
      runId: string;
      /** "2026-09" */
      period: string;
      invoiceRef: string;
      usdCents: number;
      rateE6: number;
    }
  | { kind: "allocation"; runId: string }
  | { kind: "funding"; runId: string; period: string; fundedUsdCents: number; acquiredZat: number; rateE6: number }
  | { kind: "other"; text: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const DIGITS = /^\d+$/;

function int(value: string | undefined): number | null {
  if (value === undefined || !DIGITS.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

/** Decodes a memo's text; anything that is not a well-formed Payslip record comes back as "other". */
export function decodeMemo(text: string | null | undefined): DecodedMemo | null {
  if (!text) return null;
  const parts = text.split("|");
  const [tag, runId] = parts;
  if (tag === "PS1" && parts.length === 6 && UUID.test(runId) && PERIOD.test(parts[2])) {
    const usdCents = int(parts[4]);
    const rateE6 = int(parts[5]);
    if (usdCents !== null && rateE6 !== null)
      return { kind: "pay_line", runId, period: parts[2], invoiceRef: parts[3], usdCents, rateE6 };
  }
  if (tag === "PS1A" && parts.length === 2 && UUID.test(runId)) return { kind: "allocation", runId };
  if (tag === "PS1R" && parts.length === 6 && UUID.test(runId) && PERIOD.test(parts[2])) {
    const fundedUsdCents = int(parts[3]);
    const acquiredZat = int(parts[4]);
    const rateE6 = int(parts[5]);
    if (fundedUsdCents !== null && acquiredZat !== null && rateE6 !== null)
      return { kind: "funding", runId, period: parts[2], fundedUsdCents, acquiredZat, rateE6 };
  }
  return { kind: "other", text };
}
