"use client";

import { useId, useState, type ReactNode } from "react";
import { cn } from "cn";
import { lp } from "@/components/marketing/classes";

export interface ProductItem {
  title: string;
  body: ReactNode;
  vignette: ReactNode;
}

/**
 * Mercury's product accordion: one item open at a time, each swapping the card on the right.
 * Opening an item closes the others; activating the open item closes it. On phones the card
 * sits inside the open item instead, as Mercury does. The first item is open on the server, so
 * the section reads the same before hydration.
 */
export function ProductAccordion({
  heading,
  items,
  footer,
}: {
  heading: ReactNode;
  items: ProductItem[];
  footer?: ReactNode;
}) {
  const [open, setOpen] = useState<number | null>(0);
  const [shown, setShown] = useState(0);
  const base = useId();

  const toggle = (i: number) => {
    if (open === i) {
      setOpen(null);
      return;
    }
    setOpen(i);
    setShown(i);
  };

  return (
    <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)] lg:gap-16">
      <div className="min-w-0">
        {heading}
        <div className="mt-8 border-t border-white/80">
          {items.map((item, i) => {
            const isOpen = open === i;
            const buttonId = `${base}-b${i}`;
            const panelId = `${base}-p${i}`;
            return (
              <div key={item.title} className="border-b border-white/[0.12]" data-item="">
                <h3>
                  <button
                    id={buttonId}
                    type="button"
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() => toggle(i)}
                    className={cn(
                      "relative flex w-full items-center rounded-sm py-[15px] text-left text-[15.5px] transition-colors",
                      isOpen ? "text-[#f4f5f9]" : "text-[#c3c3cc] hover:text-[#f4f5f9]",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute top-1/2 -left-3.5 size-1.5 -translate-y-1/2 rounded-full bg-primary transition-opacity sm:-left-4",
                        isOpen ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {item.title}
                  </button>
                </h3>
                <div
                  id={panelId}
                  role="region"
                  aria-labelledby={buttonId}
                  className={lp.panel}
                  data-open={isOpen ? "" : undefined}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="pb-5">
                      <div className="max-w-[30rem] text-[14.5px] leading-[1.6] text-[#c3c3cc]">{item.body}</div>
                      <div className="mt-6 lg:hidden">{item.vignette}</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {footer}
      </div>

      <div className="relative hidden min-w-0 lg:-mt-7 lg:block">
        <div className={cn(lp.plate, "rounded-[22px] border border-white/[0.06] p-7 pb-12")}>
          <div className="grid">
            {items.map((item, i) => (
              <div key={item.title} className={lp.slide} data-active={shown === i ? "" : undefined}>
                {item.vignette}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
