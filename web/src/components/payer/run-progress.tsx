"use client";

import { useEffect, useRef, useState } from "react";
import { Hash } from "@/components/app/hash";
import type { PayLine, PayLineStatus, Run } from "@/lib/api";
import { formatCount, formatHeight } from "@/lib/format";
import { cn } from "cn";

/*
  Live progress of a run's payments, for the run page and the demo video.
  One segment per pay line; each fills in stages as the SSE snapshots move the
  line from allocated to broadcast to confirmed, in the same tones as the line
  badges, and every stage is also counted in words beside the bar.
*/

const STAGE: Record<PayLineStatus, { fill: number; tone: string; label: string }> = {
  pending: { fill: 0, tone: "bg-muted-foreground", label: "Waiting" },
  allocated: { fill: 0.34, tone: "bg-info/45", label: "Allocated" },
  broadcast: { fill: 0.67, tone: "bg-info", label: "Broadcast" },
  confirmed: { fill: 1, tone: "bg-success", label: "Confirmed" },
  failed: { fill: 1, tone: "bg-danger", label: "Failed" },
};

const ORDER: PayLineStatus[] = ["confirmed", "broadcast", "allocated", "pending", "failed"];

function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

export function RunProgress({ run, changed }: { run: Run; changed: ReadonlySet<string> }) {
  const lines = run.lines;
  const confirmed = lines.filter((l) => l.status === "confirmed").length;
  const counts = ORDER.map((status) => ({ status, n: lines.filter((l) => l.status === status).length })).filter(
    (c) => c.n > 0 || c.status === "confirmed",
  );
  const named = lines.length <= 8;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <p className="figure flex items-baseline gap-2" aria-live="polite">
          <span key={confirmed} className="ps-rise text-4xl leading-none font-semibold tracking-[-0.03em]">
            {confirmed}
          </span>{" "}
          <span className="text-lg text-muted-foreground">of {formatCount(lines.length)} payments confirmed</span>
        </p>
        <AllocationStatus run={run} />
      </div>

      <div
        role="progressbar"
        aria-label="Payments confirmed"
        aria-valuemin={0}
        aria-valuemax={lines.length}
        aria-valuenow={confirmed}
        aria-valuetext={`${confirmed} of ${lines.length} payments confirmed`}
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${Math.max(lines.length, 1)}, minmax(0, 1fr))` }}
      >
        {lines.map((l) => (
          <Segment key={l.id} line={l} flash={changed.has(l.id)} named={named} />
        ))}
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label="Payments by stage">
        {counts.map(({ status, n }) => (
          <li key={status} className="inline-flex items-center gap-2">
            <span aria-hidden="true" className={cn("size-2 rounded-full", STAGE[status].tone)} />
            {STAGE[status].label}
            <span className="num font-medium">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Segment({ line, flash, named }: { line: PayLine; flash: boolean; named: boolean }) {
  const stage = STAGE[line.status] ?? STAGE.pending;
  return (
    <div className="min-w-0" title={`${line.contractor_name}: ${stage.label}`}>
      <div className="relative h-2.5 overflow-hidden rounded-[3px] bg-muted">
        <div
          className={cn(
            "absolute inset-y-0 left-0 w-full origin-left transition-[transform,background-color] duration-700 ease-out",
            stage.tone,
            line.status === "broadcast" && "ps-pulse",
          )}
          style={{ transform: `scaleX(${stage.fill})` }}
        />
      </div>
      {named ? (
        <p
          aria-hidden="true"
          className={cn(
            "mt-1.5 truncate text-xs",
            line.status === "confirmed" ? "text-foreground" : "text-muted-foreground",
            flash && "ps-rise",
          )}
        >
          {firstName(line.contractor_name)}
        </p>
      ) : null}
    </div>
  );
}

function AllocationStatus({ run }: { run: Run }) {
  if (!run.allocation_txid) {
    return (
      <p className="text-sm text-muted-foreground">
        Allocation: {run.status === "allocating" ? "building the transaction" : "not sent yet"}
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
      Allocation
      <Hash
        value={run.allocation_txid}
        label="allocation transaction id"
        explorerUrl={run.allocation_explorer_url}
        head={6}
        tail={4}
      />
      {run.allocation_height ? (
        <span className="num">confirmed at {formatHeight(run.allocation_height)}</span>
      ) : (
        <span>waiting to be mined</span>
      )}
    </p>
  );
}

const FLASH_MS = 1600;

/**
 * Ids of pay lines whose status, txid or height changed in the last
 * FLASH_MS, so their row can mark the change. The first render marks nothing:
 * motion answers an update, never the page load.
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
