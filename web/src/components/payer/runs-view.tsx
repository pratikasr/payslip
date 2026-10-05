"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CalendarRange, Plus } from "lucide-react";
import { useHealth } from "@/components/app/health-provider";
import { EmptyState, ErrorState, PageHeader, Panel, TableSkeleton } from "@/components/app/states";
import { RunsSummaryStrip } from "@/components/insights/runs-summary-strip";
import { RUN_STATUS } from "@/components/app/status-badge";
import { RunsTable } from "@/components/payer/runs-table";
import { Button } from "@/components/ui/button";
import { useResource } from "@/hooks/use-resource";
import { api, type RunStatus } from "@/lib/api";
import { cn } from "cn";

const GROUPS: { id: string; label: string; statuses: RunStatus[] | null }[] = [
  { id: "all", label: "All", statuses: null },
  { id: "open", label: "To fund", statuses: ["draft", "awaiting_funds"] },
  { id: "progress", label: "In progress", statuses: ["funded", "swapping", "swapped", "allocating", "paying"] },
  { id: "paid", label: "Paid", statuses: ["paid"] },
  { id: "failed", label: "Failed", statuses: ["failed"] },
];

export function RunsView() {
  const runs = useResource((s) => api.runs(s), "runs");
  const contractors = useResource((s) => api.contractors(s), "contractors");
  const { health } = useHealth();
  const [group, setGroup] = useState("all");

  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const g of GROUPS)
      out[g.id] = (runs.data ?? []).filter((r) => !g.statuses || g.statuses.includes(r.status)).length;
    return out;
  }, [runs.data]);

  const active = GROUPS.find((g) => g.id === group) ?? GROUPS[0];
  const visible = (runs.data ?? []).filter((r) => !active.statuses || active.statuses.includes(r.status));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Runs"
        description="Each run pays a set of contractors for one period, newest first."
        actions={
          <Button asChild>
            <Link href="/app/payer/runs/new">
              <Plus aria-hidden="true" />
              New run
            </Link>
          </Button>
        }
      />
      {runs.error ? (
        <ErrorState error={runs.error} onRetry={runs.reload} />
      ) : !runs.data || (!contractors.data && !contractors.error) ? (
        // Summary and list appear together, so the list never moves down when the summary arrives.
        <Panel>
          <TableSkeleton label="Loading runs" />
        </Panel>
      ) : (
        <>
          {runs.data && contractors.data ? (
            <RunsSummaryStrip runs={runs.data} contractors={contractors.data} network={health?.network} />
          ) : null}
          <Panel>
            {runs.data && runs.data.length > 0 ? (
              <div className="flex flex-wrap gap-1 border-b px-3 py-2" role="group" aria-label="Filter runs by status">
                {GROUPS.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={group === g.id}
                    onClick={() => setGroup(g.id)}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground",
                      group === g.id && "bg-muted font-medium text-foreground",
                    )}
                  >
                    {g.label}
                    <span className="num text-xs text-muted-foreground">{counts[g.id]}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {!runs.data ? (
              <TableSkeleton label="Loading runs" />
            ) : runs.data.length === 0 ? (
              <EmptyState
                icon={<CalendarRange />}
                title="No runs yet"
                action={
                  <Button asChild>
                    <Link href="/app/payer/runs/new">Create your first run</Link>
                  </Button>
                }
              >
                Pick a period, enter what each contractor is owed in USD, then fund and execute. Every run you create is
                listed here with its status.
              </EmptyState>
            ) : visible.length === 0 ? (
              <EmptyState title={`No runs are ${active.label.toLowerCase()}`}>
                {active.statuses
                  ? `Runs with status ${active.statuses.map((s) => RUN_STATUS[s].label.toLowerCase()).join(" or ")} appear here.`
                  : null}
              </EmptyState>
            ) : (
              <RunsTable runs={visible} label="Runs" />
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
