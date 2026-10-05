"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { Play, RotateCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Rate, Usd, Zec, Coin } from "@/components/app/amount";
import { Hash } from "@/components/app/hash";
import { EmptyState, ErrorState, PageHeader, Panel, Stat, TableSkeleton } from "@/components/app/states";
import { LineStatusBadge, RUN_STATUS, RunStatusBadge } from "@/components/app/status-badge";
import { FundStep } from "@/components/payer/fund-step";
import { RunComparison } from "@/components/payer/run-comparison";
import { RunStepper, runStep } from "@/components/payer/run-stepper";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useResource } from "@/hooks/use-resource";
import { useRunEvents, type StreamState } from "@/hooks/use-run-events";
import { api, ApiError, toDisplayError, type PayLine, type Run } from "@/lib/api";
import {
  formatDate,
  formatDateTime,
  formatHeight,
  formatPeriodLabel,
  formatRange,
  formatTime,
  formatUsd,
} from "@/lib/format";
import { cn } from "cn";

function newer(a: Run | undefined, b: Run | undefined): Run | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b.updated_at) >= Date.parse(a.updated_at) ? b : a;
}

const EXECUTING = new Set(["swapping", "swapped", "allocating", "paying"]);

export function RunDetail({ runId, initial }: { runId: string; initial?: Run }) {
  const fetched = useResource((s) => api.run(runId, s), `run-${runId}`);
  const [local, setLocal] = useState<Run | undefined>(initial);
  const stream = useRunEvents(runId, !!fetched.data || !!initial);
  const history = useResource((s) => api.runLog(runId, s), `run-log-${runId}`);
  const run = newer(newer(fetched.data, stream.run), local);
  const onRun = useCallback((r: Run) => setLocal((prev) => newer(prev, r)), []);
  // History from GET /log on load, then live events from the stream, without duplicates.
  const logs = useMemo(() => {
    const seen = new Set<string>();
    return [...(history.data ?? []), ...stream.logs]
      .filter((l) => {
        const key = `${l.at}|${l.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  }, [history.data, stream.logs]);

  if (fetched.error && !run) {
    return (
      <div className="space-y-6">
        <PageHeader title="Run" back={{ href: "/app/payer/runs", label: "Runs" }} />
        <ErrorState error={fetched.error} onRetry={fetched.reload} />
      </div>
    );
  }
  if (!run) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading run">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full" />
        <Panel>
          <TableSkeleton label="Loading pay lines" columns={6} />
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ href: "/app/payer/runs", label: "Runs" }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            Run for {formatPeriodLabel(run.period_label)}
            <RunStatusBadge status={run.status} />
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {formatRange(run.period_start, run.period_end)}. Created {formatDate(run.created_at)}.
            <span className="inline-flex items-center gap-1">
              Run id <Hash value={run.id} label="run id" head={8} tail={4} />
            </span>
          </span>
        }
        actions={
          <>
            {run.status === "draft" ? <DiscardDraft runId={run.id} /> : null}
            <LiveIndicator state={stream.state} />
          </>
        }
      />

      <RunStepper run={run} />

      <CurrentStep run={run} onRun={onRun} />

      <PayLines run={run} />

      <RunSummary run={run} />

      <RunComparison run={run} />

      <ActivityLog logs={logs} />
    </div>
  );
}

function LiveIndicator({ state }: { state: StreamState }) {
  const text =
    state === "live"
      ? "Live updates on"
      : state === "connecting"
        ? "Connecting to live updates"
        : state === "reconnecting"
          ? "Reconnecting to live updates"
          : "Live updates off";
  return (
    <span className="inline-flex items-center gap-2 text-xs text-muted-foreground" role="status">
      <span
        aria-hidden="true"
        className={cn(
          "size-2 rounded-full",
          state === "live" ? "bg-success" : state === "closed" ? "bg-muted-foreground" : "animate-pulse bg-warning",
        )}
      />
      {text}
    </span>
  );
}

function CurrentStep({ run, onRun }: { run: Run; onRun: (r: Run) => void }) {
  const { index, failed } = runStep(run);

  if (failed) return <FailedStep run={run} onRun={onRun} />;

  if (index === 0) {
    return (
      <Panel
        title="Fund the run"
        description={`The run needs ${formatUsd(run.total_usd_cents)} worth of ZEC before it can pay.`}
      >
        <div className="p-4">
          <FundStep run={run} onRun={onRun} />
        </div>
      </Panel>
    );
  }
  if (index === 1) return <ExecuteStep run={run} onRun={onRun} />;
  return <PaidStep run={run} />;
}

function PaidStep({ run }: { run: Run }) {
  const confirmed = run.lines.filter((l) => l.status === "confirmed").length;
  return (
    <Panel
      title="Paid"
      description={`${confirmed} of ${run.lines.length} payments confirmed on chain. The explorer shows shielded transactions only; amounts and names stay private.`}
    >
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Contractors read their payments with their own viewing key. Your accountant reconciles this run with all of
          them.
        </p>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/app/payer/contractors">Share viewing keys</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/accountant">Open accountant view</Link>
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function ExecuteStep({ run, onRun }: { run: Run; onRun: (r: Run) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const execute = async () => {
    setBusy(true);
    setError(null);
    try {
      onRun(await api.executeRun(run.id));
    } catch (err) {
      setError(toDisplayError(err));
    } finally {
      setBusy(false);
    }
  };
  const done = run.lines.filter((l) => l.status === "confirmed").length;
  const sent = run.lines.filter((l) => l.status === "broadcast" || l.status === "confirmed").length;
  const executing = EXECUTING.has(run.status) || !!run.executing;

  return (
    <Panel
      title={executing ? (EXECUTING.has(run.status) ? RUN_STATUS[run.status].label : "Starting") : "Execute the run"}
      description={
        executing
          ? EXECUTING.has(run.status)
            ? RUN_STATUS[run.status].help
            : "The executor picked up the run."
          : "Funded. Executing moves each line's ZEC to that contractor's account, then sends one shielded payment per contractor."
      }
    >
      <div className="space-y-4 p-4">
        {executing ? (
          <div className="space-y-2" aria-live="polite">
            <div className="flex items-baseline justify-between text-sm">
              <span>
                <span className="num font-medium">{sent}</span> of <span className="num">{run.lines.length}</span>{" "}
                payments sent, <span className="num font-medium">{done}</span> confirmed
              </span>
            </div>
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Payments confirmed"
              aria-valuemin={0}
              aria-valuemax={run.lines.length}
              aria-valuenow={done}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${run.lines.length ? (done / run.lines.length) * 100 : 0}%` }}
              />
            </div>
          </div>
        ) : (
          <Button onClick={execute} disabled={busy} size="lg">
            <Play aria-hidden="true" />
            {busy ? "Starting" : "Execute run"}
          </Button>
        )}
        {error ? <ErrorState error={error} compact /> : null}
      </div>
    </Panel>
  );
}

function FailedStep({ run, onRun }: { run: Run; onRun: (r: Run) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const resume = async () => {
    setBusy(true);
    setError(null);
    try {
      onRun(await api.executeRun(run.id));
    } catch (err) {
      setError(toDisplayError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title="The run stopped"
      description="Lines that already went through stay paid. Resuming retries only what is left."
    >
      <div className="space-y-4 p-4">
        {run.error ? <ErrorState error={new ApiError(0, run.error)} compact /> : null}
        <Button onClick={resume} disabled={busy}>
          <RotateCw aria-hidden="true" />
          {busy ? "Resuming" : "Resume run"}
        </Button>
        {error ? <ErrorState error={error} compact /> : null}
      </div>
    </Panel>
  );
}

function PayLines({ run }: { run: Run }) {
  const totalZat = run.lines.reduce((s, l) => s + (l.amount_zat ?? 0), 0);
  const anyZat = run.lines.some((l) => l.amount_zat);
  return (
    <Panel
      title="Pay lines"
      description="One shielded payment per contractor. Transaction ids appear as each payment is broadcast."
    >
      {run.lines.length === 0 ? (
        <EmptyState title="This run has no lines">Create a new run and include at least one contractor.</EmptyState>
      ) : (
        <>
          <ul className="divide-y md:hidden">
            {run.lines.map((l) => (
              <li key={l.id} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{l.contractor_name}</p>
                    <p className="text-xs text-muted-foreground">
                      Account {l.account_index}
                      {l.invoice_ref ? `, ${l.invoice_ref}` : ""}
                    </p>
                  </div>
                  <LineStatusBadge status={l.status} />
                  <ConversionNote line={l} />
                </div>
                <div
                  className={cn(
                    "flex items-baseline justify-between gap-3 text-sm",
                    l.status === "failed" && "line-through decoration-danger",
                  )}
                >
                  <Usd cents={l.amount_usd_cents} className="font-medium" />
                  {l.amount_zat ? (
                    <Zec zat={l.amount_zat} />
                  ) : (
                    <span className="text-muted-foreground">ZEC set at funding</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <Hash
                    value={l.txid}
                    label={`transaction id for ${l.contractor_name}`}
                    explorerUrl={l.explorer_url}
                    empty="Not broadcast"
                  />
                  <span className="num">
                    {l.confirmed_height ? `Height ${formatHeight(l.confirmed_height)}` : "Not mined"}
                  </span>
                </div>
                {l.error ? (
                  <p className="text-xs text-danger">
                    {l.error.message} {l.error.hint}
                  </p>
                ) : null}
              </li>
            ))}
            <li className="flex items-baseline justify-between bg-muted/60 px-4 py-3 text-sm font-medium">
              <span>
                Total, {run.lines.length} {run.lines.length === 1 ? "line" : "lines"}
              </span>
              <Usd cents={run.total_usd_cents} />
            </li>
          </ul>
          <div className="hidden md:block">
            <Table label="Pay lines" minWidth={920}>
              <TableHeader>
                <TableRow>
                  <TableHead>Contractor</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead numeric>USD</TableHead>
                  <TableHead numeric>
                    <Coin />
                  </TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Transaction</TableHead>
                  <TableHead numeric>Height</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {run.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <div className="font-medium">{l.contractor_name}</div>
                      <div className="text-xs text-muted-foreground">Account {l.account_index}</div>
                    </TableCell>
                    <TableCell>{l.invoice_ref || <span className="text-muted-foreground">None</span>}</TableCell>
                    <TableCell numeric className={cn(l.status === "failed" && "line-through decoration-danger")}>
                      <Usd cents={l.amount_usd_cents} />
                    </TableCell>
                    <TableCell numeric className={cn(l.status === "failed" && "line-through decoration-danger")}>
                      {l.amount_zat ? (
                        <Zec zat={l.amount_zat} unit={false} />
                      ) : (
                        <span className="text-muted-foreground">At funding</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <LineStatusBadge status={l.status} />
                      <ConversionNote line={l} />
                      {l.error ? (
                        <p className="mt-1 max-w-56 text-xs whitespace-normal text-danger">
                          {l.error.message} {l.error.hint}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Hash
                        value={l.txid}
                        label={`transaction id for ${l.contractor_name}`}
                        explorerUrl={l.explorer_url}
                        empty="Not broadcast"
                      />
                      {l.allocation_txid ? (
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                          Allocation{" "}
                          <Hash
                            value={l.allocation_txid}
                            label={`allocation transaction id for ${l.contractor_name}`}
                            head={6}
                            tail={4}
                          />
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell numeric>
                      {l.confirmed_height ? (
                        formatHeight(l.confirmed_height)
                      ) : (
                        <span className="text-muted-foreground">Not mined</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell>Total</TableCell>
                  <TableCell className="text-muted-foreground">
                    {run.lines.length} {run.lines.length === 1 ? "line" : "lines"}
                  </TableCell>
                  <TableCell numeric>
                    <Usd cents={run.total_usd_cents} />
                  </TableCell>
                  <TableCell numeric>{anyZat ? <Zec zat={run.total_zat ?? totalZat} unit={false} /> : null}</TableCell>
                  <TableCell colSpan={3} />
                </TableRow>
              </TableFooter>
            </Table>
          </div>
        </>
      )}
    </Panel>
  );
}

function RunSummary({ run }: { run: Run }) {
  const f = run.funding;
  const testnetRate = f?.venue === "testnet-fixed-rate" || run.network === "testnet";
  return (
    <Panel title="Run summary">
      <dl className="grid grid-cols-1 gap-6 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total owed">
          <Usd cents={run.total_usd_cents} />
        </Stat>
        <Stat
          label={
            <>
              Total paid in <Coin />
            </>
          }
        >
          {run.total_zat ? (
            <Zec zat={run.total_zat} />
          ) : (
            <span className="text-base text-muted-foreground">Set when funded</span>
          )}
        </Stat>
        <Stat
          label={testnetRate ? "Testnet fixed rate (USD basis)" : "Fill rate (USD basis)"}
          hint={testnetRate ? "Testnet coins have no market price, so the testnet venue uses a fixed rate." : undefined}
        >
          {f?.rate_usd_per_zec_e6 ? (
            <Rate e6={f.rate_usd_per_zec_e6} />
          ) : (
            <span className="text-base text-muted-foreground">Set when funded</span>
          )}
        </Stat>
        <Stat label="Network fees">
          {run.fees_zat !== null && run.fees_zat !== undefined ? (
            <Zec zat={run.fees_zat} />
          ) : (
            <span className="text-base text-muted-foreground">After payments</span>
          )}
        </Stat>
        {f?.funded_usd_cents ? (
          <Stat label="Funded">
            <Usd cents={f.funded_usd_cents} />
          </Stat>
        ) : null}
        {f?.zec_acquired_zat ? (
          <Stat
            label={
              <>
                <Coin /> acquired
              </>
            }
          >
            <Zec zat={f.zec_acquired_zat} />
          </Stat>
        ) : null}
        <Stat label="Last update">
          <span className="text-base">{formatDateTime(run.updated_at)}</span>
        </Stat>
      </dl>
      {run.allocation_txid ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-4 py-3 text-sm">
          <span className="text-muted-foreground">Allocation transaction (treasury to contractor accounts)</span>
          <Hash
            value={run.allocation_txid}
            label="allocation transaction id"
            explorerUrl={run.allocation_explorer_url}
          />
          {run.allocation_height ? (
            <span className="num text-muted-foreground">at height {formatHeight(run.allocation_height)}</span>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}

function ActivityLog({ logs }: { logs: { at: string; message: string }[] }) {
  const ordered = useMemo(() => [...logs].reverse(), [logs]);
  return (
    <Panel title="Activity" description="What the service did for this run, with new events streamed live.">
      {ordered.length === 0 ? (
        <p className="px-4 py-4 text-sm text-muted-foreground">
          Activity appears here while the run is funded and executed.
        </p>
      ) : (
        <ol className="max-h-72 divide-y overflow-y-auto text-sm" aria-live="polite" aria-relevant="additions">
          {ordered.map((l, i) => (
            <li key={`${l.at}-${i}`} className="flex gap-3 px-4 py-2">
              <time dateTime={l.at} className="num shrink-0 text-xs text-muted-foreground">
                {formatTime(l.at)}
              </time>
              <span className="min-w-0 [overflow-wrap:anywhere]">{l.message}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

function DiscardDraft({ runId }: { runId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const discard = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.discardRun(runId);
      toast.success("Draft discarded");
      router.push("/app/payer/runs");
    } catch (err) {
      setError(toDisplayError(err));
      setBusy(false);
    }
  };
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden="true" />
        Discard draft
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard this draft run?</DialogTitle>
            <DialogDescription>
              Nothing has been funded or paid yet. The draft and its lines are removed; you can create a new run at any
              time.
            </DialogDescription>
          </DialogHeader>
          {error ? <ErrorState error={error} compact /> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Keep draft
            </Button>
            <Button variant="destructive" onClick={discard} disabled={busy}>
              {busy ? "Discarding" : "Discard draft"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

const CHAIN_NAMES: Record<string, string> = { base: "Base", arb: "Arbitrum", eth: "Ethereum", sol: "Solana" };

/** Settlement of a convert_usdc line: quote, conversion in flight, delivered, or simulated on testnet. */
function ConversionNote({ line }: { line: PayLine }) {
  const c = line.settlement;
  if (!c) return null;
  const chain = CHAIN_NAMES[c.payout_chain] ?? c.payout_chain;
  const text =
    c.status === "success"
      ? `Converted: ${c.delivered_out ?? c.quoted_out} USDC on ${chain}`
      : c.status === "simulated"
        ? `Testnet: conversion to USDC on ${chain} simulated`
        : c.status === "refunded" || c.status === "failed"
          ? `Conversion ${c.status}${c.refund_reason ? `: ${c.refund_reason}` : ""}`
          : `Converting to about ${c.quoted_out} USDC on ${chain}`;
  return <p className="mt-1 max-w-56 text-xs whitespace-normal text-muted-foreground">{text}</p>;
}
