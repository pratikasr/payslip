"use client";

import Link from "next/link";
import { useState } from "react";
import { Archive, ExternalLink, Pencil, Share } from "lucide-react";
import { toast } from "sonner";
import { Usd, Zec } from "@/components/app/amount";
import { CopyButton } from "@/components/app/copy-button";
import { Initials } from "@/components/ds/avatar";
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
import { chainLabel } from "@/lib/addresses";
import { api, toDisplayError, type Contractor, type Run } from "@/lib/api";
import { formatDate, formatPeriodLabel, truncateMiddle } from "@/lib/format";
import { lineTag, linesWithRuns, settlementLabel, shortDate } from "@/components/console/lib";
import { Drawer } from "@/components/console/ui";

/** Mercury's detail drawer for one person: who they are, how they are paid, and every payment. */
export function PersonDrawer({
  contractor,
  runs,
  onClose,
  onEdit,
  onArchive,
}: {
  contractor: Contractor | undefined;
  runs: Run[];
  onClose: () => void;
  onEdit: (c: Contractor) => void;
  onArchive: (c: Contractor) => void;
}) {
  return (
    <Drawer
      open={!!contractor}
      onOpenChange={(o) => (o ? null : onClose())}
      title={contractor ? `${contractor.name}, contractor` : "Contractor"}
      eyebrow={contractor ? `Contractor · Account ${contractor.account_index}` : null}
    >
      {contractor ? <PersonBody contractor={contractor} runs={runs} onEdit={onEdit} onArchive={onArchive} /> : null}
    </Drawer>
  );
}

function PersonBody({
  contractor: c,
  runs,
  onEdit,
  onArchive,
}: {
  contractor: Contractor;
  runs: Run[];
  onEdit: (c: Contractor) => void;
  onArchive: (c: Contractor) => void;
}) {
  const history = linesWithRuns(runs).filter(({ line }) => line.contractor_id === c.id);
  const confirmed = history.filter(({ line }) => line.status === "confirmed");
  const paidCents = confirmed.reduce((s, { line }) => s + line.amount_usd_cents, 0);
  const paidZat = confirmed.reduce((s, { line }) => s + (line.amount_zat ?? 0), 0);

  return (
    <div className="pt-2">
      <div className="flex items-center gap-3">
        <Initials name={c.name} size="lg" />
        <div className="min-w-0">
          <h2 className="truncate text-[1.375rem] leading-tight font-[380] tracking-[-0.01em]">{c.name}</h2>
          {c.email ? <p className="truncate text-sm text-muted-foreground">{c.email}</p> : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <Tag>{settlementLabel(c)}</Tag>
        {c.fvk_shared_at ? <Tag>Payslips shared</Tag> : <Tag>Payslips not shared</Tag>}
      </div>

      <div className="mt-5">
        <div className="text-[0.8125rem] text-muted-foreground">Paid to date</div>
        <div className="mt-1 text-[1.75rem] leading-tight font-[380]">
          <Usd cents={paidCents} />
        </div>
        <Zec zat={paidZat} short className="text-sm text-muted-foreground" />
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

      <dl className="mt-6 grid gap-y-3.5 border-t border-hairline pt-5 text-[0.9375rem]">
        <Row label="Unified address">
          <span className="inline-flex items-center gap-0.5">
            <code className="font-mono text-[0.8125rem]" title={c.unified_address}>
              {truncateMiddle(c.unified_address, 10, 8)}
            </code>
            <CopyButton value={c.unified_address} label={`unified address for ${c.name}`} />
          </span>
        </Row>
        <Row label="Settlement">
          {c.settlement_choice === "convert_usdc" ? (
            <span className="text-right">
              Converts to USDC on {chainLabel(c.payout_chain)}
              {c.payout_address ? (
                <span className="block font-mono text-xs text-muted-foreground" title={c.payout_address}>
                  {truncateMiddle(c.payout_address, 8, 6)}
                </span>
              ) : null}
            </span>
          ) : (
            "Holds ZEC"
          )}
        </Row>
        <Row label="Payslip access">{c.fvk_shared_at ? `Shared ${formatDate(c.fvk_shared_at)}` : "Not shared yet"}</Row>
        <Row label="Account">{c.account_index}</Row>
        <Row label="Added">{formatDate(c.created_at)}</Row>
      </dl>

      <section aria-labelledby="history-title" className="mt-6 border-t border-hairline pt-5">
        <h3 id="history-title" className="text-[0.9375rem]">
          Payment history
        </h3>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            No payments yet. They appear here once a run includes them.
          </p>
        ) : (
          <ul className="mt-2">
            {history.map(({ line, run }) => {
              const tag = lineTag(line, run);
              return (
                <li
                  key={line.id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-hairline py-3 last:border-0"
                >
                  <span className="min-w-0">
                    <Link
                      href={`/console/runs/${run.id}`}
                      className="block truncate rounded-sm text-[0.9375rem] hover:underline"
                    >
                      {formatPeriodLabel(run.period_label)}
                      {line.invoice_ref ? <span className="text-muted-foreground"> · {line.invoice_ref}</span> : null}
                    </Link>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <Tag tone={tag.tone}>{tag.label}</Tag>
                      {line.status === "confirmed" ? shortDate(run.updated_at) : null}
                      {line.explorer_url ? (
                        <a
                          href={line.explorer_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-sm hover:text-foreground"
                          aria-label={`Open the ${formatPeriodLabel(run.period_label)} payment in a block explorer (opens in a new tab)`}
                        >
                          Explorer
                          <ExternalLink className="size-3" aria-hidden="true" />
                        </a>
                      ) : null}
                    </span>
                  </span>
                  <span className="text-right">
                    <Usd cents={line.amount_usd_cents} className="block text-[0.9375rem]" />
                    <Zec zat={line.amount_zat} short className="block text-xs text-muted-foreground" />
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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-strong">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

/** Confirm before archiving; the service refuses while a run that includes them is unfinished. */
export function ArchiveDialog({
  contractor,
  onClose,
  onArchived,
}: {
  contractor: Contractor | null;
  onClose: () => void;
  onArchived: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    if (!contractor) return;
    setBusy(true);
    setError(null);
    try {
      await api.archiveContractor(contractor.id);
      toast.success(`Archived ${contractor.name}`);
      onArchived(contractor.id);
      onClose();
    } catch (err) {
      const e = toDisplayError(err);
      setError(e.hint ? `${e.message} ${e.hint}` : e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={!!contractor}
      onOpenChange={(o) => {
        if (!o) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="gap-0 p-0 sm:max-w-md">
        <DialogHeader className="gap-1.5 px-6 pt-6 pb-4">
          <DialogTitle className="text-[1.375rem] leading-tight font-[380]">Archive {contractor?.name}?</DialogTitle>
          <DialogDescription className="text-[0.9375rem]">
            They leave the people list and new runs. Past payments stay on chain and in statements, and their viewing
            key keeps working.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="mx-6 mb-4 rounded-lg bg-danger-bg p-3 text-sm text-danger">
            {error}
          </p>
        ) : null}
        <DialogFooter className="mx-0 mb-0 rounded-b-xl px-6 py-4">
          <Button variant="secondary" onClick={onClose}>
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
