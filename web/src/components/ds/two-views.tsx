import type { CSSProperties, ReactNode } from "react";
import { cn } from "cn";
import { formatDateTime, formatHeight } from "@/lib/format";
import { Stamp, TearLine } from "@/components/ds/paper";

/*
  One payment, two copies (docs/DESIGN.md sections 16 and 17). The key's view is the white
  original of a pay advice (PaperView); the explorer's view is its yellow carbon copy
  (VaultView), with what the chain hides inked out. The names are section 16's, kept so the run
  page, the payslip and the public proof compose it unchanged; the look is section 17's, built
  from components/ds/paper.tsx.

  The original prints first: on the left once the copies sit side by side, on top when stacked,
  with a tear line between. Rows line up across the pair (CSS subgrid once side by side), so each
  ink bar on the carbon sits level with the value the key reads. With `motion` the ink lifts off
  the original's values once (globals.css, tv-*); reduced motion shows the final state at once.
*/

/** Where the copies sit side by side; below it they stack, the original first. */
export type Split = "md" | "lg" | "xl";

interface SplitClasses {
  /** The figure's columns and row tracks once split. */
  grid: Record<"even" | "aside", string>;
  /** A side spans every row track and shares them through a subgrid. */
  rows: string;
  /** Shown only when split, or only when stacked (the tear line). */
  split: string;
  stacked: string;
  /** The carbon overlaps the original's edge by a hair once side by side. */
  vault: string;
}

/* Written out per breakpoint so Tailwind sees every class. */
const SPLITS: Record<Split, SplitClasses> = {
  md: {
    grid: {
      even: "md:grid-cols-2 md:grid-rows-[repeat(var(--tv-rows),auto)]",
      aside: "md:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] md:grid-rows-[repeat(var(--tv-rows),auto)]",
    },
    rows: "md:[grid-row:span_var(--tv-rows)] md:grid md:grid-rows-subgrid",
    split: "hidden md:block",
    stacked: "md:hidden",
    vault: "md:-ml-px",
  },
  lg: {
    grid: {
      even: "lg:grid-cols-2 lg:grid-rows-[repeat(var(--tv-rows),auto)]",
      aside: "lg:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] lg:grid-rows-[repeat(var(--tv-rows),auto)]",
    },
    rows: "lg:[grid-row:span_var(--tv-rows)] lg:grid lg:grid-rows-subgrid",
    split: "hidden lg:block",
    stacked: "lg:hidden",
    vault: "lg:-ml-px",
  },
  xl: {
    grid: {
      even: "xl:grid-cols-2 xl:grid-rows-[repeat(var(--tv-rows),auto)]",
      aside: "xl:grid-cols-[minmax(0,1fr)_minmax(0,21rem)] xl:grid-rows-[repeat(var(--tv-rows),auto)]",
    },
    rows: "xl:[grid-row:span_var(--tv-rows)] xl:grid xl:grid-rows-subgrid",
    split: "hidden xl:block",
    stacked: "xl:hidden",
    vault: "xl:-ml-px",
  },
};

/** Each copy's padding. */
const PAD = "px-4 py-5 sm:px-6 md:py-6";

/**
 * The pair: a figure holding a VaultView (the carbon) and a PaperView (the original). `rows` is
 * how many rows each side has (both must have the same number), so the rows line up once split.
 * `even` halves the width; `aside` gives the carbon a 21rem column beside a paper document.
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
  /** Names the figure for screen readers: what the two copies are of. */
  caption: ReactNode;
  rows: number;
  split?: Split;
  columns?: "even" | "aside";
  /** The one orchestrated motion: the ink lifts off the original's values on load. */
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

/** The explorer's copy: canary paper, carbon ink, ink bars and the SHIELDED stamp. */
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
        "identity-vault carbon-paper relative order-2 flex min-w-0 flex-col border border-carbon-line text-carbon-ink shadow-[6px_6px_0_-1px_rgb(20_24_32_/_0.06)]",
        // The title keeps clear of the stamp.
        "[&>div:first-of-type]:pr-32 sm:[&>div:first-of-type]:pr-36",
        s.vault,
        s.rows,
        PAD,
        className,
      )}
    >
      <Stamp className="absolute top-4 right-4 origin-top-right scale-[0.8] sm:top-5 sm:right-5 sm:scale-90" />
      {children}
    </div>
  );
}

/** The key's copy: the white original, with the tear line above it while the copies are stacked. */
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
        "paper relative order-1 mb-10 flex min-w-0 flex-col border border-bar-line text-card-foreground",
        s.rows,
        split === "md" ? "md:mb-0" : split === "lg" ? "lg:mb-0" : "xl:mb-0",
        PAD,
        className,
      )}
    >
      {/* Stacked, the carbon is torn off below the original. */}
      <TearLine className={cn("absolute inset-x-0 -bottom-5", s.stacked)} />
      {children}
    </Tag>
  );
}

/** A copy's title, in the display face, and the one sentence under it. */
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
      <p id={id} className="inked font-display text-[1.25rem] leading-[1.15] font-bold">
        {title}
      </p>
      {children ? <p className="mt-1.5 text-[0.8125rem] leading-[1.45] text-ash">{children}</p> : null}
    </div>
  );
}

/**
 * The leader that runs from a transaction id to the edge of its copy, the way a printed form
 * joins a label to its value: a dotted rule. `weight` thin is a short fixed leader for a row.
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
  return (
    <span
      aria-hidden="true"
      data-thread=""
      className={cn(
        "tv-thread h-0 shrink-0 border-t-2 border-dotted border-tear",
        weight === "full" ? "min-w-4 flex-1" : "w-8",
        side === "vault" ? "ml-3" : "mr-2",
        s.split,
        className,
      )}
    />
  );
}

/**
 * A txid in two lines of 32, the way it reads best at 13px; 12px on a phone, where the feed edges
 * leave a line of typewriter just short of 32 characters at 13px.
 */
export function TxidLines({ txid }: { txid: string }) {
  return (
    <>
      <span className="block whitespace-nowrap max-sm:text-[0.75rem]">{txid.slice(0, 32)}</span>
      <span className="block whitespace-nowrap max-sm:text-[0.75rem]">{txid.slice(32)}</span>
    </>
  );
}

/** What both copies print alike: the block, and the moment it was mined (or a time of the key's own). */
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
    <dl className={cn("grid grid-cols-2 gap-4 pb-6 font-type text-[0.8125rem] leading-[1.45]", className)}>
      <div>
        <dt className="form-label text-[0.75rem] text-ash">Block</dt>
        <dd className="mt-0.5 tabular-nums">{height === null ? "Not yet mined" : formatHeight(height)}</dd>
      </div>
      <div>
        <dt className="form-label text-[0.75rem] text-ash">{timeLabel}</dt>
        <dd className="mt-0.5">{time ? formatDateTime(time) : "Not yet mined"}</dd>
      </div>
      {extra ? (
        <div>
          <dt className="form-label text-[0.75rem] text-ash">{extra.label}</dt>
          <dd className="mt-0.5">{extra.value}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/**
 * One labelled row of a copy: the same row on both, so they line up across the pair. On the
 * original every other row sits on the green bar; on the carbon they are ruled.
 */
export function ViewField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl className="-mx-2.5 grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-x-3 border-t border-hairline px-2.5 py-3.5 even:bg-bar xl:grid-cols-[6.5rem_minmax(0,1fr)]">
      <dt className="form-label text-[0.75rem] text-ash">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </dl>
  );
}

/**
 * An ink bar over a value the chain hides, the size of the value, never a blur. It says "Hidden
 * on chain" to screen readers unless `label` is null, for a row that says it once for all its bars.
 */
export function Redacted({ className, label = "Hidden on chain" }: { className?: string; label?: string | null }) {
  return (
    <span
      data-redact=""
      className={cn(
        "relative block max-w-full leading-[1.5] before:absolute before:inset-x-0 before:inset-y-[0.14em] before:rounded-[1px] before:bg-redact before:shadow-[0_0_0_1px_var(--redact-edge)] before:[filter:url(#ps-ink)] before:content-['']",
        className,
      )}
    >
      <span aria-hidden="true">{" "}</span>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

/** A value on the original: in the markup from the start, its ink lifted once in a `motion` pair. */
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
