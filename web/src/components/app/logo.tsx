import Link from "next/link";
import { cn } from "cn";

/**
 * The mark: a sealed coin. Two rings for the shielded pool and one gold bar for the value
 * only a key holder reads (the redaction bar that runs through the product). The bar is the only
 * gold in the app (docs/DESIGN.md section 17).
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 26 26" aria-hidden="true" className={cn("size-6", className)}>
      <circle cx="13" cy="13" r="12" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="13" cy="13" r="7.6" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.7" />
      <rect x="7.4" y="11.6" width="11.2" height="2.8" rx="1" fill="var(--id-gold)" />
    </svg>
  );
}

export function Logo({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center gap-2 font-type text-[0.9375rem] font-bold tracking-tight", className)}
    >
      <LogoMark />
      <span>Payslip</span>
    </Link>
  );
}

/**
 * The head of a small form on the desk (sign-in, an invitation, a gate): the mark and the name
 * typed on the left, the form's name in spaced caps on the right, ruled off in ink.
 */
export function SlipHead({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 border-b-2 border-ink pb-3", className)}>
      <span className="inline-flex items-center gap-2 font-type text-[0.9375rem] font-bold">
        <LogoMark className="size-[24px]" />
        Payslip
      </span>
      <span className="form-label text-[0.75rem] text-muted-foreground">{label}</span>
    </div>
  );
}
