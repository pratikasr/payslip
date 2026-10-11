"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, LoaderCircle, SquareArrowOutUpRight } from "lucide-react";
import { toast } from "sonner";
import { Usd } from "@/components/app/amount";
import { ErrorState } from "@/components/app/states";
import { FormRow, FormRows } from "@/components/ds/paper";
import { TypedBox } from "@/components/portal/paper-parts";
import { createProof, monthDay, proofLink } from "@/components/portal/portal-data";
import { usePortalKey } from "@/components/portal/portal-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toDisplayError, type ApiError, type CreatedProof, type StatementLine } from "@/lib/api";
import { copyText } from "@/lib/download";
import { formatPeriodLabel } from "@/lib/format";

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
  // The control that opened the dialog (a row's Share proof), so closing it returns focus there.
  const opener = useRef<HTMLElement | null>(null);
  const open = !!line;
  useEffect(() => {
    if (open) opener.current = document.activeElement as HTMLElement | null;
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto p-6 sm:max-w-[500px]"
        onCloseAutoFocus={(e) => {
          if (!opener.current?.isConnected) return;
          e.preventDefault();
          opener.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Share proof of this payment</DialogTitle>
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

  const [note, setNote] = useState("");
  const link = proof ? proofLink(proof.token, note) : "";
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
      {/* The payment the proof opens, as the slip it is cut from. */}
      <div className="border border-bar-line">
        <FormRows>
          <FormRow label="Payslip">
            <span className="uppercase">{formatPeriodLabel(line.period)}</span>
          </FormRow>
          <FormRow label="Paid">{monthDay(line.block_time ?? line.date)}</FormRow>
          <FormRow label="Invoice">{line.invoice_ref}</FormRow>
          <FormRow label="Amount">
            <Usd cents={line.usd_basis_cents} />
          </FormRow>
        </FormRows>
      </div>

      {error ? <ErrorState error={error} onRetry={() => setAttempt((n) => n + 1)} compact /> : null}

      {!error && !proof ? (
        <p role="status" className="flex items-center gap-2.5 font-type text-[0.8125rem] text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin text-foreground motion-reduce:animate-none" aria-hidden="true" />
          Creating the proof from the Zcash chain
        </p>
      ) : null}

      {proof ? (
        <div className="space-y-2">
          <Label htmlFor="proof-link">Proof link</Label>
          <Input
            id="proof-link"
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="text-[0.8125rem] md:text-[0.8125rem]"
          />
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" onClick={copy}>
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button asChild variant="secondary">
              <a href={link} target="_blank" rel="noreferrer">
                <SquareArrowOutUpRight aria-hidden="true" />
                Open
              </a>
            </Button>
          </div>
        </div>
      ) : null}

      {proof ? (
        <div className="space-y-1.5">
          <Label htmlFor="proof-note" className="block leading-snug">
            Note for the reader <span className="font-normal tracking-normal normal-case">(optional)</span>
          </Label>
          <Input
            id="proof-note"
            value={note}
            maxLength={120}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Paid by Acme Labs for design work"
          />
          <p className="text-[0.8125rem] text-muted-foreground">
            Rides in the link and is shown as your note, marked as not checked. Payslip never stores it.
          </p>
        </div>
      ) : null}

      {/* What the reader gets and what they do not: two boxes of the form, one ticked. */}
      <dl className="grid gap-4 border-t border-dotted border-tear pt-4 text-[0.8125rem] sm:grid-cols-2">
        <div>
          <dt className="form-label flex items-center gap-2 text-[0.75rem] font-bold">
            <TypedBox checked />
            What it shows
          </dt>
          <dd className="mt-1.5 pl-[26px] text-muted-foreground">
            This payment: amount, date, the address it was paid to, period and invoice.
          </dd>
        </div>
        <div>
          <dt className="form-label flex items-center gap-2 text-[0.75rem] font-bold">
            <TypedBox />
            What stays private
          </dt>
          <dd className="mt-1.5 pl-[26px] text-muted-foreground">
            Your viewing key, your other payments and who paid you, unless your note says so.
          </dd>
        </div>
      </dl>
    </div>
  );
}
