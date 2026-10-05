"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Repeat, UsersRound } from "lucide-react";
import { Usd } from "@/components/app/amount";
import { EmptyState, ErrorState, PageHeader, Panel, TableSkeleton } from "@/components/app/states";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useResource } from "@/hooks/use-resource";
import { api, toDisplayError, type ApiError, type Contractor, type Run } from "@/lib/api";
import { formatPeriodLabel, formatRange, parseUsdToCents } from "@/lib/format";
import { isValidRange, previousMonth } from "@/lib/period";
import { cn } from "cn";

const INVOICE_MAX = 64;

interface LineState {
  include: boolean;
  amount: string;
  invoice: string;
}

/** crypto.randomUUID needs a secure context; fall back to getRandomValues elsewhere. */
function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function NewRunForm() {
  const contractors = useResource((s) => api.contractors(s), "contractors");

  return (
    <div className="space-y-6">
      <PageHeader
        title="New run"
        back={{ href: "/app/payer/runs", label: "Runs" }}
        description="Choose the period and what each contractor is owed in USD. You fund and execute on the next screen."
      />
      {contractors.error ? (
        <ErrorState error={contractors.error} onRetry={contractors.reload} />
      ) : !contractors.data ? (
        <Panel>
          <TableSkeleton label="Loading contractors" columns={3} />
        </Panel>
      ) : contractors.data.length === 0 ? (
        <Panel>
          <EmptyState
            icon={<UsersRound />}
            title="Add contractors before creating a run"
            action={
              <Button asChild>
                <Link href="/app/payer/contractors">Add contractors</Link>
              </Button>
            }
          >
            A run has one line per contractor. Once you add them, they appear here ready for amounts.
          </EmptyState>
        </Panel>
      ) : (
        <RunForm contractors={[...contractors.data].sort((a, b) => a.account_index - b.account_index)} />
      )}
    </div>
  );
}

function RunForm({ contractors }: { contractors: Contractor[] }) {
  const router = useRouter();
  const defaults = previousMonth();
  const [from, setFrom] = useState(defaults.from);
  const [to, setTo] = useState(defaults.to);
  const [lines, setLines] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(contractors.map((c) => [c.id, { include: true, amount: "", invoice: "" }])),
  );
  // Generated once per form so a double submit or a retry returns the same run.
  const [idempotencyKey] = useState(newIdempotencyKey);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<ApiError | null>(null);

  const update = (id: string, patch: Partial<LineState>) =>
    setLines((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  // Repeat a run: the run named in ?repeat=<id>, else the most recent one.
  const runs = useResource((s) => api.runs(s), "runs");
  const [repeatId, setRepeatId] = useState<string | null>(null);
  useEffect(() => {
    setRepeatId(new URLSearchParams(window.location.search).get("repeat"));
  }, []);
  const source: Run | undefined = useMemo(() => {
    const all = runs.data ?? [];
    return (
      all.find((r) => r.id === repeatId) ??
      [...all].sort((a, b) => b.created_at.localeCompare(a.created_at)).find((r) => r.lines.length > 0)
    );
  }, [runs.data, repeatId]);
  const [repeated, setRepeated] = useState<string | null>(null);
  const repeat = (run: Run) => {
    const byContractor = new Map(run.lines.map((l) => [l.contractor_id, l]));
    setLines(
      Object.fromEntries(
        contractors.map((c) => {
          const l = byContractor.get(c.id);
          return [c.id, { include: !!l, amount: l ? (l.amount_usd_cents / 100).toFixed(2) : "", invoice: "" }];
        }),
      ),
    );
    setRepeated(run.period_label);
  };
  // Arriving from a run's "Repeat" link fills the form straight away.
  useEffect(() => {
    if (repeatId && source?.id === repeatId && repeated === null) repeat(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeatId, source]);

  const included = contractors.filter((c) => lines[c.id]?.include);
  const lineErrors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of included) {
      const l = lines[c.id];
      const cents = parseUsdToCents(l.amount);
      if (!l.amount.trim()) out[c.id] = "Enter an amount, or untick this contractor.";
      else if (cents === null) out[c.id] = "Use a number with up to 2 decimals, like 4800 or 4800.50.";
      else if (cents <= 0) out[c.id] = "The amount must be more than zero.";
      else if (l.invoice.length > INVOICE_MAX) out[c.id] = `Keep the invoice reference to ${INVOICE_MAX} characters.`;
    }
    return out;
  }, [included, lines]);

  const periodError = !isValidRange(from, to) ? "The period must start on or before the day it ends." : null;
  const noneError = included.length === 0 ? "Include at least one contractor." : null;
  const totalCents = included.reduce((sum, c) => sum + Math.max(0, parseUsdToCents(lines[c.id].amount) ?? 0), 0);
  const valid = !periodError && !noneError && Object.keys(lineErrors).length === 0;
  const periodLabel = from.slice(0, 7) === to.slice(0, 7) ? formatPeriodLabel(from.slice(0, 7)) : formatRange(from, to);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setServerError(null);
    if (!valid || submitting) {
      const firstBad = included.find((c) => lineErrors[c.id]);
      if (firstBad) document.getElementById(`amount-${firstBad.id}`)?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const run = await api.createRun({
        period_start: from,
        period_end: to,
        idempotency_key: idempotencyKey,
        lines: included.map((c) => ({
          contractor_id: c.id,
          amount_usd_cents: parseUsdToCents(lines[c.id].amount) ?? 0,
          invoice_ref: lines[c.id].invoice.trim(),
        })),
      });
      router.push(`/app/payer/runs/${run.id}`);
    } catch (err) {
      setServerError(toDisplayError(err));
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6">
      <Panel
        title="Period"
        description="The period these payments cover. It is written into every memo and statement line."
      >
        <div className="grid gap-4 p-4 sm:grid-cols-[12rem_12rem_minmax(0,1fr)] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="period-start">Starts</Label>
            <Input
              id="period-start"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              required
              aria-invalid={submitted && !!periodError}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="period-end">Ends</Label>
            <Input
              id="period-end"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              required
              aria-invalid={submitted && !!periodError}
              aria-describedby={periodError ? "period-error" : undefined}
            />
          </div>
          <p className={cn("text-sm", periodError ? "text-danger" : "text-muted-foreground")} id="period-error">
            {periodError ?? `Defaults to last calendar month (${periodLabel}).`}
          </p>
        </div>
      </Panel>

      <Panel
        title="Pay lines"
        description={
          repeated
            ? `Amounts copied from the ${formatPeriodLabel(repeated)} run. Add this period's invoice references.`
            : "One line per contractor. Amounts are in USD; the ZEC amount is fixed at the fill rate when the run is funded."
        }
        actions={
          source ? (
            <Button type="button" variant="outline" size="sm" onClick={() => repeat(source)}>
              <Repeat aria-hidden="true" />
              Copy amounts from {formatPeriodLabel(source.period_label)}
            </Button>
          ) : undefined
        }
      >
        <div className="hidden grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 border-b px-4 py-2 text-xs font-medium text-muted-foreground md:grid">
          <span>Contractor</span>
          <span className="text-right">Amount (USD)</span>
          <span>Invoice reference</span>
        </div>
        <ul className="divide-y">
          {contractors.map((c) => {
            const l = lines[c.id];
            const err = submitted && l.include ? lineErrors[c.id] : undefined;
            return (
              <li
                key={c.id}
                className={cn(
                  "grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-start md:gap-4",
                  !l.include && "bg-muted/40",
                )}
              >
                <div className="flex min-h-9 items-center gap-3">
                  <input
                    id={`include-${c.id}`}
                    type="checkbox"
                    checked={l.include}
                    onChange={(e) => update(c.id, { include: e.target.checked })}
                    className="size-4 rounded accent-[var(--primary-edge)]"
                  />
                  <label htmlFor={`include-${c.id}`} className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      Account {c.account_index}, {c.settlement_choice === "hold_zec" ? "holds ZEC" : "converts to USDC"}
                    </span>
                  </label>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`amount-${c.id}`} className="md:sr-only">
                    Amount for {c.name} (USD)
                  </Label>
                  <div className="relative">
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground"
                    >
                      $
                    </span>
                    <Input
                      id={`amount-${c.id}`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={l.amount}
                      disabled={!l.include}
                      onChange={(e) => update(c.id, { amount: e.target.value })}
                      className="num pl-6 text-right"
                      aria-invalid={!!err}
                      aria-describedby={err ? `line-error-${c.id}` : undefined}
                    />
                  </div>
                  {err ? (
                    <p id={`line-error-${c.id}`} className="text-sm text-danger">
                      {err}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`invoice-${c.id}`} className="md:sr-only">
                    Invoice reference for {c.name}
                  </Label>
                  <Input
                    id={`invoice-${c.id}`}
                    value={l.invoice}
                    disabled={!l.include}
                    maxLength={INVOICE_MAX}
                    autoComplete="off"
                    onChange={(e) => update(c.id, { invoice: e.target.value })}
                  />
                </div>
              </li>
            );
          })}
        </ul>
        <div className="flex flex-col gap-1 border-t bg-muted/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">
            {included.length} of {contractors.length} contractors included
          </span>
          <span className="text-sm">
            Total <Usd cents={totalCents} className="ml-2 text-base font-semibold" />
          </span>
        </div>
      </Panel>

      {submitted && noneError ? (
        <p role="alert" className="text-sm text-danger">
          {noneError}
        </p>
      ) : null}
      {serverError ? <ErrorState error={serverError} /> : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="outline">
          <Link href="/app/payer/runs">Cancel</Link>
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Creating run" : "Create run"}
        </Button>
      </div>
    </form>
  );
}
