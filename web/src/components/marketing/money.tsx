import { cn } from "cn";
import { formatUsd, formatZec } from "@/lib/format";

/*
  Server-rendered figures for the static landing page, with the app's .money class (so privacy
  mode would blur them too): dollars with raised cents, coin at 8 decimals with the last four in
  Ash, as in the app.
*/

export function Usd({ cents, className }: { cents: number; className?: string }) {
  const text = formatUsd(cents);
  const i = text.lastIndexOf(".");
  return (
    <span className={cn("money", className)}>
      {text.slice(0, i)}
      <span className="money-cents">{text.slice(i)}</span>
    </span>
  );
}

export function Coin({ zat, unit, className }: { zat: number; unit: string; className?: string }) {
  const full = formatZec(zat);
  return (
    <span className={cn("money tracking-normal", className)} title={`${full} ${unit}`}>
      {full.slice(0, -4)}
      <span className="text-ash">{full.slice(-4)}</span> {unit}
    </span>
  );
}
