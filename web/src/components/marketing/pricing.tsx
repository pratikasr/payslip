import { cn } from "cn";
import { GITHUB_URL, PRICING } from "@/components/marketing/data";
import { OutLink, Section } from "@/components/marketing/parts";
import { t, textLink } from "@/components/marketing/classes";

/* Pricing as the README states it, set against the $49 products: two price slips side by side. */
export function Pricing() {
  return (
    <Section id="pricing" title="Pricing">
      <div className="mt-10 grid gap-4 sm:grid-cols-2 sm:gap-0 md:mt-14">
        <div className="border-2 border-ink px-4 pt-5 pb-6 sm:px-6">
          <h3 className={t.label}>Payslip, hosted</h3>
          <p className="inked mt-5 font-dot text-[3rem] leading-none md:text-[4.5rem]">${PRICING.hostedUsd}</p>
          <p className={cn(t.body, "mt-4 max-w-[26rem]")}>
            Per active contractor per month. Every payment is shielded.
          </p>
        </div>
        <div className="border border-rule bg-bar px-4 pt-5 pb-6 sm:border-l-0 sm:px-6">
          <h3 className={cn(t.label, "text-ash")}>{PRICING.competitors}</h3>
          <p className="inked mt-5 font-dot text-[3rem] leading-none text-ash md:text-[4.5rem]">
            ${PRICING.competitorUsd}
          </p>
          <p className={cn(t.body, "mt-4 max-w-[26rem] text-ash")}>
            Per contractor per month for contractor payroll. Paid in crypto through either, every salary is public on
            chain.
          </p>
        </div>
      </div>
      <p className={cn(t.body, "mt-10 max-w-[40rem]")}>
        Hosted runs add {PRICING.swapFee} on the USDC to ZEC funding swap, folded into the run&apos;s fill rate so the
        books stay exact. Self-hosting is free under the MIT license. Contractors and accountants never pay.{" "}
        <OutLink href={GITHUB_URL} className={textLink}>
          Read the code
        </OutLink>
      </p>
      <p className={cn(t.small, "mt-3 text-ash")}>
        {PRICING.competitors} prices from their pricing pages, checked {PRICING.checked}.
      </p>
    </Section>
  );
}
