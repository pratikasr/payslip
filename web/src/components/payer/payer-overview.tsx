"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Zec } from "@/components/app/amount";
import { Hash } from "@/components/app/hash";
import { EmptyState, ErrorState, PageHeader, Panel, Stat, TableSkeleton } from "@/components/app/states";
import { RunsTable } from "@/components/payer/runs-table";
import { HealthWarnings } from "@/components/app/health-warnings";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { api, toDisplayError, UNREACHABLE_CODE, type Contractor, type Run } from "@/lib/api";
import { formatCount, formatHeight } from "@/lib/format";
import { cn } from "cn";

export function PayerOverview() {
  const wallet = useResource((s) => api.wallet(s), "wallet");
  const contractors = useResource((s) => api.contractors(s), "contractors");
  const runs = useResource((s) => api.runs(s), "runs");
  const [syncing, setSyncing] = useState(false);

  const offline = [wallet.error, contractors.error, runs.error].find((e) => e?.code === UNREACHABLE_CODE);
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
          <Button asChild>
            <Link href="/app/payer/runs/new">
              <Plus aria-hidden="true" />
              New run
            </Link>
          </Button>
        }
      />

      {offline ? (
        <ErrorState error={offline} onRetry={retryAll} />
      ) : (
        <>
          <HealthWarnings />
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

          {contractors.data && runs.data && (contractors.data.length === 0 || runs.data.length === 0) ? (
            <SetupChecklist contractors={contractors.data} runs={runs.data} />
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

function SetupChecklist({ contractors, runs }: { contractors: Contractor[]; runs: Run[] }) {
  const shared = contractors.filter((c) => c.fvk_shared_at).length;
  const steps = [
    {
      done: contractors.length > 0,
      title: "Add your contractors",
      body: "Name, unified address and how they want to be paid. Each gets a dedicated account.",
      href: "/app/payer/contractors",
      cta: "Add contractors",
    },
    {
      done: contractors.length > 0 && shared === contractors.length,
      title: "Share each viewing key",
      body: "Each contractor gets the viewing key for their account, so they can read their own statement.",
      href: "/app/payer/contractors",
      cta: "Share viewing keys",
    },
    {
      done: runs.length > 0,
      title: "Create a run",
      body: "Pick the period and enter each contractor's amount in USD with an invoice reference.",
      href: "/app/payer/runs/new",
      cta: "Create a run",
    },
    {
      done: runs.some((r) => r.status === "paid"),
      title: "Fund and execute",
      body: "Send USDC, then execute. Each contractor receives one shielded payment with a memo.",
      href: "/app/payer/runs",
      cta: "Open runs",
    },
  ];
  const next = steps.findIndex((s) => !s.done);
  return (
    <Panel title="Get your first payroll out" description="Four steps. The next one is highlighted.">
      <ol className="divide-y">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className={cn(
              "flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center",
              i === next && "bg-warning-bg/50",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "num inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                s.done && "border-transparent bg-success-bg text-success",
                i === next && "border-primary-edge",
              )}
            >
              {s.done ? <Check className="size-3.5" /> : i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {s.title}
                {s.done ? (
                  <span className="sr-only"> (done)</span>
                ) : i === next ? (
                  <span className="sr-only"> (next step)</span>
                ) : null}
              </p>
              <p className="text-sm text-muted-foreground">{s.body}</p>
            </div>
            {i === next ? (
              <Button asChild size="sm">
                <Link href={s.href}>{s.cta}</Link>
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    </Panel>
  );
}
