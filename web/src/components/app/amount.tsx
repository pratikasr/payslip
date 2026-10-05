"use client";

import { formatUsd, formatZec, formatRate, formatRateFull } from "@/lib/format";
import { cn } from "cn";
import { useCoinUnit } from "@/components/app/health-provider";

/** ZEC to 8 decimal places with the unit (TAZ on testnet), tabular figures. */
export function Zec({
  zat,
  className,
  unit = true,
}: {
  zat: number | null | undefined;
  className?: string;
  unit?: boolean;
}) {
  const coin = useCoinUnit();
  if (zat === null || zat === undefined) return <span className={cn("text-muted-foreground", className)}>Not set</span>;
  return (
    <span className={cn("num whitespace-nowrap", className)}>
      {formatZec(zat)}
      {unit ? (
        <span className="ml-1 text-muted-foreground" data-unit="">
          {coin}
        </span>
      ) : null}
    </span>
  );
}

/** USD to 2 decimal places with thousands separators. */
export function Usd({
  cents,
  className,
  signed,
}: {
  cents: number | null | undefined;
  className?: string;
  signed?: boolean;
}) {
  if (cents === null || cents === undefined)
    return <span className={cn("text-muted-foreground", className)}>Not set</span>;
  return <span className={cn("num whitespace-nowrap", className)}>{formatUsd(cents, { signed })}</span>;
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
    <span className={cn("num whitespace-nowrap", className)} title={`${formatRateFull(e6)} USD per ${coin}`}>
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
