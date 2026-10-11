"use client";

import { useId } from "react";
import { Usd } from "@/components/app/amount";
import { useCoinUnit } from "@/components/app/health-provider";
import { Initials } from "@/components/ds/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import type { Contractor, Run } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { endsAfterToday } from "@/lib/payroll";
import { cn } from "cn";
import { periodTitle, plural, recentMonths } from "../run-meta";
import {
  clearAmounts,
  copyAmounts,
  INVOICE_MAX,
  setMonth,
  tidyAmount,
  type Draft,
  type DraftCheck,
  type LineDraft,
} from "./draft";
import { OverlapWarning } from "./overlap";
import { FlowTitle } from "./rail";

const CHAIN_NAMES: Record<string, string> = { base: "Base", arb: "Arbitrum", eth: "Ethereum", sol: "Solana" };

/** "Holds TAZ" (testnet) or "Holds ZEC", or "Converts to USDC on Base". */
export function settlementText(c: Pick<Contractor, "settlement_choice" | "payout_chain">, coin: "ZEC" | "TAZ"): string {
  if (c.settlement_choice === "hold_zec") return `Holds ${coin}`;
  const chain = c.payout_chain ? (CHAIN_NAMES[c.payout_chain] ?? c.payout_chain) : null;
  return chain ? `Converts to USDC on ${chain}` : "Converts to USDC";
}

/** Step 1: the period and what each contractor is owed, prefilled from the last run. */
export function AmountsStep({
  draft,
  setDraft,
  contractors,
  check,
  submitted,
  source,
}: {
  draft: Draft;
  setDraft: (update: (d: Draft) => Draft) => void;
  contractors: Contractor[];
  check: DraftCheck;
  submitted: boolean;
  /** The run amounts can be copied from, when there is one. */
  source: Run | undefined;
}) {
  const coin = useCoinUnit();
  const months = recentMonths();
  const periodId = useId();
  const update = (id: string, patch: Partial<LineDraft>) =>
    setDraft((d) => ({ ...d, lines: { ...d.lines, [id]: { ...d.lines[id], ...patch } } }));
  const monthKnown = draft.month === "custom" || months.some((m) => m.key === draft.month);

  return (
    <div>
      <FlowTitle>Amounts</FlowTitle>
      <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">
        What each contractor is owed in US dollars for this period.
      </p>

      <section aria-labelledby={`${periodId}-label`} className="mt-7">
        <label id={`${periodId}-label`} htmlFor={periodId} className="text-[0.8125rem] text-strong">
          Pay period
        </label>
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          <div className="w-full sm:w-56">
            <NativeSelect
              id={periodId}
              value={draft.month}
              onChange={(e) => setDraft((d) => setMonth(d, e.target.value))}
              className="h-10 rounded-[10px] text-[0.9375rem]"
            >
              {!monthKnown ? <option value={draft.month}>{periodTitle(draft.from, draft.to)}</option> : null}
              {months.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
              <option value="custom">Custom range</option>
            </NativeSelect>
          </div>
          {draft.month === "custom" ? (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <label className="sr-only" htmlFor="period-start">
                Period starts
              </label>
              <Input
                id="period-start"
                type="date"
                value={draft.from}
                onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                aria-invalid={submitted && !!check.periodError}
                className="h-10 w-[10.5rem] rounded-[10px]"
              />
              <span className="text-[0.8125rem] text-muted-foreground">to</span>
              <label className="sr-only" htmlFor="period-end">
                Period ends
              </label>
              <Input
                id="period-end"
                type="date"
                value={draft.to}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                aria-invalid={submitted && !!check.periodError}
                aria-describedby={check.periodError ? "period-error" : undefined}
                className="h-10 w-[10.5rem] rounded-[10px]"
              />
            </div>
          ) : null}
        </div>
        {check.periodError && (submitted || draft.month === "custom") ? (
          <p id="period-error" className="mt-1.5 text-[0.8125rem] text-destructive">
            {check.periodError}
          </p>
        ) : !check.periodError && endsAfterToday({ from: draft.from, to: draft.to }) ? (
          <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">
            This period ends on {formatDate(draft.to)}, after today. You can still pay now, for example in advance.
          </p>
        ) : null}
      </section>

      <OverlapWarning runs={check.overlaps} draft={draft} setDraft={setDraft} showError={submitted} className="mt-6" />

      <section aria-label="Pay lines" className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-hairline pb-3">
          <p className="text-[0.8125rem] text-muted-foreground">
            {draft.source
              ? `Amounts from the ${draft.source.label} run. Add this period's invoice references.`
              : "Enter an amount and an invoice reference for each contractor you are paying."}
          </p>
          {draft.source ? (
            <Button type="button" variant="secondary" size="sm" onClick={() => setDraft(clearAmounts)}>
              Clear
            </Button>
          ) : source ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setDraft((d) => copyAmounts(d, source, contractors))}
            >
              Use {periodTitle(source.period_start, source.period_end)} amounts
            </Button>
          ) : null}
        </div>

        <div
          aria-hidden="true"
          className="hidden grid-cols-[20px_minmax(0,1fr)_8.5rem_8.5rem] gap-3 py-2.5 text-[0.8125rem] text-muted-foreground sm:grid"
        >
          <span />
          <span>Contractor</span>
          <span className="text-right">Amount (USD)</span>
          <span>Invoice reference</span>
        </div>

        <ul className="border-t border-hairline sm:border-t-0">
          {contractors.map((c) => {
            const l = draft.lines[c.id] ?? { include: false, amount: "", invoice: "" };
            const err = submitted && l.include ? check.lineErrors[c.id] : undefined;
            const amountBad = err?.field === "amount";
            const invoiceBad = err?.field === "invoice";
            return (
              <li
                key={c.id}
                className={cn(
                  "grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 gap-y-2 border-b border-hairline py-3 sm:grid-cols-[20px_minmax(0,1fr)_8.5rem_8.5rem] sm:items-center",
                )}
              >
                <input
                  id={`include-${c.id}`}
                  type="checkbox"
                  checked={l.include}
                  onChange={(e) => update(c.id, { include: e.target.checked })}
                  className="size-4 self-center rounded accent-[var(--foreground)]"
                />
                <label htmlFor={`include-${c.id}`} className="flex min-w-0 items-center gap-3">
                  <Initials name={c.name} />
                  <span className="min-w-0">
                    <span className={cn("block truncate text-[0.9375rem]", !l.include && "text-muted-foreground")}>
                      {c.name}
                    </span>
                    <span className="block truncate text-[0.8125rem] text-muted-foreground">
                      {l.include ? settlementText(c, coin) : "Not paid in this run"}
                    </span>
                  </span>
                </label>
                <div className="col-start-2 grid grid-cols-2 gap-2 sm:contents">
                  <div className="relative">
                    <label htmlFor={`amount-${c.id}`} className="sr-only">
                      Amount for {c.name}, US dollars
                    </label>
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[0.9375rem] text-muted-foreground"
                    >
                      $
                    </span>
                    <Input
                      id={`amount-${c.id}`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={l.amount}
                      disabled={!l.include}
                      placeholder="0.00"
                      onChange={(e) => update(c.id, { amount: e.target.value })}
                      onBlur={(e) => update(c.id, { amount: tidyAmount(e.target.value) })}
                      className="money h-10 rounded-[10px] pl-6 text-right text-[0.9375rem] tracking-normal"
                      aria-invalid={amountBad}
                      aria-describedby={amountBad ? `line-error-${c.id}` : undefined}
                    />
                  </div>
                  <div>
                    <label htmlFor={`invoice-${c.id}`} className="sr-only">
                      Invoice reference for {c.name}
                    </label>
                    <Input
                      id={`invoice-${c.id}`}
                      value={l.invoice}
                      disabled={!l.include}
                      maxLength={INVOICE_MAX}
                      autoComplete="off"
                      placeholder="Invoice"
                      onChange={(e) => update(c.id, { invoice: e.target.value })}
                      aria-invalid={invoiceBad}
                      aria-describedby={invoiceBad ? `line-error-${c.id}` : undefined}
                      className="h-10 rounded-[10px] text-[0.9375rem]"
                    />
                  </div>
                </div>
                {err ? (
                  <p id={`line-error-${c.id}`} className="col-start-2 text-[0.8125rem] text-destructive sm:col-span-3">
                    {err.message}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
        {submitted && check.countError ? (
          <p role="alert" className="mt-3 text-[0.8125rem] text-destructive">
            {check.countError}
          </p>
        ) : null}
      </section>
    </div>
  );
}

/** The sticky footer of step 1: count and total on the left, Continue on the right. */
export function AmountsFooter({ check, onContinue }: { check: DraftCheck; onContinue: () => void }) {
  return (
    <>
      <p className="min-w-0 text-[0.9375rem]" aria-live="polite">
        <span className="text-muted-foreground">{plural(check.included.length, "contractor")}, </span>
        <Usd cents={check.totalCents} />
      </p>
      <Button size="lg" className="ml-auto" onClick={onContinue}>
        Continue
      </Button>
    </>
  );
}
