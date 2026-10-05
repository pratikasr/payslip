import { formatRate, formatUsd, formatZec } from "@/lib/format";
import { cn } from "cn";

/*
  Server-rendered twins of Usd and Zec from src/components/app/amount.tsx, with the same markup
  and the same .money class (so privacy mode blurs them too). The app's versions read the network
  from the health provider on the client; the landing page is static, its figures are from a
  testnet run, and it ships no client code for them.
*/

export function UsdFigure({ cents, className }: { cents: number; className?: string }) {
  const text = formatUsd(cents);
  const i = text.lastIndexOf(".");
  return (
    <span className={cn("money", className)}>
      {text.slice(0, i)}
      <span className="money-cents">{text.slice(i)}</span>
    </span>
  );
}

/** Testnet coins are TAZ. Eight decimals, the last four dimmed, as in the app. */
export function TazFigure({ zat, className }: { zat: number; className?: string }) {
  const full = formatZec(zat);
  return (
    <span className={cn("money", className)} title={`${full} TAZ`}>
      {full.slice(0, -4)}
      <span className="money-tail">{full.slice(-4)}</span>
      <span className="ml-1 tracking-normal text-muted-foreground">TAZ</span>
    </span>
  );
}

export function RateFigure({ e6, className }: { e6: number; className?: string }) {
  return <span className={cn("money", className)}>{formatRate(e6)} per TAZ</span>;
}
