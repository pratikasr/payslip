import type { Viewport } from "next";
import { CheckIt } from "@/components/marketing/check";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { People } from "@/components/marketing/people";
import { Pricing } from "@/components/marketing/pricing";
import { Proof } from "@/components/marketing/proof";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

/*
  The landing page (docs/DESIGN.md sections 16 and 17): one long continuous-form sheet on the
  desk, with tractor-feed edges. The headline, then one real payment as its white pay advice and
  its yellow carbon copy, then the three people, how a run works, every payment, pricing, and how
  to check it yourself, each torn off the part above. The paper tokens and faces are the whole
  app's (globals.css, layout.tsx); the forms are the shared ones (components/ds/paper.tsx).
  Server-rendered; the only client code is the demo link and the phone menu.
*/

/** The desk the sheet lies on, in both themes. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e8e9eb" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1218" },
  ],
};

export default function LandingPage() {
  return (
    <div className="min-h-dvh overflow-x-clip font-text text-[0.9375rem] text-ink antialiased sm:px-4 sm:pt-6 sm:pb-16 lg:pt-10 lg:pb-24">
      <div className="paper sheet-shadow feed-edges mx-auto max-w-[1180px]">
        <SiteHeader />
        <main id="main" tabIndex={-1} className="outline-none">
          <Hero />
          <People />
          <HowItWorks />
          <Proof />
          <Pricing />
          <CheckIt />
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}
