import { Suspense } from "react";
import { NewRunFlow } from "@/components/runs/new-run/flow";
import { FocusShell } from "@/components/shell/focus-shell";

export default function RunPayrollPage() {
  return (
    <Suspense
      fallback={
        <FocusShell context="Run payroll" closeHref="/console/runs">
          {null}
        </FocusShell>
      }
    >
      <NewRunFlow />
    </Suspense>
  );
}
