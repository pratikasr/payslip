"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Card } from "@/components/ds/card";
import { FocusShell } from "@/components/shell/focus-shell";
import { Button } from "@/components/ui/button";
import { roleLabel } from "@/lib/roles";

/**
 * Run payroll is for admins and approvers. Another role gets the same full-screen frame with a
 * plain explanation instead of a form whose every step would be refused by the service.
 */
export function RunPayrollGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.can("manage_runs")) return children;
  return (
    <FocusShell context="Run payroll" closeHref="/console/runs">
      <Card className="mt-6">
        <h1 className="text-[1.75rem] leading-tight font-[380] tracking-[-0.015em]">Your role cannot run payroll</h1>
        <p className="mt-2 text-[0.9375rem] text-muted-foreground">
          You are signed in as {roleLabel(auth.role).toLowerCase() || "a member"}. Admins and approvers create, fund and
          execute payroll runs; an admin can change your role under Members.
        </p>
        <div className="mt-5 border-t border-hairline pt-4">
          <Button asChild variant="secondary">
            <Link href="/console/runs">Back to payroll runs</Link>
          </Button>
        </div>
      </Card>
    </FocusShell>
  );
}
