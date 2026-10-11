"use client";

import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { useFocusReturn } from "@/components/ui/dialog";
import { cn } from "cn";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;

/** Mercury's round grey icon at the top right of a card. Decorative unless it has a link. */
export function IconChip({ icon: Icon, href, label }: { icon: Icon; href?: string; label?: string }) {
  const body = <Icon className="size-4" aria-hidden="true" />;
  if (href && label) {
    return (
      <Link
        href={href}
        aria-label={label}
        title={label}
        className="relative grid size-[30px] place-items-center rounded-full bg-chip text-strong transition-colors hover:bg-[color-mix(in_oklch,var(--chip),var(--foreground)_6%)] pointer-coarse:after:absolute pointer-coarse:after:-inset-[7px] pointer-coarse:after:content-['']"
      >
        {body}
      </Link>
    );
  }
  return (
    <span aria-hidden="true" className="grid size-[30px] place-items-center rounded-full bg-chip text-strong">
      {body}
    </span>
  );
}

/** Three small figures in a row, label over value (Mercury's Bill Pay and Invoicing cards). */
export function MiniStats({
  items,
  className,
}: {
  items: { label: ReactNode; value: ReactNode }[];
  className?: string;
}) {
  return (
    <dl className={cn("mt-4 grid grid-cols-[repeat(3,minmax(0,auto))] justify-start gap-x-6 gap-y-1.5", className)}>
      {items.map((it, i) => (
        <div key={i} className="min-w-0">
          <dt className="text-[0.8125rem] text-muted-foreground">{it.label}</dt>
          <dd className="num mt-1 text-[0.9375rem]">{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A link beside a heading ("All runs", "Go to Books"): gold text on paper, underlined, no arrow. */
export function ArrowLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex shrink-0 items-center rounded-sm text-[0.9375rem] whitespace-nowrap text-link underline decoration-1 underline-offset-[3px] hover:decoration-2",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** A thin rounded progress bar on a Mist track: ink by default (gold stays for the primary action). */
export function Bar({
  value,
  label,
  tone = "gold",
  className,
}: {
  value: number;
  label: string;
  tone?: "gold" | "danger" | "muted";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn("h-1.5 overflow-hidden rounded-full bg-chip", className)}
    >
      <div
        className={cn(
          "h-full rounded-full",
          tone === "gold" && "bg-viz",
          tone === "danger" && "bg-destructive",
          tone === "muted" && "bg-faint/50",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/** Mercury's filter chips above a table: one selected, the rest outlined. */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { id: T; label: string; count?: number }[];
  value: T;
  onChange: (id: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="mb-1.5 flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            className={cn(
              "relative inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[0.8125rem] text-strong transition-colors hover:bg-muted pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-1.5 pointer-coarse:after:content-['']",
              on && "border-transparent bg-chip text-foreground hover:bg-chip",
            )}
          >
            {o.label}
            {o.count !== undefined && o.count > 0 ? (
              <span className="num text-[0.8125rem] text-muted-foreground">{o.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** The visible heading of a drawer, which also names it for screen readers (one heading, not two). */
export const DrawerTitle = DialogPrimitive.Title;

/**
 * Mercury's detail drawer: a panel that slides in from the right over the page, full width on
 * phones. Escape, the close button or a click outside closes it; focus returns to the row.
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  eyebrow,
  children,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The drawer's accessible name, or null when the body shows it in a <DrawerTitle>. */
  title: string | null;
  eyebrow?: ReactNode;
  children: ReactNode;
  /** Where focus goes on close when whatever opened the drawer is gone. */
  returnFocus?: () => HTMLElement | null;
}) {
  // Closing (Escape, Close, a click outside, the browser's Back) returns focus to the opener.
  const focus = useFocusReturn({
    fallback: returnFocus,
    onOpenAutoFocus: (e) => {
      // Focus the panel itself so a screen reader starts at the top, without a ring on Close.
      e.preventDefault();
      (e.currentTarget as HTMLElement).focus();
    },
  });
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/15 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          tabIndex={-1}
          onOpenAutoFocus={focus.onOpenAutoFocus}
          onCloseAutoFocus={focus.onCloseAutoFocus}
          className="fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l bg-card text-card-foreground shadow-[0_0_48px_-12px_rgba(14,14,45,0.25)] outline-none data-open:animate-in data-open:slide-in-from-right data-closed:animate-out data-closed:slide-out-to-right sm:inset-y-2 sm:right-2 sm:w-[440px] sm:rounded-xl sm:border"
        >
          <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-2 sm:px-6">
            <div className="min-w-0 truncate text-[0.8125rem] text-muted-foreground">{eyebrow}</div>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close" className="-mr-2">
                <X aria-hidden="true" />
              </Button>
            </DialogPrimitive.Close>
          </div>
          {title !== null ? <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title> : null}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 sm:px-6">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
