"use client";

import Link from "next/link";
import { useState } from "react";
import { CircleCheck } from "lucide-react";
import { Coin, Usd, Zec } from "@/components/app/amount";
import { Hash } from "@/components/app/hash";
import { useCoinUnit, useHealth } from "@/components/app/health-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { Initials } from "@/components/ds/avatar";
import { Card } from "@/components/ds/card";
import { KeyValues } from "@/components/ds/kv";
import { SimulatedRate } from "@/components/ds/simulated-rate";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { StreamState } from "@/hooks/use-run-events";
import { api, ApiError, toDisplayError, type PayLine, type Run, type RunLogEvent } from "@/lib/api";
import { approvalState } from "@/lib/approvals";
import { formatClock, formatHeight, formatTime } from "@/lib/format";
import { lineConfirmedAt } from "@/lib/payroll";
import { logSentence } from "@/lib/run-log";
import { cn } from "cn";
import { ApprovalStatus } from "../approvals";
import { CancelRun } from "../cancel-run";
import { Problem } from "../problem";
import {
  canCancel,
  confirmedCount,
  estimateZat,
  failureTitle,
  isLineWarning,
  isPaying,
  LineStatus,
  plural,
  retryOnce,
  runTitle,
} from "../run-meta";
import { useLineChanges } from "../use-line-changes";
import { FlowTitle } from "./rail";

const H1 = FlowTitle;

/** ZEC each line will get and the reserve left for network fees, from the run's funding record. */
function funded(run: Run) {
  const f = run.funding;
  const rate = f?.rate_usd_per_zec_e6 ?? null;
  const zat =
    run.total_zat ??
    estimateZat(
      run.lines.map((l) => l.amount_usd_cents),
      rate,
    );
  const acquired = f?.zec_acquired_zat ?? f?.quoted_zat ?? null;
  const reserve = acquired !== null && zat !== null && acquired > zat ? acquired - zat : null;
  return { rate, zat, reserve, testnet: f?.venue === "testnet-fixed-rate" || run.network === "testnet" };
}

/** Step 4: confirm, execute, then follow every payment live until each one is confirmed. */
export function PayStep({
  run,
  onRun,
  logs,
  stream,
}: {
  run: Run;
  onRun: (run: Run) => void;
  logs: RunLogEvent[];
  stream: StreamState;
}) {
  const changed = useLineChanges(run.lines);
  if (run.status === "failed") return <Stopped run={run} onRun={onRun} changed={changed} />;
  if (isPaying(run)) return <Paying run={run} logs={logs} stream={stream} changed={changed} />;
  return <Ready run={run} onRun={onRun} />;
}

function Ready({ run, onRun }: { run: Run; onRun: (run: Run) => void }) {
  const { health } = useHealth();
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const n = run.lines.length;
  const { zat, reserve, testnet } = funded(run);
  const appFee = health?.app_fee_bps ?? 0;
  // Pay waits for the approvals; the service refuses it before they are in.
  const approvals = approvalState(run, auth);
  const payBlocked = !!approvals && !approvals.met;

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      onRun(await retryOnce(() => api.executeRun(run.id)));
      setOpen(false);
    } catch (err) {
      setError(toDisplayError(err));
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const facts = [
    { label: "People", value: plural(n, "contractor") },
    { label: "Total", value: <Usd cents={run.total_usd_cents} /> },
    {
      label: <Coin />,
      value:
        zat !== null ? (
          <>
            {run.total_zat ? null : "about "}
            <Zec zat={zat} short />
          </>
        ) : (
          "Set at funding"
        ),
      hint: testnet ? "At the simulated rate" : "At the locked rate",
    },
    {
      label: "Fees",
      value:
        reserve !== null ? (
          <>
            up to <Zec zat={reserve} />
          </>
        ) : (
          "Network fees"
        ),
      hint: `Network fees, from the reserve set aside with the run; what is unspent stays in the treasury. ${appFee > 0 ? `Payslip fee ${appFee / 100}%.` : "No Payslip fee."}`,
    },
  ];

  return (
    <div>
      <H1>Pay {plural(n, "contractor")}</H1>
      <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">
        Funded. Each contractor gets one shielded payment for {runTitle(run)}.
        {payBlocked ? " The payments start once every required approval is in." : ""}
      </p>
      {approvals ? <ApprovalStatus run={run} onRun={onRun} className="mt-4" /> : null}

      <Card className="mt-6 px-6 py-6 shadow-[0_2px_6px_rgba(14,14,45,0.05)] sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.8125rem] text-strong">Total for {plural(n, "contractor")}</p>
          {testnet ? <SimulatedRate rateE6={run.funding?.rate_usd_per_zec_e6} /> : null}
        </div>
        <Usd cents={run.total_usd_cents} className="mt-2 block text-[2.125rem] leading-none font-[380]" />
        {zat !== null ? (
          <p className="mt-2 text-[0.9375rem] text-muted-foreground">
            {run.total_zat ? null : "about "}
            <Zec zat={zat} short /> in {plural(n, "shielded payment")}
          </p>
        ) : null}
      </Card>

      <LineList lines={run.lines} run={run} changed={new Set()} className="mt-6" />

      {error ? (
        <Problem className="mt-5" error={error} title="Payments did not start" onRetry={pay} busy={busy} />
      ) : null}

      <div className="mt-6">
        <Button size="lg" onClick={() => setOpen(true)} disabled={busy || payBlocked} aria-disabled={payBlocked}>
          Pay {plural(n, "contractor")}
        </Button>
      </div>
      {canCancel(run) ? <CancelRun run={run} onCancelled={onRun} /> : null}

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="gap-5 p-6 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[1.1875rem] font-normal">
              Pay {plural(n, "contractor")} <Usd cents={run.total_usd_cents} />
            </DialogTitle>
            <DialogDescription className="text-[0.9375rem]">
              Each payment is shielded and cannot be reversed once it is sent.
            </DialogDescription>
          </DialogHeader>
          <KeyValues items={facts} className="sm:grid-cols-[100px_minmax(0,1fr)]" />
          <DialogFooter className="-mx-6 -mb-6 bg-transparent px-6 pb-6">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={pay} disabled={busy}>
              {busy ? (
                "Starting"
              ) : (
                <>
                  Pay <Usd cents={run.total_usd_cents} />
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Plain words for where the executor is, from the run's status and its transactions. */
function stage(run: Run): string {
  const n = run.lines.length;
  const sent = run.lines.filter((l) => l.txid).length;
  const confirmed = confirmedCount(run.lines);
  if (run.status === "funded" || run.status === "swapping" || run.status === "swapped")
    return "Starting. Recording the funds for this run.";
  if (run.status === "allocating") {
    if (!run.allocation_txid)
      return "Step 1 of 2: building the transaction that moves funds to each contractor's account.";
    return run.allocation_height
      ? `Step 1 of 2 done: funds reached each contractor's account at block ${formatHeight(run.allocation_height)}.`
      : "Step 1 of 2: funds are on their way to each contractor's account, waiting to be mined.";
  }
  if (sent < n) return `Step 2 of 2: sending payments. ${sent} of ${n} sent.`;
  if (confirmed < n) return `Step 2 of 2: all ${n} payments sent. ${n - confirmed} waiting to be mined.`;
  return "Finishing up.";
}

function Paying({
  run,
  logs,
  stream,
  changed,
}: {
  run: Run;
  logs: RunLogEvent[];
  stream: StreamState;
  changed: ReadonlySet<string>;
}) {
  const coin = useCoinUnit();
  const n = run.lines.length;
  const confirmed = confirmedCount(run.lines);
  const latest = logs.length ? logs[logs.length - 1] : null;
  return (
    <div>
      <H1>Paying {plural(n, "contractor")}</H1>
      <p className="mt-1.5 text-[0.9375rem] text-muted-foreground" aria-live="polite">
        {stage(run)}
      </p>

      <div className="mt-6">
        <p className="flex items-baseline gap-2" aria-live="polite">
          <span key={confirmed} className="ps-rise text-[2.125rem] leading-none font-[380] tracking-[-0.02em]">
            {confirmed}
          </span>
          <span className="text-[0.9375rem] text-muted-foreground">of {n} confirmed</span>
        </p>
        <div
          role="progressbar"
          aria-label="Payments confirmed"
          aria-valuemin={0}
          aria-valuemax={n}
          aria-valuenow={confirmed}
          aria-valuetext={`${confirmed} of ${n} confirmed`}
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-chip"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
            style={{ width: `${n ? Math.max(3, (confirmed / n) * 100) : 0}%` }}
          />
        </div>
      </div>

      <LineList lines={run.lines} run={run} changed={changed} className="mt-6" />

      <div className="mt-5 space-y-2 text-[0.8125rem] text-muted-foreground">
        {latest ? (
          <p className="[overflow-wrap:anywhere]">
            <span className="text-strong">Latest</span> · <time dateTime={latest.at}>{formatTime(latest.at)}</time> ·{" "}
            {logSentence(latest.message, coin)}
          </p>
        ) : null}
        <p className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              stream === "live" ? "bg-success" : stream === "closed" ? "bg-faint" : "animate-pulse bg-warning",
            )}
          />
          {stream === "live" ? "Live" : stream === "closed" ? "Live updates off" : "Reconnecting to live updates"}
        </p>
      </div>

      <p className="mt-6 rounded-xl bg-raised px-4 py-3 text-[0.9375rem]">
        You can leave this page. Payments keep going on the service, and{" "}
        <Link href={`/console/runs/${run.id}`} className="text-link hover:underline">
          the run page
        </Link>{" "}
        shows where they stand.
      </p>
    </div>
  );
}

function Stopped({ run, onRun, changed }: { run: Run; onRun: (run: Run) => void; changed: ReadonlySet<string> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const resume = async () => {
    setBusy(true);
    setError(null);
    try {
      onRun(await retryOnce(() => api.executeRun(run.id)));
    } catch (err) {
      setError(toDisplayError(err));
    } finally {
      setBusy(false);
    }
  };
  const paid = confirmedCount(run.lines);
  return (
    <div>
      <H1>{failureTitle(run)}</H1>
      <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">
        {paid > 0 ? `${paid} of ${run.lines.length} payments went through and stay paid. ` : ""}
        Resuming retries only what is left.
      </p>
      {run.error ? (
        <Problem
          className="mt-5"
          error={run.error}
          onRetry={resume}
          retryLabel="Resume"
          busyLabel="Resuming"
          busy={busy}
        />
      ) : null}
      {error ? <Problem className="mt-3" error={error} title="Could not resume" /> : null}
      <LineList lines={run.lines} run={run} changed={changed} className="mt-6" />
      {!run.error ? (
        <div className="mt-6">
          <Button size="lg" onClick={resume} disabled={busy}>
            {busy ? "Resuming" : "Resume"}
          </Button>
        </div>
      ) : null}
      {canCancel(run) ? <CancelRun run={run} onCancelled={onRun} /> : null}
    </div>
  );
}

/** "08:13 UTC" for a line mined with a block time; nothing otherwise. */
function paidClock(line: PayLine, run: Run | undefined): string | undefined {
  if (!run || !line.confirmed_at) return undefined;
  const at = lineConfirmedAt(line, run);
  return at ? formatClock(at) : undefined;
}

/** One row per contractor: who, how much, and the payment's state with its txid and block. */
export function LineList({
  lines,
  run,
  changed,
  className,
}: {
  lines: PayLine[];
  run?: Run;
  changed: ReadonlySet<string>;
  className?: string;
}) {
  return (
    <ul className={cn("border-t border-hairline", className)} aria-label="Payments">
      {lines.map((l) => (
        <li
          key={l.id}
          className={cn(
            "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-hairline py-3",
            changed.has(l.id) && "ps-flash",
          )}
        >
          <Initials name={l.contractor_name} />
          <div className="min-w-0">
            <p className="truncate text-[0.9375rem]">{l.contractor_name}</p>
            <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-[0.8125rem] text-muted-foreground">
              {l.txid ? (
                <Hash
                  value={l.txid}
                  label={`transaction id for ${l.contractor_name}`}
                  explorerUrl={l.explorer_url}
                  head={6}
                  tail={4}
                />
              ) : (
                <span>{l.invoice_ref || "No invoice reference"}</span>
              )}
              {l.confirmed_height ? (
                <span key={l.confirmed_height} className={cn("num", changed.has(l.id) && "ps-rise")}>
                  Block {formatHeight(l.confirmed_height)}
                </span>
              ) : null}
            </p>
            {l.error ? (
              // A line still in progress can carry a warning (the service is retrying it).
              <p className={cn("text-[0.8125rem]", isLineWarning(l) ? "text-warning" : "text-destructive")}>
                {l.error.message} {l.error.hint}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-1">
            <Usd
              cents={l.amount_usd_cents}
              className={cn("text-[0.9375rem]", l.status === "failed" && "line-through")}
            />
            <span key={l.status} className={cn(changed.has(l.id) && "ps-rise")}>
              <LineStatus line={l} run={run} detail={paidClock(l, run)} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The flow's last screen: every payment confirmed. */
export function DoneStep({ run }: { run: Run }) {
  const n = run.lines.length;
  const top = run.lines.reduce((h, l) => Math.max(h, l.confirmed_height ?? 0), 0);
  return (
    <div>
      <div className="flex items-center gap-2.5">
        <CircleCheck className="size-6 text-success" aria-hidden="true" />
        <H1>Payroll paid</H1>
      </div>
      <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">
        {plural(n, "shielded payment")} confirmed{top ? ` by block ${formatHeight(top)}` : ""}. Each contractor can read
        theirs with their viewing key.
      </p>
      <Card className="mt-6 px-6 py-6 shadow-[0_2px_6px_rgba(14,14,45,0.05)] sm:px-6">
        <p className="text-[0.8125rem] text-strong">Paid to {plural(n, "contractor")}</p>
        <Usd cents={run.total_usd_cents} className="mt-2 block text-[2.125rem] leading-none font-[380]" />
        {run.total_zat ? (
          <p className="mt-2 text-[0.9375rem] text-muted-foreground">
            <Zec zat={run.total_zat} short /> for {runTitle(run)}
          </p>
        ) : null}
      </Card>
      <LineList lines={run.lines} run={run} changed={new Set()} className="mt-6" />
      <div className="mt-6 flex flex-wrap gap-2.5">
        <Button asChild size="lg">
          <Link href={`/console/runs/${run.id}`}>View run</Link>
        </Button>
        <Button asChild size="lg" variant="secondary">
          <Link href="/console/runs">Back to payroll runs</Link>
        </Button>
      </div>
    </div>
  );
}
