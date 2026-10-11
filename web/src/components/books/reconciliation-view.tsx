"use client";

import Link from "next/link";
import { Fragment, useState, type ReactNode } from "react";
import { ChevronRight, Info } from "lucide-react";
import { Coin, Usd, Zec } from "@/components/app/amount";
import { RunDetail } from "@/components/books/run-detail";
import { DOT, FormHead, MarkStamp, StatusStamp } from "@/components/portal/paper-parts";
import {
  differenceOf,
  exceptionsOf,
  hasTreasuryKey,
  paidDateOf,
  sortRuns,
  statusView,
  totalsOf,
  type BooksResult,
  type BooksRun,
  type BooksTotals,
} from "@/components/books/books-data";
import { useBooks } from "@/components/books/books-provider";
import { formatCount, formatDate, formatHeight, formatPeriodLabel, formatUsd } from "@/lib/format";
import { cn } from "cn";
import { TYPE } from "@/components/ds/type";

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

export function ReconciliationView({ r }: { r: BooksResult }) {
  const { keys, scan } = useBooks();
  const runs = sortRuns(r);
  const totals = totalsOf(r);
  const testnet = r.network === "testnet";
  const from = r.scanned_from_height ?? scan.birthday;
  return (
    <div className="grid gap-7">
      <div className="grid gap-3">
        <StatusBanner r={r} runs={runs} t={totals} />
        {testnet && runs.length > 0 ? (
          <p
            className="flex items-start gap-2 px-1 text-[0.8125rem] text-muted-foreground"
            data-testid="books-testnet-note"
          >
            <Info className="mt-0.5 size-3.5 shrink-0 text-foreground" aria-hidden="true" />
            <span>
              Testnet: payroll dollars convert at a simulated rate so faucet coins can carry a demo payroll.
              {runs.every((run) => run.status === "reconciled")
                ? " The variance is network fees and coin left in the treasury, valued at that rate; no money was lost."
                : " Variance and explained amounts are valued at that rate."}
            </span>
          </p>
        ) : null}
      </div>
      {runs.length > 0 && !totals.fundingKnown ? (
        <p role="status" className="carbon-paper border border-carbon-line px-4 py-3 text-[0.8125rem] text-strong">
          {hasTreasuryKey(r, keys)
            ? "No funding record was found for these runs in this period, so what was funded cannot be read. A run's record is written the day it starts paying; widen the period to include that day."
            : "No funding record was found, so what was funded cannot be read. Load the Treasury viewing key from Manage in the sidebar."}
        </p>
      ) : null}
      <KpiRow t={totals} runs={r.runs.length} testnet={testnet} />
      {runs.length === 0 ? (
        <div className="border-y-2 border-foreground py-8 text-[0.9375rem] text-muted-foreground">
          <p>No runs paid in this period. Choose another period above.</p>
          {from ? (
            <p className="mt-2 max-w-md text-[0.8125rem]">
              These keys were read from block <span className="font-type">{formatHeight(from)}</span> on. If they were
              paid earlier, import the company&apos;s key file: it names the block to start from.
            </p>
          ) : null}
        </div>
      ) : (
        <section aria-labelledby="runs-heading" className="min-w-0">
          <FormHead title="Runs" id="runs-heading" label="Funded against paid" className="mb-3" />
          <RunsTable r={r} runs={runs} t={totals} />
          <RunsList r={r} runs={runs} />
          {totals.unrecorded > 0 ? (
            <p className="mt-3 text-[0.8125rem] text-muted-foreground">
              The total difference includes{" "}
              <span className="font-type">
                <Usd cents={-totals.unrecorded} />
              </span>{" "}
              paid by runs with no funding record.
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}

/* ---------- Headline ---------- */

function StatusBanner({ r, runs, t }: { r: BooksResult; runs: BooksRun[]; t: BooksTotals }) {
  const reconciled = runs.filter((run) => run.status === "reconciled").length;
  const roundingRuns = runs.filter((run) => run.status === "reconciled" && (differenceOf(run) ?? 0) !== 0);
  const maxRounding = Math.max(0, ...roundingRuns.map((run) => Math.abs(differenceOf(run) ?? 0)));
  const ex = exceptionsOf(r);
  const all = runs.length > 0 && reconciled === runs.length;
  const problems: string[] = [];
  if (ex.missingKeys.length)
    problems.push(
      `${plural(ex.missingKeys.length, "run paid", "runs paid")} accounts whose keys are not loaded, so those payments cannot be seen`,
    );
  if (ex.unpaid.length)
    problems.push(`${plural(ex.unpaid.length, "run has", "runs have")} a funded account with no payment`);
  if (ex.noFunding.length) problems.push(`${plural(ex.noFunding.length, "run has", "runs have")} no funding record`);
  if (ex.unexplained.length)
    problems.push(`${plural(ex.unexplained.length, "run has", "runs have")} an unexplained variance`);
  if (ex.incomplete.length) problems.push(`${plural(ex.incomplete.length, "run is", "runs are")} not fully mined`);
  if (ex.other.length)
    problems.push(`${plural(ex.other.length, "run has", "runs have")} a status this version of Books does not know`);
  const severe = ex.unexplained.length > 0 || ex.unpaid.length > 0;
  const paid = formatUsd(t.paid);
  const headline =
    runs.length === 0
      ? "No runs in this period"
      : all
        ? `${plural(runs.length, "run", "runs")}, ${paid} paid, every dollar accounted for`
        : `${formatCount(reconciled)} of ${plural(runs.length, "run", "runs")} reconciled, ${paid} paid`;
  const rounding = roundingRuns.length
    ? ` ${plural(roundingRuns.length, "run differs", "runs differ")} by ${maxRounding === 1 ? "a cent" : `up to ${maxRounding} cents`} of rounding, within the allowance, shown under Difference.`
    : "";
  const review =
    ex.total > 0 ? (
      <Link
        href="/books/exceptions"
        className="inline-flex shrink-0 items-center gap-1 font-type text-[0.8125rem] font-bold text-link underline underline-offset-4"
      >
        {all
          ? ex.unlabelled.length === 1
            ? "1 unlabelled transaction to review"
            : `${formatCount(ex.unlabelled.length)} unlabelled transactions to review`
          : "Review exceptions"}
      </Link>
    ) : null;
  // The stamp the accountant would put on the page: what the period comes to, in a word.
  const stamp =
    runs.length === 0
      ? null
      : all
        ? { text: "Reconciled", tone: "ink" as const }
        : ex.missingKeys.length
          ? { text: "Keys missing", tone: "red" as const }
          : severe
            ? { text: "Not reconciled", tone: "red" as const }
            : { text: "Open items", tone: "soft" as const };
  return (
    <div
      role="status"
      data-testid="books-headline"
      className="flex flex-col gap-4 border-2 border-foreground px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
    >
      <div className="flex min-w-0 flex-col-reverse gap-3 sm:flex-row sm:items-center sm:gap-5">
        <div className="min-w-0">
          <p className="font-type text-[1rem] leading-snug font-bold text-balance sm:text-[1.0625rem]">{headline}</p>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            {runs.length === 0
              ? "Payments are matched to runs by their memo; none were mined in this period."
              : all
                ? `Funded minus paid equals network fees and unspent coin at each run's rate.${rounding}`
                : `${problems.join("; ")}.`}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 sm:flex-col sm:items-end">
        {stamp ? <MarkStamp text={stamp.text} tone={stamp.tone} className="mr-1" /> : null}
        {review}
      </div>
    </div>
  );
}

/* ---------- KPIs ---------- */

/** A total of the period: its label in spaced caps, the figure in dot matrix, how it is made up typed under it. */
function Kpi({ label, value, sub, testId }: { label: ReactNode; value: ReactNode; sub: ReactNode; testId: string }) {
  return (
    <div className="min-w-0 px-3 py-4 sm:px-4" data-testid={testId}>
      <dt className={TYPE.label}>{label}</dt>
      <dd className="mt-2.5">
        <div className={cn(DOT, "text-[1.375rem] sm:text-[1.5rem]")}>{value}</div>
        <div className="mt-2 font-type text-[0.8125rem] leading-[1.45] text-muted-foreground">{sub}</div>
      </dd>
    </div>
  );
}

const NotRecorded = () => <span className="font-type text-[0.9375rem] text-muted-foreground">Not recorded</span>;

function KpiRow({ t, runs, testnet }: { t: BooksTotals; runs: number; testnet: boolean }) {
  const unexplainedParts: ReactNode[] = [];
  const part = (key: string, cents: number, text: string) =>
    cents !== 0
      ? unexplainedParts.push(
          <span key={key}>
            <Usd cents={cents} /> {text}
          </span>,
        )
      : 0;
  part("r", t.rounding, "rounding");
  part("u", t.unexplainedRuns, "unexplained");
  part("i", t.incompleteRuns, "in runs not fully mined");
  part("k", t.missingKeyRuns, "in runs with keys missing");
  part("p", t.unpaidRuns, "in runs with an unpaid account");
  part("n", -t.unrecorded, "with no funding record");
  const material = Math.abs(t.unexplained - t.rounding) > 0;
  return (
    <dl
      className="grid grid-cols-2 divide-rule border-y-2 border-foreground max-lg:[&>*:last-child]:col-span-2 max-lg:[&>*:last-child]:border-l-0 max-lg:[&>*:nth-child(even)]:border-l max-lg:[&>*:nth-child(n+3)]:border-t lg:grid-cols-5 lg:divide-x"
      aria-label="Totals for the period"
    >
      <Kpi
        testId="kpi-funded"
        label="Funded"
        value={t.fundingKnown ? <Usd cents={t.funded} /> : <NotRecorded />}
        sub={
          t.fundingKnown ? (
            <>
              <Zec zat={t.zecAcquired} short /> acquired{testnet ? " at the simulated rate" : ""}
            </>
          ) : (
            "No funding record in the period"
          )
        }
      />
      <Kpi
        testId="kpi-paid"
        label="Paid"
        value={<Usd cents={t.paid} />}
        sub={`${plural(t.payments, "payment", "payments")} in ${plural(runs, "run", "runs")}`}
      />
      <Kpi
        testId="kpi-variance"
        label="Variance"
        value={t.fundingKnown ? <Usd cents={t.variance} /> : <NotRecorded />}
        sub={testnet ? "Funded minus paid, still held as coin" : "Funded minus paid"}
      />
      <Kpi
        testId="kpi-explained"
        label="Explained"
        value={t.fundingKnown ? <Usd cents={t.explained} /> : <NotRecorded />}
        sub={
          testnet ? (
            <>
              <Zec zat={t.feesZat} /> fees and <Zec zat={t.unspentZat} /> unspent, at the simulated rate
            </>
          ) : (
            <>
              Network fees and unspent <Coin /> at the fill rate
            </>
          )
        }
      />
      <Kpi
        testId="kpi-unexplained"
        label="Unexplained"
        value={
          t.fundingKnown ? (
            <Usd cents={t.unexplained} className={cn(material && "text-destructive")} />
          ) : (
            <NotRecorded />
          )
        }
        sub={
          !t.fundingKnown ? (
            "Needs a funding record"
          ) : unexplainedParts.length ? (
            <span className="grid">{unexplainedParts}</span>
          ) : (
            "Variance minus explained"
          )
        }
      />
    </dl>
  );
}

/* ---------- Runs table (wide screens) ---------- */

const TH = "h-10 px-[7px] first:pl-2 last:pr-2 text-left align-bottom py-2 text-[0.75rem] font-bold whitespace-nowrap";
const TD = "px-[7px] first:pl-2 last:pr-2 py-3 align-top whitespace-nowrap";

function DiffValue({ run, note = true }: { run: BooksRun; note?: boolean }) {
  const diff = differenceOf(run);
  if (diff === null) return <span className="text-muted-foreground">None</span>;
  const rounding = note && run.status === "reconciled" && diff !== 0;
  return (
    <>
      <Usd
        cents={diff}
        className={cn(
          run.status === "variance_unexplained" ? "text-destructive" : diff === 0 ? "text-muted-foreground" : "",
        )}
      />
      {rounding ? <span className="block font-type text-[0.8125rem] text-muted-foreground">rounding</span> : null}
    </>
  );
}

/**
 * The run's status as a small stamp: ink for reconciled, the stamp's red where money or keys are
 * missing, soft ink while a record or a block is still to come. "Within rounding" moves to the
 * Difference column.
 */
function StatusTag({ run }: { run: BooksRun }) {
  const s = statusView(run);
  const tone =
    run.status === "reconciled" ? "ink" : s.tone === "danger" || run.status === "incomplete_keys" ? "red" : "soft";
  return (
    <StatusStamp tone={tone} title={s.help}>
      {run.status === "reconciled" ? "Reconciled" : s.label}
    </StatusStamp>
  );
}

/** A total in the ledger's foot: dollars in dot matrix, inked. */
function TotalUsd({ cents, className }: { cents: number; className?: string }) {
  return (
    <span className={cn(DOT, "text-[1rem] xl:text-[1.0625rem]", className)}>
      <Usd cents={cents} />
    </span>
  );
}

function Stack({ top, bottom }: { top: ReactNode; bottom?: ReactNode }) {
  return (
    <>
      <div>{top}</div>
      {bottom ? <div className="mt-0.5 text-[0.8125rem] text-muted-foreground">{bottom}</div> : null}
    </>
  );
}

function RunsTable({ r, runs, t }: { r: BooksResult; runs: BooksRun[]; t: BooksTotals }) {
  const [open, setOpen] = useState<string | null>(null);
  const reconciled = runs.filter((run) => run.status === "reconciled").length;
  const columns = 7;
  return (
    <div
      className="hidden overflow-x-auto lg:block xl:overflow-visible"
      role="region"
      aria-label="Runs, funded against paid"
      tabIndex={0}
    >
      <table
        className="w-full min-w-[720px] border-collapse border-b-2 border-foreground text-[0.875rem] xl:text-[0.9375rem]"
        data-testid="books-runs"
      >
        <thead>
          <tr className="border-y-2 border-foreground">
            <th scope="col" className={TH}>
              Run
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Funded
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Paid
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
          {runs.map((run, i) => {
            const isOpen = open === run.run_id;
            const detailId = `run-detail-${run.run_id}`;
            const paidOn = paidDateOf(r, run.run_id);
            const toggle = () => setOpen(isOpen ? null : run.run_id);
            const sub = `${run.lines + (run.pending_lines ?? 0)} paid${paidOn ? ` on ${formatDate(paidOn).replace(/ \d{4}$/, "")}` : ""}`;
            return (
              <Fragment key={run.run_id}>
                {/* Green bar by run, so an opened ledger card never shifts the bars below it. */}
                <tr
                  data-plain=""
                  className={cn(
                    "cursor-pointer border-b border-bar-line transition-colors hover:bg-muted",
                    i % 2 === 0 && "bg-bar",
                    isOpen && "border-b-0",
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
                      className="-mx-1 flex items-start gap-1.5 px-1 text-left focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <ChevronRight
                        className={cn(
                          "mt-1 size-3.5 shrink-0 text-muted-foreground transition-transform",
                          isOpen && "rotate-90",
                        )}
                        aria-hidden="true"
                      />
                      <span>
                        <span className="block font-bold uppercase">{formatPeriodLabel(run.period)}</span>
                        <span className="block text-[0.8125rem] text-muted-foreground">
                          {sub}
                          <span className="sr-only">, run {run.run_id.slice(0, 8)}</span>
                        </span>
                      </span>
                    </button>
                    {/* Buttons are not printed; the run's name is. */}
                    <span data-print="text">
                      {formatPeriodLabel(run.period)}, run {run.run_id.slice(0, 8)}
                      <span className="block text-[8pt]">{sub}</span>
                    </span>
                  </td>
                  <td className={cn(TD, "text-right")}>
                    {run.funded_usd_cents === null ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      <Stack top={<Usd cents={run.funded_usd_cents} />} bottom={<Zec zat={run.zec_acquired_zat} />} />
                    )}
                  </td>
                  <td className={cn(TD, "text-right")}>
                    <Stack top={<Usd cents={run.paid_usd_cents} />} bottom={<Zec zat={run.paid_zat} />} />
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
                    <StatusTag run={run} />
                  </td>
                </tr>
                {isOpen ? (
                  <tr id={detailId} data-plain="" className={cn("border-b border-bar-line", i % 2 === 0 && "bg-bar")}>
                    <td colSpan={columns} className="px-3 pt-1 pb-5 whitespace-normal sm:px-5">
                      <RunDetail r={r} run={run} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          {/* The totals line, printed in dot matrix as a ledger's foot is. */}
          <tr className="border-t-2 border-foreground" data-testid="books-runs-total">
            <th scope="row" className={cn(TD, "text-left text-[0.75rem] font-bold tracking-[0.08em] uppercase")}>
              Total
            </th>
            <td className={cn(TD, "text-right")}>
              {t.fundingKnown ? (
                <Stack top={<TotalUsd cents={t.funded} />} bottom={<Zec zat={t.zecAcquired} />} />
              ) : (
                <NotRecorded />
              )}
            </td>
            <td className={cn(TD, "text-right")}>
              <Stack top={<TotalUsd cents={t.paid} />} bottom={<Zec zat={t.paidZat} />} />
            </td>
            <td className={cn(TD, "text-right")}>
              {t.fundingKnown ? <TotalUsd cents={t.variance} /> : <NotRecorded />}
            </td>
            <td className={cn(TD, "text-right")}>
              {t.fundingKnown ? <TotalUsd cents={t.explained} /> : <NotRecorded />}
            </td>
            <td className={cn(TD, "text-right")}>
              {t.fundingKnown ? (
                <TotalUsd
                  cents={t.unexplained}
                  className={cn(Math.abs(t.unexplained - t.rounding) > 0 && "text-destructive")}
                />
              ) : (
                <NotRecorded />
              )}
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

/* ---------- Runs list (phones and tablets) ---------- */

function RunsList({ r, runs }: { r: BooksResult; runs: BooksRun[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul className="green-bar border-y-2 border-foreground lg:hidden" aria-label="Runs, funded against paid">
      {runs.map((run) => {
        const isOpen = open === run.run_id;
        const detailId = `run-detail-m-${run.run_id}`;
        const paidOn = paidDateOf(r, run.run_id);
        return (
          <li key={run.run_id} className="border-b border-bar-line px-2 last:border-b-0">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : run.run_id)}
              aria-expanded={isOpen}
              aria-controls={detailId}
              className="grid w-full gap-2.5 py-3.5 text-left font-type focus-visible:outline-2 focus-visible:outline-ring"
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
                    <span className="block text-[0.9375rem] font-bold uppercase">{formatPeriodLabel(run.period)}</span>
                    <span className="block text-[0.8125rem] text-muted-foreground">
                      {run.lines + (run.pending_lines ?? 0)} paid
                      {paidOn ? ` on ${formatDate(paidOn)}` : ""}
                    </span>
                  </span>
                </span>
                <StatusTag run={run} />
              </span>
              <span className="grid grid-cols-1 gap-x-8 gap-y-1 pl-5 sm:grid-cols-2 text-[0.8125rem]">
                <MiniStat
                  label="Funded"
                  value={run.funded_usd_cents === null ? null : <Usd cents={run.funded_usd_cents} />}
                />
                <MiniStat label="Paid" value={<Usd cents={run.paid_usd_cents} />} />
                <MiniStat
                  label="Variance"
                  value={run.variance_usd_cents === null ? null : <Usd cents={run.variance_usd_cents} />}
                />
                <MiniStat label="Difference" value={<DiffValue run={run} note={false} />} />
              </span>
            </button>
            {/* Buttons are not printed; the run's name and figures are. */}
            <span data-print="text">
              {formatPeriodLabel(run.period)}, run {run.run_id.slice(0, 8)}: funded{" "}
              {run.funded_usd_cents === null ? "not recorded" : formatUsd(run.funded_usd_cents)}, paid{" "}
              {formatUsd(run.paid_usd_cents)}, {statusView(run).label.toLowerCase()}
            </span>
            {isOpen ? (
              <div id={detailId} className="pb-4">
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
