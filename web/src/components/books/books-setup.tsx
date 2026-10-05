"use client";

import { BookOpenCheck } from "lucide-react";
import { Card } from "@/components/ds/card";
import { KeyImport } from "@/components/books/key-import";
import { useBooks } from "@/components/books/books-provider";

/** First visit: a centred card that asks for the company's viewing keys. */
export function BooksSetup() {
  const { addKeys } = useBooks();
  return (
    <div className="mx-auto grid max-w-[560px] gap-6 pt-6 sm:pt-12">
      <div className="text-center">
        <span className="mx-auto mb-4 grid size-11 place-items-center rounded-full bg-primary-soft text-strong">
          <BookOpenCheck className="size-5" aria-hidden="true" />
        </span>
        <h1 className="text-[1.75rem] leading-tight font-[380] tracking-[-0.015em] text-balance">Open the books</h1>
        <p className="mt-2 text-[0.9375rem] text-muted-foreground">
          Load the company&apos;s viewing keys to reconcile every payroll run. Viewing keys read payments but cannot
          spend them.
        </p>
      </div>
      <Card className="p-5 sm:p-6">
        <KeyImport onAdd={addKeys} primary idPrefix="books-setup" />
      </Card>
      <p className="text-center text-xs text-muted-foreground">
        Keys stay in this browser tab and are sent to the Payslip service only to scan the chain.
      </p>
    </div>
  );
}
