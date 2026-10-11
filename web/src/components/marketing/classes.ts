/*
  The landing page's type scale and shared class names (docs/DESIGN.md section 16): 13, 15, 17,
  22, 30, 44 and 64px at 1440, the two largest steps one step smaller from 768px and two below it.
  Display and text are Geist (font-display, font-text), chain data is Geist Mono (font-mono).
  Headlines are Geist 600 at line-height 1.05, tracked -0.02em from 22 to 30px and -0.035em from
  44px up; body is 400 at 15 to 17px, line-height 1.55. Colours are the identity tokens in
  globals.css.
*/
export const t = {
  h1: "font-display text-[30px] leading-[1.05] font-semibold tracking-[-0.02em] text-balance md:text-[44px] md:tracking-[-0.035em] xl:text-[64px]",
  h2: "font-display text-[22px] leading-[1.05] font-semibold tracking-[-0.02em] text-balance md:text-[30px] xl:text-[44px] xl:tracking-[-0.035em]",
  /** A large figure on its own: the hero amount, a person's figure, a price. */
  figure44:
    "font-display text-[30px] leading-[1.05] font-semibold tracking-[-0.02em] xl:text-[44px] xl:tracking-[-0.035em]",
  h3: "font-display text-[22px] leading-[1.05] font-semibold tracking-[-0.02em]",
  lead: "text-[17px] leading-[1.55] text-ash",
  body: "text-[15px] leading-[1.55]",
  small: "text-[13px] leading-[1.5]",
  data: "font-mono text-[13px] leading-[1.5] tracking-normal",
} as const;

/** The one gold action per view. */
export const goldPill =
  "inline-flex h-11 items-center justify-center rounded-full bg-gold px-6 text-[15px] font-medium text-on-gold transition-[filter] hover:brightness-[0.94]";

/** A quieter pill for the header, where the hero's gold action is already on screen. */
export const quietPill =
  "inline-flex h-9 items-center justify-center rounded-full border border-ink/20 px-4 text-[15px] font-medium text-ink transition-colors hover:border-ink/50";

/** A text link in running copy: ink, a quiet underline that darkens on hover. */
export const textLink =
  "rounded-[3px] text-ink underline decoration-ash/50 decoration-1 underline-offset-[3px] transition-colors hover:decoration-ink";
