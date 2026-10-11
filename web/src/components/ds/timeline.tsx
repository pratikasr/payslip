import type { ReactNode } from "react";
import { cn } from "cn";

export type TimelineState = "done" | "current" | "upcoming" | "failed" | "warning";

export interface TimelineItem {
  key: string;
  state: TimelineState;
  title: ReactNode;
  /** A line under the title: a transaction, a block, a reason. */
  detail?: ReactNode;
  /** When it happened, already formatted ("5 Oct 2026, 08:13 UTC"). */
  time?: ReactNode;
  /** The machine-readable time, for <time dateTime>. */
  dateTime?: string;
}

/**
 * The vertical timeline: a dot per step on a thin rail, ink for what happened, an ink ring for
 * what is happening, grey for what has not, red for a failure, amber for a retry. The words carry
 * the state, so colour is never the only signal. Used by a payment's drawer and a run's audit
 * trail.
 */
export function Timeline({ items, className, label }: { items: TimelineItem[]; className?: string; label?: string }) {
  return (
    <ol className={cn("grid", className)} aria-label={label}>
      {items.map((e, i) => {
        const last = i === items.length - 1;
        return (
          <li key={e.key} className="relative grid grid-cols-[14px_minmax(0,1fr)] gap-x-3 pb-4 last:pb-0">
            {!last ? (
              <span
                aria-hidden="true"
                className={cn(
                  "absolute top-4 bottom-0 left-[6px] w-0.5 rounded-full",
                  e.state === "done" ? "bg-foreground/35" : "bg-border",
                )}
              />
            ) : null}
            <span
              aria-hidden="true"
              className={cn(
                "relative mt-1.5 size-2.5 justify-self-center rounded-full",
                e.state === "done" && "bg-foreground",
                e.state === "current" && "border-2 border-foreground bg-card",
                e.state === "upcoming" && "bg-border",
                e.state === "failed" && "bg-destructive",
                e.state === "warning" && "bg-warning",
              )}
            />
            <div className="min-w-0">
              <div
                className={cn(
                  "text-[0.9375rem] [overflow-wrap:anywhere]",
                  e.state === "upcoming" && "text-muted-foreground",
                )}
              >
                {e.title}
              </div>
              {e.detail ? (
                <div className="mt-0.5 text-[0.8125rem] [overflow-wrap:anywhere] text-muted-foreground">{e.detail}</div>
              ) : null}
              {e.time ? (
                <time dateTime={e.dateTime} className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
                  {e.time}
                </time>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
