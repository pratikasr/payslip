"use client";

import Link from "next/link";
import { Fragment, useState, type ReactNode } from "react";
import { ArrowRight, ChevronRight, CircleCheck, TriangleAlert } from "lucide-react";
import { Coin, Usd, Zec } from "@/components/app/amount";
import { Tag } from "@/components/ds/tag";
import { RateValue, RunDetail } from "@/components/books/run-detail";
import {
  differenceOf,
  exceptionsOf,
  paidDateOf,
  sortRuns,
  statusView,
  totalsOf,
  type BooksResult,
  type BooksTotals,
} from "@/components/books/books-data";
import type { ReconciliationRun } from "@/lib/api";
import { formatCount, formatDate, formatPeriodLabel } from "@/lib/format";
import { cn } from "cn";

export function ReconciliationView({ r }: { r: BooksResult }) {
  const runs = sortRuns(r);
  const totals = totalsOf(r);
  return (
    <div className="grid gap-6">
      <StatusBanner r={r} runs={runs} />
      {r.treasury_key_present === false ? (
        <p role="status" className="rounded-xl border border-warning/30 bg-warning-bg px-4 py-3 text-sm text-strong">
          The Treasury viewing key is not loaded, so funding cannot be read. Add it from Manage in the sidebar.
        </p>
      ) : null}
      <KpiRow t={totals} runs={r.runs.length} />
      {runs.length === 0 ? (
        <p className="border-y border-hairline py-10 text-center text-[0.9375rem] text-muted-foreground">
          No runs paid in this period. Choose another period above.
        </p>
      ) : (
        <section aria-labelledby="runs-heading" className="min-w-0">
          <h2 id="runs-heading" className="mb-2 text-[1.1875rem] font-normal tracking-[-0.01em]">
            Runs
          </h2>
          <RunsTable r={r} runs={runs} t={totals} />
          <RunsList r={r} runs={runs} />
          {totals.unrecorded > 0 ? (
            <p className="mt-3 text-[0.8125rem] text-muted-foreground">
              The total difference includes <Usd cents={-totals.unrecorded} /> paid by runs with no funding record.
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}

/* ---------- Headline ---------- */

function StatusBanner({ r, runs }: { r: BooksResult; runs: ReconciliationRun[] }) {
  const reconciled = runs.filter((run) => run.status === "reconciled").length;
  const rounding = runs.filter((run) => run.status === "reconciled" && (differenceOf(run) ?? 0) !== 0).length;
  const ex = exceptionsOf(r);
  const all = runs.length > 0 && reconciled === runs.length;
  const problems: string[] = [];
  if (ex.noFunding.length)
    problems.push(`${ex.noFunding.length} ${ex.noFunding.length === 1 ? "run has" : "runs have"} no funding record`);
  if (ex.unexplained.length)
    problems.push(
      `${ex.unexplained.length} ${ex.unexplained.length === 1 ? "run has" : "runs have"} an unexplained variance`,
    );
  if (ex.incomplete.length)
    problems.push(`${ex.incomplete.length} ${ex.incomplete.length === 1 ? "run is" : "runs are"} not fully mined`);
  const severe = ex.unexplained.length > 0;
  const headline =
    runs.length === 0
      ? "No runs in this period"
      : all
        ? "Every run reconciled"
        : `${formatCount(reconciled)} of ${formatCount(runs.length)} runs reconciled`;
  return (
    <div
      role="status"
      data-testid="books-headline"
      className={cn(
        "flex flex-col gap-3 rounded-xl border px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5",
        all || runs.length === 0
          ? "bg-raised"
          : severe
            ? "border-destructive/25 bg-danger-bg"
            : "border-warning/30 bg-warning-bg",
      )}
    >
      <div className="flex items-start gap-3">
        {all ? (
          <CircleCheck className="mt-0.5 size-6 shrink-0 text-success" aria-hidden="true" />
        ) : runs.length === 0 ? null : (
          <TriangleAlert
            className={cn("mt-0.5 size-6 shrink-0", severe ? "text-destructive" : "text-warning")}
            aria-hidden="true"
          />
        )}
        <div>
          <p className="text-[1.375rem] leading-tight font-[380] tracking-[-0.01em]">{headline}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {runs.length === 0
              ? "Payments are matched to runs by their memo; none were mined in this period."
              : all
                ? rounding
                  ? `Funded minus paid equals fees and unspent coin at each run's rate. ${rounding} ${rounding === 1 ? "run differs" : "runs differ"} by a cent of rounding, shown under Difference.`
                  : "Funded minus paid equals fees and unspent coin at each run's rate, to the cent."
                : `${problems.join(", ")}.`}
          </p>
        </div>
      </div>
      {!all && ex.total > 0 ? (
        <Link
          href="/books/exceptions"
          className="inline-flex shrink-0 items-center gap-1 self-start rounded-sm text-sm text-link underline-offset-4 hover:underline sm:self-center"
        >
          Review exceptions
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

/* ---------- KPIs ---------- */

function Kpi({ label, value, sub, testId }: { label: ReactNode; value: ReactNode; sub: ReactNode; testId: string }) {
  return (
    <div className="min-w-0 px-4 py-4 sm:px-5" data-testid={testId}>
      <dt className="text-[0.8125rem] text-muted-foreground">{label}</dt>
      <dd className="mt-1">
        <div className="figure text-[1.375rem] leading-tight font-[380] tracking-[-0.01em]">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
      </dd>
    </div>
  );
}

function KpiRow({ t, runs }: { t: BooksTotals; runs: number }) {
  const unexplainedParts: ReactNode[] = [];
  if (t.rounding !== 0)
    unexplainedParts.push(
      <span key="r">
        <Usd cents={t.rounding} /> rounding
      </span>,
    );
  if (t.unexplainedRuns !== 0)
    unexplainedParts.push(
      <span key="u">
        <Usd cents={t.unexplainedRuns} /> unexplained
      </span>,
    );
  if (t.incompleteRuns !== 0)
    unexplainedParts.push(
      <span key="i">
        <Usd cents={t.incompleteRuns} /> in runs not fully mined
      </span>,
    );
  if (t.unrecorded !== 0)
    unexplainedParts.push(
      <span key="n">
        <Usd cents={-t.unrecorded} /> with no funding record
      </span>,
    );
  const material = Math.abs(t.unexplained - t.rounding) > 0;
  return (
    <dl
      className="grid grid-cols-2 divide-hairline overflow-hidden rounded-xl border bg-card max-lg:[&>*:nth-child(n+3)]:border-t max-lg:[&>*:nth-child(even)]:border-l max-lg:[&>*:last-child]:col-span-2 max-lg:[&>*:last-child]:border-l-0 lg:grid-cols-5 lg:divide-x"
      aria-label="Totals for the period"
    >
      <Kpi
        testId="kpi-funded"
        label="Funded"
        value={<Usd cents={t.funded} />}
        sub={
          <>
            <Zec zat={t.zecAcquired} short /> acquired
          </>
        }
      />
      <Kpi
        testId="kpi-paid"
        label="Paid"
        value={<Usd cents={t.paid} />}
        sub={`${formatCount(t.payments)} ${t.payments === 1 ? "payment" : "payments"} in ${formatCount(runs)} ${runs === 1 ? "run" : "runs"}`}
      />
      <Kpi testId="kpi-variance" label="Variance" value={<Usd cents={t.variance} />} sub="Funded minus paid" />
      <Kpi
        testId="kpi-explained"
        label="Explained"
        value={<Usd cents={t.explained} />}
        sub={
          <>
            Fees and unspent <Coin /> at the fill rate
          </>
        }
      />
      <Kpi
        testId="kpi-unexplained"
        label="Unexplained"
        value={<Usd cents={t.unexplained} className={cn(material && "text-destructive")} />}
        sub={unexplainedParts.length ? <span className="grid">{unexplainedParts}</span> : "Variance minus explained"}
      />
    </dl>
  );
}

/* ---------- Runs table (tablet and up) ---------- */

const TH =
  "h-10 px-[7px] first:pl-1 last:pr-0 text-left align-bottom pb-2 text-[0.8125rem] font-normal whitespace-nowrap text-muted-foreground";
const TD = "px-[7px] first:pl-1 last:pr-0 py-3 align-top whitespace-nowrap";

function DiffValue({ run }: { run: ReconciliationRun }) {
  const diff = differenceOf(run);
  if (diff === null) return <span className="text-muted-foreground">None</span>;
  return (
    <Usd
      cents={diff}
      className={cn(
        run.status === "variance_unexplained" ? "text-destructive" : diff === 0 ? "text-muted-foreground" : "",
      )}
    />
  );
}

function StatusTag({ run, wrap }: { run: ReconciliationRun; wrap?: boolean }) {
  const s = statusView(run);
  return (
    <span title={s.help} className="inline-block">
      <Tag tone={s.tone} className={cn(wrap && "h-auto max-w-[7rem] py-[3px] leading-[1.3] whitespace-normal")}>
        {s.label}
      </Tag>
    </span>
  );
}

function Stack({ top, bottom }: { top: ReactNode; bottom?: ReactNode }) {
  return (
    <>
      <div>{top}</div>
      {bottom ? <div className="mt-0.5 text-xs text-muted-foreground">{bottom}</div> : null}
    </>
  );
}

function RunsTable({ r, runs, t }: { r: BooksResult; runs: ReconciliationRun[]; t: BooksTotals }) {
  const [open, setOpen] = useState<string | null>(null);
  const testnet = r.network === "testnet";
  const reconciled = runs.filter((run) => run.status === "reconciled").length;
  const columns = 10;
  return (
    <div
      className="hidden overflow-x-auto xl:block xl:overflow-visible"
      role="region"
      aria-label="Runs, funded against paid"
      tabIndex={0}
    >
      <table className="w-full min-w-[900px] border-collapse text-[0.9375rem]" data-testid="books-runs">
        <thead>
          <tr className="border-b border-hairline">
            <th scope="col" className={TH}>
              Run
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Funded
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Rate
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Paid
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Fees
              <span className="block text-[0.6875rem] text-faint">
                in <Coin />
              </span>
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Unspent
              <span className="block text-[0.6875rem] text-faint">
                in <Coin />
              </span>
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Variance
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Explained
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Difference
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const isOpen = open === run.run_id;
            const detailId = `run-detail-${run.run_id}`;
            const paidOn = paidDateOf(r, run.run_id);
            const toggle = () => setOpen(isOpen ? null : run.run_id);
            return (
              <Fragment key={run.run_id}>
                <tr
                  className={cn(
                    "cursor-pointer border-b border-hairline transition-colors hover:bg-muted/60",
                    isOpen && "bg-muted/60",
                  )}
                  onClick={toggle}
                  data-testid="books-run-row"
                >
                  <td className={TD}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle();
                      }}
                      aria-expanded={isOpen}
                      aria-controls={detailId}
                      className="-mx-1 flex items-start gap-1.5 rounded-md px-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <ChevronRight
                        className={cn(
                          "mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform",
                          isOpen && "rotate-90",
                        )}
                        aria-hidden="true"
                      />
                      <span>
                        <span className="block">{formatPeriodLabel(run.period)}</span>
                        <span className="num block text-xs text-muted-foreground">
                          {run.lines + (run.pending_lines ?? 0)} paid
                          {paidOn ? ` · ${formatDate(paidOn).replace(/ \d{4}$/, "")}` : ""}
                          <span className="sr-only">, run {run.run_id.slice(0, 8)}</span>
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className={cn(TD, "text-right")}>
                    {run.funded_usd_cents === null ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      <Stack top={<Usd cents={run.funded_usd_cents} />} bottom={<Zec zat={run.zec_acquired_zat} />} />
                    )}
                  </td>
                  <td className={cn(TD, "text-right")}>
                    <RateValue e6={run.rate_usd_per_zec_e6} testnet={testnet} />
                  </td>
                  <td className={cn(TD, "text-right")}>
                    <Stack top={<Usd cents={run.paid_usd_cents} />} bottom={<Zec zat={run.paid_zat} />} />
                  </td>
                  <td className={cn(TD, "text-right text-[0.8125rem]")}>
                    <Zec zat={run.network_fees_zat} unit={false} />
                  </td>
                  <td className={cn(TD, "text-right text-[0.8125rem]")}>
                    {run.unspent_zat === null ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      <Zec zat={run.unspent_zat} unit={false} />
                    )}
                  </td>
                  <td className={cn(TD, "text-right")}>
                    {run.variance_usd_cents === null ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      <Usd cents={run.variance_usd_cents} />
                    )}
                  </td>
                  <td className={cn(TD, "text-right")}>
                    {run.explained_usd_cents === null ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      <Usd cents={run.explained_usd_cents} />
                    )}
                  </td>
                  <td className={cn(TD, "text-right")}>
                    <DiffValue run={run} />
                  </td>
                  <td className={TD}>
                    <StatusTag run={run} wrap />
                  </td>
                </tr>
                {isOpen ? (
                  <tr id={detailId} className="border-b border-hairline bg-raised/70">
                    <td colSpan={columns} className="px-4 py-5 whitespace-normal sm:px-6">
                      <RunDetail r={r} run={run} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr
            className="sticky bottom-0 z-10 bg-background shadow-[0_-1px_0_var(--border)]"
            data-testid="books-runs-total"
          >
            <th scope="row" className={cn(TD, "text-left font-[450]")}>
              Total
            </th>
            <td className={cn(TD, "text-right font-[450]")}>
              <Stack top={<Usd cents={t.funded} />} bottom={<Zec zat={t.zecAcquired} />} />
            </td>
            <td className={TD} />
            <td className={cn(TD, "text-right font-[450]")}>
              <Stack top={<Usd cents={t.paid} />} bottom={<Zec zat={t.paidZat} />} />
            </td>
            <td className={cn(TD, "text-right text-[0.8125rem]")}>
              <Zec zat={t.feesZat} unit={false} />
            </td>
            <td className={cn(TD, "text-right text-[0.8125rem]")}>
              <Zec zat={t.unspentZat} unit={false} />
            </td>
            <td className={cn(TD, "text-right font-[450]")}>
              <Usd cents={t.variance} />
            </td>
            <td className={cn(TD, "text-right font-[450]")}>
              <Usd cents={t.explained} />
            </td>
            <td className={cn(TD, "text-right font-[450]")}>
              <Usd
                cents={t.unexplained}
                className={cn(Math.abs(t.unexplained - t.rounding) > 0 && "text-destructive")}
              />
            </td>
            <td className={cn(TD, "text-[0.8125rem] text-muted-foreground")}>
              {reconciled} of {runs.length} reconciled
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ---------- Runs list (phones) ---------- */

function RunsList({ r, runs }: { r: BooksResult; runs: ReconciliationRun[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="divide-y divide-hairline border-y border-hairline xl:hidden" aria-label="Runs, funded against paid">
      {runs.map((run) => {
        const isOpen = open === run.run_id;
        const detailId = `run-detail-m-${run.run_id}`;
        const paidOn = paidDateOf(r, run.run_id);
        return (
          <li key={run.run_id}>
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : run.run_id)}
              aria-expanded={isOpen}
              aria-controls={detailId}
              className="grid w-full gap-2.5 py-3.5 text-left focus-visible:outline-2 focus-visible:outline-ring"
              data-testid="books-run-item"
            >
              <span className="flex items-start justify-between gap-3">
                <span className="flex items-start gap-1.5">
                  <ChevronRight
                    className={cn(
                      "mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform",
                      isOpen && "rotate-90",
                    )}
                    aria-hidden="true"
                  />
                  <span>
                    <span className="block text-[0.9375rem]">{formatPeriodLabel(run.period)}</span>
                    <span className="num block text-xs text-muted-foreground">
                      {run.lines + (run.pending_lines ?? 0)} paid
                      {paidOn ? ` · ${formatDate(paidOn)}` : ""}
                    </span>
                  </span>
                </span>
                <StatusTag run={run} />
              </span>
              <span className="grid grid-cols-2 gap-x-4 gap-y-1.5 pl-5 text-sm">
                <MiniStat
                  label="Funded"
                  value={run.funded_usd_cents === null ? null : <Usd cents={run.funded_usd_cents} />}
                />
                <MiniStat label="Paid" value={<Usd cents={run.paid_usd_cents} />} />
                <MiniStat
                  label="Variance"
                  value={run.variance_usd_cents === null ? null : <Usd cents={run.variance_usd_cents} />}
                />
                <MiniStat label="Difference" value={<DiffValue run={run} />} />
              </span>
            </button>
            {isOpen ? (
              <div id={detailId} className="mb-4 rounded-xl bg-raised px-4 py-4">
                <RunDetail r={r} run={run} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function MiniStat({ label, value }: { label: string; value: ReactNode | null }) {
  return (
    <span className="flex items-baseline justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      {value ?? <span className="text-muted-foreground">None</span>}
    </span>
  );
}
