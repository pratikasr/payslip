import type { ReactNode } from "react";
import { cn } from "cn";

/** Label and value pairs, two columns on wide screens and stacked on phones (Mercury review screens). */
export function KeyValues({
  items,
  className,
}: {
  items: { label: ReactNode; value: ReactNode; hint?: ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn("grid gap-x-3 gap-y-3.5 text-[0.9375rem] sm:grid-cols-[170px_minmax(0,1fr)]", className)}>
      {items.map((it, i) => (
        <div key={i} className="contents">
          <dt className="text-strong">{it.label}</dt>
          <dd className="mb-2 min-w-0 sm:mb-0">
            <div className="text-foreground">{it.value}</div>
            {it.hint ? <div className="text-[0.8125rem] text-muted-foreground">{it.hint}</div> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
