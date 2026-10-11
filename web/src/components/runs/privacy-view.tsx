"use client";

import { ExternalLink } from "lucide-react";
import { Usd } from "@/components/app/amount";
import { Card } from "@/components/ds/card";
import { Tag } from "@/components/ds/tag";
import { Stamp } from "@/components/ds/paper";
import { Redacted } from "@/components/ds/two-views";
import type { Run } from "@/lib/api";
import { truncateMiddle } from "@/lib/format";
import { plural, runTitle } from "./run-meta";

/**
 * The same payments, two ledgers. Left, on paper: an illustration of what a transparent chain
 * would publish, built from this run's own lines. Right, on the vault: what the Zcash explorer
 * shows for the real transactions, which is a transaction id and nothing else, the rest as
 * redaction bars.
 */
export function PrivacyView({ run }: { run: Run }) {
  const sent = run.lines.filter((l) => l.txid).length;
  const title = runTitle(run);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="flex flex-col p-0 sm:px-0">
        <div className="flex flex-wrap items-start justify-between gap-2 px-5 pt-5 pb-3 sm:px-[22px]">
          <div className="min-w-0">
            <h2 className="inked font-display text-[1.25rem] leading-tight font-bold">
              What a public chain would show
            </h2>
            <p className="mt-1 text-[0.8125rem] text-muted-foreground">Readable by anyone, forever.</p>
          </div>
          <Tag tone="neutral">Illustration</Tag>
        </div>
        {/* A public ledger, typed out: every line in the clear. */}
        <ul className="green-bar flex-1 border-t-2 border-ink font-type">
          {run.lines.map((l) => (
            <li key={l.id} className="border-b border-bar-line px-5 py-3 last:border-b-0 sm:px-[22px]">
              <p className="text-[0.8125rem] text-muted-foreground">
                From the treasury address to {l.contractor_name}&apos;s address
              </p>
              <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3">
                <Usd cents={l.amount_usd_cents} className="font-bold" />
                <span className="text-[0.8125rem] text-muted-foreground">
                  Memo: {[title, l.invoice_ref].filter(Boolean).join(", ")}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <p className="border-t-2 border-ink px-5 py-3.5 text-[0.8125rem] text-muted-foreground sm:px-[22px]">
          Anyone could add these up: <Usd cents={run.total_usd_cents} className="font-type text-foreground" /> to{" "}
          {plural(run.lines.length, "person", "people")} for {title}, each salary tied to an address.
        </p>
      </Card>

      <section
        aria-labelledby="explorer-shows"
        className="identity-vault carbon-paper relative flex min-w-0 flex-col border border-carbon-line text-carbon-ink"
      >
        <Stamp className="absolute top-4 right-4 origin-top-right scale-[0.8] sm:top-5 sm:right-5 sm:scale-90" />
        <div className="px-5 pt-5 pr-28 pb-3 sm:px-[22px] sm:pr-36">
          <h2 id="explorer-shows" className="inked font-display text-[1.25rem] leading-tight font-bold">
            What the Zcash explorer shows
          </h2>
          <p className="mt-1 text-[0.8125rem] text-ash">These transactions, live on chain, every one shielded.</p>
        </div>
        <ul className="flex-1 border-t-2 border-carbon-ink/70 font-type">
          {run.lines.map((l) => (
            <li key={l.id} className="border-b border-mist px-5 py-3 last:border-b-0 sm:px-[22px]">
              <div className="flex items-center justify-between gap-2 text-[0.8125rem]">
                {l.txid ? (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <code className="font-type" title={l.txid}>
                      {truncateMiddle(l.txid, 10, 6)}
                    </code>
                    {l.explorer_url ? (
                      <a
                        href={l.explorer_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex size-6 items-center justify-center text-ash hover:bg-mist hover:text-ink"
                        aria-label="Open this transaction in the block explorer (opens in a new tab)"
                      >
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                      </a>
                    ) : null}
                  </span>
                ) : (
                  <span className="text-ash">Not sent yet</span>
                )}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[0.8125rem]">
                <span className="sr-only">Sender, recipient, amount and memo hidden on chain.</span>
                <span aria-hidden="true" className="contents">
                  <Redacted label={null} className="w-[5.5em]" />
                  <Redacted label={null} className="w-[5.5em]" />
                  <Redacted label={null} className="ml-auto w-[4.5em]" />
                </span>
              </div>
            </li>
          ))}
        </ul>
        <p className="border-t-2 border-carbon-ink/70 px-5 py-3.5 text-[0.8125rem] text-ash sm:px-[22px]">
          {sent === 0
            ? "Once the run pays, each payment appears here as a transaction id and nothing else."
            : `${sent} of ${run.lines.length} payments on chain. Open any of them: no amount, no names, no memo.`}
        </p>
      </section>
    </div>
  );
}
