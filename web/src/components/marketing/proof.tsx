import Link from "next/link";
import { cn } from "cn";
import { formatHeight } from "@/lib/format";
import { DEMO_PAYMENTS, DEMO_RUNS, HERO_PAYMENT, runTotalCents, type ProofRun } from "@/components/marketing/data";
import { Usd } from "@/components/marketing/money";
import { Height, Section, TxLink } from "@/components/marketing/parts";
import { t, textLink } from "@/components/marketing/classes";

/**
 * Every payment of the sample company's three runs, split the way the identity splits a payment:
 * what the viewing keys read (who, how much, which invoice) and what the explorer shows (the
 * block and the transaction). Every transaction opens in the testnet explorer.
 */
export function Proof() {
  return (
    <Section
      id="proof"
      title="Every payment, open to check"
      lead={
        <>
          The sample company&apos;s three payrolls: {DEMO_PAYMENTS} shielded payments and {DEMO_RUNS.length}{" "}
          allocations, paid on Zcash testnet on {DEMO_RUNS[0].date}. Names and amounts come from the viewing keys; the
          explorer shows each transaction and its block, and nothing else.
        </>
      }
    >
      <p className="mt-6 text-[13px] text-ash">{HERO_PAYMENT.label}</p>
      <table className="mt-4 w-full border-collapse text-left text-[15px]">
        <caption className="sr-only">
          The sample company&apos;s payroll payments on Zcash testnet: who was paid and how much, from the viewing keys,
          and each transaction and block, from the explorer
        </caption>
        <thead>
          <tr className="hidden text-[13px] text-ash sm:table-row">
            <th scope="colgroup" colSpan={3} className="pb-2 font-normal">
              From the viewing keys
            </th>
            <th scope="colgroup" colSpan={2} className="border-l border-mist pb-2 pl-4 font-normal md:pl-6">
              On the explorer
            </th>
          </tr>
          <tr className="border-y border-ink text-[13px]">
            <th scope="col" className="py-2.5 pr-4 font-medium">
              Paid to
            </th>
            <th scope="col" className="hidden py-2.5 pr-4 font-medium sm:table-cell">
              Invoice
            </th>
            <th scope="col" className="py-2.5 pr-4 text-right font-medium">
              Amount
            </th>
            <th scope="col" className="hidden border-l border-mist py-2.5 pr-4 pl-4 font-medium sm:table-cell md:pl-6">
              Block
            </th>
            <th scope="col" className="py-2.5 font-medium">
              Transaction
            </th>
          </tr>
        </thead>
        {DEMO_RUNS.map((run) => (
          <RunRows key={run.runId} run={run} />
        ))}
      </table>
      <p className={cn(t.small, "mt-6 max-w-[40rem] text-ash")}>
        Read them with every amount and the reconciliation in{" "}
        <Link href="/books" className={textLink}>
          Books with the judge kit
        </Link>
        .
      </p>
    </Section>
  );
}

function RunRows({ run }: { run: ProofRun }) {
  return (
    <tbody>
      <tr className="border-b border-mist">
        {/* The run's heading spans the key columns: three from 640px, two on a phone without Invoice. */}
        <th scope="rowgroup" colSpan={3} className="hidden pt-8 pr-4 pb-3 align-bottom font-normal sm:table-cell">
          <RunHeading run={run} />
        </th>
        <th scope="rowgroup" colSpan={2} className="pt-8 pr-4 pb-3 align-bottom font-normal sm:hidden">
          <RunHeading run={run} />
        </th>
        <td className="hidden border-l border-mist pt-8 pr-4 pb-3 pl-4 align-bottom sm:table-cell md:pl-6">
          <Height height={run.allocation.height} className="text-ash" />
        </td>
        <td className="pt-8 pb-3 align-bottom">
          <span className="block text-[13px] text-ash">Allocation</span>
          <TxLink txid={run.allocation.txid} />
        </td>
      </tr>
      {run.lines.map((l) => (
        <tr key={l.txid} className="border-b border-mist align-top">
          <th scope="row" className="py-2.5 pr-4 font-normal">
            <span className="block">{l.name}</span>
            <span className="block text-[13px] text-ash sm:hidden">{l.invoice}</span>
          </th>
          <td className="hidden py-2.5 pr-4 text-ash sm:table-cell">{l.invoice}</td>
          <td className="py-2.5 pr-4 text-right whitespace-nowrap">
            <Usd cents={l.usdCents} />
          </td>
          <td className="hidden border-l border-mist py-2.5 pr-4 pl-4 sm:table-cell md:pl-6">
            <Height height={l.height} />
          </td>
          <td className="py-2.5">
            <TxLink txid={l.txid} />
            <span className={cn(t.data, "block text-ash sm:hidden")}>
              <span className="sr-only">Block </span>
              {formatHeight(l.height)}
            </span>
          </td>
        </tr>
      ))}
    </tbody>
  );
}

function RunHeading({ run }: { run: ProofRun }) {
  return (
    <>
      <span className={cn(t.h3, "block")}>{run.periodLabel} payroll</span>
      <span className="mt-1 block text-[13px] text-ash">
        Run {run.runId.slice(0, 8)}, <Usd cents={runTotalCents(run)} className="tracking-normal" /> to{" "}
        {run.lines.length} people. Allocated from the treasury in one transaction.
      </span>
    </>
  );
}
