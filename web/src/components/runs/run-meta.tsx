import { ShieldedMark, StatusTag, type StatusInfo } from "@/components/ds/status";
import type { Contractor, Funding, FundingStatus, PayLine, PayLineStatus, Run, RunStatus } from "@/lib/api";
import { formatDate, formatPeriodLabel } from "@/lib/format";

/*
  Shared vocabulary for payroll runs, used on every console screen (Home, People, the runs list,
  the run page, the flow, Treasury and the sidebar): one plain word per state (runs, pay lines,
  funding, payslip access), rendered by the one StatusTag (components/ds/status.tsx), the filter
  groups on the runs list, and the integer money math the review and pay steps use for estimates.
  docs/DESIGN.md section 7 lists every word.
*/

/** Statuses after the payer clicked Pay: the executor records the swap, allocates, then pays. */
export const IN_FLIGHT: ReadonlySet<RunStatus> = new Set(["swapping", "swapped", "allocating", "paying"]);

type TagInfo = StatusInfo;

const RUN_TAGS: Record<RunStatus, TagInfo> = {
  draft: { label: "Draft", tone: "neutral", help: "Approved. Fund it to continue." },
  awaiting_funds: { label: "Awaiting funds", tone: "warning", help: "Waiting for the USDC deposit." },
  funded: { label: "Ready to pay", tone: "neutral", help: "Funds are in the treasury. Pay to send." },
  swapping: { label: "Paying", tone: "neutral", dot: true, help: "Recording the swap." },
  swapped: { label: "Paying", tone: "neutral", dot: true, help: "Preparing the payments." },
  allocating: { label: "Paying", tone: "neutral", dot: true, help: "Moving funds to each contractor's account." },
  paying: { label: "Paying", tone: "neutral", dot: true, help: "Sending one shielded payment per contractor." },
  paid: { label: "Paid", tone: "success", help: "Every payment is confirmed on chain." },
  failed: { label: "Failed", tone: "danger", help: "The run stopped. Open it to resume." },
  cancelled: { label: "Cancelled", tone: "neutral", help: "Closed before any money reached it. Nobody was paid." },
};

/** Funding states after which no money is on its way: the quote must be replaced. */
export const CLOSED_FUNDING: ReadonlySet<string> = new Set(["refunded", "failed", "expired"]);

/** True when the run is waiting on a quote that can no longer be paid (expired, refunded, failed). */
export function fundingClosed(run: Pick<Run, "status" | "funding">): boolean {
  return (
    (run.status === "awaiting_funds" || (run.status === "failed" && !pastFunding(run as Run))) &&
    !!run.funding &&
    CLOSED_FUNDING.has(run.funding.status)
  );
}

const CLOSED_TAGS: Record<string, TagInfo> = {
  expired: { label: "Quote expired", tone: "warning", help: "No deposit arrived in time. Get a new quote." },
  refunded: { label: "Refunded", tone: "warning", help: "The venue sent the deposit back. Get a new quote." },
  failed: { label: "Swap failed", tone: "danger", help: "The venue could not swap the deposit. Get a new quote." },
};

/** The run's state in one word: its status, or what happened to its funding when that is the news. */
export function runTag(run: Pick<Run, "status" | "funding"> | RunStatus): TagInfo {
  const r = typeof run === "string" ? { status: run, funding: null } : run;
  if (fundingClosed(r)) return CLOSED_TAGS[r.funding!.status];
  return RUN_TAGS[r.status] ?? { label: r.status, tone: "neutral", help: "" };
}

export function RunTag({ run, className }: { run: Pick<Run, "status" | "funding">; className?: string }) {
  return <StatusTag status={runTag(run)} className={className} />;
}

const LINE_TAGS: Record<PayLineStatus, TagInfo> = {
  pending: { label: "Waiting", tone: "neutral", help: "Not started yet." },
  allocated: { label: "Ready to send", tone: "neutral", help: "Funds are in this contractor's account." },
  broadcast: { label: "Sent", tone: "neutral", dot: true, help: "Sent to the network, waiting to be mined." },
  confirmed: { label: "Paid", tone: "neutral", help: "A shielded payment, mined in a block." },
  failed: { label: "Failed", tone: "danger", help: "This payment did not go through. Resume the run to retry it." },
};

/**
 * True when the line carries an error but is still in progress (the node refused a payment that
 * is rebuilt when it expires, or the account cannot cover it yet): a warning, not a failure.
 */
export function isLineWarning(line: PayLine): boolean {
  return !!line.error && line.status !== "failed" && line.status !== "confirmed";
}

/** Plain titles for why a run stopped, by the service's error code; the message gives the detail. */
const FAILURE_TITLES: Record<string, string> = {
  broadcast_rejected: "The network kept refusing a payment",
  line_underfunded: "A payment waited too long for its funds",
  treasury_insufficient: "The treasury no longer holds this run's funds",
  venue_refunded: "The venue refunded the deposit",
  funding_expired: "The quote expired before a deposit arrived",
  deposit_incomplete: "The deposit was smaller than the quote",
  venue_failed: "The venue could not complete the swap",
};

/** What to call a failed run's problem, in plain words. */
export function failureTitle(run: Pick<Run, "error">): string {
  return (run.error && FAILURE_TITLES[run.error.code]) || "The run stopped";
}

/**
 * Whether the payer can cancel the run (POST /api/runs/{id}/cancel): it is waiting for money or
 * stopped before any arrived (no fill, no allocation, no payment). A draft is discarded instead.
 * The service has the last word and says why when it refuses.
 */
export function canCancel(run: Run): boolean {
  if (!["awaiting_funds", "funded", "failed"].includes(run.status)) return false;
  if (run.allocation_txid) return false;
  if (run.status === "failed" && run.failed_from && !["awaiting_funds", "funded", "draft"].includes(run.failed_from))
    return false;
  return run.lines.every((l) => l.amount_zat === null && !l.txid);
}

/** True for a line paid out as USDC (ADR-018) rather than held as ZEC. */
export function isConverted(line: PayLine): boolean {
  return line.settlement_choice === "convert_usdc" || !!line.settlement;
}

/**
 * One pay line's state in one word, the same on every screen. A line that has not started reads
 * from its run: a draft's lines are drafts, a cancelled run's were never sent.
 */
export function lineTag(line: PayLine, run?: Pick<Run, "status">): TagInfo {
  // An error on a line still in progress is a warning: the service is still working on it.
  if (line.error && isLineWarning(line))
    return {
      label: line.error.code === "waiting_for_funds" ? "Waiting for funds" : "Retrying",
      tone: "warning",
      dot: true,
      help: line.error.message,
    };
  if (line.status === "confirmed" && isConverted(line))
    return { ...LINE_TAGS.confirmed, label: "Paid in USDC", help: "Paid, then converted to USDC for this contractor." };
  if (line.status === "pending" && run) {
    if (run.status === "draft") return { label: "Draft", tone: "neutral", help: "The run is not funded yet." };
    if (run.status === "cancelled") return { label: "Not sent", tone: "neutral", help: "The run was cancelled." };
    if (run.status === "failed")
      return { label: "Not sent", tone: "neutral", help: "The run stopped before this payment." };
  }
  return LINE_TAGS[line.status] ?? { label: line.status, tone: "neutral", help: "" };
}

export function LineTag({ line, run, className }: { line: PayLine; run?: Pick<Run, "status">; className?: string }) {
  return <StatusTag status={lineTag(line, run)} className={className} />;
}

/**
 * A pay line's state where payments are listed (Home, the run page, the flow, a person's
 * history): a confirmed payment shows the gold Shielded mark, because nothing is wrong and what
 * matters is that nobody else can read it; anything else shows its tag (waiting, sending,
 * retrying, failed). A line paid out as USDC says so beside the mark.
 */
export function LineStatus({
  line,
  run,
  className,
  detail,
}: {
  line: PayLine;
  run?: Pick<Run, "status">;
  className?: string;
  /** Shown after the mark for a confirmed line, for example the time it was paid. */
  detail?: React.ReactNode;
}) {
  if (line.status === "confirmed" && !(line.error && isLineWarning(line))) {
    return (
      <ShieldedMark
        className={className}
        detail={isConverted(line) ? detail ? <>· USDC · {detail}</> : "· USDC" : detail ? <>· {detail}</> : undefined}
      />
    );
  }
  return <LineTag line={line} run={run} className={className} />;
}

const FUNDING_TAGS: Record<FundingStatus, TagInfo> = {
  awaiting_deposit: {
    label: "Awaiting deposit",
    tone: "neutral",
    help: "Waiting for the USDC deposit to reach the venue.",
  },
  deposit_seen: {
    label: "Deposit seen",
    tone: "neutral",
    dot: true,
    help: "The venue has the deposit and will swap it.",
  },
  processing: { label: "Swapping", tone: "neutral", dot: true, help: "The venue is converting USDC to ZEC." },
  incomplete: { label: "Deposit too small", tone: "warning", help: "The venue received less than the quote." },
  success: { label: "Received", tone: "neutral", help: "The coins reached the treasury for this run." },
  refunded: { label: "Refunded", tone: "warning", help: "The venue sent the deposit back." },
  failed: { label: "Swap failed", tone: "danger", help: "The venue could not complete the swap." },
  expired: { label: "Quote expired", tone: "neutral", help: "No deposit arrived before the quote's deadline." },
};

/**
 * A run's funding in the same words everywhere (Treasury, the audit trail, the Fund step). On
 * testnet nothing arrives: the fixed-rate venue sets aside coins already in the treasury.
 */
export function fundingTag(funding: Pick<Funding, "status" | "venue">): TagInfo {
  if (funding.venue === "testnet-fixed-rate" && funding.status === "success")
    return { label: "Set aside", tone: "neutral", help: "Coins already in the treasury were set aside for this run." };
  return FUNDING_TAGS[funding.status] ?? { label: funding.status, tone: "neutral", help: "" };
}

/** Whether a contractor holds their payslip key: shared (with the day) or not yet. */
export function accessTag(c: Pick<Contractor, "fvk_shared_at">): TagInfo {
  return c.fvk_shared_at
    ? { label: "Shared", tone: "neutral", help: "Their invite link was sent; they can read their own payslips." }
    : { label: "Not shared", tone: "neutral", help: "Send their invite link so they can read their payslips." };
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

/** Venue states in which a quote's deposit address is still in play (its rate still applies). */
const LIVE_QUOTE: ReadonlySet<string> = new Set(["awaiting_deposit", "deposit_seen", "processing", "incomplete"]);

/** The rate a live quote locked (mainnet), for estimates before the fill; null otherwise. */
export function liveQuoteRate(run: Run): number | null {
  const f = run.funding;
  if (!f || f.venue === "testnet-fixed-rate" || !LIVE_QUOTE.has(f.status)) return null;
  return f.quote_rate_e6 && f.quote_rate_e6 > 0 ? f.quote_rate_e6 : null;
}

/**
 * Ids of the lines whose contractor was archived after the run was made: the service says so on
 * newer versions (contractor_archived); otherwise they are missing from the active people list.
 */
export function archivedLineIds(run: Run, contractors: Contractor[] | undefined): ReadonlySet<string> {
  const active = contractors ? new Set(contractors.map((c) => c.id)) : null;
  return new Set(
    run.lines
      .filter((l) => l.contractor_archived === true || (active !== null && !active.has(l.contractor_id)))
      .map((l) => l.id),
  );
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
