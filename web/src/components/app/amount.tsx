"use client";

import { createContext, useContext, type ReactNode } from "react";
import { MINUS, formatFiat, formatRate, formatRateFull, formatUsd, formatZec } from "@/lib/format";
import { cn } from "cn";
import { useCoinUnit } from "@/components/app/health-provider";

/*
  Typed figures (docs/DESIGN.md section 17). In the company console every figure is printed on a
  form: typewritten, with the cents level, never raised. The console layout turns this on for
  everything under it, dialogs and drawers included (React context crosses portals); a figure
  that sets its own face (the dot matrix of a headline amount) keeps it. Elsewhere the figures
  keep the faces their pages give them.
*/
const TypedFigures = createContext(false);

export function TypedFiguresProvider({ children }: { children: ReactNode }) {
  return <TypedFigures.Provider value>{children}</TypedFigures.Provider>;
}

/** The figure's classes: `money`, the typewriter when figures are typed (unless a face is given), and the caller's. */
function useFigureClass(className?: string): string {
  const typed = useContext(TypedFigures);
  return cn("money", typed && "font-type", className);
}

/** True where cents print level (typed figures): the cents are plain text, not set smaller and raised. */
function usePlainCents(): boolean {
  return useContext(TypedFigures);
}

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
  const figure = useFigureClass(className);
  if (zat === null || zat === undefined) return <span className={cn("text-muted-foreground", className)}>Not set</span>;
  const full = formatZec(zat);
  const head = short ? formatZec(Math.round(zat / 10_000) * 10_000).slice(0, -4) : full.slice(0, -4);
  const tail = short ? "" : full.slice(-4);
  return (
    <span className={figure} title={`${full} ${coin}`}>
      {head}
      {/* Dimmed by colour, not opacity, so the digits keep 4.5:1 contrast on any ground. */}
      {tail ? <span className="text-muted-foreground">{tail}</span> : null}
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
  const figure = useFigureClass(className);
  const plain = usePlainCents();
  if (cents === null || cents === undefined)
    return <span className={cn("text-muted-foreground", className)}>Not set</span>;
  if (compact && Math.abs(cents) >= 1_000_000)
    return (
      <span className={figure} title={formatUsd(cents, { signed })}>
        {compactUsd(cents)}
      </span>
    );
  if (plain) return <span className={figure}>{formatUsd(cents, { signed })}</span>;
  const [main, frac] = splitCents(formatUsd(cents, { signed }));
  return (
    <span className={figure}>
      {main}
      {frac ? <span className="money-cents">{frac}</span> : null}
    </span>
  );
}

/** An amount in another currency (value at receipt), cents raised like Usd. */
export function Fiat({ cents, currency, className }: { cents: number; currency: string; className?: string }) {
  const figure = useFigureClass(className);
  const plain = usePlainCents();
  if (plain) return <span className={figure}>{formatFiat(cents, currency)}</span>;
  const [main, frac] = splitCents(formatFiat(cents, currency));
  return (
    <span className={figure}>
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
  const figure = useFigureClass(className);
  if (e6 === null || e6 === undefined) return <span className={cn("text-muted-foreground", className)}>Not set</span>;
  return (
    <span className={figure} title={`${formatRateFull(e6)} USD per ${coin}`}>
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
