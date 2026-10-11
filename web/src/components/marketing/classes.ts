/*
  The landing page's type and shared class names (docs/DESIGN.md section 17, pay advice on
  paper). Display is Redaction 35 at 700 with the ink filter (.inked); the dot matrix
  (DotGothic16) sets the figures; Courier Prime is the typewriter for navigation, buttons, form
  labels and chain data; Libre Franklin is the text. Colours are the paper tokens in globals.css.
*/
export const t = {
  h1: "inked font-display text-[2.75rem] leading-[0.98] font-bold tracking-[-0.012em] sm:text-[3.5rem] lg:text-[4.25rem] xl:text-[5rem] xl:leading-[0.96]",
  h2: "inked font-display text-[2rem] leading-[1.02] font-bold tracking-[-0.01em] text-balance md:text-[2.75rem]",
  h3: "inked font-display text-[1.375rem] leading-[1.1] font-bold",
  /** A large figure on its own, in dot matrix: a person's figure, a price. */
  figure: "inked font-dot text-[2.25rem] leading-none tracking-[0.02em] md:text-[2.75rem]",
  lead: "text-[1.0625rem] leading-[1.6] text-ash md:text-[1.125rem]",
  body: "text-[0.9375rem] leading-[1.6]",
  small: "text-[0.8125rem] leading-[1.5]",
  data: "font-type text-[0.8125rem] leading-[1.5] tracking-normal",
  /** A form label: Courier Prime in spaced caps. */
  label: "form-label text-[0.75rem] leading-tight font-bold",
} as const;

/** The primary key: ink-filled, white typewriter text, square, 2px ink border. */
export const inkButton =
  "inline-flex h-11 items-center justify-center border-2 border-ink bg-ink px-[18px] font-type text-[0.875rem] font-bold text-paper transition-colors hover:border-ink-soft hover:bg-ink-soft";

/** The secondary key: the same, outlined. */
export const ghostButton =
  "inline-flex h-11 items-center justify-center border-2 border-ink bg-transparent px-[18px] font-type text-[0.875rem] font-bold text-ink transition-colors hover:bg-muted";

/** A text link in running copy: ink, a quiet underline that darkens on hover. */
export const textLink =
  "text-ink underline decoration-ink/40 decoration-1 underline-offset-[3px] transition-colors hover:decoration-ink";
