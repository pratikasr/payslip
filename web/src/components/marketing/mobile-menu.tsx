"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { DemoLink } from "@/components/marketing/demo-link";

export interface NavLink {
  href: string;
  label: string;
  external?: boolean;
}

/**
 * The phone menu (below 768px): a button that drops a glass panel under the bar with the page's
 * sections and both calls to action. Escape, a tap outside or choosing a link closes it, and
 * focus returns to the button on Escape.
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
    const wide = window.matchMedia("(min-width: 768px)");
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
    <div ref={root} className="md:hidden">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="inline-grid size-10 place-items-center rounded-full text-[#ededf3] transition-colors hover:bg-white/10"
      >
        {open ? <X className="size-5" aria-hidden="true" /> : <Menu className="size-5" aria-hidden="true" />}
        <span className="sr-only">Menu</span>
      </button>

      <div
        id={panelId}
        hidden={!open}
        className="absolute inset-x-3 top-[64px] z-40 rounded-2xl border border-white/10 bg-[rgba(23,23,33,0.94)] p-2 text-[#ededf3] shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7)] backdrop-blur-xl"
      >
        <nav aria-label="Main">
          <ul>
            {links.map((l) => (
              <li key={l.href}>
                {l.external ? (
                  <a
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={close}
                    className="flex h-12 items-center justify-between rounded-xl px-4 text-[17px] hover:bg-white/[0.06]"
                  >
                    {l.label}
                    <ArrowUpRight className="size-4 text-[#a6a6b2]" aria-hidden="true" />
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <a
                    href={l.href}
                    onClick={close}
                    className="flex h-12 items-center rounded-xl px-4 text-[17px] hover:bg-white/[0.06]"
                  >
                    {l.label}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <div className="mt-2 grid gap-2 border-t border-white/10 p-2 pt-4">
          <DemoLink
            onClick={close}
            className="inline-flex h-11 items-center justify-center rounded-full bg-primary text-[15px] font-medium text-primary-foreground"
          />
          <Link
            href="/verify"
            onClick={close}
            className="inline-flex h-11 items-center justify-center rounded-full border border-white/20 text-[15px] text-[#ededf3] hover:bg-white/10"
          >
            Check a payslip
          </Link>
        </div>
      </div>
    </div>
  );
}
