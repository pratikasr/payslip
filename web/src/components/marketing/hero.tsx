import { cn } from "cn";
import { HERO_PAYMENT } from "@/components/marketing/data";
import { DemoLink } from "@/components/marketing/demo-link";
import { Container } from "@/components/marketing/parts";
import { HeroTwoViews } from "@/components/marketing/two-views";
import { goldPill, t, textLink } from "@/components/marketing/classes";

/**
 * The headline, then the identity itself: one real payment as the explorer shows it and as a
 * viewing key shows it. Left-aligned; the headline is display at 64px on wide screens.
 */
export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="pt-10 pb-11 md:pt-16 md:pb-16 xl:pt-20 xl:pb-20">
      <Container>
        <h1 id="hero-title" className={cn(t.h1, "max-w-[17ch] md:max-w-none")}>
          <span className="md:block">Private to the world.</span>{" "}
          <span className="md:block">Transparent to your accountant.</span>
        </h1>
        {/* From 1024px the actions start where the key's view starts in the panel below. */}
        <div className="mt-5 grid gap-6 md:mt-7 lg:grid-cols-2 lg:items-end lg:gap-x-0">
          <p className={cn(t.lead, "max-w-[36rem] text-ink")}>
            Payslip pays your contractors in shielded Zcash. Anyone can see that a payment happened. Only the viewing
            keys you hand out show who was paid, how much and for what.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 lg:pl-8">
            <DemoLink className={goldPill} />
            <a href="#check" className={cn(textLink, "text-[15px]")}>
              Check it yourself
            </a>
          </div>
        </div>

        <HeroTwoViews className="mt-10 md:mt-12" />
        <p className="mt-3 text-[13px] text-ash">
          {HERO_PAYMENT.label}.{" "}
          {HERO_PAYMENT.simulatedRate ? "Dollars convert to TAZ at a simulated testnet rate." : null}
        </p>
      </Container>
    </section>
  );
}
