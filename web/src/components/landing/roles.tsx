import Link from "next/link";
import { BookOpenCheck, Check, EyeOff, KeyRound, Landmark, Minus, ReceiptText } from "lucide-react";
import { cn } from "cn";

/*
  Three roles, three views: what each holder can and cannot see, decided by
  the keys they hold. A key glyph stands for each key; the payer's spending
  key is the gold one, viewing keys are drawn in ink.
*/

interface Role {
  name: string;
  job: string;
  icon: typeof Landmark;
  href: string;
  cta: string;
  keys: { spending?: boolean; viewing: number; note: string };
  sees: string[];
  cannot: string[];
}

const ROLES: Role[] = [
  {
    name: "Payer",
    job: "Runs payroll",
    icon: Landmark,
    href: "/app/payer",
    cta: "Open the payer view",
    keys: { spending: true, viewing: 0, note: "The spending key, which never leaves the service host" },
    sees: [
      "The treasury balance and address",
      "Every run, pay line, transaction id and network fee",
      "Which contractors have their viewing key",
    ],
    cannot: ["A contractor's own wallet, or what else they are paid", "Where the money goes after it lands"],
  },
  {
    name: "Contractor",
    job: "Gets paid",
    icon: ReceiptText,
    href: "/app/contractor",
    cta: "Open the contractor view",
    keys: { viewing: 1, note: "One viewing key, for their own payroll account" },
    sees: [
      "Each payment to them: date, ZEC, USD basis, invoice, period",
      "The transaction id and block height of each",
      "Running totals and a statement to export",
    ],
    cannot: ["Anyone else's pay", "The treasury or the payroll total", "Spend anything: a viewing key only reads"],
  },
  {
    name: "Accountant",
    job: "Reconciles",
    icon: BookOpenCheck,
    href: "/app/accountant",
    cta: "Open the accountant view",
    keys: { viewing: 7, note: "Every viewing key: the treasury plus one per contractor (seven with six people)" },
    sees: [
      "Every run and every pay line",
      "Funded USD against paid USD, run by run",
      "The variance, explained by fees and unspent coin",
    ],
    cannot: ["Spend or move funds", "Anything the payer did not export"],
  },
];

export function RolesSection() {
  return (
    <section id="roles" aria-labelledby="roles-title" className="scroll-mt-4 border-t">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <div className="max-w-2xl">
          <h2 id="roles-title" className="text-2xl font-semibold tracking-tight">
            Three roles, three views
          </h2>
          <p className="mt-3 text-muted-foreground">
            The same payroll, read three ways. What each person sees is decided by the keys they hold, not by a setting
            someone could change. Every contractor is paid from a separate account, so one key opens one person&apos;s
            pay and nothing else.
          </p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {ROLES.map((role) => (
            <RoleCard key={role.name} role={role} />
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-3 rounded-lg border border-dashed px-4 py-4 sm:flex-row sm:items-center sm:gap-6">
          <p className="inline-flex shrink-0 items-center gap-2 font-medium">
            <EyeOff className="size-4 text-muted-foreground" aria-hidden="true" />
            Everyone else
          </p>
          <p className="text-sm text-muted-foreground">
            A block explorer sees that shielded transactions happened. No amounts, no sender, no recipient, no memo.
          </p>
          <div aria-hidden="true" className="flex shrink-0 gap-1.5 sm:ml-auto">
            <span className="h-3 w-14 rounded-[3px] bg-redact" />
            <span className="h-3 w-9 rounded-[3px] bg-redact" />
            <span className="h-3 w-16 rounded-[3px] bg-redact" />
          </div>
        </div>
      </div>
    </section>
  );
}

function RoleCard({ role }: { role: Role }) {
  const Icon = role.icon;
  return (
    <article aria-labelledby={`role-${role.name}`} className="flex flex-col rounded-lg border bg-card">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <span className="inline-flex size-8 items-center justify-center rounded-md bg-muted" aria-hidden="true">
          <Icon className="size-4" />
        </span>
        <div>
          <h3 id={`role-${role.name}`} className="font-semibold">
            {role.name}
          </h3>
          <p className="text-xs text-muted-foreground">{role.job}</p>
        </div>
      </header>

      <div className="space-y-2 border-b px-4 py-3">
        <p className="text-xs text-muted-foreground">Holds</p>
        <div className="flex flex-wrap items-center gap-1" aria-hidden="true">
          {role.keys.spending ? (
            <span className="inline-flex size-7 items-center justify-center rounded-md border border-primary-edge bg-primary/15">
              <KeyRound className="size-4 text-primary-edge" />
            </span>
          ) : null}
          {Array.from({ length: role.keys.viewing }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "inline-flex size-7 items-center justify-center rounded-md border",
                i === 0 && role.keys.viewing > 1 && "bg-muted",
              )}
            >
              <KeyRound className="size-4" />
            </span>
          ))}
        </div>
        <p className="text-sm">{role.keys.note}</p>
      </div>

      <div className="flex-1 space-y-4 px-4 py-4">
        <div>
          <p className="text-xs text-muted-foreground">Can see</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {role.sees.map((item) => (
              <li key={item} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Cannot</p>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            {role.cannot.map((item) => (
              <li key={item} className="flex gap-2">
                <Minus className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t px-4 py-3">
        <Link
          href={role.href}
          className="text-sm font-medium text-link underline underline-offset-4 hover:no-underline"
        >
          {role.cta}
        </Link>
      </div>
    </article>
  );
}
