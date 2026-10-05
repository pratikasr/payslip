"use client";

import { Usd, Zec } from "@/components/app/amount";
import { Hash } from "@/components/app/hash";
import { Initials } from "@/components/ds/avatar";
import type { PayLine, Run } from "@/lib/api";
import { formatHeight } from "@/lib/format";
import { cn } from "cn";
import { LineTag, plural, usdCentsToZat } from "./run-meta";

/**
 * The run's payments as a Mercury table on the page: person, invoice, USD with ZEC under it,
 * status, transaction and block. A row opens the payment's detail panel.
 */
export function PayLinesTable({
  run,
  changed,
  onOpen,
}: {
  run: Run;
  changed: ReadonlySet<string>;
  onOpen: (line: PayLine) => void;
}) {
  if (run.lines.length === 0) {
    return <p className="py-6 text-[0.9375rem] text-muted-foreground">This run has no payments.</p>;
  }
  return (
    <div className="-mx-1 overflow-x-auto px-1" data-print-scroll="">
      <table className="w-full border-collapse text-[0.9375rem]">
        <caption className="sr-only">Payments in this run. Choose a name to see the payment&apos;s history.</caption>
        <thead>
          <tr className="border-b border-hairline text-left text-[0.8125rem] text-muted-foreground">
            <th scope="col" className="py-2.5 pr-3 font-normal">
              Person
            </th>
            <th scope="col" className="hidden py-2.5 pr-3 font-normal md:table-cell">
              Invoice
            </th>
            <th scope="col" className="py-2.5 pr-3 text-right font-normal sm:pr-6">
              Amount
            </th>
            <th scope="col" className="py-2.5 pr-3 font-normal">
              Status
            </th>
            <th scope="col" className="hidden py-2.5 pr-3 font-normal lg:table-cell">
              Transaction
            </th>
            <th scope="col" className="hidden py-2.5 text-right font-normal sm:table-cell">
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
                    <span className="block truncate text-[0.8125rem] text-muted-foreground md:hidden">
                      {l.invoice_ref || "No invoice"}
                    </span>
                  </div>
                </div>
              </td>
              <td className="hidden py-2 pr-3 text-strong md:table-cell">
                {l.invoice_ref || <span className="text-muted-foreground">None</span>}
              </td>
              <td className={cn("py-2 pr-3 text-right sm:pr-6", l.status === "failed" && "line-through")}>
                <Usd cents={l.amount_usd_cents} />
                <span className="block text-[0.8125rem] text-muted-foreground">
                  <LineZec line={l} rate={run.funding?.rate_usd_per_zec_e6 ?? null} />
                </span>
              </td>
              <td className="py-2 pr-3">
                <span key={l.status} className={cn("inline-block", changed.has(l.id) && "ps-rise")}>
                  <LineTag status={l.status} />
                </span>
              </td>
              <td className="hidden py-2 pr-3 lg:table-cell" onClick={(e) => e.stopPropagation()}>
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
            <td className="hidden md:table-cell" />
            <td className="py-3 pr-3 text-right sm:pr-6">
              <Usd cents={run.total_usd_cents} />
              {run.total_zat ? (
                <span className="block text-[0.8125rem] text-muted-foreground">
                  <Zec zat={run.total_zat} short />
                </span>
              ) : null}
            </td>
            <td />
            <td className="hidden lg:table-cell" />
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
