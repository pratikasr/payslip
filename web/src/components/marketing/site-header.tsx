import Link from "next/link";
import { LogoMark } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { GITHUB_URL } from "@/components/marketing/data";
import { DemoLink } from "@/components/marketing/demo-link";
import { MobileMenu, type NavLink } from "@/components/marketing/mobile-menu";

const LINKS: NavLink[] = [
  { href: "#product", label: "Product" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#security", label: "Security" },
  { href: "#pricing", label: "Pricing" },
  { href: GITHUB_URL, label: "GitHub", external: true },
];

/**
 * Mercury's bar: the letter-spaced wordmark, centred links, one gold pill. It sits on the hero. On
 * phones it stays at the top as a dark glass bar, so the menu is never out of reach.
 */
export function SiteHeader() {
  return (
    <header className="dark fixed inset-x-0 top-0 z-30 text-[#ededf3] max-md:border-b max-md:border-white/[0.06] max-md:bg-[rgba(23,23,33,0.82)] max-md:backdrop-blur-md md:absolute">
      <div className="mx-auto flex h-16 max-w-[90rem] items-center gap-4 px-4 sm:h-[72px] sm:px-7">
        <Link
          href="/"
          className="inline-flex items-center gap-2.5 rounded-md text-[15px] leading-none font-medium tracking-[0.22em] uppercase"
        >
          <LogoMark className="size-[26px] text-[#ededf3]" />
          Payslip
        </Link>

        <nav aria-label="Main" className="mx-auto hidden md:block">
          <ul className="flex items-center gap-5 text-[15px] text-[#d7d6e2] lg:gap-7">
            {LINKS.map((l) => (
              <li key={l.href}>
                {l.external ? (
                  <a
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-sm transition-colors hover:text-white"
                  >
                    {l.label}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <a href={l.href} className="rounded-sm transition-colors hover:text-white">
                    {l.label}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <Button asChild className="hidden h-9 px-[18px] text-[15px] sm:inline-flex">
            <DemoLink />
          </Button>
          <MobileMenu links={LINKS} />
        </div>
      </div>
    </header>
  );
}
