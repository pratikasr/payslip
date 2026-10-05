"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpenCheck, ChevronRight, Download, KeyRound } from "lucide-react";
import { Fiat, Usd, Zec } from "@/components/app/amount";
import { useHealth } from "@/components/app/health-provider";
import { ErrorState } from "@/components/app/states";
import { Card, CardFoot, CardHeader } from "@/components/ds/card";
import { PageTitle, SectionHeader } from "@/components/ds/page";
import { PayslipRows } from "@/components/portal/payslip-rows";
import { firstName, monthDay, newestFirst, payslipHref } from "@/components/portal/portal-data";
import { usePersonName, usePortal } from "@/components/portal/portal-provider";
import { RowsSkeleton, ScanProgress, SettlementTag, SimulatedRate } from "@/components/portal/portal-states";
import { ShareProofDialog } from "@/components/portal/share-proof-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Statement, StatementLine } from "@/lib/api";
import { formatPeriodLabel, formatUsd } from "@/lib/format";
import { cn } from "cn";

const LATEST = 5;

/** The contractor's home, its layout informed by Mercury's employee view: what was paid, the last payment, payslips. */
export function PortalHome() {
  const { recent, reload } = usePortal();
  const s = recent.statement;
  if (!s) {
    return (
      <>
        <PageTitle title="Welcome" />
        <Scope />
        {recent.error ? (
          <ErrorState error={recent.error} onRetry={reload} />
        ) : (
          <div className="space-y-5">
            <ScanProgress startedAt={recent.startedAt} />
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
              <Skeleton className="h-[168px] rounded-xl" />
              <Skeleton className="h-[168px] rounded-xl" />
            </div>
            <RowsSkeleton />
          </div>
        )}
      </>
    );
  }
  return <HomeBody statement={s} />;
}

function Scope() {
  return (
    <p className="mb-6 flex items-start gap-2.5 rounded-[10px] bg-raised px-3.5 py-2.5 text-sm text-muted-foreground">
      <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      Your viewing key shows payments to you and nothing else. It cannot move money.
    </p>
  );
}

/** The latest payment by the time it was mined, whatever pay period it was for. */
function latestPaid(lines: StatementLine[]): StatementLine | undefined {
  return lines
    .slice()
    .sort(
      (a, b) => (b.block_time ?? b.date).localeCompare(a.block_time ?? a.date) || (b.height ?? 0) - (a.height ?? 0),
    )[0];
}

/** The company's Treasury key opened as if it were a person's: say what it is and where it belongs. */
function TreasuryKeyNote() {
  return (
    <div
      role="note"
      className="mb-6 flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning-bg px-4 py-3.5 text-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <span className="text-strong">
        This is the company&apos;s Treasury key. It reads the payroll account, not one person&apos;s pay, so it has no
        payslips. Open it in Books with the contractors&apos; keys to reconcile each run.
      </span>
      <Link
        href="/books"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-sm text-link underline underline-offset-4"
      >
        <BookOpenCheck className="size-4" aria-hidden="true" />
        Open Books
      </Link>
    </div>
  );
}

function HomeBody({ statement: s }: { statement: Statement }) {
  const { recent, reload } = usePortal();
  const [sharing, setSharing] = useState<StatementLine | null>(null);
  const first = firstName(usePersonName());
  const lines = newestFirst(s.lines);
  const pending = newestFirst(s.pending);
  const last = latestPaid(s.lines);
  return (
    <>
      <PageTitle title={first ? `Welcome, ${first}` : "Welcome"} />
      {s.account.role === "treasury" ? <TreasuryKeyNote /> : <Scope />}
      {recent.error ? <ErrorState error={recent.error} onRetry={reload} className="mb-5" /> : null}
      {recent.loading ? (
        <div className="mb-5">
          <ScanProgress startedAt={recent.startedAt} title="Refreshing your payments" />
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <PaidThisYear statement={s} />
        <Card aria-labelledby="last-payment">
          <CardHeader id="last-payment" title="Last payment" actions={last ? <SettlementTag line={last} /> : null} />
          {last ? (
            <>
              <div className="mt-1 text-[1.1875rem] font-[380]">
                <Usd cents={last.usd_basis_cents} />
              </div>
              <CardFoot
                label="Paid"
                value={
                  <span className="text-pretty">
                    {monthDay(last.block_time ?? last.date)} · {formatPeriodLabel(last.period)} · {last.invoice_ref}
                  </span>
                }
                action={
                  <Link
                    href={payslipHref(last)}
                    className="inline-flex shrink-0 items-center gap-0.5 rounded-sm text-[0.9375rem] text-link hover:underline"
                    aria-label={`Open the payslip for ${formatPeriodLabel(last.period)}`}
                  >
                    Payslip
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Link>
                }
              />
            </>
          ) : (
            <p className="mt-3 text-[0.9375rem] text-muted-foreground">
              {pending.length > 0
                ? "Your first payment is on its way and appears here once its block is mined."
                : "No payments in the last 12 months."}
            </p>
          )}
        </Card>
      </div>

      <SectionHeader title="Payslips" id="payslips-heading">
        <Button asChild variant="secondary" size="sm">
          <Link href="/portal/tax">
            <Download aria-hidden="true" />
            Download for tax
          </Link>
        </Button>
        {lines.length > LATEST ? (
          <Link
            href="/portal/payslips"
            className="ml-auto inline-flex items-center gap-0.5 rounded-sm text-[0.9375rem] text-link hover:underline"
          >
            View all
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : null}
      </SectionHeader>
      {lines.length + pending.length === 0 ? (
        <p className="border-y border-hairline py-6 text-[0.9375rem] text-muted-foreground">
          Payslips appear here when your payer runs payroll and the payment is mined on Zcash.
        </p>
      ) : (
        <PayslipRows lines={lines.slice(0, LATEST)} pending={pending} onShare={setSharing} label="Latest payslips" />
      )}
      <ShareProofDialog line={sharing} onOpenChange={(open) => !open && setSharing(null)} />
    </>
  );
}

/** "Paid to you in 2026": USD agreed, coins received, and on mainnet the value when each arrived. */
function PaidThisYear({ statement: s }: { statement: Statement }) {
  const { currency } = usePortal();
  const { health } = useHealth();
  const [unit, setUnit] = useState<"usd" | "local">("usd");
  const year = new Date().getUTCFullYear();
  const ytd = s.lines.filter((l) => l.date.startsWith(`${year}-`));
  const usd = ytd.reduce((n, l) => n + l.usd_basis_cents, 0);
  const zat = ytd.reduce((n, l) => n + l.amount_zat, 0);
  const priced = ytd.filter((l) => l.market && l.market.currency === currency.toUpperCase());
  const market = priced.reduce((n, l) => n + (l.market?.value_cents ?? 0), 0);
  const mainnet = s.network === "mainnet";
  const showMarket = mainnet && health?.market_prices !== false && !!s.market?.available && priced.length > 0;
  const toggle = showMarket && currency.toUpperCase() !== "USD";
  const local = toggle && unit === "local";

  return (
    <Card aria-labelledby="paid-this-year">
      <CardHeader
        id="paid-this-year"
        title={`Paid to you in ${year}`}
        actions={
          toggle ? (
            <div className="inline-flex overflow-hidden rounded-lg border" role="group" aria-label="Show amounts in">
              {(["usd", "local"] as const).map((u) => (
                <button
                  key={u}
                  type="button"
                  aria-pressed={unit === u}
                  onClick={() => setUnit(u)}
                  className={cn(
                    "h-[30px] min-w-10 px-2.5 text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground",
                    unit === u && "bg-primary-soft text-foreground",
                  )}
                >
                  {u === "usd" ? "USD" : currency.toUpperCase()}
                </button>
              ))}
            </div>
          ) : null
        }
      />
      <div className="mt-1 text-[1.75rem] leading-tight font-[380]">
        {local ? <Fiat cents={market} currency={currency.toUpperCase()} /> : <Usd cents={usd} />}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm text-strong">
        <span>
          <Zec zat={zat} short /> received
        </span>
        {showMarket ? (
          local ? (
            <span className="text-muted-foreground">
              Agreed <Usd cents={usd} />
            </span>
          ) : (
            <span className="text-success">
              Worth <Fiat cents={market} currency={currency.toUpperCase()} /> on arrival
            </span>
          )
        ) : mainnet ? null : (
          <SimulatedRate />
        )}
      </div>
      {ytd.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No payments yet this year.</p>
      ) : (
        <MonthStrip lines={s.lines} year={year} />
      )}
    </Card>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Pay for each month of the year, by the pay period each payment was for: twelve thin bars, an
 * empty month as a faint stub. One series, so no legend; the table beside it is for screen readers.
 */
function MonthStrip({ lines, year }: { lines: StatementLine[]; year: number }) {
  const months = MONTHS.map((label, i) => {
    const period = `${year}-${String(i + 1).padStart(2, "0")}`;
    return {
      label,
      period,
      cents: lines.filter((l) => l.period === period).reduce((n, l) => n + l.usd_basis_cents, 0),
    };
  });
  const max = Math.max(1, ...months.map((m) => m.cents));
  return (
    <figure className="mt-4" aria-labelledby="month-strip-caption">
      <figcaption id="month-strip-caption" className="mb-1.5 text-xs text-muted-foreground">
        By pay period
      </figcaption>
      <div className="flex h-12 items-end gap-[2px]" aria-hidden="true">
        {months.map((m) => (
          <div
            key={m.period}
            title={`${formatPeriodLabel(m.period)}: ${m.cents ? formatUsd(m.cents) : "no pay"}`}
            className="flex h-full flex-1 items-end"
          >
            <div
              className={cn(
                "w-full rounded-t-[4px]",
                m.cents ? "bg-[#b3820e] dark:bg-[#bd8a14]" : "h-[2px] rounded-none bg-hairline",
              )}
              style={m.cents ? { height: `${Math.max(8, (m.cents / max) * 100)}%` } : undefined}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px] text-center text-[0.6875rem] text-muted-foreground" aria-hidden="true">
        {months.map((m) => (
          <span key={m.period} className="flex-1">
            {m.label.slice(0, 1)}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Pay by pay period, {year}</caption>
        <tbody>
          {months
            .filter((m) => m.cents)
            .map((m) => (
              <tr key={m.period}>
                <th scope="row">{formatPeriodLabel(m.period)}</th>
                <td>{formatUsd(m.cents)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </figure>
  );
}
