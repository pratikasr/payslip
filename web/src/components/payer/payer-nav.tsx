"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

const LINKS = [
  { href: "/app/payer", label: "Overview", exact: true },
  { href: "/app/payer/contractors", label: "Contractors" },
  { href: "/app/payer/runs", label: "Runs" },
];

export function PayerNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Payer" className="-mx-4 mb-6 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0" data-print="hide">
      <ul className="flex gap-4">
        {LINKS.map((l) => {
          const active = l.exact ? pathname === l.href : pathname === l.href || pathname.startsWith(`${l.href}/`);
          return (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "-mb-px inline-flex h-10 items-center border-b-2 border-transparent text-sm text-muted-foreground hover:text-foreground",
                  active && "border-primary-edge font-medium text-foreground",
                )}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
