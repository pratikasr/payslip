"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, Download, Share } from "lucide-react";
import { Fiat, Rate, Usd, Zec } from "@/components/app/amount";
import { useCoinUnit } from "@/components/app/health-provider";
import { CopyButton } from "@/components/app/copy-button";
import { ErrorState } from "@/components/app/states";
import { Initials } from "@/components/ds/avatar";
import { PageTitle } from "@/components/ds/page";
import {
  ChainFacts,
  PaperView,
  Redacted,
  Thread,
  TwoViews,
  TxidLines,
  VaultView,
  ViewField,
  ViewTitle,
} from "@/components/ds/two-views";
import { TYPE } from "@/components/ds/type";
import { useDocumentTitle } from "@/components/portal/document-title";
import { fetchStatement, payslipTitle, proofLink, statementRequest } from "@/components/portal/portal-data";
import { usePersonName, usePortal } from "@/components/portal/portal-provider";
import { ScanProgress, SettlementTag } from "@/components/portal/portal-states";
import { ShareProofDialog } from "@/components/portal/share-proof-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toDisplayError, type ApiError, type CreatedProof, type Statement, type StatementLine } from "@/lib/api";
import { SAMPLE_COMPANY_LINE, companyMark, companyName, isSampleCompany } from "@/lib/company";
import {
  formatDate,
  formatDateTime,
  formatFiat,
  formatHeight,
  formatPeriodLabel,
  formatRange,
  formatRate,
  networkLabel,
  truncateMiddle,
} from "@/lib/format";
import { isValidRange } from "@/lib/period";
import { cn } from "cn";

const QrCode = dynamic(() => import("@/components/app/qr-code"), { ssr: false });

/** A4 paper for Download PDF; the rest of the print rules live in globals.css. */
const PRINT_CSS = "@media print { @page { size: A4; margin: 16mm 15mm; } }";

/** The views sit side by side from 1280px, where the content column leaves the payslip room. */
const SPLIT = "xl" as const;

function Back() {
  return (
    <Link
      href="/portal/payslips"
      className="mb-3 inline-flex items-center gap-1 rounded-sm text-[0.8125rem] text-muted-foreground hover:text-foreground"
      data-print="hide"
    >
      <ChevronLeft className="size-4" aria-hidden="true" />
      Payslips
    </Link>
  );
}

const findLine = (s: Statement | undefined, txid: string) =>
  s?.lines.find((l) => l.txid === txid) ?? s?.pending.find((l) => l.txid === txid);

interface Older {
  statement?: Statement;
  error?: ApiError;
  loading: boolean;
}

/**
 * One payslip as a document: who was paid, for what period, how much, and where it is on chain.
 * A payment older than the last twelve months (opened from Tax documents) carries the period it
 * was found in (?from=&to=), and that period is read before saying the payslip is not there.
 */
export function PayslipDocument({ txid }: { txid: string }) {
  const { recent, reload, ufvk, meta } = usePortal();
  const params = useSearchParams();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const s = recent.statement;
  const inRecent = findLine(s, txid);
  const wantOlder = !!s && !inRecent && !!ufvk && isValidRange(from, to);
  const [older, setOlder] = useState<Older>({ loading: false });

  useEffect(() => {
    if (!wantOlder || !ufvk) return;
    const ctrl = new AbortController();
    setOlder({ loading: true });
    fetchStatement(statementRequest(ufvk, { from, to }, meta), ctrl.signal)
      .then((statement) => !ctrl.signal.aborted && setOlder({ statement, loading: false }))
      .catch((err) => !ctrl.signal.aborted && setOlder({ error: toDisplayError(err), loading: false }));
    return () => ctrl.abort();
  }, [wantOlder, ufvk, meta, from, to]);

  const olderLine = findLine(older.statement, txid);
  const doc =
    inRecent && s
      ? { statement: s, line: inRecent }
      : olderLine && older.statement
        ? { statement: older.statement, line: olderLine }
        : null;

  if (!s || (wantOlder && (older.loading || (!older.statement && !older.error)))) {
    return (
      <>
        <Back />
        {recent.error && !s ? (
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
  if (!doc) {
    return (
      <>
        <Back />
        <PageTitle title="Payslip not found" />
        {older.error ? <ErrorState error={older.error} onRetry={reload} className="mb-4 max-w-prose" /> : null}
        <p className="max-w-prose text-[0.9375rem] text-muted-foreground">
          Your key shows no payment in transaction{" "}
          <code className="font-mono text-[0.8125rem] text-foreground">{truncateMiddle(txid, 10, 8)}</code>{" "}
          {wantOlder ? `from ${formatRange(from, to)}` : "in the last 12 months"}. Open{" "}
          <Link href="/portal/tax" className="rounded-sm text-link underline underline-offset-4">
            Tax documents
          </Link>{" "}
          to look in another period.
        </p>
      </>
    );
  }
  return <Document statement={doc.statement} line={doc.line} />;
}

function Document({ statement: s, line }: { statement: Statement; line: StatementLine }) {
  const [sharing, setSharing] = useState(false);
  const [proof, setProof] = useState<CreatedProof | null>(null);
  const name = usePersonName();
  const mined = line.height !== null && s.lines.includes(line);
  const testnet = s.network === "testnet";
  const run = s.runs?.[line.run_id];
  const market = s.network === "mainnet" && line.market ? line.market : null;
  const title = payslipTitle(line);
  const coin = useCoinUnit();
  const Mark = companyMark();
  // The statement names its network, so the sample line follows the document, not the service.
  const sample = isSampleCompany(s.network);

  useDocumentTitle(`${title} | Payslip`);

  const print = () => {
    const previous = document.title;
    document.title = `${title}${name ? `, ${name}` : ""}`;
    window.print();
    document.title = previous;
  };

  const rows: { label: string; value: ReactNode; hint?: ReactNode }[] = [
    testnet
      ? {
          // On testnet the rate is a fixed demo figure; it stays in a tooltip, not on the page.
          label: "Rate",
          value: (
            <span
              title={`${formatRate(line.rate_usd_per_zec_e6)} per ${coin}, fixed so faucet coins can carry a demo payroll`}
            >
              Simulated testnet rate
            </span>
          ),
          hint: `Testnet coins have no market price, so the dollar amount was converted to ${coin} at a fixed demo rate.`,
        }
      : {
          label: "Rate",
          value: <Rate e6={line.rate_usd_per_zec_e6} />,
          hint: "The rate the payroll run bought ZEC at.",
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
          value: "Sent to be converted to USDC",
          hint: `Paid in ${coin} to a swap venue that sends USDC to your payout address. This payslip shows the ${coin} payment; the conversion is the venue's.`,
        }
      : { label: "Settlement", value: `Held in shielded ${coin}` },
  ];

  const host = explorerHost(line.explorer_url);
  const paidAt = mined ? (line.block_time ?? line.date) : null;

  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="print:max-w-none">
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

        {/*
          The payment two ways, joined by its txid: what anyone sees on the explorer, and this
          payslip, which is what the contractor's key reads. Eight rows a side, so each bar on the
          explorer's side sits level with the value it hides. Both print, the explorer's view first.
        */}
        <TwoViews
          id="payslip-views"
          rows={8}
          split={SPLIT}
          columns="aside"
          caption={`${title} in two views: what the world sees on the Zcash chain, and what your viewing key shows.`}
        >
          <VaultView labelledBy="world-title" split={SPLIT}>
            <ViewTitle id="world-title" title="What the world sees">
              {mined ? (
                <>
                  A shielded transaction in block <span className="num">{formatHeight(line.height)}</span>: no amount,
                  no names.
                </>
              ) : (
                "Nothing yet: the transaction is waiting for a block."
              )}
            </ViewTitle>
            <div className="flex items-center pb-5">
              <p className="font-mono text-[0.8125rem] leading-[1.5] break-all text-ink">
                <TxidLines txid={line.txid} />
              </p>
              <Thread side="vault" split={SPLIT} className="ml-4" />
            </div>
            <ChainFacts height={mined ? line.height : null} time={paidAt} />
            <ViewField label="Amount">
              <Redacted className="w-[3.9em] text-[1.875rem] lg:text-[2.75rem]" />
              <Redacted className="mt-2 w-[9em] text-[0.8125rem]" />
            </ViewField>
            <ViewField label="Sender">
              <Redacted className="w-[7em] text-[0.9375rem]" />
            </ViewField>
            <ViewField label="Recipient">
              <Redacted className="w-[7em] text-[0.9375rem]" />
              <Redacted className="mt-0.5 w-[min(100%,19ch)] font-mono text-[0.8125rem]" />
            </ViewField>
            <ViewField label="Memo">
              <Redacted className="w-[min(100%,12em)] text-[0.9375rem]" />
            </ViewField>
            <p className="border-t border-mist pt-5 text-[0.9375rem]">
              {line.explorer_url ? (
                <a
                  href={line.explorer_url}
                  target="_blank"
                  rel="noreferrer"
                  data-txid={line.txid}
                  data-print="hide"
                  className="rounded-[3px] text-ink underline decoration-ink/40 decoration-1 underline-offset-[3px] transition-colors hover:decoration-gold"
                >
                  {host ? `Open it on ${host}` : "Open it on a public block explorer"}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : null}
            </p>
          </VaultView>

          <PaperView
            as="article"
            label={title}
            split={SPLIT}
            className="print:rounded-none print:border-0 print:px-0 print:pt-6 print:pb-0"
          >
            {/* The employer first, as on any payslip; the product and the network under it. */}
            <header className="flex items-start justify-between gap-4 pb-5">
              <div className="flex min-w-0 items-center gap-2.5">
                <Mark className="size-7 shrink-0" />
                <div className="min-w-0">
                  <p className="font-display text-[1.0625rem] leading-snug font-semibold" data-testid="payslip-paid-by">
                    Paid by {companyName()}
                  </p>
                  <p className="text-[0.8125rem] text-ash">
                    Payslip, private payroll on Zcash {networkLabel(s.network).toLowerCase()}
                  </p>
                </div>
              </div>
              <SettlementTag line={line} />
            </header>

            <div className="flex items-center pb-5">
              <Thread side="paper" split={SPLIT} />
              <p className="min-w-0 font-mono text-[0.8125rem] leading-[1.5] break-all text-ink">
                <span className="sr-only">Transaction </span>
                <TxidLines txid={line.txid} />
              </p>
              <span className="ml-1 shrink-0 self-start" data-print="hide">
                <CopyButton value={line.txid} label="transaction id" />
              </span>
            </div>

            <ChainFacts height={mined ? line.height : null} time={paidAt} timeLabel="Paid" />

            <ViewField label="Amount">
              <span className={cn(TYPE.hero, "block")}>
                <Usd cents={line.usd_basis_cents} />
              </span>
              <span className="mt-2 block text-[0.8125rem] text-ash">
                <Zec zat={line.amount_zat} />
              </span>
              {line.settlement === "converted" ? (
                <span className="mt-3 block text-[0.9375rem]">
                  You chose to be paid in USDC, so this payment was sent to a swap venue to be converted to USDC.
                </span>
              ) : null}
            </ViewField>
            <ViewField label="Sender">
              <span className="text-[0.9375rem]">{companyName()}</span>
              <span className="block text-[0.8125rem] text-ash">From the payroll account it keeps for you</span>
            </ViewField>
            <ViewField label="Recipient">
              <span className="flex min-w-0 items-center gap-2.5 text-[0.9375rem]">
                <Initials name={name} size="sm" />
                <span className="truncate">{name ?? "The holder of this viewing key"}</span>
              </span>
              {line.to_address ? (
                <>
                  <code className="mt-1 block font-mono text-[0.8125rem] text-ash" title={line.to_address}>
                    <span data-print="hide">{truncateMiddle(line.to_address, 12, 8)}</span>
                    <span data-print="only" className="break-all">
                      {line.to_address}
                    </span>
                  </code>
                  <span className="mt-1 block text-[0.8125rem] text-ash">
                    One receiver of your Zcash address. A payment proof shows this same receiver; it will not look
                    identical to the full address you gave your payer, and the proof page can check that it is yours.
                  </span>
                </>
              ) : null}
            </ViewField>
            <ViewField label="Memo">
              <span className="text-[0.9375rem]">
                {formatPeriodLabel(line.period)} pay, invoice{" "}
                <span className="whitespace-nowrap">{line.invoice_ref}</span>
              </span>
              {run ? (
                <span className="block text-[0.8125rem] text-ash">
                  For {formatRange(run.period_start, run.period_end)}
                </span>
              ) : null}
            </ViewField>

            <div className="border-t border-mist pt-5">
              <dl className="grid gap-x-3 gap-y-1 text-[0.9375rem] sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:gap-y-4 xl:grid-cols-[6.5rem_minmax(0,1fr)]">
                {rows.map((r) => (
                  <div key={r.label} className="contents">
                    <dt className="text-[0.8125rem] text-ash sm:pt-0.5">{r.label}</dt>
                    <dd className="mb-3 min-w-0 sm:mb-0">
                      <div className="text-foreground">{r.value}</div>
                      {r.hint ? <div className="mt-0.5 text-[0.8125rem] text-ash">{r.hint}</div> : null}
                    </dd>
                  </div>
                ))}
              </dl>

              <footer className="mt-6 border-t border-mist pt-5 text-[0.8125rem] text-ash">
                <p>
                  Read from the Zcash chain with your viewing key on {formatDate(s.generated_at)}, scanned to block{" "}
                  <span className="num">{formatHeight(s.scanned_to_height)}</span>. The amount and the parties are
                  hidden on the public chain.
                </p>
                {sample ? (
                  <p className="mt-1.5" data-testid="payslip-sample-line">
                    {SAMPLE_COMPANY_LINE}. Testnet coins have no value.
                  </p>
                ) : null}
              </footer>

              {proof ? (
                <section data-print="only" className="mt-6 border-t border-mist pt-5">
                  <div className="flex items-center gap-4">
                    <QrCode value={proofLink(proof.token)} label="Check this payment" size={96} />
                    <p className="text-[0.8125rem]">
                      Scan to check this payment against the Zcash chain. The check needs no account and shows this
                      payment only.
                    </p>
                  </div>
                </section>
              ) : null}
            </div>
          </PaperView>
        </TwoViews>

        <ShareProofDialog
          line={sharing ? line : null}
          onOpenChange={(open) => !open && setSharing(false)}
          onCreated={setProof}
        />
      </div>
    </>
  );
}

/** The explorer's host name from a transaction link, for "Open it on testnet.zecblock.com". */
function explorerHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}
