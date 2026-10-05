"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ListChecks, Send, UsersRound } from "lucide-react";
import { Usd, Zec } from "@/components/app/amount";
import { PageTitle } from "@/components/ds/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { api, type Run } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { cn } from "cn";
import { Problem } from "./problem";
import { matchesFilter, plural, RUN_FILTERS, RunTag, runTitle, type RunFilterId } from "./run-meta";

/** The runs list: lifecycle chips with counts over a Mercury table that sits straight on the page. */
export function RunsList({ initial }: { initial?: Run[] }) {
  const runs = useResource((s) => api.runs(s), "console-runs", initial);
  const contractors = useResource((s) => api.contractors(s), "console-runs-contractors");
  const [filter, setFilter] = useState<RunFilterId>("all");

  const all = useMemo(
    () => [...(runs.data ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [runs.data],
  );
  const counts = useMemo(
    () => Object.fromEntries(RUN_FILTERS.map((f) => [f.id, all.filter((r) => matchesFilter(r, f.id)).length])),
    [all],
  ) as Record<RunFilterId, number>;
  const shown = all.filter((r) => matchesFilter(r, filter));
  const empty = runs.data !== undefined && all.length === 0;

  return (
    <>
      <PageTitle
        title="Payroll runs"
        actions={
          empty ? undefined : (
            <Button asChild>
              <Link href="/console/runs/new">
                <Send aria-hidden="true" />
                Run payroll
              </Link>
            </Button>
          )
        }
      />

      {runs.error && !runs.data ? (
        <Problem error={runs.error} title="Could not load payroll runs" onRetry={() => void runs.reload()} />
      ) : !runs.data ? (
        <TableLoading />
      ) : empty ? (
        <EmptyRuns hasPeople={contractors.data ? contractors.data.length > 0 : undefined} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter runs by status">
            {RUN_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                aria-pressed={filter === f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-strong transition-colors hover:bg-muted",
                  filter === f.id && "border-transparent bg-chip text-foreground hover:bg-chip",
                )}
              >
                {f.label}
                <span className="num text-xs text-muted-foreground">{counts[f.id]}</span>
              </button>
            ))}
          </div>
          <RunsTable runs={shown} />
          {shown.length === 0 ? (
            <p className="border-b border-hairline py-6 text-[0.9375rem] text-muted-foreground">
              No runs with this status.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}

function RunsTable({ runs }: { runs: Run[] }) {
  return (
    <div className="-mx-1 px-1">
      <table className="w-full border-collapse text-[0.9375rem]">
        <caption className="sr-only">Payroll runs, newest first. Open a run to see its payments.</caption>
        <thead>
          <tr className="border-b border-hairline text-left text-[0.8125rem] text-muted-foreground">
            <th scope="col" className="py-2.5 pr-3 font-normal">
              Period
            </th>
            <th scope="col" className="hidden py-2.5 pr-3 font-normal sm:table-cell">
              People
            </th>
            <th scope="col" className="py-2.5 pr-3 text-right font-normal sm:pr-6">
              Total
            </th>
            <th scope="col" className="py-2.5 pr-3 font-normal">
              Status
            </th>
            <th scope="col" className="hidden py-2.5 font-normal md:table-cell">
              Created
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr
              key={r.id}
              className="relative border-b border-hairline transition-colors hover:bg-raised has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-[-2px] has-[a:focus-visible]:outline-ring"
            >
              <td className="h-[58px] py-2 pr-3">
                <Link
                  href={`/console/runs/${r.id}`}
                  className="text-foreground outline-none after:absolute after:inset-0 after:content-['']"
                >
                  {runTitle(r)}
                </Link>
                <span className="block text-[0.8125rem] text-muted-foreground sm:hidden">
                  {plural(r.lines.length, "person", "people")} · {formatDate(r.created_at)}
                </span>
              </td>
              <td className="hidden py-2 pr-3 text-strong sm:table-cell">
                <span className="num">{r.lines.length}</span>
              </td>
              <td className="py-2 pr-3 text-right sm:pr-6">
                <Usd cents={r.total_usd_cents} />
                <span className="block text-[0.8125rem] text-muted-foreground">
                  {r.total_zat ? <Zec zat={r.total_zat} short /> : "Not funded yet"}
                </span>
              </td>
              <td className="py-2 pr-3">
                <RunTag status={r.status} />
              </td>
              <td className="hidden py-2 whitespace-nowrap text-strong md:table-cell">{formatDate(r.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TableLoading() {
  return (
    <div role="status" aria-label="Loading payroll runs" className="mt-11">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex h-[58px] items-center gap-6 border-b border-hairline">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="hidden h-4 w-8 sm:block" />
          <Skeleton className="ml-auto h-4 w-24" />
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}

function EmptyRuns({ hasPeople }: { hasPeople: boolean | undefined }) {
  return (
    <div className="flex flex-col items-start gap-4 border-t border-hairline py-12 sm:items-center sm:text-center">
      <span className="grid size-11 place-items-center rounded-full bg-chip text-strong">
        {hasPeople === false ? (
          <UsersRound className="size-5" aria-hidden="true" />
        ) : (
          <ListChecks className="size-5" aria-hidden="true" />
        )}
      </span>
      <div className="max-w-md space-y-1.5">
        <h2 className="text-[1.1875rem] font-normal tracking-[-0.01em]">
          {hasPeople === false ? "Add the people you pay" : "No payroll runs yet"}
        </h2>
        <p className="text-[0.9375rem] text-muted-foreground">
          {hasPeople === false
            ? "A payroll run pays everyone on your people list in one shielded batch."
            : "A run pays every contractor in one shielded batch, with the period and invoice sealed in each memo."}
        </p>
      </div>
      {hasPeople === false ? (
        <Button asChild>
          <Link href="/console/people">
            <UsersRound aria-hidden="true" />
            Add people
          </Link>
        </Button>
      ) : (
        <Button asChild>
          <Link href="/console/runs/new">
            <Send aria-hidden="true" />
            Run payroll
          </Link>
        </Button>
      )}
    </div>
  );
}
