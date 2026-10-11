"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpenCheck, Download, KeyRound } from "lucide-react";
import { Fiat, Usd, Zec } from "@/components/app/amount";
import { useHealth } from "@/components/app/health-provider";
import { ErrorState } from "@/components/app/states";
import { PageTitle, SectionHeader } from "@/components/ds/page";
import { DOT, FormBox } from "@/components/portal/paper-parts";
import { PayslipRows } from "@/components/portal/payslip-rows";
import { firstName, monthDay, newestFirst, payslipHref } from "@/components/portal/portal-data";
import { usePersonName, usePortal } from "@/components/portal/portal-provider";
import { RowsSkeleton, ScanProgress, SettlementTag, SimulatedRate } from "@/components/portal/portal-states";
import { ShareProofDialog } from "@/components/portal/share-proof-dialog";
import { useSampleCompany } from "@/components/shell/sample-tag";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { Statement, StatementLine } from "@/lib/api";
import { SAMPLE_COMPANY_LINE, companyMark, companyName } from "@/lib/company";
import { formatPeriodLabel } from "@/lib/format";
import { cn } from "cn";
import { TYPE } from "@/components/ds/type";

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
            <Skeleton className="h-[220px] rounded-none border-2 border-foreground bg-transparent" />
            <RowsSkeleton />
          </div>
        )}
      </>
    );
  }
  return <HomeBody statement={s} />;
}

/**
 * Who paid: the company under the welcome, with its mark, and on testnet the line that says the
 * company is a sample. The Treasury key is the company's own, so it gets no "paid to you".
 */
function PaidBy({ treasury }: { treasury: boolean }) {
  const sample = useSampleCompany();
  const Mark = companyMark();
  if (treasury && !sample) return null;
  return (
    <>
      {treasury ? null : (
        <span className="flex items-center gap-1.5" data-testid="portal-paid-by">
          <Mark className="size-4 shrink-0 text-foreground" />
          <span>Paid to you by {companyName()}</span>
        </span>
      )}
      {sample ? (
        <span className="block text-[0.8125rem]" data-testid="portal-sample-line">
          {SAMPLE_COMPANY_LINE}
        </span>
      ) : null}
    </>
  );
}

function Scope() {
  return (
    <p className="mb-6 flex items-start gap-2.5 border-l-2 border-foreground py-0.5 pl-3 text-[0.8125rem] text-muted-foreground">
      <KeyRound className="mt-0.5 size-4 shrink-0 text-foreground" aria-hidden="true" />
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
      className="carbon-paper mb-6 flex flex-col gap-3 border border-carbon-line px-4 py-3.5 text-[0.8125rem] sm:flex-row sm:items-center sm:justify-between"
    >
      <span className="text-strong">
        This is the company&apos;s Treasury key. It reads the payroll account, not one person&apos;s pay, so it has no
        payslips. Open it in Books with the contractors&apos; keys to reconcile each run.
      </span>
      <Link
        href="/books"
        className="inline-flex shrink-0 items-center gap-1.5 font-type font-bold text-link underline underline-offset-4"
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
  return (
    <>
      <PageTitle
        title={first ? `Welcome, ${first}` : "Welcome"}
        description={<PaidBy treasury={s.account.role === "treasury"} />}
      />
      {s.account.role === "treasury" ? <TreasuryKeyNote /> : <Scope />}
      {recent.error ? <ErrorState error={recent.error} onRetry={reload} className="mb-5" /> : null}
      {recent.loading ? (
        <div className="mb-5">
          <ScanProgress startedAt={recent.startedAt} title="Refreshing your payments" />
        </div>
      ) : null}

      <StatementOfEarnings statement={s} pending={pending.length > 0} />

      <SectionHeader title="Payslips" id="payslips-heading" className="mt-12">
        <Button asChild variant="secondary" size="sm">
          <Link href="/portal/tax">
            <Download aria-hidden="true" />
            Download for tax
          </Link>
        </Button>
        {lines.length > LATEST ? (
          <Link
            href="/portal/payslips"
            className="ml-auto inline-flex items-center font-type text-[0.9375rem] text-link underline decoration-1 underline-offset-[3px] hover:decoration-2"
          >
            View all
          </Link>
        ) : null}
      </SectionHeader>
      {lines.length + pending.length === 0 ? (
        <p className="border-y-2 border-foreground py-6 text-[0.9375rem] text-muted-foreground">
          Payslips appear here when your payer runs payroll and the payment is mined on Zcash.
        </p>
      ) : (
        <PayslipRows lines={lines.slice(0, LATEST)} pending={pending} onShare={setSharing} label="Latest payslips" />
      )}
      <ShareProofDialog line={sharing} onOpenChange={(open) => !open && setSharing(null)} />
    </>
  );
}

/**
 * The year's statement of earnings, as a typewritten form: what was paid this year in dot matrix,
 * the last payment beside it, then a green-bar line for each pay period paid this year and the
 * total under them. On mainnet the value when each payment arrived can be shown in the person's
 * own currency.
 */
function StatementOfEarnings({ statement: s, pending }: { statement: Statement; pending: boolean }) {
  const { currency } = usePortal();
  const { health } = useHealth();
  const [unit, setUnit] = useState<"usd" | "local">("usd");
  const year = new Date().getUTCFullYear();
  const ytd = s.lines.filter((l) => l.date.startsWith(`${year}-`));
  const usd = ytd.reduce((n, l) => n + l.usd_basis_cents, 0);
  const zat = ytd.reduce((n, l) => n + l.amount_zat, 0);
  const cur = currency.toUpperCase();
  const priced = ytd.filter((l) => l.market && l.market.currency === cur);
  const market = priced.reduce((n, l) => n + (l.market?.value_cents ?? 0), 0);
  const mainnet = s.network === "mainnet";
  const showMarket = mainnet && health?.market_prices !== false && !!s.market?.available && priced.length > 0;
  const toggle = showMarket && cur !== "USD";
  const local = toggle && unit === "local";
  const last = latestPaid(s.lines);

  return (
    <FormBox
      title="Statement of earnings"
      titleId="earnings-title"
      label={`Year to date, ${year}`}
      bodyClassName="p-0 sm:p-0"
    >
      <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section aria-labelledby="paid-this-year" className="min-w-0 px-4 py-5 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="paid-this-year" className={TYPE.label}>
              Paid to you in {year}
            </h3>
            {toggle ? (
              <div className="inline-flex border-2 border-foreground" role="group" aria-label="Show amounts in">
                {(["usd", "local"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    aria-pressed={unit === u}
                    onClick={() => setUnit(u)}
                    className={cn(
                      "h-7 min-w-11 px-2 font-type text-[0.8125rem] font-bold transition-colors hover:bg-muted",
                      unit === u && "bg-foreground text-background hover:bg-foreground",
                    )}
                  >
                    {u === "usd" ? "USD" : cur}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className={cn(TYPE.hero, "mt-4")}>
            {local ? <Fiat cents={market} currency={cur} /> : <Usd cents={usd} />}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 font-type text-[0.8125rem]">
            <span>
              <Zec zat={zat} short /> received
            </span>
            {showMarket ? (
              local ? (
                <span className="text-muted-foreground">
                  agreed <Usd cents={usd} />
                </span>
              ) : (
                <span className="text-success">
                  worth <Fiat cents={market} currency={cur} /> on arrival
                </span>
              )
            ) : mainnet ? null : (
              <SimulatedRate />
            )}
          </div>
        </section>

        <section
          aria-labelledby="last-payment"
          className="min-w-0 border-t border-foreground px-4 py-5 sm:px-5 lg:border-t-0 lg:border-l"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 id="last-payment" className={TYPE.label}>
              Last payment
            </h3>
            {last ? <SettlementTag line={last} /> : null}
          </div>
          {last ? (
            <>
              <div className={cn(DOT, "mt-4 text-[1.75rem] lg:text-[2.125rem]")}>
                <Usd cents={last.usd_basis_cents} />
              </div>
              <p className="mt-3 font-type text-[0.8125rem] leading-[1.5] text-pretty text-muted-foreground">
                Paid {monthDay(last.block_time ?? last.date)}, for {formatPeriodLabel(last.period)}, invoice{" "}
                <span className="text-foreground">{last.invoice_ref}</span>
              </p>
              <Link
                href={payslipHref(last)}
                className="mt-2 inline-flex font-type text-[0.9375rem] font-bold text-link underline decoration-1 underline-offset-[3px] hover:decoration-2"
                aria-label={`Open the payslip for ${formatPeriodLabel(last.period)}`}
              >
                Open the payslip
              </Link>
            </>
          ) : (
            <p className="mt-3 text-[0.9375rem] text-muted-foreground">
              {pending
                ? "Your first payment is on its way and appears here once its block is mined."
                : "No payments in the last 12 months."}
            </p>
          )}
        </section>
      </div>

      {ytd.length === 0 ? (
        <p className="border-t border-foreground px-4 py-4 text-[0.8125rem] text-muted-foreground sm:px-5">
          No payments yet this year.
        </p>
      ) : (
        <ByPeriod lines={ytd} year={year} totalCents={usd} totalZat={zat} />
      )}
    </FormBox>
  );
}

/** One green-bar line per pay period paid this year, newest first, and the year's total in dot matrix. */
function ByPeriod({
  lines,
  year,
  totalCents,
  totalZat,
}: {
  lines: StatementLine[];
  year: number;
  totalCents: number;
  totalZat: number;
}) {
  const periods = new Map<string, { cents: number; zat: number; count: number }>();
  for (const l of lines) {
    const p = periods.get(l.period) ?? { cents: 0, zat: 0, count: 0 };
    periods.set(l.period, { cents: p.cents + l.usd_basis_cents, zat: p.zat + l.amount_zat, count: p.count + 1 });
  }
  const rows = [...periods.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  return (
    <table className="w-full border-collapse border-t border-foreground text-[0.875rem] sm:text-[0.9375rem]">
      <caption className="sr-only">Paid to you in {year}, by pay period</caption>
      <thead>
        <tr className="border-b border-foreground">
          <th scope="col" className="py-2 pr-3 pl-4 text-left text-[0.75rem] font-bold sm:pl-5">
            Pay period
          </th>
          <th scope="col" className="hidden py-2 pr-3 text-right text-[0.75rem] font-bold sm:table-cell">
            Payments
          </th>
          <th scope="col" className="hidden py-2 pr-3 text-right text-[0.75rem] font-bold md:table-cell">
            Received
          </th>
          <th scope="col" className="py-2 pr-4 text-right text-[0.75rem] font-bold sm:pr-5">
            Amount
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([period, p]) => (
          <tr key={period} className="border-b border-bar-line">
            <th scope="row" className="py-2 pr-3 pl-4 text-left font-normal uppercase sm:pl-5">
              {formatPeriodLabel(period)}
            </th>
            <td className="hidden py-2 pr-3 text-right sm:table-cell">{p.count}</td>
            <td className="hidden py-2 pr-3 text-right md:table-cell">
              <Zec zat={p.zat} />
            </td>
            <td className="py-2 pr-4 text-right sm:pr-5">
              <Usd cents={p.cents} />
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t-2 border-foreground">
          <th
            scope="row"
            className="py-3 pr-3 pl-4 text-left text-[0.75rem] font-bold tracking-[0.08em] uppercase sm:pl-5"
          >
            Total {year}
          </th>
          <td className="hidden py-3 pr-3 text-right sm:table-cell">{lines.length}</td>
          <td className="hidden py-3 pr-3 text-right md:table-cell">
            <Zec zat={totalZat} />
          </td>
          <td className="py-3 pr-4 text-right sm:pr-5">
            <span className={cn(DOT, "text-[1.25rem]")}>
              <Usd cents={totalCents} />
            </span>
          </td>
        </tr>
      </tfoot>
    </table>
  );
}
