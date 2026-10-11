"use client";

import { useId } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatRate } from "@/lib/format";
import { cn } from "cn";

/**
 * The one way the app says a testnet rate is simulated: a typed note in a dashed box. Its number lives in
 * the note it opens, not on the page, because a million dollars per TAZ reads as a bug on camera
 * and makes every derived dollar figure look alarming. The note says what the rate is for (turning
 * payroll dollars into faucet coins) and what it is not (a price: fees are real and shown in TAZ).
 * Opens on click, tap or Enter, so it works on phones and by keyboard, unlike a hover tooltip.
 */
export function SimulatedRate({
  rateE6,
  className,
  label = "Simulated rate",
}: {
  /** The testnet venue's fixed rate, USD per TAZ times 1e6, when known. */
  rateE6?: number | null;
  className?: string;
  label?: string;
}) {
  const titleId = useId();
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "relative inline-flex h-6 shrink-0 items-center gap-1.5 border border-dashed border-current px-1.5 font-type text-[0.8125rem] font-bold whitespace-nowrap text-strong transition-colors outline-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid pointer-coarse:after:absolute pointer-coarse:after:-inset-y-2.5 pointer-coarse:after:inset-x-0 pointer-coarse:after:content-['']",
          className,
        )}
      >
        {label}
        <Info className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">, what this means</span>
      </PopoverTrigger>
      <PopoverContent aria-labelledby={titleId}>
        <p id={titleId} className="font-type text-[0.8125rem] font-bold text-foreground">
          A simulated testnet rate
        </p>
        <p className="mt-1 text-muted-foreground">
          Testnet coins have no price. Payroll dollars convert to TAZ at a fixed rate
          {rateE6 ? (
            <>
              {" "}
              of <span className="money font-type text-foreground">{formatRate(rateE6)}</span> per TAZ
            </>
          ) : null}
          , so free faucet coins can carry a demo payroll.
        </p>
        <p className="mt-1.5 text-muted-foreground">
          It is not a price. Network fees and what the treasury keeps are real coin, so they are shown in TAZ.
        </p>
      </PopoverContent>
    </Popover>
  );
}
