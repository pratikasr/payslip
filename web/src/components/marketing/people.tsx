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
    >
      {/* A form of three boxes, ruled like the slips of a pay packet. */}
      <ul className="mt-10 grid border-2 border-ink md:mt-14 lg:grid-cols-3">
        {PEOPLE.map((p, i) => (
          <li
            key={p.who}
            className={cn(
              "flex flex-col px-4 pt-5 pb-6 sm:px-6",
              i > 0 && "border-t border-ink lg:border-t-0 lg:border-l",
              i === 1 && "bg-bar",
            )}
          >
            <h3 className={t.label}>{p.who}</h3>
            <p className={cn(t.figure, "mt-5")}>{p.figure}</p>
            <p className={cn(t.body, "mt-4 max-w-[30rem]")}>{p.sentence}</p>
            <div className="mt-auto pt-6">
              <Accounts reads={p.reads} label={p.readsLabel} />
              <p className={cn(t.small, "mt-3 max-w-[30rem] text-ash")}>{p.holds}</p>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** One box per account, like the boxes of a form: filled where this key opens it, empty where not. */
function Accounts({ reads, label }: { reads: (name: string) => boolean; label: string }) {
  return (
    <p role="img" aria-label={label} className="flex flex-wrap gap-1.5">
      {ACCOUNTS.map((a) => (
        <span
          key={a.name}
          title={a.name}
          className={cn(
            "inline-flex h-7 min-w-8 items-center justify-center border-[1.5px] px-1.5 font-type text-[0.8125rem] leading-none font-bold",
            reads(a.name) ? "border-ink bg-ink text-paper" : "border-ink/45 border-dashed text-ash",
          )}
        >
          {a.short}
        </span>
      ))}
    </p>
  );
}
