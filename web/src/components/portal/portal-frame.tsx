"use client";

import type { ReactNode } from "react";
import { Lock, ShieldCheck } from "lucide-react";
import { useHealth } from "@/components/app/health-provider";
import { Initials } from "@/components/ds/avatar";
import { personName } from "@/components/portal/portal-data";
import { PORTAL_PRINT_CSS } from "@/components/portal/portal-states";
import { usePortal } from "@/components/portal/portal-provider";
import { UnlockScreen } from "@/components/portal/unlock-card";
import { SidebarBrand } from "@/components/shell/app-shell";
import { PortalShell } from "@/components/shell/portal-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { networkLabel } from "@/lib/format";

/** Locked: the unlock card. Unlocked: the contractor's own shell, with no company navigation. */
export function PortalFrame({ children }: { children: ReactNode }) {
  const { ready, ufvk, recent, lock } = usePortal();
  const { health } = useHealth();
  if (!ready) return <main id="main" aria-busy="true" className="min-h-[calc(100dvh-3rem)] bg-sidebar" />;
  if (!ufvk) return <UnlockScreen />;

  const name = personName(recent.statement);
  const brand =
    name || recent.statement ? (
      <SidebarBrand mark={<Initials name={name} />} name={name ?? "Your payslips"} />
    ) : (
      <div className="flex items-center gap-2 pb-1" aria-label="Opening your payslips">
        <Skeleton className="size-[26px] rounded-full" />
        <Skeleton className="h-3.5 w-28" />
      </div>
    );

  return (
    <PortalShell
      brand={brand}
      topLeft={
        <span className="inline-flex min-w-0 items-center gap-2">
          <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">
            Read-only access
            {health ? (
              <span className="hidden sm:inline"> · Zcash {networkLabel(health.network).toLowerCase()}</span>
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
          <p className="px-2 pt-0.5 pb-1 text-xs text-muted-foreground">Forgets your key in this tab.</p>
        </div>
      }
    >
      <style>{PORTAL_PRINT_CSS}</style>
      {children}
    </PortalShell>
  );
}
