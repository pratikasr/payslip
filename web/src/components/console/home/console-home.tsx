"use client";

import Link from "next/link";
import { Check, Coins, Download, Plus, Send, Share } from "lucide-react";
import { Usd, Zec } from "@/components/app/amount";
import { HealthWarnings } from "@/components/app/health-warnings";
import { ErrorState } from "@/components/app/states";
import { Initials } from "@/components/ds/avatar";
import { Card, CardHeader } from "@/components/ds/card";
import { ActionRow, PageTitle } from "@/components/ds/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { api, UNREACHABLE_CODE, type Contractor, type Run, type Wallet } from "@/lib/api";
import { formatCount, formatPeriodLabel } from "@/lib/format";
import { cn } from "cn";
import { NextPayrollCard, PayrollHero, TodoCard, TreasuryCard } from "@/components/console/home/home-cards";
import { PaymentsTable } from "@/components/console/home/payments-table";
import { lastPaidByContractor, openRun, personSubline, retryOnce, RUN_STATUS_LABEL } from "@/components/console/lib";
import { Bar, IconChip } from "@/components/console/ui";

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
            <PayrollHero runs={runs} />
            <ContractorsCard contractors={contractors} runs={runs} />
          </div>
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            <TreasuryCard wallet={wallet} runs={runs} />
            <NextPayrollCard runs={runs} contractors={contractors} />
            <TodoCard runs={runs} contractors={contractors} />
          </div>
        </>
      ) : (
        <>
          <GetStarted wallet={wallet} contractors={contractors} runs={runs} />
          <div className="grid gap-5 lg:grid-cols-2">
            {contractors.length > 0 ? <ContractorsCard contractors={contractors} runs={runs} /> : null}
            <div className="grid gap-5">
              <NextPayrollCard runs={runs} contractors={contractors} />
              <TodoCard runs={runs} contractors={contractors} />
            </div>
          </div>
        </>
      )}
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
