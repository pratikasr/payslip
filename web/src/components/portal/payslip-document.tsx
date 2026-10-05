"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, Download, ExternalLink, Share } from "lucide-react";
import { Fiat, Rate, Usd, Zec } from "@/components/app/amount";
import { useCoinUnit } from "@/components/app/health-provider";
import { CopyButton } from "@/components/app/copy-button";
import { LogoMark } from "@/components/app/logo";
import { ErrorState } from "@/components/app/states";
import { Initials } from "@/components/ds/avatar";
import { PageTitle } from "@/components/ds/page";
import { useDocumentTitle } from "@/components/portal/document-title";
import { fetchStatement, payslipTitle, proofLink, statementRequest } from "@/components/portal/portal-data";
import { usePersonName, usePortal } from "@/components/portal/portal-provider";
import { ScanProgress, SettlementTag } from "@/components/portal/portal-states";
import { ShareProofDialog } from "@/components/portal/share-proof-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toDisplayError, type ApiError, type CreatedProof, type Statement, type StatementLine } from "@/lib/api";
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

  useDocumentTitle(`${title} | Payslip`);

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
      : {
          label: "Settlement",
          value: `Held in shielded ${coin}`,
          hint: line.to_address ? (
            <span>
              Paid to{" "}
              <code className="font-mono text-[0.8125rem]" title={line.to_address}>
                <span data-print="hide">{truncateMiddle(line.to_address, 12, 8)}</span>
                <span data-print="only" className="break-all">
                  {line.to_address}
                </span>
              </code>
              , one receiver of your Zcash address. A payment proof shows this same receiver; it will not look identical
              to the full address you gave your payer, and the proof page can check that it is yours.
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
    },
    { label: "Block height", value: <span className="num">{formatHeight(line.height)}</span> },
    {
      label: "What the world sees",
      value: mined ? (
        <span>
          A shielded transaction in block <span className="num">{formatHeight(line.height)}</span>: no amount, no names.
        </span>
      ) : (
        "Nothing yet: the transaction is waiting for a block."
      ),
      hint: line.explorer_url ? (
        <a
          href={line.explorer_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-sm text-link underline underline-offset-4"
          data-print="hide"
        >
          See it on a public block explorer
          <ExternalLink className="size-3.5" aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : undefined,
    },
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
                You chose to be paid in USDC, so this payment was sent to a swap venue to be converted to USDC.
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
