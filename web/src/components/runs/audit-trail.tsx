"use client";

import { Rate, Usd, Zec } from "@/components/app/amount";
import { Hash } from "@/components/app/hash";
import { Card, CardHeader } from "@/components/ds/card";
import { Disclosure } from "@/components/ds/disclosure";
import { Sensitive } from "@/components/ds/sensitive";
import { SimulatedRate } from "@/components/ds/simulated-rate";
import { StatusTag } from "@/components/ds/status";
import { Timeline, type TimelineItem } from "@/components/ds/timeline";
import type { Run, RunLogEvent } from "@/lib/api";
import { formatHeight, formatShortDate, formatTime, venueLabel } from "@/lib/format";
import { runCoin } from "@/lib/payroll";
import { roleLabel } from "@/lib/roles";
import { auditTimeline, chainName, type LogEvent, type TimelineEntry } from "@/lib/run-log";
import { Problem } from "./problem";
import { fundingTag, plural, runTitle } from "./run-meta";

const HEX64 = /\b[0-9a-f]{64}\b/gi;

/** A raw log line with each 64-hex txid shortened; the full text stays in the title. */
function LogText({ message }: { message: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of message.matchAll(HEX64)) {
    const i = m.index ?? 0;
    parts.push(message.slice(last, i));
    parts.push(
      <code key={i} className="font-mono text-[0.8125rem]" title={m[0]}>
        {m[0].slice(0, 8)}…{m[0].slice(-6)}
      </code>,
    );
    last = i + m[0].length;
  }
  parts.push(message.slice(last));
  return <>{parts}</>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2">
      <dt className="text-strong">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

/** "5 Oct, 08:13:12 UTC": the day and the second, as an audit wants them. */
function when(at: string | null | undefined): string | undefined {
  return at ? `${formatShortDate(at)}, ${formatTime(at)}` : undefined;
}

/** One log event in payroll words, with formatted money; null for nothing worth a line. */
function eventItem(event: LogEvent, at: string, run: Run, testnet: boolean): Omit<TimelineItem, "key"> | null {
  const time = when(at);
  const base = { time, dateTime: at };
  const coin = runCoin(run);
  switch (event.type) {
    case "created":
      // With approvals recorded by name, creating the run is not the approval.
      return {
        ...base,
        state: "done",
        title: `${(run.approvals_required ?? 0) > 0 ? "Created" : "Approved"}: ${plural(event.count, "payment")} for ${runTitle(run)}`,
      };
    case "approved":
      return {
        ...base,
        state: "done",
        title: `Approved by ${event.name} (${roleLabel(event.role).toLowerCase()})`,
        detail: `Approval ${event.have} of ${event.required}.`,
      };
    case "awaiting_approvals":
      return {
        ...base,
        state: "warning",
        title: `Waiting for ${event.missing === 1 ? "one more approval" : `${event.missing} more approvals`} before the swap is recorded`,
      };
    case "set_aside":
      return {
        ...base,
        state: "done",
        title:
          coin.acquired !== null ? (
            <>
              Set aside <Zec zat={coin.acquired} /> from the treasury
            </>
          ) : (
            "Set aside coins from the treasury"
          ),
        detail: "The payroll at the simulated rate, plus a reserve for network fees.",
      };
    case "zec_request":
      return {
        ...base,
        state: "done",
        title: (
          <>
            Fund with ZEC: send <Zec zat={event.zat} /> to the treasury
          </>
        ),
        detail: (
          <>
            At <Rate e6={event.rateE6} /> when requested; funded at the rate of the block in which it confirms.
          </>
        ),
      };
    case "zec_funded":
      return {
        ...base,
        state: "done",
        title: (
          <>
            Funded with <Zec zat={event.zat} /> from the treasury
          </>
        ),
        detail: (
          <>
            At <Rate e6={event.rateE6} />, the market rate of block {formatHeight(event.height)}.
          </>
        ),
      };
    case "quote":
      return {
        ...base,
        state: "done",
        title: `Quote received: send ${event.amount} USDC on ${chainName(event.chain)}`,
        detail: event.address ? (
          <Sensitive>
            To{" "}
            <code className="font-mono">
              {event.address.slice(0, 10)}…{event.address.slice(-8)}
            </code>
          </Sensitive>
        ) : undefined,
      };
    case "deposit_reported":
      return { ...base, state: "done", title: "Deposit transaction reported to the venue" };
    case "deposit_seen":
      return { ...base, state: "done", title: "The venue received the deposit" };
    case "swapping":
      return { ...base, state: "done", title: "The venue is converting USDC to ZEC" };
    case "swap_complete":
      return { ...base, state: "done", title: "The venue completed the swap" };
    case "filled":
      // On testnet the fill repeats the set-aside line above it in simulated dollars: skip it (the
      // service log below keeps it). On mainnet it is the real conversion.
      if (testnet) return null;
      return {
        ...base,
        state: "done",
        title: (
          <>
            Converted <Usd cents={event.cents} /> into <Zec zat={event.zat} />
          </>
        ),
        detail: (
          <>
            At <Rate e6={event.rateE6} />.
          </>
        ),
      };
    case "waiting_treasury":
      return {
        ...base,
        state: "warning",
        title: "Waiting for treasury coins to confirm",
        detail: (
          <>
            <Zec zat={event.haveZat} /> of <Zec zat={event.needZat} /> spendable.
          </>
        ),
      };
    case "allocation_rebuilt":
      return { ...base, state: "warning", title: "The move to each account expired before it was mined; rebuilt" };
    case "accounts_funded":
      return { ...base, state: "done", title: "Every account funded. Sending the payments" };
    case "run_paid":
      return { ...base, state: "done", title: `Payroll paid: all ${plural(event.count, "payment")} confirmed` };
    case "retrying":
      return { ...base, state: "warning", title: "Retrying after a temporary problem", detail: event.reason };
    case "paused":
      return { ...base, state: "warning", title: "Paused after repeated temporary problems. Resume the run to go on" };
    case "failed":
      return { ...base, state: "failed", title: "The run stopped", detail: event.reason };
    case "resumed":
      return { ...base, state: "done", title: "Resumed" };
    case "cancelled":
      return { ...base, state: "done", title: "Cancelled by the payer", detail: event.note || undefined };
    case "other":
      return { ...base, state: "done", title: <LogText message={event.text} /> };
    default:
      return null;
  }
}

/** The run's log as a payroll timeline: steps in sentences, one entry per person. */
function timelineItems(run: Run, logs: RunLogEvent[], testnet: boolean): TimelineItem[] {
  const items: TimelineItem[] = [];
  auditTimeline(run, logs).forEach((entry: TimelineEntry, i) => {
    if (entry.kind === "allocation") {
      items.push({
        key: `alloc-${i}`,
        state: entry.confirmedAt ? "done" : "current",
        title: entry.confirmedAt
          ? "Moved each person's pay into their own account"
          : "Moving each person's pay into their own account",
        detail: (
          <span className="inline-flex flex-wrap items-center gap-x-1.5">
            {entry.txid ? (
              <Hash
                value={entry.txid}
                label="allocation transaction id"
                explorerUrl={run.allocation_txid === entry.txid ? run.allocation_explorer_url : undefined}
                head={6}
                tail={4}
              />
            ) : null}
            {entry.height ? (
              <span className="num">
                confirmed in block {formatHeight(entry.height)}
                {entry.confirmedAt ? ` at ${formatTime(entry.confirmedAt)}` : ""}
              </span>
            ) : (
              <span>waiting to be mined</span>
            )}
          </span>
        ),
        time: when(entry.at),
        dateTime: entry.at,
      });
      return;
    }
    if (entry.kind === "person") {
      const line = run.lines.find((l) => l.id === entry.lineId);
      const confirmed = !!entry.confirmedAt;
      items.push({
        key: `person-${entry.name}`,
        state: confirmed ? "done" : entry.notes.length > 0 ? "warning" : "current",
        title: (
          <>
            {confirmed ? "Paid " : "Paying "}
            {entry.name}
            {line ? (
              <>
                {" "}
                <Usd cents={line.amount_usd_cents} className="text-strong" />
              </>
            ) : null}
          </>
        ),
        detail: (
          <span className="grid gap-0.5">
            {entry.txid ? (
              <span className="inline-flex flex-wrap items-center gap-x-1.5">
                <Hash
                  value={entry.txid}
                  label={`transaction id for ${entry.name}`}
                  explorerUrl={line?.txid === entry.txid ? line.explorer_url : undefined}
                  head={6}
                  tail={4}
                />
              </span>
            ) : null}
            <span className="num">
              {entry.height
                ? `Confirmed in block ${formatHeight(entry.height)}${entry.confirmedAt ? ` at ${formatTime(entry.confirmedAt)}` : ""}`
                : entry.sentAt
                  ? "Sent, waiting to be mined"
                  : "Not sent yet"}
            </span>
            {entry.notes.map((n, j) => (
              <span key={j} className="text-warning">
                {n.text}
              </span>
            ))}
          </span>
        ),
        time: when(entry.at),
        dateTime: entry.at,
      });
      return;
    }
    const item = eventItem(entry.event, entry.at, run, testnet);
    if (item) items.push({ key: `ev-${i}`, ...item });
  });
  return items;
}

/** What moved money for this run (funding and the move to each account), then its activity. */
export function AuditTrail({
  run,
  logs,
  loading,
  error,
}: {
  run: Run;
  logs: RunLogEvent[];
  loading: boolean;
  error?: { message: string; hint: string; code?: string };
}) {
  const f = run.funding;
  const testnet = f?.venue === "testnet-fixed-rate" || run.network === "testnet";
  const coin = runCoin(run);
  return (
    <div className="space-y-8">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Funding" actions={f ? <StatusTag status={fundingTag(f)} /> : undefined} />
          {f ? (
            <dl className="mt-3 text-[0.9375rem]">
              <Row label="Source">
                {testnet
                  ? "Testnet treasury"
                  : f.venue === "treasury"
                    ? "ZEC sent to the treasury"
                    : venueLabel(f.venue)}
              </Row>
              {testnet ? (
                <>
                  <Row label="Payroll">
                    <Usd cents={run.total_usd_cents} />
                  </Row>
                  <Row label="Set aside">
                    <Zec zat={f.zec_acquired_zat ?? f.quoted_zat ?? null} />
                  </Row>
                  <Row label="Rate">
                    <SimulatedRate rateE6={f.rate_usd_per_zec_e6} />
                  </Row>
                </>
              ) : (
                <>
                  <Row label="Funded">
                    <Usd cents={f.funded_usd_cents ?? f.requested_usd_cents ?? null} />
                  </Row>
                  <Row label="Acquired">
                    <Zec zat={f.zec_acquired_zat ?? f.quoted_zat ?? null} />
                  </Row>
                  <Row label="Rate">
                    <Rate e6={f.rate_usd_per_zec_e6 ?? f.quote_rate_e6 ?? null} />
                  </Row>
                </>
              )}
              {f.deposit_tx_hash ? (
                <Row label="Deposit">
                  <Hash value={f.deposit_tx_hash} label="deposit transaction hash" head={8} tail={6} />
                </Row>
              ) : null}
            </dl>
          ) : (
            <p className="mt-3 text-[0.9375rem] text-muted-foreground">Not funded yet.</p>
          )}
        </Card>
        <Card>
          <CardHeader title="Move to each account" />
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            One transaction moves each payment from the treasury to the contractor&apos;s own account.
          </p>
          {run.allocation_txid ? (
            <dl className="mt-3 text-[0.9375rem]">
              <Row label="Transaction">
                <Hash
                  value={run.allocation_txid}
                  label="allocation transaction id"
                  explorerUrl={run.allocation_explorer_url}
                  head={8}
                  tail={6}
                />
              </Row>
              <Row label="Block">
                {run.allocation_height ? (
                  <span className="num">{formatHeight(run.allocation_height)}</span>
                ) : (
                  <span className="text-muted-foreground">Waiting to be mined</span>
                )}
              </Row>
              <Row label="Network fees, whole run">
                {run.fees_zat ? (
                  <Zec zat={run.fees_zat} />
                ) : (
                  <span className="text-muted-foreground">After payment</span>
                )}
              </Row>
              {coin.unspent !== null ? (
                <Row label="Back in treasury">
                  <Zec zat={coin.unspent} />
                </Row>
              ) : null}
            </dl>
          ) : (
            <p className="mt-3 text-[0.9375rem] text-muted-foreground">Not sent yet.</p>
          )}
        </Card>
      </div>

      <section aria-labelledby="activity-title">
        <h2 id="activity-title" className="mb-4 text-[1.1875rem] font-normal tracking-[-0.01em]">
          Activity
        </h2>
        {error && logs.length === 0 ? (
          <Problem error={error} title="Could not load the activity log" />
        ) : logs.length === 0 ? (
          <p className="text-[0.9375rem] text-muted-foreground">
            {loading ? "Loading the activity log." : "Nothing logged yet."}
          </p>
        ) : (
          <>
            <div aria-live="polite" aria-relevant="additions">
              <Timeline items={timelineItems(run, logs, testnet)} label={`Activity of the ${runTitle(run)} run`} />
            </div>
            <Disclosure summary="Service log, as recorded" className="mt-6 border-t border-hairline pt-4">
              <Sensitive block>
                <ol className="text-[0.8125rem]">
                  {logs.map((l, i) => (
                    <li
                      key={`${l.at}-${i}`}
                      className="grid gap-x-6 gap-y-0.5 border-b border-hairline py-2 last:border-0 sm:grid-cols-[10rem_minmax(0,1fr)]"
                    >
                      <time dateTime={l.at} className="num text-muted-foreground">
                        {when(l.at)}
                      </time>
                      <span className="min-w-0 [overflow-wrap:anywhere] text-strong">
                        <LogText message={l.message} />
                      </span>
                    </li>
                  ))}
                </ol>
              </Sensitive>
            </Disclosure>
          </>
        )}
      </section>
    </div>
  );
}
