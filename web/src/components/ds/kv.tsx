import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * Label and value pairs as rows of a form: the label in spaced caps, the value typewritten, two
 * columns on wide screens and stacked on phones.
 */
export function KeyValues({
  items,
  className,
}: {
  items: { label: ReactNode; value: ReactNode; hint?: ReactNode }[];
  className?: string;
}) {
  return (
    <dl
      className={cn(
        "grid gap-x-3 gap-y-3.5 font-type text-[0.9375rem] sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-y-3",
        className,
      )}
    >
      {items.map((it, i) => (
        <div key={i} className="contents">
          <dt className="form-label pt-[3px] text-[0.75rem] font-bold text-muted-foreground">{it.label}</dt>
          <dd className="mb-2 min-w-0 sm:mb-0">
            <div className="text-foreground">{it.value}</div>
            {it.hint ? <div className="font-sans text-[0.8125rem] text-muted-foreground">{it.hint}</div> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
