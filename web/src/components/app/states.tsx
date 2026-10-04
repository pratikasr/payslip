import { AlertTriangle, RotateCw } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { UNREACHABLE_CODE, type ApiError } from "@/lib/api";
import { cn } from "cn";

/** Error state: says what went wrong and names the fix (the API's hint). */
export function ErrorState({
  error,
  onRetry,
  title,
  className,
  compact,
}: {
  error: ApiError;
  onRetry?: () => void;
  title?: string;
  className?: string;
  compact?: boolean;
}) {
  const unreachable = error.code === UNREACHABLE_CODE;
  return (
    <div
      role="alert"
      className={cn(
        "rounded-lg border border-danger/30 bg-danger-bg text-foreground",
        compact ? "p-3" : "p-4 sm:p-5",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="font-medium">{title ?? (unreachable ? "Payslip service is offline" : error.message)}</p>
          {title || unreachable ? <p className="text-sm">{error.message}</p> : null}
          {error.hint ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Fix: </span>
              <FixText text={error.hint} />
            </p>
          ) : null}
          {!unreachable && error.code && error.status ? (
            <p className="text-xs text-muted-foreground">
              Error code <code className="font-mono">{error.code}</code>, HTTP {error.status}
            </p>
          ) : null}
        </div>
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry} className="shrink-0" data-print="hide">
            <RotateCw aria-hidden="true" />
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** Renders "Start it with: cd service && cargo run" with the command in code style. */
function FixText({ text }: { text: string }) {
  const m = /^([\s\S]*?with: )([\s\S]+?)(\.(?: |$)[\s\S]*)?$/.exec(text);
  if (!m) return <>{text}</>;
  return (
    <>
      {m[1]}
      <code className="rounded bg-card px-1.5 py-0.5 font-mono text-[0.8125rem] text-foreground">{m[2]}</code>
      {m[3] ?? ""}
    </>
  );
}

/** Empty state: one sentence of what will appear here and one action. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-3 px-4 py-8 sm:px-6", className)}>
      {icon ? <div className="text-muted-foreground [&_svg]:size-5">{icon}</div> : null}
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {children ? <div className="max-w-prose text-sm text-muted-foreground">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}

export function TableSkeleton({ rows = 4, columns = 5, label }: { rows?: number; columns?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="divide-y">
      <div className="flex gap-4 px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 px-4 py-4">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className={cn("h-4 flex-1", i === 0 && "max-w-40")} />
          ))}
        </div>
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  back,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        {back ? (
          <Link href={back.href} className="text-sm text-muted-foreground hover:text-foreground" data-print="hide">
            {back.label}
          </Link>
        ) : null}
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description ? <div className="max-w-2xl text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2" data-print="hide">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** A labelled figure: label above value. */
export function Stat({
  label,
  children,
  hint,
  className,
}: {
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-lg font-medium tracking-tight">{children}</dd>
      {hint ? <dd className="text-xs text-muted-foreground">{hint}</dd> : null}
    </div>
  );
}

/** A bordered section with an optional header row. Not a card grid: panels hold real groups. */
export function Panel({
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className={cn("min-w-0 rounded-lg border bg-card", className)}
      data-print="plain"
    >
      {title || actions ? (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
          <div className="min-w-0 space-y-0.5">
            {title ? (
              <h2 id={headingId} className="text-sm font-semibold">
                {title}
              </h2>
            ) : null}
            {description ? <div className="text-sm text-muted-foreground">{description}</div> : null}
          </div>
          {actions ? (
            <div className="flex flex-wrap items-center gap-2" data-print="hide">
              {actions}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
