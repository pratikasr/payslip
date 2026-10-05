import { RailStep } from "@/components/shell/focus-shell";

export const FLOW_STEPS = ["Amounts", "Review and approve", "Fund", "Pay"] as const;

/**
 * The four steps of running payroll. Wide screens get Mercury's vertical rail; phones get one
 * line ("Step 2 of 4") and a thin bar, so the step list does not push the content down.
 */
export function FlowRail({ current, done = false }: { current: number; done?: boolean }) {
  const index = Math.min(current, FLOW_STEPS.length - 1);
  return (
    <>
      <ol className="hidden lg:block">
        {FLOW_STEPS.map((label, i) => (
          <li key={label}>
            <RailStep state={done || i < index ? "done" : i === index ? "current" : "upcoming"}>{label}</RailStep>
          </li>
        ))}
      </ol>
      <div className="lg:hidden">
        <p className="text-sm text-muted-foreground">
          {done ? "All steps done" : `Step ${index + 1} of ${FLOW_STEPS.length}`}
          <span className="text-foreground"> · {done ? "Paid" : FLOW_STEPS[index]}</span>
        </p>
        <div className="mt-2 grid grid-cols-4 gap-1" aria-hidden="true">
          {FLOW_STEPS.map((label, i) => (
            <span
              key={label}
              className={
                done || i < index
                  ? "h-0.5 rounded-full bg-strong/60"
                  : i === index
                    ? "h-0.5 rounded-full bg-primary-edge"
                    : "h-0.5 rounded-full bg-border"
              }
            />
          ))}
        </div>
      </div>
    </>
  );
}
