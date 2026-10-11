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
import { TYPE } from "@/components/ds/type";
import { cn } from "cn";

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

/** "Choose where your books live", with the period's contents and the period controls under it. */
function ExportsHeader({ controls, meta }: { controls: React.ReactNode; meta: React.ReactNode }) {
  const { scan, period } = useBooks();
  const r = scan.status === "ready" ? scan.result : null;
  const ex = r ? exceptionsOf(r) : null;
  return (
    <div className="mb-7 grid gap-3" data-print="hide">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <h1 className={cn(TYPE.title, "text-balance")}>Choose where your books live</h1>
        {controls}
      </div>
      <p className="max-w-2xl text-[0.9375rem] text-muted-foreground">
        {r && ex ? (
          <>
            Your books for <span className="font-type text-foreground">{shortRange(r.period)}</span> are ready:{" "}
            <span className="font-type text-foreground">{formatCount(r.runs.length)}</span>{" "}
            {r.runs.length === 1 ? "run" : "runs"},{" "}
            <span className="font-type text-foreground">{formatCount(r.totals.count)}</span>{" "}
            {r.totals.count === 1 ? "payment" : "payments"} and{" "}
            <span className="font-type text-foreground">{formatCount(ex.unlabelled.length)}</span> unlabelled{" "}
            {ex.unlabelled.length === 1 ? "transaction" : "transactions"}.
          </>
        ) : period ? (
          <>
            Preparing your books for <span className="font-type">{shortRange(period)}</span>.
          </>
        ) : (
          "Preparing your books."
        )}
      </p>
      <p className="text-[0.8125rem] text-muted-foreground">{meta}</p>
    </div>
  );
}
