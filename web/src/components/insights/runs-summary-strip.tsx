"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Usd, Zec } from "@/components/app/amount";
import { Stat } from "@/components/app/states";
import type { Contractor, Network, Run } from "@/lib/api";
import { formatCount, formatPeriodLabel, formatUsd } from "@/lib/format";
import { computeInsights } from "@/lib/insights";
import { cn } from "cn";

/**
 * The compact form of the payer insights for the runs list: three figures and
 * a sparkline of paid USD per period (history in grey, the latest period in
 * the chart hue). The full charts and their tables live on the overview.
 */
export function RunsSummaryStrip({
  runs,
  contractors,
  network,
}: {
  runs: Run[];
  contractors: Contractor[];
  network: Network | undefined;
}) {
  const data = useMemo(() => computeInsights(runs, contractors, network), [runs, contractors, network]);
  if (data.runCount === 0) return null;
  const inFlight = data.statusGroups.find((g) => g.id === "progress")?.count ?? 0;
  const toFund = data.statusGroups.find((g) => g.id === "open")?.count ?? 0;
  const max = Math.max(...data.periods.map((p) => p.paidCents + p.openCents), 1);
  const lastWithPay = [...data.periods].reverse().find((p) => p.paidCents + p.openCents > 0);
  const summary = data.periods
    .filter((p) => p.runs > 0)
    .map((p) => `${formatPeriodLabel(p.period)} ${formatUsd(p.paidCents)} paid`)
    .join(", ");

  return (
    <section aria-label="Payroll summary" className="rounded-lg border bg-card">
      <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,1.3fr)] lg:items-end">
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-3">
          <Stat
            label="Paid to date"
            hint={`${formatCount(data.payments)} ${data.payments === 1 ? "payment" : "payments"}`}
          >
            <Usd cents={data.paidCents} />
          </Stat>
          <Stat label="Not paid yet" hint={`${formatCount(toFund)} to fund, ${formatCount(inFlight)} in progress`}>
            <Usd cents={data.openCents} />
          </Stat>
          <Stat
            label="Network fees paid"
            hint={`Across ${formatCount(data.feeRuns)} ${data.feeRuns === 1 ? "run" : "runs"}`}
          >
            <Zec zat={data.feesZat} />
          </Stat>
        </dl>
        <div className="min-w-0 space-y-1.5">
          <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
            <span>Paid by period</span>
            <Link href="/app/payer#insights" className="font-medium text-link underline">
              All insights
            </Link>
          </div>
          <div
            role="img"
            aria-label={`Paid USD by period: ${summary || "no runs yet"}.`}
            className="flex h-10 items-end gap-[2px]"
          >
            {data.periods.map((p) => {
              const total = p.paidCents + p.openCents;
              return (
                <span key={p.period} className="flex h-full flex-1 items-end justify-center">
                  <span
                    className={cn(
                      "w-full max-w-6 rounded-t-[3px]",
                      p === lastWithPay ? "bg-viz" : "bg-muted-foreground/40",
                      total === 0 && "bg-border",
                    )}
                    style={{ height: total === 0 ? 2 : `max(${(total / max) * 100}%, 3px)` }}
                  />
                </span>
              );
            })}
          </div>
          <div aria-hidden="true" className="flex justify-between text-[0.6875rem] text-muted-foreground">
            <span>{data.periods[0] ? formatPeriodLabel(data.periods[0].period) : ""}</span>
            <span>{data.periods.at(-1) ? formatPeriodLabel(data.periods.at(-1)!.period) : ""}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
