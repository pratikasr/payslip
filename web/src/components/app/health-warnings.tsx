"use client";

import { TriangleAlert } from "lucide-react";
import { useHealth } from "@/components/app/health-provider";

/** Warnings reported by GET /api/health (clock skew, lightwalletd trouble). Renders nothing when healthy. */
export function HealthWarnings({ className }: { className?: string }) {
  const { health } = useHealth();
  if (!health) return null;
  const warnings = [...(health.warnings ?? [])];
  if (health.lightwalletd_error && !warnings.some((w) => w.includes(health.lightwalletd_error ?? ""))) {
    warnings.push(`lightwalletd error: ${health.lightwalletd_error}`);
  }
  if (warnings.length === 0 && health.status !== "degraded") return null;
  return (
    <div role="status" className={`rounded-lg border border-warning/40 bg-warning-bg p-3 text-sm ${className ?? ""}`}>
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-medium">The Payslip service is running in a degraded state</p>
          {warnings.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              Balances and statements may lag until it reconnects to {health.lightwalletd}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
