"use client";

import { ExternalLink } from "lucide-react";
import { Usd } from "@/components/app/amount";
import { Card } from "@/components/ds/card";
import { Tag } from "@/components/ds/tag";
import type { Run } from "@/lib/api";
import { truncateMiddle } from "@/lib/format";
import { plural, runTitle } from "./run-meta";

/**
 * The same payments, two ledgers. Left: an illustration of what a transparent chain would
 * publish, built from this run's own lines. Right: what the Zcash explorer shows for the real
 * transactions, which is a transaction id and nothing else.
 */
export function PrivacyView({ run }: { run: Run }) {
  const sent = run.lines.filter((l) => l.txid).length;
  const title = runTitle(run);
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="flex flex-col p-0 sm:px-0">
        <div className="flex flex-wrap items-start justify-between gap-2 px-5 pt-5 pb-3 sm:px-[22px]">
          <div className="min-w-0">
            <h2 className="text-[0.9375rem] font-normal text-strong">What a public chain would show</h2>
            <p className="text-[0.8125rem] text-muted-foreground">Readable by anyone, forever.</p>
          </div>
          <Tag tone="neutral">Illustration</Tag>
        </div>
        <ul className="flex-1 border-t border-hairline">
          {run.lines.map((l) => (
            <li key={l.id} className="border-b border-hairline px-5 py-3 last:border-b-0 sm:px-[22px]">
              <p className="text-[0.8125rem] text-muted-foreground">
                Treasury address <span aria-hidden="true">→</span>
                <span className="sr-only">to</span> {l.contractor_name}&apos;s address
              </p>
              <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3">
                <Usd cents={l.amount_usd_cents} />
                <span className="text-[0.8125rem] text-muted-foreground">
                  Memo: {[title, l.invoice_ref].filter(Boolean).join(", ")}
                </span>
              </div>
            </li>
          ))}
        </ul>
        <p className="border-t border-hairline px-5 py-3.5 text-[0.8125rem] text-muted-foreground sm:px-[22px]">
          Anyone could add these up: <Usd cents={run.total_usd_cents} className="text-foreground" /> to{" "}
          {plural(run.lines.length, "person", "people")} for {title}, each salary tied to an address.
        </p>
      </Card>

      <Card className="flex flex-col p-0 sm:px-0">
        <div className="flex flex-wrap items-start justify-between gap-2 px-5 pt-5 pb-3 sm:px-[22px]">
          <div className="min-w-0">
            <h2 className="text-[0.9375rem] font-normal text-strong">What the Zcash explorer shows</h2>
            <p className="text-[0.8125rem] text-muted-foreground">These transactions, live on chain.</p>
          </div>
          <Tag tone="shielded">Shielded</Tag>
        </div>
        <ul className="flex-1 border-t border-hairline">
          {run.lines.map((l) => (
            <li key={l.id} className="border-b border-hairline px-5 py-3 last:border-b-0 sm:px-[22px]">
              <div className="flex items-center justify-between gap-2 text-[0.8125rem]">
                {l.txid ? (
                  <span className="inline-flex min-w-0 items-center gap-1">
                    <code className="font-mono" title={l.txid}>
                      {truncateMiddle(l.txid, 10, 6)}
                    </code>
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
                  <span className="text-muted-foreground">Not sent yet</span>
                )}
              </div>
              <div
                className="mt-1.5 flex items-center gap-2"
                role="img"
                aria-label="Sender, recipient, amount and memo hidden"
              >
                <Sealed className="w-20" />
                <span className="text-[0.8125rem] text-muted-foreground" aria-hidden="true">
                  →
                </span>
                <Sealed className="w-20" />
                <Sealed className="ml-auto w-16" />
              </div>
            </li>
          ))}
        </ul>
        <p className="border-t border-hairline px-5 py-3.5 text-[0.8125rem] text-muted-foreground sm:px-[22px]">
          {sent === 0
            ? "Once the run pays, each payment appears here as a transaction id and nothing else."
            : `${sent} of ${run.lines.length} payments on chain. Open any of them: no amount, no names, no memo.`}
        </p>
      </Card>
    </div>
  );
}

function Sealed({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center ${className ?? ""}`}>
      <span aria-hidden="true" className="inline-block h-2.5 w-full rounded-[3px] bg-redact/80" />
    </span>
  );
}
