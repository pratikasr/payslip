/*
  Formatting rules (docs/DESIGN.md, "Numbers and identifiers"):
  - ZEC always to 8 decimal places, from integer zatoshis, no float math.
  - USD to 2 decimal places with thousands separators, from integer cents.
  - Heights with thousands separators.
  - Dates unambiguous: "5 Oct 2026". Times in UTC, labelled.
  - Negative amounts use a true minus sign (U+2212).
  - Long identifiers truncated in the middle; the full value is copyable.
*/

const ZAT_PER_ZEC = 100_000_000;
/** True minus sign (U+2212) for negative amounts, as finance tables use. */
export const MINUS = "\u2212";
const groups = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function groupInteger(value: number): string {
  return groups.format(value);
}

/** 354262000 -> "3.54262000" */
export function formatZec(zat: number | null | undefined): string {
  if (zat === null || zat === undefined || !Number.isFinite(zat)) return "Not set";
  const negative = zat < 0;
  const abs = Math.abs(Math.trunc(zat));
  const whole = Math.floor(abs / ZAT_PER_ZEC);
  const frac = String(abs % ZAT_PER_ZEC).padStart(8, "0");
  return `${negative ? MINUS : ""}${groupInteger(whole)}.${frac}`;
}

/** 480000 -> "$4,800.00" */
export function formatUsd(cents: number | null | undefined, opts: { signed?: boolean } = {}): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return "Not set";
  const negative = cents < 0;
  const abs = Math.abs(Math.trunc(cents));
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const sign = negative ? MINUS : opts.signed && cents > 0 ? "+" : "";
  return `${sign}$${groupInteger(whole)}.${frac}`;
}

/** An amount in hundredths of `currency` (ISO 4217), e.g. 480012 INR -> "₹4,800.12". */
export function formatFiat(cents: number | null | undefined, currency: string): string {
  if (cents === null || cents === undefined) return "Not set";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** rate e6 -> "$1,354.93". Full precision is available via formatRateFull. */
export function formatRate(rateE6: number | null | undefined): string {
  if (rateE6 === null || rateE6 === undefined || !Number.isFinite(rateE6)) return "Not set";
  return formatUsd(Math.round(rateE6 / 10_000));
}

/** rate e6 -> "1354.930000" (exact, for titles and exports) */
export function formatRateFull(rateE6: number | null | undefined): string {
  if (rateE6 === null || rateE6 === undefined || !Number.isFinite(rateE6)) return "";
  const whole = Math.floor(rateE6 / 1_000_000);
  const frac = String(rateE6 % 1_000_000).padStart(6, "0");
  return `${whole}.${frac}`;
}

export function formatHeight(height: number | null | undefined): string {
  if (height === null || height === undefined || !Number.isFinite(height)) return "Not mined";
  return groupInteger(height);
}

export function formatCount(n: number): string {
  return groupInteger(n);
}

/*
  Month names come from a fixed table rather than Intl, so the server and
  every browser render exactly the same string ("Sep", never "Sept").
*/
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n: number) => String(n).padStart(2, "0");

function parseDate(value: string): Date | null {
  // Plain YYYY-MM-DD values are UTC calendar dates in the API.
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayMonthYear(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "2026-10-05" or an RFC 3339 timestamp -> "5 Oct 2026" */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "Not set";
  const d = parseDate(value);
  return d ? dayMonthYear(d) : value;
}

/** RFC 3339 -> "5 Oct 2026, 11:42 UTC" */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Not set";
  const d = parseDate(value);
  return d ? `${dayMonthYear(d)}, ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC` : value;
}

/** RFC 3339 -> "11:42:10 UTC" */
export function formatTime(value: string): string {
  const d = parseDate(value);
  return d ? `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())} UTC` : value;
}

/** "2026-09" -> "Sep 2026" */
export function formatPeriodLabel(label: string | null | undefined): string {
  if (!label) return "Not set";
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m) return label;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${m[1]}` : label;
}

/** "2026-09-01".."2026-09-30" -> "1 Sep 2026 to 30 Sep 2026" */
export function formatRange(from: string, to: string): string {
  return `${formatDate(from)} to ${formatDate(to)}`;
}

/** Middle truncation for txids, addresses and keys: "3f2a9c…81d0e4" */
export function truncateMiddle(value: string, head = 8, tail = 6): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/** Parse a user-typed USD amount ("4,800" or "4800.5") into integer cents. */
export function parseUsdToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Base units string ("28462150000") and decimals -> "28,462.150000" */
export function formatBaseUnits(baseUnits: string, decimals: number): string {
  if (!/^\d+$/.test(baseUnits)) return baseUnits;
  const padded = baseUnits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals);
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decimals > 0 ? `${grouped}.${frac}` : grouped;
}

export const VENUE_LABELS: Record<string, string> = {
  "near-intents-1click": "NEAR Intents 1Click",
  maya: "Maya Protocol",
  "testnet-fixed-rate": "Testnet fixed rate",
};

export function venueLabel(venue: string | null | undefined): string {
  if (!venue) return "Not set";
  return VENUE_LABELS[venue] ?? venue;
}

export function networkLabel(network: string | null | undefined): string {
  if (network === "mainnet") return "Mainnet";
  if (network === "testnet") return "Testnet";
  return network ?? "Unknown network";
}

/** Today's UTC date as YYYY-MM-DD, for file names. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
