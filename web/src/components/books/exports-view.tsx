"use client";

import { useState, type ReactNode } from "react";
import { Check, Download, Printer } from "lucide-react";
import { toast } from "sonner";
import { Coin, Usd, Zec } from "@/components/app/amount";
import { Card } from "@/components/ds/card";
import { Tag } from "@/components/ds/tag";
import { accountantRequest, useBooks, withLwdRetry } from "@/components/books/books-provider";
import {
  differenceOf,
  exceptionsOf,
  ledgerOf,
  payeeOf,
  shortRange,
  sortRuns,
  statusView,
  totalsOf,
  UNLABELLED_REASON,
  type BooksResult,
} from "@/components/books/books-data";
import { csvSafe, parseCsv, writeCsv } from "@/components/books/csv";
import { Button } from "@/components/ui/button";
import { api, toDisplayError, type AccountantExportFormat } from "@/lib/api";
import { saveBlob } from "@/lib/download";
import { formatCount, formatDate, formatDateTime, formatHeight, formatPeriodLabel, networkLabel } from "@/lib/format";
import { cn } from "cn";

interface Option {
  id: AccountantExportFormat | "pdf";
  name: string;
  kind: string;
  columns: string[];
  /** The preview shows the first columns only; the file has more. */
  more?: boolean;
  points: string[];
  action: string;
}

const OPTIONS: Option[] = [
  {
    id: "xero",
    name: "Xero",
    kind: "Bank statement CSV",
    columns: ["Date", "Amount", "Payee", "Description", "Reference"],
    points: ["Funding in and each payment out, in USD", "Dates as DD/MM/YYYY for Import a statement"],
    action: "Download for Xero",
  },
  {
    id: "quickbooks",
    name: "QuickBooks",
    kind: "Bank upload CSV",
    columns: ["Date", "Description", "Amount"],
    points: [
      "The three-column bank upload, funding in and each payment out, in USD",
      "Dates as DD/MM/YYYY: choose that date format when you upload",
    ],
    action: "Download for QuickBooks",
  },
  {
    id: "payslip",
    name: "Payslip CSV",
    kind: "Full reconciliation",
    columns: [
      "run_id",
      "period",
      "funded_usd",
      "paid_usd",
      "variance_usd",
      "explained_usd",
      "difference_usd",
      "status",
    ],
    more: true,
    points: [
      "Every run with all its reconciliation fields, then every payment with its transaction",
      "Unlabelled transactions listed, never dropped",
    ],
    action: "Download CSV",
  },
  {
    id: "pdf",
    name: "Printable PDF",
    kind: "For the file",
    columns: ["Reconciliation", "Payments", "Exceptions"],
    points: ["The reconciliation, every payment and every exception", "Choose Save as PDF in the print dialog"],
    action: "Print or save as PDF",
  },
];

/** The file name the service gives each export (statements.rs file_prefix). */
function fileName(id: AccountantExportFormat, r: BooksResult): string {
  const prefix = id === "payslip" ? "payslip-" : `payslip-${id}-`;
  return `${prefix}reconciliation-${r.period.from}-${r.period.to}.csv`;
}

/** How many data rows each export holds for this result, the way the service writes them. */
function rowCount(id: AccountantExportFormat, r: BooksResult): number {
  if (id === "payslip") return r.runs.length + r.lines.length + (r.pending?.length ?? 0) + r.unlabelled.length;
  const records = (r.run_records ?? []).filter(
    (rec) => rec.date || r.lines.some((l) => l.run_id === rec.run_id && l.block_time),
  ).length;
  return records + r.lines.filter((l) => l.block_time).length;
}

const usdSigned = (cents: number) =>
  `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100)}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;

function dmy(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * The service writes the names it knows. A statements-only service knows none, so its files say
 * "Contractor" or a fingerprint; Books puts back the names from the key file, matched by the same
 * fingerprints and payment fields. Returns null when nothing needed a name.
 */
export function relabelExport(text: string, id: AccountantExportFormat, r: BooksResult): string | null {
  const rows = parseCsv(text);
  let changed = false;
  if (id === "payslip") {
    const names = new Map(r.accounts.filter((a) => a.label).map((a) => [a.fingerprint, a.label as string]));
    let col = -1;
    for (const row of rows) {
      if (row[0]?.startsWith("#")) {
        col = -1;
        continue;
      }
      if (col < 0) {
        col = row.indexOf("account");
        continue;
      }
      const name = names.get(row[col] ?? "");
      if (name) {
        row[col] = csvSafe(name);
        changed = true;
      }
    }
  } else {
    const byKey = new Map<string, string[]>();
    for (const l of r.lines) {
      if (l.labelSource !== "key file" || !l.label || !l.block_time) continue;
      const key = `${dmy(l.block_time)}|${usdSigned(-l.usd_basis_cents)}|${csvSafe(`Payroll ${l.period} ${l.invoice_ref}`)}`;
      byKey.set(key, [...(byKey.get(key) ?? []), l.label]);
    }
    for (const row of rows.slice(1)) {
      if (id === "xero" && row[2] === "Contractor") {
        const names = byKey.get(`${row[0]}|${row[1]}|${row[3]}`);
        const name = names?.shift();
        if (name) {
          row[2] = csvSafe(name);
          changed = true;
        }
      } else if (id === "quickbooks" && row[1]?.startsWith("Contractor: ")) {
        const desc = row[1].slice("Contractor: ".length);
        const name = byKey.get(`${row[0]}|${row[2]}|${desc}`)?.shift();
        if (name) {
          row[1] = csvSafe(`${name}: ${desc}`);
          changed = true;
        }
      }
    }
  }
  return changed ? writeCsv(rows) : null;
}

/** Mercury's "Choose where your books live": one card per destination, each a real export. */
export function ExportsView({ r }: { r: BooksResult }) {
  const { keys } = useBooks();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const body = accountantRequest(keys, r.period);

  const download = async (o: Option) => {
    if (o.id === "pdf") {
      // The browser names the PDF after the page title.
      const previous = document.title;
      document.title = `Payslip reconciliation, ${shortRange(r.period)}`;
      window.print();
      document.title = previous;
      return;
    }
    const format = o.id;
    setBusy(format);
    try {
      // The service drops idle lightwalletd connections; one retry reconnects, as the scan does.
      const res = await withLwdRetry(() => api.accountantStatementCsv(body, format));
      const name = res.filename ?? fileName(format, r);
      const relabelled = relabelExport(await res.blob.text(), format, r);
      saveBlob(relabelled === null ? res.blob : new Blob([relabelled], { type: "text/csv;charset=utf-8" }), name);
      setDone((d) => ({ ...d, [o.id]: name }));
      toast.success(`${o.name} file downloaded`, { description: name });
    } catch (err) {
      const e = toDisplayError(err);
      toast.error(e.message, { description: e.hint });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="mx-auto grid max-w-[780px] gap-4 sm:grid-cols-2" data-print="hide">
        {OPTIONS.map((o) => (
          <Card
            key={o.id}
            as="article"
            className="grid content-start gap-4 p-4 sm:p-4"
            aria-labelledby={`export-${o.id}`}
          >
            <Preview columns={o.columns} pdf={o.id === "pdf"} more={o.more} />
            <div className="grid gap-2 px-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={`export-${o.id}`} className="text-[0.9375rem] text-foreground">
                  {o.name}
                </h2>
                <Tag>{o.kind}</Tag>
              </div>
              <ul className="list-disc space-y-0.5 pl-4 text-[0.8125rem] text-muted-foreground">
                {o.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              {o.id !== "pdf" ? (
                <p className="text-xs break-all text-muted-foreground" data-testid={`export-${o.id}-file`}>
                  <code className="font-mono">{fileName(o.id, r)}</code> · {formatCount(rowCount(o.id, r))}{" "}
                  {rowCount(o.id, r) === 1 ? "row" : "rows"}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-3 px-1 pb-1">
              <Button
                type="button"
                variant={o.id === "xero" ? "default" : "secondary"}
                size="sm"
                onClick={() => void download(o)}
                disabled={busy !== null}
                data-testid={`export-${o.id}`}
              >
                {o.id === "pdf" ? <Printer aria-hidden="true" /> : <Download aria-hidden="true" />}
                {busy === o.id ? "Preparing" : o.action}
              </Button>
              {done[o.id] ? (
                <span className="inline-flex min-w-0 items-center gap-1 text-xs text-success" role="status">
                  <Check className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">Downloaded</span>
                </span>
              ) : null}
            </div>
          </Card>
        ))}
      </div>
      <PrintReport r={r} />
    </>
  );
}

function Preview({ columns, pdf, more }: { columns: string[]; pdf: boolean; more?: boolean }) {
  return (
    <div className="grid h-[124px] place-items-center overflow-hidden rounded-lg bg-raised px-4" aria-hidden="true">
      {pdf ? (
        <div className="grid w-[124px] gap-1.5 rounded-md border bg-card p-3 shadow-[0_1px_2px_rgba(112,115,147,0.12)]">
          <span className="text-[9px] text-strong">Payslip reconciliation</span>
          <span className="h-1 w-3/4 rounded bg-chip" />
          {columns.map((c) => (
            <span key={c} className="flex justify-between gap-2 text-[7px] text-muted-foreground">
              {c}
              <span className="h-1 w-6 self-center rounded bg-chip" />
            </span>
          ))}
        </div>
      ) : (
        <div className="grid w-full max-w-[290px] gap-1.5 rounded-md border bg-card px-3 py-2.5 shadow-[0_1px_2px_rgba(112,115,147,0.12)]">
          <code className="font-mono text-[10px] leading-snug break-all text-strong">
            {columns.join(",")}
            {more ? ",…" : ""}
          </code>
          {more ? <span className="text-[9px] text-muted-foreground">Main columns; the file has more</span> : null}
          {[0, 1, 2].map((row) => (
            <span key={row} className="flex gap-1.5">
              {columns.map((c, i) => (
                <span key={c} className={cn("h-1 flex-1 rounded bg-chip", (i + row) % 3 === 0 && "flex-[1.6]")} />
              ))}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Printable report (only on paper) ---------- */

function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[10pt]", className)}>{children}</p>;
}

/** What "Print or save as PDF" puts on paper: the reconciliation, every payment, every exception. */
function PrintReport({ r }: { r: BooksResult }) {
  const t = totalsOf(r);
  const runs = sortRuns(r);
  const lines = ledgerOf(r);
  const ex = exceptionsOf(r);
  return (
    <article data-print="only" aria-hidden="true" className="space-y-5 text-black">
      {/* The app shell keeps its 220px sidebar track when printing; give the report the page. */}
      <style>{`@media print { div:has(> aside[data-print="hide"]), div:has(> [data-print="hide"] > aside) { display: block !important; } }`}</style>
      <header className="space-y-1">
        <P className="text-[9pt]">Payslip</P>
        <h1 className="text-[16pt] font-normal">Reconciliation, {shortRange(r.period)}</h1>
        <P>
          Zcash {networkLabel(r.network).toLowerCase()} · {r.accounts.length} viewing keys · scanned to block{" "}
          {formatHeight(r.scanned_to_height)} · generated {formatDateTime(r.generated_at)}
        </P>
      </header>
      <table>
        <tbody>
          <tr>
            <th className="text-left">Funded</th>
            <td>
              <Usd cents={t.funded} />
            </td>
            <th className="text-left">Paid</th>
            <td>
              <Usd cents={t.paid} />
            </td>
            <th className="text-left">Variance</th>
            <td>
              <Usd cents={t.variance} />
            </td>
            <th className="text-left">Explained</th>
            <td>
              <Usd cents={t.explained} />
            </td>
            <th className="text-left">Unexplained</th>
            <td>
              <Usd cents={t.unexplained} />
            </td>
          </tr>
        </tbody>
      </table>
      <section>
        <h2 className="text-[12pt] font-normal">Runs</h2>
        <table>
          <thead>
            <tr>
              <th className="text-left">Run</th>
              <th className="text-right">Funded</th>
              <th className="text-right">
                <Coin /> acquired
              </th>
              <th className="text-right">Paid</th>
              <th className="text-right">Fees</th>
              <th className="text-right">Unspent</th>
              <th className="text-right">Variance</th>
              <th className="text-right">Explained</th>
              <th className="text-right">Difference</th>
              <th className="text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.run_id}>
                <td>
                  {formatPeriodLabel(run.period)} {run.run_id.slice(0, 8)}
                </td>
                <td className="text-right">
                  <Usd cents={run.funded_usd_cents} />
                </td>
                <td className="text-right">
                  <Zec zat={run.zec_acquired_zat} unit={false} />
                </td>
                <td className="text-right">
                  <Usd cents={run.paid_usd_cents} />
                </td>
                <td className="text-right">
                  <Zec zat={run.network_fees_zat} unit={false} />
                </td>
                <td className="text-right">
                  {run.unspent_zat === null ? "Unknown" : <Zec zat={run.unspent_zat} unit={false} />}
                </td>
                <td className="text-right">
                  <Usd cents={run.variance_usd_cents} />
                </td>
                <td className="text-right">
                  <Usd cents={run.explained_usd_cents} />
                </td>
                <td className="text-right">
                  <Usd cents={differenceOf(run)} />
                </td>
                <td>{statusView(run).label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2 className="text-[12pt] font-normal">Payments ({formatCount(lines.length)})</h2>
        <table>
          <thead>
            <tr>
              <th className="text-left">Date</th>
              <th className="text-left">Contractor</th>
              <th className="text-left">Run</th>
              <th className="text-left">Invoice</th>
              <th className="text-right">USD</th>
              <th className="text-right">
                <Coin />
              </th>
              <th className="text-left">Transaction</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={`${l.txid}-${i}`}>
                <td>{l.pending ? "Pending" : formatDate(l.block_time ?? l.date)}</td>
                <td>{payeeOf(l)}</td>
                <td>
                  {formatPeriodLabel(l.period)} {l.run_id.slice(0, 8)}
                </td>
                <td>{l.invoice_ref}</td>
                <td className="text-right">
                  <Usd cents={l.usd_basis_cents} />
                </td>
                <td className="text-right">
                  <Zec zat={l.amount_zat} unit={false} />
                </td>
                <td className="font-mono break-all">{l.txid}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section>
        <h2 className="text-[12pt] font-normal">Exceptions ({formatCount(ex.total)})</h2>
        <P>
          Keys missing: {ex.missingKeys.length}. Unpaid: {ex.unpaid.length}. No funding record: {ex.noFunding.length}.
          Unexplained variance: {ex.unexplained.length}. Not fully mined: {ex.incomplete.length}. Unlabelled
          transactions: {ex.unlabelled.length}.
        </P>
        {ex.unlabelled.length ? (
          <table>
            <thead>
              <tr>
                <th className="text-left">Date</th>
                <th className="text-left">Account</th>
                <th className="text-right">
                  <Coin />
                </th>
                <th className="text-left">Why</th>
                <th className="text-left">Memo</th>
                <th className="text-left">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {ex.unlabelled.map((u, i) => (
                <tr key={`${u.txid}-${i}`}>
                  <td>{formatDate(u.date)}</td>
                  <td>
                    {u.label ?? (u.account ? `Unlabelled ${u.account.slice(0, 8)}` : "Unlabelled")} (
                    {u.direction === "in" ? "received" : "sent"})
                  </td>
                  <td className="text-right">
                    <Zec zat={u.amount_zat} unit={false} />
                  </td>
                  <td>{UNLABELLED_REASON[u.reason]?.label ?? u.reason}</td>
                  <td>{u.memo_text ?? ""}</td>
                  <td className="font-mono break-all">{u.txid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>
    </article>
  );
}
