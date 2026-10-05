"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Coins,
  Download,
  FileText,
  KeyRound,
  Plus,
  Send,
  Share,
  ShieldCheck,
} from "lucide-react";
import { compactUsd, Rate, Usd, Zec } from "@/components/app/amount";
import { HealthWarnings } from "@/components/app/health-warnings";
import { ErrorState } from "@/components/app/states";
import { Initials } from "@/components/ds/avatar";
import { Card, CardFoot, CardHeader } from "@/components/ds/card";
import { ActionRow, PageTitle, SectionHeader } from "@/components/ds/page";
import { Tag } from "@/components/ds/tag";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { api, UNREACHABLE_CODE, type Contractor, type Run, type Wallet } from "@/lib/api";
import { formatCount, formatDate, formatPeriodLabel, MINUS } from "@/lib/format";
import { cn } from "cn";
import { PaidChart } from "@/components/console/home/paid-chart";
import { PaymentsTable } from "@/components/console/home/payments-table";
import {
  fundingSource,
  isSimulated,
  lastPaidByContractor,
  nameList,
  newestFirst,
  nextPeriodLabel,
  openRun,
  paidByPeriod,
  paidPeriodCount,
  paidRuns,
  paidTotals,
  personSubline,
  retryOnce,
  RUN_STATUS_LABEL,
  runProgress,
  shortDate,
} from "@/components/console/lib";
import { ArrowLink, Bar, IconChip, MiniStats } from "@/components/console/ui";

export interface HomeData {
  wallet?: Wallet;
  contractors?: Contractor[];
  runs?: Run[];
}

/** Company home: Mercury's dashboard with payroll figures, all from the live service. */
export function ConsoleHome({ initial }: { initial: HomeData }) {
  const wallet = useResource((s) => retryOnce(() => api.wallet(s)), "console-wallet", initial.wallet);
  const contractors = useResource((s) => api.contractors(s), "console-contractors", initial.contractors);
  const runs = useResource((s) => api.runs(s), "console-runs", initial.runs);

  const errors = [wallet.error, contractors.error, runs.error];
  const offline = errors.find((e) => e?.code === UNREACHABLE_CODE);
  const failed = errors.find(Boolean);
  const settled = (wallet.data || wallet.error) && (contractors.data || contractors.error) && (runs.data || runs.error);
  const retryAll = () => {
    void wallet.reload();
    void contractors.reload();
    void runs.reload();
  };

  return (
    <>
      <PageTitle title="Welcome back" className="mb-[18px]" />
      <ActionRow>
        <Button asChild>
          <Link href="/console/runs/new">
            <Send aria-hidden="true" />
            Run payroll
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/console/people?add=1">
            <Plus aria-hidden="true" />
            Add contractor
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/console/treasury">
            <Coins aria-hidden="true" />
            Fund treasury
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/console/access">
            <Share aria-hidden="true" />
            Share payslips
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/console/access#auditor-package">
            <Download aria-hidden="true" />
            Export
          </Link>
        </Button>
      </ActionRow>
      <HealthWarnings className="mb-5" />
      {offline ? (
        <ErrorState error={offline} onRetry={retryAll} />
      ) : !settled ? (
        <HomeSkeleton />
      ) : !contractors.data || !runs.data ? (
        <ErrorState error={failed!} onRetry={retryAll} />
      ) : (
        <HomeBody wallet={wallet.data} contractors={contractors.data} runs={runs.data} />
      )}
    </>
  );
}

function HomeBody({ wallet, contractors, runs }: { wallet?: Wallet; contractors: Contractor[]; runs: Run[] }) {
  const hasPaid = runs.some((r) => r.status === "paid");
  const hasLines = runs.some((r) => r.lines.length > 0);
  return (
    <div className="space-y-5">
      {hasPaid ? (
        <>
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
            <PaidCard runs={runs} />
            <ContractorsCard contractors={contractors} runs={runs} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            <NextPayrollCard runs={runs} />
            <AccessCard contractors={contractors} />
            <BooksCard runs={runs} />
          </div>
        </>
      ) : (
        <>
          <GetStarted wallet={wallet} contractors={contractors} runs={runs} />
          <div className="grid gap-5 lg:grid-cols-2">
            {contractors.length > 0 ? <ContractorsCard contractors={contractors} runs={runs} /> : null}
            <div className="grid gap-5">
              <NextPayrollCard runs={runs} />
              {contractors.length > 0 ? <AccessCard contractors={contractors} /> : null}
            </div>
          </div>
        </>
      )}
      <Movement runs={runs} />
      {hasLines ? <PaymentsTable runs={runs} /> : null}
    </div>
  );
}

/* ---------- Get started (until the first paid run) ---------- */

function GetStarted({ wallet, contractors, runs }: { wallet?: Wallet; contractors: Contractor[]; runs: Run[] }) {
  const open = openRun(runs);
  const shared = contractors.filter((c) => c.fvk_shared_at).length;
  const funded = (wallet?.treasury.total_zat ?? 0) > 0 || runs.some((r) => r.funding?.status === "success");
  const steps = [
    {
      title: "Fund the treasury",
      detail: wallet ? (
        funded ? (
          <>
            <Zec zat={wallet.treasury.total_zat} short /> in the treasury
          </>
        ) : (
          "Send coins to the treasury address"
        )
      ) : (
        "Treasury balance unavailable"
      ),
      done: funded,
      href: "/console/treasury",
      action: "Open treasury",
    },
    {
      title: "Add contractors",
      detail:
        contractors.length > 0
          ? `${formatCount(contractors.length)} ${contractors.length === 1 ? "person" : "people"} added`
          : "Name and unified address",
      done: contractors.length > 0,
      href: "/console/people?add=1",
      action: "Add contractor",
    },
    {
      title: "Run payroll",
      detail: open
        ? `${formatPeriodLabel(open.period_label)} run: ${RUN_STATUS_LABEL[open.status]}`
        : "Pay everyone in one run",
      done: false,
      href: open ? `/console/runs/${open.id}` : "/console/runs/new",
      action: open ? "Continue" : "Start a run",
    },
    {
      title: "Share payslips",
      detail:
        contractors.length > 0
          ? `${formatCount(shared)} of ${formatCount(contractors.length)} shared`
          : "After adding people",
      done: contractors.length > 0 && shared === contractors.length,
      blocked: contractors.length === 0,
      href: "/console/access",
      action: "Share",
    },
  ];
  const done = steps.filter((s) => s.done).length;
  return (
    <Card aria-labelledby="get-started-title">
      <CardHeader
        id="get-started-title"
        title="Get started"
        actions={
          <span className="num text-[0.8125rem] text-muted-foreground">
            {done} of {steps.length} done
          </span>
        }
      />
      <Bar value={done / steps.length} label="Setup progress" className="mt-3" />
      <ol className="mt-4 grid gap-x-6 sm:grid-cols-2">
        {steps.map((s) => (
          <li key={s.title} className="flex items-center gap-3 border-t border-hairline py-3">
            <span
              className={cn(
                "grid size-6 shrink-0 place-items-center rounded-full border",
                s.done ? "border-transparent bg-success-bg text-success" : "border-border text-transparent",
              )}
            >
              <Check className="size-3.5" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-[0.9375rem]", s.done && "text-muted-foreground")}>
                {s.title}
                <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
              </span>
              <span className="block truncate text-xs text-muted-foreground">{s.detail}</span>
            </span>
            {s.done || s.blocked ? null : (
              <Button asChild size="sm" variant="secondary">
                <Link href={s.href}>{s.action}</Link>
              </Button>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

/* ---------- Paid to contractors ---------- */

function PaidCard({ runs }: { runs: Run[] }) {
  const totals = paidTotals(runs);
  const paid = paidRuns(runs);
  const latest = paid[0];
  const showChart = paidPeriodCount(runs) >= 3;
  const latestPaid = latest.lines.reduce((s, l) => s + (l.status === "confirmed" ? l.amount_usd_cents : 0), 0);
  return (
    <Card className="flex flex-col" aria-labelledby="paid-title">
      <CardHeader
        id="paid-title"
        title={
          <span className="inline-flex items-center gap-1.5">
            Paid to contractors
            <ShieldCheck className="size-4 text-primary-edge" aria-label="Shielded" />
          </span>
        }
      />
      <div className="mt-1 text-[1.75rem] leading-tight font-[380]">
        <Usd cents={totals.cents} />
      </div>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 text-sm text-strong">
        <span>
          {formatCount(paid.length)} paid {paid.length === 1 ? "run" : "runs"}, {formatCount(totals.payments)}{" "}
          {totals.payments === 1 ? "payment" : "payments"}
        </span>
        <span className="inline-flex items-center gap-3.5 whitespace-nowrap">
          {totals.fundedCents > 0 ? (
            <span className="inline-flex items-center gap-0.5 text-success" title="Funded">
              <ArrowUpRight className="size-4" aria-hidden="true" />
              <span className="sr-only">Funded </span>
              <span className="money">{compactUsd(totals.fundedCents)}</span>
            </span>
          ) : null}
          <span className="inline-flex items-center gap-0.5" title="Paid out">
            <ArrowDownRight className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">Paid out </span>
            <span className="money">
              {MINUS}
              {compactUsd(totals.cents)}
            </span>
          </span>
        </span>
      </div>
      {showChart ? <PaidChart points={paidByPeriod(runs)} /> : <LatestRun run={latest} paidCents={latestPaid} />}
    </Card>
  );
}

/**
 * Until three periods are paid there is no trend to chart, so the card shows the latest paid run:
 * how much of what was funded went out to people, and what stayed behind.
 */
function LatestRun({ run, paidCents }: { run: Run; paidCents: number }) {
  const funded = run.funding?.funded_usd_cents ?? 0;
  const rest = Math.max(0, funded - paidCents);
  const share = funded > 0 ? paidCents / funded : 1;
  return (
    <div className="mt-auto pt-7">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[0.9375rem]">
          {formatPeriodLabel(run.period_label)} run · {formatCount(run.lines.length)}{" "}
          {run.lines.length === 1 ? "person" : "people"}
        </span>
        <ArrowLink href={`/console/runs/${run.id}`} className="shrink-0 text-sm">
          View run
        </ArrowLink>
      </div>
      {funded > 0 ? (
        <>
          <div
            className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full"
            role="img"
            aria-label={`${Math.round(share * 100)} percent of the funded amount was paid to contractors`}
          >
            <span className="h-full rounded-l-full bg-primary" style={{ width: `${share * 100}%` }} />
            {rest > 0 ? <span className="h-full flex-1 rounded-r-full bg-chip" /> : null}
          </div>
          <div className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
              Paid <Usd cents={paidCents} className="text-strong" />
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-chip ring-1 ring-border" aria-hidden="true" />
              Not paid out <Usd cents={rest} className="text-strong" />
            </span>
          </div>
        </>
      ) : null}
      <MiniStats
        className="mt-4 border-t border-hairline pt-4"
        items={[
          { label: "Funded", value: funded > 0 ? <Usd cents={funded} /> : "None" },
          { label: "Completed", value: shortDate(run.updated_at) },
          { label: "Network fees", value: <Zec zat={run.fees_zat ?? 0} short /> },
        ]}
      />
    </div>
  );
}

/* ---------- Contractors ---------- */

function ContractorsCard({ contractors, runs }: { contractors: Contractor[]; runs: Run[] }) {
  const last = lastPaidByContractor(runs);
  const people = contractors.slice().sort((a, b) => a.account_index - b.account_index);
  const shown = people.slice(0, 5);
  const rest = people.length - shown.length;
  return (
    <Card aria-labelledby="contractors-title">
      <CardHeader
        id="contractors-title"
        title="Contractors"
        actions={<IconChip icon={Plus} href="/console/people?add=1" label="Add contractor" />}
      />
      <ul className="mt-2.5">
        {shown.map((c) => {
          const lp = last.get(c.id);
          return (
            <li key={c.id}>
              <Link
                href={`/console/people?person=${c.id}`}
                className="-mx-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-[9px] transition-colors hover:bg-muted"
              >
                <Initials name={c.name} />
                <span className="min-w-0">
                  <span className="block truncate text-[0.9375rem]">{c.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{personSubline(c)}</span>
                </span>
                {lp ? (
                  <Usd cents={lp.cents} className="text-[0.9375rem]" />
                ) : (
                  <span className="text-sm text-muted-foreground">Not paid yet</span>
                )}
              </Link>
            </li>
          );
        })}
        <li>
          <Link
            href="/console/people"
            className="-mx-2 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 py-[9px] text-[0.9375rem] transition-colors hover:bg-muted"
          >
            <Initials text={rest > 0 ? `+${rest}` : String(people.length)} className="bg-chip" />
            View all people
          </Link>
        </li>
      </ul>
    </Card>
  );
}

/* ---------- Next payroll, Payslip access, Books ---------- */

function NextPayrollCard({ runs }: { runs: Run[] }) {
  const run = openRun(runs);
  if (!run) {
    const latest = paidRuns(runs)[0];
    return (
      <Card className="flex flex-col" aria-labelledby="next-title">
        <CardHeader id="next-title" title="Next payroll" actions={<IconChip icon={CalendarDays} />} />
        <div className="mt-0.5 text-[1.1875rem] font-[380]">Start the {nextPeriodLabel(runs)} run</div>
        <Bar value={0} label="Next run not started" className="mt-4" />
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>Not started</span>
          <span>Draft</span>
        </div>
        <div className="mt-auto">
          <CardFoot
            label="Last run"
            value={latest ? `${formatPeriodLabel(latest.period_label)}, paid` : "None yet"}
            action={
              <Button asChild size="sm" variant="secondary">
                <Link href="/console/runs/new">Start</Link>
              </Button>
            }
          />
        </div>
      </Card>
    );
  }
  return (
    <Card className="flex flex-col" aria-labelledby="next-title">
      <CardHeader id="next-title" title="Next payroll" actions={<IconChip icon={CalendarDays} />} />
      <div className="mt-0.5 text-[1.1875rem] font-[380]">
        <Usd cents={run.total_usd_cents} />
      </div>
      <Bar
        value={run.status === "failed" ? 1 : runProgress(run.status)}
        tone={run.status === "failed" ? "danger" : "gold"}
        label={`Run progress: ${RUN_STATUS_LABEL[run.status]}`}
        className="mt-4"
      />
      <div className="mt-2 flex justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {formatPeriodLabel(run.period_label)} · {formatCount(run.lines.length)}{" "}
          {run.lines.length === 1 ? "person" : "people"}
        </span>
        <span className={cn(run.status === "failed" && "text-destructive")}>{RUN_STATUS_LABEL[run.status]}</span>
      </div>
      <div className="mt-auto">
        <CardFoot
          label="Period ends"
          value={formatDate(run.period_end)}
          action={
            <Button asChild size="sm" variant="secondary">
              <Link href={`/console/runs/${run.id}`}>{run.status === "draft" ? "Review" : "Continue"}</Link>
            </Button>
          }
        />
      </div>
    </Card>
  );
}

function AccessCard({ contractors }: { contractors: Contractor[] }) {
  const waiting = contractors.filter((c) => !c.fvk_shared_at).sort((a, b) => a.account_index - b.account_index);
  const shared = contractors.length - waiting.length;
  return (
    <Card className="flex flex-col" aria-labelledby="access-title">
      <CardHeader id="access-title" title="Payslip access" actions={<IconChip icon={KeyRound} />} />
      <MiniStats
        items={[
          { label: "Shared", value: formatCount(shared) },
          { label: "Not yet", value: formatCount(waiting.length) },
          { label: "People", value: formatCount(contractors.length) },
        ]}
        className="mt-2"
      />
      <div className="mt-auto">
        <CardFoot
          label="Waiting"
          value={
            waiting.length > 0 ? (
              <span className="line-clamp-2">{nameList(waiting.map((c) => c.name))}</span>
            ) : contractors.length > 0 ? (
              "Nobody"
            ) : (
              "No people yet"
            )
          }
          action={<ArrowLink href="/console/access">Share</ArrowLink>}
        />
      </div>
    </Card>
  );
}

function BooksCard({ runs }: { runs: Run[] }) {
  const paid = paidRuns(runs);
  const totals = paidTotals(runs);
  const latest = paid[0];
  return (
    <Card className="flex flex-col lg:col-span-2 xl:col-span-1" aria-labelledby="books-title">
      <CardHeader id="books-title" title="Books" actions={<IconChip icon={FileText} />} />
      <MiniStats
        items={[
          { label: "Paid runs", value: formatCount(paid.length) },
          { label: "Payments", value: formatCount(totals.payments) },
          { label: "Fees", value: <Zec zat={totals.feesZat} short /> },
        ]}
        className="mt-2"
      />
      <div className="mt-auto">
        <CardFoot
          label="Latest paid run"
          value={latest ? `${formatPeriodLabel(latest.period_label)} · ${shortDate(latest.updated_at)}` : "None yet"}
          action={<ArrowLink href="/books">Open in Books</ArrowLink>}
        />
      </div>
    </Card>
  );
}

/* ---------- Payroll movement ---------- */

function Movement({ runs }: { runs: Run[] }) {
  // Runs that moved money, oldest first so the arrows read left to right in time.
  const moved = useMemo(
    () =>
      newestFirst(runs)
        .filter((r) => r.funding?.status === "success" || r.lines.some((l) => l.status === "confirmed"))
        .reverse(),
    [runs],
  );
  const defaultIndex = useMemo(() => {
    const lastPaid = moved.map((r) => r.status).lastIndexOf("paid");
    return lastPaid >= 0 ? lastPaid : moved.length - 1;
  }, [moved]);
  const [picked, setPicked] = useState<number | null>(null);
  if (moved.length === 0) return null;
  const index = Math.min(picked ?? defaultIndex, moved.length - 1);
  const run = moved[index];
  const label = formatPeriodLabel(run.period_label);
  const samePeriod = moved.filter((r) => r.period_label === run.period_label);
  const suffix = samePeriod.length > 1 ? ` (${samePeriod.indexOf(run) + 1} of ${samePeriod.length})` : "";
  const confirmed = run.lines.filter((l) => l.status === "confirmed");
  const paidOut = confirmed.reduce((s, l) => s + l.amount_usd_cents, 0);
  const largest = confirmed
    .slice()
    .sort((a, b) => b.amount_usd_cents - a.amount_usd_cents)
    .slice(0, 3);
  const f = run.funding;
  return (
    <section aria-labelledby="movement-title">
      <SectionHeader id="movement-title" title="Payroll movement">
        <div className="flex items-center gap-1 text-[0.9375rem] text-strong">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous run"
            disabled={index === 0}
            onClick={() => setPicked(index - 1)}
          >
            <ChevronLeft aria-hidden="true" />
          </Button>
          <span aria-live="polite" className="min-w-[5.5rem] text-center">
            {label}
            {suffix}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next run"
            disabled={index === moved.length - 1}
            onClick={() => setPicked(index + 1)}
          >
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </SectionHeader>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card aria-label={`Funded for ${label}`}>
          <div className="text-[0.9375rem] text-strong">Funded</div>
          <div className="mt-1 text-[1.1875rem]">
            {f?.funded_usd_cents ? (
              <Usd cents={f.funded_usd_cents} className="text-success" />
            ) : (
              <span className="text-muted-foreground">Not funded yet</span>
            )}
          </div>
          <div className="mt-4 border-t border-hairline pt-4">
            <div className="mb-1.5 text-[0.9375rem] text-strong">Sources</div>
            {f && f.status === "success" ? (
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-[9px]">
                <Initials text={isSimulated(run) ? "T" : "US"} />
                <span className="min-w-0">
                  <span className="block truncate text-[0.9375rem]">{fundingSource(run)}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
                    {isSimulated(run) ? (
                      <Tag title="Testnet coins have no price; the service uses a fixed rate.">Simulated rate</Tag>
                    ) : (
                      <span>
                        Swapped at <Rate e6={f.rate_usd_per_zec_e6} />
                      </span>
                    )}
                  </span>
                </span>
                <span className="text-right">
                  {f.funded_usd_cents ? <Usd cents={f.funded_usd_cents} className="block text-[0.9375rem]" /> : null}
                  <Zec zat={f.zec_acquired_zat} short className="block text-xs text-muted-foreground" />
                </span>
              </div>
            ) : (
              <p className="py-2 text-sm text-muted-foreground">No funding recorded for this run.</p>
            )}
          </div>
        </Card>
        <Card aria-label={`Paid out for ${label}`}>
          <div className="text-[0.9375rem] text-strong">Paid out</div>
          <div className="mt-1 text-[1.1875rem]">
            <Usd cents={-paidOut} />
          </div>
          <div className="mt-4 border-t border-hairline pt-4">
            <div className="mb-1.5 text-[0.9375rem] text-strong">Largest payments</div>
            {largest.length > 0 ? (
              <ul>
                {largest.map((l) => (
                  <li key={l.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-[9px]">
                    <Initials name={l.contractor_name} />
                    <span className="truncate text-[0.9375rem]">{l.contractor_name}</span>
                    <Usd cents={-l.amount_usd_cents} className="text-[0.9375rem]" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-2 text-sm text-muted-foreground">No payments confirmed in this run yet.</p>
            )}
          </div>
        </Card>
      </div>
    </section>
  );
}

/** One placeholder for the body while the service answers; replaced in a single step. */
function HomeSkeleton() {
  return (
    <div role="status" aria-label="Loading home" className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-3 rounded-xl border p-5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-40 w-full" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3 rounded-xl border p-5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-10 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
