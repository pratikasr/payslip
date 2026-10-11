import type { CSSProperties, ReactNode } from "react";
import { cn } from "cn";
import { formatDateTime, formatHeight } from "@/lib/format";

/*
  The identity (docs/DESIGN.md section 16): one payment, two views. On the left, the vault: what
  the public explorer shows for a transaction. On the right, the paper: what a viewing key shows
  for the same transaction. The txid heads both, joined by a gold thread, and the rows line up
  across the seam (CSS subgrid once the views sit side by side), so each hidden value on the
  vault side sits level with the value the key reads. Below the split the panels stack, vault
  first, and the gold hairline becomes the seam between them.

  One implementation for every screen that shows a payment both ways: the landing hero, a payroll
  run, a payslip and the public proof. The pieces here are the frame (TwoViews, VaultView,
  PaperView), the joins (Thread), and the vocabulary of each side (ViewTitle, ChainFacts,
  ViewField, Redacted, Reveal).

  Redaction bars appear only on the vault side and only for what the chain hides. With `motion`
  the thread draws and the paper side resolves from bars into values once (globals.css, tv-*);
  reduced motion shows the final state at once.
*/

/** Where the views sit side by side; below it they stack, vault first. */
export type Split = "md" | "lg" | "xl";

interface SplitClasses {
  /** The figure's columns and row tracks once split. */
  grid: Record<"even" | "aside", string>;
  /** A side spans every row track and shares them through a subgrid. */
  rows: string;
  /** Shown only when split (the thread), or only when stacked (the seam). */
  split: string;
  stacked: string;
  vault: string;
  paper: string;
  /** How far the vault's thread reaches across its own padding to the seam, and the paper's stub back. */
  reach: string;
  stub: string;
}

/* Written out per breakpoint so Tailwind sees every class. */
const SPLITS: Record<Split, SplitClasses> = {
  md: {
    grid: {
      even: "md:grid-cols-2 md:grid-rows-[repeat(var(--tv-rows),auto)]",
      aside: "md:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] md:grid-rows-[repeat(var(--tv-rows),auto)]",
    },
    rows: "md:[grid-row:span_var(--tv-rows)] md:grid md:grid-rows-subgrid",
    split: "hidden md:block",
    stacked: "md:hidden",
    vault:
      "rounded-t-[12px] md:rounded-tr-none md:rounded-l-[12px] dark:border-b-0 md:dark:border-r-0 md:dark:border-b",
    paper: "rounded-b-[12px] border-t-0 md:rounded-r-[12px] md:rounded-bl-none md:border-t md:border-l-0",
    reach: "md:-mr-8",
    stub: "-ml-8",
  },
  lg: {
    grid: {
      even: "lg:grid-cols-2 lg:grid-rows-[repeat(var(--tv-rows),auto)]",
      aside: "lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:grid-rows-[repeat(var(--tv-rows),auto)]",
    },
    rows: "lg:[grid-row:span_var(--tv-rows)] lg:grid lg:grid-rows-subgrid",
    split: "hidden lg:block",
    stacked: "lg:hidden",
    vault:
      "rounded-t-[12px] lg:rounded-tr-none lg:rounded-l-[12px] dark:border-b-0 lg:dark:border-r-0 lg:dark:border-b",
    paper: "rounded-b-[12px] border-t-0 lg:rounded-r-[12px] lg:rounded-bl-none lg:border-t lg:border-l-0",
    reach: "lg:-mr-8",
    stub: "-ml-8",
  },
  xl: {
    grid: {
      even: "xl:grid-cols-2 xl:grid-rows-[repeat(var(--tv-rows),auto)]",
      aside: "xl:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] xl:grid-rows-[repeat(var(--tv-rows),auto)]",
    },
    rows: "xl:[grid-row:span_var(--tv-rows)] xl:grid xl:grid-rows-subgrid",
    split: "hidden xl:block",
    stacked: "xl:hidden",
    vault:
      "rounded-t-[12px] xl:rounded-tr-none xl:rounded-l-[12px] dark:border-b-0 xl:dark:border-r-0 xl:dark:border-b",
    paper: "rounded-b-[12px] border-t-0 xl:rounded-r-[12px] xl:rounded-bl-none xl:border-t xl:border-l-0",
    reach: "xl:-mr-8",
    stub: "-ml-8",
  },
};

/** Each side's padding. The thread's reach (-mr-8, -ml-8) matches the 2rem from md up. */
const PAD = "px-5 py-6 sm:px-7 md:px-8 md:py-8";

/**
 * The pair: a figure holding a VaultView and a PaperView. `rows` is how many rows each side has
 * (both must have the same number), so the rows line up across the seam once split. `even`
 * halves the width; `aside` gives the vault a 21rem column beside a paper document.
 */
export function TwoViews({
  caption,
  rows,
  split = "md",
  columns = "even",
  motion = false,
  className,
  children,
  id,
}: {
  /** Names the figure for screen readers: what the two views are of. */
  caption: ReactNode;
  rows: number;
  split?: Split;
  columns?: "even" | "aside";
  /** The one orchestrated motion: the thread draws and the paper side resolves on load. */
  motion?: boolean;
  className?: string;
  children: ReactNode;
  id?: string;
}) {
  const captionId = `${id ?? "two-views"}-caption`;
  return (
    <figure
      id={id}
      aria-labelledby={captionId}
      style={{ "--tv-rows": rows } as CSSProperties}
      className={cn("relative grid", SPLITS[split].grid[columns], motion && "tv-motion", className)}
    >
      <figcaption id={captionId} className="sr-only">
        {caption}
      </figcaption>
      {children}
    </figure>
  );
}

/** The explorer's side: Vault, its own Ash and Mist, and the redaction bars. */
export function VaultView({
  labelledBy,
  split = "md",
  className,
  children,
}: {
  /** The id of this side's ViewTitle. */
  labelledBy: string;
  split?: Split;
  className?: string;
  children: ReactNode;
}) {
  const s = SPLITS[split];
  return (
    <div
      role="group"
      aria-labelledby={labelledBy}
      className={cn(
        "identity-vault flex min-w-0 flex-col bg-vault text-ink",
        // In the dark theme the vault sits darker than the page: a Mist edge keeps its boundary.
        "dark:border dark:border-mist",
        s.vault,
        s.rows,
        PAD,
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The key's side: Paper, with the gold seam on top while the views are stacked. */
export function PaperView({
  labelledBy,
  label,
  split = "md",
  as: Tag = "div",
  className,
  children,
}: {
  labelledBy?: string;
  /** An accessible name when the side has no visible title of its own. */
  label?: string;
  split?: Split;
  as?: "div" | "article";
  className?: string;
  children: ReactNode;
}) {
  const s = SPLITS[split];
  return (
    <Tag
      role={Tag === "div" ? "group" : undefined}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      className={cn(
        "relative flex min-w-0 flex-col border border-mist bg-paper text-ink",
        s.paper,
        s.rows,
        PAD,
        className,
      )}
    >
      {/* Stacked, the views meet at a gold hairline: the seam between them. */}
      <span aria-hidden="true" data-thread="" className={cn("absolute inset-x-0 top-0 h-px bg-gold", s.stacked)} />
      {children}
    </Tag>
  );
}

/** A side's title and the one sentence under it. */
export function ViewTitle({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("pb-5", className)}>
      <p id={id} className="text-[0.9375rem] font-medium">
        {title}
      </p>
      {children ? <p className="mt-1 text-[0.8125rem] leading-[1.45] text-ash">{children}</p> : null}
    </div>
  );
}

/**
 * The gold thread that joins a transaction's two views. On the vault side it runs from a dot
 * after the txid to the seam; on the paper side a short stub comes back from the seam to a dot
 * before the txid. Shown only while the views sit side by side. `weight` thin is for a panel of
 * many rows, where one thread per transaction should stay a hairline.
 */
export function Thread({
  side,
  split = "md",
  weight = "full",
  className,
}: {
  side: "vault" | "paper";
  split?: Split;
  weight?: "full" | "thin";
  className?: string;
}) {
  const s = SPLITS[split];
  // Full: one thread across the width left after the txid. Thin: a fixed length that crosses the
  // side's padding to the seam (12, less the 8 it reaches back), for a txid set at a row's end.
  const line = weight === "full" ? "h-0.5 min-w-4 flex-1" : "h-px w-12 shrink-0";
  if (side === "vault") {
    return (
      <>
        <span
          aria-hidden="true"
          data-thread=""
          className={cn("tv-dot ml-3 size-1.5 shrink-0 rounded-full bg-gold", s.split, className)}
        />
        <span aria-hidden="true" data-thread="" className={cn("tv-thread bg-gold", line, s.split, s.reach)} />
      </>
    );
  }
  return (
    <>
      <span
        aria-hidden="true"
        data-thread=""
        className={cn(
          "tv-thread tv-thread-paper w-5 shrink-0 bg-gold",
          weight === "full" ? "h-0.5" : "h-px",
          s.split,
          s.stub,
        )}
      />
      <span
        aria-hidden="true"
        data-thread=""
        className={cn("tv-dot tv-dot-paper mr-1.5 size-1.5 shrink-0 rounded-full bg-gold", s.split, className)}
      />
    </>
  );
}

/** A txid in two lines of 32, the way it reads best at 13px. */
export function TxidLines({ txid }: { txid: string }) {
  return (
    <>
      <span className="block">{txid.slice(0, 32)}</span>
      <span className="block">{txid.slice(32)}</span>
    </>
  );
}

/** What both views show alike: the block, and the moment it was mined (or a time of the key's own). */
export function ChainFacts({
  height,
  time,
  timeLabel = "Time",
  extra,
  className,
}: {
  height: number | null;
  time: string | null;
  timeLabel?: string;
  /** A third fact the explorer shows, such as the action count. */
  extra?: { label: string; value: ReactNode };
  className?: string;
}) {
  return (
    <dl className={cn("grid grid-cols-2 gap-4 pb-6 text-[0.8125rem] leading-[1.45]", className)}>
      <div>
        <dt className="text-ash">Block</dt>
        <dd className="mt-0.5 font-mono tabular-nums">{height === null ? "Not yet mined" : formatHeight(height)}</dd>
      </div>
      <div>
        <dt className="text-ash">{timeLabel}</dt>
        <dd className="mt-0.5">{time ? formatDateTime(time) : "Not yet mined"}</dd>
      </div>
      {extra ? (
        <div>
          <dt className="text-ash">{extra.label}</dt>
          <dd className="mt-0.5">{extra.value}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/** One labelled value, ruled above: the same row on both sides, so they line up across the seam. */
export function ViewField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-3 border-t border-mist py-3.5 xl:grid-cols-[6.5rem_minmax(0,1fr)]">
      <dt className="text-[0.8125rem] text-ash">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </dl>
  );
}

/**
 * A redaction bar: Mist on Vault, the size of the value it hides, never a blur. It says "Hidden on
 * chain" to screen readers unless `label` is null, for a row that says it once for all its bars.
 */
export function Redacted({ className, label = "Hidden on chain" }: { className?: string; label?: string | null }) {
  return (
    <span
      data-redact=""
      className={cn(
        "relative block max-w-full leading-[1.5] before:absolute before:inset-x-0 before:inset-y-[0.14em] before:rounded-[4px] before:bg-mist before:content-['']",
        className,
      )}
    >
      <span aria-hidden="true">{"\u00a0"}</span>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

/** A value on the paper side: in the markup from the start, uncovered once on load in a `motion` panel. */
export function Reveal({ delay, className, children }: { delay: number; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn("tv-reveal block w-fit max-w-full", className)}
      style={{ "--tv-delay": `${delay}ms` } as CSSProperties}
    >
      <span className="tv-value">{children}</span>
    </span>
  );
}
