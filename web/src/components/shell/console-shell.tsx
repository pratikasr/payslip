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
import { api, type Run } from "@/lib/api";
import { Usd, Zec } from "@/components/app/amount";
import { latestFillRate, runStateLabel, zatToCents } from "@/components/console/lib";
import { ConsoleSearch } from "@/components/console/search";
import { plural, runTitle } from "@/components/runs/run-meta";
import { networkLabel } from "@/lib/format";
import { isCancelled, latestPeriodFirst } from "@/lib/payroll";

/** The company console (today's payer pages): sidebar, Payroll | Books switch, treasury bookmark. */
export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { network } = useHealth();
  const wallet = useResource((s) => api.wallet(s), "shell-wallet");
  const runs = useResource((s) => api.runs(s), "shell-runs");
  // The bookmark is the latest pay period's run (cancelled ones are closed and skipped).
  const latest = runs.data ? latestPeriodFirst(runs.data.filter((r) => !isCancelled(r)))[0] : undefined;
  const open = runs.data?.filter((r) => !["paid", "failed", "cancelled"].includes(r.status)).length ?? 0;
  const config: ShellConfig = {
    brand: (
      <SidebarBrand
        mark={<LogoMark className="size-[22px]" />}
        name="Payslip"
        chip={network ? networkLabel(network) : undefined}
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
        <p className="px-2 pt-1 pb-1 text-[0.8125rem] text-muted-foreground">Bookmarks</p>
        <Bookmark
          href="/console/treasury"
          icon={BookmarkIcon}
          label="Treasury"
          detail={
            wallet.data ? (
              <TreasuryDetail zat={wallet.data.treasury.total_zat} runs={runs.data ?? []} />
            ) : wallet.error ? (
              "Unavailable"
            ) : (
              "Loading"
            )
          }
        />
        {latest ? (
          <Bookmark
            href={`/console/runs/${latest.id}`}
            icon={BookmarkIcon}
            label={`${runTitle(latest)} payroll`}
            detail={`${runStateLabel(latest)} · ${plural(latest.lines.length, "person", "people")}`}
          />
        ) : null}
      </div>
    ),
    topLeft: (
      <>
        <NetworkBadge className="hidden sm:inline-flex" />
        <ConsoleSearch />
      </>
    ),
    menuAction: (
      <Button asChild size="sm" className="w-full">
        <Link href="/console/runs/new">
          <Plus aria-hidden="true" />
          Run payroll
        </Link>
      </Button>
    ),
  };
  return <AppShell config={config}>{children}</AppShell>;
}

/**
 * The treasury under its bookmark. Mainnet: dollars at the latest fill rate (a real price at the
 * time), as Mercury's bookmarks show balances. Testnet: the coin itself, because the only rate
 * there is simulated and is not a price.
 */
function TreasuryDetail({ zat, runs }: { zat: number; runs: Run[] }) {
  const { network } = useHealth();
  const rate = network === "mainnet" ? latestFillRate(runs) : null;
  if (rate) return <Usd cents={zatToCents(zat, rate)} />;
  return <Zec zat={zat} short />;
}
