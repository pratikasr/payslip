import type { Metadata } from "next";
import { GITHUB_URL, repoFile } from "@/components/marketing/data";
import { Clause, LegalPage, legalLink } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: { absolute: "Terms | Payslip" },
  description: "The terms for using Payslip at app.payslip.cash and payslip.cash.",
};

const ISSUES = `${GITHUB_URL}/issues`;

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      updated="12 Oct 2026"
      lead="Short, because the software is open source and the money stays with the company that runs it."
    >
      <Clause title="What Payslip is">
        <p>
          Payslip is software published under the MIT license (
          <a href={repoFile("LICENSE")} className={legalLink}>
            the license text
          </a>
          ). It is provided as is, without warranty of any kind. It is not a bank, a custodian, an exchange or a
          money transmitter: it never holds anyone&apos;s funds. The company that runs a Payslip keeps its own treasury
          key and makes its own payments on the Zcash network.
        </p>
      </Clause>
      <Clause title="This copy">
        <p>
          app.payslip.cash and payslip.cash are run by Payslip Labs and were built for the Zcash track of
          Colosseum&apos;s Crypto World&apos;s Fair. They run on Zcash mainnet, so payments made here are real and
          cannot be reversed. The service may be changed, paused or taken down, and anyone who signs in with a new
          Google account joins Payslip Labs as a viewer, who can read and cannot pay.
        </p>
      </Clause>
      <Clause title="Your part">
        <p>
          Use it lawfully and for payroll you are entitled to run. Keep your passphrase and your treasury&apos;s recovery
          words to yourself: whoever has them can spend. A viewing key or a payment proof you share reveals those
          payments to whoever you share it with. The dollar figures Payslip records are a cost basis at the time of
          payment, not tax advice; your taxes are yours.
        </p>
      </Clause>
      <Clause title="Questions">
        <p>
          Open an issue at{" "}
          <a href={ISSUES} className={legalLink}>
            {ISSUES.replace("https://", "")}
          </a>
          . Changes to these terms are made in the repository, where their history is public.
        </p>
      </Clause>
    </LegalPage>
  );
}
