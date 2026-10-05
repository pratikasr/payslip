"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Usd, Zec } from "@/components/app/amount";
import { Hash } from "@/components/app/hash";
import { Initials } from "@/components/ds/avatar";
import { Tag } from "@/components/ds/tag";
import { FilterPill } from "@/components/books/filter-pill";
import { ledgerOf, runName, type BooksResult, type LedgerLine } from "@/components/books/books-data";
import { Button } from "@/components/ui/button";
import { formatCount, formatDate, formatHeight, formatPeriodLabel } from "@/lib/format";
import { cn } from "cn";

type Status = "all" | "confirmed" | "pending" | "converted";

const personKey = (l: LedgerLine) =>
  l.account_index !== null && l.account_index !== undefined ? `a${l.account_index}` : `l${l.label ?? ""}`;

/** Every pay line in the period, pending ones first, with contractor, run and status filters. */
export function LedgerView({ r }: { r: BooksResult }) {
  const params = useSearchParams();
  const all = useMemo(() => ledgerOf(r), [r]);
  const [person, setPerson] = useState("all");
  const [run, setRun] = useState(() => params.get("run") ?? "all");
  const [status, setStatus] = useState<Status>("all");

  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of all)
      m.set(personKey(l), l.label ?? (l.account_index !== null ? `Account ${l.account_index}` : "Unknown account"));
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [all]);
  const runs = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of all) m.set(l.run_id, l.period);
    return [...m.entries()].sort((a, b) => b[1].localeCompare(a[1]) || a[0].localeCompare(b[0]));
  }, [all]);

  const lines = all.filter(
    (l) =>
      (person === "all" || personKey(l) === person) &&
      (run === "all" || l.run_id === run) &&
      (status === "all" ||
        (status === "pending" && l.pending) ||
        (status === "confirmed" && !l.pending) ||
        (status === "converted" && l.settlement === "converted")),
  );
  const total = lines.reduce((s, l) => s + l.usd_basis_cents, 0);
  const totalZat = lines.reduce((s, l) => s + l.amount_zat, 0);
  const pending = lines.filter((l) => l.pending).length;
  const filtered = person !== "all" || run !== "all" || status !== "all";

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filters">
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
            variant="ghost"
            size="sm"
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

      <dl className="flex flex-wrap gap-x-10 gap-y-3 border-b border-hairline pb-4" aria-label="Shown lines">
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Payments</dt>
          <dd className="num text-[1.1875rem] font-[380]" data-testid="ledger-count">
            {formatCount(lines.length)}
          </dd>
        </div>
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Paid</dt>
          <dd className="text-[1.1875rem] font-[380]">
            <Usd cents={total} />
            <span className="ml-2 text-xs text-muted-foreground">
              <Zec zat={totalZat} />
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-[0.8125rem] text-muted-foreground">Pending</dt>
          <dd className="num text-[1.1875rem] font-[380]">{formatCount(pending)}</dd>
        </div>
      </dl>

      {lines.length === 0 ? (
        <p className="py-10 text-center text-[0.9375rem] text-muted-foreground">
          {filtered ? "No payments match these filters." : "No payments in this period."}
        </p>
      ) : (
        <>
          <LedgerTable lines={lines} />
          <LedgerList lines={lines} />
        </>
      )}
    </div>
  );
}

function StatusTags({ l }: { l: LedgerLine }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {l.pending ? <Tag>Pending</Tag> : l.settlement === "converted" ? null : <Tag>Paid</Tag>}
      {l.settlement === "converted" ? <Tag>Converted to USDC</Tag> : null}
    </span>
  );
}

const TH =
  "h-10 px-2.5 pb-2 text-left align-bottom text-[0.8125rem] font-normal whitespace-nowrap text-muted-foreground";
const TD = "px-2.5 py-3 align-top";

function LedgerTable({ lines }: { lines: LedgerLine[] }) {
  return (
    <div className="hidden overflow-x-auto xl:block" role="region" aria-label="Ledger" tabIndex={0}>
      <table className="w-full min-w-[860px] border-collapse text-[0.9375rem]" data-testid="ledger-table">
        <thead>
          <tr className="border-b border-hairline">
            <th scope="col" className={TH}>
              Date
            </th>
            <th scope="col" className={TH}>
              Contractor
            </th>
            <th scope="col" className={TH}>
              Run
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
          {lines.map((l, i) => (
            <tr key={`${l.txid}-${l.account_index}-${i}`} className="border-b border-hairline" data-testid="ledger-row">
              <td className={cn(TD, "whitespace-nowrap")}>
                {l.pending ? (
                  <span className="text-muted-foreground">Not mined</span>
                ) : (
                  formatDate(l.block_time ?? l.date)
                )}
              </td>
              <td className={TD}>
                <span className="flex items-center gap-2.5">
                  <Initials name={l.label} />
                  <span className="min-w-0">
                    <span className="block truncate">{l.label ?? "Unknown account"}</span>
                    {l.account_index !== null && l.account_index !== undefined ? (
                      <span className="block text-xs text-muted-foreground">Account {l.account_index}</span>
                    ) : null}
                  </span>
                </span>
              </td>
              <td className={cn(TD, "whitespace-nowrap")}>
                <span className="block">{formatPeriodLabel(l.period)}</span>
                <code className="block font-mono text-xs text-muted-foreground">{l.run_id.slice(0, 8)}</code>
              </td>
              <td className={cn(TD, "whitespace-nowrap")}>
                {l.invoice_ref || <span className="text-muted-foreground">None</span>}
              </td>
              <td className={cn(TD, "text-right whitespace-nowrap", l.pending && "text-muted-foreground")}>
                <Usd cents={l.usd_basis_cents} />
                <div className="mt-0.5 text-xs text-muted-foreground">
                  <Zec zat={l.amount_zat} />
                </div>
              </td>
              <td className={TD}>
                <StatusTags l={l} />
              </td>
              <td className={cn(TD, "whitespace-nowrap")}>
                <Hash value={l.txid} label="transaction id" explorerUrl={l.explorer_url} head={6} tail={4} />
                <span className="num block text-xs text-muted-foreground">
                  {l.height ? `Block ${formatHeight(l.height)}` : "Not mined"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LedgerList({ lines }: { lines: LedgerLine[] }) {
  return (
    <ul className="divide-y divide-hairline xl:hidden" aria-label="Ledger">
      {lines.map((l, i) => (
        <li key={`${l.txid}-${l.account_index}-${i}`} className="grid grid-cols-[26px_minmax(0,1fr)_auto] gap-x-3 py-3">
          <Initials name={l.label} className="mt-0.5" />
          <div className="min-w-0">
            <span className="block truncate text-[0.9375rem]">{l.label ?? "Unknown account"}</span>
            <span className="num block text-xs text-muted-foreground">
              {l.pending ? "Not mined" : formatDate(l.block_time ?? l.date)} · {formatPeriodLabel(l.period)}
              {l.invoice_ref ? ` · ${l.invoice_ref}` : ""}
            </span>
            <span className="mt-1.5 flex flex-wrap items-center gap-2">
              <StatusTags l={l} />
              <Hash value={l.txid} label="transaction id" explorerUrl={l.explorer_url} head={6} tail={4} />
            </span>
          </div>
          <div className={cn("text-right", l.pending && "text-muted-foreground")}>
            <Usd cents={l.usd_basis_cents} className="text-[0.9375rem]" />
            <div className="text-xs text-muted-foreground">
              <Zec zat={l.amount_zat} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
