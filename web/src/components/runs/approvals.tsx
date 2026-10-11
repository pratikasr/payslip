"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { api, toDisplayError, type ApiError, type Run } from "@/lib/api";
import { approvalSentence, approvalState } from "@/lib/approvals";
import { cn } from "cn";
import { Problem } from "./problem";

/**
 * Where a run's approvals stand, in one sentence, with Approve for a member who may give the
 * next one. Shown on the run page's next-action card and on the Pay step. Nothing renders when
 * the deployment needs no approvals (sign-in off, or the policy at 0).
 */
export function ApprovalStatus({ run, onRun, className }: { run: Run; onRun: (run: Run) => void; className?: string }) {
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const state = approvalState(run, auth);
  if (!state) return null;

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      onRun(await api.approveRun(run.id));
    } catch (err) {
      setError(toDisplayError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn("grid gap-2", className)} data-testid="run-approvals">
      <p className="font-type text-[0.8125rem] text-foreground" aria-live="polite">
        {approvalSentence(state)}
        {state.reason ? <span className="font-sans text-muted-foreground"> {state.reason}</span> : null}
      </p>
      {state.canApprove ? (
        <div>
          <Button size="sm" variant="secondary" onClick={() => void approve()} disabled={busy}>
            {busy ? "Approving" : "Approve"}
          </Button>
        </div>
      ) : null}
      {error ? <Problem error={error} title="Could not approve" onRetry={approve} busy={busy} /> : null}
    </div>
  );
}
