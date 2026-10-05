import type { ReactNode } from "react";
import { CircleAlert, RotateCw } from "lucide-react";
import { CopyButton } from "@/components/app/copy-button";
import { Button } from "@/components/ui/button";
import { serviceSetupHint, UNREACHABLE_CODE, type ApiErrorBody } from "@/lib/api";
import { truncateMiddle } from "@/lib/format";
import { cn } from "cn";

/** A Zcash unified address inside a sentence (the service's hints name the treasury address). */
const UNIFIED_ADDRESS = /\b(?:u|utest)1[02-9ac-hj-np-z]{60,}\b/;

export type ProblemError = Pick<ApiErrorBody, "message" | "hint"> & { code?: string; status?: number };

/**
 * The console's one way to show a problem: what happened (the API's message) and how to fix it
 * (its hint), with "Try again" when trying again can help. Pink tint only, because this is the
 * one place something needs fixing.
 *
 * - A request for something that is gone (HTTP 404) offers no Try again: it would fail the same way.
 * - A long address in the hint is shortened in the sentence and offered with a copy button.
 * - When the service does not answer, the setup details sit behind a disclosure for whoever runs
 *   Payslip; the payer sees plain words first.
 */
export function Problem({
  error,
  title,
  onRetry,
  retryLabel = "Try again",
  busyLabel = "Trying again",
  busy,
  action,
  className,
}: {
  error: ProblemError;
  title?: string;
  onRetry?: () => void;
  retryLabel?: string;
  busyLabel?: string;
  busy?: boolean;
  action?: ReactNode;
  className?: string;
}) {
  const offline = error.code === UNREACHABLE_CODE;
  const retry = error.status === 404 ? undefined : onRetry;
  const address = error.hint ? UNIFIED_ADDRESS.exec(error.hint)?.[0] : undefined;
  // "...to the treasury address utest1..." reads "...to the treasury address"; the address itself
  // gets its own line with a copy button.
  const hint = address
    ? error.hint.includes(`address ${address}`)
      ? error.hint.replace(` ${address}`, "")
      : error.hint.replace(address, "the treasury address")
    : error.hint;
  return (
    <div role="alert" className={cn("rounded-xl bg-danger-bg px-4 py-3.5 text-[0.9375rem] sm:px-5", className)}>
      <div className="flex items-start gap-3">
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-foreground">{title ?? error.message}</p>
          {title ? <p className="text-[0.8125rem] text-strong">{error.message}</p> : null}
          {hint ? <p className="text-[0.8125rem] [overflow-wrap:anywhere] text-strong">{hint}</p> : null}
          {address ? (
            <p className="flex min-w-0 items-center gap-1 text-[0.8125rem] text-strong">
              <span className="shrink-0">Treasury address</span>
              <code className="min-w-0 truncate font-mono text-[0.8125rem]" title={address}>
                {truncateMiddle(address, 12, 8)}
              </code>
              <CopyButton value={address} label="treasury address" />
            </p>
          ) : null}
          {offline ? (
            <details className="pt-1 text-[0.8125rem] text-strong">
              <summary className="cursor-pointer rounded-sm text-muted-foreground hover:text-foreground">
                For whoever runs Payslip
              </summary>
              <p className="mt-1 [overflow-wrap:anywhere]">{serviceSetupHint()}</p>
            </details>
          ) : null}
          {retry || action ? (
            <div className="flex flex-wrap gap-2 pt-2" data-print="hide">
              {retry ? (
                <Button size="sm" variant="secondary" onClick={retry} disabled={busy}>
                  <RotateCw aria-hidden="true" />
                  {busy ? busyLabel : retryLabel}
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
