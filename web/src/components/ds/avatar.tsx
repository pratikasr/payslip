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

/**
 * Initials typed in a small 1px box, the way a form abbreviates a name in a narrow column
 * (docs/DESIGN.md section 17). The same for every person, so a list of people stays ink on paper.
 * Decorative: the name is always written next to it.
 */
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
        "inline-grid shrink-0 place-items-center border border-current font-type leading-none font-bold tracking-[0.02em] text-strong",
        // Initials stay at the caption size, so two letters are legible on any screen.
        size === "sm" && "h-5 min-w-6 px-0.5 text-[0.75rem]",
        size === "md" && "h-6 min-w-7 px-0.5 text-[0.8125rem]",
        size === "lg" && "h-9 min-w-10 px-1 text-[0.9375rem]",
        className,
      )}
    >
      {text ?? initials(name)}
    </span>
  );
}
