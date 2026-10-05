"use client";

import { Rate, Usd, Zec } from "@/components/app/amount";
import { Hash } from "@/components/app/hash";
import { Card, CardHeader } from "@/components/ds/card";
import { Tag } from "@/components/ds/tag";
import type { Run, RunLogEvent } from "@/lib/api";
import { formatDate, formatHeight, formatTime, venueLabel } from "@/lib/format";
import { Problem } from "./problem";

const HEX64 = /\b[0-9a-f]{64}\b/gi;

/** A log line with each 64-hex txid shortened; the full text stays in the title. */
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

/** What moved money for this run (funding and allocation), then everything the service logged. */
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
  const testnet = f?.venue === "testnet-fixed-rate";
  return (
    <div className="space-y-8">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Funding"
            actions={
              f ? (
                <Tag
                  tone={
                    f.status === "success"
                      ? "success"
                      : ["failed", "refunded", "expired"].includes(f.status)
                        ? "danger"
                        : "neutral"
                  }
                >
                  {f.status === "success"
                    ? "Received"
                    : f.status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}
                </Tag>
              ) : undefined
            }
          />
          {f ? (
            <dl className="mt-3 text-[0.9375rem]">
              <Row label="Source">{testnet ? "Testnet treasury" : venueLabel(f.venue)}</Row>
              <Row label="Funded">
                <Usd cents={f.funded_usd_cents ?? f.requested_usd_cents ?? null} />
              </Row>
              <Row label="Acquired">
                <Zec zat={f.zec_acquired_zat ?? f.quoted_zat ?? null} />
              </Row>
              <Row label="Rate">
                {testnet ? (
                  <span className="text-muted-foreground">
                    Simulated, <Rate e6={f.rate_usd_per_zec_e6} />
                  </span>
                ) : (
                  <Rate e6={f.rate_usd_per_zec_e6} />
                )}
              </Row>
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
          <CardHeader title="Allocation" />
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            One transaction moves each payment from the treasury to the contractor&apos;s account.
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
            </dl>
          ) : (
            <p className="mt-3 text-[0.9375rem] text-muted-foreground">Not sent yet.</p>
          )}
        </Card>
      </div>

      <section aria-labelledby="activity-title">
        <h3 id="activity-title" className="mb-2 text-[1.1875rem] font-normal tracking-[-0.01em]">
          Activity
        </h3>
        {error && logs.length === 0 ? (
          <Problem error={error} title="Could not load the activity log" />
        ) : logs.length === 0 ? (
          <p className="text-[0.9375rem] text-muted-foreground">
            {loading ? "Loading the activity log." : "Nothing logged yet."}
          </p>
        ) : (
          <ol className="border-t border-hairline" aria-live="polite" aria-relevant="additions">
            {logs.map((l, i) => (
              <li
                key={`${l.at}-${i}`}
                className="grid gap-x-6 gap-y-0.5 border-b border-hairline py-3 text-[0.9375rem] sm:grid-cols-[11rem_minmax(0,1fr)]"
              >
                <time dateTime={l.at} className="num text-[0.8125rem] text-muted-foreground sm:pt-px">
                  {formatDate(l.at)}, {formatTime(l.at)}
                </time>
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <LogText message={l.message} />
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
