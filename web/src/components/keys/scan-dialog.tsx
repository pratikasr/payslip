"use client";

import dynamic from "next/dynamic";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

const QrScanner = dynamic(() => import("@/components/keys/qr-scanner"), {
  ssr: false,
  loading: () => <Skeleton className="aspect-video w-full" />,
});

export function ScanDialog({
  open,
  onOpenChange,
  onResult,
  title = "Scan a viewing key",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onResult: (value: string) => void;
  title?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            The image never leaves this browser. Only the decoded viewing key is used.
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <QrScanner
            onResult={(v) => {
              onResult(v);
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
