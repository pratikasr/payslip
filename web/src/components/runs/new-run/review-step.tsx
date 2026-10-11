"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronDown, Lock } from "lucide-react";
import { Coin, Usd, Zec } from "@/components/app/amount";
import { useHealth } from "@/components/app/health-provider";
import { Initials } from "@/components/ds/avatar";
import { Card } from "@/components/ds/card";
import { KeyValues } from "@/components/ds/kv";
import { SimulatedRate } from "@/components/ds/simulated-rate";
import { Button } from "@/components/ui/button";
import type { ApiError, Health, Run, Wallet } from "@/lib/api";
import { formatDate, parseUsdToCents, venueLabel } from "@/lib/format";
import { feeReserveZat } from "@/lib/payroll";
import { TESTNET_FAUCET_URL } from "@/lib/public-url";
import { cn } from "cn";
import { Problem } from "../problem";
import { estimateZat, periodTitle, plural, runTitle } from "../run-meta";
import type { Draft, DraftCheck } from "./draft";
import { OverlapWarning } from "./overlap";
import { FlowTitle } from "./rail";

/**
 * A run the approval's idempotency key already made with other amounts. The service names it
 * (409 idempotency_mismatch, `run` then comes from the loaded list when it is there), or an
 * older service answered with it directly. Never treated as approval.
 */
export interface Mismatch {
  id: string;
  run: Run | null;
}

/** A small gold pill with a lock: a mainnet quote's locked rate (Wise's locked-rate pill). */
export function RatePill({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-full bg-primary-soft px-2.5 py-1 text-[0.8125rem] text-foreground"
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
  "too_many_lines",
  "no_lines",
]);

/** Up to this many lines, Review lists every line without a click. */
const SHOW_LINES_UP_TO = 10;

/** Step 2: Mercury's "Review batch payment". Approving creates the run; nothing moves yet. */
export function ReviewStep({
  draft,
  check,
  health,
  wallet,
  simulatedRate,
  busy,
  error,
  mismatch,
  setDraft,
  submitted,
  onBack,
  onApprove,
  onApproveAsNew,
}: {
  draft: Draft;
  check: DraftCheck;
  health: Health | undefined;
  wallet: Wallet | undefined;
  /** The testnet venue's fixed rate, from an earlier testnet funding record. */
  simulatedRate: number | null;
  busy: boolean;
  error: ApiError | null;
  /** The run this approval's key already made with other amounts, when there is one. */
  mismatch: Mismatch | null;
  setDraft: (update: (d: Draft) => Draft) => void;
  submitted: boolean;
  onBack: () => void;
  onApprove: () => void;
  onApproveAsNew: () => void;
}) {
  // The approval restates who gets what: every line shows unless the run is long.
  const [open, setOpen] = useState(check.included.length <= SHOW_LINES_UP_TO);
  const { network } = useHealth();
  const testnet = network === "testnet" || health?.venue === "testnet-fixed-rate";
  const n = check.included.length;
  const title = periodTitle(draft.from, draft.to);
  const amounts = check.included.map((c) => parseUsdToCents(draft.lines[c.id].amount) ?? 0);
  const estimate = testnet ? estimateZat(amounts, simulatedRate) : null;
  const converting = check.included.filter((c) => c.settlement_choice === "convert_usdc").length;
  const reserve = n > 0 ? feeReserveZat(n, converting) : 0;
  const spendable = wallet?.treasury.spendable_zat;
  const empty = spendable === 0;
  const short = !empty && estimate !== null && spendable !== undefined && spendable < estimate + reserve;
  // Problems Review can show for itself; the period overlap has its own box below.
  const otherProblems = !!check.countError || !!check.periodError || Object.keys(check.lineErrors).length > 0;
  const appFee = health?.app_fee_bps ?? 0;

  const items = [
    {
      label: "From",
      value: "Treasury",
      hint: (
        <>
          {wallet ? (
            <>
              <Zec zat={wallet.treasury.spendable_zat} short /> available
            </>
          ) : testnet ? (
            "Balance unavailable"
          ) : (
            "Funded with USDC for this run"
          )}
          {short ? (
            <span className="mt-1 block text-warning">
              The treasury holds less than this run needs. Top it up before you fund.
            </span>
          ) : null}
          {empty ? (
            <span className="mt-1 block text-warning">
              The treasury is empty, so this run cannot be funded yet.{" "}
              <Link href="/console/treasury" className="text-link underline">
                Fund the treasury
              </Link>
              {testnet ? (
                <>
                  {" "}
                  with free coins from a{" "}
                  <a href={TESTNET_FAUCET_URL} target="_blank" rel="noreferrer" className="text-link underline">
                    testnet faucet
                  </a>
                </>
              ) : null}{" "}
              first. You can still approve now.
            </span>
          ) : null}
        </>
      ),
    },
    {
      label: "Funding",
      value: testnet ? (
        <span className="flex flex-wrap items-center gap-2">
          Set aside from the testnet treasury <SimulatedRate rateE6={simulatedRate} />
        </span>
      ) : health?.fund_with_zec ? (
        "ZEC sent to the treasury, or USDC from your wallet"
      ) : (
        "USDC from your wallet"
      ),
      hint: testnet
        ? "Testnet coins have no price, so a fixed rate turns payroll dollars into TAZ."
        : health?.fund_with_zec
          ? `You choose next: send ZEC to the treasury address (funded at the market rate when it confirms), or USDC swapped to ZEC through ${venueLabel(health?.venue)}.`
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
            <Usd cents={check.totalCents} /> becomes about <Zec zat={estimate} short /> at the simulated rate.
          </>
        ) : testnet ? (
          "Set when the run is funded."
        ) : (
          "The rate is locked when you fund the run."
        ),
    },
    {
      label: "Fees",
      value: testnet ? (
        <>
          Network fees, up to <Zec zat={reserve} />
        </>
      ) : (
        "Network and swap fees"
      ),
      hint: testnet
        ? `Real fees, paid in TAZ from a reserve set aside with the run; what is unspent stays in the treasury. ${appFee > 0 ? `Payslip fee ${appFee / 100}%.` : "No Payslip fee."}`
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
                      <span className="block truncate" title={c.name}>
                        {c.name}
                      </span>
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
      <FlowTitle>Review payroll for {title}</FlowTitle>

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

      <OverlapWarning runs={check.overlaps} draft={draft} setDraft={setDraft} showError={submitted} className="mt-6" />

      {mismatch ? (
        <Problem
          className="mt-6"
          error={{
            message: mismatch.run
              ? `This approval already made a run with other amounts: ${runTitle(mismatch.run)}, ${plural(mismatch.run.lines.length, "contractor")}, created ${formatDate(mismatch.run.created_at)}.`
              : "This approval already made a run with other amounts.",
            hint: "It does not match the amounts above, so nothing moves on. Open it to check, or approve these amounts as a new run.",
          }}
          title="This is not the run you reviewed"
          action={
            <>
              <Button asChild size="sm" variant="secondary">
                <Link href={`/console/runs/${mismatch.id}`}>Open that run</Link>
              </Button>
              <Button size="sm" variant="secondary" onClick={onApproveAsNew} disabled={busy}>
                Approve as a new run
              </Button>
            </>
          }
        />
      ) : null}

      {otherProblems ? (
        <Problem
          className="mt-6"
          error={{
            message: "Some amounts need attention.",
            hint: check.countError ?? check.periodError ?? "Go back to Amounts to fix them.",
          }}
          action={
            <Button size="sm" variant="secondary" onClick={onBack}>
              Back to amounts
            </Button>
          }
        />
      ) : null}
      {error && error.code === "period_overlap" ? (
        <Problem
          className="mt-6"
          title="Another run already covers this period"
          error={{
            message: "The run was not created. It may have been made in another tab or by someone else.",
            hint: check.overlapUnconfirmed
              ? "Check the runs named above. To pay this period again anyway, tick the extra-run box, then approve."
              : "The runs above cover this period. Approve again to make this an extra run.",
          }}
        />
      ) : error ? (
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
          // An overlap is answered by the box above (the runs reload with the error), not by
          // sending the same request again.
          onRetry={VALIDATION_CODES.has(error.code) || error.code === "period_overlap" ? undefined : onApprove}
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
      <p className="mt-3 max-w-[56ch] text-[0.8125rem] leading-relaxed text-muted-foreground">
        By clicking Approve, I authorise Payslip to pay the {plural(n, "contractor")} above a total of{" "}
        <Usd cents={check.totalCents} /> from the treasury. Nothing is sent until I confirm the funding and the payment.
      </p>
    </div>
  );
}
