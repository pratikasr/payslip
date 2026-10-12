import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "cn";
import { HERO_PAYMENT, JUDGE_KIT, MAINNET_KIT, SAMPLE_CONTRACTOR, repoFile } from "@/components/marketing/data";
import { portalHref } from "@/lib/public-url";
import { OutLink, Section } from "@/components/marketing/parts";
import { t, textLink } from "@/components/marketing/classes";

/* The ways to check the mainnet payroll without trusting this page. */
const WAYS: { where: string; body: ReactNode; link: ReactNode }[] = [
  {
    where: "In Books",
    body: (
      <>
        Choose <strong className="font-medium">{MAINNET_KIT.booksAction}</strong>. The mainnet run is reconciled from
        the chain, funded against paid, with each line&apos;s transaction. On a testnet Payslip the same button loads
        the sample company&apos;s three payrolls.
      </>
    ),
    link: (
      <a href={portalHref("/books")} className={textLink}>
        Open Books
      </a>
    ),
  },
  {
    where: "In the contractor portal",
    body: (
      <>
        Paste {HERO_PAYMENT.name}&apos;s key from the mainnet kit to read {HERO_PAYMENT.name}&apos;s payslips with
        that key alone. On a testnet Payslip, <strong className="font-medium">{JUDGE_KIT.portalAction}</strong> opens{" "}
        {SAMPLE_CONTRACTOR}&apos;s.
      </>
    ),
    link: (
      <a href={portalHref("/portal")} className={textLink}>
        Open the portal
      </a>
    ),
  },
  {
    where: "With a payment proof",
    body: (
      <>
        The mainnet kit carries a proof of {HERO_PAYMENT.name}&apos;s {HERO_PAYMENT.periodLabel} payment. It opens that
        one payment, checked against the chain, and no key.
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
          The mainnet judge kit is Payslip Labs&apos; {MAINNET_KIT.keys} viewing keys: the treasury&apos;s and{" "}
          {MAINNET_KIT.contractor}&apos;s. They read the payroll of 12 Oct 2026 and cannot spend. The sample
          company&apos;s {JUDGE_KIT.keys} testnet keys, for the July, August and September payrolls, are published
          beside it.
        </>
      }
    >
      <p className="mt-5">
        <OutLink href={repoFile(MAINNET_KIT.path)} className={cn(textLink, t.data, "break-all")}>
          {MAINNET_KIT.path}
        </OutLink>
      </p>
      <p className="mt-1.5">
        <OutLink href={repoFile(JUDGE_KIT.path)} className={cn(textLink, t.data, "break-all")}>
          {JUDGE_KIT.path}
        </OutLink>
      </p>
      {/* A checklist: four ways to check, each a box to tick. */}
      <ul className="mt-10 grid border-2 border-ink md:mt-14 md:grid-cols-2 xl:grid-cols-4">
        {WAYS.map((w, i) => (
          <li
            key={w.where}
            className={cn(
              "flex flex-col px-4 pt-5 pb-6 sm:px-6",
              i > 0 && "border-t border-ink",
              i === 1 && "md:border-t-0 md:border-l",
              i === 2 && "md:border-t xl:border-t-0 xl:border-l",
              i === 3 && "md:border-l",
            )}
          >
            <h3 className={cn(t.label, "flex items-center gap-2.5")}>
              <span aria-hidden="true" className="inline-block size-4 shrink-0 border-[1.5px] border-ink" />
              {w.where}
            </h3>
            <p className={cn(t.body, "mt-3 text-ash")}>{w.body}</p>
            <p className={cn(t.data, "mt-auto pt-4 text-[0.875rem]")}>{w.link}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
