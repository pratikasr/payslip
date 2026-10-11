"use client";

import { useState, type ReactNode } from "react";
import { Eraser, KeyRound, Lock, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useHealth } from "@/components/app/health-provider";
import { Initials } from "@/components/ds/avatar";
import { PORTAL_PRINT_CSS } from "@/components/portal/portal-states";
import { usePersonName, usePortal } from "@/components/portal/portal-provider";
import { UnlockScreen } from "@/components/portal/unlock-card";
import { SidebarBrand } from "@/components/shell/app-shell";
import { PortalShell } from "@/components/shell/portal-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { toDisplayError } from "@/lib/api";
import { networkLabel } from "@/lib/format";

/** Locked: the unlock card. Unlocked: the contractor's own shell, with no company navigation. */
export function PortalFrame({ children }: { children: ReactNode }) {
  const { ready, ufvk, recent, lock, forgetOnService } = usePortal();
  const name = usePersonName();
  const { health } = useHealth();
  const [forgetting, setForgetting] = useState(false);
  if (!ready) return <main id="main" aria-busy="true" className="min-h-[calc(100dvh-3rem)] bg-sidebar" />;
  if (!ufvk) return <UnlockScreen />;

  // With no name (a pasted key on a deployment that knows none), a key, not a question mark.
  const mark = name ? (
    <Initials name={name} />
  ) : (
    <span
      className="grid size-[26px] shrink-0 place-items-center rounded-full bg-avatar text-strong"
      aria-hidden="true"
    >
      <KeyRound className="size-3.5" />
    </span>
  );
  const brand =
    name || recent.statement ? (
      <SidebarBrand mark={mark} name={name ?? "Your payslips"} />
    ) : (
      <div className="flex items-center gap-2 pb-1" role="status" aria-label="Opening your payslips">
        <Skeleton className="size-[26px] rounded-full" />
        <Skeleton className="h-3.5 w-28" />
      </div>
    );

  const forget = async () => {
    setForgetting(true);
    try {
      const res = await forgetOnService();
      toast.success(res.forgotten ? "The service forgot your key" : "The service held no scan of your key", {
        description: "This tab is locked too.",
      });
    } catch (err) {
      const e = toDisplayError(err);
      toast.error(e.message, { description: e.hint });
    } finally {
      setForgetting(false);
    }
  };

  return (
    <PortalShell
      brand={brand}
      topLeft={
        <span className="inline-flex min-w-0 items-center gap-2">
          <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            Read-only access
            {health ? (
              <span className="hidden sm:inline"> on Zcash {networkLabel(health.network).toLowerCase()}</span>
            ) : null}
          </span>
        </span>
      }
      footer={
        <div className="border-t border-hairline pt-2">
          <button
            type="button"
            onClick={() => lock()}
            className="flex w-full items-center gap-2.5 rounded-[7px] px-2 py-[7px] text-left text-strong transition-colors hover:bg-muted hover:text-foreground"
          >
            <Lock className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            Lock
          </button>
          <p className="px-2 pt-0.5 pb-1 text-[0.8125rem] text-muted-foreground">Forgets your key in this tab.</p>
          <button
            type="button"
            onClick={() => void forget()}
            disabled={forgetting}
            className="mt-1 flex w-full items-center gap-2.5 rounded-[7px] px-2 py-[7px] text-left text-strong transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            <Eraser className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {forgetting ? "Forgetting" : "Forget on the service"}
          </button>
          <p className="px-2 pt-0.5 pb-1 text-[0.8125rem] text-muted-foreground">
            Deletes the service&apos;s read-only scan of your key, then locks.
          </p>
        </div>
      }
    >
      <style>{PORTAL_PRINT_CSS}</style>
      {children}
    </PortalShell>
  );
}
