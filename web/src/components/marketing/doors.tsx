import type { ReactNode } from "react";
import { cn } from "cn";
import { consoleHref, hrefLabel, portalHref } from "@/lib/public-url";
import { t, textLink } from "@/components/marketing/classes";

/*
  The entrances, named by who you are. Payslip runs on two hosts: the company signs in on the
  console host; contractors and accountants read on the statements host, with no account. Each
  door names its host, so nobody signs in to read a payslip or pastes a key to run payroll.
*/
const DOORS: { who: string; what: ReactNode; href: string; label: string }[] = [
  {
    who: "You run payroll",
    what: "Sign in with Google, add your people, fund a run with ZEC and pay everyone in shielded transactions.",
    href: consoleHref(),
    label: "Open the company console",
  },
  {
    who: "You get paid",
    what: "Open the link your company sent you, or paste your viewing key. Your payslips, and nobody else's.",
    href: portalHref("/portal"),
    label: "See your payslips",
  },
  {
    who: "You keep the books",
    what: "Load every key and get every run reconciled, funded against paid, read from the chain.",
    href: portalHref("/books"),
    label: "Open Books",
  },
];

export function Doors({ className }: { className?: string }) {
  return (
    <nav aria-label="Where to go" className={className}>
      <ul className="grid border-2 border-ink sm:grid-cols-3">
        {DOORS.map((d, i) => (
          <li
            key={d.who}
            className={cn("flex flex-col px-4 pt-4 pb-5 sm:px-5", i > 0 && "border-t border-ink sm:border-t-0 sm:border-l")}
          >
            <h3 className={cn(t.label, "flex items-center gap-2.5")}>
              <span aria-hidden="true" className="inline-block size-4 shrink-0 border-[1.5px] border-ink" />
              {d.who}
            </h3>
            <p className={cn(t.small, "mt-2.5 text-ash")}>{d.what}</p>
            <p className={cn(t.data, "mt-auto pt-3.5 text-[0.875rem]")}>
              <a href={d.href} className={textLink}>
                {d.label}
              </a>
              {d.href.startsWith("http") ? <span className="ml-2 text-ash">{hrefLabel(d.href)}</span> : null}
            </p>
          </li>
        ))}
      </ul>
    </nav>
  );
}
