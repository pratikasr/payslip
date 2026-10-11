"use client";

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";

/** Mercury's filter chip as a native select: a grey pill that says what it filters. */
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
    <span className="relative inline-flex">
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
        className={cn(
          "h-8 max-w-[15rem] appearance-none truncate rounded-full border border-transparent bg-secondary py-0 pr-8 pl-3.5 text-[0.8125rem] text-secondary-foreground outline-none hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
          active && "border-foreground/40 bg-chip",
        )}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
    </span>
  );
}
