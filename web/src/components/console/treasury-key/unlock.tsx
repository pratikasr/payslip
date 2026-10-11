"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { Lock } from "lucide-react";
import { toast } from "sonner";
import { Field } from "@/components/app/field";
import { useHealth } from "@/components/app/health-provider";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { api, toDisplayError, type ApiError, type TreasuryKey } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "cn";
import { Problem } from "@/components/runs/problem";

/*
  Unlocking the treasury key for payroll: the dialog (passphrase and how long), and the inline
  prompt a step shows when the service answers `treasury_locked` (the Pay step, Fund with USDC,
  a run parked by the service). Admins unlock; everyone else is told whom to ask.
*/

export const TREASURY_KEY_HREF = "/console/settings/treasury-key";

/** How long an unlock may last; the service's default applies when the admin keeps the first. */
const HOURS = [
  { value: "1", label: "1 hour" },
  { value: "2", label: "2 hours" },
  { value: "4", label: "4 hours" },
  { value: "8", label: "8 hours" },
  { value: "24", label: "24 hours" },
];

export function UnlockDialog({
  open,
  onOpenChange,
  onUnlocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnlocked?: (key: TreasuryKey) => void;
}) {
  const uid = useId();
  const { setTreasury } = useHealth();
  const [passphrase, setPassphrase] = useState("");
  const [hours, setHours] = useState("4");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiError | null>(null);

  const close = (o: boolean) => {
    if (busy) return;
    if (!o) {
      setPassphrase("");
      setProblem(null);
    }
    onOpenChange(o);
  };

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passphrase) {
      document.getElementById(`${uid}-pass`)?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const key = await api.unlockTreasury(passphrase, Number(hours));
      setTreasury(key.state);
      setPassphrase("");
      toast.success("Treasury unlocked", {
        description: key.unlocked_until
          ? `This server can sign payments until ${formatDateTime(key.unlocked_until)}.`
          : undefined,
      });
      onOpenChange(false);
      onUnlocked?.(key);
    } catch (err) {
      setProblem(toDisplayError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="gap-5 p-6 sm:max-w-md">
        <form onSubmit={unlock} className="contents">
          <DialogHeader>
            <DialogTitle>Unlock the treasury</DialogTitle>
            <DialogDescription>
              Your passphrase decrypts the key into this server&apos;s memory for the time you choose. It is not stored.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field id={`${uid}-pass`} label="Passphrase">
              <Input
                id={`${uid}-pass`}
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </Field>
            <Field id={`${uid}-hours`} label="For" help="The key locks itself when the time is up.">
              <NativeSelect id={`${uid}-hours`} value={hours} onChange={(e) => setHours(e.target.value)}>
                {HOURS.map((h) => (
                  <option key={h.value} value={h.value}>
                    {h.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {problem ? <Problem error={problem} title="Not unlocked" /> : null}
          </div>
          <DialogFooter className="-mx-6 -mb-6 bg-transparent px-6 pb-6">
            <Button type="button" variant="secondary" onClick={() => close(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !passphrase}>
              {busy ? "Unlocking" : "Unlock"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What a step says when the service answered `treasury_locked`: nobody can spend the treasury
 * until an admin unlocks it. An admin gets the Unlock button here; a run parked by the service
 * resumes once `onUnlocked` is called with the key.
 */
export function LockedPrompt({
  what = "so this cannot go ahead",
  error,
  onUnlocked,
  action,
  className,
}: {
  /** What is waiting: "so payments cannot start", "so the run is parked". */
  what?: string;
  /** The service's answer, whose hint is shown under the sentence. */
  error?: Pick<ApiError, "message" | "hint"> | null;
  onUnlocked?: (key: TreasuryKey) => void;
  /** Another action beside Unlock (Resume, say). */
  action?: ReactNode;
  className?: string;
}) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const admin = auth.can("manage_treasury_key");
  return (
    <div
      role="alert"
      data-testid="treasury-locked-prompt"
      className={cn("carbon-paper border border-carbon-line px-4 py-3.5 text-[0.9375rem] sm:px-5", className)}
    >
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-type font-bold text-foreground">The treasury is locked, {what}.</p>
          <p className="text-[0.8125rem] text-strong">
            While it is locked nobody can sign a payment, including this server.{" "}
            {admin ? "Unlock it with your passphrase to continue." : "Ask an admin to unlock it."}
          </p>
          {error?.hint && error.hint !== error.message ? (
            <p className="text-[0.8125rem] text-muted-foreground">{error.hint}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 pt-2" data-print="hide">
            {admin ? (
              <Button size="sm" onClick={() => setOpen(true)}>
                Unlock
              </Button>
            ) : null}
            {action}
            <Button asChild size="sm" variant="link">
              <Link href={TREASURY_KEY_HREF}>About the treasury key</Link>
            </Button>
          </div>
        </div>
      </div>
      {admin ? <UnlockDialog open={open} onOpenChange={setOpen} onUnlocked={onUnlocked} /> : null}
    </div>
  );
}
