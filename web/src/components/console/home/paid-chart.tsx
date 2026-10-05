"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Usd } from "@/components/app/amount";
import { formatPeriodLabel, formatUsd } from "@/lib/format";
import { niceMax } from "@/lib/insights";

export interface PeriodPoint {
  period: string;
  label: string;
  cents: number;
}

const HEIGHT = 176;
const PAD_TOP = 18;
const PAD_BOTTOM = 30;

/** Smooth line through points (monotone cubic), so the curve never overshoots a month's value. */
function smoothPath(pts: [number, number][]): string {
  if (pts.length === 0) return "";
  if (pts.length === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const n = pts.length;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    slope[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  const t: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) t[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  t[n - 1] = slope[n - 2];
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${pts[i][0] + h},${pts[i][1] + t[i] * h} ${pts[i + 1][0] - h},${pts[i + 1][1] - t[i + 1] * h} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

/**
 * Paid to contractors by period: one gold series, area wash, month labels, a crosshair and
 * tooltip on hover or arrow keys, and a table twin for screen readers.
 */
export function PaidChart({ points }: { points: PeriodPoint[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const gradId = useId().replace(/:/g, "");

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const max = niceMax(Math.max(...points.map((p) => p.cents), 1));
  const inset = 28;
  const step = points.length > 1 ? (width - inset * 2) / (points.length - 1) : 0;
  const xy = points.map((p, i): [number, number] => [
    inset + i * step,
    PAD_TOP + (1 - p.cents / max) * (HEIGHT - PAD_TOP - PAD_BOTTOM),
  ]);
  const base = HEIGHT - PAD_BOTTOM;
  const line = smoothPath(xy);
  const area = xy.length ? `${line} L${xy[xy.length - 1][0]},${base} L${xy[0][0]},${base} Z` : "";
  const sel = active === null ? null : points[active];

  const nearest = (clientX: number) => {
    const rect = wrap.current?.getBoundingClientRect();
    if (!rect || step === 0) return 0;
    return Math.max(0, Math.min(points.length - 1, Math.round((clientX - rect.left - inset) / step)));
  };

  return (
    <div className="relative -mx-5 -mb-5 mt-3 sm:-mx-[22px]">
      <div
        ref={wrap}
        role="group"
        tabIndex={0}
        aria-label={`Paid to contractors by period, ${points.length} months. Use the arrow keys to read each month.`}
        className="relative h-[176px] rounded-b-xl outline-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
        onPointerMove={(e) => setActive(nearest(e.clientX))}
        onPointerLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            const dir = e.key === "ArrowRight" ? 1 : -1;
            setActive((i) => Math.max(0, Math.min(points.length - 1, (i ?? (dir > 0 ? -1 : points.length)) + dir)));
          } else if (e.key === "Home") setActive(0);
          else if (e.key === "End") setActive(points.length - 1);
        }}
      >
        {width > 0 ? (
          <svg width={width} height={HEIGHT} className="block" aria-hidden="true">
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="var(--primary)" stopOpacity="0.24" />
                <stop offset="1" stopColor="var(--primary)" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <line x1={0} x2={width} y1={base} y2={base} className="stroke-hairline" strokeWidth={1} />
            <path d={area} fill={`url(#${gradId})`} />
            <path
              d={line}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="stroke-[#b3820e] dark:stroke-[#bd8a14]"
            />
            {points.map((p, i) => (
              <text
                key={p.period}
                x={xy[i][0]}
                y={HEIGHT - 10}
                textAnchor="middle"
                className="fill-muted-foreground text-[11.5px]"
              >
                {p.label}
              </text>
            ))}
            {active !== null ? (
              <g>
                <line
                  x1={xy[active][0]}
                  x2={xy[active][0]}
                  y1={PAD_TOP - 6}
                  y2={base}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <circle
                  cx={xy[active][0]}
                  cy={xy[active][1]}
                  r={4.5}
                  strokeWidth={2}
                  className="fill-[#b3820e] stroke-card dark:fill-[#bd8a14]"
                />
              </g>
            ) : null}
          </svg>
        ) : null}
        {sel && active !== null ? (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-lg border bg-popover px-2.5 py-1.5 text-xs whitespace-nowrap text-popover-foreground shadow-sm"
            style={{
              left: Math.min(Math.max(xy[active][0] - 60, 8), Math.max(8, width - 128)),
            }}
          >
            <div className="text-muted-foreground">{formatPeriodLabel(sel.period)}</div>
            <Usd cents={sel.cents} className="text-[0.8125rem] text-foreground" />
          </div>
        ) : null}
        <p className="sr-only" aria-live="polite">
          {sel ? `${formatPeriodLabel(sel.period)}: ${formatUsd(sel.cents)} paid` : ""}
        </p>
      </div>
      <table className="sr-only">
        <caption>Paid to contractors by period</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Paid</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.period}>
              <td>{formatPeriodLabel(p.period)}</td>
              <td>{formatUsd(p.cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
