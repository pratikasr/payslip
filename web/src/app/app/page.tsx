import type { Metadata } from "next";
import Link from "next/link";
import { BookOpenCheck, Landmark, ReceiptText } from "lucide-react";
import { ServiceStatus } from "@/components/app/service-status";

export const metadata: Metadata = { title: "Choose a role" };

const ROLES = [
  {
    href: "/app/payer",
    title: "Payer",
    body: "Add contractors, fund a run in USDC and pay everyone with shielded transactions.",
    icon: Landmark,
  },
  {
    href: "/app/contractor",
    title: "Contractor",
    body: "Paste your viewing key to see your payments, USD basis and a statement you can export.",
    icon: ReceiptText,
  },
  {
    href: "/app/accountant",
    title: "Accountant",
    body: "Load every viewing key to reconcile funded USD against paid USD, run by run.",
    icon: BookOpenCheck,
  },
];

export default function RoleChooserPage() {
  return (
    <div className="space-y-10">
      <div className="max-w-2xl space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Who are you here as?</h1>
        <p className="text-sm text-muted-foreground">
          Each role sees a different slice of the same payroll. Contractors and accountants only ever share viewing
          keys, which can read payments but cannot move funds.
        </p>
      </div>

      <ul className="grid gap-3 md:grid-cols-3">
        {ROLES.map(({ href, title, body, icon: Icon }) => (
          <li key={href}>
            <Link
              href={href}
              className="group flex h-full flex-col gap-3 rounded-lg border bg-card p-5 transition-colors hover:border-primary-edge"
            >
              <Icon className="size-5 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
              <span className="font-semibold">{title}</span>
              <span className="text-sm text-muted-foreground">{body}</span>
            </Link>
          </li>
        ))}
      </ul>

      <ServiceStatus />
    </div>
  );
}
