"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
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
import { useResource } from "@/hooks/use-resource";
import { api, toDisplayError, type Contractor } from "@/lib/api";
import { saveText } from "@/lib/download";
import { formatDate, formatHeight, networkLabel } from "@/lib/format";

const QrCode = dynamic(() => import("@/components/app/qr-code"), {
  ssr: false,
  loading: () => <Skeleton className="size-[266px]" />,
});

export function ShareKeyDialog({
  contractor,
  open,
  onOpenChange,
  onShared,
}: {
  contractor: Contractor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onShared: (c: Contractor) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Viewing key for {contractor.name}</DialogTitle>
          <DialogDescription>
            This key reads every payment from account {contractor.account_index} and nothing else. It cannot move funds.
            Send it to {contractor.name} privately, or let them scan the code.
          </DialogDescription>
        </DialogHeader>
        {open ? <ShareKeyBody contractor={contractor} onShared={onShared} onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ShareKeyBody({
  contractor,
  onShared,
  onClose,
}: {
  contractor: Contractor;
  onShared: (c: Contractor) => void;
  onClose: () => void;
}) {
  const key = useResource((s) => api.contractorViewingKey(contractor.id, s), `vk-${contractor.id}`);
  const [marking, setMarking] = useState(false);

  const markShared = async () => {
    setMarking(true);
    try {
      const updated = await api.markViewingKeyShared(contractor.id);
      onShared(updated);
      toast.success(`Marked the viewing key as shared with ${updated.name}`);
      onClose();
    } catch (err) {
      const e = toDisplayError(err);
      toast.error(e.message, { description: e.hint });
    } finally {
      setMarking(false);
    }
  };

  if (key.error) return <ErrorState error={key.error} onRetry={key.reload} compact />;
  if (!key.data) {
    return (
      <div role="status" aria-label="Loading viewing key" className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
        <Skeleton className="size-[266px]" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </div>
    );
  }

  const vk = key.data;
  const filename = `payslip-viewing-key-${contractor.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-account-${vk.account_index}.txt`;
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
        <div className="justify-self-center sm:justify-self-start">
          <QrCode value={vk.ufvk} label={`QR code of the viewing key for ${contractor.name}`} />
        </div>
        <div className="min-w-0 space-y-3">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Network</dt>
              <dd>{networkLabel(vk.network)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Birthday height</dt>
              <dd className="num">{formatHeight(vk.birthday_height)}</dd>
            </div>
          </dl>
          <div className="space-y-1.5">
            <label htmlFor={`ufvk-${contractor.id}`} className="text-xs text-muted-foreground">
              Unified full viewing key
            </label>
            <textarea
              id={`ufvk-${contractor.id}`}
              readOnly
              value={vk.ufvk}
              rows={6}
              spellCheck={false}
              onFocus={(e) => e.currentTarget.select()}
              className="w-full resize-none rounded-lg border bg-muted/50 p-2.5 font-mono text-xs break-all outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <CopyButton value={vk.ufvk} label="viewing key">
              Copy key
            </CopyButton>
            <Button variant="outline" size="sm" onClick={() => saveText(`${vk.ufvk}\n`, filename, "text/plain")}>
              <Download aria-hidden="true" />
              Download .txt
            </Button>
          </div>
        </div>
      </div>
      <DialogFooter className="sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {contractor.fvk_shared_at
            ? `Marked as shared on ${formatDate(contractor.fvk_shared_at)}.`
            : "Not marked as shared yet."}
        </p>
        {contractor.fvk_shared_at ? (
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
        ) : (
          <Button onClick={markShared} disabled={marking}>
            {marking ? "Saving" : "Mark as shared"}
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
