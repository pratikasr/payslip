import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";

/**
 * The app's one disclosure: a quiet line with a chevron that turns when open, for detail most
 * readers never need (a raw memo, technical details, the raw service log). A native
 * <details>, so it works without script, by keyboard and with screen readers.
 */
export function Disclosure({
  summary,
  children,
  className,
  bodyClassName,
  defaultOpen,
}: {
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  defaultOpen?: boolean;
}) {
  return (
    <details className={cn("group", className)} open={defaultOpen}>
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded-sm text-[0.8125rem] text-strong hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90"
          aria-hidden="true"
        />
        {summary}
      </summary>
      <div className={cn("mt-2", bodyClassName)}>{children}</div>
    </details>
  );
}
