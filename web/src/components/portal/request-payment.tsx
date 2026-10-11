"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { ExternalLink, HandCoins, Repeat } from "lucide-react";
import { toast } from "sonner";
import { Usd } from "@/components/app/amount";
import { describedBy, Field } from "@/components/app/field";
import { ErrorState } from "@/components/app/states";
import { Card, CardHeader } from "@/components/ds/card";
import { PageTitle, SectionHeader } from "@/components/ds/page";
import { StatusTag } from "@/components/ds/status";
import { usePersonName, usePortalKey } from "@/components/portal/portal-provider";
import { payslipHref } from "@/components/portal/portal-data";
import { requestTag } from "@/components/requests/request-meta";
import { monthRange, periodTitle, recentMonths } from "@/components/runs/run-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api, toDisplayError, type ApiError, type NewPaymentRequest, type PaymentRequest } from "@/lib/api";
import { companyName } from "@/lib/company";
import { formatDate, formatShortDate, parseUsdToCents, usdAmountProblem } from "@/lib/format";
import { isValidRange } from "@/lib/period";

const INVOICE_MAX = 64;
const NOTE_MAX = 1000;
/** What the memo can carry: printable ASCII without the "|" separator (service memo.rs). */
const INVOICE_CHARS = /^[\x20-\x7e]*$/;

type Errors = Partial<Record<"amount" | "period" | "invoice" | "due" | "note" | "form", string>>;

const FIELD_FOR_CODE: Record<string, keyof Errors> = {
  invalid_amount: "amount",
  invalid_period: "period",
  invalid_invoice_ref: "invoice",
  invoice_ref_too_long: "invoice",
  invalid_due_date: "due",
  note_too_long: "note",
};

/** The period choices: this month, the three before it, next month, or a custom range. */
function periodChoices(now = new Date()) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 7);
  const months = recentMonths(now, 4);
  return [
    {
      key: next,
      label: `${periodTitle(monthRange(Number(next.slice(0, 4)), Number(next.slice(5, 7)) - 1).from, monthRange(Number(next.slice(0, 4)), Number(next.slice(5, 7)) - 1).to)} (next month)`,
    },
    ...months,
  ];
}

/** Request a payment: the form, then every request this key has sent and where each one got to. */
export function RequestPayment() {
  const ufvk = usePortalKey();
  const name = usePersonName();
  const [list, setList] = useState<{ requests?: PaymentRequest[]; error?: ApiError; loading: boolean }>({
    loading: true,
  });
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setList((l) => ({ ...l, loading: true }));
      try {
        const r = await api.myRequests(ufvk, signal);
        if (!signal?.aborted) setList({ requests: r.requests, loading: false });
      } catch (err) {
        if (signal?.aborted) return;
        setList((l) => ({ requests: l.requests, error: toDisplayError(err), loading: false }));
      }
    },
    [ufvk],
  );
  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);
  // A key this Payslip does not know (a statements-only deployment, say): say so, and send nothing.
  const unknown = list.error?.code === "unknown_key";

  return (
    <>
      <PageTitle
        title="Request a payment"
        description={`Ask ${companyName()} to pay you for a period. Your payer sees it in their queue, and when it is paid the payslip appears here.`}
      />
      {unknown ? (
        <ErrorState error={list.error!} title="Requests cannot be sent from here" className="mb-6" />
      ) : (
        <RequestForm
          ufvk={ufvk}
          onSent={(r) => setList((l) => ({ requests: [r, ...(l.requests ?? [])], loading: false }))}
        />
      )}
      <SectionHeader title="Your requests" id="requests-heading" />
      {list.error && !unknown ? <ErrorState error={list.error} onRetry={() => void load()} className="mb-4" /> : null}
      {!list.requests && list.loading ? (
        <div role="status" aria-label="Loading your requests" className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : !list.requests || list.requests.length === 0 ? (
        <p className="border-y border-hairline py-6 text-[0.9375rem] text-muted-foreground">
          {unknown
            ? "Nothing to show from this Payslip."
            : `No requests yet${name ? `, ${name.split(/\s+/)[0]}` : ""}. The first one you send appears here with its status.`}
        </p>
      ) : (
        <ul aria-label="Your requests" className="border-t border-hairline">
          {list.requests.map((r) => (
            <RequestItem key={r.id} request={r} />
          ))}
        </ul>
      )}
    </>
  );
}

function RequestForm({ ufvk, onSent }: { ufvk: string; onSent: (r: PaymentRequest) => void }) {
  const uid = useId();
  const choices = useMemo(() => periodChoices(), []);
  const [amount, setAmount] = useState("");
  // Default: this month, the period most requests are for.
  const [month, setMonth] = useState<string>(choices[1]?.key ?? "custom");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [invoice, setInvoice] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [sending, setSending] = useState(false);

  const period =
    month === "custom" ? { from, to } : monthRange(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1);

  const validate = (): Errors => {
    const e: Errors = {};
    const cents = parseUsdToCents(amount);
    if (!amount.trim()) e.amount = "Enter the amount you are asking to be paid.";
    else if (cents === null) e.amount = usdAmountProblem(amount) ?? "Check this amount.";
    else if (cents <= 0) e.amount = "The amount must be more than zero.";
    else if (cents > 1_000_000_000) e.amount = "Keep the amount to $10,000,000 or less.";
    if (!isValidRange(period.from, period.to)) e.period = "Choose the period, with its start on or before its end.";
    else if (Date.parse(period.to) - Date.parse(period.from) > 366 * 86_400_000)
      e.period = "Keep the period to a year or less.";
    const inv = invoice.trim();
    if (!inv) e.invoice = "Add an invoice number. It is sealed in the payment's memo.";
    else if (inv.length > INVOICE_MAX) e.invoice = `Keep the invoice number to ${INVOICE_MAX} characters.`;
    else if (!INVOICE_CHARS.test(inv) || inv.includes("|"))
      e.invoice = "Use plain characters in the invoice number: no |, no accented letters and no emoji.";
    if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) e.due = "Use a date, or leave it empty.";
    if (note.trim().length > NOTE_MAX) e.note = `Keep the note to ${NOTE_MAX} characters.`;
    return e;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const e = validate();
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) {
      document.getElementById(`${uid}-${first}`)?.focus();
      return;
    }
    const body: NewPaymentRequest = {
      ufvk,
      amount_usd_cents: parseUsdToCents(amount) ?? 0,
      period_start: period.from,
      period_end: period.to,
      invoice_ref: invoice.trim(),
      ...(due ? { due_date: due } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(repeat ? { recurring: "monthly" as const } : {}),
    };
    setSending(true);
    try {
      const sent = await api.submitRequest(body);
      toast.success(`Request sent for ${periodTitle(sent.period_start, sent.period_end)}`, {
        description: "Your payer sees it in their queue.",
      });
      onSent(sent);
      setAmount("");
      setInvoice("");
      setDue("");
      setNote("");
      setRepeat(false);
      setErrors({});
    } catch (err) {
      const apiErr = toDisplayError(err);
      const field = FIELD_FOR_CODE[apiErr.code];
      const text = apiErr.hint ? `${apiErr.message} ${apiErr.hint}` : apiErr.message;
      setErrors(field ? { [field]: text } : { form: text });
    } finally {
      setSending(false);
    }
  };

  const id = (f: string) => `${uid}-${f}`;
  return (
    <Card as="div" className="mb-2">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <HandCoins className="size-4 text-muted-foreground" aria-hidden="true" />
            New request
          </span>
        }
      />
      <form onSubmit={submit} noValidate className="mt-4 grid gap-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={id("amount")} label="Amount (USD)" error={errors.amount}>
            <div className="relative">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[0.9375rem] text-muted-foreground"
              >
                $
              </span>
              <Input
                id={id("amount")}
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                placeholder="0.00"
                onChange={(e) => setAmount(e.target.value)}
                className="money h-10 pl-6 text-right tracking-normal"
                aria-invalid={!!errors.amount}
                aria-describedby={describedBy(id("amount"), errors.amount)}
              />
            </div>
          </Field>
          <Field id={id("invoice")} label="Invoice number" error={errors.invoice} help="Sealed in the payment's memo.">
            <Input
              id={id("invoice")}
              value={invoice}
              maxLength={INVOICE_MAX}
              autoComplete="off"
              placeholder="INV-2026-014"
              onChange={(e) => setInvoice(e.target.value)}
              className="h-10"
              aria-invalid={!!errors.invoice}
              aria-describedby={describedBy(id("invoice"), errors.invoice, true)}
            />
          </Field>
        </div>
        <Field id={id("period")} label="Period" error={errors.period}>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-full sm:w-64">
              <NativeSelect
                id={id("period")}
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="h-10"
                aria-invalid={!!errors.period}
              >
                {choices.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
                <option value="custom">Custom range</option>
              </NativeSelect>
            </div>
            {month === "custom" ? (
              <>
                <label className="sr-only" htmlFor={id("from")}>
                  Period starts
                </label>
                <Input
                  id={id("from")}
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="h-10 w-[10.5rem]"
                />
                <span className="text-[0.8125rem] text-muted-foreground">to</span>
                <label className="sr-only" htmlFor={id("to")}>
                  Period ends
                </label>
                <Input
                  id={id("to")}
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="h-10 w-[10.5rem]"
                />
              </>
            ) : null}
          </div>
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id={id("due")} label="Due date" optional error={errors.due}>
            <Input
              id={id("due")}
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="h-10 w-[10.5rem]"
              aria-invalid={!!errors.due}
              aria-describedby={describedBy(id("due"), errors.due)}
            />
          </Field>
          <label className="flex cursor-pointer items-start gap-2.5 pt-1 text-[0.9375rem] sm:pt-7">
            <input
              type="checkbox"
              checked={repeat}
              onChange={(e) => setRepeat(e.target.checked)}
              className="mt-1 size-4 rounded accent-[var(--primary-edge)]"
            />
            <span>
              <span className="inline-flex items-center gap-1.5">
                <Repeat className="size-3.5 text-muted-foreground" aria-hidden="true" />
                Repeat monthly
              </span>
              <span className="block text-[0.8125rem] text-muted-foreground">
                When this one is paid, the same request is sent for the next month.
              </span>
            </span>
          </label>
        </div>
        <Field id={id("note")} label="Note to your payer" optional error={errors.note}>
          <Textarea
            id={id("note")}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={NOTE_MAX}
            aria-invalid={!!errors.note}
            aria-describedby={describedBy(id("note"), errors.note)}
          />
        </Field>
        {errors.form ? (
          <p role="alert" className="rounded-lg bg-danger-bg p-3 text-[0.8125rem] text-danger">
            {errors.form}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
          <Button type="submit" disabled={sending}>
            {sending ? "Sending" : "Send request"}
          </Button>
          <span className="text-[0.8125rem] text-muted-foreground">
            Your viewing key identifies you; it is sent to the Payslip service and nowhere else.
          </span>
        </div>
      </form>
    </Card>
  );
}

function RequestItem({ request: r }: { request: PaymentRequest }) {
  const tag = requestTag(r);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 border-b border-hairline py-3.5">
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-[0.9375rem]">{periodTitle(r.period_start, r.period_end)}</span>
          <StatusTag status={tag} />
          {r.recurring ? (
            <span className="inline-flex items-center gap-1 text-[0.8125rem] text-muted-foreground">
              <Repeat className="size-3" aria-hidden="true" />
              Repeats
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">
          {r.invoice_ref}, sent {formatShortDate(r.created_at)}
          {r.due_date ? `, due ${formatShortDate(r.due_date)}` : ""}
        </span>
        {r.status === "rejected" && r.decision_note ? (
          <span className="mt-1 block text-[0.8125rem] text-strong [overflow-wrap:anywhere]">
            Your payer wrote: {r.decision_note}
          </span>
        ) : r.decision_note ? (
          <span className="mt-1 block text-[0.8125rem] text-muted-foreground [overflow-wrap:anywhere]">
            Your payer wrote: {r.decision_note}
          </span>
        ) : null}
        {r.status === "paid" && r.txid ? (
          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem]">
            <Link
              href={payslipHref({ txid: r.txid })}
              className="inline-flex items-center rounded-sm text-link underline decoration-1 underline-offset-[3px] hover:decoration-2"
            >
              Payslip
            </Link>
            {r.explorer_url ? (
              <a
                href={r.explorer_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-sm text-muted-foreground hover:text-foreground"
              >
                <code className="font-mono">
                  {r.txid.slice(0, 8)}…{r.txid.slice(-6)}
                </code>
                <ExternalLink className="size-3" aria-hidden="true" />
                <span className="sr-only">Open in a block explorer (opens in a new tab)</span>
              </a>
            ) : null}
            {r.paid_at ? <span className="text-muted-foreground">paid {formatDate(r.paid_at)}</span> : null}
          </span>
        ) : null}
      </span>
      <Usd cents={r.amount_usd_cents} className="text-right text-[0.9375rem]" />
    </li>
  );
}
