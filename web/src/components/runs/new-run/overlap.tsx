"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Usd } from "@/components/app/amount";
import type { Run } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { cn } from "cn";
import { plural, runTag, runTitle } from "../run-meta";
import { overlapKey, type Draft } from "./draft";

/** One line per run that already covers the period: its title, state, total and a link to it. */
function RunsCovering({ runs }: { runs: Run[] }) {
  return (
    <ul className="mt-2 grid gap-1">
      {runs.map((r) => (
        <li key={r.id} className="flex flex-wrap items-center gap-x-2 text-[0.8125rem]">
          {/* At least 24px tall, so links listed one under another are easy to hit (WCAG 2.5.8). */}
          <Link
            href={`/console/runs/${r.id}`}
            className="inline-flex min-h-6 items-center rounded-sm text-link underline"
          >
            {runTitle(r)} run
          </Link>
          <span className="text-strong">
            {runTag(r).label} · <Usd cents={r.total_usd_cents} /> to {plural(r.lines.length, "person", "people")}
          </span>
          <span className="text-muted-foreground">· created {formatDate(r.created_at)}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Shown on Amounts and on Review when another run already covers any day of this period: names
 * those runs with a link to each, and asks the payer to confirm this is an extra run (a bonus, a
 * correction) before going on. Nothing stops a deliberate extra run; it just cannot happen by
 * accident.
 */
export function OverlapWarning({
  runs,
  draft,
  setDraft,
  showError,
  className,
}: {
  runs: Run[];
  draft: Draft;
  setDraft: (update: (d: Draft) => Draft) => void;
  /** True once the payer tried to go on without confirming. */
  showError: boolean;
  className?: string;
}) {
  if (runs.length === 0) return null;
  const key = overlapKey(runs);
  const confirmed = draft.overlapAck === key;
  const title = runTitle({ period_start: draft.from, period_end: draft.to });
  const paid = runs.some((r) => r.status === "paid");
  return (
    <section
      aria-labelledby="overlap-title"
      className={cn("rounded-xl bg-warning-bg px-4 py-3.5 text-[0.9375rem] sm:px-5", className)}
    >
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 id="overlap-title" className="text-foreground">
            {runs.length === 1
              ? `A payroll run already covers ${title}`
              : `${runs.length} payroll runs already cover ${title}`}
          </h2>
          <p className="mt-0.5 text-[0.8125rem] text-strong">
            {paid
              ? "Paying this period again pays these people twice."
              : `Finish or discard ${runs.length === 1 ? "that run" : "those runs"} instead of starting another, unless this one is meant as an extra run.`}
          </p>
          <RunsCovering runs={runs} />
          <label className="mt-3 flex items-start gap-2.5 text-[0.8125rem] text-foreground">
            <input
              id="overlap-confirm"
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setDraft((d) => ({ ...d, overlapAck: e.target.checked ? key : undefined }))}
              aria-invalid={showError && !confirmed}
              aria-describedby={showError && !confirmed ? "overlap-error" : undefined}
              className="mt-0.5 size-4 shrink-0 rounded accent-[var(--primary-edge)]"
            />
            This is an extra run for the same period, such as a bonus or a correction
          </label>
          {showError && !confirmed ? (
            <p id="overlap-error" className="mt-1.5 text-[0.8125rem] text-destructive">
              Tick the box to make an extra run, or choose another pay period.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/**
 * On the Fund step: other runs that cover the same period (an approval sent twice, a second tab,
 * an earlier draft). No confirmation here; it says so before any money moves.
 */
export function OverlapNote({ runs, className }: { runs: Run[]; className?: string }) {
  if (runs.length === 0) return null;
  return (
    <section
      aria-label="Other runs for this period"
      className={cn("rounded-xl bg-warning-bg px-4 py-3.5 text-[0.9375rem] sm:px-5", className)}
    >
      <p className="text-foreground">
        {runs.length === 1 ? "Another run covers this period" : `${runs.length} other runs cover this period`}
      </p>
      <p className="mt-0.5 text-[0.8125rem] text-strong">
        Check this run is meant as an extra one. A draft made by mistake can be discarded from its funding step.
      </p>
      <RunsCovering runs={runs} />
    </section>
  );
}
