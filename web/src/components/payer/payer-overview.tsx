"use client";

import Link from "next/link";
import { useState } from "react";
import { ListChecks, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Zec } from "@/components/app/amount";
import { Hash } from "@/components/app/hash";
import { EmptyState, ErrorState, PageHeader, Panel, Stat, TableSkeleton } from "@/components/app/states";
import { RunsTable } from "@/components/payer/runs-table";
import { HealthWarnings } from "@/components/app/health-warnings";
import { useHealth } from "@/components/app/health-provider";
import { PayrollInsights } from "@/components/insights/payroll-insights";
import { setupSteps, SetupGuide, useGuideDismissed } from "@/components/payer/setup-guide";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { api, toDisplayError, UNREACHABLE_CODE, type Contractor, type Run, type Wallet } from "@/lib/api";
import { formatCount, formatHeight } from "@/lib/format";
import { cn } from "cn";

export function PayerOverview({
  initial,
}: {
  initial?: { wallet?: Wallet; contractors?: Contractor[]; runs?: Run[] };
}) {
  const wallet = useResource((s) => api.wallet(s), "wallet", initial?.wallet);
  const contractors = useResource((s) => api.contractors(s), "contractors", initial?.contractors);
  const runs = useResource((s) => api.runs(s), "runs", initial?.runs);
  const [syncing, setSyncing] = useState(false);
  const { health } = useHealth();
  const [guideHidden, setGuideHidden] = useGuideDismissed();
  const network = wallet.data?.network ?? health?.network;

  const ready = wallet.data && contractors.data && runs.data && network;
  const incomplete = ready
    ? setupSteps({ wallet: wallet.data!, contractors: contractors.data!, runs: runs.data!, network: network! }).some(
        (s) => !s.done,
      )
    : false;

  const offline = [wallet.error, contractors.error, runs.error].find((e) => e?.code === UNREACHABLE_CODE);
  // The body appears in one step once all three answered, so nothing already on screen moves
  // when the setup guide or the insights arrive (no layout shift).
  const settled = (wallet.data || wallet.error) && (contractors.data || contractors.error) && (runs.data || runs.error);
  const retryAll = () => {
    void wallet.reload();
    void contractors.reload();
    void runs.reload();
  };

  const onSync = async () => {
    setSyncing(true);
    try {
      const w = await api.syncWallet();
      wallet.setData(w);
      toast.success(`Wallet synced to height ${formatHeight(w.synced_height)}`);
    } catch (err) {
      const e = toDisplayError(err);
      toast.error(e.message, { description: e.hint });
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Overview"
        description="Your treasury, your contractors and recent payroll runs."
        actions={
          <>
            {guideHidden && incomplete ? (
              <Button variant="outline" onClick={() => setGuideHidden(false)}>
                <ListChecks aria-hidden="true" />
                Show setup guide
              </Button>
            ) : null}
            <Button asChild>
              <Link href="/app/payer/runs/new">
                <Plus aria-hidden="true" />
                New run
              </Link>
            </Button>
          </>
        }
      />

      {offline ? (
        <ErrorState error={offline} onRetry={retryAll} />
      ) : !settled ? (
        <OverviewSkeleton />
      ) : (
        <>
          <HealthWarnings />
          {guideHidden !== true && ready && incomplete ? (
            <SetupGuide
              wallet={wallet.data!}
              contractors={contractors.data!}
              runs={runs.data!}
              network={network!}
              onSync={onSync}
              syncing={syncing}
              onHide={() => {
                setGuideHidden(true);
                toast("Setup guide hidden", { description: "Show setup guide brings it back." });
              }}
            />
          ) : null}
          <Panel
            title="Treasury"
            description="Account 0 of the payer wallet. Runs draw ZEC from here."
            actions={
              <Button variant="outline" size="sm" onClick={onSync} disabled={syncing || !!wallet.error}>
                <RefreshCw className={cn(syncing && "animate-spin")} aria-hidden="true" />
                {syncing ? "Syncing" : "Sync wallet"}
              </Button>
            }
          >
            {wallet.error ? (
              <div className="p-4">
                <ErrorState error={wallet.error} onRetry={wallet.reload} compact />
              </div>
            ) : !wallet.data ? (
              <div role="status" aria-label="Loading treasury" className="grid gap-6 p-4 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-2">
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-6 w-32" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4 p-4">
                <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat label="Spendable">
                    <Zec zat={wallet.data.treasury.spendable_zat} />
                  </Stat>
                  <Stat label="Pending">
                    <Zec zat={wallet.data.treasury.pending_zat} />
                  </Stat>
                  <Stat label="Total">
                    <Zec zat={wallet.data.treasury.total_zat} />
                  </Stat>
                  <Stat
                    label="Synced to"
                    hint={
                      wallet.data.synced_height >= wallet.data.chain_tip
                        ? "Up to date with the chain tip"
                        : `Chain tip ${formatHeight(wallet.data.chain_tip)}`
                    }
                  >
                    <span className="num">{formatHeight(wallet.data.synced_height)}</span>
                  </Stat>
                </dl>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-3 text-sm">
                  <span className="text-muted-foreground">Treasury address</span>
                  <Hash value={wallet.data.treasury.unified_address} label="treasury address" head={12} tail={8} />
                </div>
              </div>
            )}
          </Panel>

          {runs.data && contractors.data ? (
            // On an empty workspace the setup guide and the runs panel already point at the first run.
            runs.data.length > 0 ? (
              <PayrollInsights runs={runs.data} contractors={contractors.data} network={network} />
            ) : null
          ) : !runs.error && !contractors.error ? (
            <Panel title="Payroll insights">
              <TableSkeleton label="Loading payroll insights" rows={3} columns={4} />
            </Panel>
          ) : null}

          <Panel
            title="Recent runs"
            actions={
              runs.data && runs.data.length > 0 ? (
                <Button asChild variant="ghost" size="sm">
                  <Link href="/app/payer/runs">All runs</Link>
                </Button>
              ) : null
            }
          >
            {runs.error ? (
              <div className="p-4">
                <ErrorState error={runs.error} onRetry={runs.reload} compact />
              </div>
            ) : !runs.data ? (
              <TableSkeleton label="Loading runs" rows={3} />
            ) : runs.data.length === 0 ? (
              <EmptyState
                title="No runs yet"
                action={
                  <Button asChild variant="outline" size="sm">
                    <Link href="/app/payer/runs/new">Create a run</Link>
                  </Button>
                }
              >
                A run pays a set of contractors for one period. It appears here with its status and totals.
              </EmptyState>
            ) : (
              <RunsTable runs={runs.data.slice(0, 5)} label="Recent runs" />
            )}
          </Panel>

          <Panel
            title="Contractors"
            actions={
              <Button asChild variant="ghost" size="sm">
                <Link href="/app/payer/contractors">Manage</Link>
              </Button>
            }
          >
            {contractors.error ? (
              <div className="p-4">
                <ErrorState error={contractors.error} onRetry={contractors.reload} compact />
              </div>
            ) : !contractors.data ? (
              <div className="p-4">
                <Skeleton className="h-5 w-48" />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-6 p-4 sm:grid-cols-4">
                <dl className="col-span-2 grid grid-cols-2 gap-6">
                  <Stat label="Active contractors">
                    <span className="num">{formatCount(contractors.data.length)}</span>
                  </Stat>
                  <Stat label="Viewing keys shared">
                    <span className="num">
                      {formatCount(contractors.data.filter((c) => c.fvk_shared_at).length)} of{" "}
                      {formatCount(contractors.data.length)}
                    </span>
                  </Stat>
                </dl>
                {contractors.data.some((c) => !c.fvk_shared_at) ? (
                  <div className="col-span-2 flex items-center sm:col-span-2">
                    <p className="text-sm text-muted-foreground">
                      Contractors without their viewing key cannot read their own statement.{" "}
                      <Link href="/app/payer/contractors" className="font-medium text-link underline">
                        Share viewing keys
                      </Link>
                    </p>
                  </div>
                ) : null}
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

/** One placeholder for the whole body while the service answers; replaced in a single step. */
function OverviewSkeleton() {
  return (
    <div role="status" aria-label="Loading overview" className="space-y-6">
      <div className="space-y-4 rounded-lg border bg-card p-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-72 max-w-full" />
        <Skeleton className="h-1.5 w-full" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-full max-w-md" />
        ))}
      </div>
      <div className="grid gap-6 rounded-lg border bg-card p-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-6 w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}
