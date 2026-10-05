"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Download, Scale, TableProperties } from "lucide-react";
import { useHealth } from "@/components/app/health-provider";
import { LogoMark } from "@/components/app/logo";
import { NetworkBadge } from "@/components/app/network-badge";
import { AppShell, SidebarBrand, type ShellConfig } from "@/components/shell/app-shell";
import { networkLabel } from "@/lib/format";

/**
 * The accountant workspace: the Books side of the Payroll | Books switch. `bookmarks` carries the
 * loaded key set; `badges` the counts for Exceptions.
 */
export function BooksShell({
  children,
  bookmarks,
  exceptions,
}: {
  children: ReactNode;
  bookmarks?: ReactNode;
  exceptions?: number;
}) {
  const { health } = useHealth();
  const config: ShellConfig = {
    brand: (
      <SidebarBrand
        mark={<LogoMark className="size-[22px]" />}
        name="Payslip"
        chip={health ? networkLabel(health.network) : undefined}
      />
    ),
    segments: [
      { label: "Payroll", href: "/console", active: false },
      { label: "Books", href: "/books", active: true },
    ],
    nav: [
      [
        { href: "/books", label: "Reconciliation", icon: Scale, exact: true },
        { href: "/books/ledger", label: "Ledger", icon: TableProperties },
        { href: "/books/exceptions", label: "Exceptions", icon: AlertTriangle, badge: exceptions || undefined },
        { href: "/books/exports", label: "Exports", icon: Download },
      ],
    ],
    bookmarks,
    topLeft: <NetworkBadge className="hidden sm:inline-flex" />,
  };
  return <AppShell config={config}>{children}</AppShell>;
}
