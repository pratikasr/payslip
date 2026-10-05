"use client";

import { useRef, useState, type ReactNode } from "react";
import { KeyRound } from "lucide-react";
import { BooksShell } from "@/components/shell/books-shell";
import { BooksSetup } from "@/components/books/books-setup";
import { ManageKeysDialog } from "@/components/books/manage-keys-dialog";
import { useBooks } from "@/components/books/books-provider";
import { describeKeys, exceptionsOf, keySetSummary } from "@/components/books/books-data";

/** The accountant shell: the key set in the sidebar, the exceptions count, and setup until keys load. */
export function BooksFrame({ children }: { children: ReactNode }) {
  const books = useBooks();
  const [manageOpen, setManageOpen] = useState(false);
  // The control that opened Manage, so closing the dialog puts focus back on it.
  const opener = useRef<HTMLElement | null>(null);
  const exceptions = books.scan.result ? exceptionsOf(books.scan.result).total : undefined;
  const hasKeys = books.keys.length > 0;
  return (
    <>
      <BooksShell
        exceptions={exceptions}
        bookmarks={
          hasKeys ? (
            <KeySetChip
              onManage={() => {
                opener.current = document.activeElement as HTMLElement | null;
                setManageOpen(true);
              }}
            />
          ) : undefined
        }
      >
        {!books.ready ? null : hasKeys ? children : <BooksSetup />}
      </BooksShell>
      {hasKeys ? <ManageKeysDialog open={manageOpen} onOpenChange={setManageOpen} returnFocus={opener} /> : null}
    </>
  );
}

function KeySetChip({ onManage }: { onManage: () => void }) {
  const { keys, scan } = useBooks();
  const summary = keySetSummary(describeKeys(keys, scan.result));
  const count = `${keys.length} ${keys.length === 1 ? "key" : "keys"}`;
  return (
    <div className="grid gap-1">
      <p className="px-2 pt-1 pb-1 text-xs text-muted-foreground">Key set</p>
      <div className="mx-1 grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 rounded-lg bg-chip px-2.5 py-2">
        <KeyRound className="mt-[3px] size-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-[0.84375rem] text-strong" data-testid="books-key-chip">
          {count}
          {summary !== count ? <span className="text-muted-foreground"> · {summary}</span> : null}
        </span>
        <button
          type="button"
          onClick={onManage}
          className="col-start-2 mt-1 justify-self-start rounded-sm text-[0.8125rem] text-link underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Manage
        </button>
      </div>
    </div>
  );
}
