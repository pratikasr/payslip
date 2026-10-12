import Link from "next/link";
import { cn } from "cn";
import { LogoMark } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { GITHUB_URL } from "@/components/marketing/data";
import { DemoLink } from "@/components/marketing/demo-link";
import { MobileMenu, type NavLink } from "@/components/marketing/mobile-menu";
import { Container } from "@/components/marketing/parts";
import { ghostButton } from "@/components/marketing/classes";

export const LINKS: NavLink[] = [
  { href: "#how-it-works", label: "How it works" },
  { href: "#proof", label: "Payments" },
  { href: "#pricing", label: "Pricing" },
  { href: "#check", label: "Check it yourself" },
  { href: GITHUB_URL, label: "GitHub", external: true },
];

/** The head of the sheet: the name, typewritten navigation and the demo, kept at the top. */
export function SiteHeader() {
  return (
    <header className="paper sticky top-0 z-30">
      <Container>
        <div className="flex h-[72px] items-center gap-6 border-b border-rule lg:h-[88px]">
          <Link href="/" className="inline-flex items-center gap-2.5 text-ink">
            <LogoMark className="size-[24px]" />
            <span className="font-type text-[1.25rem] leading-none font-bold tracking-[-0.01em]">Payslip</span>
          </Link>

          <nav aria-label="Main" className="ml-auto hidden lg:block">
            <ul className="flex items-center gap-[26px] font-type text-[0.875rem]">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    {...(l.external ? { target: "_blank", rel: "noreferrer" } : {})}
                    className="text-ink decoration-1 underline-offset-[5px] hover:underline"
                  >
                    {l.label}
                    {l.external ? <span className="sr-only"> (opens in a new tab)</span> : null}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-2 lg:ml-6">
            <ThemeToggle />
            <DemoLink className={cn(ghostButton, "hidden sm:inline-flex")} />
            <MobileMenu links={LINKS} />
          </div>
        </div>
      </Container>
    </header>
  );
}
