"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Eye, EyeOff, LoaderCircle, SquareArrowOutUpRight } from "lucide-react";
import { toast } from "sonner";
import { Usd } from "@/components/app/amount";
import { ErrorState } from "@/components/app/states";
import { createProof, monthDay, payslipTitle, proofLink } from "@/components/portal/portal-data";
import { usePortalKey } from "@/components/portal/portal-provider";
import { DocIcon } from "@/components/portal/portal-states";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toDisplayError, type ApiError, type CreatedProof, type StatementLine } from "@/lib/api";
import { copyText } from "@/lib/download";

/**
 * Share proof: makes a link that opens this one payment, checked against the chain, for someone
 * who holds no key (a landlord, a bank, a visa office). The key goes to the service for this
 * request only.
 */
export function ShareProofDialog({
  line,
  onOpenChange,
  onCreated,
}: {
  line: StatementLine | null;
  onOpenChange: (open: boolean) => void;
  onCreated?: (proof: CreatedProof) => void;
}) {
  return (
    <Dialog open={!!line} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 p-6 sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="text-[1.1875rem] leading-snug font-normal tracking-[-0.01em]">
            Share proof of this payment
          </DialogTitle>
          <DialogDescription className="text-[0.9375rem]">
            Anyone with the link can check this one payment against the Zcash chain. They need no key and no account.
          </DialogDescription>
        </DialogHeader>
        {line ? <ShareBody line={line} onCreated={onCreated} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ShareBody({ line, onCreated }: { line: StatementLine; onCreated?: (proof: CreatedProof) => void }) {
  const ufvk = usePortalKey();
  const [proof, setProof] = useState<CreatedProof | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [copied, setCopied] = useState(false);
  const created = useRef(onCreated);
  useEffect(() => {
    created.current = onCreated;
  });

  useEffect(() => {
    let live = true;
    setProof(null);
    setError(null);
    createProof(ufvk, line)
      .then((p) => {
        if (!live) return;
        setProof(p);
        created.current?.(p);
      })
      .catch((err) => live && setError(toDisplayError(err)));
    return () => {
      live = false;
    };
  }, [ufvk, line, attempt]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const link = proof ? proofLink(proof.token) : "";
  const copy = async () => {
    if (await copyText(link)) {
      setCopied(true);
      toast.success("Proof link copied");
    } else {
      toast.error("Could not copy the link. Select it and copy it by hand.");
    }
  };

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex items-center gap-3 rounded-[10px] border px-3.5 py-3">
        <DocIcon className="h-9 w-8" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem]">{payslipTitle(line)}</p>
          <p className="truncate text-[0.8125rem] text-muted-foreground">
            Paid {monthDay(line.block_time ?? line.date)} · {line.invoice_ref}
          </p>
        </div>
        <Usd cents={line.usd_basis_cents} className="text-[0.9375rem]" />
      </div>

      {error ? <ErrorState error={error} onRetry={() => setAttempt((n) => n + 1)} compact /> : null}

      {!error && !proof ? (
        <p role="status" className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin text-foreground" aria-hidden="true" />
          Creating the proof from the Zcash chain
        </p>
      ) : null}

      {proof ? (
        <div className="space-y-2">
          <label htmlFor="proof-link" className="text-[0.8125rem] text-muted-foreground">
            Proof link
          </label>
          <input
            id="proof-link"
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="h-10 w-full min-w-0 rounded-lg border border-input bg-raised px-3 font-mono text-xs text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
          />
          <div className="flex flex-wrap gap-2 pt-1">
            <Button type="button" onClick={copy}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button asChild variant="secondary">
              <a href={`/verify#${proof.token}`} target="_blank" rel="noreferrer">
                <SquareArrowOutUpRight aria-hidden="true" />
                Open
              </a>
            </Button>
          </div>
        </div>
      ) : null}

      <dl className="grid gap-3 border-t border-hairline pt-4 text-sm sm:grid-cols-2">
        <div className="flex items-start gap-2.5">
          <Eye className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <dt className="text-foreground">What it shows</dt>
            <dd className="text-muted-foreground">
              This payment: amount, date, the address it was paid to, period and invoice.
            </dd>
          </div>
        </div>
        <div className="flex items-start gap-2.5">
          <EyeOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <dt className="text-foreground">What stays private</dt>
            <dd className="text-muted-foreground">Your viewing key, your other payments and who paid you.</dd>
          </div>
        </div>
      </dl>
    </div>
  );
}
