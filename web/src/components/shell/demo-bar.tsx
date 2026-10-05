"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, Building2, ChevronDown, FileCheck2, Home, UserRound } from "lucide-react";
import { useHealth } from "@/components/app/health-provider";
import { LogoMark } from "@/components/app/logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export const VIEWS = [
  { href: "/console", label: "Company", hint: "Run payroll, people, treasury", icon: Building2 },
  { href: "/portal", label: "Contractor", hint: "Your payslips, with your key", icon: UserRound },
  { href: "/books", label: "Accountant", hint: "Reconcile with every key", icon: BookOpen },
] as const;

export function currentView(pathname: string) {
  return VIEWS.find((v) => pathname === v.href || pathname.startsWith(`${v.href}/`));
}

/**
 * The dark bar above the app (Mercury's "Explore the demo" bar). Its "Viewing as" menu is how a
 * visitor switches between the company, contractor and accountant products; inside each product
 * there is no cross-role navigation.
 */
export function DemoBar() {
  const pathname = usePathname();
  const { health } = useHealth();
  const view = currentView(pathname) ?? VIEWS[0];
  const net = health?.network;
  return (
    <div
      className="flex h-12 items-center gap-3 bg-banner px-4 text-sm text-banner-foreground sm:px-5"
      data-print="hide"
    >
      <Link href="/" className="inline-flex items-center gap-2 rounded-md" aria-label="Payslip home">
        <LogoMark className="size-[22px]" />
      </Link>
      <span className="hidden truncate md:inline">
        {net === "mainnet"
          ? "Payslip on Zcash mainnet. Payments here are real."
          : "You are in the Payslip demo on Zcash testnet. Nothing here is real money."}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-white/12 px-3 text-[0.8125rem] whitespace-nowrap outline-hidden hover:bg-white/18 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid">
            Viewing as {view.label}
            <ChevronDown className="size-3.5" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>View Payslip as</DropdownMenuLabel>
            {VIEWS.map((v) => (
              <DropdownMenuItem key={v.href} asChild>
                <Link href={v.href} aria-current={v.href === view.href ? "page" : undefined}>
                  <v.icon aria-hidden="true" />
                  <span className="grid">
                    <span className="text-foreground">{v.label}</span>
                    <span className="text-xs text-muted-foreground">{v.hint}</span>
                  </span>
                </Link>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/verify">
                <FileCheck2 aria-hidden="true" />
                Check a payslip proof
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/">
                <Home aria-hidden="true" />
                About Payslip
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
