"use client";

import { useId } from "react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCount, formatUsd } from "@/lib/format";
import type { ContractorTotal } from "@/lib/insights";
import { cn } from "cn";

const MAX_ROWS = 8;

/**
 * Paid USD per contractor, highest first. One series, so every bar wears the
 * same hue and there is no legend; each value sits at its bar's tip. Past
 * eight people the tail folds into one "others" row in the de-emphasis grey.
 */
export function ContractorChart({ contractors, view }: { contractors: ContractorTotal[]; view: "chart" | "table" }) {
  const titleId = useId();
  const shown = contractors.slice(0, contractors.length > MAX_ROWS ? MAX_ROWS - 1 : MAX_ROWS);
  const rest = contractors.slice(shown.length);
  const rows: (ContractorTotal & { other?: boolean })[] = [...shown];
  if (rest.length > 0) {
    rows.push({
      id: "others",
      name: `${rest.length} others`,
      paidCents: rest.reduce((s, c) => s + c.paidCents, 0),
      payments: rest.reduce((s, c) => s + c.payments, 0),
      archived: false,
      other: true,
    });
  }
  const max = Math.max(...rows.map((r) => r.paidCents), 1);
  const total = contractors.reduce((s, c) => s + c.paidCents, 0);

  return (
    <figure className="min-w-0 space-y-3" aria-labelledby={titleId}>
      <figcaption id={titleId} className="text-sm font-semibold">
        Paid by contractor, USD
      </figcaption>
      {view === "table" ? (
        <Table label="Paid by contractor" minWidth={360}>
          <TableHeader>
            <TableRow>
              <TableHead>Contractor</TableHead>
              <TableHead numeric>Payments</TableHead>
              <TableHead numeric>Paid USD</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contractors.map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  {c.name}
                  {c.archived ? <span className="ml-1 text-xs text-muted-foreground">(archived)</span> : null}
                </TableCell>
                <TableCell numeric>{formatCount(c.payments)}</TableCell>
                <TableCell numeric>{formatUsd(c.paidCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell>Total</TableCell>
              <TableCell numeric>{formatCount(contractors.reduce((s, c) => s + c.payments, 0))}</TableCell>
              <TableCell numeric>{formatUsd(total)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      ) : (
        <ul className="space-y-1" aria-label="Paid by contractor">
          {rows.map((r) => {
            const pct = (r.paidCents / max) * 100;
            return (
              <li
                key={r.id}
                className="grid grid-cols-1 gap-1 py-1 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:items-center sm:gap-x-3"
              >
                <span className="min-w-0 truncate text-sm" title={r.name}>
                  {r.name}
                  <span className="sr-only">
                    : {formatUsd(r.paidCents)} in {r.payments} {r.payments === 1 ? "payment" : "payments"}
                  </span>
                </span>
                {/* The scale is the track minus room for the label, so bar lengths stay proportional. */}
                <span aria-hidden="true" className="block pr-[5.75rem]">
                  <span className="relative block h-3">
                    <span
                      className={cn(
                        "absolute inset-y-0 left-0 rounded-r-[4px] transition-[width] duration-500",
                        r.other ? "bg-muted-foreground/60" : "bg-viz",
                      )}
                      style={{ width: `max(${pct}%, 2px)` }}
                    />
                    <span
                      className="num absolute top-1/2 -translate-y-1/2 pl-2 text-xs font-medium whitespace-nowrap"
                      style={{ left: `${pct}%` }}
                    >
                      {formatUsd(r.paidCents)}
                    </span>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </figure>
  );
}
