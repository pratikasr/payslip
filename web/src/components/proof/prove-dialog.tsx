"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Zec } from "@/components/app/amount";
import { CopyButton } from "@/components/app/copy-button";
import { ErrorState } from "@/components/app/states";
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
import { api, toDisplayError, type ApiError, type CreatedProof, type StatementLine } from "@/lib/api";
import { formatDate, formatPeriodLabel } from "@/lib/format";

/** The shareable link for a proof. The token rides in the fragment, which never reaches a server. */
export function proofUrl(token: string): string {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return `${origin}/verify#${token}`;
}

/**
 * Creates a proof for one statement line: a link that opens that payment, checked against the
 * chain, and nothing else. The viewing key goes to the service for this request only.
 */
export function ProveDialog({
  ufvk,
  line,
  onOpenChange,
}: {
  ufvk: string;
  line: StatementLine | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={!!line} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Prove this payment</DialogTitle>
          <DialogDescription>
            Anyone with this link can check this one payment against the Zcash chain: the amount, the date, the address
            it was paid to and its memo. They see nothing else, and they never get your viewing key.
          </DialogDescription>
        </DialogHeader>
        {line ? <ProveBody ufvk={ufvk} line={line} /> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProveBody({ ufvk, line }: { ufvk: string; line: StatementLine }) {
  const [proof, setProof] = useState<CreatedProof | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setProof(null);
    setError(null);
    api
      .createProof({ ufvk, txid: line.txid })
      .then((set) => {
        if (!live) return;
        // A transaction can hold more than one payment from the account; take the one on this line.
        const match = set.proofs.find((p) => p.amount_zat === line.amount_zat) ?? set.proofs[0];
        setProof(match ?? null);
      })
      .catch((err) => live && setError(toDisplayError(err)));
    return () => {
      live = false;
    };
  }, [ufvk, line.txid, line.amount_zat, attempt]);

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">Amount</dt>
          <dd>
            <Zec zat={line.amount_zat} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Paid</dt>
          <dd>{formatDate(line.block_time ?? line.date)}</dd>
        </div>
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <dt className="text-xs text-muted-foreground">Invoice</dt>
          <dd className="truncate" title={`${line.invoice_ref}, ${formatPeriodLabel(line.period)}`}>
            {line.invoice_ref}
          </dd>
        </div>
      </dl>
      {error ? <ErrorState error={error} onRetry={() => setAttempt((n) => n + 1)} compact /> : null}
      {!error && !proof ? (
        <div role="status" aria-label="Creating the proof" className="space-y-2">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-40" />
        </div>
      ) : null}
      {proof ? (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="proof-link" className="text-xs text-muted-foreground">
              Proof link
            </label>
            <div className="flex items-center gap-1">
              <input
                id="proof-link"
                readOnly
                value={proofUrl(proof.token)}
                onFocus={(e) => e.currentTarget.select()}
                className="h-9 w-full min-w-0 rounded-lg border border-input bg-card px-2.5 font-mono text-xs focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              />
              <CopyButton value={proofUrl(proof.token)} label="proof link" size="icon-sm" />
            </div>
          </div>
          <Button asChild variant="outline">
            <a href={`/verify#${proof.token}`} target="_blank" rel="noreferrer">
              <ExternalLink aria-hidden="true" />
              Open payslip
            </a>
          </Button>
          <p className="text-xs text-muted-foreground">
            The payslip page can be printed or saved as PDF, with a QR code that opens this same check.
          </p>
        </div>
      ) : null}
    </div>
  );
}
