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
 * The vertical timeline, typed like a log sheet: a small box per step on a dotted rail. A step
 * that happened is a ticked box in ink, the one under way a box with an ink corner, what has not
 * happened an empty dashed box, a failure a red box with a cross, a retry a canary box. The words
 * carry the state, so the box is never the only signal. Used by a payment's drawer and a run's
 * audit trail.
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
                  "absolute top-[22px] bottom-1 left-[6px] border-l-2 border-dotted",
                  e.state === "done" ? "border-foreground/45" : "border-border",
                )}
              />
            ) : null}
            <TimelineBox state={e.state} />
            <div className="min-w-0">
              <div
                className={cn(
                  "font-type text-[0.875rem] leading-[1.45] [overflow-wrap:anywhere]",
                  e.state === "upcoming" && "text-muted-foreground",
                )}
              >
                {e.title}
              </div>
              {e.detail ? (
                <div className="mt-0.5 font-type text-[0.8125rem] [overflow-wrap:anywhere] text-muted-foreground">
                  {e.detail}
                </div>
              ) : null}
              {e.time ? (
                <time dateTime={e.dateTime} className="mt-0.5 block font-type text-[0.8125rem] text-muted-foreground">
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

/** The step's box: ticked, under way, empty, crossed or flagged. Decorative; the words say it. */
function TimelineBox({ state }: { state: TimelineState }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative mt-[3px] grid size-3.5 place-items-center border-[1.5px]",
        state === "done" && "border-foreground bg-foreground text-background",
        state === "current" && "border-foreground bg-card",
        state === "upcoming" && "border-dashed border-faint bg-card",
        state === "failed" && "border-destructive bg-danger-bg text-destructive",
        state === "warning" && "border-warning bg-warning-bg",
      )}
    >
      {state === "done" ? (
        <svg viewBox="0 0 12 12" className="size-2.5">
          <path d="m2.5 6.2 2.2 2.2 4.8-5" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      ) : state === "current" ? (
        <span className="size-1.5 bg-foreground" />
      ) : state === "failed" ? (
        <svg viewBox="0 0 12 12" className="size-2.5">
          <path d="m3 3 6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      ) : null}
    </span>
  );
}
