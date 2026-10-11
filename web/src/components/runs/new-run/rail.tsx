"use client";

import { useEffect, type ReactNode, type RefObject } from "react";
import { useDocumentTitle } from "@/components/portal/document-title";
import { RailStep } from "@/components/shell/focus-shell";
import { cn } from "cn";
import { TYPE } from "@/components/ds/type";

export const FLOW_STEPS = ["Amounts", "Review and approve", "Fund", "Pay"] as const;

/** The step names in the document title, the last one for a run that is paid. */
const TITLES = [...FLOW_STEPS, "Paid"] as const;

/**
 * Each step's heading. It takes focus (tabIndex -1) when the flow moves to its step, so a
 * keyboard or screen reader user lands on the new step instead of the top of the page.
 */
export function FlowTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h1 tabIndex={-1} data-flow-title="" className={cn(TYPE.title, "outline-none", className)}>
      {children}
    </h1>
  );
}

/**
 * Names the step in the document title ("Review and approve, Run payroll | Payslip") and, when
 * the flow moved from another step, focuses the new step's heading once it is on screen.
 * `previous` is kept by the flow's parent, so approving (which swaps the draft for the run)
 * still counts as a move. Nothing is focused on the first load of the page.
 */
export function useStepFocus(step: number, previous: RefObject<number | null>, ready: boolean) {
  // Kept in place even when Next writes the route's own title after hydration.
  useDocumentTitle(`${TITLES[Math.min(step, TITLES.length - 1)]}, Run payroll | Payslip`);
  useEffect(() => {
    if (!ready) return;
    const before = previous.current;
    previous.current = step;
    if (before === null || before === step) return;
    document.querySelector<HTMLElement>("main [data-flow-title]")?.focus();
  }, [step, ready, previous]);
}

/**
 * The four steps of running payroll. Wide screens get a vertical rail of numbered boxes; phones
 * get one typed line ("Step 2 of 4") and four small boxes, so the step list does not push the
 * content down.
 */
export function FlowRail({ current, done = false }: { current: number; done?: boolean }) {
  const index = Math.min(current, FLOW_STEPS.length - 1);
  return (
    <>
      <ol className="hidden lg:block">
        {FLOW_STEPS.map((label, i) => (
          <li key={label}>
            <RailStep state={done || i < index ? "done" : i === index ? "current" : "upcoming"} number={i + 1}>
              {label}
            </RailStep>
          </li>
        ))}
      </ol>
      <div className="lg:hidden">
        <p className="font-type text-[0.8125rem] text-muted-foreground">
          <span className="form-label text-[0.75rem] font-bold">
            {done ? "All steps done" : `Step ${index + 1} of ${FLOW_STEPS.length}`}
          </span>
          <span className="font-bold text-foreground">: {done ? "Paid" : FLOW_STEPS[index]}</span>
        </p>
        <div className="mt-2 grid grid-cols-4 gap-1" aria-hidden="true">
          {FLOW_STEPS.map((label, i) => (
            <span
              key={label}
              className={
                done || i < index
                  ? "h-2 border border-ink bg-ink"
                  : i === index
                    ? "h-2 border border-ink"
                    : "h-2 border border-dashed border-faint"
              }
            />
          ))}
        </div>
      </div>
    </>
  );
}
