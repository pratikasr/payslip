import { Check } from "lucide-react";

const PLANS = [
  {
    name: "Self-hosted",
    price: "Free",
    unit: "MIT licensed",
    who: "Teams that run the service themselves.",
    points: ["Every feature in this repository", "Your keys stay on your server", "No fee on swaps"],
  },
  {
    name: "Hosted",
    price: "$19",
    unit: "per active contractor per month",
    who: "Teams paying 5 to 50 contractors.",
    points: ["Runs, statements and proofs, hosted", "0.25% on the USDC to ZEC funding swap", "Contractors never pay"],
    featured: true,
  },
  {
    name: "Accountant",
    price: "Free",
    unit: "always",
    who: "Anyone a client shares viewing keys with.",
    points: ["Reconciliation for every run", "Xero and QuickBooks exports", "No spending power, ever"],
  },
];

/** Pricing as decided in docs/LAUNCH.md and the README; Deel and Rise list $49 per contractor per month. */
export function PricingSection() {
  return (
    <section id="pricing" aria-labelledby="pricing-title" className="scroll-mt-4 border-t">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <h2 id="pricing-title" className="text-2xl font-semibold tracking-tight">
          Pricing
        </h2>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Contractor payroll tools charge about $49 per contractor per month, and when they pay in crypto every salary
          is still public on chain. Payslip costs less and keeps it private.
        </p>
        <ul className="mt-10 grid gap-4 md:grid-cols-3">
          {PLANS.map((p) => (
            <li
              key={p.name}
              className={
                p.featured
                  ? "rounded-lg border border-primary-edge bg-card p-5 shadow-sm"
                  : "rounded-lg border bg-card p-5"
              }
            >
              <h3 className="font-semibold">{p.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{p.who}</p>
              <p className="mt-5">
                <span className="figure text-3xl font-semibold tracking-tight">{p.price}</span>{" "}
                <span className="text-sm text-muted-foreground">{p.unit}</span>
              </p>
              <ul className="mt-5 space-y-2 text-sm">
                {p.points.map((pt) => (
                  <li key={pt} className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
                    {pt}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
