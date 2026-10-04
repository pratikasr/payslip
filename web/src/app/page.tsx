import Link from "next/link";
import { ArrowUpRight, Eye, EyeOff, KeyRound } from "lucide-react";
import { Logo } from "@/components/app/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

const GITHUB_URL = "https://github.com/pratikasr/payslip";

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
            <a href="#who-sees-what" className="hover:text-foreground">
              Who sees what
            </a>
            <a href={GITHUB_URL} className="hover:text-foreground" rel="noreferrer">
              GitHub
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <Button asChild size="sm">
              <Link href="/app">Launch app</Link>
            </Button>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="mx-auto grid max-w-6xl gap-12 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:items-center lg:gap-16 lg:pt-20 lg:pb-24">
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
          </div>

          <OnePaymentTwoViews />
        </section>

        <section id="how-it-works" aria-labelledby="how-title" className="border-t bg-card">
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

        <section id="who-sees-what" aria-labelledby="who-title" className="border-t">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <div className="max-w-2xl">
              <h2 id="who-title" className="text-2xl font-semibold tracking-tight">
                Who sees what
              </h2>
              <p className="mt-3 text-muted-foreground">
                On a public chain, payroll is a public document. On Zcash, a viewing key decides who can read it.
                Payslip gives every contractor a separate account, so a key reveals one person&apos;s payments and
                nothing else.
              </p>
            </div>
            <div
              className="mt-10 overflow-x-auto rounded-lg border bg-card"
              role="region"
              aria-label="Who sees what"
              tabIndex={0}
            >
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="h-10 px-4 font-medium">
                      Holder
                    </th>
                    <th scope="col" className="px-4 font-medium">
                      What they see
                    </th>
                    <th scope="col" className="px-4 font-medium">
                      Can spend
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <AccessRow
                    icon={<EyeOff />}
                    who="Anyone with a block explorer"
                    sees="That shielded transactions exist. No amounts, no sender, no recipient, no memo."
                  />
                  <AccessRow
                    icon={<KeyRound />}
                    who="A contractor, with their viewing key"
                    sees="Every payment from their own account: date, ZEC, USD basis, invoice, period. Nobody else's pay."
                  />
                  <AccessRow
                    icon={<Eye />}
                    who="Your accountant, with all viewing keys"
                    sees="Every run and every line, funded USD against paid USD, and the variance explained."
                  />
                  <AccessRow
                    icon={<KeyRound />}
                    who="Payslip service, on your host"
                    sees="Everything. It holds the spending key and signs only during a run."
                    spends
                  />
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
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

function AccessRow({
  icon,
  who,
  sees,
  spends,
}: {
  icon: React.ReactNode;
  who: string;
  sees: string;
  spends?: boolean;
}) {
  return (
    <tr>
      <th scope="row" className="px-4 py-4 text-left align-top font-medium">
        <span className="inline-flex items-center gap-2 [&_svg]:size-4 [&_svg]:text-muted-foreground">
          <span aria-hidden="true">{icon}</span>
          {who}
        </span>
      </th>
      <td className="px-4 py-4 align-top text-muted-foreground">{sees}</td>
      <td className="px-4 py-4 align-top">{spends ? "Yes" : "No"}</td>
    </tr>
  );
}

/**
 * The same pay line seen two ways. Values are an illustration, labelled as
 * such; in the app every figure comes from the service.
 */
function OnePaymentTwoViews() {
  return (
    <figure className="min-w-0">
      <div className="grid gap-3 sm:grid-cols-2">
        <ViewCard title="Block explorer" subtitle="What the public sees">
          <Field label="Transaction">Shielded</Field>
          <Field label="From">
            <Sealed w="w-[70%]" />
          </Field>
          <Field label="To">
            <Sealed w="w-[80%]" />
          </Field>
          <Field label="Amount">
            <Sealed w="w-[55%]" />
          </Field>
          <Field label="USD basis">
            <Sealed w="w-[45%]" />
          </Field>
          <Field label="Memo">
            <Sealed w="w-[90%]" />
          </Field>
        </ViewCard>
        <ViewCard title="Accountant" subtitle="With viewing keys" open>
          <Field label="Transaction">Shielded, decrypted</Field>
          <Field label="From">Payroll account 1</Field>
          <Field label="To">Amara Okafor</Field>
          <Field label="Amount">
            <span className="num">3.54262000 ZEC</span>
          </Field>
          <Field label="USD basis">
            <span className="num">$4,800.00</span>
          </Field>
          <Field label="Memo">Sep 2026, INV-2026-014</Field>
        </ViewCard>
      </div>
      <figcaption className="mt-3 text-xs text-muted-foreground">
        Illustration of one pay line with example values. In the app, every figure comes from your own runs on chain.
      </figcaption>
    </figure>
  );
}

function ViewCard({
  title,
  subtitle,
  open,
  children,
}: {
  title: string;
  subtitle: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border bg-card p-4", open && "border-primary-edge")}>
      <div className="mb-4 flex items-baseline justify-between gap-2 border-b pb-3">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <dl className="space-y-3">{children}</dl>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-6 grid-cols-[5.25rem_minmax(0,1fr)] items-center gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** A redaction bar: the value exists on chain but is encrypted. */
function Sealed({ w }: { w: string }) {
  return (
    <span className="block">
      <span aria-hidden="true" className={cn("block h-3.5 rounded-[3px] bg-redact", w)} />
      <span className="sr-only">Hidden</span>
    </span>
  );
}
