"use client";

import { Download } from "lucide-react";
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
import { api } from "@/lib/api";
import { saveText } from "@/lib/download";
import { formatHeight, networkLabel, todayIso } from "@/lib/format";

export function ExportKeysDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Export viewing keys for your accountant</DialogTitle>
          <DialogDescription>
            One file with the treasury key and every contractor key. Whoever holds it can read every run and every
            payment, but cannot spend. Send it over a private channel.
          </DialogDescription>
        </DialogHeader>
        {open ? <ExportBody onClose={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ExportBody({ onClose }: { onClose: () => void }) {
  const data = useResource((s) => api.viewingKeyExport(s), "vk-export");
  if (data.error) return <ErrorState error={data.error} onRetry={data.reload} compact />;
  if (!data.data) {
    return (
      <div role="status" aria-label="Loading viewing keys" className="space-y-2">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }
  const exp = data.data;
  const json = JSON.stringify(exp, null, 2);
  const filename = `payslip-viewing-keys-${exp.network}-${todayIso()}.json`;
  return (
    <>
      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Network</dt>
          <dd>{networkLabel(exp.network)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Keys</dt>
          <dd className="num">{exp.keys.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Birthday height</dt>
          <dd className="num">{formatHeight(exp.birthday_height)}</dd>
        </div>
      </dl>
      <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border text-sm">
        {exp.keys.map((k) => (
          <li key={`${k.role}-${k.account_index}`} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0 truncate">{k.label}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {k.role === "treasury" ? "Treasury" : "Contractor"}, account {k.account_index}
            </span>
          </li>
        ))}
      </ul>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <CopyButton value={json} label="viewing key file">
          Copy JSON
        </CopyButton>
        <Button onClick={() => saveText(json, filename)}>
          <Download aria-hidden="true" />
          Download JSON
        </Button>
      </DialogFooter>
    </>
  );
}
