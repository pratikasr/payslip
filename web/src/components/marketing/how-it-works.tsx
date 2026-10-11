import { Fragment, type ReactNode } from "react";
import { cn } from "cn";
import { FormRow, FormRows } from "@/components/ds/paper";
import { SEP_RUN, payLineMemo } from "@/components/marketing/data";
import { Coin, Usd } from "@/components/marketing/money";
import { Height, Section, TxLink } from "@/components/marketing/parts";
import { t } from "@/components/marketing/classes";

const run = SEP_RUN.run;
const amara = run.lines[0];

/* A run is a sequence, so the steps are numbered. Each carries what the chain holds for it. */
const STEPS: { title: string; body: string; evidence: ReactNode }[] = [
  {
    title: "Fund",
    body: "Enter each person's pay in dollars. Fund the run with ZEC from your own wallet, or in USDC through NEAR Intents; the rate at funding becomes the dollar basis for every line.",
    evidence: (
      <Facts
        rows={[
          ["Funded", <Usd key="f" cents={SEP_RUN.fundedCents} />],
          ["Received", <Coin key="r" zat={SEP_RUN.acquiredZat} unit="TAZ" />],
        ]}
        note="A fixed simulated rate stands in for NEAR Intents on testnet."
      />
    ),
  },
  {
    title: "Allocate",
    body: "One shielded transaction from the treasury fills each contractor's own payroll account with their pay and its network fee.",
    evidence: (
      <Facts
        rows={[
          ["Transaction", <TxLink key="t" txid={run.allocation.txid} />],
          ["Block", <Height key="b" height={run.allocation.height} />],
        ]}
        note={`${run.lines.length} contractor accounts filled at once.`}
      />
    ),
  },
  {
    title: "Pay",
    body: "Each payroll account sends one shielded payment to its contractor. The encrypted memo carries the period, the invoice and the dollar amount.",
    evidence: (
      <div>
        <p className={cn(t.data, "border border-bar-line bg-bar px-2.5 py-2 text-ink [overflow-wrap:anywhere]")}>
          {payLineMemo(amara)
            .split("|")
            .map((part, i) => (
              <Fragment key={i}>
                {i > 0 ? (
                  <>
                    |<wbr />
                  </>
                ) : null}
                {part}
              </Fragment>
            ))}
        </p>
        <p className={cn(t.small, "mt-2 text-ash")}>
          {amara.name}&apos;s memo as her key decrypts it. {run.lines.length} payments in block{" "}
          <Height height={amara.height} className="text-ash" />.
        </p>
      </div>
    ),
  },
  {
    title: "Read back",
    body: "Viewing keys read the payments back from the chain: a payslip for each contractor, and for your accountant a reconciliation of funded against paid.",
    evidence: (
      <Facts
        rows={[
          ["Paid", <Usd key="p" cents={SEP_RUN.paidCents} />],
          ["Variance", <Usd key="v" cents={SEP_RUN.varianceCents} />],
          ["Fees and unspent", <Usd key="e" cents={SEP_RUN.explainedCents} />],
        ]}
        note="One cent of rounding across six lines."
      />
    ),
  },
];

export function HowItWorks() {
  return (
    <Section
      id="how-it-works"
      title="How a payroll run works"
      lead={`Four steps, each one on chain. The figures are the sample company's ${run.periodLabel} run.`}
    >
      <ol className="mt-10 border-b-2 border-ink md:mt-14">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-4 gap-y-5 border-t-2 border-ink py-7 md:grid-cols-[3rem_minmax(0,1fr)_minmax(0,1fr)] md:gap-x-8 md:py-9 xl:grid-cols-[3.5rem_minmax(0,1.1fr)_minmax(0,1fr)]"
          >
            {/* The step's number, boxed like a numbered field on a form. */}
            <span
              aria-hidden="true"
              className="grid size-9 place-items-center border-2 border-ink font-type text-[1.125rem] leading-none font-bold tabular-nums md:size-11 md:text-[1.375rem]"
            >
              {i + 1}
            </span>
            <div className="min-w-0">
              <h3 className={t.h3}>
                <span className="sr-only">Step {i + 1}: </span>
                {s.title}
              </h3>
              <p className={cn(t.body, "mt-2 max-w-[34rem]")}>{s.body}</p>
            </div>
            <div className="col-start-2 min-w-0 md:col-start-auto md:pt-1">{s.evidence}</div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

/** What the chain holds for a step, as rows of a form on green bar. */
function Facts({ rows, note }: { rows: [string, ReactNode][]; note?: string }) {
  return (
    <div>
      <FormRows className="border border-bar-line">
        {rows.map(([k, v]) => (
          <FormRow key={k} label={k} className="tabular-nums">
            {v}
          </FormRow>
        ))}
      </FormRows>
      {note ? <p className={cn(t.small, "mt-2 text-ash")}>{note}</p> : null}
    </div>
  );
}
