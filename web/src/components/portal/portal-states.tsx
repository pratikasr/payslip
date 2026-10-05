"use client";

import { useEffect, useState } from "react";
import { FileText, LoaderCircle } from "lucide-react";
import { useHealth } from "@/components/app/health-provider";
import { SimulatedRate as SharedSimulatedRate } from "@/components/ds/simulated-rate";
import { Tag } from "@/components/ds/tag";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatementLine } from "@/lib/api";
import { formatHeight, networkLabel, rateE6FromDecimal } from "@/lib/format";
import { cn } from "cn";

/**
 * Real progress text for a statement scan: what is being read, up to which block, and for how
 * long. The service streams no progress for a scan, so the elapsed time is what moves.
 */
export function ScanProgress({ startedAt, title }: { startedAt?: number; title?: string }) {
  const { health } = useHealth();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-[10px] bg-raised px-4 py-3 text-sm text-muted-foreground"
      data-print="hide"
    >
      <LoaderCircle className="mt-0.5 size-4 shrink-0 animate-spin text-foreground" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-foreground">{title ?? "Reading payments to you from the Zcash chain"}</p>
        <p>
          {health
            ? `Scanning Zcash ${networkLabel(health.network).toLowerCase()} up to block ${formatHeight(health.chain_tip)} with your key`
            : "Scanning the chain with your key"}
          {secs > 0 ? <span className="num">{` · ${secs} s`}</span> : null}
        </p>
      </div>
    </div>
  );
}

/** Placeholder rows shaped like the payslip list, under the progress text. */
export function RowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3.5 border-b border-hairline py-3.5">
          <Skeleton className="h-10 w-[34px]" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

/** Mercury's document glyph: a small sheet with a hairline border. */
export function DocIcon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-10 w-[34px] shrink-0 place-items-center rounded-[4px] border bg-card text-muted-foreground",
        className,
      )}
    >
      <FileText className="size-4" />
    </span>
  );
}

/** Shielded for a payment held in ZEC; a plain tag when the person converts pay to USDC. */
export function SettlementTag({ line }: { line: Pick<StatementLine, "settlement"> }) {
  return line.settlement === "converted" ? (
    <Tag tone="neutral">Converted to USDC</Tag>
  ) : (
    <Tag tone="shielded">Shielded</Tag>
  );
}

/**
 * The label testnet figures carry: the app's one SimulatedRate (components/ds/simulated-rate.tsx),
 * whose note gives the fixed rate the service reports and says it is not a market price.
 */
export function SimulatedRate({ className }: { className?: string }) {
  const { health } = useHealth();
  return (
    <span className={cn("inline-block", className)}>
      <SharedSimulatedRate rateE6={rateE6FromDecimal(health?.simulated_rate_usd_per_zec)} />
    </span>
  );
}

/*
  Print rules for the portal, scoped to its pages: the shell's grid collapses to one column once
  the sidebar is hidden (otherwise the page lands in the sidebar's 220px track), and the dark
  theme's remaining surfaces fall back to paper colours.
*/
export const PORTAL_PRINT_CSS = `@media print {
  div.grid:has(aside):has(#main) { display: block !important; }
  .dark {
    --strong: #222222; --faint: #555555; --raised: #ffffff; --chip: #eeeeee; --avatar: #e3f0f2;
    --primary-soft: #fdf1d4; --hairline: #cccccc; --secondary: #eeeeee; --sidebar: #ffffff;
    --popover: #ffffff; --card-foreground: #000000;
  }
}`;
