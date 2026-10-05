"use client";

import { Suspense } from "react";
import { BooksPage } from "@/components/books/books-page";
import { ExceptionsView } from "@/components/books/exceptions-view";
import { ExportsView } from "@/components/books/exports-view";
import { LedgerView } from "@/components/books/ledger-view";
import { ReconciliationView } from "@/components/books/reconciliation-view";
import { exceptionsOf, shortRange } from "@/components/books/books-data";
import { useBooks } from "@/components/books/books-provider";
import { formatCount } from "@/lib/format";

export function ReconciliationPage() {
  return <BooksPage title="Reconciliation">{(r) => <ReconciliationView r={r} />}</BooksPage>;
}

export function LedgerPage() {
  return (
    <BooksPage title="Ledger">
      {(r) => (
        <Suspense>
          <LedgerView r={r} />
        </Suspense>
      )}
    </BooksPage>
  );
}

export function ExceptionsPage() {
  return <BooksPage title="Exceptions">{(r) => <ExceptionsView r={r} />}</BooksPage>;
}

export function ExportsPage() {
  return (
    <BooksPage title="Exports" header={(controls, meta) => <ExportsHeader controls={controls} meta={meta} />}>
      {(r) => <ExportsView r={r} />}
    </BooksPage>
  );
}

/** Mercury's centred "Choose where your books live" heading, with the period under it. */
function ExportsHeader({ controls, meta }: { controls: React.ReactNode; meta: React.ReactNode }) {
  const { scan, period } = useBooks();
  const r = scan.status === "ready" ? scan.result : null;
  const ex = r ? exceptionsOf(r) : null;
  return (
    <div
      className="mx-auto mb-8 grid max-w-[640px] justify-items-center gap-3 pt-4 text-center sm:pt-8"
      data-print="hide"
    >
      <h1 className="text-[1.75rem] leading-tight font-[380] tracking-[-0.015em] text-balance">
        Choose where your books live
      </h1>
      <p className="text-[0.9375rem] text-muted-foreground">
        {r && ex
          ? `Your books for ${shortRange(r.period)} are ready: ${formatCount(r.runs.length)} ${r.runs.length === 1 ? "run" : "runs"}, ${formatCount(r.totals.count)} ${r.totals.count === 1 ? "payment" : "payments"} and ${formatCount(ex.unlabelled.length)} unlabelled ${ex.unlabelled.length === 1 ? "transaction" : "transactions"}.`
          : period
            ? `Preparing your books for ${shortRange(period)}.`
            : "Preparing your books."}
      </p>
      {controls}
      <p className="text-xs text-muted-foreground">{meta}</p>
    </div>
  );
}
