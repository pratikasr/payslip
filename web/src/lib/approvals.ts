/*
  Recorded approvals (service migration 0007): with sign-in on, a run needs
  `approvals_required` approvals from admins or approvers (one each) before the service pays it.
  This reads a run's approval state and says it the one way every screen uses ("Approved by
  Amara, waiting for one more"). The service decides; this only hides a button it would refuse.
*/
import type { Me, Run, RunApproval, RunStatus } from "@/lib/api";
import type { Permission } from "@/lib/roles";

/** What this file needs of the sign-in state (components/auth/auth-provider.tsx). */
export interface Approver {
  required: boolean;
  me: Me | null;
  can: (permission: Permission) => boolean;
}

/** Statuses in which a run can still be approved: it has not passed its swap. */
const APPROVABLE: ReadonlySet<RunStatus> = new Set(["draft", "awaiting_funds", "funded"]);

/** True while the run can still be approved; a failed run counts by where it stopped. */
export function approvable(run: Pick<Run, "status" | "failed_from">): boolean {
  if (APPROVABLE.has(run.status)) return true;
  return run.status === "failed" && (!run.failed_from || APPROVABLE.has(run.failed_from));
}

export interface ApprovalState {
  required: number;
  approvals: RunApproval[];
  /** Approvals still needed; 0 once the count is met. */
  missing: number;
  met: boolean;
  /** The signed-in member already approved this run. */
  mine: boolean;
  /** The signed-in member may approve it now. */
  canApprove: boolean;
  /** Why an admin or approver cannot approve it now; null when they can, or when their role never could. */
  reason: string | null;
}

/** The run's approval state for the signed-in member; null when the deployment needs no approvals. */
export function approvalState(run: Run, auth: Approver): ApprovalState | null {
  const required = run.approvals_required ?? 0;
  if (!auth.required || required <= 0) return null;
  const approvals = run.approvals ?? [];
  const missing = Math.max(0, required - approvals.length);
  const met = missing === 0;
  const me = auth.me?.user.id ?? null;
  const mine = !!me && approvals.some((a) => a.user_id === me);
  let canApprove = false;
  let reason: string | null = null;
  if (!met && approvable(run) && auth.can("manage_runs")) {
    if (mine) reason = "You approved it; another admin or approver gives the next approval.";
    else if (required >= 2 && !!me && run.created_by === me)
      reason = "You created this run, so its approvals come from other admins or approvers.";
    else canApprove = true;
  }
  return { required, approvals, missing, met, mine, canApprove, reason };
}

export function approverName(a: RunApproval): string {
  return a.name?.trim() || a.email;
}

function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number) => WORDS[n] ?? String(n);

/** "Approved by Amara, waiting for one more.", "Waiting for two approvals.", "Approved by Amara and Ben." */
export function approvalSentence(s: ApprovalState): string {
  const names = s.approvals.map(approverName);
  if (s.met) return `Approved by ${list(names)}.`;
  if (names.length === 0) {
    return s.required === 1 ? "Waiting for one approval." : `Waiting for ${count(s.required)} approvals.`;
  }
  return `Approved by ${list(names)}, waiting for ${count(s.missing)} more.`;
}
