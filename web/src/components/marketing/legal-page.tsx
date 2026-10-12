import type { ReactNode } from "react";
import { cn } from "cn";
import { TearLine } from "@/components/ds/paper";
import { Container } from "@/components/marketing/parts";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { t, textLink } from "@/components/marketing/classes";

/*
  A page of plain terms on the same continuous-form sheet as the landing page: the privacy
  notice and the terms of use that the Google sign-in consent screen links to. Server-rendered,
  no data; the text is the content, written for the person signing in, not for a lawyer.
*/
export function LegalPage({
  title,
  updated,
  lead,
  children,
}: {
  title: string;
  /** "12 Oct 2026": the date the text last changed, shown under the title. */
  updated: string;
  lead: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh overflow-x-clip font-text text-[0.9375rem] text-ink antialiased sm:px-4 sm:pt-6 sm:pb-16 lg:pt-10 lg:pb-24">
      <div className="paper sheet-shadow feed-edges mx-auto max-w-[1180px]">
        <SiteHeader />
        <main id="main" tabIndex={-1} className="outline-none">
          <Container>
            <div className="pt-10 pb-14 md:pt-14 md:pb-20">
              <h1 className={cn(t.h2, "max-w-[22ch]")}>{title}</h1>
              <p className={cn(t.data, "mt-3 text-ash")}>Last changed {updated}</p>
              <div className={cn(t.lead, "mt-5 max-w-[38rem]")}>{lead}</div>
            </div>
            <TearLine />
            <div className="legal max-w-[42rem] pt-10 pb-16 md:pt-12 md:pb-24">{children}</div>
          </Container>
        </main>
        <SiteFooter />
      </div>
    </div>
  );
}

/** One ruled clause: a typed heading, then paragraphs. */
export function Clause({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-ink py-6 first:border-t-0 first:pt-0">
      <h2 className={cn(t.h3, "mb-3")}>{title}</h2>
      <div className={cn(t.body, "grid gap-3 text-ash")}>{children}</div>
    </section>
  );
}

export const legalLink = textLink;
