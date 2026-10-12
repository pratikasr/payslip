import Link from "next/link";
import { cn } from "cn";
import { LogoMark } from "@/components/app/logo";
import { GITHUB_URL, HACKATHON_URL, repoDir, repoFile } from "@/components/marketing/data";
import { DemoLink } from "@/components/marketing/demo-link";
import { TearLine } from "@/components/ds/paper";
import { Container, OutLink } from "@/components/marketing/parts";
import { t, textLink } from "@/components/marketing/classes";

type FooterLink = { label: string; href: string; external?: boolean; demo?: boolean };

const COLUMNS: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Live demo", href: "/console", demo: true },
      { label: "Check a payslip", href: "/verify" },
      { label: "Contractor portal", href: "/portal" },
      { label: "Accountant books", href: "/books" },
    ],
  },
  {
    title: "Docs on GitHub",
    links: [
      { label: "README", href: GITHUB_URL, external: true },
      { label: "Specification", href: repoFile("docs/SPEC.md"), external: true },
      { label: "API", href: repoFile("docs/API.md"), external: true },
      { label: "Demo and rehearsals", href: repoFile("docs/DEMO.md"), external: true },
      { label: "Testnet proof", href: repoDir("docs/proof"), external: true },
      { label: "Technical decisions", href: repoFile("docs/TECH-DECISIONS.md"), external: true },
    ],
  },
  {
    title: "License",
    links: [
      { label: "MIT license", href: repoFile("LICENSE"), external: true },
      { label: "Source code", href: GITHUB_URL, external: true },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms of use", href: "/terms" },
    ],
  },
];

const link = "text-ink decoration-1 underline-offset-[4px] hover:underline";

export function SiteFooter() {
  return (
    <footer>
      <Container>
        <TearLine />
      </Container>
      <Container className="grid gap-12 pt-12 pb-14 md:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <div className="max-w-[26rem]">
          <span className="inline-flex items-center gap-2.5 text-ink">
            <LogoMark className="size-[22px]" />
            <span className="font-type text-[1.125rem] leading-none font-bold">Payslip</span>
          </span>
          <p className={cn(t.small, "mt-4 text-ash")}>
            Payslip is open-source software, not a bank. Payments settle on Zcash; USDC funding swaps run through NEAR
            Intents.
          </p>
          <p className={cn(t.small, "mt-3 text-ash")}>
            Built for the Zcash track of{" "}
            <OutLink href={HACKATHON_URL} className={textLink}>
              Colosseum&apos;s Crypto World&apos;s Fair
            </OutLink>
            .
          </p>
        </div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3">
          {COLUMNS.map((c) => {
            const id = `footer-${c.title.split(" ")[0].toLowerCase()}`;
            return (
              <nav key={c.title} aria-labelledby={id}>
                <p id={id} className={cn(t.label, "text-ash")}>
                  {c.title}
                </p>
                <ul className="mt-3.5 space-y-2 font-type text-[0.875rem]">
                  {c.links.map((l) => (
                    <li key={l.label}>
                      {l.demo ? (
                        <DemoLink liveLabel={l.label} kitLabel="Books with the judge kit" className={link} />
                      ) : l.external ? (
                        <OutLink href={l.href} className={link}>
                          {l.label}
                        </OutLink>
                      ) : (
                        <Link href={l.href} className={link}>
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </nav>
            );
          })}
        </div>
      </Container>
    </footer>
  );
}
