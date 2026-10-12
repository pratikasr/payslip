"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { QrCode as QrIcon, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Rate, Usd, Zec } from "@/components/app/amount";
import { CopyButton } from "@/components/app/copy-button";
import { Card, CardHeader } from "@/components/ds/card";
import { PageTitle, SectionHeader } from "@/components/ds/page";
import { Sensitive } from "@/components/ds/sensitive";
import { SimulatedRate } from "@/components/ds/simulated-rate";
import { StatusTag } from "@/components/ds/status";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { api, toDisplayError, type ApiError, type Run, type Wallet } from "@/lib/api";
import { formatHeight, formatShortDate, venueLabel } from "@/lib/format";
import { latestPeriodFirst } from "@/lib/payroll";
import { TESTNET_FAUCET_URL } from "@/lib/public-url";
import { cn } from "cn";
import { TYPE } from "@/components/ds/type";
import { fundingSource, isSimulated, latestFillRate, paidRuns, retryOnce, zatToCents } from "@/components/console/lib";
import { IconChip } from "@/components/console/ui";
import { TreasuryKeyLine } from "@/components/console/treasury-key/status";
import { Problem } from "@/components/runs/problem";
import { fundingTag, runTitle } from "@/components/runs/run-meta";

const QrCode = dynamic(() => import("@/components/app/qr-code"), {
  ssr: false,
  loading: () => <Skeleton className="size-[156px]" />,
});

export function TreasuryView({ initial }: { initial: { wallet?: Wallet; runs?: Run[] } }) {
  const wallet = useResource((s) => retryOnce(() => api.wallet(s)), "treasury-wallet", initial.wallet);
  const runs = useResource((s) => api.runs(s), "treasury-runs", initial.runs);

  return (
    <>
      <PageTitle title="Treasury" />
      {wallet.error && !wallet.data ? (
        <Problem error={wallet.error} title="Could not load the treasury" onRetry={wallet.reload} />
      ) : !wallet.data ? (
        <div role="status" aria-label="Loading treasury" className="grid gap-5 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-3 border border-rule p-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-56" />
              <Skeleton className="h-16 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <BalanceCard wallet={wallet.data} runs={runs.data ?? []} onSynced={(w) => wallet.setData(w)} />
          <ReceiveCard wallet={wallet.data} />
        </div>
      )}
      <FundingHistory runs={runs.data} error={runs.error} onRetry={runs.reload} />
    </>
  );
}

function BalanceCard({ wallet, runs, onSynced }: { wallet: Wallet; runs: Run[]; onSynced: (w: Wallet) => void }) {
  const t = wallet.treasury;
  // Mainnet: dollars at the latest fill rate, a real price at the time. Testnet: the coin only,
  // because the testnet rate is simulated and is not a price.
  const testnet = wallet.network === "testnet";
  const rate = testnet ? null : latestFillRate(runs);
  // Runway in coin: what the last payroll drew (payments plus fee reserve) against the balance.
  const last = paidRuns(runs)[0];
  const drew = last?.funding?.zec_acquired_zat ?? last?.total_zat ?? null;
  const cover = drew && drew > 0 ? t.total_zat / drew : null;
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<{ synced: number; tip: number } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => clearInterval(poll.current ?? undefined), []);

  const sync = async () => {
    setSyncing(true);
    setError(null);
    setProgress({ synced: wallet.synced_height, tip: wallet.chain_tip });
    // The sync call answers when it is done; health reports the heights the wallet has reached so far.
    poll.current = setInterval(() => {
      api
        .health()
        .then((h) => setProgress({ synced: h.wallet_synced_height, tip: h.chain_tip }))
        .catch(() => undefined);
    }, 2000);
    try {
      const w = await retryOnce(() => api.syncWallet());
      onSynced(w);
      toast.success("Up to date with the Zcash chain", { description: `Block ${formatHeight(w.synced_height)}` });
    } catch (err) {
      setError(toDisplayError(err));
    } finally {
      clearInterval(poll.current ?? undefined);
      poll.current = null;
      setSyncing(false);
      setProgress(null);
    }
  };

  const behind = Math.max(0, wallet.chain_tip - wallet.synced_height);
  return (
    <Card className="flex flex-col" aria-labelledby="balance-title">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <h2 id="balance-title" className="form-label text-[0.75rem] font-bold text-muted-foreground">
            Balance
          </h2>
          {/* One balance figure: dollars on mainnet with the coin under it, the coin on testnet. */}
          <div className={cn(TYPE.hero, "mt-1.5")}>
            {rate ? (
              <Usd cents={zatToCents(t.total_zat, rate)} />
            ) : (
              <Zec zat={t.total_zat} className="[&_[data-unit]]:font-type [&_[data-unit]]:text-[0.4em]" />
            )}
          </div>
          {rate ? (
            <div className="mt-1.5 font-type text-[0.8125rem] text-muted-foreground">
              <Zec zat={t.total_zat} className="text-strong" /> at the latest fill rate
            </div>
          ) : null}
          {cover !== null && last ? (
            <p className="mt-2 font-type text-[0.8125rem] text-muted-foreground">
              {cover >= 1
                ? `Covers ${cover >= 10 ? Math.floor(cover) : cover.toFixed(1)} payrolls like ${runTitle(last)}`
                : `Not enough for a payroll like ${runTitle(last)}`}
            </p>
          ) : null}
        </div>
        {/* Two boxes of the form, ruled in ink: what can be spent and what is still confirming. */}
        <dl className="grid min-w-[13rem] grid-cols-2 border border-ink font-type sm:grid-cols-1">
          <div className="px-3 py-2">
            <dt className="form-label text-[0.75rem] font-bold text-muted-foreground">Spendable</dt>
            <dd className="mt-0.5 text-[0.9375rem]">
              <Zec zat={t.spendable_zat} short />
            </dd>
          </div>
          <div className="border-l border-ink px-3 py-2 sm:border-t sm:border-l-0">
            <dt className="form-label text-[0.75rem] font-bold text-muted-foreground">Confirming</dt>
            <dd className="mt-0.5 text-[0.9375rem]">
              <Zec zat={t.pending_zat} short />
            </dd>
          </div>
        </dl>
      </div>
      <div className="mt-auto pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink pt-4">
          <p
            className="min-w-0 font-type text-[0.8125rem] text-strong"
            aria-live="polite"
            title={`Synced to block ${formatHeight(wallet.synced_height)}; the chain tip is ${formatHeight(wallet.chain_tip)}.`}
          >
            {syncing && progress ? (
              progress.tip > progress.synced ? (
                <>
                  Catching up with the Zcash chain:{" "}
                  <span className="num">{formatHeight(progress.tip - progress.synced)}</span> blocks to go
                </>
              ) : (
                "Checking the Zcash chain for new blocks"
              )
            ) : behind <= 2 ? (
              "Up to date with the Zcash chain"
            ) : (
              <>
                <span className="num">{formatHeight(behind)}</span> blocks behind the Zcash chain
              </>
            )}
          </p>
          <Button variant="secondary" size="sm" onClick={sync} disabled={syncing}>
            <RefreshCw className={cn(syncing && "animate-spin")} aria-hidden="true" />
            {syncing ? "Syncing" : "Sync"}
          </Button>
        </div>
        {error ? <Problem error={error} title="Sync did not finish" onRetry={sync} className="mt-3" /> : null}
        <TreasuryKeyLine className="mt-3 border-t border-hairline pt-3" />
      </div>
    </Card>
  );
}

function ReceiveCard({ wallet }: { wallet: Wallet }) {
  const address = wallet.treasury.unified_address;
  const coin = wallet.network === "testnet" ? "TAZ" : "ZEC";
  return (
    <Card aria-labelledby="receive-title">
      <CardHeader id="receive-title" title="Receive" actions={<IconChip icon={QrIcon} />} />
      <div className="mt-3 grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)]">
        <Sensitive block className="justify-self-start">
          <QrCode value={address} label="QR code of the treasury address" size={164} />
        </Sensitive>
        <div className="min-w-0">
          <p className="text-[0.9375rem] text-strong">Send {coin} to this shielded address to fund payroll.</p>
          <p className="form-label mt-3 text-[0.75rem] font-bold text-muted-foreground">Treasury address</p>
          <div className="mt-1 flex items-start gap-1">
            <Sensitive
              block
              className="min-w-0 flex-1 border border-bar-line bg-bar p-2 font-type text-[0.8125rem] leading-relaxed break-all"
            >
              {address}
            </Sensitive>
            <CopyButton value={address} label="treasury address" size="icon-sm" />
          </div>
          {wallet.network === "testnet" ? (
            <div className="mt-3">
              <Button asChild size="sm" variant="secondary">
                <a href={TESTNET_FAUCET_URL} target="_blank" rel="noreferrer">
                  Get free testnet coins<span className="sr-only"> (opens in a new tab)</span>
                </a>
              </Button>
              <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">Testnet coins have no value.</p>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function FundingHistory({ runs, error, onRetry }: { runs?: Run[]; error?: ApiError; onRetry: () => void }) {
  // Latest pay period first, like every other list in the console.
  const funded = runs ? latestPeriodFirst(runs.filter((r) => r.funding)) : [];
  const testnet = funded.some(isSimulated);
  return (
    <section aria-labelledby="funding-title">
      <SectionHeader id="funding-title" title="Funding history" />
      {error && !runs ? (
        <Problem error={error} title="Could not load the funding history" onRetry={onRetry} />
      ) : !runs ? (
        <div role="status" aria-label="Loading funding history" className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : funded.length === 0 ? (
        <p className="border-y-2 border-ink px-2 py-4 font-type text-[0.875rem] text-muted-foreground">
          No funding yet. Each payroll run records its funding here: where the coins came from and how much.
        </p>
      ) : (
        <table className="w-full table-fixed border-collapse border-b-2 border-ink text-[0.9375rem]">
          <caption className="sr-only">Funding for each payroll run, latest pay period first</caption>
          <thead>
            <tr className="border-b-2 border-ink text-left text-[0.75rem]">
              <th scope="col" className="py-2.5 pr-3 pl-2 font-bold">
                Payroll
              </th>
              <th scope="col" className="hidden w-[8rem] py-3 pr-3 font-bold lg:table-cell">
                Status
              </th>
              <th scope="col" className="w-[7.5rem] py-3 pr-0 text-right font-bold sm:w-[9.5rem] sm:pr-6">
                {testnet ? "Payroll" : "Funded"}
              </th>
              <th scope="col" className="hidden w-[9.5rem] py-3 pr-6 text-right font-bold sm:table-cell">
                {testnet ? "Set aside" : "Acquired"}
              </th>
              <th scope="col" className="hidden w-[9.5rem] py-3 pr-2 text-right font-bold lg:table-cell">
                Rate
              </th>
            </tr>
          </thead>
          <tbody>
            {funded.map((run) => {
              const f = run.funding!;
              const simulated = isSimulated(run);
              // Testnet: the payroll's dollars and the coin set aside; the simulated rate stays in its note.
              const cents = simulated ? run.total_usd_cents : (f.funded_usd_cents ?? f.requested_usd_cents ?? null);
              return (
                <tr key={run.id} className="border-b border-bar-line">
                  <td className="h-[56px] py-2 pr-3 pl-2">
                    <Link href={`/console/runs/${run.id}`} className="block truncate font-bold hover:underline">
                      {runTitle(run)} payroll
                    </Link>
                    <span className="block truncate text-[0.8125rem] text-muted-foreground">
                      {fundingSource(run)}
                      {simulated ? "" : ` through ${venueLabel(f.venue)}`}, {formatShortDate(run.created_at)}
                    </span>
                  </td>
                  <td className="hidden pr-3 lg:table-cell">
                    <StatusTag status={fundingTag(f)} />
                  </td>
                  <td className="py-2 pr-0 text-right sm:pr-6">
                    <Usd
                      cents={cents}
                      signed={!simulated && f.status === "success"}
                      className={cn("block", f.status === "success" && !simulated && "text-success")}
                    />
                    <Zec
                      zat={f.zec_acquired_zat ?? f.quoted_zat}
                      short
                      className="block text-[0.8125rem] text-muted-foreground sm:hidden"
                    />
                  </td>
                  <td className="hidden pr-6 text-right sm:table-cell">
                    <Zec zat={f.zec_acquired_zat ?? f.quoted_zat} />
                  </td>
                  <td className="hidden pr-2 text-right lg:table-cell">
                    {simulated ? (
                      <SimulatedRate rateE6={f.rate_usd_per_zec_e6} />
                    ) : (
                      <Rate e6={f.rate_usd_per_zec_e6} className="text-[0.8125rem]" />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
