"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  FileKey2,
  KeyRound,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import { compactUsd, Usd } from "@/components/app/amount";
import { useHealth } from "@/components/app/health-provider";
import { Initials } from "@/components/ds/avatar";
import { Card, CardHeader } from "@/components/ds/card";
import { Tag } from "@/components/ds/tag";
import { Button } from "@/components/ui/button";
import type { Contractor, Run, Wallet } from "@/lib/api";
import { formatCount, formatPeriodLabel, MINUS } from "@/lib/format";
import { cn } from "cn";
import type { PeriodPoint } from "@/components/console/home/paid-chart";
import {
  AUDITOR_DOWNLOAD_KEY,
  latestFillRate,
  nextPeriodLabel,
  openRun,
  paidByPeriod,
  paidRuns,
  paidTotals,
  RUN_STATUS_LABEL,
  zatToCents,
} from "@/components/console/lib";
import { IconChip } from "@/components/console/ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function confirmedCents(run: Run): number {
  return run.lines.reduce((s, l) => s + (l.status === "confirmed" ? l.amount_usd_cents : 0), 0);
}

/**
 * The hero: everything paid to contractors, a rising line through each payroll month (Mercury's
 * balance card), and how the latest payroll compares with the one before. With a single payroll
 * there is no line to draw, so the card shows where that payroll went, person by person.
 */
export function PayrollHero({ runs }: { runs: Run[] }) {
  const totals = paidTotals(runs);
  const periods = paidByPeriod(runs).filter((p) => p.cents > 0);
  const latest = periods[periods.length - 1];
  const previous = periods[periods.length - 2];
  const change = latest && previous && previous.cents > 0 ? (latest.cents - previous.cents) / previous.cents : null;
  const year = latest ? latest.period.slice(0, 4) : new Date().getUTCFullYear().toString();
  return (
    <Card className="flex flex-col" aria-labelledby="hero-title">
      <CardHeader
        id="hero-title"
        title={
          <span className="inline-flex items-center gap-1.5">
            Paid to contractors in {year}
            <ShieldCheck className="size-4 text-primary-edge" aria-label="Every payment shielded" />
          </span>
        }
      />
      <div className="mt-1 text-[2rem] leading-tight font-[380] tracking-[-0.01em]">
        <Usd cents={totals.cents} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-strong">
        <span>
          {formatCount(periods.length)} {periods.length === 1 ? "payroll" : "payrolls"} · {formatCount(totals.payments)}{" "}
          payments
        </span>
        {latest ? (
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <span className="text-muted-foreground">{formatPeriodLabel(latest.period)}</span>
            <Usd cents={latest.cents} />
            {change !== null && Math.abs(change) >= 0.0005 ? (
              <span
                className={cn(
                  "inline-flex items-center gap-0.5",
                  change > 0 ? "text-success" : change < 0 ? "text-destructive" : "text-muted-foreground",
                )}
                title="Change from the previous payroll"
              >
                {change > 0 ? (
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                ) : change < 0 ? (
                  <ArrowDownRight className="size-3.5" aria-hidden="true" />
                ) : null}
                <span className="money">
                  {change < 0 ? MINUS : change > 0 ? "+" : ""}
                  {Math.abs(change * 100).toFixed(1)}%
                </span>
              </span>
            ) : null}
          </span>
        ) : null}
      </div>
      {periods.length >= 2 ? (
        <MonthlyBars points={paidByPeriod(runs).slice(-6)} />
      ) : (
        <Breakdown run={paidRuns(runs)[0]} />
      )}
    </Card>
  );
}

/**
 * Payroll by month as bars that fill the card: gold for the latest month, a softer gold for the
 * months before. Values sit above each bar; the table twin carries them for screen readers.
 */
function MonthlyBars({ points }: { points: PeriodPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.cents));
  const last = points.length - 1;
  return (
    <figure className="mt-5 flex min-h-[188px] flex-1 flex-col">
      <div className="flex flex-1 items-end gap-3 border-b border-hairline sm:gap-5" aria-hidden="true">
        {points.map((p, i) => (
          <div key={p.period} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
            <span className={cn("money text-xs", i === last ? "text-foreground" : "text-muted-foreground")}>
              {p.cents > 0 ? compactUsd(p.cents) : ""}
            </span>
            <span
              className={cn("w-full max-w-[56px] rounded-t-md", i === last ? "bg-primary" : "bg-viz-soft")}
              style={{ height: `${Math.max(2, (p.cents / max) * 100) * 0.78}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-3 sm:gap-5" aria-hidden="true">
        {points.map((p) => (
          <span key={p.period} className="min-w-0 flex-1 text-center text-xs text-muted-foreground">
            {p.label}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">
        Paid to contractors by month:{" "}
        {points.map((p) => `${formatPeriodLabel(p.period)} ${compactUsd(p.cents)}`).join(", ")}.
      </figcaption>
    </figure>
  );
}

/** Where one payroll went: a bar per person, scaled to the largest payment. */
function Breakdown({ run }: { run: Run | undefined }) {
  if (!run) return null;
  const lines = run.lines
    .filter((l) => l.status === "confirmed")
    .sort((a, b) => b.amount_usd_cents - a.amount_usd_cents);
  const max = Math.max(1, ...lines.map((l) => l.amount_usd_cents));
  return (
    <div className="mt-5">
      <p className="mb-2.5 text-[0.8125rem] text-muted-foreground">
        Where the {formatPeriodLabel(run.period_label)} payroll went
      </p>
      <ul className="grid gap-2.5">
        {lines.map((l) => (
          <li key={l.id} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
            <span className="truncate text-strong">{l.contractor_name}</span>
            <span className="h-1.5 rounded-full bg-chip">
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${Math.max(4, (l.amount_usd_cents / max) * 100)}%` }}
              />
            </span>
            <Usd cents={l.amount_usd_cents} className="text-right" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The treasury in dollars at the latest fill rate (the simulated rate on testnet), and whether it
 * covers the next payroll.
 */
export function TreasuryCard({ wallet, runs }: { wallet?: Wallet; runs: Run[] }) {
  const { health } = useHealth();
  const rate = latestFillRate(runs);
  const zat = wallet?.treasury.total_zat ?? 0;
  const cents = rate ? zatToCents(zat, rate) : null;
  const lastPayroll = paidRuns(runs)[0];
  const need = lastPayroll ? confirmedCents(lastPayroll) : 0;
  const cover = cents !== null && need > 0 ? cents / need : null;
  const testnet = health?.network === "testnet";
  return (
    <Card className="flex flex-col" aria-labelledby="treasury-title">
      <CardHeader
        id="treasury-title"
        title="Treasury"
        actions={<IconChip icon={FileKey2} href="/console/treasury" label="Open treasury" />}
      />
      <div className="mt-1 text-[1.1875rem]">
        {cents !== null ? <Usd cents={cents} /> : <span className="text-muted-foreground">Not funded yet</span>}
      </div>
      {cover !== null ? (
        <>
          <div
            className="mt-4 h-1.5 overflow-hidden rounded-full bg-chip"
            role="img"
            aria-label={`Covers ${cover.toFixed(1)} payrolls`}
          >
            <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(1, cover) * 100}%` }} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {cover >= 1
              ? `Covers ${cover >= 10 ? Math.floor(cover) : cover.toFixed(1)} payrolls like the last one`
              : "Not enough for a payroll like the last one"}
          </p>
        </>
      ) : null}
      {wallet && rate ? (
        <dl className="mt-4 mb-4 grid grid-cols-2 gap-x-4 text-sm">
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Spendable</dt>
            <dd className="mt-0.5">
              <Usd cents={zatToCents(wallet.treasury.spendable_zat, rate)} />
            </dd>
          </div>
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Confirming</dt>
            <dd className="mt-0.5">
              <Usd cents={zatToCents(wallet.treasury.pending_zat, rate)} />
            </dd>
          </div>
        </dl>
      ) : null}
      <div className="mt-auto flex items-end justify-between gap-3 border-t border-hairline pt-3.5">
        <div className="min-w-0 text-sm text-muted-foreground">
          {testnet ? <Tag>Simulated rate</Tag> : "At the latest fill rate"}
        </div>
        <Button asChild size="sm" variant="secondary">
          <Link href="/console/treasury">Fund</Link>
        </Button>
      </div>
    </Card>
  );
}

/** The next payroll as a dated card: the month after the latest run, due at its end. */
export function NextPayrollCard({ runs, contractors }: { runs: Run[]; contractors: Contractor[] }) {
  const open = openRun(runs);
  const label = open ? formatPeriodLabel(open.period_label) : nextPeriodLabel(runs);
  const [mon, year] = label.split(" ");
  const monthIdx = MONTHS.indexOf(mon);
  const lastDay = monthIdx >= 0 ? new Date(Date.UTC(Number(year), monthIdx + 1, 0)).getUTCDate() : null;
  const estimate = paidRuns(runs)[0];
  return (
    <Card className="flex flex-col" aria-labelledby="next-title">
      <CardHeader id="next-title" title="Next payroll" />
      <div className="mt-3 flex items-center gap-4">
        <div className="grid w-14 shrink-0 overflow-hidden rounded-lg border text-center" aria-hidden="true">
          <span className="bg-primary py-0.5 text-[0.6875rem] font-medium tracking-wide text-primary-foreground uppercase">
            {mon}
          </span>
          <span className="py-1 text-[1.375rem] leading-none font-[380]">{lastDay ?? ""}</span>
        </div>
        <div className="min-w-0">
          <div className="text-[1.0625rem]">{label} payroll</div>
          <div className="text-sm text-muted-foreground">
            {open ? RUN_STATUS_LABEL[open.status] : `Due ${lastDay ? `${lastDay} ${mon}` : "at month end"}`} ·{" "}
            {formatCount(open ? open.lines.length : contractors.length)} people
          </div>
        </div>
      </div>
      <div className="mt-auto flex items-end justify-between gap-3 border-t border-hairline pt-3.5">
        <div className="min-w-0">
          <div className="text-[0.8125rem] text-muted-foreground">{open ? "Total" : "Last payroll"}</div>
          <div className="text-[0.9375rem]">
            {open ? (
              <Usd cents={open.total_usd_cents} />
            ) : estimate ? (
              <Usd cents={confirmedCents(estimate)} />
            ) : (
              "None yet"
            )}
          </div>
        </div>
        <Button asChild size="sm" variant="secondary">
          <Link href={open ? `/console/runs/new?run=${open.id}` : "/console/runs/new"}>
            {open ? "Continue" : "Start"}
          </Link>
        </Button>
      </div>
    </Card>
  );
}

interface Task {
  key: string;
  icon: typeof ListChecks;
  text: React.ReactNode;
  href: string;
}

/** Mercury's Tasks: what needs the payer, written as sentences, at most three. */
export function TodoCard({ runs, contractors }: { runs: Run[]; contractors: Contractor[] }) {
  const [auditorSent, setAuditorSent] = useState(true);
  useEffect(() => {
    try {
      setAuditorSent(!!localStorage.getItem(AUDITOR_DOWNLOAD_KEY));
    } catch {
      setAuditorSent(true);
    }
  }, []);
  const open = openRun(runs);
  const unshared = contractors.filter((c) => !c.fvk_shared_at);
  const tasks: Task[] = [];
  if (open)
    tasks.push({
      key: "open",
      icon: ListChecks,
      text: (
        <>
          Finish the <b className="font-medium">{formatPeriodLabel(open.period_label)}</b> payroll
        </>
      ),
      href: `/console/runs/new?run=${open.id}`,
    });
  if (unshared.length > 0)
    tasks.push({
      key: "share",
      icon: KeyRound,
      text: (
        <>
          Share payslip access with{" "}
          <b className="font-medium">
            {formatCount(unshared.length)} {unshared.length === 1 ? "person" : "people"}
          </b>
        </>
      ),
      href: "/console/access",
    });
  if (!auditorSent)
    tasks.push({
      key: "auditor",
      icon: FileKey2,
      text: (
        <>
          Send the <b className="font-medium">auditor package</b> to your accountant
        </>
      ),
      href: "/console/access#auditor-package",
    });
  if (!open)
    tasks.push({
      key: "next",
      icon: ListChecks,
      text: (
        <>
          Start the <b className="font-medium">{nextPeriodLabel(runs)}</b> payroll
        </>
      ),
      href: "/console/runs/new",
    });
  const shown = tasks.slice(0, 3);
  return (
    <Card className="flex flex-col" aria-labelledby="todo-title">
      <CardHeader
        id="todo-title"
        title={
          <span className="inline-flex items-center gap-2">
            To do
            {tasks.length > 0 ? (
              <span className="text-xs text-muted-foreground">{formatCount(tasks.length)}</span>
            ) : null}
          </span>
        }
      />
      {shown.length === 0 ? (
        <p className="mt-4 inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Check className="size-4 text-success" aria-hidden="true" />
          Nothing needs you right now.
        </p>
      ) : (
        <ul className="-mx-2 mt-2 grid">
          {shown.map((t) => (
            <li key={t.key}>
              <Link
                href={t.href}
                className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-[0.9375rem] text-strong hover:bg-muted"
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-chip text-muted-foreground">
                  <t.icon className="size-3.5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">{t.text}</span>
                <ChevronRight className="size-4 shrink-0 text-faint" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export { Initials };
