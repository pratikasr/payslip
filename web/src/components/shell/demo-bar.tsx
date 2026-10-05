"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, Building2, ChevronDown, FileCheck2, Home, LucideProvider, UserRound } from "lucide-react";
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
import { isPortalOrigin } from "@/lib/public-url";
import { cn } from "cn";

export const VIEWS = [
  { href: "/console", label: "Company", hint: "Run payroll, people, treasury", icon: Building2 },
  { href: "/portal", label: "Contractor", hint: "Your payslips, with your key", icon: UserRound },
  { href: "/books", label: "Accountant", hint: "Reconcile with every key", icon: BookOpen },
] as const;

export function currentView(pathname: string) {
  return VIEWS.find((v) => pathname === v.href || pathname.startsWith(`${v.href}/`));
}

/** What the bar says about the network: nothing is claimed until the service has said which. */
function networkLine(net: string | undefined, offline: boolean): { long: string; short: string; tone: string } {
  if (net === "mainnet")
    return { long: "Payslip on Zcash mainnet. Payments here are real.", short: "Mainnet", tone: "bg-success" };
  if (net === "testnet")
    return {
      long: "You are in the Payslip demo on Zcash testnet. Nothing here is real money.",
      short: "Testnet",
      tone: "bg-primary",
    };
  if (offline)
    return {
      long: "Payslip cannot reach its service, so the network is unknown.",
      short: "Offline",
      tone: "bg-danger",
    };
  return { long: "Checking which Zcash network this Payslip runs on.", short: "Checking", tone: "bg-white/50" };
}

/**
 * Whether this deployment is a demo, set at build time with NEXT_PUBLIC_PAYSLIP_DEMO=1. Testnet is
 * always a demo; on mainnet the role switcher shows only with the flag (the recorded mainnet demo
 * needs it), so a contractor who opens their invite link on a real deployment sees only their
 * portal.
 */
export function demoFlag(): boolean {
  return process.env.NEXT_PUBLIC_PAYSLIP_DEMO?.trim() === "1";
}

/** Whether the "Viewing as" menu belongs on this network. Undecided until the network is known. */
export function showRoleSwitcher(network: string | undefined): boolean {
  if (network === "testnet") return true;
  if (network === "mainnet") return demoFlag();
  return false;
}

/**
 * The dark bar above the app (Mercury's "Explore the demo" bar). Its "Viewing as" menu is how a
 * visitor switches between the company, contractor and accountant products; inside each product
 * there is no cross-role navigation. The menu shows on testnet and, on mainnet, only on a demo
 * build (NEXT_PUBLIC_PAYSLIP_DEMO=1). A statements-only deployment has no company to show, and a
 * deployment serving contractors (the configured portal origin) shows neither the company nor
 * the accountant, so an invite link never leads to anyone else's keys.
 */
export function DemoBar() {
  const pathname = usePathname();
  const { network, mode, health, error } = useHealth();
  const [portalOnly, setPortalOnly] = useState(false);
  useEffect(() => setPortalOnly(isPortalOrigin()), []);
  const statementsOnly = mode === "statements";
  const views = VIEWS.filter((v) => {
    if (portalOnly) return v.href === "/portal";
    if (statementsOnly) return v.href !== "/console";
    return true;
  });
  const view = currentView(pathname) ?? VIEWS[0];
  const offline = !health && !!error;
  const line = networkLine(network, offline);
  const switcher = showRoleSwitcher(network);
  return (
    <LucideProvider strokeWidth={1.5}>
      <aside
        aria-label="Payslip demo"
        className="flex h-12 items-center gap-3 bg-banner px-4 text-[0.8125rem] text-banner-foreground sm:px-5"
        data-print="hide"
      >
        <Link
          href="/"
          className="-m-1.5 inline-flex size-[34px] items-center justify-center rounded-md pointer-coarse:size-11"
          aria-label="Payslip home"
        >
          <LogoMark className="size-[22px]" />
        </Link>
        {/* Not a live region: the network does not change while the page is open. Offline is the
          one state worth announcing, and the page's own error says it. */}
        <span className="hidden truncate md:inline">{line.long}</span>
        {/* Phones get the network as a pill: "Payments here are real" matters most on a small screen. */}
        <span
          className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-white/12 px-2.5 text-[0.8125rem] md:hidden"
          title={line.long}
        >
          <span aria-hidden="true" className={cn("size-1.5 rounded-full", line.tone)} />
          <span>{line.short}</span>
          <span className="sr-only">. {line.long}</span>
        </span>
        {switcher ? (
          <div className="ml-auto flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger className="relative inline-flex h-[30px] items-center gap-1.5 rounded-full bg-white/12 px-3 text-[0.8125rem] whitespace-nowrap outline-hidden hover:bg-white/18 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary focus-visible:outline-solid pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-[7px] pointer-coarse:after:content-['']">
                Viewing as {view.label}
                <ChevronDown className="size-3.5" aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>View Payslip as</DropdownMenuLabel>
                {views.map((v) => (
                  <DropdownMenuItem key={v.href} asChild>
                    <Link href={v.href} aria-current={v.href === view.href ? "page" : undefined}>
                      <v.icon aria-hidden="true" />
                      <span className="grid">
                        <span className="text-foreground">{v.label}</span>
                        <span className="text-[0.8125rem] text-muted-foreground">{v.hint}</span>
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
        ) : null}
      </aside>
    </LucideProvider>
  );
}
