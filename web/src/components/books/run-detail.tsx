"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Coin, Rate, Usd, Zec } from "@/components/app/amount";
import { Hash } from "@/components/app/hash";
import { Initials } from "@/components/ds/avatar";
import { Tag } from "@/components/ds/tag";
import {
  differenceOf,
  missingAccountsOf,
  payeeOf,
  unpaidAccountsOf,
  type BooksResult,
  type BooksRun,
} from "@/components/books/books-data";
import { formatDate, formatHeight, formatPeriodLabel, formatRate } from "@/lib/format";
import { cn } from "cn";

/** The explorer link for any transaction, built the way the service builds it for its lines. */
export function explorerFor(r: BooksResult, txid: string): string | null {
  const sample =
    r.lines.find((l) => l.explorer_url) ??
    (r.pending ?? []).find((l) => l.explorer_url) ??
    r.unlabelled.find((l) => l.explorer_url);
  if (!sample?.explorer_url || !sample.explorer_url.includes(sample.txid)) return null;
  return sample.explorer_url.replace(sample.txid, txid);
}

/** The lines of a ledger card: a spaced-caps label left, the typed value right, on green bar. */
export function Facts({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("green-bar border-y border-bar-line font-type text-[0.8125rem]", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 px-2 py-[7px]">
          <dt className="form-label text-[0.75rem] text-muted-foreground">{it.label}</dt>
          <dd className="min-w-0 text-right">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function RateValue({ e6, testnet }: { e6: number | null | undefined; testnet: boolean }) {
  if (e6 === null || e6 === undefined) return <span className="text-muted-foreground">None</span>;
  if (testnet)
    return (
      <span
        className="inline-block max-w-[4.5rem] font-type text-[0.8125rem] leading-tight whitespace-normal text-muted-foreground"
        title={`${formatRate(e6)} per coin, a fixed testnet rate`}
      >
        Simulated rate
      </span>
    );
  return <Rate e6={e6} unit={false} />;
}

/** One run opened: its funding record, what was not paid out, and every payment in it. */
export function RunDetail({ r, run }: { r: BooksResult; run: BooksRun }) {
  const testnet = r.network === "testnet";
  const record = r.run_records?.find((x) => x.run_id === run.run_id) ?? null;
  const lines = r.lines.filter((l) => l.run_id === run.run_id);
  const pending = (r.pending ?? []).filter((l) => l.run_id === run.run_id);
  // The Treasury's own count of allocation outputs when the service sends it; otherwise only the
  // outputs received by accounts in this key set are visible.
  const allocations = run.allocations ?? (r.funding ?? []).filter((f) => f.run_id === run.run_id).length;
  const missing = missingAccountsOf(run);
  const unpaid = unpaidAccountsOf(run);
  const diff = differenceOf(run);
  return (
    // A ledger card for the run, laid on the ledger under its line: the funding record and what
    // was not paid out on the left, every payment on the right.
    <article
      aria-label={`Ledger card, ${formatPeriodLabel(run.period)} payroll`}
      className="paper border border-foreground shadow-[3px_3px_0_0_var(--rule)]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-foreground px-4 py-3">
        <p className="inked font-display text-[1.125rem] leading-tight font-bold">
          {formatPeriodLabel(run.period)} payroll
        </p>
        <p className="form-label text-[0.75rem] text-muted-foreground">Ledger card, run {run.run_id.slice(0, 8)}</p>
      </div>
      <div className="grid lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        <div className="grid content-start gap-5 border-b border-rule px-4 py-4 lg:border-r lg:border-b-0">
          <section aria-label="Funding">
            <h3 className={cn(LABEL, "mb-2")}>Funding</h3>
            {record ? (
              <Facts
                items={[
                  { label: "Funded", value: <Usd cents={record.funded_usd_cents} /> },
                  {
                    label: (
                      <>
                        <Coin /> acquired
                      </>
                    ),
                    value: <Zec zat={record.zec_acquired_zat} />,
                  },
                  {
                    label: "Rate",
                    value: testnet ? (
                      <span
                        title={`${formatRate(record.rate_usd_per_zec_e6)} per coin: a fixed testnet rate so faucet coins can carry a demo payroll`}
                      >
                        <Tag>Simulated rate</Tag>
                      </span>
                    ) : (
                      <Rate e6={record.rate_usd_per_zec_e6} />
                    ),
                  },
                  {
                    label: "Recorded",
                    value: (
                      <span>
                        {formatDate(record.date)}
                        {record.height ? `, block ${formatHeight(record.height)}` : ", not mined"}
                      </span>
                    ),
                  },
                  {
                    label: "Transaction",
                    value: (
                      <Hash
                        value={record.txid}
                        label="funding transaction id"
                        explorerUrl={explorerFor(r, record.txid)}
                      />
                    ),
                  },
                  ...(allocations
                    ? [
                        {
                          label: "Moved to",
                          value: `${allocations} ${allocations === 1 ? "account" : "accounts"} in that transaction`,
                        },
                      ]
                    : []),
                ]}
              />
            ) : (
              <p className="py-2 text-[0.8125rem] text-strong">
                No funding record is visible in this period. Load the Treasury key, or widen the period: the record is
                written the day the run starts paying.
              </p>
            )}
            {missing ? (
              <p
                className="carbon-paper mt-2 border border-carbon-line px-3 py-2 text-[0.8125rem] text-strong"
                data-testid="run-missing-keys"
              >
                {missing} of the {allocations} {allocations === 1 ? "account" : "accounts"} this run paid{" "}
                {missing === 1 ? "is" : "are"} not in this key set
                {run.missing_zat ? (
                  <>
                    {" "}
                    (<Zec zat={run.missing_zat} />)
                  </>
                ) : null}
                , so {missing === 1 ? "its payment" : "their payments"} cannot be seen. Load every contractor&apos;s key
                to reconcile the run.
              </p>
            ) : null}
            {unpaid ? (
              <p className="mt-2 border-2 border-destructive px-3 py-2 text-[0.8125rem] text-strong">
                {unpaid} funded {unpaid === 1 ? "account shows" : "accounts show"} no payment for this run.
              </p>
            ) : null}
          </section>
          <section aria-label="Not paid out">
            <h3 className={cn(LABEL, "mb-2")}>Not paid out</h3>
            <Facts
              items={[
                { label: "Network fees", value: <Zec zat={run.network_fees_zat} /> },
                { label: "Unspent", value: <Zec zat={run.unspent_zat} /> },
                {
                  label: testnet ? "Explained at the simulated rate" : "Explained at the fill rate",
                  value: <Usd cents={run.explained_usd_cents} />,
                },
                {
                  label: "Variance minus explained",
                  value:
                    diff === null ? (
                      <span className="text-muted-foreground">None</span>
                    ) : (
                      <span>
                        <Usd cents={diff} />
                        {run.status === "reconciled" && diff !== 0 ? (
                          <span className="block text-[0.8125rem] text-muted-foreground">within rounding</span>
                        ) : null}
                      </span>
                    ),
                },
              ]}
            />
          </section>
        </div>
        <section aria-label={`Payments in this run`} className="min-w-0 px-4 py-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className={LABEL}>Payments ({lines.length + pending.length})</h3>
            <Link
              href={`/books/ledger?run=${encodeURIComponent(run.run_id)}`}
              className="inline-flex items-center gap-1 font-type text-[0.8125rem] font-bold text-link underline underline-offset-4 hover:decoration-2"
            >
              Open in ledger
            </Link>
          </div>
          <ul className="green-bar border-y border-bar-line">
            {[...pending.map((l) => ({ l, pending: true })), ...lines.map((l) => ({ l, pending: false }))].map(
              ({ l, pending: isPending }, i) => (
                <li
                  key={`${l.txid}-${i}`}
                  className="grid grid-cols-[26px_minmax(0,1fr)] gap-x-3 px-2 py-2.5 font-type sm:grid-cols-[26px_minmax(0,1fr)_auto]"
                >
                  <Initials name={l.label ?? payeeOf(l)} className="mt-0.5" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate text-[0.9375rem] font-bold">{payeeOf(l)}</span>
                      {isPending ? <Tag>Pending</Tag> : null}
                      {l.settlement === "converted" ? <Tag>Converted to USDC</Tag> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 text-[0.8125rem] text-muted-foreground">
                      <span>{l.invoice_ref || "No invoice"},</span>
                      <span>{isPending ? "not mined" : formatDate(l.block_time ?? l.date)}</span>
                      <Hash value={l.txid} label="transaction id" explorerUrl={l.explorer_url} head={6} tail={4} />
                    </div>
                  </div>
                  <div
                    className={cn(
                      "col-start-2 mt-1 sm:col-start-auto sm:mt-0 sm:text-right",
                      isPending && "text-muted-foreground",
                    )}
                  >
                    <Usd cents={l.usd_basis_cents} className="text-[0.9375rem]" />
                    <div className="text-[0.8125rem] text-muted-foreground">
                      <Zec zat={l.amount_zat} />
                    </div>
                  </div>
                </li>
              ),
            )}
          </ul>
          {lines.length + pending.length === 0 ? (
            <p className="py-2 text-[0.8125rem] text-muted-foreground">No payments of this run fall in the period.</p>
          ) : null}
        </section>
      </div>
    </article>
  );
}

const LABEL = "form-label text-[0.75rem] font-bold";
