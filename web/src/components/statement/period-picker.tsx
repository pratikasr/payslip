"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatRange } from "@/lib/format";
import { isValidRange, PERIOD_PRESETS } from "@/lib/period";
import { cn } from "cn";

export function PeriodPicker({
  from,
  to,
  onChange,
  idPrefix,
}: {
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  idPrefix: string;
}) {
  const invalid = !isValidRange(from, to);
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Period</legend>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Period presets">
        {PERIOD_PRESETS.map((p) => {
          const r = p.range();
          const active = r.from === from && r.to === to;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(r)}
              className={cn(
                "inline-flex h-8 items-center rounded-md border px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                active && "border-primary-edge bg-muted font-medium text-foreground",
              )}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-from`}>From</Label>
          <Input
            id={`${idPrefix}-from`}
            type="date"
            value={from}
            onChange={(e) => onChange({ from: e.target.value, to })}
            aria-invalid={invalid}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}-to`}>To</Label>
          <Input
            id={`${idPrefix}-to`}
            type="date"
            value={to}
            onChange={(e) => onChange({ from, to: e.target.value })}
            aria-invalid={invalid}
          />
        </div>
      </div>
      <p className={cn("text-xs", invalid ? "text-danger" : "text-muted-foreground")}>
        {invalid
          ? "The period must start on or before the day it ends."
          : `${formatRange(from, to)}, in UTC. A payment counts on the day its block was mined.`}
      </p>
    </fieldset>
  );
}
