/*
  The landing page's type scale and shared class names (docs/DESIGN.md section 16): 13, 15, 17,
  22, 30, 44 and 64px at 1440, the two largest steps one step smaller from 768px and two below it.
  Display is Bricolage Grotesque (font-display), text is Instrument Sans (font-text), chain data
  is IBM Plex Mono (font-mono). Colours are the identity tokens in globals.css (.identity).
*/
export const t = {
  h1: "font-display text-[30px] leading-[1.06] font-[620] tracking-[-0.018em] text-balance md:text-[44px] md:leading-[1.02] xl:text-[64px] xl:leading-[0.98]",
  h2: "font-display text-[22px] leading-[1.12] font-[580] tracking-[-0.012em] text-balance md:text-[30px] xl:text-[44px] xl:leading-[1.04]",
  /** A large figure on its own: the hero amount, a person's figure, a price. */
  figure44: "font-display text-[30px] leading-none font-[560] tracking-[-0.02em] xl:text-[44px]",
  h3: "font-display text-[22px] leading-[1.18] font-[560] tracking-[-0.008em]",
  lead: "text-[17px] leading-[1.55] text-ash",
  body: "text-[15px] leading-[1.6]",
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

/** Landing-only CSS classes (landing-styles.tsx). */
export const lp = {
  reveal: "lp-reveal",
  thread: "lp-thread",
  threadPaper: "lp-thread-paper",
  dot: "lp-dot",
  dotPaper: "lp-dot-paper",
} as const;
