import Link from "next/link";
import { cn } from "cn";

/**
 * The mark: a sealed coin. Two rings for the shielded pool and one gold bar for the value
 * only a key holder reads (the redaction bar that runs through the product).
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 26 26" aria-hidden="true" className={cn("size-6", className)}>
      <circle cx="13" cy="13" r="12" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="13" cy="13" r="7.6" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.7" />
      <rect x="7.4" y="11.6" width="11.2" height="2.8" rx="1" fill="var(--primary)" />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center gap-2 rounded-md text-[0.9375rem] font-medium tracking-tight", className)}
    >
      <LogoMark />
      <span>Payslip</span>
    </Link>
  );
}
