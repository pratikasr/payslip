import type { ReactNode } from "react";
import { cn } from "cn";

export type TagTone = "neutral" | "shielded" | "success" | "warning" | "danger" | "info";

const TONES: Record<TagTone, string> = {
  neutral: "bg-chip text-strong",
  shielded: "bg-primary-soft text-strong",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-destructive",
  info: "bg-info-bg text-info",
};

/**
 * Mercury's status tag: 12px text on a 10 to 15% tint, 4px corners. Gold ("shielded") marks a
 * private payment; colour otherwise only for states that need attention.
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
        "inline-flex h-[22px] items-center gap-1.5 rounded-[4px] px-2 text-xs whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {dot || tone === "shielded" ? (
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", tone === "shielded" ? "bg-primary-edge" : "bg-current")}
        />
      ) : null}
      {children}
    </span>
  );
}
