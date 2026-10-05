"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { QrCode as QrIcon, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Rate, Usd, Zec } from "@/components/app/amount";
import { CopyButton } from "@/components/app/copy-button";
import { ErrorState } from "@/components/app/states";
import { Card, CardHeader } from "@/components/ds/card";
import { PageTitle, SectionHeader } from "@/components/ds/page";
import { Tag, type TagTone } from "@/components/ds/tag";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { api, toDisplayError, type ApiError, type FundingStatus, type Run, type Wallet } from "@/lib/api";
import { formatHeight, formatPeriodLabel, venueLabel } from "@/lib/format";
import { cn } from "cn";
import {
  fundingSource,
  isSimulated,
  latestFillRate,
  newestFirst,
  retryOnce,
  shortDate,
  zatToCents,
} from "@/components/console/lib";
import { IconChip } from "@/components/console/ui";

const QrCode = dynamic(() => import("@/components/app/qr-code"), {
  ssr: false,
  loading: () => <Skeleton className="size-[156px]" />,
});

const FUNDING_TAG: Record<FundingStatus, { label: string; tone: TagTone }> = {
  awaiting_deposit: { label: "Awaiting deposit", tone: "neutral" },
  processing: { label: "Swapping", tone: "neutral" },
  success: { label: "Received", tone: "success" },
  refunded: { label: "Refunded", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  expired: { label: "Expired", tone: "neutral" },
};

export function TreasuryView({ initial }: { initial: { wallet?: Wallet; runs?: Run[] } }) {
  const wallet = useResource((s) => retryOnce(() => api.wallet(s)), "treasury-wallet", initial.wallet);
  const runs = useResource((s) => api.runs(s), "treasury-runs", initial.runs);

  return (
    <>
      <PageTitle title="Treasury" />
      {wallet.error && !wallet.data ? (
        <ErrorState error={wallet.error} onRetry={wallet.reload} />
      ) : !wallet.data ? (
        <div role="status" aria-label="Loading treasury" className="grid gap-5 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="space-y-3 rounded-xl border p-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-56" />
              <Skeleton className="h-16 w-full" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
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
  const rate = wallet.network === "mainnet" ? latestFillRate(runs) : null;
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
      toast.success(`Synced to block ${formatHeight(w.synced_height)}`);
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
          <h2 id="balance-title" className="text-[0.8125rem] text-muted-foreground">
            Balance
          </h2>
          <div className="mt-1.5 text-[1.75rem] leading-tight font-[380] sm:text-[2rem]">
            <Zec zat={t.total_zat} className="[&_[data-unit]]:text-[0.55em]" />
          </div>
          {rate ? (
            <div className="mt-1 text-sm text-muted-foreground">
              About <Usd cents={zatToCents(t.total_zat, rate)} className="text-strong" /> at the latest fill rate
            </div>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-1">
          <div>
            <dt className="text-[0.8125rem] text-muted-foreground">Spendable</dt>
            <dd className="mt-0.5 text-[0.9375rem]">
              <Zec zat={t.spendable_zat} short />
            </dd>
          </div>
          <div className="sm:mt-2">
            <dt className="text-[0.8125rem] text-muted-foreground">Pending</dt>
            <dd className="mt-0.5 text-[0.9375rem]">
              <Zec zat={t.pending_zat} short />
            </dd>
          </div>
        </dl>
      </div>
      <div className="mt-auto pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline pt-4">
          <p className="min-w-0 text-sm text-strong" aria-live="polite">
            {syncing && progress ? (
              progress.tip > progress.synced ? (
                <>
                  Scanning blocks: <span className="num">{formatHeight(progress.synced)}</span> of{" "}
                  <span className="num">{formatHeight(progress.tip)}</span>
                </>
              ) : (
                "Checking the chain tip for new blocks"
              )
            ) : behind === 0 ? (
              <>
                Synced to block <span className="num">{formatHeight(wallet.synced_height)}</span>, up to date
              </>
            ) : (
              <>
                Synced to block <span className="num">{formatHeight(wallet.synced_height)}</span>,{" "}
                <span className="num">{formatHeight(behind)}</span> behind the tip
              </>
            )}
          </p>
          <Button variant="secondary" size="sm" onClick={sync} disabled={syncing}>
            <RefreshCw className={cn(syncing && "animate-spin")} aria-hidden="true" />
            {syncing ? "Syncing" : "Sync"}
          </Button>
        </div>
        {error ? <ErrorState error={error} onRetry={sync} compact className="mt-3" /> : null}
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
        <div className="justify-self-start">
          <QrCode value={address} label="QR code of the treasury address" size={132} />
        </div>
        <div className="min-w-0">
          <p className="text-[0.9375rem] text-strong">Send {coin} to this shielded address to fund payroll.</p>
          <div className="mt-3 flex items-start gap-1">
            <code className="min-w-0 flex-1 rounded-md bg-raised p-2 font-mono text-[11px] leading-relaxed break-all">
              {address}
            </code>
            <CopyButton value={address} label="treasury address" size="icon-sm" />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Account {wallet.treasury.account_index}, unified address</p>
        </div>
      </div>
    </Card>
  );
}

function FundingHistory({ runs, error, onRetry }: { runs?: Run[]; error?: ApiError; onRetry: () => void }) {
  const funded = runs ? newestFirst(runs).filter((r) => r.funding) : [];
  return (
    <section aria-labelledby="funding-title">
      <SectionHeader id="funding-title" title="Funding history" />
      {error && !runs ? (
        <ErrorState error={error} onRetry={onRetry} compact />
      ) : !runs ? (
        <div role="status" aria-label="Loading funding history" className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : funded.length === 0 ? (
        <p className="border-t border-hairline py-4 text-sm text-muted-foreground">
          No funding yet. Each payroll run records its funding here: the venue, the dollars in and the coins bought.
        </p>
      ) : (
        <table className="w-full border-collapse text-[0.9375rem]">
          <caption className="sr-only">Funding for each payroll run, newest first</caption>
          <thead>
            <tr className="border-b border-hairline text-left text-[0.8125rem] text-muted-foreground">
              <th scope="col" className="w-[4.5rem] py-3 pr-2 font-normal">
                Date
              </th>
              <th scope="col" className="py-3 pr-3 font-normal">
                Source
              </th>
              <th scope="col" className="hidden py-3 pr-3 font-normal md:table-cell">
                Status
              </th>
              <th scope="col" className="py-3 pr-0 text-right font-normal sm:pr-6">
                Funded
              </th>
              <th scope="col" className="hidden py-3 pr-6 text-right font-normal sm:table-cell">
                Acquired
              </th>
              <th scope="col" className="hidden py-3 text-right font-normal lg:table-cell">
                Rate
              </th>
            </tr>
          </thead>
          <tbody>
            {funded.map((run) => {
              const f = run.funding!;
              const tag = FUNDING_TAG[f.status] ?? { label: f.status, tone: "neutral" as TagTone };
              const cents = f.funded_usd_cents ?? f.requested_usd_cents ?? null;
              return (
                <tr key={run.id} className="border-b border-hairline">
                  <td className="h-[56px] pr-2 whitespace-nowrap">{shortDate(run.created_at)}</td>
                  <td className="py-2 pr-3">
                    <span className="block">{fundingSource(run)}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatPeriodLabel(run.period_label)} run · {venueLabel(f.venue)}
                    </span>
                  </td>
                  <td className="hidden pr-3 md:table-cell">
                    <Tag tone={tag.tone}>{tag.label}</Tag>
                  </td>
                  <td className="py-2 pr-0 text-right sm:pr-6">
                    <Usd cents={cents} className={cn("block", f.status === "success" && "text-success")} />
                    <Zec
                      zat={f.zec_acquired_zat ?? f.quoted_zat}
                      short
                      className="block text-xs text-muted-foreground sm:hidden"
                    />
                  </td>
                  <td className="hidden pr-6 text-right sm:table-cell">
                    <Zec zat={f.zec_acquired_zat ?? f.quoted_zat} short />
                  </td>
                  <td className="hidden text-right lg:table-cell">
                    {isSimulated(run) ? (
                      <Tag title="Testnet coins have no price; the service uses a fixed rate.">Simulated rate</Tag>
                    ) : (
                      <Rate e6={f.rate_usd_per_zec_e6} className="text-sm" />
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
