"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { LucideProvider, Menu, X } from "lucide-react";
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
    <div className="flex h-full flex-col gap-3 px-2.5 py-3 text-[0.9375rem]">
      {/* In the phone menu the close button sits top right: keep the brand's chip clear of it. */}
      <div className={cn("px-1.5 pt-1", menu && "pr-10")}>{config.brand}</div>
      {/* The menu closes itself when the action navigates (see AppShell). */}
      {menu && config.menuAction ? <div className="px-1">{config.menuAction}</div> : null}
      {config.segments ? (
        <div
          className="grid grid-cols-2 rounded-lg bg-chip p-[3px] text-[0.8125rem]"
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
                "rounded-md py-1.5 text-center text-muted-foreground transition-colors hover:text-foreground pointer-coarse:py-2.5",
                s.active && "bg-background text-foreground shadow-[0_1px_2px_rgba(112,115,147,0.18)]",
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
                      "flex items-center gap-2.5 rounded-[7px] px-2 py-[7px] text-strong transition-colors hover:bg-muted hover:text-foreground pointer-coarse:py-2.5",
                      active && "bg-chip font-[450] text-foreground hover:bg-chip",
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
 * Mercury's app shell: a 220px sidebar on a barely tinted ground, a quiet top bar, and a centred
 * content column about 970px wide. On phones the sidebar slides in from a menu button.
 */
export function AppShell({ config, children }: { config: ShellConfig; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  useEffect(() => setOpen(false), [pathname]);
  return (
    // Mercury's icons are drawn thinner than Lucide's default 2px: 1.5 everywhere in the app.
    <LucideProvider strokeWidth={1.5}>
      <div className="grid min-h-[calc(100dvh-3rem)] md:grid-cols-[220px_minmax(0,1fr)] print:block">
        <div className="hidden border-r border-hairline bg-sidebar md:block" data-print="hide">
          <aside className="sticky top-0 h-[calc(100dvh-3rem)] overflow-y-auto">
            <SidebarBody config={config} />
          </aside>
        </div>
        <div className="min-w-0">
          <header
            role="banner"
            className="sticky top-0 z-30 flex h-[52px] items-center gap-3 border-b border-hairline bg-background/90 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-6"
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
                  className="fixed inset-y-0 left-0 z-50 w-[272px] max-w-[85vw] overflow-y-auto bg-sidebar shadow-xl outline-none data-open:animate-in data-open:slide-in-from-left data-closed:animate-out data-closed:slide-out-to-left"
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
            <div className="flex min-w-0 items-center gap-2 text-[0.9375rem] text-muted-foreground">
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
          <main id="main" className="mx-auto w-full max-w-[1018px] px-4 pt-7 pb-16 sm:px-6 lg:pt-8">
            {children}
          </main>
        </div>
      </div>
    </LucideProvider>
  );
}

/** The sidebar's top block: mark, name and a small chip (Mercury's org switcher with "Pro"). */
export function SidebarBrand({ name, chip, mark }: { name: ReactNode; chip?: ReactNode; mark?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 pb-1">
      {mark}
      <span className="min-w-0 truncate font-[450]">{name}</span>
      {chip ? (
        <span className="ml-auto rounded-md bg-foreground px-1.5 py-1 text-[11px] leading-none font-medium text-background">
          {chip}
        </span>
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
      className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-2.5 rounded-[7px] px-2 py-1.5 text-strong hover:bg-muted pointer-coarse:py-2.5"
    >
      <Icon className="mt-[3px] size-4 text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{label}</span>
      {detail ? <span className="col-start-2 text-[0.8125rem] text-muted-foreground">{detail}</span> : null}
    </Link>
  );
}
