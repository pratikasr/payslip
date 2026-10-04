import { Check, X } from "lucide-react";
import type { Run } from "@/lib/api";
import { cn } from "cn";

export type StepState = "done" | "current" | "upcoming" | "failed";

const STEPS = ["Fund", "Execute", "Paid"] as const;

const FUNDED_OR_LATER = new Set(["funded", "swapping", "swapped", "allocating", "paying", "paid"]);

/** Which step the run is on. A failed run is shown failed at the step it stopped in. */
export function runStep(run: Run): { index: number; failed: boolean } {
  if (run.status === "paid") return { index: 3, failed: false };
  if (run.status === "failed") {
    const pastFunding = run.failed_from
      ? FUNDED_OR_LATER.has(run.failed_from)
      : run.funding?.status === "success" || run.lines.some((l) => l.status !== "pending");
    return { index: pastFunding ? 1 : 0, failed: true };
  }
  if (FUNDED_OR_LATER.has(run.status)) return { index: 1, failed: false };
  return { index: 0, failed: false };
}

export function RunStepper({ run }: { run: Run }) {
  const { index, failed } = runStep(run);
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Run progress">
      {STEPS.map((label, i) => {
        const state: StepState = i < index ? "done" : i === index ? (failed ? "failed" : "current") : "upcoming";
        return (
          <li
            key={label}
            aria-current={state === "current" || state === "failed" ? "step" : undefined}
            className="min-w-0"
          >
            <div
              className={cn(
                "h-1 rounded-full bg-border",
                state === "done" && "bg-success",
                state === "current" && "bg-primary",
                state === "failed" && "bg-danger",
              )}
            />
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span
                aria-hidden="true"
                className={cn(
                  "num inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-semibold",
                  state === "done" && "border-transparent bg-success-bg text-success",
                  state === "current" && "border-primary-edge",
                  state === "failed" && "border-transparent bg-danger-bg text-danger",
                  state === "upcoming" && "text-muted-foreground",
                )}
              >
                {state === "done" ? (
                  <Check className="size-3" />
                ) : state === "failed" ? (
                  <X className="size-3" />
                ) : (
                  i + 1
                )}
              </span>
              <span className={cn("truncate", state === "upcoming" ? "text-muted-foreground" : "font-medium")}>
                {label}
              </span>
              <span className="sr-only">
                {state === "done"
                  ? "(done)"
                  : state === "current"
                    ? "(current step)"
                    : state === "failed"
                      ? "(failed)"
                      : "(not started)"}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
