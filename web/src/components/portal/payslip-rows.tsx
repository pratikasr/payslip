"use client";

import Link from "next/link";
import { Share } from "lucide-react";
import { Usd } from "@/components/app/amount";
import { formatPeriodLabel } from "@/lib/format";
import { DOT, StatusStamp } from "@/components/portal/paper-parts";
import { monthDay, payslipHref, payslipTitle } from "@/components/portal/portal-data";
import { SettlementTag } from "@/components/portal/portal-states";
import { Button } from "@/components/ui/button";
import type { StatementLine } from "@/lib/api";
import { cn } from "cn";

/**
 * The payslips as a stack of pay advice stubs: a green-bar counterfoil with the period, torn
 * along a perforation from the slip itself (its title, the paid date and invoice, the amount in
 * dot matrix, the SHIELDED stamp) and Share proof. The whole slip opens the payslip.
 */
export function PayslipRows({
  lines,
  pending = [],
  onShare,
  label = "Payslips",
}: {
  lines: StatementLine[];
  pending?: StatementLine[];
  onShare: (line: StatementLine) => void;
  label?: string;
}) {
  return (
    <ul aria-label={label} className="grid gap-3">
      {pending.map((line) => (
        <Stub key={`p-${line.txid}-${line.amount_zat}`} line={line} pending onShare={onShare} />
      ))}
      {lines.map((line) => (
        <Stub key={`${line.txid}-${line.amount_zat}`} line={line} onShare={onShare} />
      ))}
    </ul>
  );
}

function Stub({
  line,
  pending,
  onShare,
}: {
  line: StatementLine;
  pending?: boolean;
  onShare: (line: StatementLine) => void;
}) {
  const converted = line.settlement === "converted";
  const [month, year] = formatPeriodLabel(line.period).split(" ");
  return (
    <li
      className={cn(
        "paper relative grid grid-cols-[4.25rem_minmax(0,1fr)] border border-bar-line shadow-[3px_3px_0_0_var(--rule)] sm:grid-cols-[5.5rem_minmax(0,1fr)_auto]",
        pending && "border-dashed",
      )}
    >
      {/* The counterfoil: the period in large type on green bar, a perforation down its edge. */}
      <div
        aria-hidden="true"
        className="row-span-2 border-r-2 border-dotted border-tear bg-bar px-2 py-3 font-type sm:row-span-1 sm:px-3"
      >
        <span className="form-label block text-[0.625rem] text-muted-foreground sm:text-[0.6875rem]">Period</span>
        <span className="mt-1 block text-[1rem] leading-[1.15] font-bold uppercase sm:text-[1.125rem]">
          {month}
          <br />
          {year}
        </span>
      </div>
      <div className="min-w-0 px-3.5 pt-3 sm:px-4 sm:pb-3">
        <Link
          href={payslipHref(line)}
          className="inked block truncate font-display text-[1.125rem] leading-snug font-bold after:absolute after:inset-0 hover:underline"
        >
          {payslipTitle(line)}
        </Link>
        <span className="mt-1 block font-type text-[0.8125rem] leading-[1.45] text-muted-foreground">
          {pending ? "Sent, waiting to be mined" : `Paid ${monthDay(line.block_time ?? line.date)}`}, invoice{" "}
          <span className="whitespace-nowrap text-foreground">{line.invoice_ref}</span>
          {converted ? ", converted to USDC" : null}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4 px-3.5 pt-2 pb-3 sm:justify-end sm:py-3 sm:pr-4 sm:pl-0">
        <div className="flex flex-col items-start gap-1.5 sm:items-end">
          <span className={cn(DOT, "text-[1.5rem] sm:text-[1.75rem]", pending && "text-muted-foreground")}>
            <Usd cents={line.usd_basis_cents} />
          </span>
          {pending ? <StatusStamp tone="soft">Confirming</StatusStamp> : <SettlementTag line={line} />}
        </div>
        <div className="relative z-10 hidden sm:flex">
          {pending ? null : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onShare(line)}
              aria-label={`Share proof of ${payslipTitle(line)}`}
            >
              <Share aria-hidden="true" />
              Share proof
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}
