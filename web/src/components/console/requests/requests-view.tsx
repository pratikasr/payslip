"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ExternalLink, Inbox } from "lucide-react";
import { toast } from "sonner";
import { Usd } from "@/components/app/amount";
import { Initials } from "@/components/ds/avatar";
import { PageTitle } from "@/components/ds/page";
import { StatusTag } from "@/components/ds/status";
import { Tag } from "@/components/ds/tag";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useResource } from "@/hooks/use-resource";
import { api, toDisplayError, type ApiError, type PaymentRequest, type RequestCounts } from "@/lib/api";
import { formatDate, formatShortDate } from "@/lib/format";
import { cadenceLabel, queueOrder, requestTag } from "@/components/requests/request-meta";
import { Problem } from "@/components/runs/problem";
import { periodTitle } from "@/components/runs/run-meta";
import { FilterChips } from "@/components/console/ui";

type Filter = "review" | "approved" | "paid" | "rejected" | "all";

type Decision = { kind: "approve" | "reject"; request: PaymentRequest };

/** The payer's queue of payment requests: what needs a decision first, then everything else. */
export function RequestsView({ initial }: { initial?: { requests: PaymentRequest[]; counts: RequestCounts } }) {
  const queue = useResource((s) => api.requests(undefined, s), "requests-queue", initial);
  const [filter, setFilter] = useState<Filter>("review");
  const [decision, setDecision] = useState<Decision | null>(null);
  const all = useMemo(() => (queue.data?.requests ?? []).slice().sort(queueOrder), [queue.data]);
  const counts = {
    review: all.filter((r) => r.status === "submitted").length,
    approved: all.filter((r) => r.status === "approved").length,
    paid: all.filter((r) => r.status === "paid").length,
    rejected: all.filter((r) => r.status === "rejected").length,
  };
  const shown =
    filter === "all" ? all : all.filter((r) => (filter === "review" ? r.status === "submitted" : r.status === filter));
  const replace = (r: PaymentRequest) =>
    queue.setData((prev) => ({
      counts: prev?.counts ?? { submitted: 0, approved: 0 },
      requests: (prev?.requests ?? []).map((x) => (x.id === r.id ? r : x)),
    }));

  return (
    <>
      <PageTitle
        title="Payment requests"
        description="What your contractors asked to be paid. An approved request joins the next payroll run for its period."
      />
      {queue.error && !queue.data ? (
        <Problem error={queue.error} title="Could not load the requests" onRetry={queue.reload} />
      ) : !queue.data ? (
        <p role="status" className="text-[0.8125rem] text-muted-foreground">
          Loading requests
        </p>
      ) : all.length === 0 ? (
        <div className="flex flex-col items-start gap-4 border-t border-hairline py-12 sm:items-center sm:text-center">
          <span className="grid size-11 place-items-center rounded-full bg-chip text-strong">
            <Inbox className="size-5" aria-hidden="true" />
          </span>
          <div className="max-w-md space-y-1.5">
            <h2 className="text-[1.1875rem] font-normal tracking-[-0.01em]">No payment requests yet</h2>
            <p className="text-[0.9375rem] text-muted-foreground">
              Contractors send them from their portal under Request a payment. They appear here for you to approve or
              reject.
            </p>
          </div>
        </div>
      ) : (
        <>
          <FilterChips<Filter>
            label="Filter requests"
            value={filter}
            onChange={setFilter}
            options={[
              { id: "review", label: "To review", count: counts.review },
              { id: "approved", label: "Approved", count: counts.approved },
              { id: "paid", label: "Paid", count: counts.paid },
              { id: "rejected", label: "Rejected", count: counts.rejected },
              { id: "all", label: "All", count: all.length },
            ]}
          />
          <table className="w-full table-fixed border-collapse text-[0.9375rem]">
            <caption className="sr-only">Payment requests, those waiting for a decision first.</caption>
            <thead>
              <tr className="border-b border-hairline text-left text-[0.8125rem] text-muted-foreground">
                <th scope="col" className="py-3 pr-3 font-normal">
                  Request
                </th>
                <th scope="col" className="hidden w-[11rem] py-3 pr-3 font-normal md:table-cell">
                  Period
                </th>
                <th scope="col" className="w-[7.5rem] py-3 pr-3 text-right font-normal">
                  Amount
                </th>
                <th scope="col" className="w-[6.5rem] py-3 pr-3 font-normal sm:w-[7.5rem]">
                  Status
                </th>
                <th scope="col" className="hidden w-[12rem] py-3 text-right font-normal lg:table-cell">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr className="border-b border-hairline">
                  <td colSpan={5} className="h-[52px] text-[0.8125rem] text-muted-foreground">
                    Nothing here.
                  </td>
                </tr>
              ) : (
                shown.map((r) => (
                  <RequestRow key={r.id} request={r} onDecide={(kind) => setDecision({ kind, request: r })} />
                ))
              )}
            </tbody>
          </table>
        </>
      )}
      <DecisionDialog
        decision={decision}
        onClose={() => setDecision(null)}
        onDone={(r) => {
          replace(r);
          setDecision(null);
        }}
      />
    </>
  );
}

function RequestRow({
  request: r,
  onDecide,
}: {
  request: PaymentRequest;
  onDecide: (kind: "approve" | "reject") => void;
}) {
  const canApprove = r.status === "submitted";
  const canReject = r.status === "submitted" || (r.status === "approved" && !r.run_id);
  return (
    <tr className="border-b border-hairline align-top" data-request-status={r.status}>
      <td className="max-w-0 py-3 pr-3">
        <span className="flex min-w-0 items-start gap-3">
          <Initials name={r.contractor_name} className="mt-0.5" />
          <span className="min-w-0 flex-1">
            <span className="block truncate" title={r.contractor_name}>
              {r.contractor_name}
            </span>
            <span className="block truncate text-[0.8125rem] text-muted-foreground" title={r.invoice_ref}>
              {r.invoice_ref}
              {r.recurring ? <span> · repeats {cadenceLabel(r.recurring).toLowerCase()}</span> : null}
            </span>
            <span className="block text-[0.8125rem] text-muted-foreground md:hidden">
              {periodTitle(r.period_start, r.period_end)}
            </span>
            {r.note ? (
              <span className="mt-1 block text-[0.8125rem] text-strong [overflow-wrap:anywhere]">{r.note}</span>
            ) : null}
            {r.decision_note ? (
              <span className="mt-1 block text-[0.8125rem] text-muted-foreground [overflow-wrap:anywhere]">
                Your note: {r.decision_note}
              </span>
            ) : null}
            <span className="mt-1 flex flex-wrap gap-2 lg:hidden">
              <Actions request={r} canApprove={canApprove} canReject={canReject} onDecide={onDecide} />
            </span>
          </span>
        </span>
      </td>
      <td className="hidden py-3 pr-3 md:table-cell">
        <span className="block">{periodTitle(r.period_start, r.period_end)}</span>
        <span className="block text-[0.8125rem] text-muted-foreground">
          Sent {formatShortDate(r.created_at)}
          {r.due_date ? `, due ${formatShortDate(r.due_date)}` : ""}
        </span>
      </td>
      <td className="py-3 pr-3 text-right">
        <Usd cents={r.amount_usd_cents} />
      </td>
      <td className="py-3 pr-3">
        <StatusTag status={requestTag(r)} />
        {r.status === "paid" && r.explorer_url ? (
          <a
            href={r.explorer_url}
            target="_blank"
            rel="noreferrer"
            className="mt-1 inline-flex items-center gap-1 rounded-sm text-[0.8125rem] text-muted-foreground hover:text-foreground"
            aria-label={`Open the payment to ${r.contractor_name} in a block explorer (opens in a new tab)`}
          >
            Explorer
            <ExternalLink className="size-3" aria-hidden="true" />
          </a>
        ) : null}
      </td>
      <td className="hidden py-3 text-right lg:table-cell">
        <span className="inline-flex flex-wrap justify-end gap-2">
          <Actions request={r} canApprove={canApprove} canReject={canReject} onDecide={onDecide} />
        </span>
      </td>
    </tr>
  );
}

function Actions({
  request: r,
  canApprove,
  canReject,
  onDecide,
}: {
  request: PaymentRequest;
  canApprove: boolean;
  canReject: boolean;
  onDecide: (kind: "approve" | "reject") => void;
}) {
  if (r.run_id) {
    return (
      <Button asChild size="sm" variant="secondary">
        <Link href={r.status === "paid" ? `/console/runs/${r.run_id}` : `/console/runs/new?run=${r.run_id}`}>
          {r.status === "paid" ? "Open run" : "Open draft"}
        </Link>
      </Button>
    );
  }
  return (
    <>
      {canApprove ? (
        <Button
          size="sm"
          onClick={() => onDecide("approve")}
          aria-label={`Approve, ${r.contractor_name} ${r.invoice_ref}`}
        >
          Approve
        </Button>
      ) : null}
      {canReject ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onDecide("reject")}
          aria-label={`Reject, ${r.contractor_name} ${r.invoice_ref}`}
        >
          Reject
        </Button>
      ) : null}
      {r.status === "rejected" ? <Tag>Decided {formatShortDate(r.decided_at)}</Tag> : null}
    </>
  );
}

/** Approve or reject, with a note the contractor sees. */
function DecisionDialog({
  decision,
  onClose,
  onDone,
}: {
  decision: Decision | null;
  onClose: () => void;
  onDone: (r: PaymentRequest) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const r = decision?.request;
  const approve = decision?.kind === "approve";
  const close = () => {
    setNote("");
    setError(null);
    onClose();
  };
  const confirm = async () => {
    if (!r) return;
    setBusy(true);
    setError(null);
    try {
      const saved = approve ? await api.approveRequest(r.id, note.trim()) : await api.rejectRequest(r.id, note.trim());
      toast.success(
        approve
          ? `Approved ${r.invoice_ref} from ${r.contractor_name}. It joins the next run for ${periodTitle(r.period_start, r.period_end)}.`
          : `Rejected ${r.invoice_ref} from ${r.contractor_name}`,
      );
      setNote("");
      onDone(saved);
    } catch (err) {
      setError(toDisplayError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!decision}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="gap-1.5 px-6 pt-6 pb-4">
          <DialogTitle className="text-[1.1875rem] leading-tight font-[380] [overflow-wrap:anywhere]">
            {approve ? "Approve" : "Reject"} {r?.invoice_ref} from {r?.contractor_name}?
          </DialogTitle>
          <DialogDescription className="text-[0.9375rem]">
            {r ? (
              <>
                <Usd cents={r.amount_usd_cents} /> for {periodTitle(r.period_start, r.period_end)}
                {r.due_date ? `, due ${formatDate(r.due_date)}` : ""}.{" "}
                {approve
                  ? "It joins the next payroll run for that period as a prefilled line. Nothing is paid until that run is funded and paid."
                  : "The contractor sees the rejection and your note."}
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5 px-6 pb-4">
          <Label htmlFor="decision-note">Note to the contractor (optional)</Label>
          <Textarea
            id="decision-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder={approve ? "Thanks, paid with October's run." : "Why it is not being paid."}
          />
        </div>
        {error ? (
          <Problem className="mx-6 mb-4" error={error} title={approve ? "Not approved" : "Not rejected"} />
        ) : null}
        <DialogFooter className="mx-0 mb-0 rounded-b-xl px-6 py-4">
          <Button variant="secondary" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button variant={approve ? "default" : "destructive"} onClick={confirm} disabled={busy}>
            {busy ? (approve ? "Approving" : "Rejecting") : approve ? "Approve" : "Reject"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
