import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT, T } from "../paper";
import { Typed } from "../demo/parts";

/** A red rubber stamp that slams on at `at` (frames): one spring, no fade. */
export function Stamp({ text, at, style }: { text: string; at: number; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 12, stiffness: 180 } });
  if (frame < at) return null;
  return (
    <div
      style={{
        position: "absolute",
        fontFamily: FONT.type,
        fontWeight: 700,
        fontSize: 40,
        letterSpacing: "0.14em",
        color: T.stamp,
        border: `5px solid ${T.stamp}`,
        padding: "6px 18px",
        backgroundColor: "rgba(255,255,255,0.5)",
        transform: `rotate(7deg) scale(${interpolate(s, [0, 1], [2.4, 1])})`,
        opacity: Math.min(1, s),
        ...style,
      }}
    >
      {text}
    </div>
  );
}

/** A redaction bar drawn left to right, starting at `at` (frames), over 18 frames. */
export function Bar({ width, at, height = 26 }: { width: number; at: number; height?: number }) {
  const frame = useCurrentFrame();
  const w = interpolate(frame, [at, at + 18], [0, width], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <span style={{ display: "inline-block", height, width: w, backgroundColor: T.ink, verticalAlign: "middle" }} />;
}

/** A small pay advice: the rows of a payslip on a sheet, values that can lift off or be barred. */
export function MiniAdvice({
  team,
  liftAt,
  barAt,
}: {
  team: string;
  /** Frame at which the values float off the sheet (Alpha); omit to keep them. */
  liftAt?: number;
  /** Frame at which bars draw over the values (Beta); omit for none. */
  barAt?: number;
}) {
  const frame = useCurrentFrame();
  const rows: [string, string][] = [
    ["Employer", team + " Ltd"],
    ["Payee", "Amara Okafor"],
    ["Period", "Oct 2026"],
    ["Invoice", "INV-2026-014"],
    ["Amount", "$4,800.00"],
  ];
  return (
    <div
      style={{
        width: 740,
        backgroundColor: T.paper,
        boxShadow: "0 18px 40px rgba(28,34,48,0.18)",
        padding: "34px 40px 40px",
        position: "relative",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", borderBottom: `3px solid ${T.ink}`, paddingBottom: 12 }}>
        <span style={{ fontFamily: FONT.type, fontWeight: 700, fontSize: 30, color: T.ink }}>
          <Typed text={team.toUpperCase()} from={6} cps={14} />
        </span>
        <span style={{ marginLeft: "auto", fontFamily: FONT.type, fontSize: 16, letterSpacing: "0.18em", color: T.ash }}>PAY ADVICE</span>
      </div>
      {rows.map(([k, v], i) => {
        const lift = liftAt !== undefined ? interpolate(frame, [liftAt + i * 6, liftAt + i * 6 + 24], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
        return (
          <div
            key={k}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "14px 0",
              borderBottom: `1px solid ${T.rule}`,
              fontFamily: FONT.type,
              fontSize: 26,
              color: T.ink,
            }}
          >
            <span style={{ color: T.ash, fontSize: 18, letterSpacing: "0.16em" }}>{k.toUpperCase()}</span>
            {barAt !== undefined && i !== 2 ? (
              <span style={{ position: "relative" }}>
                <span style={{ opacity: frame < barAt + 18 + i * 6 ? 1 : 0.0 }}>{v}</span>
                <span style={{ position: "absolute", right: 0, top: 4 }}>
                  <Bar width={v.length * 15} at={barAt + i * 6} />
                </span>
              </span>
            ) : (
              <span
                style={{
                  display: "inline-block",
                  transform: `translateY(${-lift * 520}px) translateX(${lift * 160}px)`,
                  opacity: 1 - lift * 0.85,
                  fontWeight: i === 4 ? 700 : 400,
                }}
              >
                {v}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The public ledger: rows typing in, one every `every` frames, the list scrolling up. */
export function LedgerFeed({ from, every = 24, rows, style }: { from: number; every?: number; rows: string[]; style?: CSSProperties }) {
  const frame = useCurrentFrame();
  const shown = Math.max(0, Math.min(rows.length, Math.floor((frame - from) / every) + 1));
  return (
    <div style={{ fontFamily: FONT.type, fontSize: 24, color: T.ink, lineHeight: 1.9, ...style }}>
      {rows.slice(0, shown).map((r, i) => (
        <div key={i} style={{ borderBottom: `1px solid ${T.rule}`, whiteSpace: "nowrap", overflow: "hidden" }}>
          <Typed text={r} from={from + i * every} cps={60} />
        </div>
      ))}
    </div>
  );
}

/** A hand-drawn ring: an ellipse stroked on over 12 frames. */
export function DrawnRing({ x, y, w, h, at, color = T.stamp }: { x: number; y: number; w: number; h: number; at: number; color?: string }) {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + 12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (frame < at) return null;
  const len = Math.PI * (w + h);
  return (
    <svg style={{ position: "absolute", left: x, top: y, overflow: "visible" }} width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
      <ellipse cx={w / 2} cy={h / 2} rx={w / 2 - 3} ry={h / 2 - 3} fill="none" stroke={color} strokeWidth={4} strokeDasharray={len} strokeDashoffset={len * (1 - p)} transform={`rotate(-4 ${w / 2} ${h / 2})`} />
    </svg>
  );
}

/** A typed label beside something, in red ink. */
export function EyeLabel({ text, x, y, at }: { text: string; x: number; y: number; at: number }) {
  const frame = useCurrentFrame();
  if (frame < at) return null;
  return (
    <div style={{ position: "absolute", left: x, top: y, fontFamily: FONT.type, fontSize: 24, fontWeight: 700, color: T.stamp, transform: "rotate(-3deg)" }}>
      <Typed text={text} from={at} cps={30} />
    </div>
  );
}

/** A small slip of paper, tilted a degree or two, with typed lines. */
export function Slip({ lines, x, y, at, width = 520, tilt = -1.5, big = false }: { lines: string[]; x: number; y: number; at: number; width?: number; tilt?: number; big?: boolean }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 18, stiffness: 120 } });
  if (frame < at) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        backgroundColor: T.paper,
        boxShadow: "0 14px 30px rgba(28,34,48,0.16)",
        padding: "18px 24px",
        transform: `rotate(${tilt}deg) translateY(${(1 - s) * 30}px)`,
        opacity: s,
        fontFamily: FONT.type,
        fontSize: big ? 34 : 26,
        color: T.ink,
        lineHeight: 1.5,
      }}
    >
      {lines.map((l, i) => (
        <div key={i} style={{ fontWeight: i === 0 ? 700 : 400 }}>
          <Typed text={l} from={at + 6 + i * 14} cps={30} />
        </div>
      ))}
    </div>
  );
}

/** A real screen on its own sheet: enters on one spring, then pushes in slowly. */
export function StillSheet({ src, x, y, w, h, at, push = 0.06, focus = "50% 20%", children }: { src: string; x: number; y: number; w: number; h: number; at: number; push?: number; focus?: string; children?: ReactNode }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 20, stiffness: 90 } });
  const scale = 1 + interpolate(frame, [at, durationInFrames], [0, push], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (frame < at) return null;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, overflow: "hidden", backgroundColor: T.paper, boxShadow: "0 24px 60px rgba(28,34,48,0.18)", transform: `translateX(${(1 - s) * 80}px)`, opacity: s }}>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: focus, transform: `scale(${scale})`, transformOrigin: focus }} />
      {children}
    </div>
  );
}

/** The thin rail under the product sheets: Fund, Approve, Pay, filling as the scene goes. */
export function StepRail({ steps, at, every }: { steps: string[]; at: number; every: number }) {
  const frame = useCurrentFrame();
  return (
    <div style={{ position: "absolute", left: 120, right: 120, bottom: 150, display: "flex", gap: 14 }}>
      {steps.map((st, i) => {
        const p = interpolate(frame, [at + i * every, at + i * every + every * 0.8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <div key={st} style={{ flex: 1 }}>
            <div style={{ height: 6, backgroundColor: T.rule }}>
              <div style={{ height: 6, width: `${p * 100}%`, backgroundColor: T.ink }} />
            </div>
            <div style={{ fontFamily: FONT.type, fontSize: 22, letterSpacing: "0.16em", color: p > 0 ? T.ink : T.ash, marginTop: 8 }}>{st.toUpperCase()}</div>
          </div>
        );
      })}
    </div>
  );
}

/** A box stroked on in ink, with typed lines inside. */
export function DrawnBox({ x, y, w, h, at, title, lines }: { x: number; y: number; w: number; h: number; at: number; title: string; lines: string[] }) {
  const frame = useCurrentFrame();
  const p = interpolate(frame, [at, at + 20], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  if (frame < at) return null;
  const len = 2 * (w + h);
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h }}>
      <svg width={w} height={h} style={{ position: "absolute", inset: 0 }}>
        <rect x={2} y={2} width={w - 4} height={h - 4} fill="none" stroke={T.ink} strokeWidth={4} strokeDasharray={len} strokeDashoffset={len * (1 - p)} />
      </svg>
      <div style={{ position: "absolute", left: 28, top: 20, fontFamily: FONT.display, fontWeight: 700, fontSize: 48, color: T.ink, opacity: frame > at + 10 ? 1 : 0 }}>{title}</div>
      <div style={{ position: "absolute", left: 28, top: 92, fontFamily: FONT.type, fontSize: 26, color: T.ink, lineHeight: 1.6 }}>
        {lines.map((l, i) => (
          <div key={l}>
            <Typed text={l} from={at + 20 + i * 12} cps={34} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The accountant's tape: a strip printing a line every 10 frames, dashes only. */
export function TapeRoll({ x, y, at, lines = 9 }: { x: number; y: number; at: number; lines?: number }) {
  const frame = useCurrentFrame();
  const n = Math.max(0, Math.min(lines, Math.floor((frame - at) / 10)));
  if (frame < at) return null;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 300, backgroundColor: "#fbfaf4", boxShadow: "0 14px 30px rgba(28,34,48,0.16)", padding: "18px 22px", fontFamily: FONT.type, fontSize: 24, color: T.ink, lineHeight: 1.7, transform: "rotate(2deg)" }}>
      <div style={{ color: T.ash, fontSize: 16, letterSpacing: "0.18em" }}>STATEMENT</div>
      {Array.from({ length: n }, (_, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{["Employer", "Payee", "Amount", "Basis", "Invoice", "Fees", "Total", "Tax", "Due"][i]}</span>
          <span>{i === 8 ? "?" : "- - - -"}</span>
        </div>
      ))}
    </div>
  );
}

/** The typed on-screen line at the foot of a pitch scene. */
export function Line({ text, at = 10 }: { text: string; at?: number }) {
  return (
    <div style={{ position: "absolute", left: 96, right: 96, bottom: 44, fontFamily: FONT.type, fontSize: 30, color: T.ink, padding: "14px 24px", backgroundColor: T.paper, borderTop: `3px solid ${T.ink}`, boxShadow: "0 10px 30px rgba(28,34,48,0.12)", minHeight: 70 }}>
      <Typed text={text} from={at} cps={34} />
    </div>
  );
}

/** A scene's fade-free exit: the whole scene drops off the desk over the last 12 frames when `drop` is set. */
export function SceneFrame({ children, drop = false }: { children: ReactNode; drop?: boolean }) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const y = drop ? interpolate(frame, [durationInFrames - 12, durationInFrames], [0, 1100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 0;
  return <AbsoluteFill style={{ backgroundColor: T.desk, transform: `translateY(${y}px)` }}>{children}</AbsoluteFill>;
}
