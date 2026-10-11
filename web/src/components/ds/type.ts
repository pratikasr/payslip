/*
  The app's type scale (docs/DESIGN.md section 16): five sizes, set in rem so presenter mode scales
  them with everything else. Shared components (page titles, section headings, cards, figures,
  tags) use these, so pages inherit the scale without picking sizes themselves.

    caption  13px  labels above values, table headers, sublines, tags, help text
    body     15px  text, table cells, buttons (400, line-height 1.55)
    heading  17px  section headings, dialog titles and secondary figures (500)
    title    30px  page titles and the company name; 22px on phones
    hero     44px  the headline money figure of a page; 30px below 1024px

  One family, Geist, for display and text; Geist Mono for chain data (txids, keys, heights,
  addresses, memos) at caption size. Headlines (title and hero) are Geist 600 at line-height 1.05,
  tracked -0.02em from 22 to 30px and -0.035em from 44px up. Money and tables use tabular figures
  (.money and the base table rule in globals.css).
*/
export const TYPE = {
  caption: "text-[0.8125rem]",
  body: "text-[0.9375rem]",
  heading: "text-[1.0625rem] leading-snug font-medium tracking-[-0.005em]",
  title: "font-display text-[1.375rem] leading-[1.05] font-semibold tracking-[-0.02em] sm:text-[1.875rem]",
  hero: "font-display text-[1.875rem] leading-[1.05] font-semibold tracking-[-0.02em] lg:text-[2.75rem] lg:tracking-[-0.035em]",
  data: "font-mono text-[0.8125rem] tracking-normal",
} as const;
