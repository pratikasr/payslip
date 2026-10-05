import Link from "next/link";
import type { ReactNode } from "react";
import { X } from "lucide-react";
import { LogoMark } from "@/components/app/logo";
import { cn } from "cn";

/**
 * Mercury's full-screen task layout (send money, review a batch): logo and context at the top,
 * a close button, a step rail on the left and one focused column. No sidebar, so nothing competes
 * with the decision being made.
 */
export function FocusShell({
  context,
  closeHref,
  rail,
  children,
  footer,
}: {
  context: ReactNode;
  closeHref: string;
  rail?: ReactNode;
  children: ReactNode;
  /** A sticky bar at the bottom of the screen (count, total, primary action). */
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-[calc(100dvh-3rem)] bg-background">
      <header role="banner" className="flex items-center gap-3.5 px-4 py-5 sm:px-10" data-print="hide">
        <LogoMark className="size-[26px]" />
        <span aria-hidden="true" className="h-[22px] w-px bg-border" />
        <span className="min-w-0 truncate text-[0.9375rem]">{context}</span>
        <Link
          href={closeHref}
          className="ml-auto inline-flex size-9 items-center justify-center rounded-full text-strong hover:bg-muted"
          aria-label="Close"
        >
          <X className="size-5" aria-hidden="true" />
        </Link>
      </header>
      <div
        className={cn(
          "grid gap-6 px-4 pt-2 pb-28 sm:px-10 lg:gap-16",
          rail ? "lg:grid-cols-[260px_minmax(0,560px)]" : "justify-center lg:grid-cols-[minmax(0,640px)]",
        )}
      >
        {rail ? (
          <nav aria-label="Steps" className="lg:pl-14">
            {rail}
          </nav>
        ) : null}
        <main id="main" className="min-w-0">
          {children}
        </main>
      </div>
      {footer ? (
        <div
          className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline bg-background/95 backdrop-blur"
          data-print="hide"
        >
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-3 sm:px-10">{footer}</div>
        </div>
      ) : null}
    </div>
  );
}

/** One step in the rail: done (tick), current (gold edge) or upcoming (muted). */
export function RailStep({ state, children }: { state: "done" | "current" | "upcoming"; children: ReactNode }) {
  return (
    <div
      aria-current={state === "current" ? "step" : undefined}
      className={cn(
        "flex items-center gap-2 border-l-2 py-[7px] pl-3.5 text-[0.9375rem]",
        state === "current" && "border-primary-edge font-[450] text-foreground",
        state === "done" && "border-hairline text-strong",
        state === "upcoming" && "border-hairline text-muted-foreground",
      )}
    >
      {state === "done" ? (
        <svg viewBox="0 0 24 24" className="size-4 text-success" aria-hidden="true">
          <path
            d="m5 12.5 4.5 4.5L19 7.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : null}
      {children}
    </div>
  );
}
