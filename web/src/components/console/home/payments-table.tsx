"use client";

import Link from "next/link";
import { useState } from "react";
import { Usd } from "@/components/app/amount";
import { Initials } from "@/components/ds/avatar";
import { SectionHeader } from "@/components/ds/page";
import { SHIELDED_HELP } from "@/components/ds/status";
import type { PayLine, Run } from "@/lib/api";
import { formatShortDate, venueLabel } from "@/lib/format";
import { latestPeriodFirst, lineConfirmedAt } from "@/lib/payroll";
import { cn } from "cn";
import { fundingSource, isPendingLine, isSimulated } from "@/components/console/lib";
import { ArrowLink, FilterChips } from "@/components/console/ui";
import { isConverted, LineStatus, pastFunding, plural, runTitle } from "@/components/runs/run-meta";

type Filter = "recent" | "pending" | "converted" | "failed";

/** Recent shows whole runs until at least this many payments are listed. */
const RECENT_ROWS = 10;

interface Group {
  run: Run;
  lines: PayLine[];
  /** Mainnet funding that arrived for the run: money in, shown above its payments. */
  inflow: boolean;
}

const matches: Record<Exclude<Filter, "recent">, (l: PayLine) => boolean> = {
  pending: isPendingLine,
  converted: isConverted,
  failed: (l) => l.status === "failed",
};

/**
 * Payments, latest pay period first, grouped under their run ("Sep 2026 payroll · 6 payments ·
 * $30,375.50"), as Mercury groups transactions. Only runs that were funded appear: a draft has
 * paid nobody. A confirmed payment shows the gold Shielded mark instead of a grey status; a
 * payment that needs attention shows its tag. Testnet funding is not listed: on testnet nothing
 * arrives (coins already in the treasury are set aside); Treasury lists it.
 */
export function PaymentsTable({ runs }: { runs: Run[] }) {
  const [filter, setFilter] = useState<Filter>("recent");
  const funded = latestPeriodFirst(runs.filter(pastFunding));
  const all = funded.flatMap((r) => r.lines);
  const counts = {
    pending: all.filter(matches.pending).length,
    converted: all.filter(matches.converted).length,
    failed: all.filter(matches.failed).length,
  };
  let groups: Group[];
  if (filter === "recent") {
    groups = [];
    let rows = 0;
    for (const run of funded) {
      if (rows >= RECENT_ROWS) break;
      groups.push({ run, lines: run.lines, inflow: run.funding?.status === "success" && !isSimulated(run) });
      rows += run.lines.length;
    }
  } else {
    groups = funded
      .map((run) => ({ run, lines: run.lines.filter(matches[filter]), inflow: false }))
      .filter((g) => g.lines.length > 0);
  }
  const empty = {
    recent: "No payments yet.",
    pending: "No payments waiting to be sent or confirmed.",
    converted: "No payments converted to USDC.",
    failed: "No failed payments.",
  }[filter];
  // Only filters with something in them (Mercury shows counts where there is work).
  const options = [
    { id: "recent" as const, label: "Recent" },
    { id: "pending" as const, label: "Pending", count: counts.pending },
    { id: "converted" as const, label: "Converted to USDC", count: counts.converted },
    { id: "failed" as const, label: "Failed", count: counts.failed },
  ].filter((o) => o.id === "recent" || o.id === filter || (o.count ?? 0) > 0);

  return (
    <section aria-labelledby="payments-title">
      <SectionHeader id="payments-title" title="Payments">
        <ArrowLink href="/console/runs">All runs</ArrowLink>
      </SectionHeader>
      {options.length > 1 ? (
        <FilterChips label="Filter payments" value={filter} onChange={setFilter} options={options} />
      ) : null}
      <table className="w-full table-fixed border-collapse text-[0.9375rem]">
        <caption className="sr-only">
          Payments by payroll run, latest pay period first. Shielded: {SHIELDED_HELP.toLowerCase()}.
        </caption>
        <thead>
          <tr className="border-b border-hairline text-left text-[0.8125rem] text-muted-foreground">
            <th scope="col" className="w-[4.25rem] py-3 pr-2 font-normal">
              Date
            </th>
            <th scope="col" className="py-3 pr-2 font-normal">
              To
            </th>
            <th scope="col" className="w-[7.5rem] py-3 pr-0 text-right font-normal sm:w-[9.5rem] sm:pr-[22px]">
              Amount
            </th>
            <th scope="col" className="hidden w-[9rem] py-3 font-normal sm:table-cell">
              Status
            </th>
          </tr>
        </thead>
        {groups.length === 0 ? (
          <tbody>
            <tr className="border-b border-hairline">
              <td colSpan={3} className="h-[50px] text-[0.8125rem] text-muted-foreground">
                {empty}
              </td>
            </tr>
          </tbody>
        ) : (
          groups.map((g) => <RunGroup key={g.run.id} group={g} />)
        )}
      </table>
    </section>
  );
}

function RunGroup({ group: { run, lines, inflow } }: { group: Group }) {
  const total = lines.reduce((s, l) => s + l.amount_usd_cents, 0);
  const f = run.funding;
  return (
    <tbody>
      <tr className="border-b border-hairline bg-raised/60">
        {/* Three columns on phones (Status is hidden there), so the header spans three and an
            empty cell takes the fourth from tablet width up; a span of four would add a phantom
            column on phones and squeeze the names. */}
        <th scope="colgroup" colSpan={3} className="h-9 px-0 text-left font-normal">
          <span className="flex min-w-0 items-baseline gap-2 pr-1 text-[0.8125rem]">
            <Link
              href={`/console/runs/${run.id}`}
              className="truncate rounded-sm pl-2 text-foreground hover:underline sm:pl-3"
            >
              {runTitle(run)} payroll
            </Link>
            <span className="shrink-0 text-muted-foreground">
              {plural(lines.length, "payment")} · <Usd cents={total} />
            </span>
          </span>
        </th>
        <td className="hidden sm:table-cell" />
      </tr>
      {inflow && f ? (
        <tr className="border-b border-hairline">
          <td className="h-[52px] pr-2 whitespace-nowrap text-strong">{formatShortDate(run.created_at)}</td>
          <td className="pr-2">
            <span className="flex min-w-0 items-center gap-3">
              <Initials text="US" />
              <span className="block min-w-0 truncate">
                {fundingSource(run)} via {venueLabel(f.venue)}
              </span>
            </span>
          </td>
          <td className="py-1.5 pr-0 text-right sm:pr-[22px]">
            <Usd cents={f.funded_usd_cents} signed className="block text-success" />
          </td>
          <td className="hidden text-[0.8125rem] text-muted-foreground sm:table-cell">Into treasury</td>
        </tr>
      ) : null}
      {lines.map((line) => {
        const at = lineConfirmedAt(line, run);
        return (
          <tr key={line.id} className="border-b border-hairline">
            <td className="h-[52px] pr-2 whitespace-nowrap text-strong">
              {at ? formatShortDate(at) : <span className="text-muted-foreground">Not yet</span>}
            </td>
            <td className="pr-2">
              <span className="flex min-w-0 items-center gap-3">
                <Initials name={line.contractor_name} />
                <span className="min-w-0">
                  <Link
                    href={`/console/people?person=${line.contractor_id}`}
                    className="block truncate rounded-sm hover:underline"
                  >
                    {line.contractor_name}
                  </Link>
                  {/* Phones hide the Status column: the mark moves under the name. */}
                  <span className="block sm:hidden">
                    <LineStatus line={line} run={run} />
                  </span>
                </span>
              </span>
            </td>
            <td className={cn("py-1.5 pr-0 text-right sm:pr-[22px]", line.status === "failed" && "line-through")}>
              <Usd cents={-line.amount_usd_cents} className="block" />
            </td>
            <td className="hidden sm:table-cell">
              <LineStatus line={line} run={run} />
            </td>
          </tr>
        );
      })}
    </tbody>
  );
}
