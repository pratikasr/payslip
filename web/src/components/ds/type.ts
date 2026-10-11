/*
  The app's type scale (docs/DESIGN.md section 17, pay advice on paper), set in rem so presenter
  mode scales it with everything else. Shared components (page titles, section headings, cards,
  figures, tags, forms) use these, so pages inherit the scale without picking sizes themselves.

    caption  13px  sublines, help text, table headers
    body     15px  text and table cells (Libre Franklin 400, line-height 1.55)
    heading  17px  section headings and dialog titles: Redaction, the clean cut, at 700
    title    34px  page titles and the company name: Redaction 35 at 700, inked; 26px on phones
    hero     48px  the headline money figure of a page: DotGothic16, inked; 34px below 1024px (a
                   figure inside keeps the dot matrix where the console types every other figure)
    data     13px  transaction ids, keys, heights, addresses, memos: Courier Prime
    label    12px  form labels: Courier Prime in spaced caps (the one place caps are allowed)

  Money and tables use tabular figures (.money and the base table rule in globals.css). The ink
  filter (.inked) is for display type and large amounts only; text and tables stay crisp.
*/
export const TYPE = {
  caption: "text-[0.8125rem]",
  body: "text-[0.9375rem]",
  heading: "font-serif text-[1.0625rem] leading-snug font-bold",
  title: "inked font-display text-[1.625rem] leading-[1.02] font-bold tracking-[-0.01em] sm:text-[2.125rem]",
  hero: "inked font-dot text-[2.125rem] leading-none font-normal tracking-[0.01em] lg:text-[3rem] [&_.money]:font-dot",
  data: "font-type text-[0.8125rem] tracking-normal",
  label: "form-label text-[0.75rem] leading-tight font-bold",
} as const;
