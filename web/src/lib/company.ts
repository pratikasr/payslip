import { LogoMark } from "@/components/app/logo";

/*
  The company this deployment pays for: the employer a payroll product shows on its console,
  payslips, books and proofs. Read at build time from NEXT_PUBLIC_PAYSLIP_COMPANY_NAME; when
  sign-in is on, the organisation's own name and logo will override it.
*/

const DEFAULT_COMPANY_NAME = "Payslip Labs";

/** The company's name, from NEXT_PUBLIC_PAYSLIP_COMPANY_NAME; "Payslip Labs" when unset. */
export function companyName(): string {
  return process.env.NEXT_PUBLIC_PAYSLIP_COMPANY_NAME?.trim() || DEFAULT_COMPANY_NAME;
}

/** The company's mark: Payslip's own (components/app/logo.tsx) until an organisation brings a logo. */
export function companyMark(): typeof LogoMark {
  return LogoMark;
}

/** The line every testnet screen carries, so sample data is never read as a real payroll. */
export const SAMPLE_COMPANY_LINE = "Sample company on Zcash testnet";

/** Whether the data on screen is the sample company's: true on testnet, never on mainnet. */
export function isSampleCompany(network: string | undefined): boolean {
  return network === "testnet";
}
