"use client";

import { KeyImport } from "@/components/books/key-import";
import { FormBox } from "@/components/portal/paper-parts";
import { useDocumentTitle } from "@/components/portal/document-title";
import { TYPE } from "@/components/ds/type";
import { cn } from "cn";

/** First visit: the form that asks for the company's viewing keys. */
export function BooksSetup() {
  useDocumentTitle("Open the books | Books | Payslip");
  return (
    <div className="grid max-w-[660px] gap-6 pt-2 sm:pt-4">
      <div>
        <h1 className={cn(TYPE.title, "text-balance")}>Open the books</h1>
        <p className="mt-2 max-w-[52ch] text-[0.9375rem] text-muted-foreground">
          Load the company&apos;s viewing keys to reconcile every payroll run. Viewing keys read payments but cannot
          spend them.
        </p>
      </div>
      <FormBox title="Viewing keys" titleId="books-setup-title" label="Read only">
        <KeyImport layout="rows" idPrefix="books-setup" />
      </FormBox>
      <p className="text-[0.8125rem] text-muted-foreground">
        Keys stay in this browser tab and are sent only to the Payslip service, which keeps a read-only scan of them so
        the next visit is quick. You can ask it to forget them from Manage.
      </p>
    </div>
  );
}
