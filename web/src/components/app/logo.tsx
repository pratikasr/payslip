import Link from "next/link";
import { cn } from "cn";

/**
 * The mark is a payslip with one line written and one line sealed: the
 * redaction bar is the product's idea, a record that only key holders read.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-6", className)}>
      <rect x="3.5" y="2.5" width="17" height="19" rx="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <rect x="7" y="7" width="7" height="1.8" rx="0.9" fill="currentColor" />
      <rect x="7" y="11.2" width="10" height="3.2" rx="1" fill="var(--primary)" />
      <rect x="7" y="16.6" width="5" height="1.8" rx="0.9" fill="currentColor" opacity="0.55" />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-2 rounded-md text-[0.9375rem] font-semibold tracking-tight",
        className,
      )}
    >
      <LogoMark />
      <span>Payslip</span>
    </Link>
  );
}
