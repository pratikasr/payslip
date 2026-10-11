"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, toDisplayError, type ApiError, type Run } from "@/lib/api";
import { Problem } from "./problem";
import { plural, runTitle } from "./run-meta";
import { TYPE } from "@/components/ds/type";

/**
 * Cancel a run that never received money (waiting for a deposit, set aside on testnet, or stopped
 * before its funds arrived). It stays on record as cancelled and stops counting as active, so its
 * people can be edited and archived. The service refuses when money did arrive
 * (`run_has_funds`) or the venue holds a deposit (`deposit_in_progress`), and says what to do.
 */
export function CancelRun({
  run,
  onCancelled,
  className,
}: {
  run: Run;
  onCancelled: (run: Run) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const openDeposit = run.status === "awaiting_funds" && !!run.funding?.deposit_address;
  const cancel = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.cancelRun(run.id);
      toast.success(`Cancelled the ${runTitle(run)} run`, { description: "Nobody was paid. It stays on record." });
      setOpen(false);
      onCancelled(updated);
    } catch (err) {
      setError(toDisplayError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className={className ?? "mt-8 text-[0.8125rem] text-muted-foreground"}>
        Not going ahead?{" "}
        <button
          type="button"
          className="rounded-sm text-link hover:underline"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          Cancel this run
        </button>
      </p>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="gap-5 p-6 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className={TYPE.heading}>Cancel the {runTitle(run)} run?</DialogTitle>
            <DialogDescription className="text-[0.9375rem]">
              No money has reached this run and nobody has been paid. It stays on record as cancelled, and its{" "}
              {plural(run.lines.length, "person", "people")} can be edited or archived again.
              {openDeposit
                ? " Do not send anything to its deposit address: a deposit that arrives later reaches the treasury, but no run claims it."
                : ""}
            </DialogDescription>
          </DialogHeader>
          {error ? <Problem error={error} title="Not cancelled" /> : null}
          <DialogFooter className="-mx-6 -mb-6 bg-transparent px-6 pb-6">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={cancel} disabled={busy}>
              {busy ? "Cancelling" : "Cancel run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
