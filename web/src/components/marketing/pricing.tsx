import Link from "next/link";
import { Check } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { GITHUB_URL } from "@/components/marketing/data";
import { Container, SectionHeading } from "@/components/marketing/parts";

/* Pricing as decided in docs/LAUNCH.md and the README. */
const PLANS = [
  {
    name: "Self-hosted",
    price: "Free",
    unit: "MIT licensed",
    who: "Teams that run the service themselves.",
    points: ["Every feature in this repository", "Your keys stay on your server", "No fee on swaps"],
    cta: { label: "Read the code", href: GITHUB_URL, external: true },
  },
  {
    name: "Hosted",
    price: "$19",
    unit: "per active contractor per month",
    who: "Teams paying 5 to 50 contractors.",
    points: ["Runs, statements and proofs, hosted", "0.25% on the USDC to ZEC funding swap", "Contractors never pay"],
    featured: true,
    cta: { label: "Try the live demo", href: "/console" },
  },
  {
    name: "Accountant",
    price: "Free",
    unit: "always",
    who: "Anyone a client shares viewing keys with.",
    points: ["Reconciliation for every run", "Xero and QuickBooks exports", "No spending power, ever"],
    cta: { label: "Open the books", href: "/books" },
  },
];

export function Pricing() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-4 pb-20 sm:pb-24">
      <Container>
        <SectionHeading
          id="pricing-title"
          title="Pricing"
          lead="Deel and Rise list $49 per contractor per month for contractor payroll (their pricing pages, 5 Oct 2026), and paid in crypto through either, every salary is still public on chain."
        />
        <ul className="mt-10 grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => (
            <li
              key={p.name}
              className={cn(
                "flex flex-col rounded-xl border bg-card p-6",
                p.featured && "border-primary-edge shadow-[0_0_0_1px_var(--primary-edge)]",
              )}
            >
              <h3 className="text-[15px] font-[500]">{p.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{p.who}</p>
              <p className="mt-6">
                <span className="figure block text-[2.5rem] leading-none font-[380] tracking-[-0.03em]">{p.price}</span>
                <span className="mt-2 block text-sm text-muted-foreground">{p.unit}</span>
              </p>
              <ul className="mt-6 flex-1 space-y-2.5 text-[15px]">
                {p.points.map((pt) => (
                  <li key={pt} className="flex items-start gap-2.5">
                    <Check className="mt-[3px] size-4 shrink-0 text-strong" aria-hidden="true" />
                    {pt}
                  </li>
                ))}
              </ul>
              <Button asChild variant="secondary" className="mt-7 self-start">
                {p.cta.external ? (
                  <a href={p.cta.href} target="_blank" rel="noreferrer">
                    {p.cta.label}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  <Link href={p.cta.href}>{p.cta.label}</Link>
                )}
              </Button>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-[13px] text-muted-foreground">
          Contractors and accountants never pay. The swap fee is collected through NEAR Intents app fees and folded into
          the run&apos;s fill rate, so the books stay exact.
        </p>
      </Container>
    </section>
  );
}
