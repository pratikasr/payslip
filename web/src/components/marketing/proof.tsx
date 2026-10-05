import { formatHeight } from "@/lib/format";
import {
  REHEARSAL_PAYMENTS,
  REHEARSALS,
  TESTNET_CONVERSION,
  repoFile,
  type ProofRun,
} from "@/components/marketing/data";
import { Container, OutLink, TxLink } from "@/components/marketing/parts";

const STATS: { value: string; label: string }[] = [
  { value: String(REHEARSAL_PAYMENTS), label: "Shielded payroll payments on Zcash testnet" },
  { value: "MIT", label: "Open source, every line on GitHub" },
  { value: "USDC", label: "Funds each run, through NEAR Intents" },
  { value: "Shielded", label: "Settled in Zcash's Ironwood pool" },
];

/**
 * Mercury's stats band, with only what can be checked: the rehearsal payments are listed under
 * it, each linked to the explorer.
 */
export function ProofStrip() {
  return (
    <section id="proof" aria-labelledby="proof-title" className="scroll-mt-4 py-20 sm:py-24">
      <Container>
        <h2
          id="proof-title"
          className="mx-auto max-w-[40rem] text-center text-[1.75rem] leading-[1.15] font-[450] tracking-[-0.015em] text-balance sm:text-[2.25rem]"
        >
          Real payments, on a real chain. <span className="text-muted-foreground sm:block">Check every one.</span>
        </h2>

        <dl className="mt-12 grid grid-cols-2 gap-y-10 lg:grid-cols-4">
          {STATS.map((s, i) => (
            <div
              key={s.label}
              className={
                "flex flex-col items-center px-3 text-center sm:px-6 " +
                (i % 2 === 1 ? "border-l " : "") +
                (i === 2 ? "lg:border-l " : "")
              }
            >
              <dt className="mt-2 max-w-[13rem] text-sm leading-snug text-muted-foreground sm:text-[15px]">
                {s.label}
              </dt>
              <dd className="figure order-first text-[2.25rem] leading-none font-[400] tracking-[-0.03em] sm:text-[3.25rem]">
                {s.value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-16 grid gap-10 lg:grid-cols-2 lg:gap-12">
          {REHEARSALS.map((r) => (
            <RunLedger key={r.runId} run={r} />
          ))}
        </div>

        <div className="mt-8 flex flex-col gap-2 text-sm text-muted-foreground lg:flex-row lg:flex-wrap lg:gap-x-8">
          <p>
            A contractor paid in USDC (conversion simulated on testnet): <TxLink txid={TESTNET_CONVERSION.txid} /> at{" "}
            <span className="num">{formatHeight(TESTNET_CONVERSION.height)}</span>.
          </p>
          <p>
            Timings and every record:{" "}
            <OutLink href={repoFile("docs/DEMO.md")} className="text-link">
              docs/DEMO.md
            </OutLink>
          </p>
        </div>
      </Container>
    </section>
  );
}

function RunLedger({ run }: { run: ProofRun }) {
  return (
    <div className="min-w-0">
      <table className="w-full text-sm">
        <caption className="pb-3 text-left">
          <span className="text-[15px] text-foreground">
            {run.title}, {run.period} payroll
          </span>
          <span className="mt-0.5 block text-[13px] text-muted-foreground">
            Run {run.runId.slice(0, 8)}, {run.date}. Names come from Payslip&apos;s records; the explorer shows none.
          </span>
        </caption>
        <thead>
          <tr className="border-b text-left text-[13px] text-muted-foreground">
            <th scope="col" className="h-9 pr-2 font-normal">
              Paid to
            </th>
            <th scope="col" className="px-2 font-normal">
              Transaction
            </th>
            <th scope="col" className="pl-2 text-right font-normal">
              Height
            </th>
          </tr>
        </thead>
        <tbody>
          {run.lines.map((l) => (
            <tr key={l.txid} className="border-b border-hairline">
              <th scope="row" className="h-11 pr-2 text-left font-normal whitespace-nowrap">
                {l.name}
              </th>
              <td className="px-2">
                <TxLink txid={l.txid} />
              </td>
              <td className="num pl-2 text-right whitespace-nowrap text-muted-foreground">{formatHeight(l.height)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
