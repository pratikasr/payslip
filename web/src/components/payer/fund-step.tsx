"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { Usd, Zec, Rate } from "@/components/app/amount";
import { describedBy, Field } from "@/components/app/field";
import { useHealth } from "@/components/app/health-provider";
import { Hash } from "@/components/app/hash";
import { ErrorState } from "@/components/app/states";
import { FundingStatusBadge } from "@/components/app/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { checkEvmAddress } from "@/lib/addresses";
import { api, isEvmFunding, toDisplayError, type ApiError, type Run } from "@/lib/api";
import { evmChainName } from "@/lib/evm";
import { ORIGIN_CHAINS } from "@/lib/evm";
import { formatDateTime, venueLabel } from "@/lib/format";

const WalletPay = dynamic(() => import("@/components/payer/wallet-pay"), {
  ssr: false,
  loading: () => (
    <div role="status" aria-label="Loading wallet connection" className="flex gap-3">
      <Skeleton className="h-10 w-40" />
      <Skeleton className="h-10 w-48" />
    </div>
  ),
});

const QrCode = dynamic(() => import("@/components/app/qr-code"), {
  ssr: false,
  loading: () => <Skeleton className="size-[186px]" />,
});

const POLL_MS = 5_000;
const FAILED_FUNDING = new Set(["refunded", "failed", "expired"]);

export function FundStep({ run, onRun }: { run: Run; onRun: (run: Run) => void }) {
  const { health } = useHealth();
  const venue = run.funding?.venue ?? health?.venue;

  if (!venue) {
    return (
      <div role="status" aria-label="Loading funding options" className="space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-9 w-40" />
      </div>
    );
  }
  if (venue === "testnet-fixed-rate") return <TestnetFunding run={run} onRun={onRun} />;
  if (!run.funding) return <QuoteForm run={run} onRun={onRun} venueName={venueLabel(venue)} />;
  return <DepositDetails run={run} onRun={onRun} />;
}

function TestnetFunding({ run, onRun }: { run: Run; onRun: (run: Run) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      onRun(await api.fundRun(run.id, {}));
    } catch (err) {
      setError(toDisplayError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex gap-3 rounded-lg border bg-info-bg p-3 text-sm text-foreground">
        <Info className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
        <p>
          This service runs on Zcash testnet with the testnet fixed-rate venue. There is no USDC deposit: funding draws
          testnet ZEC from the treasury at a fixed rate, and that rate becomes the USD basis of every line. On mainnet
          this step asks you to send USDC instead.
        </p>
      </div>
      <p className="text-sm">
        The run needs <Usd cents={run.total_usd_cents} className="font-medium" /> worth of ZEC in the treasury.
      </p>
      {error ? <ErrorState error={error} compact /> : null}
      <Button onClick={confirm} disabled={busy}>
        {busy ? "Confirming funding" : "Confirm funding"}
      </Button>
    </div>
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
    <form onSubmit={submit} noValidate className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {venueName} quotes USDC to ZEC for <Usd cents={run.total_usd_cents} className="font-medium text-foreground" />{" "}
        and gives you a deposit address. If the swap cannot complete, the venue refunds the USDC to your refund address.
      </p>
      <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <Label htmlFor="origin-chain">Pay USDC from</Label>
          <NativeSelect id="origin-chain" value={chain} onChange={(e) => setChain(e.target.value)}>
            {ORIGIN_CHAINS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Field
          id="refund-address"
          label="Refund address"
          error={refundError}
          help="An address you control on the same chain."
        >
          <Input
            id="refund-address"
            value={refund}
            onChange={(e) => setRefund(e.target.value)}
            placeholder="0x"
            spellCheck={false}
            autoComplete="off"
            className="font-mono text-xs"
            aria-invalid={!!refundError}
            aria-describedby={describedBy("refund-address", refundError, true)}
          />
        </Field>
      </div>
      {error ? <ErrorState error={error} compact /> : null}
      <Button type="submit" disabled={busy}>
        {busy ? "Requesting quote" : "Get deposit address"}
      </Button>
    </form>
  );
}

function formatTokenAmount(amount: string): string {
  const [whole, frac] = amount.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}

function DepositDetails({ run, onRun }: { run: Run; onRun: (run: Run) => void }) {
  const funding = run.funding!;
  const [pollError, setPollError] = useState<ApiError | null>(null);
  const [requoting, setRequoting] = useState(false);
  const [requoteError, setRequoteError] = useState<ApiError | null>(null);
  const [refund, setRefund] = useState("");
  const onRunRef = useRef(onRun);
  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  const waiting = run.status === "awaiting_funds" && !FAILED_FUNDING.has(funding.status);

  // Poll GET /api/runs/{id}/funding every 5 s until the venue reports the run funded.
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
  const chainName = evm
    ? evmChainName(evm.chain_id, funding.origin_chain ?? undefined)
    : (funding.origin_chain ?? "the origin chain");
  const amountText = `${formatTokenAmount(funding.amount_in)} ${funding.origin_asset}`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <FundingStatusBadge status={funding.status} />
        <span className="text-muted-foreground">
          {venueLabel(funding.venue)}
          {funding.deadline ? `, quote valid until ${formatDateTime(funding.deadline)}` : ""}
        </span>
      </div>

      {FAILED_FUNDING.has(funding.status) ? (
        <div className="space-y-3 rounded-lg border border-danger/30 bg-danger-bg p-4 text-sm">
          <p className="font-medium">
            {funding.status === "expired"
              ? "The quote expired before a deposit arrived."
              : funding.status === "refunded"
                ? "The venue refunded the deposit to your refund address."
                : "The venue could not complete the swap."}
          </p>
          <p className="text-muted-foreground">
            Request a new deposit address to try again. Do not send to the old address.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="requote-refund">Refund address on {chainName}</Label>
              <Input
                id="requote-refund"
                value={refund}
                onChange={(e) => setRefund(e.target.value)}
                placeholder="0x"
                className="font-mono text-xs"
                spellCheck={false}
              />
            </div>
            <Button onClick={requote} disabled={requoting}>
              {requoting ? "Requesting" : "Request a new deposit address"}
            </Button>
          </div>
          {requoteError ? <ErrorState error={requoteError} compact /> : null}
        </div>
      ) : !evm ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          The venue has not issued a deposit address yet. This page checks again every 5 seconds.
        </p>
      ) : (
        <>
          <div className="grid gap-5 md:grid-cols-[auto_minmax(0,1fr)]">
            <div className="justify-self-start">
              <QrCode value={evm.deposit_address} label={`QR code of the deposit address on ${chainName}`} size={160} />
            </div>
            <dl className="grid min-w-0 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">Send exactly</dt>
                <dd className="num text-xl font-semibold tracking-tight">{amountText}</dd>
                <dd className="text-xs text-muted-foreground">
                  on {chainName}. Sending a different amount can delay or refund the swap.
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">To deposit address</dt>
                <dd>
                  <Hash value={evm.deposit_address} label="deposit address" head={10} tail={8} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Token contract</dt>
                <dd>
                  <Hash value={evm.token_address} label="token contract address" head={8} tail={6} />
                </dd>
              </div>
            </dl>
          </div>

          {waiting ? (
            <div className="space-y-2 border-t pt-4">
              <p className="text-sm font-medium">Pay with a browser wallet</p>
              <WalletPay runId={run.id} funding={evm} onSubmitted={() => undefined} />
            </div>
          ) : null}

          <p className="text-sm text-muted-foreground" aria-live="polite">
            {funding.status === "processing"
              ? "Deposit received. The venue is swapping USDC to ZEC; this page updates on its own."
              : funding.status === "success"
                ? "Swap complete. ZEC is in the treasury."
                : "Waiting for the deposit. This page checks with the venue every 5 seconds."}
          </p>
          {pollError ? <ErrorState error={pollError} compact title="Could not check the funding status" /> : null}
        </>
      )}

      {funding.status === "success" || funding.zec_acquired_zat ? (
        <dl className="grid grid-cols-1 gap-4 border-t pt-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Funded</dt>
            <dd>
              <Usd cents={funding.funded_usd_cents} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">ZEC acquired</dt>
            <dd>
              <Zec zat={funding.zec_acquired_zat} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Fill rate</dt>
            <dd>
              <Rate e6={funding.rate_usd_per_zec_e6} />
            </dd>
          </div>
        </dl>
      ) : null}
    </div>
  );
}
