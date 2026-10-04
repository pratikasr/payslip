import Link from "next/link";
import { Usd, Zec } from "@/components/app/amount";
import { RunStatusBadge } from "@/components/app/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Run } from "@/lib/api";
import { formatDate, formatPeriodLabel, formatRange } from "@/lib/format";

export function RunsTable({ runs, label }: { runs: Run[]; label: string }) {
  return (
    <>
      <ul className="divide-y md:hidden" aria-label={label}>
        {runs.map((run) => (
          <li key={run.id}>
            <Link
              href={`/app/payer/runs/${run.id}`}
              className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-muted/40"
            >
              <span className="min-w-0">
                <span className="block font-medium">{formatPeriodLabel(run.period_label)}</span>
                <span className="block text-xs text-muted-foreground">
                  {run.lines.length} {run.lines.length === 1 ? "contractor" : "contractors"}, created{" "}
                  {formatDate(run.created_at)}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <Usd cents={run.total_usd_cents} className="font-medium" />
                <RunStatusBadge status={run.status} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table label={label} minWidth={720}>
          <TableHeader>
            <TableRow>
              <TableHead>Period</TableHead>
              <TableHead>Status</TableHead>
              <TableHead numeric>Contractors</TableHead>
              <TableHead numeric>Total USD</TableHead>
              <TableHead numeric>Total ZEC</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((run) => {
              const paid = run.lines.filter((l) => l.status === "confirmed").length;
              return (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link href={`/app/payer/runs/${run.id}`} className="font-medium underline-offset-4 hover:underline">
                      {formatPeriodLabel(run.period_label)}
                    </Link>
                    <div className="text-xs text-muted-foreground">{formatRange(run.period_start, run.period_end)}</div>
                  </TableCell>
                  <TableCell>
                    <RunStatusBadge status={run.status} />
                  </TableCell>
                  <TableCell numeric>
                    {run.status === "paying" || run.status === "paid"
                      ? `${paid} of ${run.lines.length}`
                      : run.lines.length}
                  </TableCell>
                  <TableCell numeric>
                    <Usd cents={run.total_usd_cents} />
                  </TableCell>
                  <TableCell numeric>
                    {run.total_zat ? (
                      <Zec zat={run.total_zat} />
                    ) : (
                      <span className="text-muted-foreground">After funding</span>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(run.created_at)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
