import { cn } from "cn";
import { TearLine } from "@/components/ds/paper";
import { HERO_PAYMENT } from "@/components/marketing/data";
import { DemoLink } from "@/components/marketing/demo-link";
import { Container } from "@/components/marketing/parts";
import { HeroCopies } from "@/components/marketing/two-views";
import { ghostButton, inkButton, t } from "@/components/marketing/classes";

/**
 * The headline, then the identity itself: one real payment as its white pay advice (what
 * Amara's viewing key reads) and its yellow carbon copy (what the explorer shows), torn apart.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title">
      <Container>
        <div className="grid gap-7 pt-10 pb-10 md:pt-14 lg:grid-cols-[1.2fr_0.8fr] lg:items-end lg:gap-14 lg:pt-16">
          <h1 id="hero-title" className={cn(t.h1, "max-w-[12ch]")}>
            Private to the world. Transparent to your accountant.
          </h1>
          <div>
            <p className={cn(t.lead, "mb-[22px] max-w-[42ch]")}>
              Payslip pays your contractors in shielded Zcash. Anyone can see that a payment happened. Only the viewing
              keys you hand out show who was paid, how much and for what.
            </p>
            <div className="flex flex-wrap gap-3">
              <DemoLink className={inkButton} />
              <a href="#check" className={ghostButton}>
                Check it yourself
              </a>
            </div>
          </div>
        </div>

        <TearLine />
        <HeroCopies className="mt-7" />
        <p className={cn(t.data, "mt-[18px] text-ash")}>
          Open the transaction on any Zcash explorer: you get the yellow copy. Hand Amara her key: she gets the white
          one.
        </p>
        <p className={cn(t.small, "mt-1.5 pb-14 text-ash md:pb-20")}>
          {HERO_PAYMENT.label}.{" "}
          {HERO_PAYMENT.simulatedRate ? "Dollars convert to TAZ at a simulated testnet rate." : null}
        </p>
      </Container>
    </section>
  );
}
