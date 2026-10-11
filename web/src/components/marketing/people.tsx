import type { ReactNode } from "react";
import { cn } from "cn";
import { JUDGE_KIT, SEP_RUN } from "@/components/marketing/data";
import { Usd } from "@/components/marketing/money";
import { Section } from "@/components/marketing/parts";
import { t } from "@/components/marketing/classes";

const run = SEP_RUN.run;
const amara = run.lines[0];

/** The sample company's seven accounts: the treasury, then one per contractor. */
const ACCOUNTS = [
  { name: "Treasury", short: "T" },
  ...run.lines.map((l) => ({
    name: l.name,
    short: l.name
      .split(" ")
      .map((w) => w[0])
      .join(""),
  })),
];

/* The three people around one payroll, each with what their key showed for the September run. */
const PEOPLE: {
  who: string;
  figure: ReactNode;
  sentence: string;
  reads: (name: string) => boolean;
  readsLabel: string;
  holds: ReactNode;
}[] = [
  {
    who: "The company",
    figure: <Usd cents={SEP_RUN.paidCents} />,
    sentence: `Paid ${run.lines.length} contractors for ${run.periodLabel} in one run, and sees every run, line and fee.`,
    reads: () => true,
    readsLabel: `Spends from and reads all ${ACCOUNTS.length} accounts`,
    holds: "Holds the spending key to every account. It never leaves the company's own server.",
  },
  {
    who: "The contractor",
    figure: <Usd cents={amara.usdCents} />,
    sentence: `${amara.name}'s ${run.periodLabel} pay. She reads her own payslips and nobody else's.`,
    reads: (name) => name === amara.name,
    readsLabel: `Reads ${amara.name}'s account only`,
    holds: (
      <>
        Holds the viewing key to her own account,{" "}
        <span className={cn(t.data, "whitespace-nowrap text-ink")}>
          {JUDGE_KIT.amaraKey.head}…{JUDGE_KIT.amaraKey.tail}
        </span>
        .
      </>
    ),
  },
  {
    who: "The accountant",
    figure: <Usd cents={SEP_RUN.varianceCents} />,
    sentence: `Funded minus paid on the ${run.periodLabel} run, explained to within a cent by network fees and unspent coin.`,
    reads: () => true,
    readsLabel: `Reads all ${ACCOUNTS.length} accounts and spends from none`,
    holds: `Holds the viewing keys to all ${JUDGE_KIT.keys} accounts. None of them can spend.`,
  },
];

export function People() {
  return (
    <Section
      id="who-sees-what"
      title="Who sees what"
      lead="One payroll, three kinds of key. Every contractor is paid from an account of their own, so what each person can read is set by the keys they hold."
      className="pt-0 md:pt-0 xl:pt-0"
    >
      <ul className="mt-10 grid border-t border-ink md:mt-14 lg:grid-cols-3">
        {PEOPLE.map((p, i) => (
          <li
            key={p.who}
            className={cn(
              "border-mist pt-6 pb-8 md:grid md:grid-cols-[13rem_minmax(0,1fr)] md:gap-x-10 lg:flex lg:flex-col lg:px-8 lg:pt-7 lg:pb-2",
              i > 0 && "border-t lg:border-t-0 lg:border-l",
              i === 0 && "lg:pl-0",
              i === PEOPLE.length - 1 && "lg:pr-0",
            )}
          >
            <div>
              <h3 className="text-[15px] font-medium">{p.who}</h3>
              <p className={cn(t.figure44, "mt-4")}>{p.figure}</p>
            </div>
            <div className="flex flex-col lg:flex-1">
              <p className={cn(t.body, "mt-4 max-w-[30rem] md:mt-0 lg:mt-4")}>{p.sentence}</p>
              <div className="mt-auto pt-6">
                <Accounts reads={p.reads} label={p.readsLabel} />
                <p className={cn(t.small, "mt-3 max-w-[30rem] text-ash")}>{p.holds}</p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** One mark per account: filled where this person's key opens it, an outline where it does not. */
function Accounts({ reads, label }: { reads: (name: string) => boolean; label: string }) {
  return (
    <p role="img" aria-label={label} className="flex flex-wrap gap-1.5">
      {ACCOUNTS.map((a) => (
        <span
          key={a.name}
          title={a.name}
          className={cn(
            "inline-flex h-7 min-w-9 items-center justify-center rounded-full border px-2 text-[13px] leading-none",
            reads(a.name) ? "border-ink bg-ink text-paper" : "border-ash/40 text-ash",
          )}
        >
          {a.short}
        </span>
      ))}
    </p>
  );
}
