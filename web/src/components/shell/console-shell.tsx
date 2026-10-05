"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Bookmark as BookmarkIcon, Home, KeyRound, Landmark, ListChecks, Plus, UsersRound } from "lucide-react";
import { useHealth } from "@/components/app/health-provider";
import { LogoMark } from "@/components/app/logo";
import { NetworkBadge } from "@/components/app/network-badge";
import { AppShell, Bookmark, SidebarBrand, type ShellConfig } from "@/components/shell/app-shell";
import { Button } from "@/components/ui/button";
import { useResource } from "@/hooks/use-resource";
import { api } from "@/lib/api";
import { formatPeriodLabel, networkLabel } from "@/lib/format";

/** The company console (today's payer pages): sidebar, Payroll | Books switch, treasury bookmark. */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { health } = useHealth();
  const wallet = useResource((s) => api.wallet(s), "shell-wallet");
  const runs = useResource((s) => api.runs(s), "shell-runs");
  const latest = runs.data?.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const open = runs.data?.filter((r) => !["paid", "failed"].includes(r.status)).length ?? 0;
  const config: ShellConfig = {
    brand: (
      <SidebarBrand
        mark={<LogoMark className="size-[22px]" />}
        name="Payslip"
        chip={health ? networkLabel(health.network) : undefined}
      />
    ),
    segments: [
      { label: "Payroll", href: "/console", active: !pathname.startsWith("/books") },
      { label: "Books", href: "/books", active: pathname.startsWith("/books") },
    ],
    nav: [
      [
        { href: "/console", label: "Home", icon: Home, exact: true },
        { href: "/console/runs", label: "Payroll runs", icon: ListChecks, badge: open > 0 ? open : undefined },
      ],
      [
        { href: "/console/people", label: "People", icon: UsersRound },
        { href: "/console/access", label: "Payslip access", icon: KeyRound },
        { href: "/console/treasury", label: "Treasury", icon: Landmark },
      ],
    ],
    bookmarks: (
      <div className="grid gap-0.5">
        <p className="px-2 pt-1 pb-1 text-xs text-muted-foreground">Bookmarks</p>
        <Bookmark
          href="/console/treasury"
          icon={BookmarkIcon}
          label="Treasury"
          detail={wallet.data ? <TreasuryDetail zat={wallet.data.treasury.total_zat} /> : "Loading"}
        />
        {latest ? (
          <Bookmark
            href={`/console/runs/${latest.id}`}
            icon={BookmarkIcon}
            label={`Run for ${formatPeriodLabel(latest.period_label)}`}
            detail={`${latest.status.charAt(0).toUpperCase()}${latest.status.slice(1).replace(/_/g, " ")} · ${latest.lines.length} people`}
          />
        ) : null}
      </div>
    ),
    topLeft: <NetworkBadge className="hidden sm:inline-flex" />,
    topActions: (
      <Button asChild size="sm" variant="secondary" className="hidden sm:inline-flex">
        <Link href="/console/runs/new">
          <Plus aria-hidden="true" />
          Run payroll
        </Link>
      </Button>
    ),
  };
  return <AppShell config={config}>{children}</AppShell>;
}

function TreasuryDetail({ zat }: { zat: number }) {
  const { health } = useHealth();
  const unit = health?.network === "testnet" ? "TAZ" : "ZEC";
  return (
    <span className="money">
      {(zat / 1e8).toFixed(4)} {unit}
    </span>
  );
}
