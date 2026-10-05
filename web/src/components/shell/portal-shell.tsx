"use client";

import type { ReactNode } from "react";
import { FileText, Home, Receipt } from "lucide-react";
import { LogoMark } from "@/components/app/logo";
import { AppShell, SidebarBrand, type ShellConfig } from "@/components/shell/app-shell";

/**
 * The contractor portal: the same calm shell with only this person's pages (Mercury's employee
 * view). It never links to company pages. `brand` and `topLeft` carry the unlocked person.
 */
export function PortalShell({
  children,
  brand,
  topLeft,
  footer,
}: {
  children: ReactNode;
  brand?: ReactNode;
  topLeft?: ReactNode;
  footer?: ReactNode;
}) {
  const config: ShellConfig = {
    brand: brand ?? <SidebarBrand mark={<LogoMark className="size-[22px]" />} name="Payslip" />,
    nav: [
      [
        { href: "/portal", label: "Home", icon: Home, exact: true },
        { href: "/portal/payslips", label: "Payslips", icon: FileText },
        { href: "/portal/tax", label: "Tax documents", icon: Receipt },
      ],
    ],
    topLeft,
    footer,
  };
  return <AppShell config={config}>{children}</AppShell>;
}
