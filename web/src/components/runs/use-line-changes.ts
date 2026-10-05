"use client";

import { useEffect, useRef, useState } from "react";
import type { PayLine } from "@/lib/api";

const FLASH_MS = 1600;

/**
 * Ids of pay lines whose status, txid or height changed in the last FLASH_MS, so their row can
 * mark the change. The first render marks nothing: motion answers an update, never the page load.
 * (Same logic as the original run progress panel.)
 */
export function useLineChanges(lines: PayLine[]): ReadonlySet<string> {
  const previous = useRef<Map<string, string> | null>(null);
  const [changed, setChanged] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const now = new Map(lines.map((l) => [l.id, `${l.status}|${l.txid ?? ""}|${l.confirmed_height ?? ""}`]));
    const before = previous.current;
    previous.current = now;
    if (!before) return;
    const diff = [...now].filter(([id, sig]) => before.has(id) && before.get(id) !== sig).map(([id]) => id);
    if (diff.length === 0) return;
    setChanged((prev) => new Set([...prev, ...diff]));
    for (const id of diff) {
      clearTimeout(timers.current.get(id));
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          setChanged((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
        }, FLASH_MS),
      );
    }
  }, [lines]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((t) => clearTimeout(t));
  }, []);

  return changed;
}
