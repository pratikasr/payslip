"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ChevronLeft, Download, ExternalLink, Share } from "lucide-react";
import { Fiat, Rate, Usd, Zec } from "@/components/app/amount";
import { useCoinUnit } from "@/components/app/health-provider";
import { CopyButton } from "@/components/app/copy-button";
import { LogoMark } from "@/components/app/logo";
import { ErrorState } from "@/components/app/states";
import { Initials } from "@/components/ds/avatar";
import { PageTitle } from "@/components/ds/page";
import { payslipTitle, personName, proofLink } from "@/components/portal/portal-data";
import { usePortal } from "@/components/portal/portal-provider";
import { ScanProgress, SettlementTag, SimulatedRate } from "@/components/portal/portal-states";
import { ShareProofDialog } from "@/components/portal/share-proof-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { CreatedProof, Statement, StatementLine } from "@/lib/api";
import {
  formatDate,
  formatDateTime,
  formatFiat,
  formatHeight,
  formatPeriodLabel,
  formatRange,
  networkLabel,
  truncateMiddle,
} from "@/lib/format";

const QrCode = dynamic(() => import("@/components/app/qr-code"), { ssr: false });

/** A4 paper for Download PDF; the rest of the print rules live in globals.css. */
const PRINT_CSS = "@media print { @page { size: A4; margin: 16mm 15mm; } }";

function Back() {
  return (
    <Link
      href="/portal/payslips"
      className="mb-3 inline-flex items-center gap-1 rounded-sm text-sm text-muted-foreground hover:text-foreground"
      data-print="hide"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      Payslips
    </Link>
  );
}

/** One payslip as a document: who was paid, for what period, how much, and where it is on chain. */
export function PayslipDocument({ txid }: { txid: string }) {
  const { recent, reload } = usePortal();
  const s = recent.statement;
  const line = s?.lines.find((l) => l.txid === txid) ?? s?.pending.find((l) => l.txid === txid);

  if (!s) {
    return (
      <>
        <Back />
        {recent.error ? (
          <>
            <PageTitle title="Payslip" />
            <ErrorState error={recent.error} onRetry={reload} />
          </>
        ) : (
          <div className="space-y-5">
            <Skeleton className="h-9 w-72" />
            <ScanProgress startedAt={recent.startedAt} />
            <Skeleton className="h-[480px] max-w-[760px] rounded-xl" />
          </div>
        )}
      </>
    );
  }
  if (!line) {
    return (
      <>
        <Back />
        <PageTitle title="Payslip not found" />
        <p className="max-w-prose text-[0.9375rem] text-muted-foreground">
          Your key shows no payment in transaction{" "}
          <code className="font-mono text-[0.8125rem] text-foreground">{truncateMiddle(txid, 10, 8)}</code> in the last
          12 months. Open{" "}
          <Link href="/portal/tax" className="rounded-sm text-link hover:underline">
            Tax documents
          </Link>{" "}
          to look further back.
        </p>
      </>
    );
  }
  return <Document statement={s} line={line} />;
}

function Document({ statement: s, line }: { statement: Statement; line: StatementLine }) {
  const [sharing, setSharing] = useState(false);
  const [proof, setProof] = useState<CreatedProof | null>(null);
  const name = personName(s);
  const mined = line.height !== null && s.lines.includes(line);
  const testnet = s.network === "testnet";
  const run = s.runs?.[line.run_id];
  const market = s.network === "mainnet" && line.market ? line.market : null;
  const title = payslipTitle(line);
  const coin = useCoinUnit();

  const print = () => {
    const previous = document.title;
    document.title = `${title}${name ? `, ${name}` : ""}`;
    window.print();
    document.title = previous;
  };

  const rows: { label: string; value: ReactNode; hint?: ReactNode }[] = [
    {
      label: "Paid on",
      value: mined ? formatDateTime(line.block_time ?? line.date) : "Sent, waiting to be mined",
    },
    { label: "Invoice", value: line.invoice_ref },
    {
      label: "Rate",
      value: (
        <span className="inline-flex flex-wrap items-baseline gap-x-2">
          <Rate e6={line.rate_usd_per_zec_e6} />
          {testnet ? <SimulatedRate /> : null}
        </span>
      ),
      hint: testnet ? undefined : "The rate the payroll run bought ZEC at.",
    },
    ...(market
      ? [
          {
            label: "Value at receipt",
            value: <Fiat cents={market.value_cents} currency={market.currency} />,
            hint: `1 ZEC was ${formatFiat(market.price_cents, market.currency)} at ${formatDateTime(market.priced_at)}, CoinGecko`,
          },
        ]
      : []),
    line.settlement === "converted"
      ? {
          label: "Settlement",
          value: "Converted to USDC",
          hint: "Paid in ZEC to a swap that sends USDC to your payout address.",
        }
      : {
          label: "Settlement",
          value: `Held in shielded ${coin}`,
          hint: line.to_address ? (
            <span>
              Paid to{" "}
              <code className="font-mono text-[0.8125rem]" title={line.to_address}>
                {truncateMiddle(line.to_address, 12, 8)}
              </code>
            </span>
          ) : undefined,
        },
    {
      label: "Transaction",
      value: (
        <span className="flex min-w-0 items-start gap-1">
          <code className="min-w-0 font-mono text-[0.8125rem] leading-6 break-all">{line.txid}</code>
          <span className="flex shrink-0 items-center" data-print="hide">
            <CopyButton value={line.txid} label="transaction id" />
            {line.explorer_url ? (
              <a
                href={line.explorer_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Open the transaction in a block explorer (opens in a new tab)"
                title="Open in block explorer"
              >
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            ) : null}
          </span>
        </span>
      ),
      hint: "A block explorer shows this transaction with no amount and no parties.",
    },
    { label: "Block height", value: <span className="num">{formatHeight(line.height)}</span> },
  ];

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="max-w-[760px] print:max-w-none">
        <Back />
        <PageTitle
          title={title}
          actions={
            <>
              <Button onClick={() => setSharing(true)} disabled={!mined}>
                <Share aria-hidden="true" />
                Share proof
              </Button>
              <Button variant="secondary" onClick={print}>
                <Download aria-hidden="true" />
                Download PDF
              </Button>
            </>
          }
        />

        <article
          aria-label={title}
          className="rounded-xl border bg-card px-5 py-6 text-card-foreground sm:px-10 sm:py-9 print:max-w-none print:rounded-none print:border-0 print:p-0"
        >
          <header className="flex items-start justify-between gap-4 border-b border-hairline pb-5">
            <div className="flex items-center gap-2.5">
              <LogoMark className="size-7" />
              <div>
                <p className="text-[0.9375rem] font-medium tracking-tight">Payslip</p>
                <p className="text-xs text-muted-foreground">
                  Private payroll on Zcash {networkLabel(s.network).toLowerCase()}
                </p>
              </div>
            </div>
            <SettlementTag line={line} />
          </header>

          <div className="grid gap-5 border-b border-hairline py-6 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="text-[0.8125rem] text-muted-foreground">Paid to</p>
              <p className="mt-1.5 flex items-center gap-2.5 text-[0.9375rem]">
                <Initials name={name} />
                <span className="truncate">{name ?? "The holder of this viewing key"}</span>
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[0.8125rem] text-muted-foreground">Period</p>
              <p className="mt-1.5 text-[0.9375rem]">{formatPeriodLabel(line.period)}</p>
              {run ? (
                <p className="text-sm text-muted-foreground">{formatRange(run.period_start, run.period_end)}</p>
              ) : null}
            </div>
          </div>

          <div className="border-b border-hairline py-6">
            <p className="text-[0.8125rem] text-muted-foreground">Amount</p>
            <p className="mt-1 text-[2.125rem] leading-tight font-[380]">
              <Usd cents={line.usd_basis_cents} />
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              <Zec zat={line.amount_zat} />
            </p>
            {line.settlement === "converted" ? (
              <p className="mt-3 text-[0.9375rem]">
                You chose to be paid in USDC, so this payment was converted to USDC.
              </p>
            ) : null}
          </div>

          <dl className="grid gap-x-3 gap-y-4 py-6 text-[0.9375rem] sm:grid-cols-[170px_minmax(0,1fr)]">
            {rows.map((r) => (
              <div key={r.label} className="contents">
                <dt className="text-strong">{r.label}</dt>
                <dd className="mb-2 min-w-0 sm:mb-0">
                  <div className="text-foreground">{r.value}</div>
                  {r.hint ? <div className="mt-0.5 text-sm text-muted-foreground">{r.hint}</div> : null}
                </dd>
              </div>
            ))}
          </dl>

          <footer className="border-t border-hairline pt-5 text-xs text-muted-foreground">
            Read from the Zcash chain with your viewing key on {formatDate(s.generated_at)}, scanned to block{" "}
            <span className="num">{formatHeight(s.scanned_to_height)}</span>. The amount and the parties are hidden on
            the public chain.
          </footer>

          {proof ? (
            <section data-print="only" className="mt-6 border-t border-hairline pt-5">
              <div className="flex items-center gap-4">
                <QrCode value={proofLink(proof.token)} label="Check this payment" size={96} />
                <p className="text-xs">
                  Scan to check this payment against the Zcash chain. The check needs no account and shows this payment
                  only.
                </p>
              </div>
            </section>
          ) : null}
        </article>

        <ShareProofDialog
          line={sharing ? line : null}
          onOpenChange={(open) => !open && setSharing(false)}
          onCreated={setProof}
        />
      </div>
    </>
  );
}
