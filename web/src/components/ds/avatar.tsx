import { cn } from "cn";

/** Initials for a person or account: "Amara Okafor" -> "AO". */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : (parts[0][1] ?? "");
  return (first + last).toUpperCase();
}

/** Calm hues, so a list of people reads like Mercury's row of counterparty logos. */
const HUES = [205, 160, 28, 265, 340, 45, 185, 120];

function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return HUES[h % HUES.length];
}

/** A soft initials avatar, its colour fixed per name. Decorative: the name is always written next to it. */
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
  const seed = name ?? text ?? "";
  return (
    <span
      aria-hidden="true"
      style={seed ? ({ "--av-h": hueFor(seed) } as React.CSSProperties) : undefined}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full bg-avatar font-medium tracking-wide text-strong",
        seed &&
          "bg-[hsl(var(--av-h)_55%_92%)] text-[hsl(var(--av-h)_38%_30%)] dark:bg-[hsl(var(--av-h)_28%_24%)] dark:text-[hsl(var(--av-h)_50%_82%)]",
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
