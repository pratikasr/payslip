import type { ReactNode } from "react";
import { BadgeCheck, FolderGit2 } from "lucide-react";
import { cn } from "cn";
import { Initials } from "@/components/ds/avatar";
import { Tag } from "@/components/ds/tag";
import { formatDateTime, formatHeight } from "@/lib/format";
import { GITHUB_URL, RUN_284C } from "@/components/marketing/data";
import { RateFigure, TazFigure, UsdFigure } from "@/components/marketing/money";
import { GoldDot, OutLink, TxLink } from "@/components/marketing/parts";

/*
  The product cards in the dark section, built in HTML from run 284c2421 on Zcash testnet
  (src/components/marketing/data.ts). They render inside a .dark scope, so the tokens are dark.
  No ids inside: on phones each card is rendered a second time inside its accordion item.
*/

function VCard({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <figure
      aria-label={label}
      className={cn(
        "min-w-0 rounded-[14px] border border-white/[0.07] bg-card p-4 text-left text-foreground shadow-[0_40px_80px_-40px_rgba(0,0,0,0.7)] sm:p-5",
        className,
      )}
    >
      {children}
    </figure>
  );
}

function VHead({ title, sub, tag }: { title: ReactNode; sub: ReactNode; tag?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[15px]">{title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      </div>
      {tag}
    </div>
  );
}

const run = RUN_284C;

export function RunVignette() {
  return (
    <VCard label={`${run.periodLabel} payroll, run ${run.short}, paid`}>
      <VHead
        title={`${run.periodLabel} payroll`}
        sub={`Run ${run.short} on Zcash testnet`}
        tag={<Tag tone="success">Paid</Tag>}
      />
      <ul className="mt-2">
        {run.lines.map((l) => (
          <li
            key={l.txid}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/[0.07] py-[9px] text-sm"
          >
            <Initials name={l.name} className="bg-white/[0.08] text-[#dddde5]" />
            <span className="truncate">{l.name}</span>
            <UsdFigure cents={l.usdCents} className="text-[15px]" />
          </li>
        ))}
      </ul>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-3 text-[13px] text-strong">
        <span className="inline-flex items-center gap-2">
          <GoldDot />
          {run.lines.length} payments sealed on Zcash
        </span>
        <span className="text-muted-foreground">
          Total <UsdFigure cents={run.paidCents} className="ml-1 text-foreground" />
        </span>
      </div>
    </VCard>
  );
}

export function PayslipVignette() {
  const l = run.lines[0];
  const rows: [string, ReactNode][] = [
    ["Period", run.periodLabel],
    ["Invoice", l.invoice],
    ["Paid", formatDateTime(run.payslip.blockTime)],
    [
      "Block",
      <span key="h" className="num">
        {formatHeight(l.height)}
      </span>,
    ],
    ["Transaction", <TxLink key="t" txid={l.txid} />],
  ];
  return (
    <VCard label={`Payslip for ${l.name}, verified on Zcash`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Initials name={l.name} size="lg" className="bg-white/[0.08] text-[#dddde5]" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Payslip</p>
            <p className="truncate text-[15px]">{l.name}</p>
          </div>
        </div>
        <Tag tone="success" className="gap-1 pl-1.5">
          <BadgeCheck className="size-3.5" aria-hidden="true" />
          Verified on Zcash
        </Tag>
      </div>
      <p className="mt-5 text-[2.25rem] leading-none font-[380] tracking-[-0.02em]">
        <UsdFigure cents={l.usdCents} />
      </p>
      <p className="mt-2 text-[13px] text-muted-foreground">
        <TazFigure zat={l.zat} /> at a simulated testnet rate
      </p>
      <dl className="mt-4 border-t border-white/[0.07]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-4 border-b border-white/[0.07] py-2.5 text-sm">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 truncate text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[12.5px] text-muted-foreground">
        A payment proof opens this one payment, checked against the chain, and nothing else.
      </p>
    </VCard>
  );
}

export function ReconcileVignette() {
  const rows: [string, ReactNode, boolean?][] = [
    ["Funded", <UsdFigure key="f" cents={run.fundedCents} />],
    [`Paid, ${run.lines.length} lines`, <UsdFigure key="p" cents={run.paidCents} />],
    ["Variance", <UsdFigure key="v" cents={run.varianceCents} />],
    ["Network fees", <TazFigure key="n" zat={run.feesZat} className="text-muted-foreground" />],
    ["Unspent", <TazFigure key="u" zat={run.unspentZat} className="text-muted-foreground" />],
    ["Explained by fees and unspent", <UsdFigure key="e" cents={run.explainedCents} />, true],
  ];
  return (
    <VCard label={`Reconciliation of run ${run.short}, reconciled`}>
      <VHead
        title="Reconciliation"
        sub={`Run ${run.short}, ${run.periodLabel}`}
        tag={<Tag tone="success">Reconciled</Tag>}
      />
      <dl className="mt-3 border-t border-white/[0.07]">
        {rows.map(([k, v, strong]) => (
          <div
            key={k}
            className={cn(
              "flex items-center justify-between gap-4 border-b border-white/[0.07] py-2.5 text-sm",
              strong && "border-b-0",
            )}
          >
            <dt className={strong ? "text-foreground" : "text-muted-foreground"}>{k}</dt>
            <dd className="text-right text-[15px]">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-white/[0.07] pt-3 text-xs text-muted-foreground">
        <span>One cent of rounding across six lines</span>
        <span className="inline-flex items-center gap-2">
          <RateFigure e6={run.rateE6} />
          <Tag className="h-5">Simulated rate</Tag>
        </span>
      </div>
    </VCard>
  );
}

const TREE: [string, string][] = [
  ["service/", "Rust service: wallet, runs, statements"],
  ["web/", "Next.js: this page and the app"],
  ["docs/proof/", "Testnet runs with every txid"],
  ["scripts/", "The demo driver that ran them"],
];

export function OpenSourceVignette() {
  return (
    <VCard label="The Payslip repository on GitHub, MIT licensed">
      <VHead
        title={
          <span className="inline-flex items-center gap-2">
            <FolderGit2 className="size-4 text-muted-foreground" aria-hidden="true" />
            pratikasr/payslip
          </span>
        }
        sub="Private payroll on Zcash"
        tag={<Tag>MIT</Tag>}
      />
      <ul className="mt-3 border-t border-white/[0.07]">
        {TREE.map(([path, what]) => (
          <li
            key={path}
            className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 border-b border-white/[0.07] py-2.5 text-sm"
          >
            <span className="font-mono text-[13px] text-strong">{path}</span>
            <span className="truncate text-muted-foreground">{what}</span>
          </li>
        ))}
      </ul>
      <div className="mt-1 flex items-center justify-between gap-4 pt-3 text-[13px]">
        <span className="text-muted-foreground">Rust and TypeScript</span>
        <OutLink href={GITHUB_URL} className="text-link">
          Open on GitHub
        </OutLink>
      </div>
    </VCard>
  );
}
