import { AbsoluteFill, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT, LogoMark, Sheet, T, useFonts } from "./paper";

export const SAMPLE_FRAMES = 360;

/** Text that appears one character at a time, like a typewriter, `cps` characters per second. */
function Typed({ text, from, cps = 28, style }: { text: string; from: number; cps?: number; style?: React.CSSProperties }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const n = Math.max(0, Math.min(text.length, Math.floor(((frame - from) / fps) * cps)));
  return (
    <span style={{ fontFamily: FONT.type, ...style }}>
      {text.slice(0, n)}
      {n < text.length && frame >= from ? <span style={{ opacity: frame % 16 < 8 ? 1 : 0 }}>_</span> : null}
    </span>
  );
}

/** A headline line that inks in: it rises a little and darkens, on a spring. */
function Inked({ children, at, size = 128 }: { children: string; at: number; size?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 18, stiffness: 120 } });
  return (
    <div
      style={{
        fontFamily: FONT.display,
        fontWeight: 700,
        fontSize: size,
        lineHeight: 0.98,
        letterSpacing: "-0.012em",
        color: T.ink,
        opacity: Math.min(1, s * 1.2),
        transform: `translateY(${(1 - s) * 28}px)`,
        filter: `contrast(${1 + (1 - s) * 0.6})`,
      }}
    >
      {children}
    </div>
  );
}

/* Scene 1: the title card, typed and inked. */
function Title() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const rule = interpolate(frame, [8, 30], [0, 1], { extrapolateRight: "clamp" });
  const out = interpolate(frame, [78, 90], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Sheet>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 34, fontWeight: 700, color: T.ink }}>
          <LogoMark size={44} />
          <Typed text="Payslip" from={2} cps={14} style={{ fontWeight: 700 }} />
          <span style={{ marginLeft: "auto", fontFamily: FONT.type, fontSize: 18, letterSpacing: "0.18em", color: T.ash }}>
            <Typed text="PRIVATE PAYROLL ON ZCASH" from={10} cps={30} />
          </span>
        </div>
        <div style={{ height: 3, backgroundColor: T.ink, marginTop: 18, transform: `scaleX(${rule})`, transformOrigin: "left" }} />
        <div style={{ marginTop: 70, maxWidth: 1250 }}>
          <Inked at={22}>Private to the world.</Inked>
          <Inked at={34}>Transparent to</Inked>
          <Inked at={44}>your accountant.</Inked>
        </div>
        <div style={{ marginTop: 44, fontFamily: FONT.type, fontSize: 30, color: T.ash }}>
          <Typed text="Shielded payroll. A viewing key per person." from={58} cps={40} />
        </div>
        <div style={{ position: "absolute", right: 120, bottom: 56, fontFamily: FONT.type, fontSize: 20, color: T.ash }}>
          {Math.floor(frame / fps) >= 1 ? "Zcash mainnet, 12 Oct 2026" : ""}
        </div>
      </Sheet>
    </AbsoluteFill>
  );
}

/* Scene 2: the real landing page, slowly pushed in, with a typed caption. */
function Landing() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 20, stiffness: 90 } });
  const zoom = interpolate(frame, [0, 150], [1, 1.06], { extrapolateRight: "clamp" });
  const out = interpolate(frame, [138, 150], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: T.desk, opacity: out }}>
      <div
        style={{
          position: "absolute",
          left: 100,
          top: 60,
          width: 1720,
          height: 860,
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(28,34,48,0.18)",
          transform: `translateY(${(1 - enter) * 60}px)`,
        }}
      >
        <Img
          src={staticFile("shots/site-landing-hero.png")}
          style={{ width: "100%", transform: `scale(${zoom})`, transformOrigin: "50% 20%" }}
        />
      </div>
      <Caption from={14} text="One payment, two copies. Three doors: the company, the contractor, the accountant." />
    </AbsoluteFill>
  );
}

/* Scene 3: the carbon copy, bars drawn, the stamp slammed. */
function Carbon() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 16, stiffness: 110 } });
  const bar = (i: number) => interpolate(frame, [20 + i * 10, 38 + i * 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const stamp = spring({ frame: frame - 62, fps, config: { damping: 12, stiffness: 180 } });
  const rows: [string, number | null][] = [
    ["Employer", 420],
    ["Payee", 420],
    ["Amount", 260],
    ["Block", null],
  ];
  return (
    <AbsoluteFill style={{ backgroundColor: T.desk, justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          position: "relative",
          width: 1180,
          backgroundColor: T.carbon,
          border: `2px solid ${T.carbonLine}`,
          padding: "56px 64px 64px",
          transform: `rotate(-2deg) translateY(${(1 - enter) * 120}px)`,
          opacity: enter,
          boxShadow: "0 24px 60px rgba(28,34,48,0.18)",
        }}
      >
        <div style={{ fontFamily: FONT.type, fontSize: 24, fontWeight: 700, letterSpacing: "0.18em", color: T.carbonSoft }}>
          WHAT THE EXPLORER SEES
        </div>
        <div style={{ fontFamily: FONT.text, fontSize: 30, color: T.carbonInk, marginTop: 14 }}>
          The carbon copy: a shielded transaction in block 3,514,845, no amount, no names.
        </div>
        {rows.map(([label, width], i) => (
          <div
            key={label}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: i === 0 ? 40 : 22,
              fontFamily: FONT.type,
              fontSize: 32,
              color: T.carbonInk,
              borderTop: `1px solid ${T.carbonLine}`,
              paddingTop: 18,
            }}
          >
            <span>{label}</span>
            {width ? (
              <span style={{ display: "inline-block", height: 34, width: width * bar(i), backgroundColor: T.ink }} />
            ) : (
              <Typed text="3,514,845" from={52} cps={24} style={{ fontSize: 32 }} />
            )}
          </div>
        ))}
        <div
          style={{
            position: "absolute",
            right: 48,
            top: 28,
            fontFamily: FONT.type,
            fontSize: 48,
            fontWeight: 700,
            letterSpacing: "0.14em",
            color: T.stamp,
            border: `5px solid ${T.stamp}`,
            padding: "8px 22px",
            backgroundColor: "rgba(255,255,255,0.55)",
            transform: `rotate(8deg) scale(${interpolate(stamp, [0, 1], [2.6, 1])})`,
            opacity: stamp,
          }}
        >
          SHIELDED
        </div>
      </div>
      <Caption from={70} text="Open it on any explorer: this is all the world gets." />
    </AbsoluteFill>
  );
}

/** The subtitle bar: a strip of paper at the foot of the frame with typed text. */
function Caption({ text, from }: { text: string; from: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 100,
        right: 100,
        bottom: 44,
        padding: "18px 28px",
        backgroundColor: T.paper,
        borderTop: `3px solid ${T.ink}`,
        fontSize: 30,
        color: T.ink,
        boxShadow: "0 10px 30px rgba(28,34,48,0.12)",
      }}
    >
      <Typed text={text} from={from} cps={34} />
    </div>
  );
}

export const DemoSample = () => {
  useFonts();
  return (
    <AbsoluteFill style={{ backgroundColor: T.desk }}>
      <Sequence from={0} durationInFrames={90}>
        <Title />
      </Sequence>
      <Sequence from={90} durationInFrames={150}>
        <Landing />
      </Sequence>
      <Sequence from={240} durationInFrames={120}>
        <Carbon />
      </Sequence>
    </AbsoluteFill>
  );
};
