"use client";

import { KeyRound, Trash2 } from "lucide-react";
import { Tag } from "@/components/ds/tag";
import { KeyImport } from "@/components/books/key-import";
import { useBooks } from "@/components/books/books-provider";
import { describeKeys, keySetSummary } from "@/components/books/books-data";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { keyPreview } from "@/lib/keys";

const ROLE_LABEL = { treasury: "Treasury", contractor: "Contractor", unknown: "Not this company" } as const;

/** The key set as objects: who each key belongs to, with Remove; more keys can be added below. */
export function ManageKeysDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { keys, scan, addKeys, removeKey, forget } = useBooks();
  const described = describeKeys(keys, scan.result);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Viewing keys</DialogTitle>
          <DialogDescription>
            {keys.length} {keys.length === 1 ? "key" : "keys"} · {keySetSummary(described)}. They read payments but
            cannot spend.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-hairline rounded-xl border" aria-label="Loaded viewing keys">
          {described.map((k, i) => (
            <li key={k.ufvk} className="flex items-center gap-3 px-3.5 py-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-chip text-muted-foreground">
                <KeyRound className="size-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate text-[0.9375rem]">{k.label ?? `Key ${i + 1}`}</span>
                  {k.role ? <Tag tone={k.role === "unknown" ? "warning" : "neutral"}>{ROLE_LABEL[k.role]}</Tag> : null}
                </div>
                <code className="font-mono text-xs text-muted-foreground">{keyPreview(k.ufvk)}</code>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => removeKey(k.ufvk)}
                aria-label={`Remove ${k.label ?? `key ${i + 1}`}`}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
        <div className="grid gap-3 border-t border-hairline pt-4">
          <h3 className="text-[0.9375rem] text-strong">Add keys</h3>
          <KeyImport onAdd={addKeys} idPrefix="books-manage" />
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              forget();
              onOpenChange(false);
            }}
          >
            Forget all keys
          </Button>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
