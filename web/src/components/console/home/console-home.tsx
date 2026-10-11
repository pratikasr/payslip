"use client";

import Link from "next/link";
import { Check, Coins, Plus, Send, Share } from "lucide-react";
import { Usd, Zec } from "@/components/app/amount";
import { useCoinUnit, useHealth } from "@/components/app/health-provider";
import { HealthWarnings } from "@/components/app/health-warnings";
import { Initials } from "@/components/ds/avatar";
import { Card, CardHeader } from "@/components/ds/card";
import { ActionRow, PageTitle } from "@/components/ds/page";
import { SampleTag } from "@/components/shell/sample-tag";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { api, UNREACHABLE_CODE, type Contractor, type Run, type Wallet } from "@/lib/api";
import { companyName } from "@/lib/company";
import { formatCount } from "@/lib/format";
import { cn } from "cn";
import { ExportMenu } from "@/components/console/home/export-menu";
import { NextPayrollCard, PayrollHero, TodoCard, TreasuryCard } from "@/components/console/home/home-cards";
import { PaymentsTable } from "@/components/console/home/payments-table";
import { lastPaidByContractor, openRun, retryOnce, runStateLabel, settlementLabel } from "@/components/console/lib";
import { Bar, IconChip } from "@/components/console/ui";
import { Problem } from "@/components/runs/problem";
import { pastFunding, runTitle } from "@/components/runs/run-meta";

export interface HomeData {
  wallet?: Wallet;
  contractors?: Contractor[];
  runs?: Run[];
}

/** Where the company is: the one next step decides which quick action is gold. */
type Stage = "add-people" | "fund" | "run" | "unknown";

function stageOf(
  network: string | undefined,
  wallet: Wallet | undefined,
  contractors: Contractor[] | undefined,
  runs: Run[] | undefined,
): Stage {
  if (!contractors || !runs) return "unknown";
  if (contractors.length === 0) return "add-people";
  // On testnet the treasury must hold coins before a run can be funded; on mainnet each run is
  // funded with USDC when it is approved, so there is nothing to do first.
  const funded = (wallet?.treasury.total_zat ?? 0) > 0 || runs.some((r) => r.funding?.status === "success");
  if (network === "testnet" && wallet && !funded) return "fund";
  return "run";
}

/** Company home: Mercury's dashboard with payroll figures, all from the live service. */
export function ConsoleHome({ initial }: { initial: HomeData }) {
  const { network } = useHealth();
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
  const stage = stageOf(network, wallet.data, contractors.data, runs.data);
  const hasPeople = (contractors.data?.length ?? 0) > 0;
  const returning = !!runs.data?.some((r) => r.status === "paid");
  // The title is the employer, as a payroll product shows it; the welcome moves to the quieter line.
  const welcome = returning || stage === "unknown" ? "Welcome back." : "Welcome to Payslip.";
  const hint =
    stage === "add-people"
      ? " Private payroll on Zcash. Start with the people you pay."
      : stage === "fund"
        ? " Your people are in. Put testnet coins in the treasury, then run payroll."
        : "";

  return (
    <>
      <PageTitle
        title={
          <span className="inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1">
            <span className="min-w-0 break-words">{companyName()}</span>
            <SampleTag className="translate-y-px" />
          </span>
        }
        description={welcome + hint}
        className="mb-[18px]"
      />
      {/* One gold action: the next step for this company. Actions that cannot work yet are hidden. */}
      <ActionRow>
        {hasPeople ? (
          <Button asChild variant={stage === "run" ? "default" : "secondary"}>
            <Link href="/console/runs/new">
              <Send aria-hidden="true" />
              Run payroll
            </Link>
          </Button>
        ) : null}
        <Button asChild variant={stage === "add-people" ? "default" : "secondary"}>
          <Link href="/console/people?add=1">
            <Plus aria-hidden="true" />
            {stage === "add-people" ? "Add your first contractor" : "Add contractor"}
          </Link>
        </Button>
        <Button asChild variant={stage === "fund" ? "default" : "secondary"}>
          <Link href="/console/treasury">
            <Coins aria-hidden="true" />
            Fund treasury
          </Link>
        </Button>
        {hasPeople ? (
          <Button asChild variant="secondary">
            <Link href="/console/access">
              <Share aria-hidden="true" />
              Share payslips
            </Link>
          </Button>
        ) : null}
        {hasPeople && runs.data ? <ExportMenu runs={runs.data} /> : null}
      </ActionRow>
      <HealthWarnings className="mb-5" />
      {offline ? (
        <Problem error={offline} onRetry={retryAll} />
      ) : !settled ? (
        <HomeSkeleton />
      ) : !contractors.data || !runs.data ? (
        <Problem error={failed!} onRetry={retryAll} />
      ) : (
        <HomeBody wallet={wallet.data} contractors={contractors.data} runs={runs.data} />
      )}
    </>
  );
}

function HomeBody({ wallet, contractors, runs }: { wallet?: Wallet; contractors: Contractor[]; runs: Run[] }) {
  const hasPaid = runs.some((r) => r.status === "paid");
  // The Payments table lists money that moved: it waits for a funded run.
  const hasLines = runs.some((r) => r.lines.length > 0 && pastFunding(r));
  const hasPeople = contractors.length > 0;
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
            {/* Three cards on two columns: the to-do list takes the full second row. */}
            <TodoCard runs={runs} contractors={contractors} className="md:col-span-2 xl:col-span-1" />
          </div>
        </>
      ) : (
        <>
          <GetStarted wallet={wallet} contractors={contractors} runs={runs} />
          {/* Until someone is added there is nothing to schedule or do but the steps above. */}
          {hasPeople ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <ContractorsCard contractors={contractors} runs={runs} />
              <div className="grid content-start gap-5">
                <NextPayrollCard runs={runs} contractors={contractors} />
                <TodoCard runs={runs} contractors={contractors} />
              </div>
            </div>
          ) : null}
        </>
      )}
      {hasLines ? <PaymentsTable runs={runs} /> : null}
    </div>
  );
}

/* ---------- Get started (until the first paid run) ---------- */

function GetStarted({ wallet, contractors, runs }: { wallet?: Wallet; contractors: Contractor[]; runs: Run[] }) {
  const { network } = useHealth();
  const open = openRun(runs);
  const shared = contractors.filter((c) => c.fvk_shared_at).length;
  const funded = (wallet?.treasury.total_zat ?? 0) > 0 || runs.some((r) => r.funding?.status === "success");
  const hasPeople = contractors.length > 0;
  // In the order a company does them: people first, then coins, then the run, then payslips.
  const steps = [
    {
      title: "Add contractors",
      detail: hasPeople
        ? `${formatCount(contractors.length)} ${contractors.length === 1 ? "person" : "people"} added`
        : "Name and Zcash address",
      done: hasPeople,
      href: "/console/people?add=1",
      action: "Add contractor",
    },
    {
      title: "Fund the treasury",
      detail:
        network === "mainnet" ? (
          "Each run is funded when you approve it, with ZEC sent to the treasury or with USDC"
        ) : wallet ? (
          funded ? (
            <>
              <Zec zat={wallet.treasury.total_zat} short /> in the treasury
            </>
          ) : (
            "Free testnet coins from a faucet"
          )
        ) : (
          "Treasury balance unavailable"
        ),
      done: network === "mainnet" || funded,
      href: "/console/treasury",
      action: "Open treasury",
    },
    {
      title: "Run payroll",
      detail: open ? `${runTitle(open)} run: ${runStateLabel(open)}` : "Pay everyone in one shielded run",
      done: false,
      blocked: !hasPeople,
      href: open ? `/console/runs/${open.id}` : "/console/runs/new",
      action: open ? "Continue" : "Start a run",
    },
    {
      title: "Share payslips",
      detail: hasPeople ? `${formatCount(shared)} of ${formatCount(contractors.length)} shared` : "After adding people",
      done: hasPeople && shared === contractors.length,
      blocked: !hasPeople,
      href: "/console/access",
      action: "Share",
    },
  ];
  const done = steps.filter((s) => s.done).length;
  // The first step not done yet is the one to do now; it alone gets the gold button.
  const next = steps.findIndex((s) => !s.done && !s.blocked);
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
      {/* minmax(0, 1fr) tracks, so a long detail line truncates instead of widening the page. */}
      <ol className="mt-4 grid grid-cols-1 gap-x-6 sm:grid-cols-2 xl:grid-cols-4">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className="flex items-center gap-3 border-t border-hairline py-3 xl:flex-col xl:items-start"
          >
            <span className="flex min-w-0 flex-1 items-center gap-3 xl:w-full xl:flex-none xl:items-start">
              <span
                className={cn(
                  "grid size-6 shrink-0 place-items-center rounded-full border text-[0.8125rem]",
                  s.done ? "border-transparent bg-success-bg text-success" : "border-border text-muted-foreground",
                )}
              >
                {s.done ? <Check className="size-3.5" aria-hidden="true" /> : <span aria-hidden="true">{i + 1}</span>}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block text-[0.9375rem]", s.done && "text-muted-foreground")}>
                  {s.title}
                  <span className="sr-only">{s.done ? " (done)" : " (to do)"}</span>
                </span>
                <span className="line-clamp-2 block text-[0.8125rem] text-muted-foreground">{s.detail}</span>
              </span>
            </span>
            {s.done || s.blocked ? null : (
              <Button asChild size="sm" variant={i === next ? "default" : "secondary"} className="xl:ml-9">
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
  const coin = useCoinUnit();
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
      <div
        className="mt-2 flex justify-between border-b border-hairline pb-1.5 text-[0.8125rem] text-muted-foreground"
        aria-hidden="true"
      >
        <span>Person</span>
        <span>Last paid</span>
      </div>
      <ul>
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
                  <span className="block truncate text-[0.8125rem] text-muted-foreground">
                    {settlementLabel(c, coin)}
                  </span>
                </span>
                {lp ? (
                  <span className="text-right">
                    <Usd cents={lp.cents} className="block text-[0.9375rem]" />
                    <span className="block text-[0.8125rem] text-muted-foreground">
                      <span className="sr-only">Last paid for </span>
                      {lp.period}
                    </span>
                  </span>
                ) : (
                  <span className="text-[0.8125rem] text-muted-foreground">Not paid yet</span>
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
