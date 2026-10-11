import Link from "next/link";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { LogoMark } from "@/components/app/logo";
import { PrivacyToggle } from "@/components/shell/privacy-toggle";
import { cn } from "cn";

/**
 * The full-screen task layout (run payroll): the mark and context at the top, a close button, a
 * step rail on the left and one focused column. No sidebar, so nothing competes with the decision
 * being made.
 */
export function FocusShell({
  context,
  closeHref,
  rail,
  children,
  footer,
  summary,
}: {
  context: ReactNode;
  closeHref: string;
  rail?: ReactNode;
  children: ReactNode;
  /** A sticky bar at the bottom of the screen (count, total, primary action). */
  footer?: ReactNode;
  /**
   * Mercury's send-flow summary: a card in the right column on wide screens (people, total, coin,
   * fees, period), so the step does not float in a narrow column. Hidden below 1280px, where the
   * step itself and its footer carry the same figures.
   */
  summary?: ReactNode;
}) {
  return (
    <>
      <div className="paper feed-edges min-h-[calc(100dvh-3rem)]">
        <header role="banner" className="flex items-center gap-3.5 px-2.5 py-5 sm:px-10" data-print="hide">
          <LogoMark className="size-[26px]" />
          <span aria-hidden="true" className="h-[22px] w-px bg-ink" />
          <span className="min-w-0 truncate font-type text-[0.9375rem] font-bold">{context}</span>
          {/* The same eye as the console's top bar: amounts stay hidden here when it is on. */}
          <span className="ml-auto">
            <PrivacyToggle />
          </span>
          <Link
            href={closeHref}
            className="inline-flex size-9 items-center justify-center border-2 border-ink text-strong hover:bg-muted pointer-coarse:size-11"
            aria-label="Close"
          >
            <X className="size-5" aria-hidden="true" />
          </Link>
        </header>
        <div
          className={cn(
            "grid gap-6 px-2.5 pt-2 pb-28 sm:px-10 lg:gap-16",
            rail ? "lg:grid-cols-[260px_minmax(0,560px)]" : "justify-center lg:grid-cols-[minmax(0,640px)]",
            rail && summary && "xl:grid-cols-[220px_minmax(0,560px)_minmax(0,300px)] xl:gap-12",
          )}
        >
          {rail ? (
            <nav aria-label="Steps" className="lg:pl-14 xl:pl-6">
              {rail}
            </nav>
          ) : null}
          <main id="main" className="min-w-0">
            {children}
          </main>
          {summary ? (
            <aside aria-label="Summary" className="hidden xl:block">
              <div className="sticky top-6">{summary}</div>
            </aside>
          ) : null}
        </div>
        {footer ? (
          <div className="paper fixed inset-x-0 bottom-0 z-30 border-t-2 border-ink" data-print="hide">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3 sm:px-10">{footer}</div>
          </div>
        ) : null}
      </div>
    </>
  );
}

/**
 * One step in the rail, numbered in a box like a numbered field on a form: ticked and filled in
 * ink once done, ruled in ink for the current step, a dashed box for what is still to come.
 */
export function RailStep({
  state,
  number,
  children,
}: {
  state: "done" | "current" | "upcoming";
  number?: number;
  children: ReactNode;
}) {
  return (
    <div
      aria-current={state === "current" ? "step" : undefined}
      className={cn(
        "flex items-center gap-3 py-[7px] font-type text-[0.9375rem]",
        state === "current" && "font-bold text-foreground",
        state === "done" && "text-strong",
        state === "upcoming" && "text-muted-foreground",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-7 shrink-0 place-items-center border-2 text-[0.875rem] leading-none font-bold",
          state === "done" && "border-ink bg-ink text-paper",
          state === "current" && "border-ink",
          state === "upcoming" && "border-dashed border-faint",
        )}
      >
        {state === "done" ? (
          <svg viewBox="0 0 24 24" className="size-4">
            <path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="3" />
          </svg>
        ) : (
          number
        )}
      </span>
      {children}
    </div>
  );
}
