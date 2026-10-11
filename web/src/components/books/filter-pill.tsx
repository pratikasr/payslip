"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";

/**
 * A filter as a field of a printed form: its name in spaced caps over a typed select on a ruled
 * baseline. A filter in use is set in bold on a heavier rule, so a filtered ledger says so.
 */
export function FilterPill({
  label,
  value,
  onChange,
  children,
  active,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  active?: boolean;
  testId?: string;
}) {
  return (
    <span className="grid min-w-0 gap-1">
      <span aria-hidden="true" className="form-label text-[0.75rem] font-bold">
        {label}
      </span>
      <span className="relative inline-flex min-w-0">
        <select
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid={testId}
          className={cn(
            "h-9 w-full max-w-[15rem] min-w-0 appearance-none truncate border-0 border-b border-input bg-transparent py-0 pr-7 pl-1 font-type text-[0.9375rem] text-foreground outline-none hover:border-foreground focus-visible:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid [&>option]:bg-popover",
            active && "border-b-2 border-foreground font-bold",
          )}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
      </span>
    </span>
  );
}
