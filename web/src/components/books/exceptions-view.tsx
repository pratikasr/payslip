"use client";

import type { ReactNode } from "react";
import { Coin, Usd, Zec } from "@/components/app/amount";
import { Hash } from "@/components/app/hash";
import { Tag, type TagTone } from "@/components/ds/tag";
import { explorerFor } from "@/components/books/run-detail";
import {
  differenceOf,
  exceptionsOf,
  paidDateOf,
  UNLABELLED_REASON,
  type BooksResult,
  type BooksUnlabelled,
} from "@/components/books/books-data";
import type { ReconciliationRun } from "@/lib/api";
import { formatCount, formatDate, formatHeight, formatPeriodLabel } from "@/lib/format";
import { cn } from "cn";

/** Everything that needs a person: runs that do not reconcile and transactions with no Payslip memo. */
export function ExceptionsView({ r }: { r: BooksResult }) {
  const ex = exceptionsOf(r);
  const groups: { id: string; label: string; count: number; tone: TagTone }[] = [
    { id: "no-funding", label: "No funding record", count: ex.noFunding.length, tone: "warning" },
    { id: "unexplained", label: "Unexplained variance", count: ex.unexplained.length, tone: "danger" },
    ...(ex.incomplete.length
      ? [{ id: "incomplete", label: "Not fully mined", count: ex.incomplete.length, tone: "warning" as TagTone }]
      : []),
    { id: "unlabelled", label: "Unlabelled transactions", count: ex.unlabelled.length, tone: "neutral" },
  ];
  return (
    <div className="grid min-w-0 gap-2 [&>*]:min-w-0">
      <nav aria-label="Exception groups" className="flex flex-wrap gap-2" data-print="hide">
        {groups.map((g) => (
          <a
            key={g.id}
            href={`#${g.id}`}
            className="inline-flex h-8 items-center gap-2 rounded-full bg-secondary px-3.5 text-[0.8125rem] hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {g.label}
            <span className="num text-muted-foreground" data-testid={`exceptions-count-${g.id}`}>
              {formatCount(g.count)}
            </span>
          </a>
        ))}
      </nav>

      <Group
        id="no-funding"
        title="Runs with no funding record"
        count={ex.noFunding.length}
        tone="warning"
        todo="Load the Treasury key, or widen the period: funding is recorded the day the run starts paying. Otherwise record it by hand."
      >
        <RunRows r={r} runs={ex.noFunding} kind="no-funding" />
      </Group>

      <Group
        id="unexplained"
        title="Unexplained variance"
        count={ex.unexplained.length}
        tone="danger"
        todo="Compare the run's funding with the swap venue's receipt; fees and unspent coin do not cover the gap."
      >
        <RunRows r={r} runs={ex.unexplained} kind="unexplained" />
      </Group>

      {ex.incomplete.length ? (
        <Group
          id="incomplete"
          title="Runs not fully mined"
          count={ex.incomplete.length}
          tone="warning"
          todo="Some payments are still waiting for a block. Scan again in a few minutes."
        >
          <RunRows r={r} runs={ex.incomplete} kind="unexplained" />
        </Group>
      ) : null}

      <Group
        id="unlabelled"
        title="Unlabelled transactions"
        count={ex.unlabelled.length}
        tone="neutral"
        todo="These carry no Payslip memo, so they are not in the totals. Match each one to its source in your books."
      >
        <UnlabelledRows r={r} rows={ex.unlabelled} />
      </Group>
    </div>
  );
}

function Group({
  id,
  title,
  count,
  tone,
  todo,
  children,
}: {
  id: string;
  title: string;
  count: number;
  tone: TagTone;
  todo: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="min-w-0 scroll-mt-20 pt-8">
      <div className="mb-3 grid gap-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 id={`${id}-title`} className="text-[1.1875rem] font-normal tracking-[-0.01em]">
            {title}
          </h2>
          <Tag tone={count ? tone : "neutral"}>{formatCount(count)}</Tag>
        </div>
        <p className="text-sm text-muted-foreground">{count ? todo : "None in this period."}</p>
      </div>
      {count ? children : null}
    </section>
  );
}

const TH =
  "h-10 px-2.5 pb-2 text-left align-bottom text-[0.8125rem] font-normal whitespace-nowrap text-muted-foreground";
const TD = "px-2.5 py-3 align-top";

function RunRows({ r, runs, kind }: { r: BooksResult; runs: ReconciliationRun[]; kind: "no-funding" | "unexplained" }) {
  return (
    <ul className="divide-y divide-hairline border-y border-hairline">
      {runs.map((run) => {
        const paidOn = paidDateOf(r, run.run_id);
        const diff = differenceOf(run);
        return (
          <li key={run.run_id} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-3">
            <div className="min-w-0">
              <span className="block text-[0.9375rem]">{formatPeriodLabel(run.period)} payroll</span>
              <span className="num block text-xs text-muted-foreground">
                Run <code className="font-mono">{run.run_id.slice(0, 8)}</code> · {run.lines}{" "}
                {run.lines === 1 ? "payment" : "payments"}
                {paidOn ? ` · paid ${formatDate(paidOn)}` : ""}
              </span>
            </div>
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <div className="text-right">
                <dt className="text-xs text-muted-foreground">Paid</dt>
                <dd>
                  <Usd cents={run.paid_usd_cents} />
                </dd>
              </div>
              {kind === "unexplained" ? (
                <>
                  <div className="text-right">
                    <dt className="text-xs text-muted-foreground">Variance</dt>
                    <dd>
                      <Usd cents={run.variance_usd_cents} />
                    </dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-xs text-muted-foreground">Explained</dt>
                    <dd>
                      <Usd cents={run.explained_usd_cents} />
                    </dd>
                  </div>
                  <div className="text-right">
                    <dt className="text-xs text-muted-foreground">Difference</dt>
                    <dd className="text-destructive">
                      <Usd cents={diff} />
                    </dd>
                  </div>
                </>
              ) : (
                <div className="text-right">
                  <dt className="text-xs text-muted-foreground">Funded</dt>
                  <dd className="text-muted-foreground">Not recorded</dd>
                </div>
              )}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

function reasonOf(u: BooksUnlabelled) {
  return UNLABELLED_REASON[u.reason] ?? { label: u.reason, detail: "" };
}

function MemoText({ text }: { text: string | null }) {
  if (!text) return <span className="text-muted-foreground">No memo</span>;
  return <code className="font-mono text-xs break-words whitespace-pre-wrap text-strong">{text}</code>;
}

function UnlabelledRows({ r, rows }: { r: BooksResult; rows: BooksUnlabelled[] }) {
  const sorted = [...rows].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  const reasons = Object.entries(
    rows.reduce<Record<string, number>>((acc, u) => ({ ...acc, [u.reason]: (acc[u.reason] ?? 0) + 1 }), {}),
  ).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <dl
        className="mb-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3"
        aria-label="Why they are unlabelled"
      >
        {reasons.map(([reason, n]) => {
          const why = UNLABELLED_REASON[reason] ?? { label: reason, detail: "" };
          return (
            <div key={reason}>
              <dt className="flex items-baseline gap-2">
                <span className="text-strong">{why.label}</span>
                <span className="num text-muted-foreground" data-testid={`unlabelled-reason-${reason}`}>
                  {formatCount(n)}
                </span>
              </dt>
              <dd className="text-xs text-muted-foreground">{why.detail}</dd>
            </div>
          );
        })}
      </dl>
      <div
        className="hidden min-w-0 overflow-x-auto xl:block"
        role="region"
        aria-label="Unlabelled transactions"
        tabIndex={0}
      >
        <table className="w-full min-w-[860px] border-collapse text-[0.9375rem]" data-testid="unlabelled-table">
          <thead>
            <tr className="border-b border-hairline">
              <th scope="col" className={TH}>
                Date
              </th>
              <th scope="col" className={TH}>
                Account
              </th>
              <th scope="col" className={cn(TH, "text-right")}>
                Amount, <Coin />
              </th>
              <th scope="col" className={TH}>
                Why
              </th>
              <th scope="col" className={TH}>
                Memo
              </th>
              <th scope="col" className={TH}>
                Transaction
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((u, i) => {
              const why = reasonOf(u);
              return (
                <tr
                  key={`${u.txid}-${u.account ?? ""}-${i}`}
                  className="border-b border-hairline"
                  data-testid="unlabelled-row"
                >
                  <td className={cn(TD, "whitespace-nowrap")}>{formatDate(u.date)}</td>
                  <td className={cn(TD, "whitespace-nowrap")}>
                    <span className="block">{u.label ?? "Unknown account"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {u.direction === "in" ? "Received" : "Sent"}
                    </span>
                  </td>
                  <td className={cn(TD, "text-right whitespace-nowrap")}>
                    <Zec zat={u.direction === "out" ? -u.amount_zat : u.amount_zat} unit={false} />
                  </td>
                  <td className={cn(TD, "whitespace-nowrap")}>{why.label}</td>
                  <td className={cn(TD, "w-[38%] min-w-[16rem]")}>
                    <MemoText text={u.memo_text} />
                  </td>
                  <td className={cn(TD, "whitespace-nowrap")}>
                    <Hash
                      value={u.txid}
                      label="transaction id"
                      explorerUrl={u.explorer_url ?? explorerFor(r, u.txid)}
                      head={6}
                      tail={4}
                    />
                    <span className="num block text-xs text-muted-foreground">
                      {u.height ? `Block ${formatHeight(u.height)}` : "Not mined"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <ul className="divide-y divide-hairline border-y border-hairline xl:hidden" aria-label="Unlabelled transactions">
        {sorted.map((u, i) => {
          const why = reasonOf(u);
          return (
            <li key={`${u.txid}-${u.account ?? ""}-${i}`} className="grid gap-1.5 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[0.9375rem]">
                  {u.direction === "in" ? "Received by" : "Sent from"} {u.label ?? "an unknown account"}
                </span>
                <Zec zat={u.direction === "out" ? -u.amount_zat : u.amount_zat} className="text-sm" />
              </div>
              <span className="text-xs text-muted-foreground">
                {formatDate(u.date)} · {why.label}
              </span>
              {u.memo_text ? <MemoText text={u.memo_text} /> : null}
              <Hash
                value={u.txid}
                label="transaction id"
                explorerUrl={u.explorer_url ?? explorerFor(r, u.txid)}
                head={6}
                tail={4}
              />
            </li>
          );
        })}
      </ul>
    </>
  );
}
