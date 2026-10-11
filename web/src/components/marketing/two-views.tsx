import Link from "next/link";
import { cn } from "cn";
import { truncateMiddle } from "@/lib/format";
import {
  ChainFacts,
  PaperView,
  Redacted,
  Reveal,
  Thread,
  TwoViews,
  TxidLines,
  VaultView,
  ViewField,
  ViewTitle,
} from "@/components/ds/two-views";
import { HERO_PAYMENT as P } from "@/components/marketing/data";
import { Coin, Usd } from "@/components/marketing/money";
import { t, textLink } from "@/components/marketing/classes";

/*
  The landing hero's pair, built from the shared two-view panel (components/ds/two-views.tsx):
  what the public explorer shows for one real transaction, and what Amara Okafor's viewing key
  shows for the same transaction. Eight rows a side, level across the seam from 768px. The thread
  draws and the paper side resolves once, on load; reduced motion shows the values at once.
*/

const ROWS = 8;

export function HeroTwoViews({ className }: { className?: string }) {
  return (
    <TwoViews
      rows={ROWS}
      motion
      className={className}
      caption={<>One payment, two views: what the Zcash explorer shows, and what {P.name}&apos;s viewing key shows.</>}
    >
      <VaultView labelledBy="vault-title">
        <ViewTitle id="vault-title" title="What the explorer shows">
          A shielded transaction in the {P.pool} pool, with {P.actions} actions.
        </ViewTitle>
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
          <Thread side="vault" className="ml-4" />
        </div>
        <ChainFacts height={P.height} time={P.blockTime} />
        <ViewField label="Amount">
          <Redacted className={cn(t.figure44, "w-[3.95em]")} />
          <Redacted className="mt-1.5 w-[7.3em] text-[13px]" />
        </ViewField>
        <ViewField label="Sender">
          <Redacted className="w-[7.95em] text-[15px]" />
        </ViewField>
        <ViewField label="Recipient">
          <Redacted className="w-[6.4em] text-[15px]" />
          <Redacted className={cn(t.data, "mt-0.5 w-[19ch]")} />
        </ViewField>
        <ViewField label="Memo">
          <Redacted className="w-[min(100%,16.5em)] text-[15px]" />
        </ViewField>
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
      </VaultView>

      <PaperView labelledBy="paper-title">
        <ViewTitle id="paper-title" title={`What ${P.name.split(" ")[0]}'s viewing key shows`}>
          Her {P.periodLabel} payslip, read from the same transaction.
        </ViewTitle>
        <div className="flex items-center pb-5">
          <Thread side="paper" />
          <p className={cn(t.data, "text-ink")}>
            <TxidLines txid={P.txid} />
          </p>
        </div>
        <ChainFacts height={P.height} time={P.blockTime} timeLabel="Paid" />
        <ViewField label="Amount">
          <Reveal delay={960} className={t.figure44}>
            <Usd cents={P.usdCents} className="tracking-[-0.02em]" />
          </Reveal>
          <Reveal delay={1080} className="mt-1.5 text-[13px] text-ash">
            <Coin zat={P.zat} unit={P.coin} />
          </Reveal>
        </ViewField>
        <ViewField label="Sender">
          <Reveal delay={1200} className="text-[15px]">
            {P.payer}
          </Reveal>
        </ViewField>
        <ViewField label="Recipient">
          <Reveal delay={1320} className="text-[15px]">
            {P.name}
          </Reveal>
          <Reveal delay={1400} className={cn(t.data, "mt-0.5 text-ash")}>
            <span title={P.recipient} className="whitespace-nowrap">
              {truncateMiddle(P.recipient, 10, 8)}
            </span>
          </Reveal>
        </ViewField>
        <ViewField label="Memo">
          <Reveal delay={1520} className="text-[15px]">
            {P.periodLabel} pay, invoice <span className="whitespace-nowrap">{P.invoice}</span>
          </Reveal>
        </ViewField>
        <p className="border-t border-mist pt-5 text-[15px]">
          <Link href={`/verify#${P.proofToken}`} className={textLink}>
            Check the payment proof
          </Link>
        </p>
      </PaperView>
    </TwoViews>
  );
}
