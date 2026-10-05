/*
  Data helpers for the contractor portal: the statement request with one automatic retry when
  lightwalletd drops a connection, the date range the portal reads, the currencies the service
  prices ZEC in, and short labels for payslips.
*/
import { ApiError, api, type Statement, type StatementLine } from "@/lib/api";
import { formatPeriodLabel } from "@/lib/format";

export interface StatementRequest {
  ufvk: string;
  from: string;
  to: string;
  currency?: string;
}

/**
 * Fiat currencies the service accepts for the value at receipt (service/src/prices.rs, which
 * mirrors CoinGecko's supported list). USD first, then the most used.
 */
export const CURRENCIES = (
  "USD EUR GBP INR CAD AUD NGN BRL MXN SGD PHP ZAR JPY CHF AED ARS BDT BHD CLP CNY CZK DKK " +
  "GEL HKD HUF IDR ILS KRW KWD LKR MMK MYR NOK NZD PKR PLN RUB SAR SEK THB TRY TWD UAH VND"
).split(" ");

const EURO = "AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK".split(" ");
const REGION_CURRENCY: Record<string, string> = {
  US: "USD",
  GB: "GBP",
  IN: "INR",
  CA: "CAD",
  AU: "AUD",
  NG: "NGN",
  BR: "BRL",
  MX: "MXN",
  SG: "SGD",
  PH: "PHP",
  ZA: "ZAR",
  JP: "JPY",
  CH: "CHF",
  AE: "AED",
  AR: "ARS",
  BD: "BDT",
  CL: "CLP",
  CN: "CNY",
  CZ: "CZK",
  DK: "DKK",
  HK: "HKD",
  HU: "HUF",
  ID: "IDR",
  IL: "ILS",
  KR: "KRW",
  LK: "LKR",
  MY: "MYR",
  NO: "NOK",
  NZ: "NZD",
  PK: "PKR",
  PL: "PLN",
  SA: "SAR",
  SE: "SEK",
  TH: "THB",
  TR: "TRY",
  TW: "TWD",
  UA: "UAH",
  VN: "VND",
};

/** A first guess at the person's currency from the browser's locale; USD when unknown. */
export function guessCurrency(): string {
  try {
    const region = new Intl.Locale(navigator.language).maximize().region ?? "";
    if (EURO.includes(region)) return "EUR";
    return REGION_CURRENCY[region] ?? "USD";
  } catch {
    return "USD";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The portal reads the last twelve months: the longest period one statement can cover. */
export function recentRange(now = new Date()): { from: string; to: string } {
  return { from: iso(new Date(now.getTime() - 365 * DAY_MS)), to: iso(now) };
}

/** The previous calendar year, 1 Jan to 31 Dec. */
export function lastYear(now = new Date()): { from: string; to: string } {
  const y = now.getUTCFullYear() - 1;
  return { from: `${y}-01-01`, to: `${y}-12-31` };
}

/** Errors that mean the key itself cannot be used, so the portal locks again. */
export const KEY_ERRORS = new Set([
  "invalid_viewing_key",
  "wrong_network",
  "spending_key_rejected",
  "incoming_viewing_key",
]);

/** Plain words for a key the service refused; the service's own message where it is already plain. */
export function keyErrorText(err: ApiError): string {
  switch (err.code) {
    case "invalid_viewing_key":
      return "The Payslip service could not read this viewing key. Copy it again from the message your payer sent.";
    case "incoming_viewing_key":
      return "This is an incoming viewing key. Payslip needs the full viewing key, which starts with uview or uvf. Ask your payer for it.";
    default:
      return `${err.message} ${err.hint}`.trim();
  }
}

const RETRY_MS = 1500;

/**
 * Fetches a contractor statement. lightwalletd sometimes drops a long-lived connection; the first
 * `lightwalletd_unreachable` is retried once before it is shown.
 */
export async function fetchStatement(body: StatementRequest, signal?: AbortSignal): Promise<Statement> {
  try {
    return await api.contractorStatement(body, signal);
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "lightwalletd_unreachable" || signal?.aborted) throw err;
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    if (signal?.aborted) throw err;
    return api.contractorStatement(body, signal);
  }
}

/** Creates a payment proof for one payment, with the same single retry when lightwalletd drops. */
export async function createProof(ufvk: string, line: Pick<StatementLine, "txid" | "amount_zat">) {
  const once = () => api.createProof({ ufvk, txid: line.txid });
  let set;
  try {
    set = await once();
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "lightwalletd_unreachable") throw err;
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    set = await once();
  }
  // A transaction can hold more than one payment from the account; take the one on this line.
  const proof = set.proofs.find((p) => p.amount_zat === line.amount_zat) ?? set.proofs[0];
  if (!proof) {
    throw new ApiError(422, {
      code: "nothing_to_prove",
      message: "This payment has nothing a proof can open.",
      hint: "Reload your payslips and try again from the payslip itself.",
    });
  }
  return proof;
}

/** The public link for a proof. The token rides in the fragment, which browsers never send to a server. */
export function proofLink(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/verify#${token}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-05" -> "Oct 5" this year, "Oct 5, 2025" in another year (Mercury's list dates). */
export function monthDay(value: string | null | undefined, now = new Date()): string {
  if (!value) return "Not mined";
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return value;
  const base = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return d.getUTCFullYear() === now.getUTCFullYear() ? base : `${base}, ${d.getUTCFullYear()}`;
}

export function payslipTitle(line: Pick<StatementLine, "period">): string {
  return `Payslip for ${formatPeriodLabel(line.period)}`;
}

export function payslipHref(line: Pick<StatementLine, "txid">): string {
  return `/portal/payslips/${line.txid}`;
}

/** Payslips newest pay period first, then by block time (a back-dated payroll sits under newer ones). */
export function newestFirst<T extends Pick<StatementLine, "block_time" | "date" | "period">>(lines: T[]): T[] {
  return lines
    .slice()
    .sort((a, b) => b.period.localeCompare(a.period) || (b.block_time ?? b.date).localeCompare(a.block_time ?? a.date));
}

/** The name the statement carries for this key, or a neutral fallback. */
export function personName(s: Statement | undefined): string | null {
  return s?.account.label?.trim() || null;
}

/** "Amara Okafor" -> "Amara". */
export function firstName(name: string | null): string | null {
  return name ? (name.split(/\s+/)[0] ?? null) : null;
}

/** File name for a CSV download when the service sends none. */
export function csvName(kind: string, who: string | null, from: string, to: string): string {
  const slug = (who ?? "statement")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `payslip-${kind}-${slug}-${from}-to-${to}.csv`;
}
