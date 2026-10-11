"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ListChecks, Send, UsersRound } from "lucide-react";
import { Usd } from "@/components/app/amount";
import { PageTitle } from "@/components/ds/page";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useResource } from "@/hooks/use-resource";
import { api, type Run } from "@/lib/api";
import { formatShortDate } from "@/lib/format";
import { latestPeriodFirst, runPaidAt } from "@/lib/payroll";
import { FilterChips } from "@/components/console/ui";
import { Problem } from "./problem";
import { TYPE } from "@/components/ds/type";
import {
  confirmedCount,
  isPaying,
  matchesFilter,
  plural,
  RUN_FILTERS,
  RunTag,
  runTitle,
  type RunFilterId,
} from "./run-meta";

/** The runs list: lifecycle chips with counts over a Mercury table that sits straight on the page. */
export function RunsList({ initial }: { initial?: Run[] }) {
  const runs = useResource((s) => api.runs(s), "console-runs", initial);
  const contractors = useResource((s) => api.contractors(s), "console-runs-contractors");
  const [filter, setFilter] = useState<RunFilterId>("all");

  const all = useMemo(() => latestPeriodFirst(runs.data ?? []), [runs.data]);
  const counts = useMemo(
    () => Object.fromEntries(RUN_FILTERS.map((f) => [f.id, all.filter((r) => matchesFilter(r, f.id)).length])),
    [all],
  ) as Record<RunFilterId, number>;
  const shown = all.filter((r) => matchesFilter(r, filter));
  const empty = runs.data !== undefined && all.length === 0;
  // Mercury shows a filter only where there is something in it; All and the chosen one stay.
  const options = RUN_FILTERS.filter((f) => f.id === "all" || f.id === filter || counts[f.id] > 0).map((f) => ({
    id: f.id,
    label: f.label,
    count: counts[f.id],
  }));

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
          <FilterChips label="Filter runs by status" value={filter} onChange={setFilter} options={options} />
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
      <table className="w-full table-fixed border-collapse text-[0.9375rem]">
        <caption className="sr-only">Payroll runs, latest pay period first. Open a run to see its payments.</caption>
        <thead>
          <tr className="border-b border-hairline text-left text-[0.8125rem] text-muted-foreground">
            <th scope="col" className="py-2.5 pr-3 font-normal">
              Period
            </th>
            <th scope="col" className="hidden w-[5.5rem] py-2.5 pr-3 font-normal sm:table-cell">
              People
            </th>
            <th scope="col" className="w-[7.5rem] py-2.5 pr-3 text-right font-normal sm:w-[9.5rem] sm:pr-6">
              Total
            </th>
            <th scope="col" className="w-[7.5rem] py-2.5 pr-3 font-normal sm:w-[9rem]">
              Status
            </th>
            <th scope="col" className="hidden w-[7rem] py-2.5 font-normal lg:table-cell">
              Paid on
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const paidAt = runPaidAt(r);
            const n = r.lines.length;
            const confirmed = confirmedCount(r.lines);
            return (
              <tr
                key={r.id}
                className="relative border-b border-hairline transition-colors hover:bg-raised has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-[-2px] has-[a:focus-visible]:outline-ring"
              >
                <td className="h-[58px] py-2 pr-3">
                  <Link
                    href={`/console/runs/${r.id}`}
                    className="block truncate text-foreground outline-none after:absolute after:inset-0 after:content-['']"
                  >
                    {runTitle(r)} payroll
                  </Link>
                  <span className="block truncate text-[0.8125rem] text-muted-foreground">
                    <span className="sm:hidden">{plural(n, "person", "people")}, </span>
                    {paidAt ? <span className="lg:hidden">paid {formatShortDate(paidAt)}, </span> : null}
                    created {formatShortDate(r.created_at)}
                  </span>
                </td>
                <td className="hidden py-2 pr-3 text-strong sm:table-cell">
                  <span className="num">{n}</span>
                </td>
                <td className="py-2 pr-3 text-right sm:pr-6">
                  <Usd cents={r.total_usd_cents} />
                  {r.total_zat || r.status === "cancelled" ? null : (
                    <span className="block text-[0.8125rem] text-muted-foreground">Not funded yet</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <RunTag run={r} />
                  {isPaying(r) && n > 0 ? (
                    <span
                      className="mt-1.5 block h-1 w-20 overflow-hidden rounded-full bg-chip"
                      role="progressbar"
                      aria-label={`${runTitle(r)} payments confirmed`}
                      aria-valuemin={0}
                      aria-valuemax={n}
                      aria-valuenow={confirmed}
                      aria-valuetext={`${confirmed} of ${n} confirmed`}
                    >
                      <span
                        className="block h-full rounded-full bg-viz"
                        style={{ width: `${Math.max(6, (confirmed / n) * 100)}%` }}
                      />
                    </span>
                  ) : null}
                </td>
                <td className="hidden py-2 whitespace-nowrap text-strong lg:table-cell">
                  {paidAt ? formatShortDate(paidAt) : <span className="text-muted-foreground">Not yet</span>}
                </td>
              </tr>
            );
          })}
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
        <h2 className={TYPE.heading}>{hasPeople === false ? "Add the people you pay" : "No payroll runs yet"}</h2>
        <p className="text-[0.9375rem] text-muted-foreground">
          {hasPeople === false
            ? "A payroll run pays everyone on your people list in one shielded batch."
            : "A run pays every contractor in one shielded batch, with the period and invoice sealed in each memo."}
        </p>
      </div>
      {hasPeople === false ? (
        <Button asChild>
          <Link href="/console/people?add=1">
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
