"use client";

import Link from "next/link";
import { Share } from "lucide-react";
import { Usd } from "@/components/app/amount";
import { Tag } from "@/components/ds/tag";
import { monthDay, payslipHref, payslipTitle } from "@/components/portal/portal-data";
import { DocIcon } from "@/components/portal/portal-states";
import { Button } from "@/components/ui/button";
import type { StatementLine } from "@/lib/api";

/**
 * Mercury's document rows: a sheet icon, "Payslip for Sep 2026" over the paid date and invoice,
 * the USD amount, and Share proof. The whole row opens the payslip.
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
    <ul aria-label={label}>
      {pending.map((line) => (
        <Row key={`p-${line.txid}-${line.amount_zat}`} line={line} pending onShare={onShare} />
      ))}
      {lines.map((line) => (
        <Row key={`${line.txid}-${line.amount_zat}`} line={line} onShare={onShare} />
      ))}
    </ul>
  );
}

function Row({
  line,
  pending,
  onShare,
}: {
  line: StatementLine;
  pending?: boolean;
  onShare: (line: StatementLine) => void;
}) {
  const converted = line.settlement === "converted";
  return (
    <li className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3.5 border-b border-hairline py-3.5 text-[0.9375rem] sm:grid-cols-[auto_minmax(0,1fr)_auto_7.5rem]">
      <DocIcon />
      <div className="min-w-0">
        <Link
          href={payslipHref(line)}
          className="block truncate rounded-sm text-foreground after:absolute after:inset-0 hover:underline"
        >
          {payslipTitle(line)}
        </Link>
        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-[0.8125rem] text-muted-foreground">
          <span className="truncate">
            {pending ? "Sent, waiting to be mined" : `Paid ${monthDay(line.block_time ?? line.date)}`} ·{" "}
            {line.invoice_ref}
          </span>
          {converted ? <span className="text-foreground">· Converted to USDC</span> : null}
        </span>
      </div>
      <div className="text-right">
        <Usd cents={line.usd_basis_cents} />
        {pending ? (
          <div className="mt-0.5">
            <Tag>Confirming</Tag>
          </div>
        ) : null}
      </div>
      <div className="relative z-10 hidden justify-end sm:flex">
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
    </li>
  );
}
