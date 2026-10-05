import type { ReactNode } from "react";
import { ArrowDown, KeyRound } from "lucide-react";
import { cn } from "cn";
import { Tag } from "@/components/ds/tag";
import { RUN_284C, payLineMemo } from "@/components/marketing/data";
import { TazFigure, UsdFigure } from "@/components/marketing/money";
import { Container, SectionHeading } from "@/components/marketing/parts";
import { lp } from "@/components/marketing/classes";

const run = RUN_284C;
const line = run.lines[0];

const STEPS: { title: string; body: string; art: ReactNode }[] = [
  {
    title: "Fund in USDC",
    body: "Enter each contractor's pay in dollars and send USDC from your own wallet. NEAR Intents swaps it to ZEC, and the fill rate becomes the dollar basis of every line.",
    art: <FundArt />,
  },
  {
    title: "Pay, shielded",
    body: "Payslip sends one shielded payment per contractor, each from that person's own account. The encrypted memo carries the period, the invoice and the dollar basis.",
    art: <MemoArt />,
  },
  {
    title: "Share keys, not spreadsheets",
    body: "Each contractor gets the viewing key to their own account; your accountant gets all of them. Statements and the reconciliation are read straight from the chain.",
    art: <KeysArt />,
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-4 pb-20 sm:pb-24">
      <Container>
        <SectionHeading id="how-title" title="Three steps from USDC to payslips" />
        <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-6">
          {STEPS.map((s, i) => (
            <li key={s.title} className="min-w-0">
              <div className="flex h-[232px] items-center justify-center overflow-hidden rounded-xl bg-raised p-5">
                {s.art}
              </div>
              <h3 className="mt-5 text-base font-[500]">
                <span className="mr-2 text-muted-foreground tabular-nums">{i + 1}</span>
                {s.title}
              </h3>
              <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{s.body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-8 text-[13px] text-muted-foreground">
          Figures from run {run.short} on Zcash testnet, where a fixed-rate testnet venue stands in for NEAR Intents.
        </p>
      </Container>
    </section>
  );
}

function Mini({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "w-full max-w-[17rem] rounded-xl border bg-card p-4 text-left shadow-[0_18px_40px_-24px_rgba(30,30,42,0.35)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function FundArt() {
  return (
    <Mini>
      <p className="text-xs text-muted-foreground">You fund</p>
      <p className="mt-1 flex items-baseline justify-between gap-2">
        <UsdFigure cents={run.fundedCents} className="text-[1.375rem] font-[400]" />
        <span className="text-xs text-muted-foreground">USD</span>
      </p>
      <div className="my-2.5 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="grid size-6 place-items-center rounded-full bg-chip">
          <ArrowDown className="size-3.5" aria-hidden="true" />
        </span>
        Swapped at the fill rate
      </div>
      <p className="text-xs text-muted-foreground">The run receives</p>
      <p className="mt-1 text-[1.0625rem]">
        <TazFigure zat={run.acquiredZat} />
      </p>
      <div className="mt-3">
        <Tag>Simulated rate</Tag>
      </div>
    </Mini>
  );
}

function MemoArt() {
  return (
    <Mini className="space-y-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">Explorer sees</span>
        <span className="inline-flex items-center gap-2">
          <span className={cn(lp.bar, lp.onLight, "w-16")} aria-hidden="true" />
          Shielded
        </span>
      </div>
      <div className="rounded-lg bg-raised p-2.5">
        <p className="text-[11px] text-muted-foreground">Memo, decrypted with a viewing key</p>
        <p className="mt-1 font-mono text-[11px] leading-snug break-all text-strong">{payLineMemo(line)}</p>
      </div>
      <dl className="grid grid-cols-[auto_auto_minmax(0,1fr)] gap-x-4 text-xs">
        <div>
          <dt className="text-muted-foreground">Period</dt>
          <dd className="mt-0.5">{run.periodLabel}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Invoice</dt>
          <dd className="mt-0.5 whitespace-nowrap">{line.invoice}</dd>
        </div>
        <div className="text-right">
          <dt className="text-muted-foreground">Basis</dt>
          <dd className="mt-0.5">
            <UsdFigure cents={line.usdCents} />
          </dd>
        </div>
      </dl>
    </Mini>
  );
}

function KeysArt() {
  const rows: { who: string; key: string; gold?: boolean }[] = [
    { who: "Company", key: "Spending key, stays on the host", gold: true },
    { who: line.name, key: "Viewing key, own account only" },
    { who: "Accountant", key: `${run.lines.length + 1} viewing keys, every account` },
  ];
  return (
    <Mini className="p-2">
      <ul>
        {rows.map((r) => (
          <li key={r.who} className="flex items-center gap-3 rounded-lg px-2 py-2.5">
            <span
              className={cn(
                "grid size-8 shrink-0 place-items-center rounded-lg border",
                r.gold ? "border-primary-edge bg-primary-soft" : "bg-raised",
              )}
            >
              <KeyRound className={cn("size-4", r.gold ? "text-primary-edge" : "text-strong")} aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm">{r.who}</span>
              <span className="block truncate text-xs text-muted-foreground">{r.key}</span>
            </span>
          </li>
        ))}
      </ul>
    </Mini>
  );
}
