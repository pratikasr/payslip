import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT, T } from "../paper";

/** Text that appears one character at a time, like a typewriter; the cursor only while typing. */
export function Typed({ text, from = 0, cps = 32, style }: { text: string; from?: number; cps?: number; style?: CSSProperties }) {
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

/** The subtitle: a strip of paper at the foot of the frame, ruled off in ink, the caption typed on it. */
export function Caption({ text, from = 6 }: { text: string; from?: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 96,
        right: 96,
        bottom: 40,
        padding: "16px 26px",
        backgroundColor: T.paper,
        borderTop: `3px solid ${T.ink}`,
        fontSize: 30,
        color: T.ink,
        boxShadow: "0 10px 30px rgba(28,34,48,0.14)",
        minHeight: 72,
      }}
    >
      <Typed text={text} from={from} />
    </div>
  );
}

/** One stretch of one recording: `from` seconds into the file, for `dur` seconds. */
export interface Shot {
  src: string;
  from: number;
  dur: number;
}

/**
 * Recordings on one sheet on the desk: the shots play back to back, the sheet rises on one
 * spring at the start of the scene and pushes in slowly when `push` is set. The recording
 * never tilts; the sheet is the frame.
 */
export function ScreenSheet({ shots, push = 0, children }: { shots: Shot[]; push?: number; children?: ReactNode }) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 22, stiffness: 100 } });
  const scale = 1 + interpolate(frame, [0, durationInFrames], [0, push], { extrapolateRight: "clamp" });
  let at = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: T.desk }}>
      <div
        style={{
          position: "absolute",
          left: 96,
          top: 36,
          width: 1728,
          height: 972,
          overflow: "hidden",
          backgroundColor: T.paper,
          boxShadow: "0 24px 60px rgba(28,34,48,0.18)",
          transform: `translateY(${(1 - enter) * 50}px)`,
          opacity: enter,
        }}
      >
        <div style={{ width: "100%", height: "100%", transform: `scale(${scale})`, transformOrigin: "50% 30%" }}>
          {shots.map((sh, i) => {
            const start = at;
            const frames = Math.round(sh.dur * fps);
            at += frames;
            return (
              <Sequence key={i} from={start} durationInFrames={frames} layout="none">
                <OffthreadVideo
                  src={staticFile(sh.src)}
                  startFrom={Math.round(sh.from * fps)}
                  endAt={Math.round((sh.from + sh.dur) * fps) + 2}
                  muted
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }}
                />
              </Sequence>
            );
          })}
        </div>
      </div>
      {children}
    </AbsoluteFill>
  );
}

/** The line read over a scene, starting a few frames in. */
export function Voice({ file, delay = 8 }: { file: string; delay?: number }) {
  const frame = useCurrentFrame();
  if (frame < delay) return null;
  return <Audio src={staticFile(`vo/${file}.wav`)} startFrom={0} />;
}

/** A soft ring over the recording to guide the eye, at a point in the 1728x972 sheet. */
export function Ring({ x, y, at, r = 44 }: { x: number; y: number; at: number; r?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 14, stiffness: 140 } });
  if (frame < at) return null;
  return (
    <div
      style={{
        position: "absolute",
        left: 96 + x - r,
        top: 36 + y - r,
        width: 2 * r,
        height: 2 * r,
        borderRadius: "50%",
        border: `4px solid ${T.stamp}`,
        opacity: Math.min(1, s) * 0.9,
        transform: `scale(${interpolate(s, [0, 1], [1.8, 1])})`,
        pointerEvents: "none",
      }}
    />
  );
}
