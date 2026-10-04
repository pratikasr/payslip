"use client";

import { useHealth } from "@/components/app/health-provider";
import { formatHeight, networkLabel } from "@/lib/format";
import { cn } from "cn";

/** Small live indicator in the header: network and chain tip, or offline. */
export function NetworkBadge({ className, compact }: { className?: string; compact?: boolean }) {
  const { health, error, loading } = useHealth();
  let dot = "bg-muted-foreground";
  let text = "Connecting";
  let title = "Checking the Payslip service";
  if (health && !error) {
    const degraded = health.status === "degraded" || (health.warnings?.length ?? 0) > 0;
    dot = degraded ? "bg-warning" : health.network === "mainnet" ? "bg-success" : "bg-primary";
    text = compact
      ? networkLabel(health.network)
      : `${networkLabel(health.network)}, tip ${formatHeight(health.chain_tip)}`;
    title = degraded
      ? `Degraded: ${(health.warnings ?? []).join(" ") || "lightwalletd is unreachable."}`
      : `Zcash ${health.network}. Chain tip ${formatHeight(health.chain_tip)}, wallet synced to ${formatHeight(health.wallet_synced_height)}.`;
    if (degraded && !compact) text = `${networkLabel(health.network)}, degraded`;
  } else if (error) {
    dot = "bg-danger";
    text = compact ? "Offline" : "Service offline";
    title = error.message;
  } else if (!loading) {
    text = "Unknown";
  }
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-2 rounded-full border bg-card px-2.5 text-xs font-medium whitespace-nowrap",
        className,
      )}
      title={title}
      role="status"
    >
      <span aria-hidden="true" className={cn("size-2 rounded-full", dot)} />
      <span className="num">{text}</span>
    </span>
  );
}
