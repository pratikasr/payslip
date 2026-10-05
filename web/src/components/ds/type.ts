/*
  The type scale: five sizes, as Mercury keeps to about four. Shared components (page titles,
  section headings, cards, figures, tags) use these, so pages inherit the scale without picking
  sizes themselves. Weights stay light: 380 for titles and big money, 400 for text, 450 for the
  one emphasised word.

    caption  13px  labels above values, table headers, sublines, tags, help text
    body     15px  text, table cells, buttons
    heading  19px  section headings and card figures
    title    28px  page titles and the figure a screen is about
    hero     34px  the hero amount (a run's total, the year paid)
*/
export const TYPE = {
  caption: "text-[0.8125rem]",
  body: "text-[0.9375rem]",
  heading: "text-[1.1875rem] tracking-[-0.01em]",
  title: "text-[1.75rem] leading-tight font-[380] tracking-[-0.015em]",
  hero: "text-[2.125rem] leading-none font-[380] tracking-[-0.02em]",
} as const;
