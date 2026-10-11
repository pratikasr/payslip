"use client";

import { useEffect, useState } from "react";
import { FileText, LoaderCircle } from "lucide-react";
import { useHealth } from "@/components/app/health-provider";
import { SimulatedRate as SharedSimulatedRate } from "@/components/ds/simulated-rate";
import { ShieldedMark } from "@/components/ds/status";
import { Tag } from "@/components/ds/tag";
import { Skeleton } from "@/components/ui/skeleton";
import type { StatementLine } from "@/lib/api";
import { formatHeight, networkLabel, rateE6FromDecimal } from "@/lib/format";
import { cn } from "cn";

/**
 * Real progress text for a statement scan, typed like a teleprinter's status line: what is being
 * read, up to which block, and for how long. The service streams no progress for a scan, so the
 * elapsed time is what moves.
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
      className="flex items-start gap-3 border-y border-foreground px-1 py-3 font-type text-[0.8125rem] text-muted-foreground"
      data-print="hide"
    >
      <LoaderCircle
        className="mt-0.5 size-4 shrink-0 animate-spin text-foreground motion-reduce:animate-none"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="font-bold text-foreground">{title ?? "Reading payments to you from the Zcash chain"}</p>
        <p>
          {health
            ? `Scanning Zcash ${networkLabel(health.network).toLowerCase()} up to block ${formatHeight(health.chain_tip)} with your key`
            : "Scanning the chain with your key"}
          {secs > 0 ? <span className="num">{`, ${secs} s so far`}</span> : null}
        </p>
      </div>
    </div>
  );
}

/** Placeholder slips shaped like the payslip stubs, under the progress text. */
export function RowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="grid gap-2.5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] border border-bar-line">
          <Skeleton className="h-[74px] rounded-none bg-bar" />
          <div className="space-y-2 px-4 py-4">
            <Skeleton className="h-3.5 w-40 rounded-none" />
            <Skeleton className="h-3 w-28 rounded-none" />
          </div>
          <Skeleton className="m-4 h-6 w-24 rounded-none" />
        </div>
      ))}
    </div>
  );
}

/** A small sheet with a folded corner: the glyph of a document on a form. */
export function DocIcon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid h-10 w-[34px] shrink-0 place-items-center border border-foreground bg-card text-foreground",
        className,
      )}
    >
      <FileText className="size-4" />
    </span>
  );
}

/** The tiny SHIELDED stamp for a payment held in ZEC; a typed tag when the person converts pay to USDC. */
export function SettlementTag({ line }: { line: Pick<StatementLine, "settlement"> }) {
  return line.settlement === "converted" ? <Tag tone="neutral">Converted to USDC</Tag> : <ShieldedMark />;
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
  the sidebar is hidden (otherwise the page lands in the sidebar's 220px track), the dark
  theme's remaining surfaces fall back to paper colours, and stamps print in plain ink (the dark
  theme's screen blend would print them white on white).
*/
export const PORTAL_PRINT_CSS = `@media print {
  div.grid:has(aside):has(#main) { display: block !important; }
  .stamped, [data-stamp] { mix-blend-mode: normal !important; }
  .dark {
    --strong: #222222; --faint: #555555; --raised: #ffffff; --chip: #ffffff; --avatar: #ffffff;
    --primary-soft: #ffffff; --hairline: #cccccc; --secondary: #ffffff; --sidebar: #ffffff;
    --popover: #ffffff; --card-foreground: #000000;
  }
}`;
