import Link from "next/link";
import { cn } from "cn";
import {
  CarbonCopy,
  FormRow,
  FormRows,
  Inked,
  PayAdvice,
  PayAmount,
  Redaction,
  TwoCopies,
} from "@/components/ds/paper";
import { formatDateTime, formatHeight, truncateMiddle } from "@/lib/format";
import { HERO_PAYMENT as P } from "@/components/marketing/data";
import { Coin, Usd } from "@/components/marketing/money";
import { t, textLink } from "@/components/marketing/classes";

/*
  The landing page's pair, built from the shared paper forms (components/ds/paper.tsx): one real
  transaction as Amara Okafor's pay advice, the white original her viewing key reads, and as its
  yellow carbon copy, what the public explorer shows. The rows run in the same order on both, so
  each ink bar sits across from the value it hides; each bar is as wide as that value in the
  typewriter face. The ink lifts off the original's values once, on load; reduced motion shows
  them at once.
*/

const short = truncateMiddle(P.txid, 8, 6);
const paid = formatDateTime(P.blockTime);

/** The values the chain hides, as the key reads them; the carbon sizes its bars from them. */
const PRIVATE = [
  { label: "Employer", value: P.payer },
  { label: "Payee", value: P.name },
  { label: "Period", value: P.periodLabel },
  { label: "Invoice", value: P.invoice },
];

export function HeroCopies({ className }: { className?: string }) {
  return (
    <TwoCopies
      motion
      className={className}
      caption={
        <>
          One payment, two copies: the pay advice {P.name}&apos;s viewing key reads, and what the Zcash explorer shows.
        </>
      }
      original={
        <PayAdvice titleId="advice-title">
          <FormRows>
            {PRIVATE.map((r, i) => (
              <FormRow key={r.label} label={r.label}>
                <Inked delay={700 + i * 110} className={cn(r.label !== "Invoice" && "uppercase")}>
                  {r.value}
                </Inked>
              </FormRow>
            ))}
          </FormRows>
          <PayAmount
            sub={
              <Inked delay={1240}>
                <Coin zat={P.zat} unit={P.coin} />
              </Inked>
            }
          >
            <Inked delay={1140}>
              <Usd cents={P.usdCents} />
            </Inked>
          </PayAmount>
          <FormRows>
            <FormRow label="Txid">
              <span title={P.txid}>{short}</span>
              <span className="sr-only">, transaction {P.txid}</span>
            </FormRow>
            <FormRow label="Block">{formatHeight(P.height)}</FormRow>
            <FormRow label="Paid">
              <span className="uppercase">{paid}</span>
            </FormRow>
          </FormRows>
          <p className={cn(t.data, "mt-4 px-2.5")}>
            <Link href={`/verify#${P.proofToken}`} className={textLink}>
              Check the payment proof
            </Link>
          </p>
        </PayAdvice>
      }
      carbon={
        <CarbonCopy
          titleId="carbon-title"
          className="h-full"
          foot={
            <p className={cn(t.data, "mt-3 px-2.5")}>
              <a
                href={P.explorerUrl}
                target="_blank"
                rel="noreferrer"
                data-txid={P.txid}
                className="text-carbon-ink underline decoration-carbon-ink/40 decoration-1 underline-offset-[3px] hover:decoration-carbon-ink"
              >
                Open it on {P.explorerName}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </p>
          }
          note="The public copy of the same payment. Zcash shows that a shielded transaction happened, in which block and when. Everything else stays inked out unless you hold a viewing key."
        >
          <FormRows tone="ruled">
            {PRIVATE.map((r) => (
              <FormRow key={r.label} label={r.label}>
                <Redaction width={`${r.value.length}ch`} />
              </FormRow>
            ))}
            <FormRow label="Amount" className="py-2">
              <Redaction className="h-9 align-middle sm:h-11" width="min(100%, 14.5rem)" />
            </FormRow>
            <FormRow label="Txid" valueClassName="carbon-print">
              <a
                href={P.explorerUrl}
                target="_blank"
                rel="noreferrer"
                data-txid={P.txid}
                title={P.txid}
                className="text-carbon-ink underline decoration-carbon-ink/35 decoration-1 underline-offset-[3px] hover:decoration-carbon-ink"
              >
                {short}
                <span className="sr-only">
                  , transaction {P.txid} on the Zcash testnet explorer (opens in a new tab)
                </span>
              </a>
            </FormRow>
            <FormRow label="Block" valueClassName="carbon-print">
              {formatHeight(P.height)}
            </FormRow>
            <FormRow label="Paid" valueClassName="carbon-print uppercase">
              {paid}
            </FormRow>
            <FormRow label="Pool" valueClassName="carbon-print">
              {P.pool}, {P.actions} actions
            </FormRow>
          </FormRows>
        </CarbonCopy>
      }
    />
  );
}
