"use client";

import { useRef, useState } from "react";
import { KeyRound, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useHealth } from "@/components/app/health-provider";
import { Tag } from "@/components/ds/tag";
import { KeyImport } from "@/components/books/key-import";
import { useBooks } from "@/components/books/books-provider";
import { describeKeys, keySetSummary, type DescribedKey } from "@/components/books/books-data";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toDisplayError } from "@/lib/api";
import { formatHeight } from "@/lib/format";
import { keyPreview } from "@/lib/keys";

function roleTag(k: DescribedKey, walletless: boolean): { text: string; tone: "neutral" | "warning" } | null {
  if (k.duplicate) return { text: "Same account as another key", tone: "warning" };
  if (k.role === "treasury") return { text: "Treasury", tone: "neutral" };
  if (k.role === "contractor") return { text: "Contractor", tone: "neutral" };
  // A deployment with no wallet knows no accounts, so every key it was not told about is unlabelled.
  if (k.role === "unknown")
    return walletless ? { text: "Unlabelled key", tone: "neutral" } : { text: "Not this company", tone: "warning" };
  return null;
}

/** The key set as objects: who each key belongs to, with Remove; more keys can be added below. */
export function ManageKeysDialog({
  open,
  onOpenChange,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes when the dialog closes (the Manage button that opened it). */
  returnFocus?: React.RefObject<HTMLElement | null>;
}) {
  const { keys, scan, removeKey, forget, forgetOnService } = useBooks();
  const { health } = useHealth();
  const walletless = health?.mode === "statements";
  const described = describeKeys(keys, scan.result);
  const [forgetting, setForgetting] = useState(false);
  const closing = useRef(false);

  const forgetEverywhere = async () => {
    setForgetting(true);
    try {
      const res = await forgetOnService();
      closing.current = true;
      toast.success(res.forgotten ? "The service forgot these keys" : "The service held no scan of these keys", {
        description: "They are forgotten in this tab too.",
      });
      onOpenChange(false);
    } catch (err) {
      const e = toDisplayError(err);
      toast.error(e.message, { description: e.hint });
    } finally {
      setForgetting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl"
        onCloseAutoFocus={(e) => {
          if (closing.current || !returnFocus?.current?.isConnected) return;
          e.preventDefault();
          returnFocus.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Viewing keys</DialogTitle>
          <DialogDescription>
            {keys.length} {keys.length === 1 ? "key" : "keys"}: {keySetSummary(described)}. They read payments but
            cannot spend.
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-hairline rounded-xl border" aria-label="Loaded viewing keys">
          {described.map((k, i) => {
            const tag = roleTag(k, walletless);
            return (
              <li key={k.ufvk} className="flex items-center gap-3 px-3.5 py-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-chip text-muted-foreground">
                  <KeyRound className="size-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="truncate text-[0.9375rem]">{k.label ?? `Key ${i + 1}`}</span>
                    {tag ? <Tag tone={tag.tone}>{tag.text}</Tag> : null}
                  </div>
                  <span className="flex flex-wrap gap-x-2 text-[0.8125rem] text-muted-foreground">
                    <code className="font-mono">{keyPreview(k.ufvk)}</code>
                    {k.birthday ? <span className="num">from block {formatHeight(k.birthday)}</span> : null}
                  </span>
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
            );
          })}
        </ul>
        <div className="grid gap-3 border-t border-hairline pt-4">
          <h3 className="text-[0.9375rem] text-strong">Add keys</h3>
          <KeyImport idPrefix="books-manage" />
        </div>
        <div className="grid gap-2 border-t border-hairline pt-4">
          <h3 className="text-[0.9375rem] text-strong">Forget</h3>
          <p className="text-[0.8125rem] text-muted-foreground">
            The Payslip service keeps a read-only scan of these keys so the next visit is quick. Forget them here only,
            or ask the service to delete its scan too.
          </p>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                closing.current = true;
                forget();
                onOpenChange(false);
              }}
              disabled={forgetting}
            >
              Forget all keys
            </Button>
            <Button type="button" variant="secondary" onClick={() => void forgetEverywhere()} disabled={forgetting}>
              {forgetting ? "Forgetting" : "Forget these keys on the service"}
            </Button>
          </div>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
