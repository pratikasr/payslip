import type { CSSProperties, ReactNode } from "react";
import { Scissors } from "lucide-react";
import { cn } from "cn";

/*
  Pay advice on paper (docs/DESIGN.md section 17). The pieces every screen builds a printed form
  from:

    Sheet       paper with its grain and continuous-form feed edges; an optional tear line
    TearLine    a dotted rule with scissors, where two parts of one form separate
    FormRows    rows of label and value, on green bar (the original) or ruled (the carbon)
    FormRow     one row: a spaced-caps label and a typewritten value
    PayAdvice   the white original: display title, the copy's label line, rows, the amount slot
    PayAmount   the one large amount, in dot matrix
    CarbonCopy  the yellow copy of the same form: hidden values as ink bars, public values in
                carbon ink, the SHIELDED stamp, and one sentence on what the copy shows
    TwoCopies   original and carbon side by side from 1024px, stacked below, the tear line between
    Redaction   one ink bar, sized to the value it hides
    Stamp       the red rubber stamp (decorative; the meaning is always in text too)

  The print effects (.inked, .carbon-print, .stamped) and the paper names are in globals.css.
*/

/**
 * A sheet of paper on the desk, with the tractor-feed margins down both sides (the signature of
 * every sheet; `feed={false}` for a dialog or a small card).
 */
export function Sheet({
  as: Tag = "div",
  feed = true,
  tear,
  shadow = true,
  className,
  children,
  ...rest
}: {
  as?: "div" | "section" | "article" | "main";
  feed?: boolean;
  /** Where the sheet was torn from the next part of the form. */
  tear?: "top" | "bottom";
  shadow?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag
      className={cn("paper relative text-card-foreground", shadow && "sheet-shadow", feed && "feed-edges", className)}
      {...rest}
    >
      {tear === "top" ? <TearLine className="absolute inset-x-0 top-0" /> : null}
      {children}
      {tear === "bottom" ? <TearLine className="absolute inset-x-0 bottom-0" /> : null}
    </Tag>
  );
}

/** Where two parts of one form separate: a dotted rule with a scissors mark at its start. */
export function TearLine({ className, vertical = false }: { className?: string; vertical?: boolean }) {
  return (
    <div
      aria-hidden="true"
      data-tear=""
      className={cn(
        "pointer-events-none relative flex items-center text-tear",
        vertical ? "h-full w-0 flex-col" : "h-0 w-full",
        className,
      )}
    >
      <span
        className={cn("border-tear", vertical ? "h-full border-l-2 border-dotted" : "w-full border-t-2 border-dotted")}
      />
      <Scissors
        strokeWidth={1.75}
        className={cn(
          "absolute size-[18px] bg-card",
          vertical
            ? "top-0 left-1/2 -translate-x-1/2 rotate-90 py-0.5"
            : "top-1/2 left-0 -translate-y-1/2 -rotate-90 px-0.5",
        )}
      />
    </div>
  );
}

/**
 * An ink bar over a value the chain hides: near-black with a rough edge, never a blur. `width`
 * sizes it to the hidden text (a CSS length, 13ch, 7em). It says "Hidden on chain" to screen
 * readers unless `label` is null, for a row that says it once for all its bars.
 */
export function Redaction({
  width,
  className,
  label = "Hidden on chain",
  style,
}: {
  width?: string;
  className?: string;
  label?: string | null;
  style?: CSSProperties;
}) {
  return (
    <span data-redact="" className={cn("redaction", className)} style={{ width, ...style }}>
      {label ? <span className="sr-only">{label}</span> : null}
    </span>
  );
}

/** The red rubber stamp. Decorative: whatever it says is said in text nearby. */
export function Stamp({ children = "Shielded", className }: { children?: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "stamped pointer-events-none inline-block -rotate-[7deg] border-[3px] border-stamp px-3 pt-[6px] pb-[4px] font-type text-[1rem] leading-none font-bold tracking-[0.16em] text-stamp uppercase opacity-90 mix-blend-multiply select-none dark:mix-blend-screen",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Rows of a printed form: green bar on the original, ruled in carbon line on the yellow copy. */
export function FormRows({
  tone = "bar",
  className,
  children,
  ...rest
}: {
  tone?: "bar" | "ruled" | "plain";
  className?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLDListElement>, "className" | "children">) {
  return (
    <dl
      className={cn(
        "font-type text-[0.875rem] leading-[1.5] sm:text-[0.9375rem]",
        tone === "bar" && "green-bar",
        tone === "ruled" && "[&>*+*]:border-t [&>*+*]:border-hairline",
        className,
      )}
      {...rest}
    >
      {children}
    </dl>
  );
}

/** One row of a form: the label in spaced caps on the left, the typewritten value on the right. */
export function FormRow({
  label,
  children,
  align = "end",
  className,
  valueClassName,
  ...rest
}: {
  label: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
  valueClassName?: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  return (
    <div
      className={cn("grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 px-2.5 py-[7px]", className)}
      {...rest}
    >
      <dt className="form-label text-[0.8125rem] whitespace-nowrap">{label}</dt>
      <dd className={cn("min-w-0", align === "end" ? "text-right" : "text-left", valueClassName)}>{children}</dd>
    </div>
  );
}

/** The amount slot of a pay advice: the one large figure, in dot matrix, inked. */
export function PayAmount({ children, sub, className }: { children: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn("px-2.5 pt-3.5 pb-3", className)}>
      <div className="inked font-dot text-[2.5rem] leading-none tracking-[0.02em] sm:text-[3.125rem]">{children}</div>
      {sub ? <div className="mt-2 font-type text-[0.8125rem] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

/** A form's title and the label of its copy ("Original: for the payee"). */
function FormHead({ id, title, label }: { id?: string; title: ReactNode; label?: ReactNode }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <p id={id} className="inked font-display text-[1.375rem] leading-[1.1] font-bold">
        {title}
      </p>
      {label ? <p className="form-label text-[0.75rem] text-muted-foreground">{label}</p> : null}
    </div>
  );
}

/** The white original of a pay advice: what the viewing key reads. */
export function PayAdvice({
  title = "Pay advice",
  titleId,
  label = "Original: for the payee",
  as: Tag = "div",
  className,
  children,
}: {
  title?: ReactNode;
  /** Names the copy for screen readers (role group, labelled by its title). */
  titleId?: string;
  label?: ReactNode;
  as?: "div" | "article";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      role={Tag === "div" && titleId ? "group" : undefined}
      aria-labelledby={titleId}
      className={cn("paper relative min-w-0 border border-bar-line px-4 pt-5 pb-5 sm:px-6", className)}
    >
      <FormHead id={titleId} title={title} label={label} />
      {children}
    </Tag>
  );
}

/** The yellow carbon copy of the same form: what the public explorer shows. */
export function CarbonCopy({
  title = "What the explorer sees",
  titleId,
  stamp = true,
  note,
  foot,
  className,
  children,
}: {
  title?: ReactNode;
  titleId?: string;
  stamp?: boolean;
  /** One sentence in the text face: what this copy shows, and what it does not. */
  note?: ReactNode;
  /** After the note: a link to the copy's own check, say. */
  foot?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={titleId ? "group" : undefined}
      aria-labelledby={titleId}
      className={cn(
        "identity-vault carbon-paper relative min-w-0 border border-carbon-line px-4 pt-5 pb-5 text-carbon-ink shadow-[6px_6px_0_-1px_rgb(20_24_32_/_0.06)] sm:px-6",
        className,
      )}
    >
      {stamp ? <Stamp className="absolute top-3.5 right-4 sm:top-4 sm:right-5" /> : null}
      {/* The title keeps clear of the stamp. */}
      <div className={cn(stamp && "pr-28 sm:pr-36")}>
        <FormHead id={titleId} title={title} />
      </div>
      {children}
      {note ? (
        <p className="mx-2.5 mt-3.5 max-w-[46ch] text-[0.8125rem] leading-[1.5] text-carbon-soft">{note}</p>
      ) : null}
      {foot}
    </div>
  );
}

/**
 * The pair: the white original and its yellow carbon, side by side from 1024px with the carbon
 * a hair over the original's edge; stacked below, the original first and a tear line between.
 * A figure, named by `caption` for screen readers. `motion` lifts the ink off the original's
 * private values once, on load (globals.css, tv-*).
 */
export function TwoCopies({
  caption,
  original,
  carbon,
  motion = false,
  id,
  className,
}: {
  caption: ReactNode;
  original: ReactNode;
  carbon: ReactNode;
  motion?: boolean;
  id?: string;
  className?: string;
}) {
  const captionId = `${id ?? "two-copies"}-caption`;
  return (
    <figure
      id={id}
      aria-labelledby={captionId}
      className={cn("relative grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.08fr)]", motion && "tv-motion", className)}
    >
      <figcaption id={captionId} className="sr-only">
        {caption}
      </figcaption>
      {original}
      <TearLine className="my-5 lg:hidden" />
      <div className="min-w-0 lg:-ml-px">{carbon}</div>
    </figure>
  );
}

/** A value on the original, in the markup from the start, its ink lifted once in a `motion` pair. */
export function Inked({ delay, className, children }: { delay: number; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn("tv-reveal inline-block max-w-full", className)}
      style={{ "--tv-delay": `${delay}ms` } as CSSProperties}
    >
      <span className="tv-value">{children}</span>
    </span>
  );
}
