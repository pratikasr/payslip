import type { ReactNode } from "react";
import { Stamp } from "@/components/ds/paper";
import { cn } from "cn";

/*
  Printed-form pieces the contractor portal, Books and the public proof share (docs/DESIGN.md
  section 17, pay advice on paper). The shared forms themselves (Sheet, PayAdvice, CarbonCopy,
  FormRows) are in components/ds/paper.tsx; these are the smaller marks a filled-in form carries:

    StatusStamp   a small rubber stamp that says a status in words (Sent, Paid, Reconciled)
    MarkStamp     the large decorative stamp across a form (VERIFIED ON ZCASH, NOT FOUND)
    TypedBox      the square a typewriter puts an X in
    TypedOption   one choice of a form, a box and its typed words (a radio or a checkbox)
    FormBox       a ruled form: a display title, the form's label line, its body
    FormHead      a form's title and label line alone
    LEDGER        class names for a typewritten ledger table on green bar
    DOT           the dot-matrix face for a figure, inked

  Server-safe: no hooks, so the not-found pages can use them too.
*/

export type StampTone = "ink" | "red" | "soft";

const STAMP_TONE: Record<StampTone, string> = {
  ink: "border-foreground text-foreground",
  red: "border-stamp text-stamp",
  soft: "border-muted-foreground text-muted-foreground",
};

/**
 * A status in a small rubber stamp: typewriter caps in a 2px box, tilted a little, its ink
 * slightly rough. The word is real text (screen readers read it); `title` says what it means.
 * Ink for a settled state, the stamp's red for one that needs a person, soft ink while waiting.
 */
export function StatusStamp({
  children,
  tone = "ink",
  title,
  tilt = "left",
  className,
}: {
  children: ReactNode;
  tone?: StampTone;
  title?: string;
  tilt?: "left" | "right" | "none";
  className?: string;
}) {
  return (
    <span
      title={title}
      data-stamp=""
      className={cn(
        "inked inline-block border-2 px-1.5 pt-[4px] pb-[3px] font-type text-[0.6875rem] leading-none font-bold tracking-[0.12em] whitespace-nowrap uppercase",
        tilt === "left" ? "-rotate-2" : tilt === "right" ? "rotate-[1.5deg]" : "",
        STAMP_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * The large stamp across a form. Decorative (the same words are always written beside it), so
 * its words come from CSS and are not part of the page's text: a test or a screen reader that
 * looks for "Verified on Zcash" finds the sentence, not the stamp.
 */
export function MarkStamp({ text, tone = "red", className }: { text: string; tone?: StampTone; className?: string }) {
  return (
    <Stamp className={cn(STAMP_TONE[tone], className)}>
      <span data-text={text} className="before:content-[attr(data-text)]" />
    </Stamp>
  );
}

/** The square a typewriter puts an X in: a 1.5px ink box, typed X when `checked`. */
export function TypedBox({ checked, className }: { checked?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid size-[18px] shrink-0 place-items-center border-[1.5px] border-current font-type text-[0.875rem] leading-none font-bold",
        className,
      )}
    >
      {checked ? "X" : null}
    </span>
  );
}

/**
 * One choice on a form, typed beside its box: a native radio or checkbox (hidden, so the
 * keyboard and screen readers get the real control) with the box drawn as a form's square.
 */
export function TypedOption({
  type = "radio",
  name,
  checked,
  onChange,
  children,
  hint,
  className,
  id,
}: {
  type?: "radio" | "checkbox";
  name?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  hint?: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <label className={cn("group/opt relative flex cursor-pointer items-start gap-2.5 font-type", className)}>
      {/* The real control sits, invisible, over the drawn box, so a click lands on it. */}
      <input
        id={id}
        type={type}
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer absolute top-[1px] left-0 m-0 size-[18px] cursor-pointer opacity-0"
      />
      <TypedBox
        checked={checked}
        className="mt-[1px] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring peer-focus-visible:outline-solid"
      />
      <span className="min-w-0">
        <span className="block text-[0.9375rem] leading-[1.35]">{children}</span>
        {hint ? <span className="mt-0.5 block font-sans text-[0.8125rem] text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

/** A form's title in the display face, inked, and its label line in spaced caps on the right. */
export function FormHead({
  title,
  label,
  id,
  as: Tag = "h2",
  className,
}: {
  title: ReactNode;
  label?: ReactNode;
  id?: string;
  as?: "h1" | "h2" | "h3" | "p";
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1", className)}>
      <Tag id={id} className="inked font-display text-[1.375rem] leading-[1.1] font-bold">
        {title}
      </Tag>
      {label ? <p className="form-label text-[0.75rem] text-muted-foreground">{label}</p> : null}
    </div>
  );
}

/**
 * A printed form on the sheet: a 2px ink rule round it, its title and label line, its body. For
 * the forms a person fills in or reads as one piece (a request, a statement, a ledger card).
 */
export function FormBox({
  title,
  label,
  titleId,
  titleAs,
  as: Tag = "section",
  className,
  bodyClassName,
  children,
  ...rest
}: {
  title?: ReactNode;
  label?: ReactNode;
  titleId?: string;
  titleAs?: "h1" | "h2" | "h3" | "p";
  as?: "section" | "div" | "article" | "form";
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children" | "title">) {
  return (
    <Tag
      aria-labelledby={title && titleId ? titleId : undefined}
      className={cn("paper min-w-0 border-2 border-foreground", className)}
      {...rest}
    >
      {title ? (
        <FormHead
          title={title}
          label={label}
          id={titleId}
          as={titleAs}
          className="border-b border-foreground px-4 pt-4 pb-3 sm:px-5"
        />
      ) : null}
      <div className={cn("px-4 py-4 sm:px-5", bodyClassName)}>{children}</div>
    </Tag>
  );
}

/**
 * A typewritten ledger on green bar: a header ruled in ink above and below, spaced-caps column
 * names, rows ruled in the bar's line. The base layer sets the face, the caps and the bar itself.
 */
export const LEDGER = {
  table: "w-full border-collapse border-b-2 border-foreground text-[0.875rem] sm:text-[0.9375rem]",
  headRow: "border-y-2 border-foreground",
  th: "h-10 px-2.5 py-2 text-left align-bottom text-[0.75rem] font-bold whitespace-nowrap",
  row: "border-b border-bar-line",
  td: "px-2.5 py-2.5 align-top",
  sub: "mt-0.5 block text-[0.8125rem] text-muted-foreground",
} as const;

/** The dot-matrix face for a figure, inked: totals and the large amounts. */
export const DOT = "inked font-dot leading-none tracking-[0.02em]";

/**
 * A typed notice on the sheet, the way an office answers a letter it cannot place: a ruled
 * "Notice" head, the title in the display face with a NOT FOUND stamp beside it, the body typed,
 * then the ways on. Server-safe, for the not-found pages.
 */
export function TypedNotice({
  title,
  reference,
  children,
  actions,
  className,
}: {
  title: ReactNode;
  /** The notice's label line on the right, in spaced caps. */
  reference?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("max-w-[640px]", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-2 border-foreground pb-2">
        <p className="form-label text-[0.75rem] font-bold">Notice</p>
        {reference ? <p className="form-label text-[0.75rem] text-muted-foreground">{reference}</p> : null}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 pt-7">
        <h1 className="inked font-display text-[1.625rem] leading-[1.02] font-bold tracking-[-0.01em] sm:text-[2.125rem]">
          {title}
        </h1>
        <MarkStamp text="Not found" className="mt-1 mr-2" />
      </div>
      <div className="mt-5 max-w-[54ch] font-type text-[0.9375rem] leading-[1.7]">{children}</div>
      {actions ? (
        <div className="mt-8 flex flex-wrap gap-2 border-t border-dotted border-tear pt-5">{actions}</div>
      ) : null}
    </div>
  );
}
