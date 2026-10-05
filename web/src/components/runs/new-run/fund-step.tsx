"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Coin, Usd, Zec } from "@/components/app/amount";
import { Hash } from "@/components/app/hash";
import { useHealth } from "@/components/app/health-provider";
import { Card } from "@/components/ds/card";
import { Tag } from "@/components/ds/tag";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { checkEvmAddress } from "@/lib/addresses";
import { api, isEvmFunding, toDisplayError, type ApiError, type Funding, type Run, type Wallet } from "@/lib/api";
import { evmChainName, ORIGIN_CHAINS } from "@/lib/evm";
import { formatDateTime, formatRate, venueLabel } from "@/lib/format";
import { Problem } from "../problem";
import { estimateZat, plural, retryOnce, runTitle } from "../run-meta";
import { RatePill } from "./review-step";

const WalletPay = dynamic(() => import("./wallet-pay"), {
  ssr: false,
  loading: () => (
    <div role="status" aria-label="Loading wallet connection" className="flex gap-3">
      <Skeleton className="h-10 w-40 rounded-full" />
      <Skeleton className="h-10 w-48 rounded-full" />
    </div>
  ),
});

const QrCode = dynamic(() => import("@/components/app/qr-code"), {
  ssr: false,
  loading: () => <Skeleton className="size-[184px]" />,
});

const POLL_MS = 5_000;
const FAILED_FUNDING = new Set(["refunded", "failed", "expired"]);

function Heading({ run, children }: { run: Run; children?: React.ReactNode }) {
  return (
    <>
      <h1 className="text-[1.75rem] leading-tight font-[380] tracking-[-0.015em]">Fund {runTitle(run)} payroll</h1>
      {children ? <p className="mt-1.5 text-[0.9375rem] text-muted-foreground">{children}</p> : null}
    </>
  );
}

/** A label and value row inside the quote card. */
function QuoteRow({
  label,
  children,
  sub,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-t border-hairline py-3 text-[0.9375rem]">
      <span className="text-strong">{label}</span>
      <span className="text-right">
        {children}
        {sub ? <span className="block text-[0.8125rem] text-muted-foreground">{sub}</span> : null}
      </span>
    </div>
  );
}

/** Step 3. Testnet draws from the treasury at the simulated rate; mainnet asks for a USDC deposit. */
export function FundStep({
  run,
  onRun,
  wallet,
  simulatedRate,
}: {
  run: Run;
  onRun: (run: Run) => void;
  wallet: Wallet | undefined;
  simulatedRate: number | null;
}) {
  const { health } = useHealth();
  const venue = run.funding?.venue ?? health?.venue;
  if (!venue) {
    return (
      <div role="status" aria-label="Loading funding options" className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }
  if (venue === "testnet-fixed-rate")
    return <TestnetFund run={run} onRun={onRun} wallet={wallet} simulatedRate={simulatedRate} />;
  if (!run.funding || run.status === "draft")
    return <QuoteForm run={run} onRun={onRun} venueName={venueLabel(venue)} />;
  return <DepositQuote run={run} onRun={onRun} />;
}

function TestnetFund({
  run,
  onRun,
  wallet,
  simulatedRate,
}: {
  run: Run;
  onRun: (run: Run) => void;
  wallet: Wallet | undefined;
  simulatedRate: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const n = run.lines.length;
  const estimate = estimateZat(
    run.lines.map((l) => l.amount_usd_cents),
    simulatedRate,
  );

  const fund = async () => {
    setBusy(true);
    setError(null);
    try {
      onRun(await retryOnce(() => api.fundRun(run.id, {})));
      setOpen(false);
    } catch (err) {
      setError(toDisplayError(err));
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Heading run={run}>Testnet runs are funded from the treasury. No deposit is needed.</Heading>

      <Card className="mt-6 px-6 py-6 shadow-[0_2px_6px_rgba(14,14,45,0.05)] sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.8125rem] text-strong">You fund exactly</p>
          <RatePill title="Testnet coins have no price, so the testnet venue converts at a fixed rate.">
            Simulated rate
          </RatePill>
        </div>
        <Usd cents={run.total_usd_cents} className="mt-2 mb-4 block text-[2rem] leading-none font-[380]" />
        <QuoteRow label="Contractors get" sub={`${plural(n, "shielded payment")} at the simulated rate`}>
          {estimate !== null ? (
            <>
              about <Zec zat={estimate} short />
            </>
          ) : (
            <>
              <Coin /> at the simulated rate
            </>
          )}
        </QuoteRow>
        <QuoteRow
          label="From"
          sub={
            wallet ? (
              <>
                <Zec zat={wallet.treasury.spendable_zat} short /> available
              </>
            ) : undefined
          }
        >
          Treasury, account 0
        </QuoteRow>
        <QuoteRow label="Fees" sub="Taken from the treasury when the payments are sent">
          Network fees only
        </QuoteRow>
      </Card>

      {error ? (
        <Problem className="mt-5" error={error} title="The run was not funded" onRetry={fund} busy={busy} />
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={() => setOpen(true)} disabled={busy}>
          Fund from treasury
        </Button>
        {busy && !open ? <FundingNote /> : null}
      </div>
      {run.status === "draft" ? <DiscardRun run={run} /> : null}

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="gap-5 p-6 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-normal">
              Fund <Usd cents={run.total_usd_cents} /> from the treasury?
            </DialogTitle>
            <DialogDescription className="text-[0.9375rem]">
              This sets aside{" "}
              {estimate !== null ? (
                <>
                  about <Zec zat={estimate} short />
                </>
              ) : (
                <>
                  <Coin />
                </>
              )}{" "}
              plus network fees for the {plural(n, "contractor")} in the {runTitle(run)} run, at the simulated rate. You
              send the payments on the next step.
            </DialogDescription>
          </DialogHeader>
          {busy ? <FundingNote /> : null}
          <DialogFooter className="-mx-6 -mb-6 bg-transparent px-6 pb-6">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={fund} disabled={busy}>
              {busy ? (
                "Funding"
              ) : (
                <>
                  Fund <Usd cents={run.total_usd_cents} />
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** What the service is doing while it funds a testnet run (it syncs the treasury first). */
function FundingNote() {
  return (
    <p className="text-sm text-muted-foreground" role="status">
      Checking the treasury against the chain, then setting this run&apos;s funds aside.
    </p>
  );
}

function QuoteForm({ run, onRun, venueName }: { run: Run; onRun: (run: Run) => void; venueName: string }) {
  const [chain, setChain] = useState<string>("base");
  const [refund, setRefund] = useState("");
  const [refundError, setRefundError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const check = checkEvmAddress(refund);
    setRefundError(check ? check.replace("payout address", "refund address") : null);
    if (check) return;
    setBusy(true);
    setError(null);
    try {
      onRun(await api.fundRun(run.id, { origin_chain: chain, refund_address: refund.trim() }));
    } catch (err) {
      setError(toDisplayError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <Heading run={run}>Send USDC from any wallet. {venueName} swaps it to ZEC straight into the treasury.</Heading>
      <Card className="mt-6 space-y-5 px-6 py-6 sm:px-6">
        <div>
          <p className="text-[0.8125rem] text-strong">Payroll total</p>
          <Usd cents={run.total_usd_cents} className="mt-2 block text-[2rem] leading-none font-[380]" />
        </div>
        <div className="grid gap-4 border-t border-hairline pt-5 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <label htmlFor="origin-chain" className="text-[0.8125rem] text-strong">
              Pay USDC from
            </label>
            <NativeSelect
              id="origin-chain"
              value={chain}
              onChange={(e) => setChain(e.target.value)}
              className="h-10 rounded-[10px]"
            >
              {ORIGIN_CHAINS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="refund-address" className="text-[0.8125rem] text-strong">
              Refund address
            </label>
            <Input
              id="refund-address"
              value={refund}
              onChange={(e) => setRefund(e.target.value)}
              placeholder="0x"
              spellCheck={false}
              autoComplete="off"
              className="h-10 rounded-[10px] font-mono text-xs"
              aria-invalid={!!refundError}
              aria-describedby={refundError ? "refund-address-error" : "refund-address-help"}
            />
            {refundError ? (
              <p id="refund-address-error" className="text-sm text-destructive">
                {refundError}
              </p>
            ) : (
              <p id="refund-address-help" className="text-[0.8125rem] text-muted-foreground">
                Yours, on the same chain. Used only if the swap cannot complete.
              </p>
            )}
          </div>
        </div>
      </Card>
      {error ? <Problem className="mt-5" error={error} title="No quote yet" /> : null}
      <div className="mt-6">
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? "Getting a quote" : "Get quote"}
        </Button>
      </div>
      {run.status === "draft" ? <DiscardRun run={run} /> : null}
    </form>
  );
}

/** USDC amount string ("28462.150000") to whole cents, rounded up. */
function usdcToCents(amount: string): number | null {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(6, "0").slice(0, 6);
  const micro = BigInt(m[1]) * 1_000_000n + BigInt(frac);
  const cents = (micro + 9_999n) / 10_000n;
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null;
}

function groupAmount(amount: string): string {
  const [whole, frac] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}

/** The mainnet quote: Wise's card (locked rate, you send exactly, contractors get, fees), then the deposit. */
function DepositQuote({ run, onRun }: { run: Run; onRun: (run: Run) => void }) {
  const { health } = useHealth();
  const funding = run.funding as Funding & { quote_rate_e6?: number | null };
  const [pollError, setPollError] = useState<ApiError | null>(null);
  const [requoting, setRequoting] = useState(false);
  const [requoteError, setRequoteError] = useState<ApiError | null>(null);
  const [refund, setRefund] = useState("");
  const onRunRef = useRef(onRun);
  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  const waiting = run.status === "awaiting_funds" && !FAILED_FUNDING.has(funding.status);

  // Ask the venue every 5 seconds until it reports the run funded.
  useEffect(() => {
    if (!waiting) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ctrl = new AbortController();
    const tick = async () => {
      try {
        const next = await api.pollFunding(run.id, ctrl.signal);
        if (stopped) return;
        setPollError(null);
        onRunRef.current(next);
      } catch (err) {
        if (stopped || ctrl.signal.aborted) return;
        setPollError(toDisplayError(err));
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      ctrl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [waiting, run.id]);

  const requote = async () => {
    const check = checkEvmAddress(refund);
    if (check) {
      setRequoteError(toDisplayError(new Error(check.replace("payout address", "refund address"))));
      return;
    }
    setRequoting(true);
    setRequoteError(null);
    try {
      onRun(await api.fundRun(run.id, { origin_chain: funding.origin_chain ?? "base", refund_address: refund.trim() }));
    } catch (err) {
      setRequoteError(toDisplayError(err));
    } finally {
      setRequoting(false);
    }
  };

  const evm = isEvmFunding(funding) ? funding : null;
  const chainName = evm ? evmChainName(evm.chain_id, funding.origin_chain ?? undefined) : (funding.origin_chain ?? "");
  const rate = funding.rate_usd_per_zec_e6 ?? funding.quote_rate_e6 ?? null;
  const zat = estimateZat(
    run.lines.map((l) => l.amount_usd_cents),
    rate,
  );
  const sendCents = usdcToCents(funding.amount_in);
  const feeCents = sendCents !== null ? Math.max(0, sendCents - run.total_usd_cents) : null;
  const appFee = health?.app_fee_bps ?? 0;

  return (
    <div>
      <Heading run={run}>Send the exact amount below. The treasury receives ZEC as soon as the swap completes.</Heading>

      <Card className="mt-6 px-6 py-6 shadow-[0_2px_6px_rgba(14,14,45,0.05)] sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.8125rem] text-strong">You send exactly</p>
          {rate ? (
            <RatePill title="The venue's quoted rate, held until the quote's deadline.">
              1 ZEC = <span className="money">{formatRate(rate)}</span>
            </RatePill>
          ) : null}
        </div>
        <p className="mt-2 flex flex-wrap items-baseline gap-x-2">
          <span className="money text-[2rem] leading-none font-[380]">{groupAmount(funding.amount_in)}</span>
          <span className="text-[0.9375rem] text-strong">
            {funding.origin_asset}
            {chainName ? ` on ${chainName}` : ""}
          </span>
        </p>
        {funding.deadline ? (
          <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">
            Rate locked until {formatDateTime(funding.deadline)}
          </p>
        ) : null}
        <div className="mt-4">
          <QuoteRow
            label="Contractors get"
            sub={
              <>
                Worth <Usd cents={run.total_usd_cents} /> at the locked rate
              </>
            }
          >
            {zat !== null ? (
              <Zec zat={zat} short />
            ) : funding.quoted_zat ? (
              <Zec zat={funding.quoted_zat} short />
            ) : (
              "ZEC"
            )}
          </QuoteRow>
          <QuoteRow
            label="Fees"
            sub={`Network fees and the swap. Anything unspent stays in the treasury. ${appFee > 0 ? `Payslip fee ${appFee / 100}%.` : "No Payslip fee."}`}
          >
            {feeCents !== null ? (
              <>
                <Usd cents={feeCents} /> included
              </>
            ) : (
              "Included"
            )}
          </QuoteRow>
          <QuoteRow label="Status">
            <Tag
              tone={
                FAILED_FUNDING.has(funding.status) ? "danger" : funding.status === "success" ? "success" : "neutral"
              }
              dot={funding.status === "processing"}
            >
              {funding.status === "awaiting_deposit"
                ? "Waiting for your deposit"
                : funding.status === "processing"
                  ? "Swapping"
                  : funding.status === "success"
                    ? "Received"
                    : funding.status === "expired"
                      ? "Quote expired"
                      : funding.status === "refunded"
                        ? "Refunded"
                        : "Failed"}
            </Tag>
          </QuoteRow>
        </div>
      </Card>

      {FAILED_FUNDING.has(funding.status) ? (
        <div className="mt-5 space-y-3">
          <Problem
            error={{
              message:
                funding.status === "expired"
                  ? "The quote expired before a deposit arrived."
                  : funding.status === "refunded"
                    ? "The venue refunded the deposit to your refund address."
                    : "The venue could not complete the swap.",
              hint: "Request a new deposit address to try again. Do not send to the old address.",
            }}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <label htmlFor="requote-refund" className="text-[0.8125rem] text-strong">
                Refund address on {chainName}
              </label>
              <Input
                id="requote-refund"
                value={refund}
                onChange={(e) => setRefund(e.target.value)}
                placeholder="0x"
                className="h-10 rounded-[10px] font-mono text-xs"
                spellCheck={false}
              />
            </div>
            <Button size="lg" onClick={requote} disabled={requoting}>
              {requoting ? "Requesting" : "Get a new quote"}
            </Button>
          </div>
          {requoteError ? <Problem error={requoteError} /> : null}
        </div>
      ) : !evm ? (
        <p className="mt-5 text-[0.9375rem] text-muted-foreground" aria-live="polite">
          The venue has not issued a deposit address yet. This page checks again every 5 seconds.
        </p>
      ) : (
        <div className="mt-6 space-y-5">
          <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
            <QrCode value={evm.deposit_address} label={`QR code of the deposit address on ${chainName}`} size={160} />
            <dl className="grid min-w-0 gap-3 text-[0.9375rem]">
              <div>
                <dt className="text-[0.8125rem] text-muted-foreground">Deposit address on {chainName}</dt>
                <dd>
                  <Hash value={evm.deposit_address} label="deposit address" head={10} tail={8} />
                </dd>
              </div>
              <div>
                <dt className="text-[0.8125rem] text-muted-foreground">{funding.origin_asset} token contract</dt>
                <dd>
                  <Hash value={evm.token_address} label="token contract address" head={8} tail={6} />
                </dd>
              </div>
            </dl>
          </div>
          {waiting ? (
            <div className="space-y-2 border-t border-hairline pt-5">
              <p className="text-[0.9375rem]">Pay with a browser wallet</p>
              <WalletPay runId={run.id} funding={evm} onSubmitted={() => undefined} />
            </div>
          ) : null}
          <p className="text-[0.9375rem] text-muted-foreground" aria-live="polite">
            {funding.status === "processing"
              ? "Deposit received. The venue is swapping USDC to ZEC; this page moves on by itself."
              : funding.status === "success"
                ? "Swap complete. The ZEC is arriving in the treasury."
                : "Waiting for your deposit. This page checks with the venue every 5 seconds."}
          </p>
          {pollError ? <Problem error={pollError} title="Could not check the deposit" /> : null}
        </div>
      )}
    </div>
  );
}

/** A run approved by mistake can be discarded while it is still a draft. */
function DiscardRun({ run }: { run: Run }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const discard = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.discardRun(run.id);
      window.location.assign("/console/runs");
    } catch (err) {
      setError(toDisplayError(err));
      setBusy(false);
    }
  };
  return (
    <>
      <p className="mt-8 text-sm text-muted-foreground">
        Approved by mistake?{" "}
        <button type="button" className="rounded-sm text-link hover:underline" onClick={() => setOpen(true)}>
          Discard this run
        </button>
      </p>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="gap-5 p-6 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-normal">Discard the {runTitle(run)} run?</DialogTitle>
            <DialogDescription className="text-[0.9375rem]">
              Nothing has been funded or paid. The run and its {plural(run.lines.length, "line")} are removed.
            </DialogDescription>
          </DialogHeader>
          {error ? <Problem error={error} /> : null}
          <DialogFooter className="-mx-6 -mb-6 bg-transparent px-6 pb-6">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={discard} disabled={busy}>
              {busy ? "Discarding" : "Discard run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
