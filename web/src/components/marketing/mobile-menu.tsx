"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { cn } from "cn";
import { DemoLink } from "@/components/marketing/demo-link";
import { goldPill } from "@/components/marketing/classes";

export interface NavLink {
  href: string;
  label: string;
  external?: boolean;
}

/**
 * The menu below 1024px: a button that drops a panel under the bar with the page's sections and
 * the demo. Escape, a tap outside or choosing a link closes it, and focus returns to the button
 * on Escape.
 */
export function MobileMenu({ links }: { links: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const wide = window.matchMedia("(min-width: 1024px)");
    const onWide = () => {
      if (wide.matches) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={root} className="lg:hidden">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="-mr-2 inline-grid size-11 place-items-center rounded-full text-ink transition-colors hover:bg-mist"
      >
        {open ? (
          <X className="size-5" strokeWidth={1.5} aria-hidden="true" />
        ) : (
          <Menu className="size-5" strokeWidth={1.5} aria-hidden="true" />
        )}
        <span className="sr-only">Menu</span>
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-16 z-40 border-b border-mist bg-paper px-4 pt-2 pb-5 md:px-8"
      >
        <nav aria-label="Main">
          <ul>
            {links.map((l) => (
              <li key={l.href} className="border-b border-mist">
                <a
                  href={l.href}
                  onClick={close}
                  {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
                  className="flex h-13 items-center rounded-[3px] text-[17px] text-ink"
                >
                  {l.label}
                  {l.external ? <span className="sr-only"> (opens in a new tab)</span> : null}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <DemoLink onClick={close} className={cn(goldPill, "mt-5 w-full sm:w-auto")} />
      </div>
    </div>
  );
}
