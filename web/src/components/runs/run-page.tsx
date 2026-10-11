"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, Repeat } from "lucide-react";
import { Tabs as TabsPrimitive } from "radix-ui";
import { Rate, Usd, Zec } from "@/components/app/amount";
import { CopyButton } from "@/components/app/copy-button";
import { useHealth } from "@/components/app/health-provider";
import { Card } from "@/components/ds/card";
import { PageTitle } from "@/components/ds/page";
import { SimulatedRate } from "@/components/ds/simulated-rate";
import { ShieldedMark } from "@/components/ds/status";
import { TYPE } from "@/components/ds/type";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { useRunEvents } from "@/hooks/use-run-events";
import { api, type PayLine, type Run, type RunLogEvent } from "@/lib/api";
import { approvable, approvalState } from "@/lib/approvals";
import { formatDate, formatDateTime, formatRange, rateE6FromDecimal, truncateMiddle } from "@/lib/format";
import { runCoin, runPaidAt } from "@/lib/payroll";
import { cn } from "cn";
import { useAuth } from "@/components/auth/auth-provider";
import { ApprovalStatus } from "./approvals";
import { AuditTrail } from "./audit-trail";
import { CancelRun } from "./cancel-run";
import { LineDrawer } from "./line-drawer";
import { PayLinesTable } from "./pay-lines-table";
import { PrivacyView } from "./privacy-view";
import { RunViews } from "./run-views";
import { Problem } from "./problem";
import {
  archivedLineIds,
  canCancel,
  atSimulatedRate,
  confirmedCount,
  failureTitle,
  estimateZat,
  fundingClosed,
  isPaying,
  liveQuoteRate,
  newerRun,
  plural,
  RunTag,
  runTitle,
} from "./run-meta";
import { useLineChanges } from "./use-line-changes";
import { useRunPoll } from "./use-run-poll";

const TABS = [
  { id: "lines", label: "Pay lines" },
  { id: "privacy", label: "Privacy view" },
  { id: "audit", label: "Audit trail" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const NO_LINES: PayLine[] = [];

/** A tab panel takes focus after its tab (Tab key): it shows a ring then, like everything else. */
const PANEL =
  "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring focus-visible:outline-solid";

/** One payroll run: header, figures, the next action while there is one, then tabs. */
export function RunPage({ runId, initial }: { runId: string; initial?: Run }) {
  const fetched = useResource((s) => api.run(runId, s), `console-run-${runId}`, initial);
  const stream = useRunEvents(
    runId,
    !!fetched.data && fetched.data.status !== "paid" && fetched.data.status !== "cancelled",
  );
  const history = useResource((s) => api.runLog(runId, s), `console-run-log-${runId}`);
  const contractors = useResource((s) => api.contractors(s), `console-run-people-${runId}`);
  const run = newerRun(fetched.data, stream.run);
  // Without a live stream (too many open, or dropped), the page polls instead.
  useRunPoll(run, stream.state, () => {
    void fetched.reload();
    void history.reload();
  });
  const changed = useLineChanges(run?.lines ?? NO_LINES);
  const [tab, setTab] = useState<TabId>("lines");
  const [openId, setOpenId] = useState<string | null>(null);

  // A tab can be linked to (/console/runs/<id>#privacy) and follows the URL: a changed hash or
  // the browser's Back shows the tab the address names.
  useEffect(() => {
    const sync = () => {
      const fromHash = window.location.hash.slice(1);
      setTab(TABS.some((t) => t.id === fromHash) ? (fromHash as TabId) : "lines");
    };
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);
  const changeTab = useCallback((value: string) => {
    setTab(value as TabId);
    try {
      window.history.replaceState(null, "", value === "lines" ? window.location.pathname : `#${value}`);
    } catch {
      // History can be unavailable in some embedded views; the tab still changes.
    }
  }, []);
  /** From the two views above the tabs: open the Privacy view and move focus to its tab. */
  const showPrivacy = useCallback(() => {
    changeTab("privacy");
    requestAnimationFrame(() => {
      const t = document.querySelector<HTMLElement>('[role="tab"][data-tab="privacy"]');
      t?.scrollIntoView({ block: "center", behavior: "smooth" });
      t?.focus({ preventScroll: true });
    });
  }, [changeTab]);

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
    <Link href="/console/runs" className="inline-flex items-center gap-1 font-type font-bold hover:text-foreground">
      <ChevronLeft className="size-4" aria-hidden="true" />
      Payroll runs
    </Link>
  );

  if (!run && fetched.error) {
    return (
      <>
        <PageTitle back={back} title={fetched.error.status === 404 ? "Run not found" : "Payroll run"} />
        {fetched.error.status === 404 ? (
          <div className="border border-ink px-4 py-3.5">
            <p className="font-type font-bold">No run has this id.</p>
            <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
              It may have been discarded while it was a draft. Payroll runs lists every run there is.
            </p>
          </div>
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
  const archived = archivedLineIds(run, contractors.data);

  return (
    <>
      <PageTitle
        back={back}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {runTitle(run)} payroll
            <RunTag run={run} className="translate-y-[-2px]" />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-1 gap-y-1 font-type text-[0.8125rem]">
            <span>
              {formatRange(run.period_start, run.period_end)}, created {formatDate(run.created_at)}, run
            </span>
            <span className="inline-flex items-center gap-0.5">
              <span className="sr-only">id </span>
              <code className="font-type text-[0.8125rem] font-bold text-foreground" title={run.id}>
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

      <Hero run={run} />
      <RunViews run={run} onShowPrivacy={showPrivacy} />
      <SummaryStrip run={run} />

      <NextAction run={run} archived={archived.size} onRun={(r) => fetched.setData(r)} />
      {canCancel(run) ? (
        <CancelRun
          run={run}
          onCancelled={(r) => fetched.setData(r)}
          className="mt-3 text-[0.8125rem] text-muted-foreground"
        />
      ) : null}

      <TabsPrimitive.Root value={tab} onValueChange={changeTab} className="mt-8">
        {/* Index tabs on a form: the open one is a ruled tab joined to the page under it. */}
        <TabsPrimitive.List
          aria-label="Run details"
          className="flex gap-1 overflow-x-auto border-b-2 border-ink [scrollbar-width:none]"
        >
          {TABS.map((t) => (
            <TabsPrimitive.Trigger
              key={t.id}
              value={t.id}
              data-tab={t.id}
              className="relative -mb-[2px] inline-flex h-10 shrink-0 items-center gap-2 border-2 border-b-0 border-transparent px-3.5 font-type text-[0.875rem] font-bold whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:outline-2 focus-visible:-outline-offset-4 focus-visible:outline-ring focus-visible:outline-solid data-[state=active]:border-ink data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-[2px] data-[state=active]:after:h-[2px] data-[state=active]:after:bg-card"
            >
              {t.label}
              {t.id === "lines" ? (
                <span className="num border border-current px-1 text-[0.75rem] leading-[1.35] text-strong">
                  {run.lines.length}
                </span>
              ) : null}
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>
        <TabsPrimitive.Content value="lines" className={PANEL}>
          <PayLinesTable run={run} changed={changed} archived={archived} onOpen={(l) => setOpenId(l.id)} />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="privacy" className={cn(PANEL, "pt-5")}>
          <PrivacyView run={run} />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="audit" className={cn(PANEL, "pt-5")}>
          <AuditTrail run={run} logs={logs} loading={history.loading} error={history.error} />
        </TabsPrimitive.Content>
      </TabsPrimitive.Root>

      <LineDrawer run={run} line={openLine} logs={logs} onClose={() => setOpenId(null)} />
    </>
  );
}

/** One box of the summary form: a spaced-caps caption over a typewritten value. */
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
    <div className="min-w-0 px-3 py-2.5">
      <dt className="form-label text-[0.75rem] font-bold text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-type text-[0.9375rem] leading-tight">{children}</dd>
      {sub ? <dd className="mt-1 text-[0.8125rem] leading-snug text-muted-foreground">{sub}</dd> : null}
    </div>
  );
}

function paidCents(run: Run): number {
  return run.lines.reduce((s, l) => s + (l.status === "confirmed" ? l.amount_usd_cents : 0), 0);
}

/**
 * The run in one line, led by its amount in the display face: what was paid (or is to be paid),
 * to how many people, and the red stamp that says nobody else can read it.
 */
function Hero({ run }: { run: Run }) {
  const paid = run.status === "paid";
  const n = run.lines.length;
  const at = runPaidAt(run);
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <p className={TYPE.hero}>
          <Usd cents={paid ? paidCents(run) : run.total_usd_cents} />
        </p>
        <p className="mt-2.5 font-type text-[0.9375rem] text-strong">
          {paid ? "Paid to " : run.status === "cancelled" ? "Was for " : "To "}
          {plural(n, "person", "people")}
          {paid && at ? <span className="text-muted-foreground"> on {formatDateTime(at)}</span> : null}
        </p>
      </div>
      {run.status === "cancelled" ? null : <ShieldedMark label="Shielded on Zcash" explain className="mb-1" />}
    </div>
  );
}

/**
 * The run's coin, under the hero: what contractors got, the rate, the network fees, what the run
 * set aside (or, on mainnet, the dollars that funded it), and what went back to the treasury.
 * Fees and leftovers are real coin and stay in coin; on testnet the only rate is simulated, so it
 * sits in its pill's note and never turns them into dollars.
 */
function SummaryStrip({ run }: { run: Run }) {
  const { health } = useHealth();
  const f = run.funding;
  const testnet = atSimulatedRate(run);
  const muted = "text-muted-foreground";
  // Before the fill, a live quote's locked rate (or the testnet rate) gives the estimate.
  const quoted = liveQuoteRate(run);
  const rate =
    f?.rate_usd_per_zec_e6 ?? quoted ?? (testnet ? rateE6FromDecimal(health?.simulated_rate_usd_per_zec) : null);
  const coin = runCoin(run);
  const estimate = run.total_zat
    ? null
    : estimateZat(
        run.lines.map((l) => l.amount_usd_cents),
        rate,
      );
  return (
    // The run's coin as a row of boxes on a form, ruled in ink: 1px inside, 2px around. Each box
    // rules its right and bottom edges; the frame clips the last ones.
    <div className="overflow-hidden border-2 border-ink bg-card">
      <dl className="-mr-px -mb-px grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 [&>div]:border-r [&>div]:border-b [&>div]:border-ink">
        <Figure label={run.status === "paid" ? "Contractors got" : "Contractors get"}>
          {run.total_zat ? (
            <Zec zat={run.total_zat} />
          ) : estimate !== null ? (
            <span>
              about <Zec zat={estimate} />
            </span>
          ) : (
            <span className={muted}>Set at funding</span>
          )}
        </Figure>
        <Figure
          label="Rate"
          sub={
            !testnet && !f?.rate_usd_per_zec_e6 && quoted && f?.deadline
              ? `Quoted, locked until ${formatDateTime(f.deadline)}`
              : undefined
          }
        >
          {testnet ? (
            <SimulatedRate rateE6={rate} />
          ) : rate ? (
            <Rate e6={rate} />
          ) : (
            <span className={muted}>Set at funding</span>
          )}
        </Figure>
        <Figure
          label="Network fees"
          sub={run.fees_zat && run.status !== "paid" ? "Of transactions mined so far" : undefined}
        >
          {run.fees_zat ? <Zec zat={run.fees_zat} /> : <span className={muted}>After payment</span>}
        </Figure>
        {testnet ? (
          <Figure label="Set aside" sub={coin.reserve !== null ? "Payments plus a fee reserve" : undefined}>
            {coin.acquired !== null ? <Zec zat={coin.acquired} /> : <span className={muted}>Not yet</span>}
          </Figure>
        ) : (
          <Figure
            label="Funded"
            sub={f?.funded_usd_cents && coin.acquired !== null ? <Zec zat={coin.acquired} /> : undefined}
          >
            {f?.funded_usd_cents ? <Usd cents={f.funded_usd_cents} /> : <span className={muted}>Not yet</span>}
          </Figure>
        )}
        <Figure label="Back in treasury" sub={coin.unspent !== null ? "The fee reserve not spent" : undefined}>
          {coin.unspent !== null ? (
            <Zec zat={coin.unspent} />
          ) : (
            <span className={muted}>{run.status === "cancelled" ? "Nothing was set aside" : "After payment"}</span>
          )}
        </Figure>
      </dl>
    </div>
  );
}

/**
 * Only while the run still needs funding or paying: what is next, and the way back into the flow.
 * With approvals required, the card says where they stand and offers Approve to a member who may
 * give the next one; Pay waits until the count is met (the service refuses it meanwhile).
 */
function NextAction({ run, archived, onRun }: { run: Run; archived: number; onRun: (run: Run) => void }) {
  const auth = useAuth();
  if (run.status === "paid") return null;
  if (run.status === "cancelled") {
    return (
      <Card className="mt-6">
        <h2 className="font-type text-[0.9375rem] font-bold text-foreground">This run was cancelled</h2>
        <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
          It closed before any money reached it, so nobody was paid. It stays here for the record.
        </p>
      </Card>
    );
  }
  const href = `/console/runs/new?run=${run.id}`;
  const n = run.lines.length;
  const confirmed = confirmedCount(run.lines);
  const approvals = approvalState(run, auth);
  let title: string;
  let text: React.ReactNode;
  let action: string;
  let warn = run.status === "failed";
  // Pay is offered only once the approvals are in; the service refuses it before then.
  let payBlocked = false;
  if (fundingClosed(run)) {
    // The quote can no longer be paid: say what happened, not "waiting for your deposit".
    const status = run.funding!.status;
    title =
      status === "expired"
        ? "The quote expired before a deposit arrived"
        : status === "refunded"
          ? "The venue refunded the deposit"
          : "The venue could not complete the swap";
    text = "No money reached the treasury for this run. Get a new quote to fund it; do not send to the old address.";
    action = "Get a new quote";
    warn = true;
  } else if (run.status === "failed") {
    title = failureTitle(run);
    text = run.error ? `${run.error.message} ${run.error.hint}` : "Resume it to retry what is left.";
    action = "Resume";
  } else if (isPaying(run)) {
    title = `Paying now: ${confirmed} of ${n} confirmed`;
    text = "Payments keep going on the service. This page updates live.";
    action = "Follow progress";
  } else if (run.status === "funded") {
    if (approvals && !approvals.met) {
      title = `Funded, waiting for ${approvals.missing === 1 ? "one more approval" : "approvals"}`;
      text = "The contractors are paid once every required approval is in.";
      payBlocked = true;
    } else {
      title = "Ready to pay";
      text = `Funded. Send ${plural(n, "shielded payment")} when you are ready.`;
    }
    action = `Pay ${plural(n, "contractor")}`;
  } else if (run.status === "awaiting_funds") {
    title = "Waiting for your deposit";
    text = "The quote and deposit address are in the funding step.";
    action = "Continue funding";
  } else if (archived > 0) {
    title = "Approved, but someone in it was archived";
    text = `${plural(archived, "person", "people")} in this run ${archived === 1 ? "was" : "were"} archived after it was approved. Discard this run from the funding step and start a new one without them.`;
    action = "Open funding step";
    warn = true;
  } else if (approvals && !approvals.met) {
    title = approvals.approvals.length === 0 ? "Not approved yet" : "Waiting for approval";
    text = "The run can be funded meanwhile; it is paid once every required approval is in.";
    action = "Fund run";
  } else {
    title = "Approved, not funded yet";
    text = "Fund the run to pay the contractors.";
    action = "Fund run";
  }
  return (
    <Card
      className={cn(
        "mt-6 flex flex-col gap-4 sm:flex-row sm:items-center",
        warn && run.status === "failed" && !fundingClosed(run) && "border-destructive bg-danger-bg",
        warn && (fundingClosed(run) || run.status === "draft") && "carbon-paper border-carbon-line",
      )}
    >
      <div className="min-w-0 flex-1">
        <h2 className="font-type text-[0.9375rem] font-bold text-foreground">{title}</h2>
        <p className="mt-0.5 text-[0.8125rem] [overflow-wrap:anywhere] text-muted-foreground">{text}</p>
        {isPaying(run) ? (
          <div
            className="mt-3 h-2.5 overflow-hidden border border-ink bg-card p-px"
            role="progressbar"
            aria-label="Payments confirmed"
            aria-valuemin={0}
            aria-valuemax={n}
            aria-valuenow={confirmed}
          >
            <div className="h-full bg-viz" style={{ width: `${n ? Math.max(3, (confirmed / n) * 100) : 0}%` }} />
          </div>
        ) : null}
        {approvals && approvable(run) ? <ApprovalStatus run={run} onRun={onRun} className="mt-3" /> : null}
      </div>
      {payBlocked ? (
        <Button size="lg" className="self-start sm:self-center" disabled aria-disabled="true">
          {action}
        </Button>
      ) : (
        <Button asChild size="lg" className="self-start sm:self-center">
          <Link href={href}>{action}</Link>
        </Button>
      )}
    </Card>
  );
}
