"use client";

import { ExternalLink } from "lucide-react";
import { Usd } from "@/components/app/amount";
import { useCoinUnit } from "@/components/app/health-provider";
import { Panel } from "@/components/app/states";
import { useResource } from "@/hooks/use-resource";
import { api, type Run } from "@/lib/api";
import { formatPeriodLabel, formatUsd, formatZec, truncateMiddle } from "@/lib/format";
import { cn } from "cn";

/**
 * Two views of this run, built from the run's own data:
 * left, what a transparent ledger would publish for the same payments;
 * right, what a Zcash explorer actually shows for the shielded transactions.
 */
export function RunComparison({ run }: { run: Run }) {
  const coin = useCoinUnit();
  const contractors = useResource((s) => api.contractors(s), "contractors");
  const wallet = useResource((s) => api.wallet(s), "wallet");
  const addressOf = new Map((contractors.data ?? []).map((c) => [c.id, c.unified_address]));
  const treasury = wallet.data?.treasury.unified_address;

  if (run.lines.length === 0) return null;
  const broadcast = run.lines.filter((l) => l.txid).length;

  return (
    <Panel
      title="Who can see this run"
      description="The same payments, two ledgers. On a transparent chain anyone could total your payroll; on Zcash the explorer sees only that shielded transactions happened."
    >
      <div className="grid gap-px bg-border lg:grid-cols-2">
        <section aria-labelledby="public-view-title" className="min-w-0 bg-card">
          <div className="border-b px-4 py-3">
            <h3 id="public-view-title" className="text-sm font-semibold">
              What a public chain would show
            </h3>
            <p className="text-xs text-muted-foreground">
              Sender, recipient and exact amount per line, readable by anyone, forever.
            </p>
          </div>
          <ul className="divide-y text-sm">
            {run.lines.map((l) => (
              <li key={l.id} className="grid gap-1 px-4 py-3">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
                  <span>From</span>
                  <code className="font-mono text-foreground">
                    {treasury ? truncateMiddle(treasury, 10, 6) : "your treasury address"}
                  </code>
                  <span>to</span>
                  <code className="font-mono text-foreground">
                    {addressOf.get(l.contractor_id)
                      ? truncateMiddle(addressOf.get(l.contractor_id)!, 10, 6)
                      : `${l.contractor_name}'s address`}
                  </code>
                </div>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="num font-medium">
                    {l.amount_zat ? `${formatZec(l.amount_zat)} ${coin}` : formatUsd(l.amount_usd_cents)}
                    {l.amount_zat ? (
                      <span className="ml-2 font-normal text-muted-foreground">{formatUsd(l.amount_usd_cents)}</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {[formatPeriodLabel(run.period_label), l.invoice_ref].filter(Boolean).join(", ")}
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">
            Anyone could add these up: <Usd cents={run.total_usd_cents} className="font-medium text-foreground" /> paid
            to {run.lines.length} {run.lines.length === 1 ? "person" : "people"} for{" "}
            {formatPeriodLabel(run.period_label)}, each salary tied to an address.
          </p>
        </section>

        <section aria-labelledby="zcash-view-title" className="min-w-0 bg-card">
          <div className="border-b px-4 py-3">
            <h3 id="zcash-view-title" className="text-sm font-semibold">
              What the Zcash explorer shows
            </h3>
            <p className="text-xs text-muted-foreground">
              Shielded transactions. Amounts, sender, recipient and memo are encrypted.
            </p>
          </div>
          <ul className="divide-y text-sm">
            {run.lines.map((l) => (
              <li key={l.id} className="grid gap-1.5 px-4 py-3">
                <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
                  {l.txid ? (
                    <span className="inline-flex min-w-0 items-center gap-1">
                      <code className="font-mono">{truncateMiddle(l.txid, 10, 6)}</code>
                      {l.explorer_url ? (
                        <a
                          href={l.explorer_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label="Open this transaction in the block explorer (opens in a new tab)"
                        >
                          <ExternalLink className="size-3.5" aria-hidden="true" />
                        </a>
                      ) : null}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">Not broadcast yet</span>
                  )}
                  <span className="shrink-0 text-muted-foreground">Shielded</span>
                </div>
                <div className="flex flex-wrap items-center gap-2" aria-label="Sender, recipient and amount hidden">
                  <Sealed className="w-24" />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Sealed className="w-24" />
                  <Sealed className="ml-auto w-20" />
                </div>
              </li>
            ))}
          </ul>
          <p className="border-t px-4 py-3 text-xs text-muted-foreground">
            {broadcast === 0
              ? "Once the run executes, each line appears here as a transaction id and nothing else."
              : `${broadcast} of ${run.lines.length} payments on chain. Open any of them in the explorer: no amount, no parties.`}
          </p>
        </section>
      </div>
    </Panel>
  );
}

function Sealed({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center", className)}>
      <span aria-hidden="true" className="inline-block h-3 w-full rounded-[3px] bg-redact" />
      <span className="sr-only">Hidden</span>
    </span>
  );
}
