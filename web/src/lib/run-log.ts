/*
  The run's activity log (GET /api/runs/{id}/log) in payroll words. The service writes one line
  per step for operators ("Filled: 0.02407538 ZEC for 32501.76 USD at 1350000.000000 USD per
  ZEC", "Allocation transaction built: <txid>"); this reads each known line into a typed event,
  and `auditTimeline` folds them into what a payroll admin follows: approved, funded, moved to
  each person's account, then one entry per person (sent and confirmed together). A line this
  file does not know is kept as it is, never dropped. Amounts stay integers (cents, zatoshis).
*/
import type { Run, RunLogEvent } from "@/lib/api";

const HEX64 = "([0-9a-f]{64})";

/** "0.02407538" -> 2407538 zatoshis; null when not a plain decimal. */
function zatFrom(decimal: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,8}))?$/.exec(decimal);
  if (!m) return null;
  const zat = Number(m[1]) * 100_000_000 + Number((m[2] ?? "").padEnd(8, "0"));
  return Number.isSafeInteger(zat) ? zat : null;
}

/** "32501.76" -> 3250176 cents. */
function centsFrom(decimal: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(decimal);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** "1350000.000000" -> rate e6. */
function rateFrom(decimal: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(decimal);
  if (!m) return null;
  const e6 = Number(m[1]) * 1_000_000 + Number((m[2] ?? "").padEnd(6, "0"));
  return Number.isSafeInteger(e6) ? e6 : null;
}

const height = (text: string) => Number(text.replace(/,/g, ""));

export type LogEvent =
  | { type: "created"; count: number }
  | { type: "set_aside" }
  | { type: "quote"; amount: string; chain: string; address: string }
  | { type: "deposit_reported"; tx: string }
  | { type: "deposit_seen" }
  | { type: "swapping" }
  | { type: "swap_complete" }
  | { type: "filled"; zat: number; cents: number; rateE6: number }
  | { type: "waiting_treasury"; haveZat: number; needZat: number }
  | { type: "allocation_built"; txid: string }
  | { type: "allocation_broadcast" }
  | { type: "allocation_confirmed"; height: number }
  | { type: "allocation_rebuilt" }
  | { type: "accounts_funded" }
  | { type: "sent"; name: string; txid: string }
  | { type: "confirmed"; name: string; height: number }
  | { type: "conversion"; name: string; detail: string }
  | { type: "line_retry"; name: string; reason: string }
  | { type: "run_paid"; count: number }
  | { type: "retrying"; reason: string }
  | { type: "paused" }
  | { type: "failed"; reason: string }
  | { type: "resumed" }
  | { type: "cancelled"; note: string }
  | { type: "other"; text: string };

const RULES: [RegExp, (m: RegExpExecArray) => LogEvent | null][] = [
  [/^Run created with (\d+) lines?$/, (m) => ({ type: "created", count: Number(m[1]) })],
  [/^Funded from the testnet treasury at the fixed rate [\d.]+ USD per TAZ$/, () => ({ type: "set_aside" })],
  [
    /^Quote from \S+: deposit ([\d.]+) USDC on (\S*) to (\S*)$/,
    (m) => ({ type: "quote", amount: m[1], chain: m[2], address: m[3] }),
  ],
  [/^Deposit transaction (\S+) reported to the venue$/, (m) => ({ type: "deposit_reported", tx: m[1] })],
  [/^Deposit detected by the venue$/, () => ({ type: "deposit_seen" })],
  [/^Venue is swapping USDC to ZEC$/, () => ({ type: "swapping" })],
  [/^Venue reports the swap complete$/, () => ({ type: "swap_complete" })],
  [
    /^Filled: ([\d.]+) ZEC for ([\d.]+) USD at ([\d.]+) USD per ZEC$/,
    (m) => {
      const zat = zatFrom(m[1]);
      const cents = centsFrom(m[2]);
      const rateE6 = rateFrom(m[3]);
      return zat !== null && cents !== null && rateE6 !== null ? { type: "filled", zat, cents, rateE6 } : null;
    },
  ],
  [
    /^Waiting for (?:treasury confirmations|spendable treasury funds) \(([\d.]+) of ([\d.]+) ZEC(?: spendable)?\)$/,
    (m) => {
      const haveZat = zatFrom(m[1]);
      const needZat = zatFrom(m[2]);
      return haveZat !== null && needZat !== null ? { type: "waiting_treasury", haveZat, needZat } : null;
    },
  ],
  [new RegExp(`^Allocation transaction built: ${HEX64}$`), (m) => ({ type: "allocation_built", txid: m[1] })],
  [/^Allocation transaction broadcast$/, () => ({ type: "allocation_broadcast" })],
  [/^Allocation confirmed at height ([\d,]+)$/, (m) => ({ type: "allocation_confirmed", height: height(m[1]) })],
  [/^Allocation \S+ expired unmined at [\d,]+; rebuilding$/, () => ({ type: "allocation_rebuilt" })],
  [/^Contractor accounts funded; paying$/, () => ({ type: "accounts_funded" })],
  [new RegExp(`^Paid (.+): ${HEX64}$`), (m) => ({ type: "sent", name: m[1], txid: m[2] })],
  [/^Run paid: (\d+) lines? confirmed$/, (m) => ({ type: "run_paid", count: Number(m[1]) })],
  [/^(.+) confirmed at height ([\d,]+)$/, (m) => ({ type: "confirmed", name: m[1], height: height(m[2]) })],
  [
    /^Conversion quote for (.+): ([\d.]+) USDC on (\S+)$/,
    (m) => ({ type: "conversion", name: m[1], detail: `Quoted ${m[2]} USDC on ${m[3]}` }),
  ],
  [/^Conversion for (.+): (\S+)$/, (m) => ({ type: "conversion", name: m[1], detail: `Conversion ${m[2]}` })],
  [
    /^The node refused the payment to (.+?): (.*)\. It is rebuilt when it expires\.$/,
    (m) => ({
      type: "line_retry",
      name: m[1],
      reason: `The network refused it (${m[2]}). It is rebuilt when it expires.`,
    }),
  ],
  [
    /^Payment to (.+) expired unmined; rebuilding$/,
    (m) => ({ type: "line_retry", name: m[1], reason: "Expired before it was mined, so it was rebuilt." }),
  ],
  [
    /^Payment to (.+) left the chain in a reorg; waiting for it to be mined again$/,
    (m) => ({
      type: "line_retry",
      name: m[1],
      reason: "Left the chain in a reorganisation; waiting to be mined again.",
    }),
  ],
  [
    /^Broadcast for (.+) will be retried: (.*)$/,
    (m) => ({ type: "line_retry", name: m[1], reason: `Sending will be retried: ${m[2]}` }),
  ],
  [/^Retrying after a temporary error: (.*)$/, (m) => ({ type: "retrying", reason: m[1] })],
  [/^Run paused after repeated temporary errors$/, () => ({ type: "paused" })],
  [/^Run failed: (.*)$/, (m) => ({ type: "failed", reason: m[1] })],
  [/^Resuming from \S+$/, () => ({ type: "resumed" })],
  [/^Run cancelled by the payer\.?\s*(.*)$/, (m) => ({ type: "cancelled", note: m[1] })],
];

/** One log line as a typed event; anything unknown is kept as "other" with its text. */
export function parseLogLine(message: string): LogEvent {
  for (const [re, make] of RULES) {
    const m = re.exec(message);
    if (m) {
      const ev = make(m);
      if (ev) return ev;
    }
  }
  return { type: "other", text: message };
}

/** One entry on the audit timeline. */
export type TimelineEntry =
  | { kind: "event"; at: string; event: LogEvent; raw: string }
  | {
      kind: "allocation";
      at: string;
      txid: string | null;
      broadcastAt: string | null;
      confirmedAt: string | null;
      height: number | null;
    }
  | {
      kind: "person";
      at: string;
      name: string;
      lineId: string | null;
      txid: string | null;
      sentAt: string | null;
      confirmedAt: string | null;
      height: number | null;
      /** Retries, refusals and conversion updates for this person, oldest first. */
      notes: { at: string; text: string }[];
    };

/** Events that add nothing once their neighbours are shown (the fill says the swap completed). */
function redundant(ev: LogEvent, all: LogEvent[]): boolean {
  if (ev.type === "swap_complete") return all.some((e) => e.type === "filled");
  return false;
}

/**
 * The run's log as a payroll timeline, oldest first: the allocation's three lines become one
 * entry, and each person's "Paid" and "confirmed" lines become one entry at the time it was sent.
 */
export function auditTimeline(run: Pick<Run, "lines">, logs: RunLogEvent[]): TimelineEntry[] {
  const parsed = logs.map((l) => ({ at: l.at, raw: l.message, event: parseLogLine(l.message) }));
  const events = parsed.map((p) => p.event);
  const names = new Set(run.lines.map((l) => l.contractor_name));
  const out: TimelineEntry[] = [];
  const people = new Map<string, Extract<TimelineEntry, { kind: "person" }>>();
  let allocation: Extract<TimelineEntry, { kind: "allocation" }> | null = null;

  const person = (name: string, at: string) => {
    let p = people.get(name);
    if (!p) {
      const line = run.lines.find((l) => l.contractor_name === name);
      p = {
        kind: "person",
        at,
        name,
        lineId: line?.id ?? null,
        txid: null,
        sentAt: null,
        confirmedAt: null,
        height: null,
        notes: [],
      };
      people.set(name, p);
      out.push(p);
    }
    return p;
  };

  for (const { at, raw, event } of parsed) {
    if (redundant(event, events)) continue;
    switch (event.type) {
      case "allocation_built":
      case "allocation_broadcast":
      case "allocation_confirmed": {
        if (!allocation) {
          allocation = { kind: "allocation", at, txid: null, broadcastAt: null, confirmedAt: null, height: null };
          out.push(allocation);
        }
        if (event.type === "allocation_built") allocation.txid = event.txid;
        if (event.type === "allocation_broadcast") allocation.broadcastAt = at;
        if (event.type === "allocation_confirmed") {
          allocation.confirmedAt = at;
          allocation.height = event.height;
        }
        break;
      }
      case "sent": {
        const p = person(event.name, at);
        p.txid = event.txid;
        p.sentAt = p.sentAt ?? at;
        break;
      }
      case "confirmed": {
        // "<name> confirmed at height" for a name in this run; anything else stays a plain line.
        if (!names.has(event.name)) {
          out.push({ kind: "event", at, raw, event: { type: "other", text: raw } });
          break;
        }
        const p = person(event.name, at);
        p.confirmedAt = at;
        p.height = event.height;
        break;
      }
      case "line_retry":
      case "conversion": {
        const p = person(event.name, at);
        p.notes.push({ at, text: event.type === "line_retry" ? event.reason : event.detail });
        break;
      }
      default:
        out.push({ kind: "event", at, raw, event });
    }
  }
  return out;
}

const CHAINS: Record<string, string> = { base: "Base", arb: "Arbitrum", eth: "Ethereum", sol: "Solana" };

/** "Base" for "base"; any other chain name as the service gave it. */
export function chainName(chain: string): string {
  return CHAINS[chain] ?? chain;
}

function usd(cents: number): string {
  const whole = Math.floor(cents / 100).toLocaleString("en-US");
  return `$${whole}.${String(cents % 100).padStart(2, "0")}`;
}

function coinText(zat: number, coin: string): string {
  return `${(Math.round(zat / 10_000) / 10_000).toFixed(4)} ${coin}`;
}

/**
 * One log line as a short plain sentence in payroll words, for places that show only the latest
 * step (the Pay step's "Latest" line). The audit trail renders the same events with formatted
 * money and links instead.
 */
export function logSentence(message: string, coin: "ZEC" | "TAZ"): string {
  const e = parseLogLine(message);
  switch (e.type) {
    case "created":
      return `Approved: ${e.count} ${e.count === 1 ? "payment" : "payments"}`;
    case "set_aside":
      return "Set aside from the treasury at the simulated rate";
    case "quote":
      return `Quote received: send ${e.amount} USDC on ${chainName(e.chain)}`;
    case "deposit_reported":
      return "Deposit transaction reported to the venue";
    case "deposit_seen":
      return "The venue received the deposit";
    case "swapping":
      return "The venue is converting USDC to ZEC";
    case "swap_complete":
      return "The venue completed the swap";
    case "filled":
      return `Converted ${usd(e.cents)} into ${coinText(e.zat, coin)}`;
    case "waiting_treasury":
      return `Waiting for treasury coins to confirm: ${coinText(e.haveZat, coin)} of ${coinText(e.needZat, coin)} spendable`;
    case "allocation_built":
    case "allocation_broadcast":
      return "Moving each person's pay into their own account";
    case "allocation_confirmed":
      return `Each person's pay reached their account in block ${e.height.toLocaleString("en-US")}`;
    case "allocation_rebuilt":
      return "The move to each account expired before it was mined, so it was rebuilt";
    case "accounts_funded":
      return "Every account funded. Sending the payments";
    case "sent":
      return `Paid ${e.name}`;
    case "confirmed":
      return `${e.name}'s payment confirmed in block ${e.height.toLocaleString("en-US")}`;
    case "conversion":
      return `${e.name}: ${e.detail}`;
    case "line_retry":
      return `${e.name}: ${e.reason}`;
    case "run_paid":
      return `Payroll paid: all ${e.count} ${e.count === 1 ? "payment" : "payments"} confirmed`;
    case "retrying":
      return `Retrying after a temporary problem: ${e.reason}`;
    case "paused":
      return "Paused after repeated temporary problems";
    case "failed":
      return `The run stopped: ${e.reason}`;
    case "resumed":
      return "Resumed";
    case "cancelled":
      return "Cancelled by the payer";
    case "other":
      return e.text.replace(/\b([0-9a-f]{8})[0-9a-f]{48}([0-9a-f]{8})\b/gi, "$1…$2");
  }
}
