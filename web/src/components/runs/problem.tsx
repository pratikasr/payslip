import type { ReactNode } from "react";
import { CircleAlert, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UNREACHABLE_CODE, type ApiErrorBody } from "@/lib/api";
import { cn } from "cn";

/**
 * A problem in plain words: what happened (the API's message) and how to fix it (its hint), with
 * one Retry. Pink tint only, because this is the one place something needs fixing.
 */
export function Problem({
  error,
  title,
  onRetry,
  retryLabel = "Retry",
  busy,
  action,
  className,
}: {
  error: Pick<ApiErrorBody, "message" | "hint"> & { code?: string };
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
  busy?: boolean;
  action?: ReactNode;
  className?: string;
}) {
  const offline = error.code === UNREACHABLE_CODE;
  return (
    <div role="alert" className={cn("rounded-xl bg-danger-bg px-4 py-3.5 text-[0.9375rem] sm:px-5", className)}>
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-foreground">{title ?? (offline ? "Payslip service is offline" : error.message)}</p>
          {title || offline ? <p className="text-sm text-strong">{error.message}</p> : null}
          {error.hint ? <p className="text-sm [overflow-wrap:anywhere] text-strong">{error.hint}</p> : null}
          {onRetry || action ? (
            <div className="flex flex-wrap gap-2 pt-2" data-print="hide">
              {onRetry ? (
                <Button size="sm" variant="secondary" onClick={onRetry} disabled={busy}>
                  <RotateCw aria-hidden="true" />
                  {busy ? "Retrying" : retryLabel}
                </Button>
              ) : null}
              {action}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
