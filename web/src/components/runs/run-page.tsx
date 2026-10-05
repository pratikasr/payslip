"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Repeat } from "lucide-react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { Rate, Usd, Zec } from "@/components/app/amount";
import { CopyButton } from "@/components/app/copy-button";
import { Card } from "@/components/ds/card";
import { PageTitle } from "@/components/ds/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { useRunEvents } from "@/hooks/use-run-events";
import { api, type PayLine, type Run, type RunLogEvent } from "@/lib/api";
import { formatDate, formatRange, truncateMiddle } from "@/lib/format";
import { cn } from "cn";
import { AuditTrail } from "./audit-trail";
import { LineDrawer } from "./line-drawer";
import { PayLinesTable } from "./pay-lines-table";
import { PrivacyView } from "./privacy-view";
import { Problem } from "./problem";
import { RatePill } from "./new-run/review-step";
import { confirmedCount, estimateZat, isPaying, newerRun, plural, RunTag, runTitle } from "./run-meta";
import { useLineChanges } from "./use-line-changes";

const TABS = [
  { id: "lines", label: "Pay lines" },
  { id: "privacy", label: "Privacy view" },
  { id: "audit", label: "Audit trail" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const NO_LINES: PayLine[] = [];

/** One payroll run: header, figures, the next action while there is one, then tabs. */
export function RunPage({ runId, initial }: { runId: string; initial?: Run }) {
  const fetched = useResource((s) => api.run(runId, s), `console-run-${runId}`, initial);
  const stream = useRunEvents(runId, !!fetched.data && fetched.data.status !== "paid");
  const history = useResource((s) => api.runLog(runId, s), `console-run-log-${runId}`);
  const run = newerRun(fetched.data, stream.run);
  const changed = useLineChanges(run?.lines ?? NO_LINES);
  const [tab, setTab] = useState<TabId>("lines");
  const [openId, setOpenId] = useState<string | null>(null);

  // A tab can be linked to: /console/runs/<id>#privacy.
  useEffect(() => {
    const fromHash = window.location.hash.slice(1);
    if (TABS.some((t) => t.id === fromHash)) setTab(fromHash as TabId);
  }, []);
  const changeTab = useCallback((value: string) => {
    setTab(value as TabId);
    try {
      window.history.replaceState(null, "", value === "lines" ? window.location.pathname : `#${value}`);
    } catch {
      // History can be unavailable in some embedded views; the tab still changes.
    }
  }, []);

  const logs = useMemo(() => {
    const seen = new Set<string>();
    return [...(history.data ?? []), ...stream.logs]
      .filter((l: RunLogEvent) => {
        const key = `${l.at}|${l.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }, [history.data, stream.logs]);

  const back = (
    <Link href="/console/runs" className="inline-flex items-center gap-1 rounded-sm hover:text-foreground">
      <ChevronLeft className="size-4" aria-hidden="true" />
      Payroll runs
    </Link>
  );

  if (!run && fetched.error) {
    return (
      <>
        <PageTitle back={back} title={fetched.error.status === 404 ? "Run not found" : "Payroll run"} />
        {fetched.error.status === 404 ? (
          <p className="text-[0.9375rem] text-muted-foreground">
            No run has this id. It may have been discarded while it was a draft.
          </p>
        ) : (
          <Problem error={fetched.error} title="Could not load this run" onRetry={() => void fetched.reload()} />
        )}
      </>
    );
  }
  if (!run) {
    return (
      <div role="status" aria-label="Loading the run" className="space-y-5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const openLine = run.lines.find((l) => l.id === openId) ?? null;

  return (
    <>
      <PageTitle
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {runTitle(run)} payroll
            <RunTag status={run.status} className="translate-y-[-2px]" />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span>{formatRange(run.period_start, run.period_end)}</span>
            <span aria-hidden="true">·</span>
            <span>Created {formatDate(run.created_at)}</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-0.5">
              Run{" "}
              <code className="font-mono text-[0.8125rem]" title={run.id}>
                {truncateMiddle(run.id, 8, 4)}
              </code>
              <CopyButton value={run.id} label="run id" />
            </span>
          </span>
        }
        actions={
          run.status === "paid" && run.lines.length > 0 ? (
            <Button asChild variant="secondary">
              <Link href={`/console/runs/new?repeat=${run.id}`}>
                <Repeat aria-hidden="true" />
                Run again
              </Link>
            </Button>
          ) : undefined
        }
      />

      <SummaryStrip run={run} />

      <NextAction run={run} />

      <TabsPrimitive.Root value={tab} onValueChange={changeTab} className="mt-8">
        <TabsPrimitive.List aria-label="Run details" className="flex gap-6 overflow-x-auto border-b border-hairline">
          {TABS.map((t) => (
            <TabsPrimitive.Trigger
              key={t.id}
              value={t.id}
              className="relative inline-flex h-10 shrink-0 items-center gap-1.5 rounded-sm text-[0.9375rem] whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid data-[state=active]:text-foreground data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:bottom-[-1px] data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-primary-edge"
            >
              {t.label}
              {t.id === "lines" ? (
                <span className="num rounded-[4px] bg-chip px-1.5 text-xs leading-5 text-strong">
                  {run.lines.length}
                </span>
              ) : null}
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>
        <TabsPrimitive.Content value="lines" className="outline-none">
          <PayLinesTable run={run} changed={changed} onOpen={(l) => setOpenId(l.id)} />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="privacy" className="pt-5 outline-none">
          <PrivacyView run={run} />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="audit" className="pt-5 outline-none">
          <AuditTrail run={run} logs={logs} loading={history.loading} error={history.error} />
        </TabsPrimitive.Content>
      </TabsPrimitive.Root>

      <LineDrawer run={run} line={openLine} logs={logs} onClose={() => setOpenId(null)} />
    </>
  );
}

function Figure({
  label,
  children,
  sub,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.8125rem] text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-[1.1875rem] leading-tight">{children}</dd>
      {sub ? <dd className="mt-0.5 text-[0.8125rem] text-muted-foreground">{sub}</dd> : null}
    </div>
  );
}

/** Mercury's figure strip: total, ZEC paid, rate, fees, funded. */
function SummaryStrip({ run }: { run: Run }) {
  const f = run.funding;
  const testnet = f?.venue === "testnet-fixed-rate" || run.network === "testnet";
  const muted = "text-[0.9375rem] text-muted-foreground";
  // Funded but not yet sent: the executor converts each line at the funding rate.
  const estimate = run.total_zat
    ? null
    : estimateZat(
        run.lines.map((l) => l.amount_usd_cents),
        f?.rate_usd_per_zec_e6,
      );
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-hairline py-5 sm:grid-cols-3 lg:grid-cols-5">
      <Figure label="Total">
        <Usd cents={run.total_usd_cents} />
      </Figure>
      <Figure label={run.status === "paid" ? "Paid" : "To pay"}>
        {run.status === "paid" && run.total_zat ? (
          <span className="grid">
            <Usd cents={run.lines.reduce((s, l) => s + (l.status === "confirmed" ? l.amount_usd_cents : 0), 0)} />
            <Zec zat={run.total_zat} short className="text-xs text-muted-foreground" />
          </span>
        ) : run.total_zat ? (
          <Zec zat={run.total_zat} short />
        ) : estimate !== null ? (
          <span>
            about <Zec zat={estimate} short />
          </span>
        ) : (
          <span className={muted}>Set at funding</span>
        )}
      </Figure>
      <Figure label="Rate" sub={testnet && f?.rate_usd_per_zec_e6 ? <Rate e6={f.rate_usd_per_zec_e6} /> : undefined}>
        {testnet ? (
          <RatePill title="Testnet coins have no price, so the testnet venue converts at a fixed rate.">
            Simulated rate
          </RatePill>
        ) : f?.rate_usd_per_zec_e6 ? (
          <Rate e6={f.rate_usd_per_zec_e6} />
        ) : (
          <span className={muted}>Set at funding</span>
        )}
      </Figure>
      <Figure label="Network fees">
        {run.fees_zat ? <Zec zat={run.fees_zat} short /> : <span className={muted}>After payment</span>}
      </Figure>
      <Figure label="Funded">
        {f?.funded_usd_cents ? <Usd cents={f.funded_usd_cents} /> : <span className={muted}>Not yet</span>}
      </Figure>
    </dl>
  );
}

/** Only while the run still needs funding or paying: what is next, and the way back into the flow. */
function NextAction({ run }: { run: Run }) {
  if (run.status === "paid") return null;
  const href = `/console/runs/new?run=${run.id}`;
  const n = run.lines.length;
  const confirmed = confirmedCount(run.lines);
  let title: string;
  let text: React.ReactNode;
  let action: string;
  if (run.status === "failed") {
    title = "The run stopped";
    text = run.error ? `${run.error.message} ${run.error.hint}` : "Resume it to retry what is left.";
    action = "Resume";
  } else if (isPaying(run)) {
    title = `Paying now: ${confirmed} of ${n} confirmed`;
    text = "Payments keep going on the service. This page updates live.";
    action = "Follow progress";
  } else if (run.status === "funded") {
    title = "Ready to pay";
    text = `Funded. Send ${plural(n, "shielded payment")} when you are ready.`;
    action = `Pay ${plural(n, "contractor")}`;
  } else if (run.status === "awaiting_funds") {
    title = "Waiting for your deposit";
    text = "The quote and deposit address are in the funding step.";
    action = "Continue funding";
  } else {
    title = "Approved, not funded yet";
    text = "Fund the run to pay the contractors.";
    action = "Fund run";
  }
  return (
    <Card
      className={cn(
        "mt-6 flex flex-col gap-4 sm:flex-row sm:items-center",
        run.status === "failed" && "border-destructive/30 bg-danger-bg",
      )}
    >
      <div className="min-w-0 flex-1">
        <h2 className="text-[0.9375rem] text-foreground">{title}</h2>
        <p className="mt-0.5 text-sm [overflow-wrap:anywhere] text-muted-foreground">{text}</p>
        {isPaying(run) ? (
          <div
            className="mt-3 h-1.5 overflow-hidden rounded-full bg-chip"
            role="progressbar"
            aria-label="Payments confirmed"
            aria-valuemin={0}
            aria-valuemax={n}
            aria-valuenow={confirmed}
          >
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${n ? Math.max(3, (confirmed / n) * 100) : 0}%` }}
            />
          </div>
        ) : null}
      </div>
      <Button asChild size="lg" className="self-start sm:self-center">
        <Link href={href}>{action}</Link>
      </Button>
    </Card>
  );
}
