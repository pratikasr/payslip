"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/app/logo";
import { NetworkBadge } from "@/components/app/network-badge";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { cn } from "cn";

const ROLES = [
  { href: "/app/payer", label: "Payer" },
  { href: "/app/contractor", label: "Contractor" },
  { href: "/app/accountant", label: "Accountant" },
];

export function AppHeader() {
  const pathname = usePathname();
  return (
    <header
      role="banner"
      className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75"
    >
      <div className="mx-auto flex h-14 max-w-[1360px] items-center gap-3 px-4 sm:gap-6 sm:px-6">
        <Logo href="/" />
        <nav aria-label="Role" className="hidden md:block">
          <RoleLinks pathname={pathname} />
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <NetworkBadge className="hidden sm:inline-flex" />
          <ThemeToggle />
        </div>
      </div>
      <nav aria-label="Role" className="border-t px-4 py-2 md:hidden">
        <div className="flex items-center justify-between gap-2">
          <RoleLinks pathname={pathname} />
          <NetworkBadge className="sm:hidden" compact />
        </div>
      </nav>
    </header>
  );
}

function RoleLinks({ pathname }: { pathname: string }) {
  return (
    <ul className="flex items-center gap-1">
      {ROLES.map((r) => {
        const active = pathname === r.href || pathname.startsWith(`${r.href}/`);
        return (
          <li key={r.href}>
            <Link
              href={r.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                active && "bg-muted font-medium text-foreground",
              )}
            >
              {r.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
