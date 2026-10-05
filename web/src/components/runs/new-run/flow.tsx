"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { UsersRound } from "lucide-react";
import { useHealth } from "@/components/app/health-provider";
import { FocusShell } from "@/components/shell/focus-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { useRunEvents } from "@/hooks/use-run-events";
import { api, toDisplayError, type ApiError, type Run, type RunLogEvent } from "@/lib/api";
import { parseUsdToCents } from "@/lib/format";
import { Problem } from "../problem";
import { flowPhase, newerRun, retryOnce } from "../run-meta";
import { AmountsFooter, AmountsStep } from "./amounts-step";
import { sourceRun, useDraft, useDraftCheck } from "./draft";
import { FundStep } from "./fund-step";
import { DoneStep, PayStep } from "./pay-step";
import { FlowRail } from "./rail";
import { ReviewStep } from "./review-step";

const BASE = "/console/runs/new";
const CONTEXT = "Run payroll";
const CLOSE = "/console/runs";

/** The testnet venue's fixed rate, read from the newest testnet funding record. */
function simulatedRateOf(runs: Run[] | undefined): number | null {
  const r = [...(runs ?? [])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .find((x) => x.funding?.venue === "testnet-fixed-rate" && x.funding.rate_usd_per_zec_e6);
  return r?.funding?.rate_usd_per_zec_e6 ?? null;
}

/**
 * Run payroll, full screen: Amounts, Review and approve, Fund, Pay. Until approval the run is a
 * draft in this browser; approving creates it and its id goes into the URL (?run=), so a reload
 * at any later point lands on the step the run's status calls for.
 */
export function NewRunFlow() {
  const params = useSearchParams();
  const runId = params.get("run");
  if (runId) return <RunFlow key={runId} runId={runId} />;
  return <DraftFlow review={params.get("step") === "review"} repeatId={params.get("repeat")} />;
}

function Loading({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-72" />
      <div className="space-y-3 pt-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}

function DraftFlow({ review, repeatId }: { review: boolean; repeatId: string | null }) {
  const router = useRouter();
  const { health } = useHealth();
  const contractors = useResource((s) => api.contractors(s), "flow-contractors");
  const runs = useResource((s) => api.runs(s), "flow-runs");
  const wallet = useResource((s) => api.wallet(s), "flow-wallet");
  const people = useMemo(
    () => (contractors.data ? [...contractors.data].sort((a, b) => a.account_index - b.account_index) : undefined),
    [contractors.data],
  );
  const { draft, setDraft, clearStored } = useDraft(people, runs.data, repeatId);
  const check = useDraftCheck(draft, people ?? []);
  const source = useMemo(() => sourceRun(runs.data, repeatId), [runs.data, repeatId]);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const onContinue = () => {
    setSubmitted(true);
    if (!check.valid) {
      const firstBad = check.included.find((c) => check.lineErrors[c.id]);
      if (firstBad) document.getElementById(`${check.lineErrors[firstBad.id].field}-${firstBad.id}`)?.focus();
      else if (check.periodError) document.getElementById("period-start")?.focus();
      return;
    }
    setError(null);
    setDraft((d) => ({ ...d, ready: true }));
    router.push(`${BASE}?step=review`);
  };

  // Review only shows amounts the payer has seen; a fresh tab on ?step=review starts at Amounts.
  const unseen = review && !!draft && !draft.ready;
  useEffect(() => {
    if (unseen) router.replace(BASE);
  }, [unseen, router]);

  const onApprove = async () => {
    if (!draft || !check.valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const run = await api.createRun({
        period_start: draft.from,
        period_end: draft.to,
        idempotency_key: draft.key,
        lines: check.included.map((c) => ({
          contractor_id: c.id,
          amount_usd_cents: parseUsdToCents(draft.lines[c.id].amount) ?? 0,
          invoice_ref: draft.lines[c.id].invoice.trim(),
        })),
      });
      clearStored();
      router.replace(`${BASE}?run=${run.id}`);
    } catch (err) {
      setError(toDisplayError(err));
      setBusy(false);
    }
  };

  const loadError = contractors.error ?? runs.error;
  let body: React.ReactNode;
  if (loadError && (!contractors.data || !runs.data)) {
    body = (
      <Problem
        error={loadError}
        title="Could not load your people"
        onRetry={() => {
          void contractors.reload();
          void runs.reload();
        }}
      />
    );
  } else if (people && people.length === 0) {
    body = (
      <div className="space-y-4">
        <span className="grid size-11 place-items-center rounded-full bg-chip text-strong">
          <UsersRound className="size-5" aria-hidden="true" />
        </span>
        <h1 className="text-[1.75rem] leading-tight font-[380] tracking-[-0.015em]">Add the people you pay first</h1>
        <p className="text-[0.9375rem] text-muted-foreground">A payroll run has one payment per person.</p>
        <Button asChild size="lg">
          <Link href="/console/people">Add people</Link>
        </Button>
      </div>
    );
  } else if (!draft || !people || unseen) {
    body = <Loading label="Loading your people" />;
  } else if (review) {
    body = (
      <ReviewStep
        draft={draft}
        check={check}
        health={health}
        wallet={wallet.data}
        simulatedRate={simulatedRateOf(runs.data)}
        busy={busy}
        error={error}
        onBack={() => router.replace(BASE)}
        onApprove={onApprove}
      />
    );
  } else {
    body = (
      <AmountsStep
        draft={draft}
        setDraft={setDraft}
        contractors={people}
        check={check}
        submitted={submitted}
        source={source}
      />
    );
  }

  const showFooter = !review && !!draft && !!people && people.length > 0;
  return (
    <FocusShell
      context={CONTEXT}
      closeHref={CLOSE}
      rail={<FlowRail current={review ? 1 : 0} />}
      footer={showFooter ? <AmountsFooter check={check} onContinue={onContinue} /> : undefined}
    >
      {body}
    </FocusShell>
  );
}

function RunFlow({ runId }: { runId: string }) {
  const fetched = useResource((s) => api.run(runId, s), `flow-run-${runId}`);
  const [local, setLocal] = useState<Run | undefined>(undefined);
  const stream = useRunEvents(runId, !!fetched.data);
  const history = useResource((s) => api.runLog(runId, s), `flow-log-${runId}`);
  const runs = useResource((s) => api.runs(s), "flow-runs");
  const wallet = useResource((s) => api.wallet(s), "flow-wallet");
  const run = newerRun(newerRun(fetched.data, stream.run), local);
  const onRun = useCallback((r: Run) => setLocal((prev) => newerRun(prev, r)), []);
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

  let body: React.ReactNode;
  let rail = <FlowRail current={2} />;
  if (!run && fetched.error) {
    body =
      fetched.error.status === 404 ? (
        <div className="space-y-4">
          <h1 className="text-[1.75rem] leading-tight font-[380] tracking-[-0.015em]">This run does not exist</h1>
          <p className="text-[0.9375rem] text-muted-foreground">It may have been discarded while it was a draft.</p>
          <Button asChild size="lg">
            <Link href={BASE}>Start a new run</Link>
          </Button>
        </div>
      ) : (
        <Problem error={fetched.error} title="Could not load this run" onRetry={() => void fetched.reload()} />
      );
  } else if (!run) {
    body = <Loading label="Loading the run" />;
  } else {
    const phase = flowPhase(run);
    if (phase === "done") {
      rail = <FlowRail current={3} done />;
      body = <DoneStep run={run} />;
    } else if (phase === "pay") {
      rail = <FlowRail current={3} />;
      body = <PayStep run={run} onRun={onRun} logs={logs} stream={stream.state} />;
    } else if (run.status === "failed") {
      body = <FundingStopped run={run} onRun={onRun} />;
    } else {
      body = <FundStep run={run} onRun={onRun} wallet={wallet.data} simulatedRate={simulatedRateOf(runs.data)} />;
    }
  }

  return (
    <FocusShell context={CONTEXT} closeHref={CLOSE} rail={rail}>
      {body}
    </FocusShell>
  );
}

/** A run that failed before its funds arrived: say why, and resume. */
function FundingStopped({ run, onRun }: { run: Run; onRun: (run: Run) => void }) {
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
  return (
    <div className="space-y-5">
      <h1 className="text-[1.75rem] leading-tight font-[380] tracking-[-0.015em]">Funding stopped</h1>
      <p className="text-[0.9375rem] text-muted-foreground">Nothing was paid. Fix the cause below, then resume.</p>
      {run.error ? <Problem error={run.error} onRetry={resume} retryLabel="Resume" busy={busy} /> : null}
      {error ? <Problem error={error} title="Could not resume" /> : null}
      {!run.error ? (
        <Button size="lg" onClick={resume} disabled={busy}>
          {busy ? "Resuming" : "Resume"}
        </Button>
      ) : null}
    </div>
  );
}
