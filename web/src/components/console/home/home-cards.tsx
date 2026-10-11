"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  Check,
  FileKey2,
  Inbox,
  KeyRound,
  Landmark,
  ListChecks,
  ShieldCheck,
  Table2,
} from "lucide-react";
import { compactUsd, Usd, Zec } from "@/components/app/amount";
import { useHealth } from "@/components/app/health-provider";
import { Card, CardHeader } from "@/components/ds/card";
import { Tag } from "@/components/ds/tag";
import { TYPE } from "@/components/ds/type";
import { Button } from "@/components/ui/button";
import type { Contractor, PaySchedule, Run, Wallet } from "@/lib/api";
import { formatCount, formatPeriodLabel, formatShortDate, formatUsd, MINUS } from "@/lib/format";
import { nextPayPeriod } from "@/lib/payroll";
import { TESTNET_FAUCET_URL } from "@/lib/public-url";
import { cn } from "cn";
import {
  AUDITOR_DOWNLOAD_KEY,
  latestFillRate,
  nextPeriodTitle,
  openRun,
  paidByPeriod,
  paidRuns,
  paidTotals,
  periodYear,
  runStateLabel,
  zatToCents,
  type PeriodPoint,
} from "@/components/console/lib";
import { IconChip } from "@/components/console/ui";
import { periodTitle, plural, runTitle } from "@/components/runs/run-meta";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The hero: everything paid to contractors this year in the display face, and the year month by
 * month, with how the latest payroll compares with the one before. It sits on the page, not in a
 * card. Months without a payroll show as faint stubs, so a gap reads as a gap; a table twin shows
 * the same figures.
 */
export function PayrollHero({ runs }: { runs: Run[] }) {
  // The year of the latest paid payroll; the total, the counts and the bars all cover that year.
  const latestPaid = paidRuns(runs)[0];
  const year = latestPaid ? periodYear(latestPaid) : new Date().getUTCFullYear().toString();
  const totals = paidTotals(runs, year);
  const paid = paidByPeriod(runs, year);
  const periods = paid.filter((p) => p.cents > 0);
  const latest = periods[periods.length - 1];
  const previous = periods[periods.length - 2];
  // An extra run in a month (a bonus, or the same period paid twice) is not growth: compare only
  // months that each had one payroll, and otherwise say how many runs the month had.
  const comparable = latest && previous && latest.runs === 1 && previous.runs === 1 && previous.cents > 0;
  const change = comparable ? (latest.cents - previous.cents) / previous.cents : null;
  const months = yearMonths(year, paid);
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="flex flex-col pt-2" aria-labelledby="hero-title">
      <CardHeader
        id="hero-title"
        title={
          <span className="inline-flex items-center gap-1.5">
            Paid to contractors in {year}
            <ShieldCheck className="size-4 text-foreground" aria-label="Every payment shielded" />
          </span>
        }
        actions={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            aria-pressed={asTable}
            aria-label={asTable ? "Show as a chart" : "Show as a table"}
            title={asTable ? "Show as a chart" : "Show as a table"}
            onClick={() => setAsTable((t) => !t)}
          >
            {asTable ? <BarChart3 aria-hidden="true" /> : <Table2 aria-hidden="true" />}
          </Button>
        }
      />
      <div className={cn(TYPE.hero, "mt-2")}>
        <Usd cents={totals.cents} />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[0.8125rem] text-strong">
        <span>
          {plural(totals.payrolls, "payroll")} and {plural(totals.payments, "payment")}
        </span>
        {latest ? (
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <span className="text-muted-foreground">{formatPeriodLabel(latest.period)}</span>
            <Usd cents={latest.cents} />
            {latest.runs > 1 ? (
              <span className="text-muted-foreground" title="This month had more than one paid run">
                {formatCount(latest.runs)} runs
              </span>
            ) : change !== null && Math.abs(change) >= 0.0005 ? (
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
      {asTable ? <MonthTable year={year} points={months} /> : <YearBars year={year} points={months} />}
    </section>
  );
}

interface MonthPoint extends PeriodPoint {
  /** After this month: nothing can be paid for it yet. */
  future: boolean;
}

/** Every month of the year, January to December, with what was paid for each (0 when nothing). */
function yearMonths(year: string, paid: PeriodPoint[]): MonthPoint[] {
  const byPeriod = new Map(paid.map((p) => [p.period, p]));
  const now = new Date();
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return MONTHS.map((label, i) => {
    const period = `${year}-${String(i + 1).padStart(2, "0")}`;
    const p = byPeriod.get(period);
    return { period, label, cents: p?.cents ?? 0, runs: p?.runs ?? 0, future: period > thisMonth };
  });
}

/**
 * Twelve columns, January to December: ink for the latest paid month, a softer tone before it,
 * faint stubs for months with no payroll, nothing for months still ahead. Values sit over paid
 * months and in each column's tooltip; the caption reads them all for screen readers.
 */
function YearBars({ year, points }: { year: string; points: MonthPoint[] }) {
  const max = Math.max(1, ...points.map((p) => p.cents));
  const lastPaid = points.reduce((l, p, i) => (p.cents > 0 ? i : l), -1);
  return (
    <figure className="mt-6 flex h-[200px] flex-col">
      <div className="flex flex-1 items-end gap-1 border-b border-hairline sm:gap-2" aria-hidden="true">
        {points.map((p, i) => (
          <div
            key={p.period}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
            title={
              p.future
                ? undefined
                : `${formatPeriodLabel(p.period)}: ${p.cents > 0 ? formatUsd(p.cents) : "no payroll"}`
            }
          >
            {/* Twelve columns leave no room for every value: the latest paid month carries its
                figure; the others show theirs in the tooltip, the caption and the table view. */}
            <span className="money text-[0.8125rem] text-foreground">
              {i === lastPaid && p.cents > 0 ? compactUsd(p.cents) : ""}
            </span>
            {p.future ? null : (
              <span
                className={cn(
                  "w-full max-w-[40px] rounded-t-[5px]",
                  p.cents === 0 ? "h-[3px] bg-chip" : i === lastPaid ? "bg-viz" : "bg-viz-soft",
                )}
                style={p.cents > 0 ? { height: `${Math.max(4, (p.cents / max) * 100) * 0.78}%` } : undefined}
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-1 sm:gap-2" aria-hidden="true">
        {points.map((p) => (
          <span key={p.period} className="min-w-0 flex-1 text-center text-[0.8125rem] text-muted-foreground">
            <span className="sm:hidden">{p.label.charAt(0)}</span>
            <span className="hidden sm:inline">{p.label}</span>
          </span>
        ))}
      </div>
      <figcaption className="sr-only">
        Paid to contractors by month in {year}:{" "}
        {points
          .filter((p) => !p.future)
          .map((p) => `${formatPeriodLabel(p.period)} ${p.cents > 0 ? formatUsd(p.cents) : "none"}`)
          .join(", ")}
        .
      </figcaption>
    </figure>
  );
}

/** The same months as a table: the chart's twin for reading exact figures. */
function MonthTable({ year, points }: { year: string; points: MonthPoint[] }) {
  const shown = points.filter((p) => !p.future);
  return (
    <table className="mt-4 w-full border-collapse text-[0.9375rem]">
      <caption className="sr-only">Paid to contractors by month in {year}</caption>
      <thead>
        <tr className="border-b border-hairline text-left text-[0.8125rem] text-muted-foreground">
          <th scope="col" className="py-2 font-normal">
            Month
          </th>
          <th scope="col" className="py-2 text-right font-normal">
            Runs
          </th>
          <th scope="col" className="py-2 text-right font-normal">
            Paid
          </th>
        </tr>
      </thead>
      <tbody>
        {shown.map((p) => (
          <tr key={p.period} className="border-b border-hairline last:border-0">
            <td className="py-1.5">{formatPeriodLabel(p.period)}</td>
            <td className="num py-1.5 text-right text-strong">{p.runs || ""}</td>
            <td className="py-1.5 text-right">
              {p.cents > 0 ? <Usd cents={p.cents} /> : <span className="text-muted-foreground">None</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * How many payrolls like `run` the treasury covers, in coin: what the run drew from the treasury
 * (its payments and fee reserve, `zec_acquired_zat`) against what the treasury holds. No rate is
 * involved, so the answer is the same on testnet and mainnet.
 */
function payrollsCovered(treasuryZat: number, run: Run | undefined): number | null {
  const drew = run?.funding?.zec_acquired_zat ?? run?.total_zat ?? null;
  return drew && drew > 0 ? treasuryZat / drew : null;
}

/**
 * The treasury. Mainnet: dollars at the latest fill rate (a real price at that time), coin under
 * it. Testnet: the coin itself, because the only rate there is simulated and is not a price. In
 * both, how many payrolls like the last one it covers.
 */
export function TreasuryCard({ wallet, runs }: { wallet?: Wallet; runs: Run[] }) {
  const { network } = useHealth();
  const testnet = network === "testnet";
  const rate = testnet ? null : latestFillRate(runs);
  const zat = wallet?.treasury.total_zat ?? 0;
  const lastPayroll = paidRuns(runs)[0];
  const cover = wallet ? payrollsCovered(zat, lastPayroll) : null;
  return (
    <Card className="flex flex-col" aria-labelledby="treasury-title">
      <CardHeader
        id="treasury-title"
        title="Treasury"
        actions={<IconChip icon={Landmark} href="/console/treasury" label="Open treasury" />}
      />
      <div className="mt-1 text-[1.0625rem] font-medium">
        {!wallet ? (
          <span className="text-muted-foreground">Unavailable</span>
        ) : rate ? (
          <>
            <Usd cents={zatToCents(zat, rate)} />
            <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
              <Zec zat={zat} /> at the latest fill rate
            </span>
          </>
        ) : (
          <Zec zat={zat} />
        )}
      </div>
      {cover !== null && lastPayroll ? (
        <>
          <div
            className="mt-4 h-1.5 overflow-hidden rounded-full bg-chip"
            role="img"
            aria-label={`Covers ${cover.toFixed(1)} payrolls like ${runTitle(lastPayroll)}`}
          >
            <span className="block h-full rounded-full bg-viz" style={{ width: `${Math.min(1, cover) * 100}%` }} />
          </div>
          <p className="mt-2 text-[0.8125rem] text-muted-foreground">
            {cover >= 1
              ? `Covers ${cover >= 10 ? Math.floor(cover) : cover.toFixed(1)} payrolls like ${runTitle(lastPayroll)}`
              : `Not enough for a payroll like ${runTitle(lastPayroll)}`}
          </p>
        </>
      ) : null}
      {wallet ? (
        <dl className="mt-4 mb-4 grid grid-cols-2 gap-x-4 text-[0.9375rem]">
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Spendable</dt>
            <dd className="mt-0.5">
              {rate ? (
                <Usd cents={zatToCents(wallet.treasury.spendable_zat, rate)} />
              ) : (
                <Zec zat={wallet.treasury.spendable_zat} short />
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Confirming</dt>
            <dd className="mt-0.5">
              {rate ? (
                <Usd cents={zatToCents(wallet.treasury.pending_zat, rate)} />
              ) : (
                <Zec zat={wallet.treasury.pending_zat} short />
              )}
            </dd>
          </div>
        </dl>
      ) : null}
      <div className="mt-auto flex items-end justify-between gap-3 border-t border-hairline pt-3.5">
        <div className="min-w-0 text-[0.8125rem] text-muted-foreground">
          {testnet ? (
            <a href={TESTNET_FAUCET_URL} target="_blank" rel="noreferrer" className="text-link hover:underline">
              Get free testnet coins<span className="sr-only"> (opens in a new tab)</span>
            </a>
          ) : (
            "Funded per run, with ZEC or USDC"
          )}
        </div>
        <Button asChild size="sm" variant="secondary">
          <Link href="/console/treasury">Fund</Link>
        </Button>
      </div>
    </Card>
  );
}

/** The run the pay schedule drafted (or found covering its period), while it still needs the payer. */
export function scheduledDraft(schedule: PaySchedule | null | undefined, runs: Run[]): Run | undefined {
  const d = schedule?.drafted;
  if (!d || d.status === "paid" || d.status === "cancelled") return undefined;
  return runs.find((r) => r.id === d.run_id && r.status !== "paid" && r.status !== "cancelled");
}

/**
 * The next payroll. With a pay schedule (ADR-028): the run it drafted, with the pay day to
 * review it by, else the schedule's next period with its pay day and draft day. Without one:
 * the unfinished run when there is one, else the period after the latest paid payroll (the
 * period Run payroll proposes), named by its period and never by a due date.
 */
export function NextPayrollCard({
  runs,
  contractors,
  schedule,
}: {
  runs: Run[];
  contractors: Contractor[];
  schedule?: PaySchedule | null;
}) {
  if (contractors.length === 0) return null;
  const drafted = scheduledDraft(schedule, runs);
  const open = drafted ?? openRun(runs);
  const period = open
    ? { from: open.period_start, to: open.period_end }
    : schedule
      ? { from: schedule.next_period_start, to: schedule.next_period_end }
      : nextPayPeriod(runs);
  const title = periodTitle(period.from, period.to);
  const end = new Date(`${period.to}T00:00:00Z`);
  const today = new Date().toISOString().slice(0, 10);
  const ended = period.to < today;
  const estimate = paidRuns(runs)[0];
  const people = plural(open ? open.lines.length : contractors.length, "person", "people");
  const reviewBy = drafted && schedule?.drafted?.pay_day ? formatShortDate(schedule.drafted.pay_day) : null;
  const sub = drafted
    ? `Drafted, review by ${reviewBy ?? "the pay day"}, ${people}`
    : open
      ? `${runStateLabel(open)}, ${people}`
      : schedule && schedule.active && schedule.next_pay_day
        ? `Pay day ${formatShortDate(schedule.next_pay_day)}${schedule.drafts_on ? `, drafts on ${formatShortDate(schedule.drafts_on)}` : ""}, ${people}`
        : `${ended ? "Period ended" : "Period ends"} ${formatShortDate(period.to)}, ${people}`;
  return (
    <Card className="flex flex-col" aria-labelledby="next-title">
      <CardHeader
        id="next-title"
        title={
          <span className="inline-flex items-center gap-2">
            Next payroll
            {schedule?.overdue && drafted ? <Tag tone="warning">Overdue</Tag> : null}
          </span>
        }
        actions={<IconChip icon={CalendarClock} href="/console/settings" label="Pay schedule settings" />}
      />
      <div className="mt-3 flex items-center gap-4">
        <div className="grid w-14 shrink-0 overflow-hidden rounded-lg border text-center" aria-hidden="true">
          <span className="identity-vault bg-vault py-0.5 text-[0.8125rem] font-medium text-ink">
            {MONTHS[end.getUTCMonth()]}
          </span>
          <span className="py-1 text-[0.9375rem] leading-tight">{end.getUTCFullYear()}</span>
        </div>
        <div className="min-w-0">
          <div className="text-[0.9375rem]">{title} payroll</div>
          <div className="text-[0.8125rem] text-muted-foreground">{sub}</div>
        </div>
      </div>
      <div className="mt-auto flex items-end justify-between gap-3 border-t border-hairline pt-3.5">
        <div className="min-w-0">
          <div className="text-[0.8125rem] text-muted-foreground">{open ? "Total" : "Last payroll"}</div>
          <div className="text-[0.9375rem]">
            {open ? (
              <Usd cents={open.total_usd_cents} />
            ) : estimate ? (
              <Usd
                cents={estimate.lines.reduce((s, l) => s + (l.status === "confirmed" ? l.amount_usd_cents : 0), 0)}
              />
            ) : (
              "None yet"
            )}
          </div>
        </div>
        <Button asChild size="sm" variant="secondary">
          <Link href={open ? `/console/runs/new?run=${open.id}` : "/console/runs/new"}>
            {drafted ? "Review" : open ? "Continue" : "Start"}
            <span className="sr-only"> the {title} payroll</span>
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

/** Mercury's Tasks: what needs the payer, written as sentences, at most four. */
export function TodoCard({
  runs,
  contractors,
  schedule,
  toReview = 0,
  className,
}: {
  runs: Run[];
  contractors: Contractor[];
  /** The pay schedule, for the draft waiting to be reviewed. */
  schedule?: PaySchedule | null;
  /** Payment requests waiting for a decision. */
  toReview?: number;
  className?: string;
}) {
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
  const hasPeople = contractors.length > 0;
  const tasks: Task[] = [];
  const drafted = scheduledDraft(schedule, runs);
  if (drafted) {
    const by = schedule?.drafted?.pay_day ? formatShortDate(schedule.drafted.pay_day) : null;
    tasks.push({
      key: "drafted",
      icon: CalendarClock,
      text: (
        <>
          <b className="font-medium">{runTitle(drafted)}</b> payroll is drafted
          {by ? (
            <>
              , review by <b className="font-medium">{by}</b>
            </>
          ) : null}
          {schedule?.overdue ? <span className="text-warning"> (overdue)</span> : null}
        </>
      ),
      href: `/console/runs/new?run=${drafted.id}`,
    });
  }
  if (toReview > 0)
    tasks.push({
      key: "requests",
      icon: Inbox,
      text: (
        <>
          <b className="font-medium">
            {formatCount(toReview)} payment {toReview === 1 ? "request" : "requests"}
          </b>{" "}
          to review
        </>
      ),
      href: "/console/requests",
    });
  if (open && open.id !== drafted?.id)
    tasks.push({
      key: "open",
      icon: ListChecks,
      text: (
        <>
          Finish the <b className="font-medium">{runTitle(open)}</b> payroll
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
  // Only once there is someone to read: an empty company has nothing for an accountant.
  if (!auditorSent && hasPeople)
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
  if (!open && hasPeople)
    tasks.push({
      key: "next",
      icon: ListChecks,
      text: (
        <>
          Start the <b className="font-medium">{nextPeriodTitle(runs)}</b> payroll
        </>
      ),
      href: "/console/runs/new",
    });
  const shown = tasks.slice(0, 4);
  return (
    <Card className={cn("flex flex-col", className)} aria-labelledby="todo-title">
      <CardHeader
        id="todo-title"
        title={
          <span className="inline-flex items-center gap-2">
            To do
            {tasks.length > 0 ? (
              <span className="text-[0.8125rem] text-muted-foreground">{formatCount(tasks.length)}</span>
            ) : null}
          </span>
        }
      />
      {shown.length === 0 ? (
        <p className="mt-4 inline-flex items-center gap-2 text-[0.9375rem] text-muted-foreground">
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
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
