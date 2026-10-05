"use client";

import Link from "next/link";
import { useState } from "react";
import { Usd, Zec } from "@/components/app/amount";
import { Initials } from "@/components/ds/avatar";
import { SectionHeader } from "@/components/ds/page";
import { Tag, type TagTone } from "@/components/ds/tag";
import type { Run } from "@/lib/api";
import { venueLabel, formatPeriodLabel } from "@/lib/format";
import { cn } from "cn";
import {
  fundingSource,
  isConverted,
  isPendingLine,
  isSimulated,
  lineTag,
  newestFirst,
  shortDate,
} from "@/components/console/lib";
import { ArrowLink, FilterChips } from "@/components/console/ui";

type Filter = "recent" | "pending" | "converted" | "failed";

interface Row {
  key: string;
  date: string;
  name: string;
  initials?: string;
  cents: number | null;
  zat: number | null;
  incoming: boolean;
  run: Run;
  tag: { label: string; tone: TagTone };
  kind: "line" | "funding";
  pending: boolean;
  converted: boolean;
  failed: boolean;
  personId?: string;
}

function buildRows(runs: Run[]): Row[] {
  const rows: Row[] = [];
  for (const run of newestFirst(runs)) {
    for (const line of run.lines) {
      rows.push({
        key: line.id,
        date: run.updated_at,
        name: line.contractor_name,
        cents: -line.amount_usd_cents,
        zat: line.amount_zat,
        incoming: false,
        run,
        tag: lineTag(line, run),
        kind: "line",
        pending: isPendingLine(line) && run.status !== "draft",
        converted: isConverted(line),
        failed: line.status === "failed",
        personId: line.contractor_id,
      });
    }
    const f = run.funding;
    if (f && f.status === "success") {
      rows.push({
        key: `${run.id}-funding`,
        date: run.created_at,
        name: isSimulated(run) ? "Testnet funding" : `${fundingSource(run)} via ${venueLabel(f.venue)}`,
        initials: isSimulated(run) ? "T" : "US",
        cents: f.funded_usd_cents,
        zat: f.zec_acquired_zat,
        incoming: true,
        run,
        tag: { label: "Treasury", tone: "neutral" },
        kind: "funding",
        pending: false,
        converted: false,
        failed: false,
      });
    }
  }
  return rows;
}

/** Recent pay lines and fundings across runs, as Mercury's transactions table straight on the page. */
export function PaymentsTable({ runs }: { runs: Run[] }) {
  const [filter, setFilter] = useState<Filter>("recent");
  const all = buildRows(runs);
  const counts = {
    pending: all.filter((r) => r.pending).length,
    converted: all.filter((r) => r.converted).length,
    failed: all.filter((r) => r.failed).length,
  };
  const rows =
    filter === "recent"
      ? all.slice(0, 10)
      : all.filter((r) => (filter === "pending" ? r.pending : filter === "converted" ? r.converted : r.failed));
  const empty = {
    recent: "No payments yet.",
    pending: "No payments waiting to be sent or confirmed.",
    converted: "No payments converted to USDC.",
    failed: "No failed payments.",
  }[filter];

  return (
    <section aria-labelledby="payments-title">
      <SectionHeader id="payments-title" title="Payments">
        <ArrowLink href="/console/runs">View all</ArrowLink>
      </SectionHeader>
      <FilterChips
        label="Filter payments"
        value={filter}
        onChange={setFilter}
        options={[
          { id: "recent", label: "Recent" },
          { id: "pending", label: "Pending", count: counts.pending },
          { id: "converted", label: "Converted to USDC", count: counts.converted },
          { id: "failed", label: "Failed", count: counts.failed },
        ]}
      />
      <table className="w-full border-collapse text-[0.9375rem]">
        <caption className="sr-only">Payments, {filter === "recent" ? "most recent first" : filter}</caption>
        <thead>
          <tr className="border-b border-hairline text-left text-[0.8125rem] text-muted-foreground">
            <th scope="col" className="w-[4.5rem] py-3 pr-2 font-normal">
              Date
            </th>
            <th scope="col" className="py-3 pr-2 font-normal">
              To
            </th>
            <th scope="col" className="py-3 pr-0 text-right font-normal sm:pr-[22px]">
              Amount
            </th>
            <th scope="col" className="hidden py-3 pr-2 font-normal sm:table-cell">
              Run
            </th>
            <th scope="col" className="hidden py-3 font-normal sm:table-cell">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr className="border-b border-hairline">
              <td colSpan={5} className="h-[50px] text-sm text-muted-foreground">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.key} className="border-b border-hairline">
                <td className="h-[52px] pr-2 whitespace-nowrap">{shortDate(r.date)}</td>
                <td className="pr-2">
                  <span className="flex min-w-0 items-center gap-3">
                    <Initials name={r.name} text={r.initials} />
                    {r.personId ? (
                      <Link
                        href={`/console/people?person=${r.personId}`}
                        className="min-w-0 truncate rounded-sm hover:underline"
                      >
                        {r.name}
                      </Link>
                    ) : (
                      <span className="min-w-0 truncate">{r.name}</span>
                    )}
                  </span>
                </td>
                <td className="py-1.5 pr-0 text-right sm:pr-[22px]">
                  <Usd cents={r.cents} className={cn("block", r.incoming && "text-success")} />
                  <Zec zat={r.zat} short className="block text-xs text-muted-foreground" />
                </td>
                <td className="hidden pr-2 whitespace-nowrap text-strong sm:table-cell">
                  <Link href={`/console/runs/${r.run.id}`} className="rounded-sm text-sm hover:underline">
                    {formatPeriodLabel(r.run.period_label)}
                  </Link>
                </td>
                <td className="hidden sm:table-cell">
                  <Tag tone={r.tag.tone}>{r.tag.label}</Tag>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
