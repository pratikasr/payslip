"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Archive, ExternalLink, Pencil, Share } from "lucide-react";
import { toast } from "sonner";
import { Usd, Zec } from "@/components/app/amount";
import { CopyButton } from "@/components/app/copy-button";
import { useCoinUnit } from "@/components/app/health-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { Initials } from "@/components/ds/avatar";
import { Disclosure } from "@/components/ds/disclosure";
import { Sensitive } from "@/components/ds/sensitive";
import { StatusTag } from "@/components/ds/status";
import { Tag } from "@/components/ds/tag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { chainLabel } from "@/lib/addresses";
import { api, toDisplayError, type ApiError, type Contractor, type Run } from "@/lib/api";
import { formatDate, formatShortDate, parseUsdToCents, truncateMiddle, usdAmountProblem } from "@/lib/format";
import { latestPeriodFirst, lineConfirmedAt } from "@/lib/payroll";
import { linesWithRuns, runStateLabel, settlementLabel } from "@/components/console/lib";
import { Drawer, DrawerTitle } from "@/components/console/ui";
import { Problem } from "@/components/runs/problem";
import { accessTag, LineStatus, runTitle } from "@/components/runs/run-meta";
import { TYPE } from "@/components/ds/type";
import { cn } from "cn";

/** Mercury's detail drawer for one person: who they are, how they are paid, and every payment. */
export function PersonDrawer({
  contractor,
  runs,
  onClose,
  onEdit,
  onArchive,
  onSaved,
}: {
  contractor: Contractor | undefined;
  runs: Run[];
  onClose: () => void;
  onEdit: (c: Contractor) => void;
  onArchive: (c: Contractor) => void;
  /** The contractor after an edit made inside the drawer (the default amount). */
  onSaved?: (c: Contractor) => void;
}) {
  // The person shown last: when what opened the drawer is gone (the Add dialog), focus goes to
  // their name in the table.
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (contractor) last.current = contractor.id;
  }, [contractor]);
  return (
    <Drawer
      open={!!contractor}
      onOpenChange={(o) => (o ? null : onClose())}
      returnFocus={() =>
        last.current ? document.querySelector<HTMLElement>(`[data-person-open="${last.current}"]`) : null
      }
      title={contractor ? null : "Contractor"}
      eyebrow={contractor ? "Contractor" : null}
    >
      {contractor ? (
        <PersonBody contractor={contractor} runs={runs} onEdit={onEdit} onArchive={onArchive} onSaved={onSaved} />
      ) : null}
    </Drawer>
  );
}

function PersonBody({
  contractor: c,
  runs,
  onEdit,
  onArchive,
  onSaved,
}: {
  contractor: Contractor;
  runs: Run[];
  onEdit: (c: Contractor) => void;
  onArchive: (c: Contractor) => void;
  onSaved?: (c: Contractor) => void;
}) {
  const coin = useCoinUnit();
  const history = linesWithRuns(runs).filter(({ line }) => line.contractor_id === c.id);
  const confirmed = history.filter(({ line }) => line.status === "confirmed");
  const paidCents = confirmed.reduce((s, { line }) => s + line.amount_usd_cents, 0);
  const paidZat = confirmed.reduce((s, { line }) => s + (line.amount_zat ?? 0), 0);

  return (
    <div className="pt-2">
      <div className="flex items-center gap-3">
        <Initials name={c.name} size="lg" />
        <div className="min-w-0">
          {/* A long name wraps to two lines and an email breaks anywhere: nothing is cut off unseen. */}
          <DrawerTitle
            className="inked line-clamp-2 font-display text-[1.375rem] leading-[1.1] font-bold [overflow-wrap:anywhere]"
            title={c.name}
          >
            {c.name}
          </DrawerTitle>
          {c.email ? (
            <p className="mt-0.5 font-type text-[0.8125rem] [overflow-wrap:anywhere] text-muted-foreground">
              {c.email}
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <Tag>{settlementLabel(c, coin)}</Tag>
        <StatusTag status={{ ...accessTag(c), label: c.fvk_shared_at ? "Payslips shared" : "Payslips not shared" }} />
      </div>

      <div className="mt-5">
        <div className="form-label text-[0.75rem] font-bold text-muted-foreground">Paid to date</div>
        <div className={cn(TYPE.hero, "mt-2")}>
          <Usd cents={paidCents} />
        </div>
        <Zec zat={paidZat} short className="mt-1.5 block font-type text-[0.8125rem] text-muted-foreground" />
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={() => onEdit(c)}>
          <Pencil aria-hidden="true" />
          Edit
        </Button>
        <Button asChild variant="secondary" size="sm">
          <Link href={`/console/access#person-${c.id}`}>
            <Share aria-hidden="true" />
            Share payslips
          </Link>
        </Button>
        <Button variant="secondary" size="sm" onClick={() => onArchive(c)}>
          <Archive aria-hidden="true" />
          Archive
        </Button>
      </div>

      <dl className="green-bar mt-6 grid border-y-2 border-ink font-type text-[0.875rem]">
        <Row label="Zcash address">
          <span className="inline-flex items-center gap-0.5">
            <Sensitive>
              <code className="font-type text-[0.8125rem]" title={c.unified_address}>
                {truncateMiddle(c.unified_address, 10, 8)}
              </code>
            </Sensitive>
            <CopyButton value={c.unified_address} label={`unified address for ${c.name}`} />
          </span>
        </Row>
        <Row label="Settlement">
          {c.settlement_choice === "convert_usdc" ? (
            <span className="text-right">
              Converts to USDC on {chainLabel(c.payout_chain)}
              {c.payout_address ? (
                <span className="block font-type text-[0.8125rem] text-muted-foreground" title={c.payout_address}>
                  {truncateMiddle(c.payout_address, 8, 6)}
                </span>
              ) : null}
            </span>
          ) : (
            settlementLabel(c, coin)
          )}
        </Row>
        <Row label="Default amount">
          <DefaultAmount contractor={c} onSaved={onSaved} />
        </Row>
        <Row label="Payslip access">{c.fvk_shared_at ? `Shared ${formatDate(c.fvk_shared_at)}` : "Not shared yet"}</Row>
        <Row label="Added">{formatDate(c.created_at)}</Row>
      </dl>
      <Disclosure summary="Technical details" className="mt-4">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 font-type text-[0.8125rem]">
          <dt className="form-label text-[0.75rem] text-muted-foreground">Private account</dt>
          <dd className="num text-right">Account {c.account_index}</dd>
          <dt className="form-label text-[0.75rem] text-muted-foreground">Full address</dt>
          <dd className="min-w-0 text-right">
            <Sensitive>
              <code className="font-type [overflow-wrap:anywhere]">{c.unified_address}</code>
            </Sensitive>
          </dd>
        </dl>
      </Disclosure>

      <section aria-labelledby="history-title" className="mt-6 border-t border-ink pt-5">
        <h3 id="history-title" className="inked font-display text-[1.125rem] leading-tight font-bold">
          Payment history
        </h3>
        {history.length === 0 ? (
          <p className="mt-2 font-type text-[0.875rem] text-muted-foreground">
            No payments yet. They appear here once a run includes them.
          </p>
        ) : (
          <ul className="green-bar mt-3 border-y-2 border-ink font-type">
            {history.map(({ line, run }) => {
              const paidAt = lineConfirmedAt(line, run);
              return (
                <li
                  key={line.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-bar-line px-2 py-2.5 last:border-0"
                >
                  <span className="min-w-0">
                    <Link
                      href={`/console/runs/${run.id}`}
                      className="block truncate text-[0.9375rem] font-bold hover:underline"
                    >
                      {runTitle(run)}
                      {line.invoice_ref ? (
                        <span className="text-muted-foreground">, invoice {line.invoice_ref}</span>
                      ) : null}
                    </Link>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                      <LineStatus line={line} run={run} detail={paidAt ? formatShortDate(paidAt) : undefined} />
                      {line.explorer_url ? (
                        <a
                          href={line.explorer_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          aria-label={`Open the ${runTitle(run)} payment in a block explorer (opens in a new tab)`}
                        >
                          Explorer
                          <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                      ) : null}
                    </span>
                  </span>
                  <span className="text-right">
                    <Usd cents={line.amount_usd_cents} className="block text-[0.9375rem]" />
                    <Zec zat={line.amount_zat} short className="block text-[0.8125rem] text-muted-foreground" />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * What a scheduled payroll pays this person unless they sent a request for the period
 * (ADR-028), changed in place: Change, an amount, Save. Empty clears it.
 */
function DefaultAmount({ contractor: c, onSaved }: { contractor: Contractor; onSaved?: (c: Contractor) => void }) {
  const editable = useAuth().can("manage_contractors");
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cents = c.default_amount_usd_cents ?? null;
  const start = () => {
    setValue(cents ? (cents / 100).toFixed(2) : "");
    setError(null);
    setEditing(true);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const typed = value.trim();
    const parsed = typed ? parseUsdToCents(typed) : null;
    if (typed && (parsed === null || parsed <= 0)) {
      setError(usdAmountProblem(typed) ?? "The amount must be more than zero.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await api.updateContractor(c.id, { default_amount_usd_cents: typed ? parsed : null });
      onSaved?.(saved);
      toast.success(typed ? `Default amount for ${c.name} saved` : `Default amount for ${c.name} cleared`);
      setEditing(false);
    } catch (err) {
      const e = toDisplayError(err);
      setError(e.hint ? `${e.message} ${e.hint}` : e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!editing) {
    return (
      <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
        {cents ? <Usd cents={cents} /> : <span className="text-muted-foreground">None</span>}
        {editable ? (
          <Button variant="ghost" size="xs" onClick={start} aria-label={`Change default amount for ${c.name}`}>
            Change
          </Button>
        ) : null}
      </span>
    );
  }
  return (
    <form onSubmit={save} noValidate className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor={`default-amount-${c.id}`} className="sr-only">
          Default amount for {c.name}, US dollars
        </label>
        <div className="relative">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-1 -translate-y-1/2 font-type text-[0.8125rem] text-muted-foreground"
          >
            $
          </span>
          <Input
            id={`default-amount-${c.id}`}
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0.00"
            autoFocus
            className="money h-8 w-32 pl-5 text-right text-[0.9375rem] tracking-normal"
            aria-invalid={!!error}
            aria-describedby={error ? `default-amount-error-${c.id}` : undefined}
          />
        </div>
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? "Saving" : "Save"}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
      {error ? (
        <p id={`default-amount-error-${c.id}`} className="max-w-[18rem] text-[0.8125rem] text-destructive">
          {error}
        </p>
      ) : (
        <p className="text-[0.8125rem] text-muted-foreground">Prefilled into scheduled payroll. Empty clears it.</p>
      )}
    </form>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-bar-line px-2 py-2.5 last:border-b-0">
      <dt className="form-label shrink-0 pt-px text-[0.75rem] font-bold text-strong">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

/** Runs that include this person and are not finished: archiving does not take them out of these. */
function unfinishedRunsWith(runs: Run[], contractorId: string): Run[] {
  return latestPeriodFirst(
    runs.filter(
      (r) => r.status !== "paid" && r.status !== "cancelled" && r.lines.some((l) => l.contractor_id === contractorId),
    ),
  );
}

/**
 * Confirm before archiving. The dialog names any unfinished run that still includes the person,
 * and when the service refuses, it shows the service's reason and what to do, as it gives them.
 */
export function ArchiveDialog({
  contractor,
  runs,
  onClose,
  onArchived,
}: {
  contractor: Contractor | null;
  runs: Run[];
  onClose: () => void;
  onArchived: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // A new person (or closing by any path) starts with a clean dialog.
  useEffect(() => setError(null), [contractor?.id]);
  const close = () => {
    setError(null);
    onClose();
  };
  const unfinished = contractor ? unfinishedRunsWith(runs, contractor.id) : [];
  const confirm = async () => {
    if (!contractor) return;
    setBusy(true);
    setError(null);
    try {
      await api.archiveContractor(contractor.id);
      toast.success(`Archived ${contractor.name}`);
      onArchived(contractor.id);
      close();
    } catch (err) {
      setError(toDisplayError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!contractor}
      onOpenChange={(o) => {
        if (!o) close();
      }}
    >
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="gap-1.5 px-6 pt-6 pb-4">
          <DialogTitle className={cn(TYPE.heading, "[overflow-wrap:anywhere]")}>
            Archive {contractor?.name}?
          </DialogTitle>
          <DialogDescription className="text-[0.9375rem]">
            They leave the people list and new runs. Past payments stay on chain and in statements, and their viewing
            key keeps working.
          </DialogDescription>
        </DialogHeader>
        {unfinished.length > 0 ? (
          <div
            className="carbon-paper mx-6 mb-4 border border-carbon-line p-3 text-[0.8125rem] text-strong"
            role="note"
          >
            <p>
              {contractor?.name} {unfinished.length === 1 ? "is in a run" : "is in runs"} that{" "}
              {unfinished.length === 1 ? "has" : "have"} not finished.{" "}
              {unfinished.some((r) => r.status !== "draft")
                ? "Archiving waits until a run that has started finishes or is cancelled."
                : "A draft that includes them cannot be funded once they are archived: discard it and start a new one."}
            </p>
            <ul className="mt-1.5 grid gap-0.5">
              {unfinished.map((r) => (
                <li key={r.id}>
                  <Link href={`/console/runs/${r.id}`} className="text-link underline">
                    {runTitle(r)} run
                  </Link>{" "}
                  <span className="text-muted-foreground">{runStateLabel(r).toLowerCase()}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {error ? <Problem className="mx-6 mb-4" error={error} title="Not archived" /> : null}
        <DialogFooter className="mx-0 mb-0 px-6 py-4">
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={busy}>
            {busy ? "Archiving" : "Archive"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
