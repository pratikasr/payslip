"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Coin, Usd, Zec } from "@/components/app/amount";
import { CopyButton } from "@/components/app/copy-button";
import { Hash } from "@/components/app/hash";
import { useHealth } from "@/components/app/health-provider";
import { Card } from "@/components/ds/card";
import { Sensitive } from "@/components/ds/sensitive";
import { SimulatedRate } from "@/components/ds/simulated-rate";
import { StatusTag } from "@/components/ds/status";
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
import { feeReserveZat } from "@/lib/payroll";
import { TESTNET_FAUCET_URL } from "@/lib/public-url";
import { Problem } from "../problem";
import { CancelRun } from "../cancel-run";
import {
  canCancel,
  CLOSED_FUNDING,
  estimateZat,
  fundingTag,
  isConverted,
  plural,
  retryOnce,
  runTitle,
} from "../run-meta";
import { OverlapNote } from "./overlap";
import { FlowTitle } from "./rail";
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
const FAILED_FUNDING = CLOSED_FUNDING;

/**
 * A funding error with the actions that can help: a run that is gone offers a new run, not a
 * retry; a treasury that holds too little offers the treasury, not the same request again.
 */
function FundProblem({
  error,
  title,
  onRetry,
  busy,
  className,
}: {
  error: ApiError;
  title: string;
  onRetry?: () => void;
  busy?: boolean;
  className?: string;
}) {
  if (error.status === 404) {
    return (
      <Problem
        className={className}
        error={{
          message: "This run no longer exists.",
          hint: "It was discarded, perhaps in another tab. Nothing was funded or paid.",
          status: 404,
        }}
        action={
          <Button asChild size="sm" variant="secondary">
            <Link href="/console/runs/new">Start a new run</Link>
          </Button>
        }
      />
    );
  }
  if (error.code === "run_cancelled") {
    return (
      <Problem
        className={className}
        error={error}
        title="This run was cancelled"
        action={
          <Button asChild size="sm" variant="secondary">
            <Link href="/console/runs/new">Start a new run</Link>
          </Button>
        }
      />
    );
  }
  // The service's own words say what to do; trying the same request again at once would not help.
  if (["quote_still_open", "deposit_in_progress", "contractor_archived", "run_already_funded"].includes(error.code)) {
    return <Problem className={className} error={error} title={title} />;
  }
  if (error.code === "treasury_insufficient") {
    return (
      <Problem
        className={className}
        error={error}
        title={title}
        action={
          <Button asChild size="sm" variant="secondary">
            <Link href="/console/treasury">Open treasury</Link>
          </Button>
        }
      />
    );
  }
  return <Problem className={className} error={error} title={title} onRetry={onRetry} busy={busy} />;
}

/** People in the run who were archived after it was approved: it cannot pay them; start over. */
function ArchivedNote({ run, archived }: { run: Run; archived: ReadonlySet<string> }) {
  const names = run.lines.filter((l) => archived.has(l.id)).map((l) => l.contractor_name);
  if (names.length === 0) return null;
  return (
    <p role="note" className="mt-5 rounded-xl bg-warning-bg px-4 py-3 text-[0.8125rem] text-strong">
      {names.join(", ")} {names.length === 1 ? "was" : "were"} archived after this run was approved.
      {run.status === "draft"
        ? " Discard this run (below) and start a new one without them."
        : " Start a new run without them."}
    </p>
  );
}

function Heading({ run, children }: { run: Run; children?: React.ReactNode }) {
  return (
    <>
      <FlowTitle>Fund {runTitle(run)} payroll</FlowTitle>
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
  onWallet,
  simulatedRate,
  overlaps = [],
  archived = new Set(),
}: {
  run: Run;
  onRun: (run: Run) => void;
  wallet: Wallet | undefined;
  /** A fresher wallet, after "Check again" synced it. */
  onWallet: (wallet: Wallet) => void;
  simulatedRate: number | null;
  /** Other runs covering the same period, said before any money moves. */
  overlaps?: Run[];
  /** Lines whose contractor was archived after approval. */
  archived?: ReadonlySet<string>;
}) {
  const { health, network } = useHealth();
  // Testnet has only the fixed-rate venue (1Click has no testnet), so it is known before health.
  const venue = run.funding?.venue ?? health?.venue ?? (network === "testnet" ? "testnet-fixed-rate" : undefined);
  if (!venue) {
    return (
      <div role="status" aria-label="Loading funding options" className="space-y-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }
  const notes = (
    <>
      <ArchivedNote run={run} archived={archived} />
      <OverlapNote runs={overlaps} className="mt-5" />
    </>
  );
  if (venue === "testnet-fixed-rate")
    return (
      <TestnetFund
        run={run}
        onRun={onRun}
        wallet={wallet}
        onWallet={onWallet}
        simulatedRate={simulatedRate}
        notes={notes}
      />
    );
  if (!run.funding || run.status === "draft")
    return <QuoteForm run={run} onRun={onRun} venueName={venueLabel(venue)} notes={notes} />;
  return <DepositQuote run={run} onRun={onRun} notes={notes} />;
}

function TestnetFund({
  run,
  onRun,
  wallet,
  onWallet,
  simulatedRate,
  notes,
}: {
  run: Run;
  onRun: (run: Run) => void;
  wallet: Wallet | undefined;
  onWallet: (wallet: Wallet) => void;
  simulatedRate: number | null;
  notes: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const n = run.lines.length;
  const estimate = estimateZat(
    run.lines.map((l) => l.amount_usd_cents),
    simulatedRate,
  );
  // What the service sets aside on top of the payments for network fees (it keeps what is unspent).
  const reserve = feeReserveZat(n, run.lines.filter(isConverted).length);
  const need = estimate !== null ? estimate + reserve : null;
  const spendable = wallet?.treasury.spendable_zat;
  // Known short before asking the service: an empty treasury, or less than the payments and reserve.
  const short = spendable !== undefined && (spendable === 0 || (need !== null && spendable < need));

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
      <Heading run={run}>Testnet runs are funded from coins already in the treasury. No deposit is needed.</Heading>

      <Card className="mt-6 px-6 py-6 shadow-[0_2px_6px_rgba(14,14,45,0.05)] sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.8125rem] text-strong">Payroll to fund</p>
          <SimulatedRate rateE6={simulatedRate} />
        </div>
        <Usd cents={run.total_usd_cents} className="mt-2 mb-4 block text-[2.125rem] leading-none font-[380]" />
        <QuoteRow label="Contractors get" sub={`${plural(n, "shielded payment")} at the simulated rate`}>
          {estimate !== null ? (
            <>
              about <Zec zat={estimate} />
            </>
          ) : (
            <>
              <Coin /> at the simulated rate
            </>
          )}
        </QuoteRow>
        <QuoteRow label="Fee reserve" sub="Real network fees; the rest stays in the treasury">
          up to <Zec zat={reserve} />
        </QuoteRow>
        <QuoteRow
          label="From"
          sub={
            wallet ? (
              <>
                <Zec zat={wallet.treasury.spendable_zat} /> spendable
              </>
            ) : undefined
          }
        >
          Treasury
        </QuoteRow>
      </Card>

      {notes}

      {wallet && short ? <TopUp wallet={wallet} need={need} onWallet={onWallet} /> : null}

      {error ? (
        <FundProblem className="mt-5" error={error} title="The run was not funded" onRetry={fund} busy={busy} />
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        {/* One gold action: while the treasury is short, Check again (above) is it. */}
        <Button
          size="lg"
          variant={short ? "secondary" : "default"}
          onClick={() => setOpen(true)}
          disabled={busy || short}
        >
          Fund from treasury
        </Button>
        {short ? (
          <p className="text-[0.8125rem] text-muted-foreground">Top up the treasury first.</p>
        ) : busy && !open ? (
          <FundingNote />
        ) : null}
      </div>
      {run.status === "draft" ? <DiscardRun run={run} /> : null}

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="gap-5 p-6 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[1.1875rem] font-normal">
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
              and up to <Zec zat={reserve} short /> for network fees for the {plural(n, "contractor")} in the{" "}
              {runTitle(run)} run, at the simulated rate. You send the payments on the next step.
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

/**
 * The treasury cannot cover this run yet: say by how much, with the address to send to (QR and
 * copy), free testnet coins, and one action once coins were sent: Check again, which syncs the
 * wallet with the chain and enables Fund when the balance covers the run.
 */
function TopUp({ wallet, need, onWallet }: { wallet: Wallet; need: number | null; onWallet: (w: Wallet) => void }) {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const t = wallet.treasury;
  const missing = need !== null ? Math.max(0, need - t.spendable_zat) : null;
  const check = async () => {
    setChecking(true);
    setError(null);
    try {
      const w = await retryOnce(() => api.syncWallet());
      onWallet(w);
      if (need !== null && w.treasury.spendable_zat >= need) toast.success("The treasury now covers this run");
    } catch (err) {
      setError(toDisplayError(err));
    } finally {
      setChecking(false);
    }
  };
  return (
    <section aria-labelledby="topup-title" className="mt-5 rounded-xl border bg-card px-5 py-5 sm:px-6">
      <h2 id="topup-title" className="text-[0.9375rem] text-foreground">
        Top up the treasury
      </h2>
      <p className="mt-1 text-[0.9375rem] text-muted-foreground">
        {t.spendable_zat === 0 ? "The treasury has nothing spendable yet. " : null}
        {missing !== null && missing > 0 ? (
          <>
            This run needs <Zec zat={missing} className="text-foreground" /> more, for its payments and fee reserve.
          </>
        ) : (
          "Send coins to the treasury, then check again."
        )}
        {t.pending_zat > 0 ? (
          <>
            {" "}
            <Zec zat={t.pending_zat} short /> is still confirming.
          </>
        ) : null}
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
        <Sensitive block className="justify-self-start">
          <QrCode value={t.unified_address} label="QR code of the treasury address" size={148} />
        </Sensitive>
        <div className="min-w-0">
          <p className="text-[0.8125rem] text-muted-foreground">Treasury address</p>
          <div className="mt-1 flex items-start gap-1">
            <Sensitive
              block
              className="min-w-0 flex-1 rounded-md bg-raised p-2 font-mono text-[11px] leading-relaxed break-all"
            >
              {t.unified_address}
            </Sensitive>
            <CopyButton value={t.unified_address} label="treasury address" size="icon-sm" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button asChild size="sm" variant="secondary">
              <a href={TESTNET_FAUCET_URL} target="_blank" rel="noreferrer">
                Get free testnet coins<span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Button>
            <Button size="sm" onClick={check} disabled={checking}>
              <RefreshCw className={checking ? "animate-spin" : undefined} aria-hidden="true" />
              {checking ? "Checking the chain" : "Check again"}
            </Button>
          </div>
        </div>
      </div>
      {error ? <Problem className="mt-4" error={error} title="Could not check the treasury" /> : null}
    </section>
  );
}

/** What the service is doing while it funds a testnet run (it syncs the treasury first). */
function FundingNote() {
  return (
    <p className="text-[0.8125rem] text-muted-foreground" role="status">
      Checking the treasury against the chain, then setting this run&apos;s funds aside.
    </p>
  );
}

function QuoteForm({
  run,
  onRun,
  venueName,
  notes,
}: {
  run: Run;
  onRun: (run: Run) => void;
  venueName: string;
  notes: React.ReactNode;
}) {
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
          <Usd cents={run.total_usd_cents} className="mt-2 block text-[2.125rem] leading-none font-[380]" />
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
              className="h-10 rounded-[10px] font-mono text-[0.8125rem]"
              aria-invalid={!!refundError}
              aria-describedby={refundError ? "refund-address-error" : "refund-address-help"}
            />
            {refundError ? (
              <p id="refund-address-error" className="text-[0.8125rem] text-destructive">
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
      {notes}
      {error ? <FundProblem className="mt-5" error={error} title="No quote yet" /> : null}
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
function DepositQuote({ run, onRun, notes }: { run: Run; onRun: (run: Run) => void; notes: React.ReactNode }) {
  const { health } = useHealth();
  const funding: Funding = run.funding!;
  const [pollError, setPollError] = useState<ApiError | null>(null);
  const [requoting, setRequoting] = useState(false);
  const [requoteError, setRequoteError] = useState<ApiError | null>(null);
  const [refund, setRefund] = useState("");
  const onRunRef = useRef(onRun);
  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  // A quote whose deadline passed takes no deposit, even before the venue reports it expired.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const pastDeadline =
    funding.status === "awaiting_deposit" && !!funding.deadline && Date.parse(funding.deadline) < now;
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
  const appFee = health?.app_fee_bps ?? 0;
  // What is sent beyond the payroll: Payslip's fee (its share of the swap, when there is one),
  // and the rest, a reserve for network and swap fees whose unspent part stays in the treasury.
  const extraCents = sendCents !== null ? Math.max(0, sendCents - run.total_usd_cents) : null;
  const payslipFeeCents = sendCents !== null && appFee > 0 ? Math.ceil((sendCents * appFee) / 10_000) : 0;
  const reserveCents = extraCents !== null ? Math.max(0, extraCents - payslipFeeCents) : null;

  return (
    <div>
      <Heading run={run}>
        {FAILED_FUNDING.has(funding.status)
          ? "No money reached the treasury from this quote. Get a new one below; do not send to the old address."
          : "Send the exact amount below. The treasury receives ZEC as soon as the swap completes."}
      </Heading>

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
          <span className="money text-[2.125rem] leading-none font-[380]">{groupAmount(funding.amount_in)}</span>
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
          <QuoteRow label="Reserve for fees" sub="Swap and network fees; what is unspent stays in the treasury">
            {reserveCents !== null ? (
              <>
                <Usd cents={reserveCents} /> included
              </>
            ) : (
              "Included"
            )}
          </QuoteRow>
          <QuoteRow label="Payslip fee" sub={appFee > 0 ? `${appFee / 100}% of the swap` : undefined}>
            {appFee > 0 ? (
              <>
                <Usd cents={payslipFeeCents} /> included
              </>
            ) : (
              "None"
            )}
          </QuoteRow>
          <QuoteRow label="Status">
            <StatusTag status={fundingTag(funding)} />
          </QuoteRow>
        </div>
      </Card>

      {notes}

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
                className="h-10 rounded-[10px] font-mono text-[0.8125rem]"
                spellCheck={false}
              />
            </div>
            <Button size="lg" onClick={requote} disabled={requoting}>
              {requoting ? "Requesting" : "Get a new quote"}
            </Button>
          </div>
          {requoteError ? <FundProblem error={requoteError} title="No new quote yet" /> : null}
        </div>
      ) : !evm ? (
        <p className="mt-5 text-[0.9375rem] text-muted-foreground" aria-live="polite">
          The venue has not issued a deposit address yet. This page checks again every 5 seconds.
        </p>
      ) : (
        <div className="mt-6 space-y-5">
          <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start">
            <Sensitive block>
              <QrCode value={evm.deposit_address} label={`QR code of the deposit address on ${chainName}`} size={160} />
            </Sensitive>
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
          {waiting && !pastDeadline && funding.status === "awaiting_deposit" ? (
            <div className="space-y-2 border-t border-hairline pt-5">
              <p className="text-[0.9375rem]">Pay with a browser wallet</p>
              <WalletPay runId={run.id} funding={evm} onSubmitted={() => undefined} />
            </div>
          ) : null}
          <p className="text-[0.9375rem] text-muted-foreground" aria-live="polite">
            {pastDeadline
              ? "The quote's deadline has passed. Do not send to this address; this page asks the venue and offers a new quote once it confirms the quote expired."
              : funding.status === "processing" || funding.status === "deposit_seen"
                ? "Deposit received. The venue is swapping USDC to ZEC; this page moves on by itself."
                : funding.status === "incomplete"
                  ? "The venue received less than the quote. Send the rest to the same address, or wait for the venue to refund it."
                  : funding.status === "success"
                    ? "Swap complete. The ZEC is arriving in the treasury."
                    : "Waiting for your deposit. This page checks with the venue every 5 seconds."}
          </p>
          {pollError ? <Problem error={pollError} title="Could not check the deposit" /> : null}
        </div>
      )}
      {canCancel(run) ? <CancelRun run={run} onCancelled={onRun} /> : null}
    </div>
  );
}

/** A run approved by mistake can be discarded while it is still a draft. */
function DiscardRun({ run }: { run: Run }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const discard = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.discardRun(run.id);
      toast.success(`Discarded the ${runTitle(run)} run`, { description: "Nothing was funded or paid." });
      router.push("/console/runs");
    } catch (err) {
      setError(toDisplayError(err));
      setBusy(false);
    }
  };
  return (
    <>
      <p className="mt-8 text-[0.8125rem] text-muted-foreground">
        Approved by mistake?{" "}
        <button type="button" className="rounded-sm text-link hover:underline" onClick={() => setOpen(true)}>
          Discard this run
        </button>
      </p>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent className="gap-5 p-6 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[1.1875rem] font-normal">Discard the {runTitle(run)} run?</DialogTitle>
            <DialogDescription className="text-[0.9375rem]">
              Nothing has been funded or paid. The run and its {plural(run.lines.length, "line")} are removed.
            </DialogDescription>
          </DialogHeader>
          {error ? <FundProblem error={error} title="Not discarded" /> : null}
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
