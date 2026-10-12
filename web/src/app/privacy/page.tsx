import type { Metadata } from "next";
import { GITHUB_URL } from "@/components/marketing/data";
import { Clause, LegalPage, legalLink } from "@/components/marketing/legal-page";

export const metadata: Metadata = {
  title: { absolute: "Privacy | Payslip" },
  description: "What Payslip stores when you sign in, paste a viewing key or run payroll, and what it never sees.",
};

const ISSUES = `${GITHUB_URL}/issues`;

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      updated="12 Oct 2026"
      lead="Payslip is open-source payroll software that a company runs for itself. This notice covers the copy at app.payslip.cash and payslip.cash, which Payslip Labs runs, and what it keeps about you."
    >
      <Clause title="When you sign in with Google">
        <p>
          Payslip asks Google for your name, your email address and your Google account id, and nothing else: the
          only scopes are openid, email and profile. It does not read your mail, contacts, calendar or files. Those
          three fields create your Payslip account and your membership of the organisation, with the role you are
          given (admin, approver, accountant or viewer).
        </p>
        <p>
          Every change made in the company console is written to an audit log with the account that made it and the
          time, so the company can see who did what. A session cookie keeps you signed in; it holds a session id, not
          your data.
        </p>
      </Clause>
      <Clause title="When a company runs payroll">
        <p>
          The console stores what the company types: contractor names, Zcash addresses, amounts, invoice references,
          pay schedules, payment requests and the organisation&apos;s name. The company&apos;s treasury key is created and
          encrypted in the admin&apos;s browser with a passphrase the service never receives; the service keeps only the
          encrypted file, and holds the key in memory while an admin has unlocked it.
        </p>
        <p>
          Payments are shielded Zcash transactions. The public chain records that a transaction happened and nothing
          about it; the amount, the recipient and the memo are readable only with the viewing keys the company hands
          out.
        </p>
      </Clause>
      <Clause title="When you paste a viewing key">
        <p>
          A viewing key you paste in the contractor portal or in Books, or open from an invite link, is sent to the
          service so it can scan the chain for that account. The service keeps that read-only scan so the next visit
          is quick, and keeps the key only in the browser tab. Lock forgets it in the tab; Forget on the service
          deletes the scan. A viewing key can read; it cannot spend.
        </p>
      </Clause>
      <Clause title="Where it lives and who else sees it">
        <p>
          Everything above is stored on the server the company runs. For app.payslip.cash that is one server in
          Amazon Web Services (us-east-1), with encrypted backups in the same account. Nothing is sold or shared for
          advertising, and there are no analytics or tracking scripts on these pages.
        </p>
        <p>
          Services the software talks to: Google, for sign-in; a Zcash lightwalletd server (zec.rocks), to read and
          send transactions; CoinGecko, for the market price that becomes a payment&apos;s dollar basis; and NEAR Intents,
          only when a company funds a run with USDC. Each sees only what that step needs.
        </p>
      </Clause>
      <Clause title="Keeping and deleting">
        <p>
          Payroll records stay as long as the organisation keeps them, because they are the company&apos;s books. To have
          your account, membership or a viewing-key scan removed, ask the organisation&apos;s admin or open an issue at{" "}
          <a href={ISSUES} className={legalLink}>
            {ISSUES.replace("https://", "")}
          </a>
          . Changes to this notice are made in the repository, where its history is public.
        </p>
      </Clause>
    </LegalPage>
  );
}
