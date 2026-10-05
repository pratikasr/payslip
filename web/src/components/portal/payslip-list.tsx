"use client";

import Link from "next/link";
import { useState } from "react";
import { Download } from "lucide-react";
import { ErrorState } from "@/components/app/states";
import { PageTitle } from "@/components/ds/page";
import { PayslipRows } from "@/components/portal/payslip-rows";
import { newestFirst } from "@/components/portal/portal-data";
import { usePortal } from "@/components/portal/portal-provider";
import { RowsSkeleton, ScanProgress } from "@/components/portal/portal-states";
import { ShareProofDialog } from "@/components/portal/share-proof-dialog";
import { Button } from "@/components/ui/button";
import type { StatementLine } from "@/lib/api";
import { formatRange } from "@/lib/format";

/** Every payslip in the last twelve months, newest period first. */
export function PayslipList() {
  const { recent, reload, range } = usePortal();
  const [sharing, setSharing] = useState<StatementLine | null>(null);
  const s = recent.statement;
  const lines = s ? newestFirst(s.lines).sort((a, b) => b.period.localeCompare(a.period)) : [];
  const pending = s ? newestFirst(s.pending) : [];

  return (
    <>
      <PageTitle
        title="Payslips"
        description={`Payments to you from ${formatRange(range.from, range.to)}.`}
        actions={
          <Button asChild variant="secondary">
            <Link href="/portal/tax">
              <Download aria-hidden="true" />
              Download for tax
            </Link>
          </Button>
        }
      />
      {recent.error ? <ErrorState error={recent.error} onRetry={reload} className="mb-5" /> : null}
      {!s ? (
        recent.error ? null : (
          <div className="space-y-5">
            <ScanProgress startedAt={recent.startedAt} />
            <RowsSkeleton rows={4} />
          </div>
        )
      ) : lines.length + pending.length === 0 ? (
        <p className="border-y border-hairline py-6 text-[0.9375rem] text-muted-foreground">
          No payslips in the last 12 months. They appear here when your payer runs payroll and the payment is mined.
        </p>
      ) : (
        <>
          <PayslipRows lines={lines} pending={pending} onShare={setSharing} />
          <p className="mt-4 text-sm text-muted-foreground">
            Older payments are in{" "}
            <Link href="/portal/tax" className="rounded-sm text-link underline underline-offset-4">
              Tax documents
            </Link>
            , for any period you choose.
          </p>
        </>
      )}
      <ShareProofDialog line={sharing} onOpenChange={(open) => !open && setSharing(null)} />
    </>
  );
}
