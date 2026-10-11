import { cn } from "cn";
import { GITHUB_URL, PRICING } from "@/components/marketing/data";
import { OutLink, Section } from "@/components/marketing/parts";
import { t, textLink } from "@/components/marketing/classes";

/* Pricing as the README states it, set against the $49 products. */
export function Pricing() {
  return (
    <Section id="pricing" title="Pricing">
      <div className="mt-10 grid grid-cols-2 border-t border-ink pt-8 md:mt-14">
        <div className="pr-4 md:pr-10">
          <h3 className="text-[15px] font-medium">Payslip, hosted</h3>
          <p className="mt-4 font-display text-[30px] leading-none font-semibold tracking-[-0.035em] md:text-[44px] xl:text-[64px]">
            ${PRICING.hostedUsd}
          </p>
          <p className={cn(t.body, "mt-4 max-w-[26rem]")}>
            Per active contractor per month. Every payment is shielded.
          </p>
        </div>
        <div className="border-l border-mist pl-4 md:pl-10">
          <h3 className="text-[15px] font-medium">{PRICING.competitors}</h3>
          <p className="mt-4 font-display text-[30px] leading-none font-semibold tracking-[-0.02em] text-ash md:text-[44px] xl:text-[64px]">
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
