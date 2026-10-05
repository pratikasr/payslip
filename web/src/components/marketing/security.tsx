import { Eye, KeyRound, ScanSearch, Undo2 } from "lucide-react";
import { Container, SectionHeading } from "@/components/marketing/parts";

const POINTS = [
  {
    icon: KeyRound,
    title: "The spending key stays on the service host",
    body: "Payslip signs each payment on your own server during a run. Nothing that leaves it can move funds: contractors and accountants only ever receive viewing keys.",
  },
  {
    icon: Eye,
    title: "Viewing keys only read",
    body: "A viewing key decrypts one account's payments and memos. It cannot sign a transaction or move a single coin.",
  },
  {
    icon: Undo2,
    title: "A shared viewing key cannot be revoked",
    body: "Whoever holds it reads that account for as long as the account is used. If a key reaches the wrong person, archive the contractor and add them again: the new account has a new key, and the old one reads nothing paid after that.",
  },
  {
    icon: ScanSearch,
    title: "What a block explorer sees",
    body: "That a shielded transaction happened, in which block, and its network fee. No amount, no sender, no recipient and no memo. Open any payroll payment on this page to check.",
  },
];

export function SecurityModel() {
  return (
    <section id="security" aria-labelledby="security-title" className="scroll-mt-4 pb-20 sm:pb-24">
      <Container>
        <SectionHeading id="security-title" title="Security model, in four lines" />
        <ul className="mt-10 grid gap-x-12 gap-y-9 md:grid-cols-2">
          {POINTS.map((p) => (
            <li key={p.title} className="flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-chip">
                <p.icon className="size-[18px] text-strong" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-[500]">{p.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-muted-foreground">{p.body}</p>
              </div>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
