"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { UsersRound } from "lucide-react";
import { useHealth } from "@/components/app/health-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { FocusShell } from "@/components/shell/focus-shell";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { useRunEvents } from "@/hooks/use-run-events";
import { api, toDisplayError, type ApiError, type Health, type Run, type RunLogEvent } from "@/lib/api";
import { rateE6FromDecimal } from "@/lib/format";
import { overlappingRuns } from "@/lib/payroll";
import { requestsByContractor, requestsForPeriod } from "@/components/requests/request-meta";
import { Problem } from "../problem";
import { CancelRun } from "../cancel-run";
import {
  archivedLineIds,
  canCancel,
  failureTitle,
  flowPhase,
  fundingClosed,
  newerRun,
  retryOnce,
  runTitle,
} from "../run-meta";
import { useRunPoll } from "../use-run-poll";
import { AmountsFooter, AmountsStep } from "./amounts-step";
import {
  applyRequests,
  idempotencyKey,
  newIdempotencyKey,
  runMatches,
  runRequest,
  sourceRun,
  useDraft,
  useDraftCheck,
  type Draft,
} from "./draft";
import { FundStep } from "./fund-step";
import { DoneStep, PayStep } from "./pay-step";
import { FlowRail, FlowTitle, useStepFocus } from "./rail";
import { ReviewStep, type Mismatch } from "./review-step";
import { DraftSummary, RunSummary } from "./summary";

const BASE = "/console/runs/new";
const CONTEXT = "Run payroll";
const CLOSE = "/console/runs";

/**
 * The testnet venue's fixed rate (USD per TAZ times 1e6): from health (`simulated_rate_usd_per_zec`,
 * so a first run on a new wallet has an estimate), else from the most recently updated testnet
 * funding record. Null on mainnet and before either is known.
 */
export function simulatedRateOf(runs: Run[] | undefined, health?: Health): number | null {
  const fromHealth = rateE6FromDecimal(health?.simulated_rate_usd_per_zec);
  if (fromHealth) return fromHealth;
  const r = [...(runs ?? [])]
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
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
  // The step on screen before this one, kept here so approving (the draft gives way to the run)
  // still counts as moving on: focus then goes to the Fund step's heading.
  const previousStep = useRef<number | null>(null);
  if (runId) return <RunFlow key={runId} runId={runId} previousStep={previousStep} />;
  return (
    <DraftFlow review={params.get("step") === "review"} repeatId={params.get("repeat")} previousStep={previousStep} />
  );
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

function DraftFlow({
  review,
  repeatId,
  previousStep,
}: {
  review: boolean;
  repeatId: string | null;
  previousStep: RefObject<number | null>;
}) {
  const router = useRouter();
  const { health } = useHealth();
  const auth = useAuth();
  const contractors = useResource((s) => api.contractors(s), "flow-contractors");
  const runs = useResource((s) => api.runs(s), "flow-runs");
  const wallet = useResource((s) => api.wallet(s), "flow-wallet");
  const people = useMemo(
    () => (contractors.data ? [...contractors.data].sort((a, b) => a.account_index - b.account_index) : undefined),
    [contractors.data],
  );
  const { draft, setDraft, clearStored } = useDraft(people, runs.data, repeatId);
  const check = useDraftCheck(draft, people ?? [], runs.data);
  const source = useMemo(() => sourceRun(runs.data, repeatId), [runs.data, repeatId]);
  // Approved payment requests for the draft's period (ADR-028): prefilled as lines, marked
  // "From a request", and named to the service when the run is created. An older service
  // without the queue answers 404, and nothing is offered.
  const approved = useResource((s) => api.requests("approved", s).then((r) => r.requests), "flow-requests");
  const from = draft?.from;
  const to = draft?.to;
  const offered = useMemo(
    () => (from && to ? requestsForPeriod(approved.data, { from, to }) : []),
    [approved.data, from, to],
  );
  useEffect(() => {
    if (offered.length > 0) setDraft((d) => applyRequests(d, offered));
  }, [offered, setDraft]);
  const requestsByPerson = useMemo(() => requestsByContractor(offered), [offered]);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // A run the approval's key already made with other amounts (never treated as approval): the
  // service names it (409 idempotency_mismatch), or an older service answered with it.
  const [mismatch, setMismatch] = useState<Mismatch | null>(null);
  const simulatedRate = simulatedRateOf(runs.data, health);

  const onContinue = () => {
    setSubmitted(true);
    if (!check.valid) {
      const firstBad = check.included.find((c) => check.lineErrors[c.id]);
      if (firstBad) document.getElementById(`${check.lineErrors[firstBad.id].field}-${firstBad.id}`)?.focus();
      else if (check.periodError) document.getElementById("period-start")?.focus();
      else if (check.overlapUnconfirmed) document.getElementById("overlap-confirm")?.focus();
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

  /**
   * Creates the run. The key comes from the draft's salt and exactly these amounts, so a retry of
   * the same review returns the run it already made, and an edited one makes a new run. The answer
   * is checked against what was reviewed before the flow moves on.
   */
  const approve = async (d: Draft) => {
    if (!check.valid || busy) return;
    setBusy(true);
    setError(null);
    setMismatch(null);
    const body = runRequest(d, check.included);
    // check.valid means any overlapping run was confirmed with "This is an extra run": only then
    // may the service create a run whose period another run covers. The key is computed from the
    // body without the flag, as the service compares it.
    const allowOverlap = check.overlaps.length > 0;
    // The requests whose lines the payer kept: the service pays them with those lines.
    const requestIds = offered.filter((r) => check.included.some((c) => c.id === r.contractor_id)).map((r) => r.id);
    try {
      const run = await api.createRun({
        ...body,
        idempotency_key: idempotencyKey(d.key, body),
        ...(allowOverlap ? { allow_overlap: true } : {}),
        ...(requestIds.length > 0 ? { request_ids: requestIds } : {}),
      });
      if (!runMatches(run, body)) {
        setMismatch({ id: run.id, run });
        setBusy(false);
        return;
      }
      // With sign-in on and one approval required, Approve is that approval. With two or more the
      // creator cannot give one, so the run goes on unapproved and the run page asks the others.
      // A failure here is not a failure to create the run: the run page shows the approval state
      // and offers Approve again.
      if (auth.required && (run.approvals_required ?? 0) === 1) {
        try {
          await api.approveRun(run.id);
        } catch {
          // The run page says where the approvals stand.
        }
      }
      clearStored();
      router.replace(`${BASE}?run=${run.id}`);
    } catch (err) {
      const e = toDisplayError(err);
      if (e.code === "idempotency_mismatch" && e.runs[0]) {
        // This approval's key already made a run with other amounts: name it, never take it.
        setMismatch({ id: e.runs[0], run: runs.data?.find((r) => r.id === e.runs[0]) ?? null });
      } else {
        // A period another run now covers (made in another tab, say): reload the runs, so the
        // overlap warning names them and asks for the extra-run confirmation.
        if (e.code === "period_overlap") void runs.reload();
        setError(e);
      }
      setBusy(false);
    }
  };
  const onApprove = () => {
    if (draft) void approve(draft);
  };
  /** After a mismatch: a fresh salt, so this review becomes its own run. */
  const onApproveAsNew = () => {
    if (!draft) return;
    const next = { ...draft, key: newIdempotencyKey() };
    setDraft(() => next);
    void approve(next);
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
        <span className="grid size-11 place-items-center border-2 border-ink text-strong">
          <UsersRound className="size-5" aria-hidden="true" />
        </span>
        <FlowTitle>Add the people you pay first</FlowTitle>
        <p className="text-[0.9375rem] text-muted-foreground">A payroll run has one payment per person.</p>
        <Button asChild size="lg">
          <Link href="/console/people?add=1">Add people</Link>
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
        simulatedRate={simulatedRate}
        busy={busy}
        error={error}
        mismatch={mismatch}
        setDraft={setDraft}
        submitted={submitted}
        fromRequests={requestsByPerson}
        onBack={() => router.replace(BASE)}
        onApprove={onApprove}
        onApproveAsNew={onApproveAsNew}
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
        requests={requestsByPerson}
      />
    );
  }

  const showFooter = !review && !!draft && !!people && people.length > 0;
  const step = review ? 1 : 0;
  useStepFocus(step, previousStep, !!draft && !!people && !unseen);
  return (
    <FocusShell
      context={CONTEXT}
      closeHref={CLOSE}
      rail={<FlowRail current={step} />}
      footer={showFooter ? <AmountsFooter check={check} onContinue={onContinue} /> : undefined}
      summary={
        draft && people && people.length > 0 && !unseen ? (
          <DraftSummary draft={draft} check={check} wallet={wallet.data} simulatedRate={simulatedRate} />
        ) : undefined
      }
    >
      {body}
    </FocusShell>
  );
}

function RunFlow({ runId, previousStep }: { runId: string; previousStep: RefObject<number | null> }) {
  const { health } = useHealth();
  const fetched = useResource((s) => api.run(runId, s), `flow-run-${runId}`);
  const [local, setLocal] = useState<Run | undefined>(undefined);
  const stream = useRunEvents(runId, !!fetched.data);
  const history = useResource((s) => api.runLog(runId, s), `flow-log-${runId}`);
  const runs = useResource((s) => api.runs(s), "flow-runs");
  const wallet = useResource((s) => api.wallet(s), "flow-wallet");
  const contractors = useResource((s) => api.contractors(s), `flow-run-people-${runId}`);
  const run = newerRun(newerRun(fetched.data, stream.run), local);
  const onRun = useCallback((r: Run) => setLocal((prev) => newerRun(prev, r)), []);
  // Without a live stream (too many open, or dropped), the flow polls the run instead.
  useRunPoll(run, stream.state, () => {
    void fetched.reload();
    void history.reload();
  });
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
  let step = 2;
  const simulatedRate = simulatedRateOf(runs.data, health);
  if (!run && fetched.error) {
    body =
      fetched.error.status === 404 ? (
        <div className="space-y-4">
          <FlowTitle>This run does not exist</FlowTitle>
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
  } else if (run.status === "cancelled") {
    body = (
      <div className="space-y-4">
        <FlowTitle>The {runTitle(run)} run was cancelled</FlowTitle>
        <p className="text-[0.9375rem] text-muted-foreground">
          No money reached it and nobody was paid. It stays on record on its run page.
        </p>
        <div className="flex flex-wrap gap-2.5">
          <Button asChild size="lg">
            <Link href={BASE}>Start a new run</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link href={`/console/runs/${run.id}`}>View run</Link>
          </Button>
        </div>
      </div>
    );
  } else {
    const phase = flowPhase(run);
    if (phase === "done") {
      step = 4;
      body = <DoneStep run={run} />;
    } else if (phase === "pay") {
      step = 3;
      body = <PayStep run={run} onRun={onRun} logs={logs} stream={stream.state} />;
    } else if (run.status === "failed" && !fundingClosed(run)) {
      body = <FundingStopped run={run} onRun={onRun} />;
    } else {
      body = (
        <FundStep
          run={run}
          onRun={onRun}
          wallet={wallet.data}
          onWallet={(w) => wallet.setData(w)}
          simulatedRate={simulatedRate}
          overlaps={runs.data ? overlappingRuns(runs.data, { from: run.period_start, to: run.period_end }, run.id) : []}
          archived={archivedLineIds(run, contractors.data)}
        />
      );
    }
  }
  useStepFocus(step, previousStep, !!run);

  return (
    <FocusShell
      context={CONTEXT}
      closeHref={CLOSE}
      rail={<FlowRail current={Math.min(step, 3)} done={step === 4} />}
      summary={run && run.status !== "cancelled" ? <RunSummary run={run} simulatedRate={simulatedRate} /> : undefined}
    >
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
      <FlowTitle>{run.error ? failureTitle(run) : "Funding stopped"}</FlowTitle>
      <p className="text-[0.9375rem] text-muted-foreground">Nothing was paid. Fix the cause below, then resume.</p>
      {run.error ? (
        <Problem error={run.error} onRetry={resume} retryLabel="Resume" busyLabel="Resuming" busy={busy} />
      ) : null}
      {error ? <Problem error={error} title="Could not resume" /> : null}
      {!run.error ? (
        <Button size="lg" onClick={resume} disabled={busy}>
          {busy ? "Resuming" : "Resume"}
        </Button>
      ) : null}
      {canCancel(run) ? <CancelRun run={run} onCancelled={onRun} /> : null}
    </div>
  );
}
