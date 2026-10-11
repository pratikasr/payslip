import { Suspense } from "react";
import { NewRunFlow } from "@/components/runs/new-run/flow";
import { RunPayrollGate } from "@/components/runs/new-run/role-gate";
import { FocusShell } from "@/components/shell/focus-shell";

export default function RunPayrollPage() {
  return (
    <RunPayrollGate>
      <Suspense
        fallback={
          <FocusShell context="Run payroll" closeHref="/console/runs">
            {null}
          </FocusShell>
        }
      >
        <NewRunFlow />
      </Suspense>
    </RunPayrollGate>
  );
}
