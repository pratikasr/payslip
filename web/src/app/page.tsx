import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { OnChainSection } from "@/components/landing/on-chain";
import { PricingSection } from "@/components/landing/pricing";
import { RolesSection } from "@/components/landing/roles";
import { TESTNET_RUNS } from "@/components/landing/testnet-proof";
import { UnsealDemo } from "@/components/landing/unseal-demo";
import { Button } from "@/components/ui/button";

const GITHUB_URL = "https://github.com/pratikasr/payslip";
const TESTNET_PAYMENTS = TESTNET_RUNS.reduce((n, r) => n + r.lines.length, 0);

export default function LandingPage() {
  return (
    <>
      <header role="banner" className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 sm:px-6">
          <Logo />
          <nav aria-label="Page" className="ml-6 hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            <a href="#how-it-works" className="hover:text-foreground">
              How it works
            </a>
            <a href="#roles" className="hover:text-foreground">
              Roles
            </a>
            <a href="#on-chain" className="hover:text-foreground">
              On chain
            </a>
            <a href="#pricing" className="hover:text-foreground">
              Pricing
            </a>
            <a href={GITHUB_URL} className="hover:text-foreground" rel="noreferrer">
              GitHub
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span data-secondary="">
              <ThemeToggle />
            </span>
            <Button asChild size="sm">
              <Link href="/app">Launch app</Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="mx-auto grid max-w-6xl gap-12 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center lg:gap-12 lg:pt-20 lg:pb-24">
          <div className="max-w-xl">
            <h1 className="text-[2.5rem] leading-[1.05] font-semibold tracking-[-0.03em] text-balance sm:text-[3.25rem]">
              Private to the world, transparent to your accountant.
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
              Payslip runs contractor payroll on Zcash. Every payment is shielded, so a block explorer shows no amounts
              and no names. Each contractor and your accountant hold a viewing key that opens exactly their slice, with
              USD cost basis and statements ready for tax.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link href="/app">Launch app</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href={GITHUB_URL} rel="noreferrer">
                  Read the code
                  <ArrowUpRight aria-hidden="true" />
                </a>
              </Button>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              Already on Zcash testnet:{" "}
              <a href="#on-chain" className="font-medium text-link underline underline-offset-4 hover:no-underline">
                {TESTNET_PAYMENTS} shielded payroll payments you can open in an explorer
              </a>
              .
            </p>
          </div>

          <UnsealDemo />
        </section>

        <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-4 border-t bg-card">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <h2 id="how-title" className="text-2xl font-semibold tracking-tight">
              How it works
            </h2>
            <ol className="mt-10 grid gap-10 md:grid-cols-3 md:gap-8">
              <Step n={1} title="Fund a run in USDC">
                Enter each contractor&apos;s amount in dollars and send USDC from your wallet. The swap venue converts
                it to ZEC, and its fill rate becomes the USD basis of every line.
              </Step>
              <Step n={2} title="Pay, shielded">
                Payslip sends one shielded payment per contractor, each from that contractor&apos;s own account. The
                encrypted memo carries the period, the invoice reference and the USD basis.
              </Step>
              <Step n={3} title="Share keys, not spreadsheets">
                Each contractor gets the viewing key for their account. Your accountant gets all of them. Statements and
                the reconciliation are read straight from the chain.
              </Step>
            </ol>
          </div>
        </section>

        <RolesSection />

        <OnChainSection />

        <PricingSection />
      </main>

      <footer className="border-t" data-secondary="">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>Built on Zcash. Open source under the MIT license.</p>
          <a href={GITHUB_URL} rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
            github.com/pratikasr/payslip
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </a>
        </div>
      </footer>
    </>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="space-y-3">
      <span
        aria-hidden="true"
        className="num inline-flex size-7 items-center justify-center rounded-full border border-primary-edge text-xs font-semibold"
      >
        {n}
      </span>
      <h3 className="font-semibold">
        <span className="sr-only">Step {n}: </span>
        {title}
      </h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
    </li>
  );
}
