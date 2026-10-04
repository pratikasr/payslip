/* Date helpers. All periods are UTC calendar dates in YYYY-MM-DD form. */

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function todayUtc(now = new Date()): string {
  return iso(now);
}

/** The previous calendar month, e.g. on 5 Oct 2026: 2026-09-01 to 2026-09-30. */
export function previousMonth(now = new Date()): { from: string; to: string } {
  const firstThisMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const lastPrev = new Date(firstThisMonth - 24 * 60 * 60 * 1000);
  const firstPrev = new Date(Date.UTC(lastPrev.getUTCFullYear(), lastPrev.getUTCMonth(), 1));
  return { from: iso(firstPrev), to: iso(lastPrev) };
}

export function thisMonthToDate(now = new Date()): { from: string; to: string } {
  return { from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: iso(now) };
}

export function yearToDate(now = new Date()): { from: string; to: string } {
  return { from: `${now.getUTCFullYear()}-01-01`, to: iso(now) };
}

export function lastNDays(n: number, now = new Date()): { from: string; to: string } {
  return { from: iso(new Date(now.getTime() - (n - 1) * 24 * 60 * 60 * 1000)), to: iso(now) };
}

export function isValidRange(from: string, to: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) && from <= to;
}

export const PERIOD_PRESETS = [
  { id: "ytd", label: "Year to date", range: yearToDate },
  { id: "last-month", label: "Last month", range: previousMonth },
  { id: "this-month", label: "This month", range: thisMonthToDate },
  { id: "90d", label: "Last 90 days", range: (now?: Date) => lastNDays(90, now) },
] as const;
