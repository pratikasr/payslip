import { ArrowUpRight } from "lucide-react";
import { TESTNET_CONVERSION, TESTNET_RUNS, type ProofRun } from "@/components/landing/testnet-proof";
import { formatHeight, truncateMiddle } from "@/lib/format";

const REPO = "https://github.com/pratikasr/payslip";

/** Real testnet transactions from the rehearsals, each linked to the public explorer. */
export function OnChainSection() {
  const payments = TESTNET_RUNS.reduce((n, r) => n + r.lines.length, 0);
  return (
    <section id="on-chain" aria-labelledby="on-chain-title" className="scroll-mt-4 border-t bg-card">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="on-chain-title" className="text-2xl font-semibold tracking-tight">
            See it on chain
          </h2>
          <span className="inline-flex h-6 items-center gap-1.5 rounded-full border bg-background px-2.5 text-xs font-medium">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-primary-edge" />
            Zcash testnet
          </span>
        </div>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Two six-contractor runs, rehearsed from clean databases on 5 Oct 2026: {payments} shielded payments and two
          allocations. Open any of them in the explorer. It shows that the transaction happened and nothing else; the
          names below come from Payslip&apos;s own run records.
        </p>

        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          {TESTNET_RUNS.map((run) => (
            <RunLedger key={run.runId} run={run} />
          ))}
        </div>

        <div className="mt-6 flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-6">
          <p>
            A contractor paid in USDC (conversion simulated on testnet):{" "}
            <ExplorerLink url={TESTNET_CONVERSION.url} txid={TESTNET_CONVERSION.txid} /> at height{" "}
            <span className="num">{formatHeight(TESTNET_CONVERSION.height)}</span>.
          </p>
          <p>
            Every record, with timings:{" "}
            <a
              href={`${REPO}/blob/main/docs/DEMO.md`}
              rel="noreferrer"
              className="font-medium text-link underline underline-offset-4 hover:no-underline"
            >
              docs/DEMO.md
            </a>
            . The mainnet demo run is added to the README&apos;s Proof section when it runs.
          </p>
        </div>
      </div>
    </section>
  );
}

function RunLedger({ run }: { run: ProofRun }) {
  return (
    <section aria-label={`${run.title}, ${run.date}`} className="min-w-0 rounded-lg border bg-background">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b px-4 py-3">
        <h3 className="text-sm font-semibold">
          {run.title} <span className="font-normal text-muted-foreground">run {run.runId.slice(0, 8)}</span>
        </h3>
        <p className="text-xs text-muted-foreground">
          Allocation <ExplorerLink url={run.allocation.url} txid={run.allocation.txid} short /> at{" "}
          <span className="num">{formatHeight(run.allocation.height)}</span>
        </p>
      </div>
      <table className="w-full text-sm">
        <caption className="sr-only">
          {run.title}: six shielded payments with their transaction ids and block heights
        </caption>
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th scope="col" className="h-9 px-3 font-medium sm:px-4">
              Paid to
            </th>
            <th scope="col" className="px-2 font-medium">
              Transaction
            </th>
            <th scope="col" className="hidden px-2 font-medium sm:table-cell">
              Explorer shows
            </th>
            <th scope="col" className="px-3 text-right font-medium sm:px-4">
              Height
            </th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {run.lines.map((l) => (
            <tr key={l.txid}>
              <th scope="row" className="h-11 px-3 text-left font-normal whitespace-nowrap sm:px-4">
                {l.name}
              </th>
              <td className="px-2">
                <ExplorerLink url={l.url} txid={l.txid} short />
              </td>
              <td className="hidden px-2 sm:table-cell">
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">
                    Shielded<span className="sr-only">, amount and parties hidden</span>
                  </span>
                  <span aria-hidden="true" className="h-2.5 w-10 rounded-[3px] bg-redact" />
                </span>
              </td>
              <td className="num px-3 text-right whitespace-nowrap sm:px-4">{formatHeight(l.height)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ExplorerLink({ url, txid, short }: { url: string; txid: string; short?: boolean }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={txid}
      className="inline-flex items-center gap-0.5 font-mono text-[0.8125rem] whitespace-nowrap text-link underline-offset-4 hover:underline"
    >
      {short ? truncateMiddle(txid, 6, 4) : truncateMiddle(txid, 8, 6)}
      <ArrowUpRight className="size-3.5" aria-hidden="true" />
      <span className="sr-only"> (testnet explorer, opens in a new tab)</span>
    </a>
  );
}
