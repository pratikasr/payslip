import { Container } from "@/components/marketing/parts";

const QA: { q: string; a: string }[] = [
  {
    q: "Why Zcash?",
    a: "Zcash's shielded pool hides the amount, the sender and the recipient of every payment, and its viewing keys open one account to exactly the person you hand the key to. Private by default, disclosed by key: that is what payroll needs. On most chains every salary is public.",
  },
  {
    q: "Do contractors need ZEC?",
    a: "No. A contractor can hold ZEC in their own wallet, such as Zodl, or choose to be paid in USDC: Payslip converts their pay on receipt through NEAR Intents and sends USDC to the address they give. That USDC leg is visible on the chain it lands on, and Payslip says so when they choose it. On testnet the conversion is simulated.",
  },
  {
    q: "Can we fund in USDC and settle to USDC?",
    a: "Yes. You fund each run in USDC from your own wallet, and contractors who choose USDC are paid out in USDC. In between, the payroll moves through Zcash's shielded pool, which is where the privacy comes from. The fill rate of each swap is recorded, so every line keeps its dollar basis.",
  },
  {
    q: "Can my accountant see everything?",
    a: "Everything you give them keys for, and nothing they can spend. With every viewing key they see each run and each line, reconciled against what was funded, and any transaction without a Payslip memo is listed rather than dropped. Accounts whose keys you keep stay closed to them.",
  },
  {
    q: "How are taxes handled?",
    a: "Payslip keeps the records; it does not withhold or file. Every payment carries its dollar basis in the encrypted memo, and each statement line adds the payment's market value when it arrived, in the contractor's own currency, which most tax authorities count as income. Contractors export to Koinly or CoinTracker, and your accountant exports to Xero or QuickBooks.",
  },
  {
    q: "What does a payment proof reveal?",
    a: "One payment: its amount, the address it was paid to and its memo, checked against the chain. Nothing about any other payment, and no key. Change one character of the proof and it fails.",
  },
];

/** Always expanded: every answer is on the page, readable without a click. */
export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="scroll-mt-4 pb-24 sm:pb-28">
      <Container>
        <div className="grid gap-8 border-t pt-10 sm:pt-12 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-12">
          <h2
            id="faq-title"
            className="self-start text-[1.75rem] lg:sticky lg:top-8 leading-[1.15] font-[450] tracking-[-0.015em] sm:text-[2rem]"
          >
            Questions, answered
          </h2>
          <dl className="grid gap-x-10 md:grid-cols-2">
            {QA.map(({ q, a }) => (
              <div key={q} className="border-b border-hairline py-5 first:pt-0 md:[&:nth-child(2)]:pt-0">
                <dt className="text-base font-[500]">{q}</dt>
                <dd className="mt-2 text-[15px] leading-relaxed text-muted-foreground">{a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Container>
    </section>
  );
}
