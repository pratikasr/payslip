import { cn } from "cn";

/** The first letter of a word, by code point (never half of an emoji's surrogate pair). */
function firstLetter(word: string): string {
  return Array.from(word).find((ch) => /\p{L}/u.test(ch)) ?? "";
}

/**
 * Initials for a person or account: "Amara Okafor" -> "AO", "Zoë Ðoe 王小明 😀" -> "Z王". Only
 * letters count, so emoji and punctuation never produce a broken glyph, and the result is the
 * same on the server and in every browser.
 */
export function initials(name: string | null | undefined): string {
  const words = (name ?? "")
    .trim()
    .split(/\s+/)
    .filter((w) => firstLetter(w) !== "");
  if (words.length === 0) return "?";
  const first = firstLetter(words[0]);
  const last =
    words.length > 1
      ? firstLetter(words[words.length - 1])
      : (Array.from(words[0]).filter((ch) => /\p{L}/u.test(ch))[1] ?? "");
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
        // Initials never go below 11px, so two letters stay legible on any screen.
        size === "sm" && "size-6 text-[11px] tracking-normal",
        size === "md" && "size-7 text-[11px]",
        size === "lg" && "size-10 text-[0.8125rem]",
        className,
      )}
    >
      {text ?? initials(name)}
    </span>
  );
}
