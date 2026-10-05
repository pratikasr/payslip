import { DemoLink } from "@/components/marketing/demo-link";
import { ProductAccordion, type ProductItem } from "@/components/marketing/product-accordion";
import { OpenSourceVignette, PayslipVignette, ReconcileVignette, RunVignette } from "@/components/marketing/vignettes";

const ITEMS: ProductItem[] = [
  {
    title: "Shielded payroll runs",
    body: "Fund a run in USDC from any wallet. Every contractor is paid with one shielded Zcash payment, with the period, the invoice and the dollar amount sealed in its encrypted memo.",
    vignette: <RunVignette />,
  },
  {
    title: "Payslips your contractors can prove",
    body: "Each contractor holds the viewing key to their own pay and reads every payment from the chain. To show one payment to a landlord or a bank, they send a link that opens that payment and nothing else.",
    vignette: <PayslipVignette />,
  },
  {
    title: "Books your accountant can reconcile",
    body: "Your accountant imports every viewing key and gets each run reconciled from the chain: dollars funded against dollars paid, the difference explained by network fees and unspent ZEC. Exports go to Xero and QuickBooks.",
    vignette: <ReconcileVignette />,
  },
  {
    title: "Open source, MIT",
    body: "The Rust service, the web app and the scripts that made these payments are on GitHub under the MIT license. Run it on your own server for free.",
    vignette: <OpenSourceVignette />,
  },
];

/** Mercury's dark product section: an accordion on the left, the matching card on the right. */
export function ProductSection() {
  return (
    <section id="product" aria-labelledby="product-title" className="dark scroll-mt-4 bg-background text-foreground">
      <div className="mx-auto max-w-[72rem] px-5 pt-20 pb-16 sm:px-8 lg:px-12 lg:pt-28 lg:pb-20">
        <ProductAccordion
          heading={
            <h2
              id="product-title"
              className="text-[1.75rem] leading-[1.18] font-[450] tracking-[-0.015em] sm:text-[2rem]"
            >
              Everything payroll needs.
              <br />
              Nobody else sees it.
            </h2>
          }
          items={ITEMS}
          footer={
            <DemoLink className="mt-7 inline-block rounded-sm border-b border-current pb-0.5 text-[15px] text-[#ededf3] transition-colors hover:text-primary" />
          }
        />
      </div>
    </section>
  );
}
