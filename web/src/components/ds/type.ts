/*
  The app's type scale (docs/DESIGN.md section 16): five sizes from the identity's scale, set in
  rem so presenter mode scales them with everything else. Shared components (page titles,
  section headings, cards, figures, tags) use these, so pages inherit the scale without picking
  sizes themselves.

    caption  13px  labels above values, table headers, sublines, tags, help text
    body     15px  text, table cells, buttons
    heading  17px  section headings, dialog titles and secondary figures (text face, 500)
    title    30px  page titles and the company name (display face); 22px on phones
    hero     44px  the headline money figure of a page (display face); 30px below 1024px

  Text is Instrument Sans; title and hero are Bricolage Grotesque, whose optical size axis gives
  the display cut at these sizes. Chain data (txids, keys, heights, addresses, memos) is IBM Plex
  Mono at caption size.
*/
export const TYPE = {
  caption: "text-[0.8125rem]",
  body: "text-[0.9375rem]",
  heading: "text-[1.0625rem] leading-snug font-medium tracking-[-0.005em]",
  title:
    "font-display text-[1.375rem] leading-[1.12] font-[600] tracking-[-0.012em] sm:text-[1.875rem] sm:leading-[1.08] sm:tracking-[-0.016em]",
  hero: "font-display text-[1.875rem] leading-none font-[560] tracking-[-0.02em] lg:text-[2.75rem]",
  data: "font-mono text-[0.8125rem] tracking-normal",
} as const;
