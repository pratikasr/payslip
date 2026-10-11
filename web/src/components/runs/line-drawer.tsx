"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Rate, Usd, Zec } from "@/components/app/amount";
import { CopyButton } from "@/components/app/copy-button";
import { Hash } from "@/components/app/hash";
import { useCoinUnit } from "@/components/app/health-provider";
import { Disclosure } from "@/components/ds/disclosure";
import { FormRow, FormRows } from "@/components/ds/paper";
import { Sensitive } from "@/components/ds/sensitive";
import { SimulatedRate } from "@/components/ds/simulated-rate";
import { Timeline as TimelineList, type TimelineItem } from "@/components/ds/timeline";
import { Button } from "@/components/ui/button";
import type { PayLine, Run, RunLogEvent } from "@/lib/api";
import { formatDateTime, formatHeight, formatPeriodLabel, settlementName } from "@/lib/format";
import { decodeMemo } from "@/lib/memo";
import { cn } from "cn";
import { TYPE } from "@/components/ds/type";
import { atSimulatedRate, isLineWarning, LineStatus, runTitle } from "./run-meta";

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

/**
 * One payment as a pay advice slid out over the run, opened from a row of the pay lines table:
 * the title and the one large amount, its typed history, then its rows on green bar.
 */
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
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/10 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          className="paper sheet-shadow fixed inset-x-2 top-2 bottom-2 z-50 overflow-y-auto border border-ink text-card-foreground outline-none data-open:animate-in data-open:slide-in-from-right-8 data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 sm:inset-x-auto sm:top-3 sm:right-3 sm:bottom-3 sm:w-[420px]"
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
  const testnet = atSimulatedRate(run);
  return (
    <div className="flex min-h-full flex-col">
      <div className="px-6 pt-5 pb-6">
        <p className="form-label pr-10 text-[0.75rem] font-bold text-muted-foreground">Pay advice</p>
        <DialogPrimitive.Title className="inked mt-1 pr-10 font-display text-[1.375rem] leading-[1.1] font-bold">
          Payment to {line.contractor_name}
        </DialogPrimitive.Title>
        <div className="mt-5">
          <LineStatus line={line} run={run} />
        </div>
        <p className={cn(TYPE.hero, "mt-3")}>
          <Usd cents={line.amount_usd_cents} />
        </p>
        {line.amount_zat ? (
          <p className="mt-2 font-type text-[0.9375rem] text-muted-foreground">
            <Zec zat={line.amount_zat} />
          </p>
        ) : null}
        <TimelineList items={lineEvents(run, line, logs)} className="mt-5" label="Payment history" />
        {line.error ? (
          // A warning while the line is still in progress; a failure once it has stopped.
          <p
            className={cn(
              "mt-4 border px-3 py-2 text-[0.8125rem] text-strong",
              isLineWarning(line) ? "carbon-paper border-carbon-line" : "border-destructive bg-danger-bg",
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
              className="h-8 border-2 border-foreground px-3.5 text-[0.8125rem] text-foreground hover:bg-muted"
            >
              Copy transaction id
            </CopyButton>
          ) : null}
        </div>
      </div>
      <div className="border-t border-ink px-6 py-4">
        <FormRows className="border border-bar-line">
          {facts.map(([k, v]) => (
            <FormRow key={k} label={k} valueClassName="[overflow-wrap:anywhere]">
              {v}
            </FormRow>
          ))}
        </FormRows>
      </div>
      {line.memo ? (
        <section aria-labelledby="memo-title" className="border-t border-ink px-6 py-4">
          <h3 id="memo-title" className="form-label text-[0.75rem] font-bold">
            Encrypted memo
          </h3>
          <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
            Sealed in the payment. Only {line.contractor_name.split(/\s+/)[0]} and your accountant can read it.
          </p>
          {memo && memo.kind === "pay_line" ? (
            <FormRows tone="ruled" className="mt-2 border border-rule text-[0.8125rem] sm:text-[0.875rem]">
              <FormRow label="Period">{formatPeriodLabel(memo.period)}</FormRow>
              <FormRow label="Invoice" valueClassName="[overflow-wrap:anywhere]">
                {memo.invoiceRef}
              </FormRow>
              <FormRow label="Amount">
                <Usd cents={memo.usdCents} />
              </FormRow>
              <FormRow label="Rate">
                {testnet ? <SimulatedRate rateE6={memo.rateE6} /> : <Rate e6={memo.rateE6} />}
              </FormRow>
            </FormRows>
          ) : null}
          <Disclosure summary="Show raw memo" className="mt-3">
            <Sensitive block>
              <code className="block border border-bar-line bg-bar px-3 py-2 font-type text-[0.8125rem] [overflow-wrap:anywhere] text-strong">
                {line.memo}
              </code>
            </Sensitive>
          </Disclosure>
        </section>
      ) : null}
      <div className="border-t border-ink px-6 py-4">
        <Disclosure summary="Technical details">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 font-type text-[0.8125rem]">
            <dt className="form-label text-[0.75rem] text-muted-foreground">Contractor account</dt>
            <dd className="num text-right">{line.account_index}</dd>
            {line.confirmed_height ? (
              <>
                <dt className="form-label text-[0.75rem] text-muted-foreground">Block</dt>
                <dd className="num text-right">{formatHeight(line.confirmed_height)}</dd>
              </>
            ) : null}
            <dt className="form-label text-[0.75rem] text-muted-foreground">Pay line</dt>
            <dd className="min-w-0 text-right">
              <code className="font-type [overflow-wrap:anywhere]">{line.id}</code>
            </dd>
          </dl>
        </Disclosure>
      </div>
    </div>
  );
}
