"use client";

import { useState, type ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";
import { CopyButton } from "@/components/app/copy-button";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

/**
 * Privacy mode (the eye in the top bar, html[data-private]) blurs every amount (.money). Keys,
 * invite links, addresses and log lines that carry amounts are more sensitive than any one amount
 * (a viewing key cannot be revoked), so they carry this class too. It is a Tailwind variant on the
 * element itself, so it needs no global stylesheet: add SENSITIVE to anything a screen share must
 * not show.
 */
export const SENSITIVE =
  "[html[data-private]_&]:blur-[6px] [html[data-private]_&]:select-none [html[data-private]_&]:transition-[filter]";

/** A span (or div) that privacy mode blurs. */
export function Sensitive({
  children,
  className,
  block = false,
}: {
  children: ReactNode;
  className?: string;
  block?: boolean;
}) {
  const Tag = block ? "div" : "span";
  return <Tag className={cn(SENSITIVE, className)}>{children}</Tag>;
}

/**
 * A secret shown masked until the reader asks to see it, with Copy beside it (copying never needs
 * a reveal). Used for invite links, which carry a viewing key: a screen share or a shoulder never
 * sees one by accident. Revealed text is still blurred in privacy mode.
 */
export function MaskedSecret({
  value,
  masked,
  label,
  className,
  revealLabel,
}: {
  /** The full text, copied and shown on reveal. */
  value: string;
  /** What shows while hidden, for example "portal#key=uvftest1…••••". */
  masked: string;
  /** What it is, for the copy button and the toast: "invite link for Amara Okafor". */
  label: string;
  className?: string;
  /** The reveal button's accessible name; defaults to "Show <label>". */
  revealLabel?: string;
}) {
  const [shown, setShown] = useState(false);
  return (
    <span className={cn("flex min-w-0 items-center gap-0.5", className)}>
      <code
        className={cn("min-w-0 flex-1 truncate font-mono text-[0.8125rem] text-muted-foreground", shown && SENSITIVE)}
        title={shown ? value : undefined}
      >
        {shown ? value.replace(/^https?:\/\//, "") : masked}
      </code>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
        aria-pressed={shown}
        aria-label={shown ? `Hide ${label}` : (revealLabel ?? `Show ${label}`)}
        title={shown ? "Hide" : "Reveal"}
        onClick={() => setShown((s) => !s)}
      >
        {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
      <CopyButton value={value} label={label} />
    </span>
  );
}
