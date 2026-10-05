import type { Metadata } from "next";

export const metadata: Metadata = { title: "Run payroll" };

/**
 * Run payroll is a full-screen task: no sidebar, only the flow. The page renders FocusShell
 * itself because its step rail and sticky footer follow the step the payer is on.
 */
export default function RunPayrollLayout({ children }: { children: React.ReactNode }) {
  return children;
}
