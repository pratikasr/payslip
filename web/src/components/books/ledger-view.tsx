"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Usd, Zec } from "@/components/app/amount";
import { Hash } from "@/components/app/hash";
import { Initials } from "@/components/ds/avatar";
import { ShieldedMark } from "@/components/ds/status";
import { Tag } from "@/components/ds/tag";
import { FilterPill } from "@/components/books/filter-pill";
import { DOT, LEDGER, StatusStamp } from "@/components/portal/paper-parts";
import {
  accountKeyOf,
  ledgerOf,
  payeeOf,
  runName,
  sortRuns,
  type BooksResult,
  type LedgerLine,
} from "@/components/books/books-data";
import { Button } from "@/components/ui/button";
import { formatCount, formatDate, formatHeight, formatPeriodLabel } from "@/lib/format";
import { cn } from "cn";
import { TYPE } from "@/components/ds/type";

type Status = "all" | "confirmed" | "pending" | "converted";

interface Group {
  runId: string;
  period: string;
  lines: LedgerLine[];
}

/**
 * Every pay line in the period, grouped by run (latest pay period first, pending lines first in
 * each run), with contractor, run and status filters. The run filter lives in the address
 * (?run=), so "Open in ledger" links and reloads keep it, and Clear filters clears it.
 */
export function LedgerView({ r }: { r: BooksResult }) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const all = useMemo(() => ledgerOf(r), [r]);
  const [person, setPerson] = useState("all");
  const run = params.get("run") ?? "all";
  const [status, setStatus] = useState<Status>("all");

  const setRun = (id: string) => {
    const next = new URLSearchParams(params.toString());
    if (id === "all") next.delete("run");
    else next.set("run", id);
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };

  // A person who is not in this period's lines (after a period change) falls back to everyone.
  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of all) m.set(accountKeyOf(l), payeeOf(l));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);
  useEffect(() => {
    if (person !== "all" && !people.some(([k]) => k === person)) setPerson("all");
  }, [people, person]);

  const order = useMemo(() => sortRuns(r).map((x) => x.run_id), [r]);
  const runs = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of all) m.set(l.run_id, l.period);
    return [...m.entries()].sort(
      (a, b) => rank(order, a[0]) - rank(order, b[0]) || b[1].localeCompare(a[1]) || a[0].localeCompare(b[0]),
    );
  }, [all, order]);

  const lines = all.filter(
    (l) =>
      (person === "all" || accountKeyOf(l) === person) &&
      (run === "all" || l.run_id === run) &&
      (status === "all" ||
        (status === "pending" && l.pending) ||
        (status === "confirmed" && !l.pending) ||
        (status === "converted" && l.settlement === "converted")),
  );
  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const l of lines) {
      const g = m.get(l.run_id) ?? { runId: l.run_id, period: l.period, lines: [] };
      g.lines.push(l);
      m.set(l.run_id, g);
    }
    return [...m.values()].sort(
      (a, b) => rank(order, a.runId) - rank(order, b.runId) || b.period.localeCompare(a.period),
    );
  }, [lines, order]);
  const total = lines.reduce((s, l) => s + l.usd_basis_cents, 0);
  const totalZat = lines.reduce((s, l) => s + l.amount_zat, 0);
  const pending = lines.filter((l) => l.pending).length;
  const filtered = person !== "all" || run !== "all" || status !== "all";

  return (
    <div className="grid gap-5">
      <div
        className="grid grid-cols-2 items-end gap-x-6 gap-y-4 border-y-2 border-foreground py-4 sm:flex sm:flex-wrap"
        role="group"
        aria-label="Filters"
      >
        <FilterPill
          label="Contractor"
          value={person}
          onChange={setPerson}
          active={person !== "all"}
          testId="ledger-contractor"
        >
          <option value="all">All contractors</option>
          {people.map(([k, name]) => (
            <option key={k} value={k}>
              {name}
            </option>
          ))}
        </FilterPill>
        <FilterPill label="Run" value={run} onChange={setRun} active={run !== "all"} testId="ledger-run">
          <option value="all">All runs</option>
          {run !== "all" && !runs.some(([id]) => id === run) ? (
            <option value={run}>Run {run.slice(0, 8)}</option>
          ) : null}
          {runs.map(([id, period]) => (
            <option key={id} value={id}>
              {runName(period, id)}
            </option>
          ))}
        </FilterPill>
        <FilterPill
          label="Status"
          value={status}
          onChange={(v) => setStatus(v as Status)}
          active={status !== "all"}
          testId="ledger-status"
        >
          <option value="all">All statuses</option>
          <option value="confirmed">Confirmed on chain</option>
          <option value="pending">Pending</option>
          <option value="converted">Converted to USDC</option>
        </FilterPill>
        {filtered ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            onClick={() => {
              setPerson("all");
              setRun("all");
              setStatus("all");
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <dl className="flex flex-wrap items-end gap-x-10 gap-y-4" aria-label="Shown lines">
        <div>
          <dt className={TYPE.label}>Payments</dt>
          <dd className={cn(DOT, "mt-2 text-[1.5rem]")} data-testid="ledger-count">
            {formatCount(lines.length)}
          </dd>
        </div>
        <div>
          <dt className={TYPE.label}>Paid</dt>
          <dd className="mt-2 flex flex-wrap items-baseline gap-x-3">
            <span className={cn(DOT, "text-[1.5rem]")}>
              <Usd cents={total} />
            </span>
            <span className="font-type text-[0.8125rem] text-muted-foreground">
              <Zec zat={totalZat} />
            </span>
          </dd>
        </div>
        <div>
          <dt className={TYPE.label}>Pending</dt>
          <dd className={cn(DOT, "mt-2 text-[1.5rem]")}>{formatCount(pending)}</dd>
        </div>
      </dl>

      {lines.length === 0 ? (
        <p className="border-y-2 border-foreground py-8 text-[0.9375rem] text-muted-foreground">
          {filtered ? "No payments match these filters." : "No payments in this period."}
        </p>
      ) : (
        <>
          <LedgerTable groups={groups} />
          <LedgerList groups={groups} />
        </>
      )}
    </div>
  );
}

function rank(order: string[], runId: string): number {
  const i = order.indexOf(runId);
  return i < 0 ? order.length : i;
}

function groupTotal(g: Group): number {
  return g.lines.reduce((s, l) => s + l.usd_basis_cents, 0);
}

/** Shielded for a payment held in coin; plain tags for pending and converted ones. */
function StatusTags({ l }: { l: LedgerLine }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {l.pending ? (
        <StatusStamp tone="soft">Pending</StatusStamp>
      ) : l.settlement === "converted" ? null : (
        <ShieldedMark />
      )}
      {l.settlement === "converted" ? <Tag>Converted to USDC</Tag> : null}
    </span>
  );
}

const TH = LEDGER.th;
const TD = "px-2.5 py-2.5 align-top";

function LedgerTable({ groups }: { groups: Group[] }) {
  return (
    <div className="hidden overflow-x-auto xl:block" role="region" aria-label="Ledger" tabIndex={0}>
      <table className={cn(LEDGER.table, "min-w-[860px]")} data-testid="ledger-table">
        <thead>
          <tr className={LEDGER.headRow}>
            <th scope="col" className={TH}>
              Date
            </th>
            <th scope="col" className={TH}>
              Contractor
            </th>
            <th scope="col" className={TH}>
              Invoice
            </th>
            <th scope="col" className={cn(TH, "text-right")}>
              Amount
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
            <th scope="col" className={TH}>
              Transaction
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.runId}>
              <tr className="border-b border-foreground" data-group="" data-testid="ledger-group">
                <th scope="colgroup" colSpan={6} className="px-2.5 pt-6 pb-2.5 text-left font-normal">
                  <span className="inked block font-display text-[1.125rem] leading-tight font-bold normal-case">
                    {formatPeriodLabel(g.period)} payroll
                  </span>
                  <span className="mt-1 block text-[0.8125rem] tracking-normal text-muted-foreground normal-case">
                    Run {g.runId.slice(0, 8)}, {formatCount(g.lines.length)}{" "}
                    {g.lines.length === 1 ? "payment" : "payments"},{" "}
                    <Usd cents={groupTotal(g)} className="text-foreground" />
                  </span>
                </th>
              </tr>
              {g.lines.map((l, i) => (
                <tr
                  key={`${l.txid}-${l.account ?? l.account_index}-${i}`}
                  className={cn(LEDGER.row, i % 2 === 0 && "bg-bar")}
                  data-plain=""
                  data-testid="ledger-row"
                >
                  <td className={cn(TD, "whitespace-nowrap")}>
                    {l.pending ? (
                      <span className="text-muted-foreground">Not mined</span>
                    ) : (
                      formatDate(l.block_time ?? l.date)
                    )}
                  </td>
                  <td className={TD}>
                    <span className="flex items-center gap-2.5">
                      <Initials name={l.label ?? payeeOf(l)} />
                      <span className="min-w-0">
                        <span className="block truncate">{payeeOf(l)}</span>
                        {l.label && l.account_index !== null && l.account_index !== undefined ? (
                          <span className="block text-[0.8125rem] text-muted-foreground">
                            Account {l.account_index}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </td>
                  <td className={cn(TD, "whitespace-nowrap")}>
                    {l.invoice_ref || <span className="text-muted-foreground">None</span>}
                  </td>
                  <td className={cn(TD, "text-right whitespace-nowrap", l.pending && "text-muted-foreground")}>
                    <Usd cents={l.usd_basis_cents} />
                    <div className="mt-0.5 text-[0.8125rem] text-muted-foreground">
                      <Zec zat={l.amount_zat} />
                    </div>
                  </td>
                  <td className={TD}>
                    <StatusTags l={l} />
                  </td>
                  <td className={cn(TD, "whitespace-nowrap")}>
                    <Hash value={l.txid} label="transaction id" explorerUrl={l.explorer_url} head={6} tail={4} />
                    <span className="block text-[0.8125rem] text-muted-foreground">
                      {l.height ? `Block ${formatHeight(l.height)}` : "Not mined"}
                    </span>
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LedgerList({ groups }: { groups: Group[] }) {
  return (
    <div className="grid gap-6 xl:hidden">
      {groups.map((g) => (
        <section key={g.runId} aria-label={`${formatPeriodLabel(g.period)} payroll`}>
          <h2 className="flex flex-wrap items-baseline justify-between gap-x-3 border-b-2 border-foreground pb-2">
            <span className="inked font-display text-[1.125rem] leading-tight font-bold">
              {formatPeriodLabel(g.period)} payroll
            </span>
            <span className="font-type text-[0.8125rem] text-muted-foreground">
              {formatCount(g.lines.length)} {g.lines.length === 1 ? "payment" : "payments"},{" "}
              <Usd cents={groupTotal(g)} className="text-foreground" />
            </span>
          </h2>
          <ul className="green-bar" aria-label="Ledger">
            {g.lines.map((l, i) => (
              <li
                key={`${l.txid}-${l.account ?? l.account_index}-${i}`}
                className="grid grid-cols-[26px_minmax(0,1fr)_auto] gap-x-3 border-b border-bar-line px-1.5 py-3 font-type"
              >
                <Initials name={l.label ?? payeeOf(l)} className="mt-0.5" />
                <div className="min-w-0">
                  <span className="block truncate text-[0.9375rem] font-bold">{payeeOf(l)}</span>
                  <span className="block text-[0.8125rem] text-muted-foreground">
                    {l.pending ? "Not mined" : formatDate(l.block_time ?? l.date)}
                    {l.invoice_ref ? `, ${l.invoice_ref}` : ""}
                  </span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-2">
                    <StatusTags l={l} />
                    <Hash value={l.txid} label="transaction id" explorerUrl={l.explorer_url} head={6} tail={4} />
                  </span>
                </div>
                <div className={cn("text-right", l.pending && "text-muted-foreground")}>
                  <Usd cents={l.usd_basis_cents} className="text-[0.9375rem]" />
                  <div className="text-[0.8125rem] text-muted-foreground">
                    <Zec zat={l.amount_zat} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
