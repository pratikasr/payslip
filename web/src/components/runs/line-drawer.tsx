"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Rate, Usd, Zec } from "@/components/app/amount";
import { CopyButton } from "@/components/app/copy-button";
import { Hash } from "@/components/app/hash";
import { useCoinUnit } from "@/components/app/health-provider";
import { Disclosure } from "@/components/ds/disclosure";
import { Sensitive } from "@/components/ds/sensitive";
import { SimulatedRate } from "@/components/ds/simulated-rate";
import { Timeline as TimelineList, type TimelineItem } from "@/components/ds/timeline";
import { Button } from "@/components/ui/button";
import type { PayLine, Run, RunLogEvent } from "@/lib/api";
import { formatDateTime, formatHeight, formatPeriodLabel, settlementName } from "@/lib/format";
import { decodeMemo } from "@/lib/memo";
import { cn } from "cn";
import { TYPE } from "@/components/ds/type";
import { isLineWarning, LineStatus, runTitle } from "./run-meta";

const CHAIN_NAMES: Record<string, string> = { base: "Base", arb: "Arbitrum", eth: "Ethereum", sol: "Solana" };

function findLog(logs: RunLogEvent[], test: (m: string) => boolean): string | undefined {
  return logs.find((l) => test(l.message))?.at;
}

/** The line's history: approved, moved to the contractor's account, sent, confirmed. */
function lineEvents(run: Run, line: PayLine, logs: RunLogEvent[]): TimelineItem[] {
  const name = line.contractor_name;
  const allocated = line.status !== "pending" || !!run.allocation_height;
  const sent = !!line.txid;
  const confirmed = line.status === "confirmed";
  const failed = line.status === "failed";
  const allocationTx = line.allocation_txid ?? run.allocation_txid ?? null;
  const at = (value: string | undefined | null) => (value ? { time: formatDateTime(value), dateTime: value } : {});
  return [
    {
      key: "approved",
      title: `Approved in the ${runTitle(run)} run`,
      state: "done",
      ...at(run.created_at),
    },
    {
      key: "allocated",
      title: allocated ? `Moved to ${name}'s own account` : `Waiting to move to ${name}'s own account`,
      detail: allocationTx ? (
        <span className="inline-flex flex-wrap items-center gap-x-1.5">
          <Hash
            value={allocationTx}
            label="allocation transaction id"
            explorerUrl={run.allocation_explorer_url}
            head={6}
            tail={4}
          />
          {run.allocation_height ? <span className="num">block {formatHeight(run.allocation_height)}</span> : null}
        </span>
      ) : undefined,
      state: allocated ? "done" : failed ? "failed" : "current",
      ...at(allocated ? findLog(logs, (m) => /^Allocation confirmed/.test(m)) : undefined),
    },
    {
      key: "sent",
      title: sent ? "Sent as a shielded payment" : "Not sent yet",
      detail: line.txid ? (
        <Hash
          value={line.txid}
          label={`transaction id for ${name}`}
          explorerUrl={line.explorer_url}
          head={8}
          tail={6}
        />
      ) : undefined,
      state: sent ? "done" : failed ? "failed" : allocated ? "current" : "upcoming",
      ...at(line.txid ? findLog(logs, (m) => m.includes(line.txid!)) : undefined),
    },
    {
      key: "confirmed",
      title: confirmed ? `Confirmed in block ${formatHeight(line.confirmed_height)}` : "Waiting to be mined",
      state: confirmed ? "done" : sent ? "current" : "upcoming",
      // The block's own time when the service gives it; else when the service logged it.
      ...at(confirmed ? (line.confirmed_at ?? findLog(logs, (m) => m.startsWith(`${name} confirmed`))) : undefined),
    },
  ];
}

/** Mercury's floating detail panel for one payment, opened from a row of the pay lines table. */
export function LineDrawer({
  run,
  line,
  logs,
  onClose,
}: {
  run: Run;
  line: PayLine | null;
  logs: RunLogEvent[];
  onClose: () => void;
}) {
  const content = useRef<HTMLDivElement>(null);
  // Keep the last line on screen while the panel animates closed.
  const [last, setLast] = useState<PayLine | null>(line);
  useEffect(() => {
    if (line) setLast(line);
  }, [line]);
  const shown = line ?? last;
  return (
    <DialogPrimitive.Root open={!!line} onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/5 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          className="fixed inset-x-2 top-2 bottom-2 z-50 overflow-y-auto rounded-xl border bg-card text-card-foreground shadow-[0_12px_40px_-12px_rgba(14,14,45,0.28),0_2px_6px_rgba(14,14,45,0.06)] outline-none data-open:animate-in data-open:slide-in-from-right-8 data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 sm:inset-x-auto sm:top-3 sm:right-3 sm:bottom-3 sm:w-[420px]"
          aria-describedby={undefined}
          ref={content}
          onOpenAutoFocus={(e) => {
            // Focus the panel itself, so the first copy button is not highlighted on open.
            e.preventDefault();
            content.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            // The drawer opens from a table row, not a Radix trigger: send focus back to that row.
            e.preventDefault();
            document.querySelector<HTMLElement>(`[data-line-open="${shown?.id ?? ""}"]`)?.focus();
          }}
        >
          {shown ? <DrawerBody run={run} line={shown} logs={logs} /> : null}
          <DialogPrimitive.Close asChild>
            <Button variant="secondary" size="icon-sm" className="absolute top-4 right-4" aria-label="Close">
              <X aria-hidden="true" />
            </Button>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function DrawerBody({ run, line, logs }: { run: Run; line: PayLine; logs: RunLogEvent[] }) {
  const coin = useCoinUnit();
  const c = line.settlement;
  const settlement =
    line.settlement_choice === "convert_usdc"
      ? `Converts to USDC${line.payout_chain ? ` on ${CHAIN_NAMES[line.payout_chain] ?? line.payout_chain}` : ""}`
      : settlementName(line.settlement_choice ?? "hold_zec", coin);
  const facts: [string, React.ReactNode][] = [
    ["Invoice", line.invoice_ref || <span className="text-muted-foreground">None</span>],
    ["Period", runTitle(run)],
    ["Settlement", settlement],
  ];
  if (line.confirmed_at) facts.push(["Paid", formatDateTime(line.confirmed_at)]);
  if (c) {
    facts.push([
      "Conversion",
      c.status === "success"
        ? `${c.delivered_out ?? c.quoted_out} USDC delivered`
        : c.status === "simulated"
          ? "Simulated on testnet"
          : c.status === "refunded" || c.status === "failed"
            ? `Conversion ${c.status}${c.refund_reason ? `: ${c.refund_reason}` : ""}`
            : `About ${c.quoted_out} USDC, converting`,
    ]);
  }
  const memo = decodeMemo(line.memo);
  const testnet = run.funding?.venue === "testnet-fixed-rate" || run.network === "testnet";
  return (
    <div className="flex min-h-full flex-col">
      <div className="px-6 pt-5 pb-6">
        <DialogPrimitive.Title className="pr-10 text-[0.8125rem] font-normal text-strong">
          Payment to {line.contractor_name}
        </DialogPrimitive.Title>
        <div className="mt-6">
          <LineStatus line={line} run={run} />
        </div>
        <p className="mt-3">
          <Usd cents={line.amount_usd_cents} className={TYPE.title} />
        </p>
        {line.amount_zat ? (
          <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">
            <Zec zat={line.amount_zat} />
          </p>
        ) : null}
        <TimelineList items={lineEvents(run, line, logs)} className="mt-5" label="Payment history" />
        {line.error ? (
          // A warning while the line is still in progress; a failure once it has stopped.
          <p
            className={cn(
              "mt-4 rounded-lg px-3 py-2 text-[0.8125rem] text-strong",
              isLineWarning(line) ? "bg-warning-bg" : "bg-danger-bg",
            )}
          >
            {line.error.message} {line.error.hint}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          {line.explorer_url ? (
            <Button asChild variant="secondary" size="sm">
              <a href={line.explorer_url} target="_blank" rel="noreferrer">
                <ExternalLink aria-hidden="true" />
                Open in explorer
              </a>
            </Button>
          ) : null}
          {line.txid ? (
            <CopyButton
              value={line.txid}
              label="transaction id"
              className="h-8 rounded-full border-0 bg-secondary px-3.5 text-[0.8125rem] text-foreground"
            >
              Copy transaction id
            </CopyButton>
          ) : null}
        </div>
      </div>
      <dl className="border-t border-hairline px-6 py-4 text-[0.9375rem]">
        {facts.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 py-2">
            <dt className="text-strong">{k}</dt>
            <dd className="min-w-0 text-right">{v}</dd>
          </div>
        ))}
      </dl>
      {line.memo ? (
        <section aria-labelledby="memo-title" className="border-t border-hairline px-6 py-4">
          <h3 id="memo-title" className="text-[0.8125rem] text-strong">
            Encrypted memo
          </h3>
          <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
            Sealed in the payment. Only {line.contractor_name.split(/\s+/)[0]} and your accountant can read it.
          </p>
          {memo && memo.kind === "pay_line" ? (
            <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-lg bg-raised px-3 py-2.5 text-[0.8125rem]">
              <dt className="text-muted-foreground">Period</dt>
              <dd className="text-right">{formatPeriodLabel(memo.period)}</dd>
              <dt className="text-muted-foreground">Invoice</dt>
              <dd className="text-right [overflow-wrap:anywhere]">{memo.invoiceRef}</dd>
              <dt className="text-muted-foreground">Amount</dt>
              <dd className="text-right">
                <Usd cents={memo.usdCents} />
              </dd>
              <dt className="text-muted-foreground">Rate</dt>
              <dd className="text-right">
                {testnet ? <SimulatedRate rateE6={memo.rateE6} /> : <Rate e6={memo.rateE6} />}
              </dd>
            </dl>
          ) : null}
          <Disclosure summary="Show raw memo" className="mt-3">
            <Sensitive block>
              <code className="block rounded-lg bg-raised px-3 py-2 font-mono text-[0.8125rem] [overflow-wrap:anywhere] text-strong">
                {line.memo}
              </code>
            </Sensitive>
          </Disclosure>
        </section>
      ) : null}
      <div className="border-t border-hairline px-6 py-4">
        <Disclosure summary="Technical details">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[0.8125rem]">
            <dt className="text-muted-foreground">Contractor account</dt>
            <dd className="num text-right">{line.account_index}</dd>
            {line.confirmed_height ? (
              <>
                <dt className="text-muted-foreground">Block</dt>
                <dd className="num text-right">{formatHeight(line.confirmed_height)}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">Pay line</dt>
            <dd className="min-w-0 text-right">
              <code className="font-mono [overflow-wrap:anywhere]">{line.id}</code>
            </dd>
          </dl>
        </Disclosure>
      </div>
    </div>
  );
}
