import { cn } from "cn";

/** Initials for a person or account: "Amara Okafor" -> "AO". */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : (parts[0][1] ?? "");
  return (first + last).toUpperCase();
}

/** Mercury's pale initials avatar. Decorative: the name is always written next to it. */
export function Initials({
  name,
  text,
  className,
  size = "md",
}: {
  name?: string | null;
  text?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full bg-avatar font-medium tracking-wide text-strong",
        size === "sm" && "size-6 text-[9px]",
        size === "md" && "size-[26px] text-[9.5px]",
        size === "lg" && "size-9 text-xs",
        className,
      )}
    >
      {text ?? initials(name)}
    </span>
  );
}
