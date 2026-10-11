/*
  Words and rules shared by the console's request queue, the Run payroll flow and the
  contractor's Request a payment page (ADR-028). Pure: nothing here touches the service.
*/
import type { StatusInfo } from "@/components/ds/status";
import type { Cadence, PaySchedule, PaymentRequest } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { periodsOverlap, type PayPeriod } from "@/lib/payroll";

/** The one status tag of a request: Sent while the payer has not looked, then the decision. */
export function requestTag(r: Pick<PaymentRequest, "status" | "run_id">): StatusInfo {
  switch (r.status) {
    case "submitted":
      return { label: "Sent", tone: "neutral", help: "Waiting for the payer to approve or reject it" };
    case "approved":
      return r.run_id
        ? { label: "In a run", tone: "info", help: "Approved and in a payroll run that has not paid yet" }
        : { label: "Approved", tone: "info", help: "Approved; it joins the next payroll run for its period" };
    case "paid":
      return { label: "Paid", tone: "success", help: "Paid with a shielded payment; the payslip is in your list" };
    default:
      return { label: "Rejected", tone: "danger", help: "The payer rejected it; their note says why" };
  }
}

export const CADENCES: { value: Cadence; label: string }[] = [
  { value: "monthly", label: "Monthly" },
  { value: "biweekly", label: "Every two weeks" },
  { value: "weekly", label: "Weekly" },
];

export function cadenceLabel(c: Cadence | string): string {
  return CADENCES.find((x) => x.value === c)?.label ?? c;
}

export const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;

/** The pay day choices for a cadence: weekdays, or days of the month and "last". */
export function payDayOptions(cadence: Cadence): { value: string; label: string }[] {
  if (cadence === "monthly") {
    return [
      ...Array.from({ length: 28 }, (_, i) => ({ value: String(i + 1), label: `The ${ordinal(i + 1)}` })),
      { value: "last", label: "The last day of the month" },
    ];
  }
  return WEEKDAYS.map((d) => ({ value: d, label: `${capitalise(d)}s` }));
}

export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "Monthly, paid on the last day of the month", "Every two weeks, paid on Fridays". */
export function scheduleSentence(s: Pick<PaySchedule, "cadence" | "pay_day">): string {
  const day =
    s.cadence === "monthly"
      ? s.pay_day === "last"
        ? "the last day of the month"
        : `the ${ordinal(Number(s.pay_day))}`
      : `${capitalise(s.pay_day)}s`;
  return `${cadenceLabel(s.cadence)}, paid on ${day}`;
}

/** "Drafts on 26 Oct 2026, pay day 31 Oct 2026" for the next period. */
export function nextDraftSentence(s: Pick<PaySchedule, "drafts_on" | "next_pay_day">): string {
  const parts = [];
  if (s.drafts_on) parts.push(`drafts on ${formatDate(s.drafts_on)}`);
  if (s.next_pay_day) parts.push(`pay day ${formatDate(s.next_pay_day)}`);
  return parts.join(", ");
}

/** The pay day a schedule's draft should be reviewed by. */
export function reviewBy(s: PaySchedule): string | null {
  return s.drafted?.pay_day ?? null;
}

/** Approved requests no run has taken whose period shares a day with `period`. */
export function requestsForPeriod(requests: PaymentRequest[] | undefined, period: PayPeriod): PaymentRequest[] {
  return (requests ?? []).filter(
    (r) => r.status === "approved" && !r.run_id && periodsOverlap({ from: r.period_start, to: r.period_end }, period),
  );
}

/** The requests of `period` grouped by contractor, each group in the order they were sent. */
export function requestsByContractor(requests: PaymentRequest[]): Map<string, PaymentRequest[]> {
  const out = new Map<string, PaymentRequest[]>();
  for (const r of requests) {
    const list = out.get(r.contractor_id) ?? [];
    list.push(r);
    out.set(r.contractor_id, list);
  }
  return out;
}

/** The reference a line gets for several requests: joined, as the service joins them. */
export function joinedInvoiceRef(refs: string[], max = 64): string {
  const joined = refs.join(", ");
  if (joined.length <= max) return joined;
  const more = ` +${refs.length - 1}`;
  return `${refs[0].slice(0, Math.max(0, max - more.length))}${more}`;
}

/** The queue's order: what needs the payer first, then approved, paid, rejected; newest first within. */
const ORDER: Record<PaymentRequest["status"], number> = { submitted: 0, approved: 1, paid: 2, rejected: 3 };

export function queueOrder(a: PaymentRequest, b: PaymentRequest): number {
  return ORDER[a.status] - ORDER[b.status] || b.created_at.localeCompare(a.created_at);
}
