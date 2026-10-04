import { cn } from "cn";
import type { FundingStatus, PayLineStatus, ReconciliationStatus, RunStatus } from "@/lib/api";

type Tone = "neutral" | "progress" | "success" | "warning" | "danger";

const TONES: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-border",
  progress: "bg-info-bg text-info border-transparent",
  success: "bg-success-bg text-success border-transparent",
  warning: "bg-warning-bg text-warning border-transparent",
  danger: "bg-danger-bg text-danger border-transparent",
};

const DOTS: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  progress: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function Badge({
  tone,
  children,
  title,
  className,
}: {
  tone: Tone;
  children: React.ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", DOTS[tone])} />
      {children}
    </span>
  );
}

/** Run statuses: one plain word each, defined once (docs/DESIGN.md). */
export const RUN_STATUS: Record<RunStatus, { label: string; tone: Tone; help: string }> = {
  draft: { label: "Draft", tone: "neutral", help: "Created. Fund it to continue." },
  awaiting_funds: {
    label: "Awaiting funds",
    tone: "warning",
    help: "Waiting for the USDC deposit to reach the swap venue.",
  },
  funded: { label: "Funded", tone: "progress", help: "ZEC is in the treasury. Execute the run to pay." },
  swapping: { label: "Swapping", tone: "progress", help: "The venue is converting USDC to ZEC." },
  swapped: { label: "Swapped", tone: "progress", help: "ZEC received at the recorded fill rate." },
  allocating: {
    label: "Allocating",
    tone: "progress",
    help: "Moving each line's ZEC from the treasury to the contractor's account.",
  },
  paying: { label: "Paying", tone: "progress", help: "Broadcasting one shielded payment per contractor." },
  paid: { label: "Paid", tone: "success", help: "Every line is paid." },
  failed: { label: "Failed", tone: "danger", help: "The run stopped. Read the error, fix it, then resume." },
};

export const LINE_STATUS: Record<PayLineStatus, { label: string; tone: Tone; help: string }> = {
  pending: { label: "Pending", tone: "neutral", help: "Not started yet." },
  allocated: {
    label: "Allocated",
    tone: "progress",
    help: "ZEC moved to this contractor's account; payment not sent yet.",
  },
  broadcast: { label: "Broadcast", tone: "progress", help: "Payment sent to the network; waiting to be mined." },
  confirmed: { label: "Confirmed", tone: "success", help: "Mined in a block." },
  failed: { label: "Failed", tone: "danger", help: "This line did not go through. Resume the run to retry it." },
};

export const FUNDING_STATUS: Record<FundingStatus, { label: string; tone: Tone }> = {
  awaiting_deposit: { label: "Awaiting deposit", tone: "warning" },
  processing: { label: "Processing", tone: "progress" },
  success: { label: "Received", tone: "success" },
  refunded: { label: "Refunded", tone: "danger" },
  failed: { label: "Failed", tone: "danger" },
  expired: { label: "Expired", tone: "danger" },
};

export const RECON_STATUS: Record<ReconciliationStatus, { label: string; tone: Tone; help: string }> = {
  reconciled: {
    label: "Reconciled",
    tone: "success",
    help: "Funded USD minus paid USD equals the ZEC not paid out, valued at the fill rate.",
  },
  variance_unexplained: {
    label: "Unexplained variance",
    tone: "danger",
    help: "The variance is larger than fees plus unspent ZEC can explain.",
  },
  missing_funding_record: {
    label: "No funding record",
    tone: "warning",
    help: "Payments were found but no funding for this run is visible with these keys. Include the treasury viewing key.",
  },
  incomplete: {
    label: "Incomplete",
    tone: "warning",
    help: "Some lines of this run are not mined yet or not visible with these keys.",
  },
};

export function RunStatusBadge({ status }: { status: RunStatus }) {
  const s = RUN_STATUS[status] ?? { label: status, tone: "neutral" as Tone, help: "" };
  return (
    <Badge tone={s.tone} title={s.help}>
      {s.label}
    </Badge>
  );
}

export function LineStatusBadge({ status }: { status: PayLineStatus }) {
  const s = LINE_STATUS[status] ?? { label: status, tone: "neutral" as Tone, help: "" };
  return (
    <Badge tone={s.tone} title={s.help}>
      {s.label}
    </Badge>
  );
}

export function FundingStatusBadge({ status }: { status: FundingStatus }) {
  const s = FUNDING_STATUS[status] ?? { label: status, tone: "neutral" as Tone };
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function ReconStatusBadge({ status }: { status: ReconciliationStatus }) {
  const s = RECON_STATUS[status] ?? { label: status, tone: "neutral" as Tone, help: "" };
  return (
    <Badge tone={s.tone} title={s.help}>
      {s.label}
    </Badge>
  );
}
