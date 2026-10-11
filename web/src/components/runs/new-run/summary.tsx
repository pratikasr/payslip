"use client";

import type { ReactNode } from "react";
import { Usd, Zec } from "@/components/app/amount";
import { useHealth } from "@/components/app/health-provider";
import { Card } from "@/components/ds/card";
import { SimulatedRate } from "@/components/ds/simulated-rate";
import { ShieldedMark } from "@/components/ds/status";
import type { Run, Wallet } from "@/lib/api";
import { parseUsdToCents } from "@/lib/format";
import { feeReserveZat, runCoin } from "@/lib/payroll";
import { confirmedCount, estimateZat, periodTitle, plural, RunTag, runTitle } from "../run-meta";
import type { Draft, DraftCheck } from "./draft";

/** One field of the summary: its spaced-caps caption over the typed value, on green bar. */
function Row({ label, children, sub }: { label: ReactNode; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="grid gap-0.5 border-t border-bar-line px-2 py-2">
      <dt className="form-label text-[0.75rem] font-bold text-muted-foreground">{label}</dt>
      <dd className="min-w-0 font-type text-[0.875rem]">
        {children}
        {sub ? <span className="block font-sans text-[0.75rem] text-muted-foreground">{sub}</span> : null}
      </dd>
    </div>
  );
}

function Frame({
  total,
  people,
  children,
  tag,
}: {
  total: number;
  people: number;
  children: ReactNode;
  tag?: ReactNode;
}) {
  return (
    <Card as="div" className="px-5 py-5 sm:px-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="form-label text-[0.75rem] font-bold">Summary</h2>
        {tag}
      </div>
      <p className="inked mt-3 font-dot text-[2rem] leading-none [&_.money]:font-dot">
        <Usd cents={total} />
      </p>
      <p className="mt-2 font-type text-[0.8125rem] text-muted-foreground">to {plural(people, "person", "people")}</p>
      <dl className="green-bar mt-4 border-b border-bar-line">{children}</dl>
      <ShieldedMark className="mt-3" label="Every payment shielded" explain />
    </Card>
  );
}

/**
 * Amounts and Review: what is about to be approved, beside the step (Mercury's send flow).
 * Coin is an estimate at the simulated rate on testnet; on mainnet the rate is set by the quote.
 */
export function DraftSummary({
  draft,
  check,
  wallet,
  simulatedRate,
}: {
  draft: Draft;
  check: DraftCheck;
  wallet: Wallet | undefined;
  simulatedRate: number | null;
}) {
  const { network } = useHealth();
  const testnet = network === "testnet";
  const n = check.included.length;
  const amounts = check.included.map((c) => parseUsdToCents(draft.lines[c.id].amount) ?? 0);
  const estimate = testnet ? estimateZat(amounts, simulatedRate) : null;
  const converting = check.included.filter((c) => c.settlement_choice === "convert_usdc").length;
  const reserve = n > 0 ? feeReserveZat(n, converting) : null;
  return (
    <Frame total={check.totalCents} people={n} tag={testnet ? <SimulatedRate rateE6={simulatedRate} /> : null}>
      <Row label="Period">{periodTitle(draft.from, draft.to)}</Row>
      <Row label="Contractors get" sub={testnet ? "At the simulated rate" : "At the rate the quote locks"}>
        {estimate !== null ? (
          <>
            about <Zec zat={estimate} />
          </>
        ) : (
          "Set when you fund"
        )}
      </Row>
      {testnet && reserve !== null ? (
        <Row label="Fee reserve" sub="Real network fees; the rest stays in the treasury">
          up to <Zec zat={reserve} />
        </Row>
      ) : (
        <Row label="Fees">Shown in the quote</Row>
      )}
      {testnet && wallet ? (
        <Row label="Treasury">
          <Zec zat={wallet.treasury.spendable_zat} /> <span className="text-muted-foreground">available</span>
        </Row>
      ) : null}
    </Frame>
  );
}

/** Fund, Pay and Paid: the run's own figures, the coin it set aside and the fees it paid. */
export function RunSummary({ run, simulatedRate }: { run: Run; simulatedRate: number | null }) {
  const testnet = run.funding?.venue === "testnet-fixed-rate" || run.network === "testnet";
  const rate = run.funding?.rate_usd_per_zec_e6 ?? (testnet ? simulatedRate : null);
  const coin = runCoin(run);
  const estimate =
    coin.paid ??
    estimateZat(
      run.lines.map((l) => l.amount_usd_cents),
      rate,
    );
  const n = run.lines.length;
  return (
    <Frame
      total={run.total_usd_cents}
      people={n}
      tag={testnet ? <SimulatedRate rateE6={rate} /> : <RunTag run={run} />}
    >
      <Row label="Period">{runTitle(run)}</Row>
      <Row label="Status">
        <RunTag run={run} />
      </Row>
      <Row label={run.status === "paid" ? "Contractors got" : "Contractors get"}>
        {estimate !== null ? (
          <>
            {coin.paid === null ? "about " : null}
            <Zec zat={estimate} />
          </>
        ) : (
          "Set when you fund"
        )}
      </Row>
      {coin.fees !== null && coin.fees > 0 ? (
        <Row label="Network fees" sub={run.status === "paid" ? undefined : "So far"}>
          <Zec zat={coin.fees} />
        </Row>
      ) : coin.reserve !== null ? (
        <Row label="Fee reserve" sub="What is unspent stays in the treasury">
          <Zec zat={coin.reserve} />
        </Row>
      ) : null}
      {coin.unspent !== null ? (
        <Row label="Back in treasury" sub="The unspent fee reserve">
          <Zec zat={coin.unspent} />
        </Row>
      ) : null}
      {run.status !== "draft" && n > 0 ? (
        <Row label="Confirmed">
          <span className="num">
            {confirmedCount(run.lines)} of {n}
          </span>
        </Row>
      ) : null}
    </Frame>
  );
}
