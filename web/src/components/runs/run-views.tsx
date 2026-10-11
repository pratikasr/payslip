import type { ReactNode } from "react";
import { Usd } from "@/components/app/amount";
import { PaperView, Redacted, Thread, TwoViews, VaultView, ViewTitle } from "@/components/ds/two-views";
import type { PayLine, Run } from "@/lib/api";
import { formatHeight, formatRange, truncateMiddle } from "@/lib/format";
import { cn } from "cn";
import { plural, runTitle } from "./run-meta";

/*
  A payroll run in its two views (docs/DESIGN.md section 16), above the run's tabs. The vault
  side is what the public explorer shows: the allocation transaction that fills every
  contractor's account, then one shielded payment per person, each a transaction id and a block
  with its amount, sender, recipient and memo hidden. The paper side is what the company's keys
  read from the same transactions: the total, the period and the people, each level with their
  own transaction. Built from the run's own records; the views sit side by side from 1280px.
*/

const SPLIT = "xl" as const;
/** Rows of people before the rest are summed up in one line ("And 4 more"). */
const MAX_PEOPLE = 6;

interface Tx {
  txid: string;
  height: number | null;
  url: string | null;
}

/** The explorer's host name, for "Each transaction opens on ...". */
function explorerHost(run: Run): string | null {
  const url = run.allocation_explorer_url ?? run.lines.find((l) => l.explorer_url)?.explorer_url;
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

const shortTx = (txid: string) => truncateMiddle(txid, 6, 6);

export function RunViews({ run, onShowPrivacy }: { run: Run; onShowPrivacy: () => void }) {
  const allocation: Tx | null = run.allocation_txid
    ? { txid: run.allocation_txid, height: run.allocation_height ?? null, url: run.allocation_explorer_url ?? null }
    : null;
  const sent = run.lines.filter((l) => l.txid);
  if (!allocation && sent.length === 0) return null;

  const title = runTitle(run);
  const people = new Set(run.lines.map((l) => l.contractor_id)).size;
  const shown = run.lines.length > MAX_PEOPLE ? run.lines.slice(0, MAX_PEOPLE - 1) : run.lines;
  const more = run.lines.length - shown.length;
  const transactions = (allocation ? 1 : 0) + sent.length;
  const host = explorerHost(run);
  // Title, the allocation, one row per person shown, the rest summed up, and the closing line.
  const rows = 1 + (allocation ? 1 : 0) + shown.length + (more > 0 ? 1 : 0) + 1;

  return (
    <TwoViews
      id="run-views"
      rows={rows}
      split={SPLIT}
      className="mb-6"
      caption={`The ${title} payroll in two views: what the Zcash explorer shows, and what your keys show.`}
    >
      <VaultView labelledBy="run-vault-title" split={SPLIT} className="py-6 md:py-7">
        <ViewTitle id="run-vault-title" title="What the explorer shows">
          {plural(transactions, "shielded transaction")}. No amounts, no names.
        </ViewTitle>
        {allocation ? <VaultRow tx={allocation} what="The allocation to each account" /> : null}
        {shown.map((l) => (
          <VaultRow
            key={l.id}
            tx={l.txid ? { txid: l.txid, height: l.confirmed_height, url: l.explorer_url } : null}
            what="A payment"
          />
        ))}
        {more > 0 ? (
          <p className="border-t border-mist py-3 text-[0.8125rem] text-ash">
            And {plural(run.lines.slice(shown.length).filter((l) => l.txid).length, "more transaction")} like these
          </p>
        ) : null}
        <p className="border-t border-mist pt-4 text-[0.8125rem] text-ash">
          {host ? `Each transaction id opens on ${host}.` : "Each transaction id opens on a public explorer."}
        </p>
      </VaultView>

      <PaperView labelledBy="run-paper-title" split={SPLIT} className="py-6 md:py-7">
        <ViewTitle id="run-paper-title" title="What your keys show">
          The {title} payroll, read from the same transactions.
        </ViewTitle>
        {allocation ? (
          <PaperRow
            txid={allocation.txid}
            name={`Funding for ${plural(people, "person", "people")}`}
            sub={formatRange(run.period_start, run.period_end)}
            amount={<Usd cents={run.total_usd_cents} />}
          />
        ) : null}
        {shown.map((l) => (
          <PaperRow
            key={l.id}
            txid={l.txid}
            name={l.contractor_name}
            sub={l.invoice_ref || "No invoice"}
            amount={<Usd cents={l.amount_usd_cents} />}
            pending={!l.txid}
          />
        ))}
        {more > 0 ? <MoreRow lines={run.lines.slice(shown.length)} /> : null}
        <div className="border-t border-mist pt-4">
          <button
            type="button"
            onClick={onShowPrivacy}
            className="rounded-sm text-[0.8125rem] text-link underline decoration-1 underline-offset-[3px] hover:decoration-2"
          >
            See the Privacy view
          </button>
        </div>
      </PaperView>
    </TwoViews>
  );
}

/** One transaction as the explorer shows it: its id and block, and four bars for what it hides. */
function VaultRow({ tx, what }: { tx: Tx | null; what: string }) {
  if (!tx) {
    return (
      <div className="flex items-center border-t border-mist py-3 text-[0.8125rem] text-ash">Not on chain yet</div>
    );
  }
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-t border-mist py-3">
      <span className="sr-only">
        {what}: transaction {shortTx(tx.txid)}
        {tx.height !== null ? `, block ${formatHeight(tx.height)}` : ", not mined yet"}. The amount, sender, recipient
        and memo are hidden on chain.
      </span>
      {/* The four things the chain hides, in the order the key's view reads them. */}
      <span aria-hidden="true" className="flex min-w-0 flex-wrap items-center gap-1.5 text-[0.8125rem]">
        <Redacted label={null} className="w-[3.5em]" />
        <Redacted label={null} className="w-[4.5em]" />
        <Redacted label={null} className="w-[5em]" />
        <Redacted label={null} className="w-[6em]" />
      </span>
      <span className="grid grid-cols-[auto_auto] items-center text-[0.8125rem] leading-[1.45]">
        <span className="justify-self-end">
          {tx.url ? (
            <a
              href={tx.url}
              target="_blank"
              rel="noreferrer"
              data-txid={tx.txid}
              title={tx.txid}
              className="rounded-[3px] font-mono text-ink underline decoration-ink/30 decoration-1 underline-offset-[3px] transition-colors hover:decoration-gold"
            >
              {shortTx(tx.txid)}
              <span className="sr-only"> (opens on the explorer in a new tab)</span>
            </a>
          ) : (
            <code className="font-mono" title={tx.txid}>
              {shortTx(tx.txid)}
            </code>
          )}
        </span>
        <span className="flex items-center">
          <Thread side="vault" split={SPLIT} weight="thin" />
        </span>
        <span aria-hidden="true" className="justify-self-end font-mono text-ash tabular-nums">
          {tx.height !== null ? formatHeight(tx.height) : "Not mined"}
        </span>
      </span>
    </div>
  );
}

/** One line as the key reads it: who, for what, how much, level with its transaction. */
function PaperRow({
  txid,
  name,
  sub,
  amount,
  pending = false,
}: {
  txid: string | null;
  name: string;
  sub: ReactNode;
  amount: ReactNode;
  pending?: boolean;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 border-t border-mist py-3",
        "xl:grid-cols-[auto_minmax(0,1fr)_auto]",
      )}
    >
      {/* Side by side, the transaction id leads the row, joined to its twin on the explorer's side. */}
      {txid ? (
        <span className="hidden items-center self-center xl:flex">
          <Thread side="paper" split={SPLIT} weight="thin" />
          <code className="font-mono text-[0.8125rem] text-ash" title={txid}>
            {shortTx(txid)}
          </code>
        </span>
      ) : (
        <span className="hidden w-[13ch] text-[0.8125rem] text-ash xl:block">Not sent</span>
      )}
      <span className="min-w-0">
        <span className="block truncate text-[0.9375rem]" title={name}>
          {name}
        </span>
        <span className="block truncate text-[0.8125rem] text-ash">
          {sub}
          {txid ? (
            <span className="xl:hidden">
              , <code className="font-mono">{shortTx(txid)}</code>
            </span>
          ) : pending ? (
            <span className="xl:hidden">, not sent yet</span>
          ) : null}
        </span>
      </span>
      <span className="text-right text-[0.9375rem]">{amount}</span>
    </div>
  );
}

function MoreRow({ lines }: { lines: PayLine[] }) {
  const cents = lines.reduce((n, l) => n + l.amount_usd_cents, 0);
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-mist py-3 text-[0.8125rem] text-ash">
      <span>And {plural(lines.length, "more person", "more people")}</span>
      <Usd cents={cents} className="text-[0.9375rem] text-ink" />
    </div>
  );
}
