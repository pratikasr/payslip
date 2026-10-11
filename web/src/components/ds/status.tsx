import type { ReactNode } from "react";
import { Tag, type TagTone } from "@/components/ds/tag";
import { cn } from "cn";

/**
 * One status, defined once: the word on screen, its tone, an optional live dot, and the sentence
 * that explains it (shown as a tooltip and read by screen readers). Every status map in the app
 * (runs, pay lines, funding, payslip access) produces this shape; docs/DESIGN.md section 7 lists
 * the words.
 */
export interface StatusInfo {
  label: string;
  tone: TagTone;
  /** A dot for a state that is still moving (paying, sending). */
  dot?: boolean;
  /** One sentence: what the state means for the reader. */
  help: string;
}

/** The app's one status tag. Green only for a run that is paid; grey for normal states. */
export function StatusTag({ status, className }: { status: StatusInfo; className?: string }) {
  return (
    <Tag tone={status.tone} dot={status.dot} title={status.help || undefined} className={className}>
      {status.label}
    </Tag>
  );
}

export const SHIELDED_HELP = "Amount, sender and recipient hidden on chain";

/**
 * The mark of a shielded payment: a tiny red stamp, the word in typewriter caps in a box, with
 * what it means in the tooltip (docs/DESIGN.md section 17). It
 * stands where a normal status would be, so a payment row says what makes it different (nobody
 * else can read it) instead of a grey "Paid". In a table, say once what it means (the caption
 * does); `explain` adds the sentence for screen readers where the mark stands alone.
 */
export function ShieldedMark({
  className,
  label = "Shielded",
  detail,
  explain = false,
}: {
  className?: string;
  label?: ReactNode;
  /** A short addition after the word, for example ", 08:13 UTC" (it carries its own comma). */
  detail?: ReactNode;
  explain?: boolean;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-[0.8125rem] whitespace-nowrap", className)}
      title={SHIELDED_HELP}
    >
      <span className="inline-block -rotate-2 border-[1.5px] border-stamp px-1 py-px font-type text-[0.6875rem] leading-none font-bold tracking-[0.12em] text-stamp uppercase">
        {label}
        {explain ? <span className="sr-only normal-case">: {SHIELDED_HELP.toLowerCase()}</span> : null}
      </span>
      {detail ? <span className="font-type text-muted-foreground">{detail}</span> : null}
    </span>
  );
}
