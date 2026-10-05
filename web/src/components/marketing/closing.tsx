import Link from "next/link";
import { cn } from "cn";
import { LogoMark } from "@/components/app/logo";
import { Button } from "@/components/ui/button";
import { GITHUB_URL, HACKATHON_URL, repoDir, repoFile } from "@/components/marketing/data";
import { OutLink } from "@/components/marketing/parts";
import { lp } from "@/components/marketing/classes";

/** The closing band: dark in both themes, the hero's horizon seen from further away. */
export function ClosingCta() {
  return (
    <section
      aria-labelledby="closing-title"
      className="dark relative isolate overflow-hidden bg-background px-4 py-24 text-center text-foreground sm:py-32"
    >
      <div aria-hidden="true" className={cn(lp.horizon, "absolute inset-0 -z-10")} />
      <h2
        id="closing-title"
        className="mx-auto max-w-[36rem] text-[1.875rem] leading-[1.12] font-[450] tracking-[-0.02em] text-balance sm:text-[2.5rem]"
      >
        Private to the world, transparent to your accountant.
      </h2>
      <p className="mx-auto mt-4 max-w-[30rem] text-[15px] text-muted-foreground sm:text-base">
        Run a payroll on Zcash testnet in the live demo, then open every payment in the explorer.
      </p>
      <div className="mx-auto mt-8 flex max-w-sm flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center">
        <Button asChild size="lg" className="h-11 px-6 text-[15px]">
          <Link href="/console">Try the live demo</Link>
        </Button>
        <Button asChild size="lg" variant="secondary" className="h-11 px-6 text-[15px]">
          <a href={GITHUB_URL} target="_blank" rel="noreferrer">
            Read the code
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Button>
      </div>
    </section>
  );
}

type FooterLink = { label: string; href: string; external?: boolean };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Live demo", href: "/console" },
      { label: "Check a payslip", href: "/verify" },
      { label: "Contractor portal", href: "/portal" },
      { label: "Accountant books", href: "/books" },
      { label: "How it works", href: "#how-it-works" },
      { label: "Pricing", href: "#pricing" },
    ],
  },
  {
    title: "Docs on GitHub",
    links: [
      { label: "README", href: GITHUB_URL, external: true },
      { label: "Specification", href: repoFile("docs/SPEC.md"), external: true },
      { label: "API", href: repoFile("docs/API.md"), external: true },
      { label: "Demo and rehearsals", href: repoFile("docs/DEMO.md"), external: true },
      { label: "Test report", href: repoFile("docs/TEST-REPORT.md"), external: true },
    ],
  },
  {
    title: "Security",
    links: [
      { label: "Security model", href: "#security" },
      { label: "Who sees what", href: "#who-sees-what" },
      { label: "Testnet proof", href: repoDir("docs/proof"), external: true },
      { label: "Technical decisions", href: repoFile("docs/TECH-DECISIONS.md"), external: true },
    ],
  },
  {
    title: "License",
    links: [
      { label: "MIT license", href: repoFile("LICENSE"), external: true },
      { label: "Source code", href: GITHUB_URL, external: true },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="dark border-t border-white/[0.06] bg-background text-foreground">
      <div className="mx-auto max-w-[66rem] px-4 pt-14 pb-10 sm:px-6">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 md:grid-cols-4">
          {COLUMNS.map((c) => (
            <nav key={c.title} aria-labelledby={`footer-${c.title.split(" ")[0].toLowerCase()}`}>
              <p id={`footer-${c.title.split(" ")[0].toLowerCase()}`} className="text-[13px] text-muted-foreground">
                {c.title}
              </p>
              <ul className="mt-3 space-y-2 text-sm">
                {c.links.map((l) => (
                  <li key={l.label}>
                    {l.external ? (
                      <a
                        href={l.href}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-sm text-[#ededf3] transition-colors hover:text-primary"
                      >
                        {l.label}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <Link href={l.href} className="rounded-sm text-[#ededf3] transition-colors hover:text-primary">
                        {l.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-14 flex flex-col gap-4 border-t border-white/[0.08] pt-6 text-[13px] text-muted-foreground md:flex-row md:items-center md:justify-between">
          <span className="inline-flex items-center gap-2.5 text-[#ededf3]">
            <LogoMark className="size-5" />
            <span className="text-[13px] tracking-[0.22em] uppercase">Payslip</span>
          </span>
          <p className="max-w-[40rem] md:text-right">
            Built for the Zcash track of{" "}
            <OutLink href={HACKATHON_URL} className="text-[#ededf3]">
              Colosseum&apos;s Crypto World&apos;s Fair
            </OutLink>
            . Open-source software, not a bank. Testnet figures on this page are from real runs; mainnet results are
            added to the README when the demo run settles.
          </p>
        </div>
      </div>
    </footer>
  );
}
