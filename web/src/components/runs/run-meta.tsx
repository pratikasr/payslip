import { Tag, type TagTone } from "@/components/ds/tag";
import type { PayLine, PayLineStatus, Run, RunStatus } from "@/lib/api";
import { formatDate, formatPeriodLabel } from "@/lib/format";

/*
  Shared vocabulary for payroll runs: one plain word per state, the filter groups on the runs
  list, and the integer money math the review and pay steps use for estimates.
*/

/** Statuses after the payer clicked Pay: the executor records the swap, allocates, then pays. */
export const IN_FLIGHT: ReadonlySet<RunStatus> = new Set(["swapping", "swapped", "allocating", "paying"]);

const RUN_TAGS: Record<RunStatus, { label: string; tone: TagTone; dot?: boolean; help: string }> = {
  draft: { label: "Draft", tone: "neutral", help: "Approved. Fund it to continue." },
  awaiting_funds: { label: "Awaiting funds", tone: "warning", help: "Waiting for the USDC deposit." },
  funded: { label: "Ready to pay", tone: "neutral", help: "Funds are in the treasury. Pay to send." },
  swapping: { label: "Paying", tone: "neutral", dot: true, help: "Recording the swap." },
  swapped: { label: "Paying", tone: "neutral", dot: true, help: "Preparing the payments." },
  allocating: { label: "Paying", tone: "neutral", dot: true, help: "Moving funds to each contractor's account." },
  paying: { label: "Paying", tone: "neutral", dot: true, help: "Sending one shielded payment per contractor." },
  paid: { label: "Paid", tone: "success", help: "Every payment is confirmed on chain." },
  failed: { label: "Failed", tone: "danger", help: "The run stopped. Open it to resume." },
};

export function runTag(status: RunStatus) {
  return RUN_TAGS[status] ?? { label: status, tone: "neutral" as TagTone, help: "" };
}

export function RunTag({ status, className }: { status: RunStatus; className?: string }) {
  const t = runTag(status);
  return (
    <Tag tone={t.tone} dot={t.dot} title={t.help} className={className}>
      {t.label}
    </Tag>
  );
}

const LINE_TAGS: Record<PayLineStatus, { label: string; tone: TagTone; dot?: boolean; help: string }> = {
  pending: { label: "Waiting", tone: "neutral", help: "Not started yet." },
  allocated: { label: "Ready to send", tone: "neutral", help: "Funds are in this contractor's account." },
  broadcast: { label: "Sent", tone: "neutral", dot: true, help: "Sent to the network, waiting to be mined." },
  confirmed: { label: "Confirmed", tone: "neutral", help: "A shielded payment, mined in a block." },
  failed: { label: "Failed", tone: "danger", help: "This payment did not go through. Resume the run to retry it." },
};

export function lineTag(status: PayLineStatus) {
  return LINE_TAGS[status] ?? { label: status, tone: "neutral" as TagTone, help: "" };
}

export function LineTag({ status, className }: { status: PayLineStatus; className?: string }) {
  const t = lineTag(status);
  return (
    <Tag tone={t.tone} dot={t.dot} title={t.help} className={className}>
      {t.label}
    </Tag>
  );
}

/** Filter chips on the runs list. */
export const RUN_FILTERS = [
  { id: "all", label: "All", statuses: null },
  { id: "drafts", label: "Drafts and awaiting funds", statuses: ["draft", "awaiting_funds"] },
  { id: "paying", label: "Paying", statuses: ["funded", "swapping", "swapped", "allocating", "paying"] },
  { id: "paid", label: "Paid", statuses: ["paid"] },
  { id: "failed", label: "Failed", statuses: ["failed"] },
] as const satisfies readonly { id: string; label: string; statuses: readonly RunStatus[] | null }[];

export type RunFilterId = (typeof RUN_FILTERS)[number]["id"];

export function matchesFilter(run: Run, id: RunFilterId): boolean {
  const f = RUN_FILTERS.find((x) => x.id === id);
  return !f || f.statuses === null || (f.statuses as readonly RunStatus[]).includes(run.status);
}

/** Where a run stands in the four-step flow. */
export type FlowPhase = "fund" | "pay" | "done";

const FUNDED_OR_LATER: ReadonlySet<string> = new Set(["funded", "swapping", "swapped", "allocating", "paying", "paid"]);

/** True once funds for the run are in the treasury (a failed run is judged by where it stopped). */
export function pastFunding(run: Run): boolean {
  if (run.status === "failed") {
    return run.failed_from
      ? FUNDED_OR_LATER.has(run.failed_from)
      : run.funding?.status === "success" || run.lines.some((l) => l.status !== "pending");
  }
  return FUNDED_OR_LATER.has(run.status);
}

export function flowPhase(run: Run): FlowPhase {
  if (run.status === "paid") return "done";
  return pastFunding(run) ? "pay" : "fund";
}

/** True while the executor is working on the run, or will be once it picks it up. */
export function isPaying(run: Run): boolean {
  return IN_FLIGHT.has(run.status) || (!!run.executing && run.status !== "paid" && run.status !== "failed");
}

/** The newer of two copies of a run (the SSE stream, a fetch, or a mutation's answer). */
export function newerRun(a: Run | undefined, b: Run | undefined): Run | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b.updated_at) >= Date.parse(a.updated_at) ? b : a;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function isWholeMonth(from: string, to: string): boolean {
  if (from.slice(0, 7) !== to.slice(0, 7) || !from.endsWith("-01")) return false;
  const [y, m] = from.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Number(to.slice(8, 10)) === last;
}

/** "Sep 2026" for a calendar month, else "1 Sep to 15 Sep 2026". */
export function periodTitle(from: string, to: string): string {
  if (isWholeMonth(from, to)) return formatPeriodLabel(from.slice(0, 7));
  if (from.slice(0, 4) === to.slice(0, 4)) {
    const d = (v: string) => `${Number(v.slice(8, 10))} ${MONTHS[Number(v.slice(5, 7)) - 1]}`;
    return `${d(from)} to ${d(to)} ${to.slice(0, 4)}`;
  }
  return `${formatDate(from)} to ${formatDate(to)}`;
}

export function runTitle(run: Pick<Run, "period_start" | "period_end">): string {
  return periodTitle(run.period_start, run.period_end);
}

/** First and last day of a calendar month, as YYYY-MM-DD. */
export function monthRange(year: number, month0: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month0, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, month0 + 1, 0)).toISOString().slice(0, 10);
  return { from, to };
}

/** The current month and the eleven before it, newest first, keyed "YYYY-MM". */
export function recentMonths(now = new Date(), count = 12): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    out.push({ key, label: formatPeriodLabel(key) });
  }
  return out;
}

/** ZEC for a USD amount at a rate, rounded half up to the zatoshi, exactly as the service does. */
export function usdCentsToZat(cents: number, rateE6: number): number | null {
  if (!rateE6 || rateE6 <= 0 || !Number.isSafeInteger(cents) || !Number.isSafeInteger(rateE6)) return null;
  const r = BigInt(rateE6);
  const zat = (BigInt(cents) * 1_000_000_000_000n + r / 2n) / r;
  return zat <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(zat) : null;
}

/** The ZEC a run's lines come to at a rate: per line, then summed, as the executor converts them. */
export function estimateZat(amountsCents: number[], rateE6: number | null | undefined): number | null {
  if (!rateE6) return null;
  let sum = 0;
  for (const c of amountsCents) {
    const z = usdCentsToZat(c, rateE6);
    if (z === null) return null;
    sum += z;
  }
  return sum;
}

/** Rate of the run's funding, when it has one. */
export function fundingRate(run: Run): number | null {
  return run.funding?.rate_usd_per_zec_e6 ?? null;
}

/** Lines that were sent, in the order they appear. */
export function confirmedCount(lines: PayLine[]): number {
  return lines.filter((l) => l.status === "confirmed").length;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Retry once after a short pause when lightwalletd was briefly unreachable, then give up. */
export async function retryOnce<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if ((err as { code?: string })?.code !== "lightwalletd_unreachable") throw err;
    await new Promise((r) => setTimeout(r, 1500));
    return call();
  }
}
