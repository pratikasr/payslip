import Link from "next/link";
import { cn } from "cn";
import { LogoMark } from "@/components/app/logo";
import { GITHUB_URL } from "@/components/marketing/data";
import { DemoLink } from "@/components/marketing/demo-link";
import { MobileMenu, type NavLink } from "@/components/marketing/mobile-menu";
import { Container } from "@/components/marketing/parts";
import { quietPill } from "@/components/marketing/classes";

export const LINKS: NavLink[] = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#proof", label: "Payments" },
  { href: "#pricing", label: "Pricing" },
  { href: "#check", label: "Check it yourself" },
  { href: GITHUB_URL, label: "GitHub", external: true },
];

/** A plain bar on Paper that stays at the top, so the menu and the demo are never out of reach. */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-mist bg-paper">
      <Container className="flex h-16 items-center gap-6">
        <Link href="/" className="inline-flex items-center gap-2.5 rounded-md text-ink">
          <LogoMark className="size-[26px]" />
          <span className="font-display text-[22px] leading-none font-[600] tracking-[-0.01em]">Payslip</span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden lg:block">
          <ul className="flex items-center gap-7 text-[15px]">
            {LINKS.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
                  className="rounded-[3px] text-ink/80 transition-colors hover:text-ink"
                >
                  {l.label}
                  {l.external ? <span className="sr-only"> (opens in a new tab)</span> : null}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <DemoLink className={cn(quietPill, "hidden sm:inline-flex")} />
          <MobileMenu links={LINKS} />
        </div>
      </Container>
    </header>
  );
}
