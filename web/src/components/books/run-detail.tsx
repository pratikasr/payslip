"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { Coin, Rate, Usd, Zec } from "@/components/app/amount";
import { Hash } from "@/components/app/hash";
import { Initials } from "@/components/ds/avatar";
import { Tag } from "@/components/ds/tag";
import { differenceOf, type BooksResult } from "@/components/books/books-data";
import type { ReconciliationRun } from "@/lib/api";
import { formatDate, formatHeight, formatRate } from "@/lib/format";
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

/** A small label and value list for drill-downs: label left, value right. */
export function Facts({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid divide-y divide-hairline text-[0.875rem]", className)}>
      {items.map((it, i) => (
        <div key={i} className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-muted-foreground">{it.label}</dt>
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
        className="inline-block max-w-[4.5rem] text-[0.8125rem] leading-tight whitespace-normal text-muted-foreground"
        title={`${formatRate(e6)} per coin, a fixed testnet rate`}
      >
        Simulated rate
      </span>
    );
  return <Rate e6={e6} unit={false} />;
}

/** One run opened: its funding record, what was not paid out, and every payment in it. */
export function RunDetail({ r, run }: { r: BooksResult; run: ReconciliationRun }) {
  const testnet = r.network === "testnet";
  const record = r.run_records?.find((x) => x.run_id === run.run_id) ?? null;
  const lines = r.lines.filter((l) => l.run_id === run.run_id);
  const pending = (r.pending ?? []).filter((l) => l.run_id === run.run_id);
  const allocations = (r.funding ?? []).filter((f) => f.run_id === run.run_id);
  const diff = differenceOf(run);
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
      <div className="grid content-start gap-5">
        <section aria-label="Funding">
          <h3 className="mb-1 text-[0.8125rem] text-muted-foreground">Funding</h3>
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
                    <span title={`${formatRate(record.rate_usd_per_zec_e6)} per coin, a fixed testnet rate`}>
                      <Tag>Simulated rate</Tag>
                    </span>
                  ) : (
                    <Rate e6={record.rate_usd_per_zec_e6} />
                  ),
                },
                {
                  label: "Recorded",
                  value: (
                    <span className="num">
                      {formatDate(record.date)}
                      {record.height ? ` · block ${formatHeight(record.height)}` : " · not mined"}
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
                ...(allocations.length
                  ? [
                      {
                        label: "Moved to",
                        value: `${allocations.length} ${allocations.length === 1 ? "account" : "accounts"} in that transaction`,
                      },
                    ]
                  : []),
              ]}
            />
          ) : (
            <p className="py-2 text-sm text-strong">
              No funding record is visible in this period. Load the Treasury key, or widen the period: the record is
              written the day the run starts paying.
            </p>
          )}
        </section>
        <section aria-label="Not paid out">
          <h3 className="mb-1 text-[0.8125rem] text-muted-foreground">Not paid out</h3>
          <Facts
            items={[
              { label: "Network fees", value: <Zec zat={run.network_fees_zat} /> },
              { label: "Unspent", value: <Zec zat={run.unspent_zat} /> },
              { label: "Explained at the fill rate", value: <Usd cents={run.explained_usd_cents} /> },
              {
                label: "Variance minus explained",
                value:
                  diff === null ? (
                    <span className="text-muted-foreground">None</span>
                  ) : (
                    <span>
                      <Usd cents={diff} />
                      {run.status === "reconciled" && diff !== 0 ? (
                        <span className="block text-xs text-muted-foreground">rounding</span>
                      ) : null}
                    </span>
                  ),
              },
            ]}
          />
        </section>
      </div>
      <section aria-label={`Payments in this run`} className="min-w-0">
        <div className="mb-1 flex items-baseline justify-between gap-3">
          <h3 className="text-[0.8125rem] text-muted-foreground">Payments ({lines.length + pending.length})</h3>
          <Link
            href={`/books/ledger?run=${encodeURIComponent(run.run_id)}`}
            className="inline-flex items-center gap-1 rounded-sm text-[0.8125rem] text-link underline-offset-4 hover:underline"
          >
            Open in ledger
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
        <ul className="divide-y divide-hairline">
          {[...pending.map((l) => ({ l, pending: true })), ...lines.map((l) => ({ l, pending: false }))].map(
            ({ l, pending: isPending }, i) => (
              <li key={`${l.txid}-${i}`} className="grid grid-cols-[26px_minmax(0,1fr)_auto] gap-x-3 py-2.5">
                <Initials name={l.label} className="mt-0.5" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-[0.9375rem]">{l.label ?? "Unknown account"}</span>
                    {isPending ? <Tag>Pending</Tag> : null}
                    {l.settlement === "converted" ? <Tag>Converted to USDC</Tag> : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>{l.invoice_ref || "No invoice"}</span>
                    <span aria-hidden="true">·</span>
                    <span className="num">{isPending ? "Not mined" : formatDate(l.block_time ?? l.date)}</span>
                    <Hash value={l.txid} label="transaction id" explorerUrl={l.explorer_url} head={6} tail={4} />
                  </div>
                </div>
                <div className={cn("text-right", isPending && "text-muted-foreground")}>
                  <Usd cents={l.usd_basis_cents} className="text-[0.9375rem]" />
                  <div className="text-xs text-muted-foreground">
                    <Zec zat={l.amount_zat} />
                  </div>
                </div>
              </li>
            ),
          )}
        </ul>
        {lines.length + pending.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No payments of this run fall in the period.</p>
        ) : null}
      </section>
    </div>
  );
}
