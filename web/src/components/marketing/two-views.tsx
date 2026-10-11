import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { cn } from "cn";
import { formatDateTime, formatHeight, truncateMiddle } from "@/lib/format";
import { HERO_PAYMENT as P } from "@/components/marketing/data";
import { Coin, Usd } from "@/components/marketing/money";
import { lp, t, textLink } from "@/components/marketing/classes";

/*
  The identity (docs/DESIGN.md section 16): one payment, two views. On the left, the vault: what
  the public explorer shows for the transaction. On the right, the paper: what Amara Okafor's
  viewing key shows for the same transaction. The txid heads both, joined by a gold hairline,
  and the rows line up across the seam (CSS subgrid from 768px), so each hidden value on the
  vault side sits level with the value the key reads. On a phone the panels stack, vault first,
  and the gold hairline becomes the seam between them.

  Redaction bars appear only on the vault side and only for what the chain hides. The paper side
  resolves from bars into values once, on load (landing-styles.tsx); reduced motion shows the
  values at once.
*/

const ROWS = "md:row-span-8 md:grid md:grid-rows-subgrid";
const PAD = "px-5 py-6 sm:px-7 md:px-8 md:py-8";

export function TwoViews({ className }: { className?: string }) {
  return (
    <figure
      aria-labelledby="two-views-caption"
      className={cn("relative grid md:grid-cols-2 md:grid-rows-[repeat(8,auto)]", className)}
    >
      <figcaption id="two-views-caption" className="sr-only">
        One payment, two views: what the Zcash explorer shows, and what {P.name}&apos;s viewing key shows.
      </figcaption>
      <VaultView />
      <PaperView />
    </figure>
  );
}

function VaultView() {
  return (
    <div
      role="group"
      aria-labelledby="vault-title"
      className={cn(
        "identity-vault flex flex-col rounded-t-[12px] bg-vault text-ink md:rounded-tr-none md:rounded-l-[12px]",
        // In the dark theme the vault sits darker than the page: a Mist edge keeps its boundary.
        "dark:border dark:border-b-0 dark:border-mist md:dark:border-r-0 md:dark:border-b",
        ROWS,
        PAD,
      )}
    >
      <Title id="vault-title" title="What the explorer shows">
        A shielded transaction in the {P.pool} pool, with {P.actions} actions.
      </Title>
      <div className="flex items-center pb-5">
        <a
          href={P.explorerUrl}
          target="_blank"
          rel="noreferrer"
          data-txid={P.txid}
          className={cn(t.data, "block rounded-[3px] text-ink transition-colors hover:text-gold")}
        >
          <TxidLines txid={P.txid} />
          <span className="sr-only"> (transaction on the Zcash testnet explorer, opens in a new tab)</span>
        </a>
        <span
          aria-hidden="true"
          className={cn(lp.dot, "ml-4 hidden size-1.5 shrink-0 rounded-full bg-gold md:block")}
        />
        <span aria-hidden="true" className={cn(lp.thread, "hidden h-0.5 flex-1 bg-gold md:-mr-8 md:block")} />
      </div>
      <Public time="Time" />
      <Field label="Amount">
        <Bar className={cn(t.figure44, "w-[3.95em]")} />
        <Bar className="mt-1.5 w-[7.3em] text-[13px]" />
      </Field>
      <Field label="Sender">
        <Bar className="w-[7.95em] text-[15px]" />
      </Field>
      <Field label="Recipient">
        <Bar className="w-[6.4em] text-[15px]" />
        <Bar className={cn(t.data, "mt-0.5 w-[19ch]")} />
      </Field>
      <Field label="Memo">
        <Bar className="w-[min(100%,16.5em)] text-[15px]" />
      </Field>
      <p className="border-t border-mist pt-5 text-[15px]">
        <a
          href={P.explorerUrl}
          target="_blank"
          rel="noreferrer"
          data-txid={P.txid}
          className={cn(textLink, "decoration-ink/40")}
        >
          Open it on {P.explorerName}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
    </div>
  );
}

function PaperView() {
  return (
    <div
      role="group"
      aria-labelledby="paper-title"
      className={cn(
        "relative flex flex-col rounded-b-[12px] border border-t-0 border-mist bg-paper md:rounded-r-[12px] md:rounded-bl-none md:border-t md:border-l-0",
        ROWS,
        PAD,
      )}
    >
      {/* On a phone the views stack: the gold hairline is the seam between them. */}
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-gold md:hidden" />
      <Title id="paper-title" title={`What ${P.name.split(" ")[0]}'s viewing key shows`}>
        Her {P.periodLabel} payslip, read from the same transaction.
      </Title>
      <div className="flex items-center pb-5">
        <span
          aria-hidden="true"
          className={cn(lp.thread, lp.threadPaper, "-ml-8 hidden h-0.5 w-5 shrink-0 bg-gold md:block")}
        />
        <span
          aria-hidden="true"
          className={cn(lp.dot, lp.dotPaper, "mr-1.5 hidden size-1.5 shrink-0 rounded-full bg-gold md:block")}
        />
        <p className={cn(t.data, "text-ink")}>
          <TxidLines txid={P.txid} />
        </p>
      </div>
      <Public time="Paid" />
      <Field label="Amount">
        <Reveal delay={960} className={t.figure44}>
          <Usd cents={P.usdCents} className="tracking-[-0.02em]" />
        </Reveal>
        <Reveal delay={1080} className="mt-1.5 text-[13px] text-ash">
          <Coin zat={P.zat} unit={P.coin} />
        </Reveal>
      </Field>
      <Field label="Sender">
        <Reveal delay={1200} className="text-[15px]">
          {P.payer}
        </Reveal>
      </Field>
      <Field label="Recipient">
        <Reveal delay={1320} className="text-[15px]">
          {P.name}
        </Reveal>
        <Reveal delay={1400} className={cn(t.data, "mt-0.5 text-ash")}>
          <span title={P.recipient} className="whitespace-nowrap">
            {truncateMiddle(P.recipient, 10, 8)}
          </span>
        </Reveal>
      </Field>
      <Field label="Memo">
        <Reveal delay={1520} className="text-[15px]">
          {P.periodLabel} pay, invoice <span className="whitespace-nowrap">{P.invoice}</span>
        </Reveal>
      </Field>
      <p className="border-t border-mist pt-5 text-[15px]">
        <Link href={`/verify#${P.proofToken}`} className={textLink}>
          Check the payment proof
        </Link>
      </p>
    </div>
  );
}

function Title({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div className="pb-5">
      <p id={id} className="text-[15px] font-medium">
        {title}
      </p>
      <p className="mt-1 text-[13px] leading-[1.45] text-ash">{children}</p>
    </div>
  );
}

/** The txid in two lines of 32, the way it reads best at 13px. */
function TxidLines({ txid }: { txid: string }) {
  return (
    <>
      <span className="block">{txid.slice(0, 32)}</span>
      <span className="block">{txid.slice(32)}</span>
    </>
  );
}

/** What both views show alike: the block and the moment it was mined. */
function Public({ time }: { time: string }) {
  return (
    <dl className="grid grid-cols-2 gap-4 pb-6 text-[13px] leading-[1.45]">
      <div>
        <dt className="text-ash">Block</dt>
        <dd className="mt-0.5 font-mono tabular-nums">{formatHeight(P.height)}</dd>
      </div>
      <div>
        <dt className="text-ash">{time}</dt>
        <dd className="mt-0.5">{formatDateTime(P.blockTime)}</dd>
      </div>
    </dl>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-3 border-t border-mist py-3.5 xl:grid-cols-[6.5rem_minmax(0,1fr)]">
      <dt className="text-[13px] text-ash">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </dl>
  );
}

/** A redaction bar: Mist on Vault, the size of the value it hides, never a blur. */
function Bar({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative block max-w-full leading-[1.5] before:absolute before:inset-x-0 before:inset-y-[0.14em] before:rounded-[4px] before:bg-mist before:content-['']",
        className,
      )}
    >
      <span aria-hidden="true">{" "}</span>
      <span className="sr-only">Hidden on chain</span>
    </span>
  );
}

/** A value on the paper side: in the markup from the start, uncovered once on load. */
function Reveal({ delay, className, children }: { delay: number; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(lp.reveal, "block w-fit max-w-full", className)}
      style={{ "--lp-delay": `${delay}ms` } as CSSProperties}
    >
      <span className="lp-v">{children}</span>
    </span>
  );
}
