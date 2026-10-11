import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "cn";
import { HERO_PAYMENT, JUDGE_KIT, repoFile } from "@/components/marketing/data";
import { OutLink, Section } from "@/components/marketing/parts";
import { t, textLink } from "@/components/marketing/classes";

/* The ways to check the sample company's payroll without trusting this page. */
const WAYS: { where: string; body: ReactNode; link: ReactNode }[] = [
  {
    where: "In Books",
    body: (
      <>
        Choose <strong className="font-medium">{JUDGE_KIT.booksAction}</strong>. Every run is reconciled from the chain,
        funded against paid, with each line&apos;s transaction.
      </>
    ),
    link: (
      <Link href="/books" className={textLink}>
        Open Books
      </Link>
    ),
  },
  {
    where: "In the contractor portal",
    body: (
      <>
        Choose <strong className="font-medium">{JUDGE_KIT.portalAction}</strong> to read {HERO_PAYMENT.name}&apos;s
        payslips with her key alone.
      </>
    ),
    link: (
      <Link href="/portal" className={textLink}>
        Open the portal
      </Link>
    ),
  },
  {
    where: "With a payment proof",
    body: (
      <>
        The kit carries a proof of {HERO_PAYMENT.name.split(" ")[0]}&apos;s {HERO_PAYMENT.periodLabel} payment. It opens
        that one payment, checked against the chain, and no key.
      </>
    ),
    link: (
      <Link href={`/verify#${HERO_PAYMENT.proofToken}`} className={textLink}>
        Check the proof
      </Link>
    ),
  },
  {
    where: "On the explorer",
    body: (
      <>
        Open any transaction on this page. The explorer shows a block, a time and shielded actions, and no amount, name
        or memo.
      </>
    ),
    link: (
      <a href="#proof" className={textLink}>
        Go to the payments
      </a>
    ),
  },
];

export function CheckIt() {
  return (
    <Section
      id="check"
      title="Check it yourself"
      lead={
        <>
          The judge kit is the sample company&apos;s {JUDGE_KIT.keys} testnet viewing keys: the treasury&apos;s and one
          for each of the {JUDGE_KIT.contractors} contractors. They read the July, August and September payrolls and
          cannot spend.
        </>
      }
    >
      <p className="mt-5 text-[15px]">
        <OutLink href={repoFile(JUDGE_KIT.path)} className={cn(textLink, t.data, "text-[13px]")}>
          {JUDGE_KIT.path}
        </OutLink>
      </p>
      <ul className="mt-10 grid gap-x-10 border-t border-ink md:mt-14 md:grid-cols-2 xl:grid-cols-4 xl:gap-x-8">
        {WAYS.map((w) => (
          <li key={w.where} className="flex flex-col border-b border-mist py-6 xl:border-b-0">
            <h3 className="text-[15px] font-medium">{w.where}</h3>
            <p className={cn(t.body, "mt-2 text-ash")}>{w.body}</p>
            <p className="mt-auto pt-4 text-[15px]">{w.link}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
