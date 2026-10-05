import { BookOpen, Building2, Globe, UserRound } from "lucide-react";
import { Container, SectionHeading } from "@/components/marketing/parts";

const ROWS = [
  {
    who: "Company",
    icon: Building2,
    holds: "The spending key, on the service host",
    sees: "Every run, pay line, transaction id and network fee",
    cannot: "A contractor's own wallet, or what else they are paid",
  },
  {
    who: "Contractor",
    icon: UserRound,
    holds: "One viewing key, for their own account",
    sees: "Their own payments: date, amount, dollar basis, invoice and period",
    cannot: "Anyone else's pay, the treasury or the payroll total",
  },
  {
    who: "Accountant",
    icon: BookOpen,
    holds: "Every viewing key: the treasury and one per contractor",
    sees: "Every run and every line, funded against paid, with the variance explained",
    cannot: "Accounts whose keys they were not given. No key they hold can spend",
  },
  {
    who: "Everyone else",
    icon: Globe,
    holds: "Nothing",
    sees: "That shielded transactions happened, in which block, and the network fee",
    cannot: "Amounts, senders, recipients or memos",
  },
];

/** One table: what each party holds, sees and cannot see. On phones each row becomes a block. */
export function WhoSeesWhat() {
  return (
    <section id="who-sees-what" aria-labelledby="who-title" className="scroll-mt-4 pb-20 sm:pb-24">
      <Container>
        <SectionHeading
          id="who-title"
          title="Who sees what"
          lead="What each person sees is decided by the keys they hold, not by a setting someone could change. Every contractor is paid from a separate account, so one key opens one person's pay."
        />

        <table className="mt-10 hidden w-full text-[15px] md:table">
          <caption className="sr-only">What each party holds, sees and cannot see</caption>
          <thead>
            <tr className="border-b text-left text-[13px] text-muted-foreground">
              <th scope="col" className="h-10 w-[19%] pr-4 font-normal">
                Party
              </th>
              <th scope="col" className="w-[25%] px-4 font-normal">
                Holds
              </th>
              <th scope="col" className="w-[30%] px-4 font-normal">
                Sees
              </th>
              <th scope="col" className="pl-4 font-normal">
                Cannot see
              </th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.who} className="border-b border-hairline align-top">
                <th scope="row" className="py-4 pr-4 text-left font-normal">
                  <span className="inline-flex items-center gap-3">
                    <span className="grid size-8 place-items-center rounded-full bg-chip">
                      <r.icon className="size-4 text-strong" aria-hidden="true" />
                    </span>
                    {r.who}
                  </span>
                </th>
                <td className="px-4 py-4 pt-[1.4rem]">{r.holds}</td>
                <td className="px-4 py-4 pt-[1.4rem]">{r.sees}</td>
                <td className="py-4 pt-[1.4rem] pl-4 text-muted-foreground">{r.cannot}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <ul className="mt-8 md:hidden">
          {ROWS.map((r) => (
            <li key={r.who} className="border-b border-hairline py-5 first:border-t">
              <p className="flex items-center gap-3 text-base">
                <span className="grid size-8 place-items-center rounded-full bg-chip">
                  <r.icon className="size-4 text-strong" aria-hidden="true" />
                </span>
                {r.who}
              </p>
              <dl className="mt-3 grid grid-cols-[6.25rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[15px]">
                <dt className="text-[13px] leading-6 text-muted-foreground">Holds</dt>
                <dd>{r.holds}</dd>
                <dt className="text-[13px] leading-6 text-muted-foreground">Sees</dt>
                <dd>{r.sees}</dd>
                <dt className="text-[13px] leading-6 text-muted-foreground">Cannot see</dt>
                <dd className="text-muted-foreground">{r.cannot}</dd>
              </dl>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
