"use client";

import { MINUS, formatFiat, formatRate, formatRateFull, formatUsd, formatZec } from "@/lib/format";
import { cn } from "cn";
import { useCoinUnit } from "@/components/app/health-provider";

/**
 * ZEC from zatoshis. Full precision shows all 8 decimals with the last four dimmed, so a figure
 * reads at a glance and stays exact; `short` rounds to 4 decimals for summaries.
 */
export function Zec({
  zat,
  className,
  unit = true,
  short = false,
}: {
  zat: number | null | undefined;
  className?: string;
  unit?: boolean;
  short?: boolean;
}) {
  const coin = useCoinUnit();
  if (zat === null || zat === undefined) return <span className={cn("text-muted-foreground", className)}>Not set</span>;
  const full = formatZec(zat);
  const head = short ? formatZec(Math.round(zat / 10_000) * 10_000).slice(0, -4) : full.slice(0, -4);
  const tail = short ? "" : full.slice(-4);
  return (
    <span className={cn("money", className)} title={`${full} ${coin}`}>
      {head}
      {tail ? <span className="money-tail">{tail}</span> : null}
      {unit ? (
        <span className="ml-1 tracking-normal text-muted-foreground" data-unit="">
          {coin}
        </span>
      ) : null}
    </span>
  );
}

/** Splits "$4,800.00" into "$4,800" and ".00" so the cents can be set smaller and raised. */
function splitCents(text: string): [string, string] {
  const i = text.lastIndexOf(".");
  return i < 0 ? [text, ""] : [text.slice(0, i), text.slice(i)];
}

/** "$30.4K", "$1.2M": for cards and charts only; tables and documents show every cent. */
export function compactUsd(cents: number): string {
  const v = Math.abs(cents) / 100;
  const sign = cents < 0 ? MINUS : "";
  if (v >= 1_000_000) return `${sign}$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 10_000) return `${sign}$${(v / 1_000).toFixed(v >= 100_000 ? 0 : 1)}K`;
  return formatUsd(cents);
}

/** USD from cents with Mercury's raised cents; `compact` abbreviates for summary cards. */
export function Usd({
  cents,
  className,
  signed,
  compact,
}: {
  cents: number | null | undefined;
  className?: string;
  signed?: boolean;
  compact?: boolean;
}) {
  if (cents === null || cents === undefined)
    return <span className={cn("text-muted-foreground", className)}>Not set</span>;
  if (compact && Math.abs(cents) >= 1_000_000)
    return (
      <span className={cn("money", className)} title={formatUsd(cents, { signed })}>
        {compactUsd(cents)}
      </span>
    );
  const [main, frac] = splitCents(formatUsd(cents, { signed }));
  return (
    <span className={cn("money", className)}>
      {main}
      {frac ? <span className="money-cents">{frac}</span> : null}
    </span>
  );
}

/** An amount in another currency (value at receipt), cents raised like Usd. */
export function Fiat({ cents, currency, className }: { cents: number; currency: string; className?: string }) {
  const [main, frac] = splitCents(formatFiat(cents, currency));
  return (
    <span className={cn("money", className)}>
      {main}
      {frac ? <span className="money-cents">{frac}</span> : null}
    </span>
  );
}

/** Fill rate, USD per ZEC. Exact value in the title. */
export function Rate({
  e6,
  className,
  unit = true,
}: {
  e6: number | null | undefined;
  className?: string;
  unit?: boolean;
}) {
  const coin = useCoinUnit();
  if (e6 === null || e6 === undefined) return <span className={cn("text-muted-foreground", className)}>Not set</span>;
  return (
    <span className={cn("money", className)} title={`${formatRateFull(e6)} USD per ${coin}`}>
      {formatRate(e6)}
      {unit ? (
        <span className="ml-1 text-muted-foreground" data-unit="">
          per {coin}
        </span>
      ) : null}
    </span>
  );
}

/** The coin's unit as text: TAZ on testnet, ZEC on mainnet. For headers and labels. */
export function Coin() {
  return <>{useCoinUnit()}</>;
}
