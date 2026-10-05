"use client";

import { useHealth } from "@/components/app/health-provider";
import { formatHeight, networkLabel } from "@/lib/format";
import { cn } from "cn";

/** Blocks behind the tip before the badge says "syncing": a block or two arrives every few minutes. */
const SYNCING_GAP = 10;

/**
 * Small live indicator in the header: network and chain tip, or offline. It is a live region only
 * while something is wrong (degraded or offline), so a screen reader is not told "Testnet" again
 * every time a block arrives.
 */
export function NetworkBadge({ className, compact }: { className?: string; compact?: boolean }) {
  const { health, error, loading, network } = useHealth();
  let dot = "bg-muted-foreground";
  let text = "Connecting";
  let title = "Checking the Payslip service";
  let alert = false;
  if (health && !error) {
    const degraded = health.status === "degraded" || (health.warnings?.length ?? 0) > 0;
    dot = degraded ? "bg-warning" : health.network === "mainnet" ? "bg-success" : "bg-primary";
    // The block height is for operators: it lives in the tooltip, not the label.
    text = networkLabel(health.network);
    title = degraded
      ? `Degraded: ${(health.warnings ?? []).join(" ") || "lightwalletd is unreachable."}`
      : `Zcash ${health.network}. Up to date with the chain at block ${formatHeight(health.wallet_synced_height)} (tip ${formatHeight(health.chain_tip)}).`;
    if (degraded) {
      alert = true;
      if (!compact) text = `${networkLabel(health.network)}, degraded`;
    }
    const behind = health.chain_tip - health.wallet_synced_height;
    if (!degraded && health.status === "syncing" && behind > SYNCING_GAP) {
      if (!compact) text = `${networkLabel(health.network)}, syncing`;
      title = `Zcash ${health.network}. The service is catching up with the chain (${formatHeight(behind)} blocks behind); balances update when it finishes.`;
    }
  } else if (network && !error) {
    // Known from the server's first look; the details arrive with health.
    text = networkLabel(network);
    title = `Zcash ${network}. Checking the service`;
  } else if (error) {
    dot = "bg-danger";
    text = compact ? "Offline" : "Service offline";
    title = error.message;
    alert = true;
  } else if (!loading) {
    text = "Unknown";
  }
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-2 rounded-full border bg-card px-2.5 text-[0.8125rem] whitespace-nowrap",
        className,
      )}
      title={title}
      role={alert ? "status" : undefined}
    >
      <span aria-hidden="true" className={cn("size-2 rounded-full", dot)} />
      <span className="num">{text}</span>
    </span>
  );
}
