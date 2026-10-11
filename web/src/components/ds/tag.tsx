import type { ReactNode } from "react";
import { cn } from "cn";

export type TagTone = "neutral" | "shielded" | "success" | "warning" | "danger" | "info";

const TONES: Record<TagTone, string> = {
  neutral: "border-current text-strong",
  shielded: "border-stamp text-stamp",
  success: "border-current bg-success-bg text-success",
  warning: "border-current bg-warning-bg text-warning",
  danger: "border-current bg-danger-bg text-destructive",
  info: "border-current bg-info-bg text-info",
};

/**
 * The status tag: typewriter caps in a 1px box, like the label of a check box on a printed form
 * (docs/DESIGN.md section 17). "Shielded" prints in the stamp's red; colour otherwise only for
 * states that need attention.
 */
export function Tag({
  tone = "neutral",
  children,
  className,
  dot,
  title,
}: {
  tone?: TagTone;
  children: ReactNode;
  className?: string;
  dot?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 border px-1.5 font-type text-[0.75rem] leading-none font-bold tracking-[0.08em] whitespace-nowrap uppercase",
        TONES[tone],
        className,
      )}
    >
      {dot || tone === "shielded" ? (
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", tone === "shielded" ? "bg-stamp" : "bg-current")}
        />
      ) : null}
      {children}
    </span>
  );
}
