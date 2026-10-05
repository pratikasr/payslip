"use client";

import { useId, useState } from "react";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCount, formatPeriodLabel, formatUsd } from "@/lib/format";
import { formatUsdCompact, niceMax, type PeriodTotal } from "@/lib/insights";
import { cn } from "cn";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthParts(period: string, first: boolean): { month: string; year: string | null } {
  const [year, month] = period.split("-");
  return { month: MONTHS[Number(month) - 1] ?? period, year: first || month === "01" ? year : null };
}

/**
 * Payroll by period: one column per month, paid (confirmed) at the base and
 * not paid yet stacked above it in the lighter step of the same hue. Hover or
 * arrow keys show a readout; the table twin carries every value.
 */
export function PeriodChart({ periods, view }: { periods: PeriodTotal[]; view: "chart" | "table" }) {
  const titleId = useId();
  const [active, setActive] = useState<number | null>(null);
  const hasOpen = periods.some((p) => p.openCents > 0);
  // Headroom above the tallest column for its label.
  const max = niceMax(Math.max(...periods.map((p) => p.paidCents + p.openCents), 0) * 1.12);
  const ticks = [max, max / 2, 0];
  const withRuns = periods.filter((p) => p.runs > 0);
  const latest = [...periods].reverse().find((p) => p.paidCents + p.openCents > 0);
  const peak = periods.reduce<PeriodTotal | undefined>(
    (best, p) => (!best || p.paidCents + p.openCents > best.paidCents + best.openCents ? p : best),
    undefined,
  );

  const summary =
    withRuns.length === 0
      ? "No runs yet."
      : withRuns
          .map(
            (p) =>
              `${formatPeriodLabel(p.period)}: ${formatUsd(p.paidCents)} paid${p.openCents > 0 ? `, ${formatUsd(p.openCents)} not paid yet` : ""}`,
          )
          .join("; ") + ".";

  const move = (delta: number | "first" | "last") => {
    setActive((cur) => {
      if (delta === "first") return 0;
      if (delta === "last") return periods.length - 1;
      if (cur === null) return delta > 0 ? 0 : periods.length - 1;
      return Math.min(periods.length - 1, Math.max(0, cur + delta));
    });
  };

  const current = active !== null ? periods[active] : null;

  return (
    <figure className="min-w-0 space-y-3" aria-labelledby={titleId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <figcaption id={titleId} className="text-sm font-semibold">
          Payroll by period, USD
        </figcaption>
        {hasOpen ? (
          <ul className="flex items-center gap-3 text-xs text-muted-foreground" aria-label="Legend">
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-[2px] bg-viz" />
              Paid
            </li>
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className="size-2.5 rounded-[2px] bg-viz-soft" />
              Not paid yet
            </li>
          </ul>
        ) : null}
      </div>

      {view === "table" ? (
        <Table label="Payroll by period" minWidth={420}>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead numeric>Runs</TableHead>
              <TableHead numeric>Payments</TableHead>
              <TableHead numeric>Paid USD</TableHead>
              <TableHead numeric>Not paid yet</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {periods.map((p) => (
              <TableRow key={p.period}>
                <TableCell>{formatPeriodLabel(p.period)}</TableCell>
                <TableCell numeric>
                  {p.runs === 0 ? <span className="text-muted-foreground">No runs</span> : p.runs}
                </TableCell>
                <TableCell numeric>{formatCount(p.payments)}</TableCell>
                <TableCell numeric>{formatUsd(p.paidCents)}</TableCell>
                <TableCell numeric>{formatUsd(p.openCents)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="hover:bg-transparent">
              <TableCell>Total</TableCell>
              <TableCell numeric>{periods.reduce((s, p) => s + p.runs, 0)}</TableCell>
              <TableCell numeric>{formatCount(periods.reduce((s, p) => s + p.payments, 0))}</TableCell>
              <TableCell numeric>{formatUsd(periods.reduce((s, p) => s + p.paidCents, 0))}</TableCell>
              <TableCell numeric>{formatUsd(periods.reduce((s, p) => s + p.openCents, 0))}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      ) : (
        <>
          <p className="sr-only">{summary}</p>
          <div
            role="group"
            aria-label="Payroll by period chart. Use the arrow keys to read each month."
            tabIndex={0}
            onKeyDown={(e) => {
              const keys: Record<string, number | "first" | "last"> = {
                ArrowRight: 1,
                ArrowDown: 1,
                ArrowLeft: -1,
                ArrowUp: -1,
                Home: "first",
                End: "last",
              };
              if (e.key in keys) {
                e.preventDefault();
                move(keys[e.key]);
              } else if (e.key === "Escape") setActive(null);
            }}
            onBlur={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
            className="relative grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 rounded-md"
          >
            {/* Y axis: three round ticks, compact (charts abbreviate; tables never do). */}
            <div aria-hidden="true" className="relative h-40 w-10 text-right text-[0.6875rem] text-muted-foreground">
              {ticks.map((t, i) => (
                <span key={t} className="num absolute right-0 -translate-y-1/2" style={{ top: `${(i / 2) * 100}%` }}>
                  {formatUsdCompact(t)}
                </span>
              ))}
            </div>
            <div className="relative h-40" aria-hidden="true">
              {ticks.map((t, i) => (
                <div
                  key={t}
                  className={cn("absolute inset-x-0 h-px", i === 2 ? "bg-input/70" : "bg-border")}
                  style={{ top: `${(i / 2) * 100}%` }}
                />
              ))}
              <div className="absolute inset-0 flex items-end">
                {periods.map((p, i) => {
                  const total = p.paidCents + p.openCents;
                  const paidPct = (p.paidCents / max) * 100;
                  const openPct = (p.openCents / max) * 100;
                  const labelled = total > 0 && (p === latest || p === peak);
                  return (
                    <div
                      key={p.period}
                      onPointerEnter={() => setActive(i)}
                      className={cn(
                        "relative flex h-full flex-1 flex-col items-center justify-end",
                        active === i && "bg-muted/60",
                      )}
                    >
                      {labelled ? (
                        <span className="num mb-1 text-[0.6875rem] font-medium whitespace-nowrap text-foreground">
                          {formatUsdCompact(total)}
                        </span>
                      ) : null}
                      {p.openCents > 0 ? (
                        <div
                          className={cn(
                            "w-[min(24px,60%)] bg-viz-soft transition-[height] duration-500",
                            "rounded-t-[4px]",
                            p.paidCents > 0 && "mb-[2px]",
                          )}
                          style={{ height: `max(${openPct}%, 2px)` }}
                        />
                      ) : null}
                      {p.paidCents > 0 ? (
                        <div
                          className={cn(
                            "w-[min(24px,60%)] bg-viz transition-[height] duration-500",
                            p.openCents === 0 && "rounded-t-[4px]",
                          )}
                          style={{ height: `max(${paidPct}%, 2px)` }}
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
              {current ? <PeriodTooltip p={current} index={active!} count={periods.length} /> : null}
            </div>
            <div />
            <div aria-hidden="true" className="mt-1.5 flex text-[0.6875rem] text-muted-foreground">
              {periods.map((p, i) => {
                const { month, year } = monthParts(p.period, i === 0);
                return (
                  <span
                    key={p.period}
                    className={cn(
                      "flex-1 text-center leading-tight",
                      periods.length > 8 && i % 2 === 1 && i !== periods.length - 1 && "max-sm:invisible",
                    )}
                  >
                    <span className="block">{month}</span>
                    {year ? <span className="block text-[0.625rem]">{year}</span> : null}
                  </span>
                );
              })}
            </div>
          </div>
          <p className="sr-only" aria-live="polite">
            {current
              ? `${formatPeriodLabel(current.period)}: ${formatUsd(current.paidCents)} paid, ${formatUsd(current.openCents)} not paid yet, ${current.runs} ${current.runs === 1 ? "run" : "runs"}.`
              : ""}
          </p>
        </>
      )}
    </figure>
  );
}

function PeriodTooltip({ p, index, count }: { p: PeriodTotal; index: number; count: number }) {
  const center = ((index + 0.5) / count) * 100;
  const align = center < 25 ? "translate-x-0" : center > 75 ? "-translate-x-full" : "-translate-x-1/2";
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute top-1 z-10 min-w-40 rounded-md border bg-popover px-3 py-2 text-xs shadow-md",
        align,
      )}
      style={{ left: `${center}%` }}
    >
      <p className="mb-1.5 text-muted-foreground">
        {formatPeriodLabel(p.period)}, {p.runs === 0 ? "no runs" : `${p.runs} ${p.runs === 1 ? "run" : "runs"}`}
      </p>
      <p className="flex items-center justify-between gap-4">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span className="h-0.5 w-3 rounded-full bg-viz" />
          Paid
        </span>
        <span className="num font-semibold text-foreground">{formatUsd(p.paidCents)}</span>
      </p>
      {p.openCents > 0 ? (
        <p className="mt-1 flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="h-0.5 w-3 rounded-full bg-viz-soft" />
            Not paid yet
          </span>
          <span className="num font-semibold text-foreground">{formatUsd(p.openCents)}</span>
        </p>
      ) : null}
    </div>
  );
}
