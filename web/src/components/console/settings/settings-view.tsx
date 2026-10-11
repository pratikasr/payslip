"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useState } from "react";
import { CalendarClock, Check } from "lucide-react";
import { toast } from "sonner";
import { Usd } from "@/components/app/amount";
import { useAuth } from "@/components/auth/auth-provider";
import { Initials } from "@/components/ds/avatar";
import { Card, CardHeader } from "@/components/ds/card";
import { PageTitle } from "@/components/ds/page";
import { Tag } from "@/components/ds/tag";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useResource } from "@/hooks/use-resource";
import {
  api,
  toDisplayError,
  type ApiError,
  type Cadence,
  type Contractor,
  type Organisation,
  type PaySchedule,
} from "@/lib/api";
import { formatCount, formatDate } from "@/lib/format";
import { CADENCES, nextDraftSentence, payDayOptions, scheduleSentence } from "@/components/requests/request-meta";
import { OrgSettings } from "@/components/console/org/settings-view";
import { Problem } from "@/components/runs/problem";
import { periodTitle } from "@/components/runs/run-meta";

/**
 * Settings: with sign-in on, the organisation's name and logo (admins); for everyone, the pay
 * schedule (ADR-028) and who has a default amount for its drafts. The schedule is changed by
 * those who run payroll.
 */
export function SettingsView({
  initial,
}: {
  initial: { org?: Organisation; schedule?: PaySchedule | null; contractors?: Contractor[] };
}) {
  const auth = useAuth();
  const schedule = useResource((s) => api.schedule(s), "settings-schedule", initial.schedule);
  const contractors = useResource((s) => api.contractors(s), "settings-contractors", initial.contractors);
  return (
    <>
      <PageTitle
        title="Settings"
        description={
          auth.required
            ? "The organisation as members see it, when payroll is drafted, and what each person is usually paid."
            : "When payroll is drafted, and what each person is usually paid."
        }
      />
      <OrgSettings initial={initial.org} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <ScheduleCard
          schedule={schedule.data ?? null}
          loading={schedule.loading && schedule.data === undefined}
          error={schedule.error}
          editable={auth.can("manage_runs")}
          onSaved={(s) => schedule.setData(s)}
          onRetry={schedule.reload}
        />
        <DefaultsCard contractors={contractors.data} error={contractors.error} onRetry={contractors.reload} />
      </div>
    </>
  );
}

function ScheduleCard({
  schedule,
  loading,
  error,
  editable,
  onSaved,
  onRetry,
}: {
  schedule: PaySchedule | null;
  loading: boolean;
  error: ApiError | undefined;
  /** False for a role that cannot run payroll: the schedule is shown, not changed. */
  editable: boolean;
  onSaved: (s: PaySchedule) => void;
  onRetry: () => void;
}) {
  const uid = useId();
  const [cadence, setCadence] = useState<Cadence>("monthly");
  const [payDay, setPayDay] = useState("last");
  const [daysBefore, setDaysBefore] = useState("5");
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<ApiError | null>(null);
  // The form follows the saved schedule until the payer edits it.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched || !schedule) return;
    setCadence(schedule.cadence);
    setPayDay(schedule.pay_day);
    setDaysBefore(String(schedule.draft_days_before));
    setActive(schedule.active);
  }, [schedule, touched]);

  const options = useMemo(() => payDayOptions(cadence), [cadence]);
  const changeCadence = (c: Cadence) => {
    setTouched(true);
    setCadence(c);
    // A weekday makes no sense for a monthly schedule and the other way round.
    const first = payDayOptions(c);
    if (!first.some((o) => o.value === payDay)) setPayDay(c === "monthly" ? "last" : "friday");
  };
  const days = Number(daysBefore);
  const daysBad = !/^\d{1,2}$/.test(daysBefore.trim()) || days < 0 || days > 28;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (daysBad) {
      document.getElementById(`${uid}-days`)?.focus();
      return;
    }
    setSaving(true);
    setProblem(null);
    try {
      const saved = await api.saveSchedule({ cadence, pay_day: payDay, draft_days_before: days, active });
      onSaved(saved);
      setTouched(false);
      toast.success(
        saved.drafted && saved.drafted.status === "draft"
          ? `Schedule saved. The ${periodTitle(saved.drafted.period_start, saved.drafted.period_end)} payroll is drafted.`
          : "Schedule saved",
      );
    } catch (err) {
      setProblem(toDisplayError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card aria-labelledby="schedule-title">
      <CardHeader id="schedule-title" title="Pay schedule" />
      <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">
        Payslip drafts each payroll a few days before its pay day, from default amounts and approved requests. Nothing
        is funded or paid until you review it.
      </p>
      {error && !schedule && !loading ? (
        <Problem className="mt-4" error={error} title="Could not load the schedule" onRetry={onRetry} />
      ) : null}
      {!editable ? (
        <p className="mt-4 text-[0.8125rem] text-muted-foreground">
          Admins and approvers set the schedule; your role reads it.
        </p>
      ) : null}
      <form onSubmit={save} noValidate className="mt-5 grid gap-4" hidden={!editable}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-cadence`}>Cadence</Label>
            <NativeSelect
              id={`${uid}-cadence`}
              value={cadence}
              onChange={(e) => changeCadence(e.target.value as Cadence)}
              className="h-10"
            >
              {CADENCES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-payday`}>Pay day</Label>
            <NativeSelect
              id={`${uid}-payday`}
              value={payDay}
              onChange={(e) => {
                setTouched(true);
                setPayDay(e.target.value);
              }}
              className="h-10"
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
            <p className="text-[0.8125rem] text-muted-foreground">
              {cadence === "monthly"
                ? "A monthly payroll covers the calendar month and is paid on this day of it."
                : "The period ends on this day and is paid on it."}
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-days`}>Draft days before the pay day</Label>
            <Input
              id={`${uid}-days`}
              inputMode="numeric"
              value={daysBefore}
              onChange={(e) => {
                setTouched(true);
                setDaysBefore(e.target.value);
              }}
              aria-invalid={daysBad}
              aria-describedby={`${uid}-days-help`}
              className="h-10 w-28"
            />
            <p
              id={`${uid}-days-help`}
              className={daysBad ? "text-[0.8125rem] text-danger" : "text-[0.8125rem] text-muted-foreground"}
            >
              {daysBad ? "Use a whole number from 0 to 28." : "0 to 28. The draft appears on that day."}
            </p>
          </div>
          <label className="flex cursor-pointer items-start gap-2.5 pt-6 font-type text-[0.9375rem]">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => {
                setTouched(true);
                setActive(e.target.checked);
              }}
              className="mt-1 size-4 accent-[var(--primary-edge)]"
            />
            <span>
              Draft payroll on this schedule
              <span className="block font-sans text-[0.8125rem] text-muted-foreground">
                Switched off, the schedule is kept but drafts nothing.
              </span>
            </span>
          </label>
        </div>
        {problem ? <Problem error={problem} title="The schedule was not saved" /> : null}
        <div className="flex flex-wrap items-center gap-3 border-t border-ink pt-4">
          <Button type="submit" disabled={saving || daysBad}>
            {saving ? "Applying" : schedule ? "Update schedule" : "Set schedule"}
          </Button>
          {schedule && !touched ? (
            <span className="inline-flex items-center gap-1.5 font-type text-[0.8125rem] text-muted-foreground">
              <Check className="size-3.5 text-success" aria-hidden="true" />
              Saved {formatDate(schedule.updated_at)}
            </span>
          ) : null}
        </div>
      </form>
      <ScheduleStatus schedule={schedule} loading={loading} />
    </Card>
  );
}

/** What the saved schedule means in dates: the next draft, and the draft waiting for review. */
function ScheduleStatus({ schedule: s, loading }: { schedule: PaySchedule | null; loading: boolean }) {
  if (loading) return null;
  if (!s) {
    return (
      <p
        className="mt-5 border-t border-ink pt-4 font-type text-[0.9375rem] text-muted-foreground"
        data-testid="schedule-none"
      >
        No schedule yet. Payroll is run by hand from Run payroll.
      </p>
    );
  }
  const next = periodTitle(s.next_period_start, s.next_period_end);
  return (
    <dl
      className="green-bar mt-5 grid border-y-2 border-ink font-type text-[0.9375rem] [&>div]:px-2 [&>div]:py-2.5"
      data-testid="schedule-status"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-7 shrink-0 place-items-center border border-ink text-strong">
          <CalendarClock className="size-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <dt className="form-label text-[0.75rem] font-bold text-muted-foreground">Schedule</dt>
          <dd>{scheduleSentence(s)}</dd>
        </div>
      </div>
      <div className="flex items-start gap-3">
        <span className="size-7 shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <dt className="form-label text-[0.75rem] font-bold text-muted-foreground">Next</dt>
          <dd>
            {next} payroll{s.active ? `, ${nextDraftSentence(s)}` : " (schedule off)"}
          </dd>
        </div>
      </div>
      {s.drafted ? (
        <div className="flex items-start gap-3">
          <span className="size-7 shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <dt className="form-label text-[0.75rem] font-bold text-muted-foreground">Drafted</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <Link
                href={`/console/runs/new?run=${s.drafted.run_id}`}
                className="font-bold text-link underline decoration-1 underline-offset-[3px] hover:decoration-2"
              >
                {periodTitle(s.drafted.period_start, s.drafted.period_end)} payroll
              </Link>
              {s.drafted.pay_day ? (
                <span className="text-muted-foreground">review by {formatDate(s.drafted.pay_day)}</span>
              ) : null}
              {s.overdue ? <Tag tone="warning">Overdue</Tag> : null}
            </dd>
          </div>
        </div>
      ) : null}
    </dl>
  );
}

function DefaultsCard({
  contractors,
  error,
  onRetry,
}: {
  contractors: Contractor[] | undefined;
  error: ApiError | undefined;
  onRetry: () => void;
}) {
  const people = useMemo(
    () => (contractors ?? []).slice().sort((a, b) => a.account_index - b.account_index),
    [contractors],
  );
  const withDefault = people.filter((c) => c.default_amount_usd_cents);
  return (
    <Card aria-labelledby="defaults-title" className="flex flex-col">
      <CardHeader
        id="defaults-title"
        title="Default amounts"
        actions={
          people.length > 0 ? (
            <span className="num font-type text-[0.8125rem] font-bold text-muted-foreground">
              {formatCount(withDefault.length)} of {formatCount(people.length)}
            </span>
          ) : null
        }
      />
      <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">
        What a scheduled draft pays each person unless they sent a request for the period. Change it from the person in
        People.
      </p>
      {error && !contractors ? (
        <Problem className="mt-4" error={error} title="Could not load your people" onRetry={onRetry} />
      ) : people.length === 0 ? (
        <p className="mt-4 font-type text-[0.9375rem] text-muted-foreground">
          Nobody yet. Add people first, then set what each is paid by default.
        </p>
      ) : (
        <ul className="green-bar mt-3 border-y-2 border-ink font-type">
          {people.map((c) => (
            <li key={c.id} className="border-b border-bar-line last:border-b-0">
              <Link
                href={`/console/people?person=${c.id}`}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-2 py-2 transition-colors hover:bg-muted"
              >
                <Initials name={c.name} />
                <span className="min-w-0 truncate text-[0.9375rem]">{c.name}</span>
                {c.default_amount_usd_cents ? (
                  <Usd cents={c.default_amount_usd_cents} />
                ) : (
                  <span className="text-[0.8125rem] text-muted-foreground">None</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
