"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChartColumn, Table2 } from "lucide-react";
import { Usd, Zec } from "@/components/app/amount";
import { useCoinUnit } from "@/components/app/health-provider";
import { EmptyState, Panel, Stat } from "@/components/app/states";
import { ContractorChart } from "@/components/insights/contractor-chart";
import { PeriodChart } from "@/components/insights/period-chart";
import { StatusChart } from "@/components/insights/status-chart";
import { Button } from "@/components/ui/button";
import type { Contractor, Network, Run } from "@/lib/api";
import { formatCount, formatZec } from "@/lib/format";
import { computeInsights } from "@/lib/insights";
import { cn } from "cn";

/**
 * Payroll insights on the payer overview. Every figure is derived from
 * GET /api/runs and GET /api/contractors; "paid" means confirmed on chain.
 */
export function PayrollInsights({
  runs,
  contractors,
  network,
}: {
  runs: Run[];
  contractors: Contractor[];
  network: Network | undefined;
}) {
  const coin = useCoinUnit();
  const [view, setView] = useState<"chart" | "table">("chart");
  const data = useMemo(() => computeInsights(runs, contractors, network), [runs, contractors, network]);
  const feePerPayment = data.payments > 0 ? Math.round(data.feesZat / data.payments) : null;

  return (
    <Panel
      id="insights"
      title="Payroll insights"
      description="From your runs. Paid means the payment is confirmed in a block; amounts are the USD owed on each line."
      actions={
        data.runCount > 0 ? (
          <div role="group" aria-label="Show insights as" className="flex rounded-md border p-0.5">
            <ViewButton pressed={view === "chart"} onClick={() => setView("chart")}>
              <ChartColumn aria-hidden="true" />
              Charts
            </ViewButton>
            <ViewButton pressed={view === "table"} onClick={() => setView("table")}>
              <Table2 aria-hidden="true" />
              Tables
            </ViewButton>
          </div>
        ) : null
      }
    >
      {data.runCount === 0 ? (
        <EmptyState
          icon={<ChartColumn />}
          title="Insights appear after your first run"
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/app/payer/runs/new">Create a run</Link>
            </Button>
          }
        >
          Payroll by period, what each contractor was paid, network fees and runs by status, all read from your runs.
        </EmptyState>
      ) : (
        <>
          <dl className="grid grid-cols-1 gap-6 p-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              size="lg"
              label="Paid to date"
              hint={
                <>
                  {formatCount(data.payments)} {data.payments === 1 ? "payment" : "payments"},{" "}
                  <span className="num">
                    {formatZec(data.paidZat)} {coin}
                  </span>
                </>
              }
            >
              <Usd cents={data.paidCents} />
            </Stat>
            <Stat label="Not paid yet" hint="Lines in runs that are not confirmed yet">
              <Usd cents={data.openCents} />
            </Stat>
            <Stat
              label="Network fees paid"
              hint={
                data.feesUsdCents !== null ? (
                  <>
                    About <Usd cents={data.feesUsdCents} /> at each run&apos;s fill rate
                  </>
                ) : feePerPayment !== null ? (
                  <span className="num">
                    About {formatZec(feePerPayment)} {coin} per payment
                    {network === "testnet" ? "; testnet coins have no USD price" : ""}
                  </span>
                ) : (
                  "Recorded when a run executes"
                )
              }
            >
              <Zec zat={data.feesZat} />
            </Stat>
            <Stat label="Contractors paid" hint={`${formatCount(contractors.length)} active in total`}>
              <span className="num">{formatCount(data.contractors.length)}</span>
            </Stat>
          </dl>

          <div className="grid gap-8 border-t p-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:gap-10">
            <PeriodChart periods={data.periods} view={view} />
            {data.contractors.length > 0 ? (
              <ContractorChart contractors={data.contractors} view={view} />
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-semibold">Paid by contractor, USD</p>
                <p className="text-sm text-muted-foreground">
                  Nobody has a confirmed payment yet. Each contractor appears here once a run pays them.
                </p>
              </div>
            )}
          </div>

          <div className="border-t p-4">
            <StatusChart groups={data.statusGroups} total={data.runCount} />
          </div>
          {data.periodsTruncated ? (
            <p className="border-t px-4 py-2 text-xs text-muted-foreground">
              The chart shows the latest 12 periods. Every run is listed under Runs.
            </p>
          ) : null}
        </>
      )}
    </Panel>
  );
}

function ViewButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-[5px] px-2 text-xs text-muted-foreground hover:text-foreground [&_svg]:size-3.5",
        pressed && "bg-muted font-medium text-foreground",
      )}
    >
      {children}
    </button>
  );
}
