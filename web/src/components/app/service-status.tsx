"use client";

import { useHealth } from "@/components/app/health-provider";
import { ErrorState, Panel, Stat } from "@/components/app/states";
import { HealthWarnings } from "@/components/app/health-warnings";
import { Skeleton } from "@/components/ui/skeleton";
import { API_URL } from "@/lib/api";
import { formatHeight, networkLabel, venueLabel } from "@/lib/format";

/** Live network status from GET /api/health, or the offline state with the fix. */
export function ServiceStatus() {
  const { health, error, loading, refresh } = useHealth();

  if (error) return <ErrorState error={error} onRetry={refresh} />;

  return (
    <Panel
      title="Network status"
      description={
        <>
          Live from the Payslip service at <code className="font-mono text-xs">{API_URL}</code>
        </>
      }
    >
      {loading && !health ? (
        <div role="status" aria-label="Loading network status" className="grid grid-cols-2 gap-6 p-4 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-24" />
            </div>
          ))}
        </div>
      ) : health ? (
        <dl className="grid grid-cols-2 gap-6 p-4 sm:grid-cols-4">
          <Stat label="Network">Zcash {networkLabel(health.network).toLowerCase()}</Stat>
          <Stat label="Chain tip">
            <span className="num">{formatHeight(health.chain_tip)}</span>
          </Stat>
          <Stat
            label="Wallet synced to"
            hint={
              health.wallet_synced_height < health.chain_tip
                ? `${formatHeight(health.chain_tip - health.wallet_synced_height)} blocks behind`
                : "Up to date"
            }
          >
            <span className="num">{formatHeight(health.wallet_synced_height)}</span>
          </Stat>
          <Stat label="Swap venue">{venueLabel(health.venue)}</Stat>
        </dl>
      ) : null}
      {health ? <HealthWarnings className="m-4 mt-0" /> : null}
    </Panel>
  );
}
