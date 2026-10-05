import type { Viewport } from "next";
import { ClosingCta, SiteFooter } from "@/components/marketing/closing";
import { Faq } from "@/components/marketing/faq";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { LandingStyles } from "@/components/marketing/landing-styles";
import { Pricing } from "@/components/marketing/pricing";
import { ProductSection } from "@/components/marketing/product";
import { ProofStrip } from "@/components/marketing/proof";
import { SecurityModel } from "@/components/marketing/security";
import { SiteHeader } from "@/components/marketing/site-header";
import { WhoSeesWhat } from "@/components/marketing/who-sees-what";

/*
  The landing page, its layout informed by Mercury's: a dark cinematic hero and product section (dark in both
  themes), then light or dark sections that follow the theme, and a dark close. Server-rendered;
  the only client code is the product accordion and the phone menu.
*/
/** The page opens on the dark hero in both themes, so the browser chrome matches its sky. */
export const viewport: Viewport = { themeColor: "#191829" };

export default function LandingPage() {
  return (
    <div className="relative overflow-x-clip">
      <LandingStyles />
      <SiteHeader />
      <main id="main" tabIndex={-1} className="outline-none">
        <Hero />
        <ProductSection />
        <ProofStrip />
        <HowItWorks />
        <WhoSeesWhat />
        <SecurityModel />
        <Pricing />
        <Faq />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}
