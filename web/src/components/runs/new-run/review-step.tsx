"use client";

import { useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { Coin, Usd, Zec } from "@/components/app/amount";
import { Initials } from "@/components/ds/avatar";
import { Card } from "@/components/ds/card";
import { KeyValues } from "@/components/ds/kv";
import { Button } from "@/components/ui/button";
import type { ApiError, Health, Wallet } from "@/lib/api";
import { parseUsdToCents, venueLabel } from "@/lib/format";
import { cn } from "cn";
import { Problem } from "../problem";
import { estimateZat, periodTitle, plural } from "../run-meta";
import type { Draft, DraftCheck } from "./draft";

/** A small gold pill with a lock: the rate a run is converted at (Wise's locked-rate pill). */
export function RatePill({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-[0.84375rem] text-foreground"
    >
      <Lock className="size-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}

const VALIDATION_CODES = new Set([
  "invalid_amount",
  "invalid_period",
  "unknown_contractor",
  "duplicate_contractor_line",
  "invoice_ref_too_long",
  "invalid_invoice_ref",
]);

/** Step 2: Mercury's "Review batch payment". Approving creates the run; nothing moves yet. */
export function ReviewStep({
  draft,
  check,
  health,
  wallet,
  simulatedRate,
  busy,
  error,
  onBack,
  onApprove,
}: {
  draft: Draft;
  check: DraftCheck;
  health: Health | undefined;
  wallet: Wallet | undefined;
  /** The testnet venue's fixed rate, from an earlier testnet funding record. */
  simulatedRate: number | null;
  busy: boolean;
  error: ApiError | null;
  onBack: () => void;
  onApprove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const testnet = health?.network === "testnet" || health?.venue === "testnet-fixed-rate";
  const n = check.included.length;
  const title = periodTitle(draft.from, draft.to);
  const amounts = check.included.map((c) => parseUsdToCents(draft.lines[c.id].amount) ?? 0);
  const estimate = testnet ? estimateZat(amounts, simulatedRate) : null;
  const spendable = wallet?.treasury.spendable_zat;
  const short = estimate !== null && spendable !== undefined && spendable < estimate;
  const appFee = health?.app_fee_bps ?? 0;

  const items = [
    {
      label: "From",
      value: "Treasury",
      hint: (
        <>
          Account 0
          {wallet ? (
            <>
              {" · "}
              <Zec zat={wallet.treasury.spendable_zat} short /> available
            </>
          ) : null}
          {short ? (
            <span className="mt-1 block text-warning">
              The treasury holds less than this run needs. Top it up before you fund.
            </span>
          ) : null}
        </>
      ),
    },
    {
      label: "Funding",
      value: testnet ? (
        <span className="flex flex-wrap items-center gap-2">
          Drawn from the testnet treasury <RatePill>Simulated rate</RatePill>
        </span>
      ) : (
        "USDC from your wallet"
      ),
      hint: testnet
        ? "Testnet coins have no price, so a fixed rate turns dollars into TAZ."
        : `Swapped to ZEC through ${venueLabel(health?.venue)}. You pick the chain and see the exact amount to send next.`,
    },
    {
      label: "Contractors get",
      value:
        estimate !== null ? (
          <span>
            about <Zec zat={estimate} short />
          </span>
        ) : testnet ? (
          <>
            <Coin /> at the simulated rate
          </>
        ) : (
          "ZEC at the quoted rate"
        ),
      hint:
        estimate !== null ? (
          <>
            Worth <Usd cents={check.totalCents} /> at the simulated rate
          </>
        ) : testnet ? (
          "Set when the run is funded."
        ) : (
          "The rate is locked when you fund the run."
        ),
    },
    {
      label: "Fees",
      value: testnet ? "Network fees only" : "Network and swap fees",
      hint: testnet
        ? `Paid in TAZ from the treasury and shown on the run once sent. ${appFee > 0 ? `Payslip fee ${appFee / 100}%.` : "No Payslip fee."}`
        : `Shown in the quote before you send. ${appFee > 0 ? `Payslip fee ${appFee / 100}% of the swap.` : "No Payslip fee."}`,
    },
    {
      label: "Pay lines",
      value: (
        <div>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="review-lines"
            className="inline-flex items-center gap-1 rounded-sm text-link hover:underline"
          >
            {plural(n, "contractor")} · {title}
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </button>
          {open ? (
            <ul id="review-lines" className="mt-2 border-t border-hairline">
              {check.included.map((c) => {
                const l = draft.lines[c.id];
                return (
                  <li key={c.id} className="flex items-center gap-3 border-b border-hairline py-2.5">
                    <Initials name={c.name} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{c.name}</span>
                      <span className="block truncate text-[0.8125rem] text-muted-foreground">
                        {l.invoice.trim() || "No invoice reference"}
                      </span>
                    </span>
                    <Usd cents={parseUsdToCents(l.amount) ?? 0} />
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div>
      <h1 className="text-[1.75rem] leading-tight font-[380] tracking-[-0.015em]">Review payroll for {title}</h1>

      <Card className="mt-5 px-6 py-7 shadow-[0_2px_6px_rgba(14,14,45,0.05)] sm:px-6">
        <p className="text-[0.8125rem] text-strong">Total for {plural(n, "contractor")}</p>
        <Usd cents={check.totalCents} className="mt-2.5 block text-[2.125rem] leading-none font-[380]" />
      </Card>
      <p className="mt-4 text-[0.9375rem] text-muted-foreground">
        Each contractor gets one shielded payment that only they and your accountant can read.
      </p>

      <div className="mt-5 border-t border-hairline pt-5">
        <KeyValues items={items} />
      </div>

      {!check.valid ? (
        <Problem
          className="mt-6"
          error={{
            message: "Some amounts need attention.",
            hint: check.noneError ?? check.periodError ?? "Go back to Amounts to fix them.",
          }}
          action={
            <Button size="sm" variant="secondary" onClick={onBack}>
              Back to amounts
            </Button>
          }
        />
      ) : null}
      {error ? (
        <Problem
          className="mt-6"
          error={error}
          title="The run was not created"
          action={
            VALIDATION_CODES.has(error.code) ? (
              <Button size="sm" variant="secondary" onClick={onBack}>
                Back to amounts
              </Button>
            ) : undefined
          }
          onRetry={VALIDATION_CODES.has(error.code) ? undefined : onApprove}
          busy={busy}
        />
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2.5 border-t border-hairline pt-6">
        <Button variant="secondary" size="lg" onClick={onBack} disabled={busy}>
          Back
        </Button>
        <Button size="lg" onClick={onApprove} disabled={busy || !check.valid}>
          {busy ? "Approving" : "Approve"}
        </Button>
      </div>
      <p className="mt-3 max-w-[56ch] text-[0.78125rem] leading-relaxed text-muted-foreground">
        By clicking Approve, I authorise Payslip to pay the {plural(n, "contractor")} above a total of{" "}
        <Usd cents={check.totalCents} /> from the treasury. Nothing is sent until I confirm the funding and the payment.
      </p>
    </div>
  );
}
