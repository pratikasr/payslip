import type { Viewport } from "next";
import { CheckIt } from "@/components/marketing/check";
import { Hero } from "@/components/marketing/hero";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { LandingStyles } from "@/components/marketing/landing-styles";
import { People } from "@/components/marketing/people";
import { Pricing } from "@/components/marketing/pricing";
import { Proof } from "@/components/marketing/proof";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";

/*
  The landing page, in the order of docs/DESIGN.md section 16: the headline and one real payment
  in its two views, the three people, how a run works, every payment, pricing, and how to check
  it yourself. It wears the identity tokens (.identity in globals.css) and the three identity
  faces. Server-rendered; the only client code is the demo link and the phone menu.
*/

/** The page is Paper in both themes' terms: white in light, #14181F in dark. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#14181f" },
  ],
};

export default function LandingPage() {
  return (
    <div className="identity min-h-dvh overflow-x-clip bg-paper font-text text-[15px] text-ink antialiased">
      <LandingStyles />
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
  );
}
