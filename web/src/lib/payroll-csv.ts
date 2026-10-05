/*
  The company's own payroll as CSV, built in the browser from the runs the console already loaded
  (GET /api/runs): one row per pay line, latest pay period first. Nothing is fetched or sent.
  Amounts are written from integers (cents, zatoshis), never through floating point.
*/
import type { Run } from "@/lib/api";
import { latestPeriodFirst, lineConfirmedAt } from "@/lib/payroll";

/** A field as CSV: quoted when needed, and never read as a formula by a spreadsheet. */
function field(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // A cell starting with = + - @ (or a tab or return) runs as a formula in Excel and Sheets.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function decimal(units: number, places: number): string {
  const negative = units < 0;
  const abs = Math.abs(Math.trunc(units));
  const scale = 10 ** places;
  const whole = Math.floor(abs / scale);
  const frac = String(abs % scale).padStart(places, "0");
  return `${negative ? "-" : ""}${whole}.${frac}`;
}

/** "2026-09" for a calendar month, else the ISO interval "2026-09-01/2026-09-15". */
function periodField(run: Pick<Run, "period_start" | "period_end">): string {
  const [y, m] = run.period_start.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const whole = run.period_start.endsWith("-01") && run.period_end === last;
  return whole ? run.period_start.slice(0, 7) : `${run.period_start}/${run.period_end}`;
}

/**
 * Every run and line as CSV text with a header row. `coin` names the coin column ("taz" on
 * testnet, "zec" on mainnet). Lines that have not moved yet have empty txid, height and time.
 */
export function payrollCsv(runs: Run[], coin: "ZEC" | "TAZ"): string {
  const header = [
    "period",
    "run_id",
    "contractor",
    "invoice",
    "usd",
    coin.toLowerCase(),
    "txid",
    "height",
    "confirmed_at",
    "status",
  ];
  const rows = [header.join(",")];
  for (const run of latestPeriodFirst(runs)) {
    for (const line of run.lines) {
      rows.push(
        [
          periodField(run),
          run.id,
          line.contractor_name,
          line.invoice_ref,
          decimal(line.amount_usd_cents, 2),
          line.amount_zat === null ? "" : decimal(line.amount_zat, 8),
          line.txid ?? "",
          line.confirmed_height ?? "",
          lineConfirmedAt(line, run) ?? "",
          line.status,
        ]
          .map(field)
          .join(","),
      );
    }
  }
  return `${rows.join("\r\n")}\r\n`;
}

/** "payslip-payroll-testnet-2026-10-05.csv" */
export function payrollCsvName(network: string | undefined, today: string): string {
  return `payslip-payroll-${network ?? "zcash"}-${today}.csv`;
}
