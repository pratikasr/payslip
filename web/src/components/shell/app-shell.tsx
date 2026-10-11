"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { PrivacyToggle } from "@/components/shell/privacy-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

export interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>;
  /** A count or short badge shown at the right of the item. */
  badge?: ReactNode;
  /** Match only this exact path (for a section's home). */
  exact?: boolean;
}

export interface Segment {
  label: string;
  href: string;
  active: boolean;
}

export interface ShellConfig {
  /** The block at the top of the sidebar: product or person name. */
  brand: ReactNode;
  /** Mercury's two-way switch under the brand ("Payroll | Books"). */
  segments?: Segment[];
  /** Navigation groups, separated by a hairline. */
  nav: NavItem[][];
  /** Pinned items under the nav (Mercury's Bookmarks). */
  bookmarks?: ReactNode;
  /** Bottom of the sidebar. */
  footer?: ReactNode;
  /** Left side of the top bar (context, search or a status pill). */
  topLeft?: ReactNode;
  /** Right side of the top bar, before the privacy and theme toggles. */
  topActions?: ReactNode;
  /** The main action, at the top of the phone menu (the top bar has no room for it there). */
  menuAction?: ReactNode;
}

function isActive(pathname: string, item: NavItem): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

function SidebarBody({
  config,
  onNavigate,
  menu,
}: {
  config: ShellConfig;
  onNavigate?: () => void;
  /** True in the phone menu, which also carries the main action. */
  menu?: boolean;
}) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col gap-3 px-2.5 py-3 font-type text-[0.875rem]">
      {/* In the phone menu the close button sits top right: keep the brand's chip clear of it. */}
      <div className={cn("px-1.5 pt-1", menu && "pr-10")}>{config.brand}</div>
      {/* The menu closes itself when the action navigates (see AppShell). */}
      {menu && config.menuAction ? <div className="px-1">{config.menuAction}</div> : null}
      {config.segments ? (
        <div
          className="grid grid-cols-2 border-2 border-foreground text-[0.8125rem]"
          role="navigation"
          aria-label="Product"
        >
          {config.segments.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              onClick={onNavigate}
              aria-current={s.active ? "page" : undefined}
              className={cn(
                "py-1.5 text-center font-bold text-foreground transition-colors hover:bg-card pointer-coarse:py-2.5",
                s.active && "bg-foreground text-background hover:bg-foreground",
              )}
            >
              {s.label}
            </Link>
          ))}
        </div>
      ) : null}
      <nav aria-label="Main" className="grid gap-2">
        {config.nav.map((group, gi) => (
          <ul key={gi} className={cn("grid gap-0.5", gi > 0 && "border-t border-hairline pt-2")}>
            {group.map((item) => {
              const active = isActive(pathname, item);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-2.5 px-2 py-[7px] text-strong transition-colors hover:bg-card/60 hover:text-foreground pointer-coarse:py-2.5",
                      // The active item is a sheet pulled from the stack: paper, ink, a 2px ink edge.
                      active &&
                        "paper font-bold text-foreground shadow-[inset_2px_0_0_var(--foreground),0_1px_1px_rgb(20_24_32_/_0.08)] hover:bg-card",
                    )}
                  >
                    <item.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                    {item.badge !== undefined ? (
                      <span className="ml-auto text-[0.8125rem] text-muted-foreground">{item.badge}</span>
                    ) : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}
      </nav>
      {config.bookmarks ? <div className="border-t border-hairline pt-2">{config.bookmarks}</div> : null}
      {config.footer ? <div className="mt-auto">{config.footer}</div> : null}
    </div>
  );
}

/**
 * The app shell (docs/DESIGN.md section 17): a 220px sidebar on the desk with typewriter
 * navigation, and the content on one sheet of paper beside it, with a quiet top bar and a centred
 * column about 970px wide. On phones the sidebar slides in from a menu button.
 */
export function AppShell({ config, children }: { config: ShellConfig; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    // Icons are drawn at stroke 1.5 everywhere (LucideProvider in the root layout).
    <>
      <div className="grid min-h-[calc(100dvh-3rem)] md:grid-cols-[220px_minmax(0,1fr)] print:block">
        <div className="hidden bg-sidebar md:block" data-print="hide">
          <aside className="sticky top-0 h-[calc(100dvh-3rem)] overflow-y-auto">
            <SidebarBody config={config} />
          </aside>
        </div>
        {/* The content is one sheet of continuous-form paper on the desk, feed holes down both sides. */}
        <div className="paper sheet-shadow feed-edges min-w-0 print:bg-none print:shadow-none">
          <header
            role="banner"
            className="paper sticky top-0 z-30 flex h-[52px] items-center gap-3 border-b border-hairline px-2.5 sm:px-6"
            data-print="hide"
          >
            <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
              <DialogPrimitive.Trigger asChild>
                <Button variant="secondary" size="icon-sm" className="md:hidden" aria-label="Open menu">
                  <Menu aria-hidden="true" />
                </Button>
              </DialogPrimitive.Trigger>
              <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
                <DialogPrimitive.Content
                  className="fixed inset-y-0 left-0 z-50 w-[272px] max-w-[85vw] overflow-y-auto border-r border-ink bg-sidebar outline-none data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left"
                  aria-describedby={undefined}
                >
                  <DialogPrimitive.Title className="sr-only">Menu</DialogPrimitive.Title>
                  <DialogPrimitive.Close asChild>
                    <Button variant="ghost" size="icon-sm" className="absolute top-3 right-3" aria-label="Close menu">
                      <X aria-hidden="true" />
                    </Button>
                  </DialogPrimitive.Close>
                  <SidebarBody config={config} onNavigate={() => setOpen(false)} menu />
                </DialogPrimitive.Content>
              </DialogPrimitive.Portal>
            </DialogPrimitive.Root>
            <div className="flex min-w-0 items-center gap-2 font-type text-[0.875rem] text-muted-foreground">
              {config.topLeft}
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              {config.topActions}
              <PrivacyToggle />
              <span data-secondary="">
                <ThemeToggle />
              </span>
            </div>
          </header>
          <main id="main" className="mx-auto w-full max-w-[1018px] px-2.5 pt-7 pb-16 sm:px-6 lg:pt-8">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}

/**
 * The sidebar's top block: the mark and the name in the display face on one line (never wrapped;
 * a long name is cut with an ellipsis and its full text in the tooltip), then the network chip
 * and any `sub` tags typed on the line under it (the "Sample data" tag on testnet).
 */
export function SidebarBrand({
  name,
  chip,
  mark,
  sub,
}: {
  name: ReactNode;
  chip?: ReactNode;
  mark?: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <div className="grid gap-y-2 pb-1">
      <div className="flex min-w-0 items-center gap-2">
        {mark}
        <span
          className="inked min-w-0 truncate font-display text-[1.0625rem] leading-tight font-bold whitespace-nowrap"
          title={typeof name === "string" ? name : undefined}
        >
          {name}
        </span>
      </div>
      {chip || sub ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {chip ? (
            <span className="inline-flex h-5 items-center bg-foreground px-1.5 font-type text-[0.75rem] leading-none font-bold tracking-[0.08em] text-background uppercase">
              {chip}
            </span>
          ) : null}
          {sub}
        </div>
      ) : null}
    </div>
  );
}

/** A pinned item in the sidebar with a small figure under its name. */
export function Bookmark({
  href,
  icon: Icon,
  label,
  detail,
}: {
  href: string;
  icon: NavItem["icon"];
  label: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 px-2 py-1.5 text-strong hover:bg-card/60 pointer-coarse:py-2.5"
    >
      <Icon className="mt-[3px] size-4 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{label}</span>
      {detail ? <span className="col-start-2 text-[0.8125rem] text-muted-foreground">{detail}</span> : null}
    </Link>
  );
}
