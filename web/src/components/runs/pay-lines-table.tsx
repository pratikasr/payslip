"use client";

import { Usd, Zec } from "@/components/app/amount";
import { Hash } from "@/components/app/hash";
import { Initials } from "@/components/ds/avatar";
import { SHIELDED_HELP } from "@/components/ds/status";
import { Tag } from "@/components/ds/tag";
import type { PayLine, Run } from "@/lib/api";
import { formatClock, formatHeight, formatShortDate } from "@/lib/format";
import { cn } from "cn";
import { LineStatus, liveQuoteRate, plural, usdCentsToZat } from "./run-meta";

const NONE: ReadonlySet<string> = new Set();

/** Clicks on the copy button or explorer link act on them alone; anywhere else opens the row. */
function keepInside(e: React.MouseEvent) {
  if ((e.target as HTMLElement).closest("a,button")) e.stopPropagation();
}

/**
 * The run's payments as a Mercury table on the page: person, invoice, USD with ZEC under it,
 * status, transaction and block. A row opens the payment's detail panel.
 */
export function PayLinesTable({
  run,
  changed,
  archived = NONE,
  onOpen,
}: {
  run: Run;
  changed: ReadonlySet<string>;
  /** Lines whose contractor was archived after the run was made. */
  archived?: ReadonlySet<string>;
  onOpen: (line: PayLine) => void;
}) {
  const rate = run.funding?.rate_usd_per_zec_e6 ?? liveQuoteRate(run);
  if (run.lines.length === 0) {
    return <p className="py-6 text-[0.9375rem] text-muted-foreground">This run has no payments.</p>;
  }
  return (
    <div className="-mx-1 overflow-x-auto px-1" data-print-scroll="">
      {/* Fixed layout: a long name truncates in its column instead of widening the page. */}
      <table className="w-full table-fixed border-collapse text-[0.9375rem]">
        <caption className="sr-only">
          Payments in this run. Shielded: {SHIELDED_HELP.toLowerCase()}. Choose a name to see the payment&apos;s
          history.
        </caption>
        <thead>
          <tr className="border-b border-hairline text-left text-[0.8125rem] text-muted-foreground">
            <th scope="col" className="py-2.5 pr-3 font-normal">
              Person
            </th>
            <th scope="col" className="hidden w-[9rem] py-2.5 pr-3 font-normal lg:table-cell">
              Invoice
            </th>
            <th scope="col" className="w-[7.5rem] py-2.5 pr-3 text-right font-normal sm:w-[9.5rem] sm:pr-6">
              Amount
            </th>
            <th scope="col" className="hidden w-[8rem] py-2.5 pr-3 font-normal sm:table-cell">
              Status
            </th>
            <th scope="col" className="hidden w-[10.5rem] py-2.5 pr-3 font-normal xl:table-cell">
              Transaction
            </th>
            <th scope="col" className="hidden w-[6.5rem] py-2.5 text-right font-normal sm:table-cell">
              Block
            </th>
          </tr>
        </thead>
        <tbody>
          {run.lines.map((l) => (
            <tr
              key={l.id}
              onClick={() => onOpen(l)}
              className={cn(
                "cursor-pointer border-b border-hairline transition-colors hover:bg-raised",
                changed.has(l.id) && "ps-flash",
              )}
            >
              <td className="h-[58px] py-2 pr-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Initials name={l.contractor_name} />
                  <div className="min-w-0">
                    <button
                      type="button"
                      data-line-open={l.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(l);
                      }}
                      className="block max-w-full truncate rounded-sm text-left text-foreground hover:underline"
                    >
                      {l.contractor_name}
                    </button>
                    <span className="block truncate text-[0.8125rem] text-muted-foreground lg:hidden">
                      {l.invoice_ref || "No invoice"}
                    </span>
                    {/* Phones have no Status column: the state sits under the name. */}
                    <span className="block sm:hidden">
                      <LineStatus line={l} run={run} />
                    </span>
                    {archived.has(l.id) ? (
                      <Tag className="mt-0.5" title="Archived after this run was made">
                        Archived
                      </Tag>
                    ) : null}
                  </div>
                </div>
              </td>
              <td className="hidden truncate py-2 pr-3 text-strong lg:table-cell" title={l.invoice_ref || undefined}>
                {l.invoice_ref || <span className="text-muted-foreground">None</span>}
              </td>
              <td className={cn("py-2 pr-3 text-right sm:pr-6", l.status === "failed" && "line-through")}>
                <Usd cents={l.amount_usd_cents} />
                <span className="block text-[0.8125rem] text-muted-foreground">
                  <LineZec line={l} rate={rate} />
                </span>
              </td>
              <td className="hidden py-2 pr-3 sm:table-cell">
                <span key={l.status} className={cn("inline-block", changed.has(l.id) && "ps-rise")}>
                  <LineStatus line={l} run={run} />
                  {l.status === "confirmed" && l.confirmed_at ? (
                    <span className="block text-[0.8125rem] text-muted-foreground">
                      <time dateTime={l.confirmed_at}>
                        {formatShortDate(l.confirmed_at)}, {formatClock(l.confirmed_at)}
                      </time>
                    </span>
                  ) : null}
                </span>
              </td>
              <td className="hidden py-2 pr-3 xl:table-cell" onClick={keepInside}>
                <Hash
                  value={l.txid}
                  label={`transaction id for ${l.contractor_name}`}
                  explorerUrl={l.explorer_url}
                  head={6}
                  tail={4}
                  empty="Not sent"
                />
              </td>
              <td className="hidden py-2 text-right whitespace-nowrap text-strong sm:table-cell">
                {l.confirmed_height ? (
                  <span className="num">{formatHeight(l.confirmed_height)}</span>
                ) : (
                  <span className="text-muted-foreground">Not mined</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="text-[0.9375rem]">
            <td className="py-3 pr-3 text-strong">Total, {plural(run.lines.length, "person", "people")}</td>
            <td className="hidden lg:table-cell" />
            <td className="py-3 pr-3 text-right sm:pr-6">
              <Usd cents={run.total_usd_cents} />
              {run.total_zat ? (
                <span className="block text-[0.8125rem] text-muted-foreground">
                  <Zec zat={run.total_zat} short />
                </span>
              ) : null}
            </td>
            <td className="hidden sm:table-cell" />
            <td className="hidden xl:table-cell" />
            <td className="hidden sm:table-cell" />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** The line's ZEC once set; before that, the estimate at the funding rate, or when it will be set. */
function LineZec({ line, rate }: { line: PayLine; rate: number | null }) {
  if (line.amount_zat) return <Zec zat={line.amount_zat} short />;
  const estimate = rate ? usdCentsToZat(line.amount_usd_cents, rate) : null;
  if (estimate === null) return <>At funding</>;
  return (
    <>
      about <Zec zat={estimate} short />
    </>
  );
}
