import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { T, useFonts } from "./paper";
import { Caption, ScreenSheet, Voice, type Shot } from "./demo/parts";
import { TitleCard } from "./Title";

/*
  The demo video: one payroll month at the company, on the live product. Every scene is a
  stretch of the founder's screen recordings (public/rec/A.mp4 etc., trimmed of the waits) or a
  scripted recording of the public pages, on one sheet, with the storyboard's caption typed at
  the foot and the scene's voice line. Scene ids follow docs: D1 to D14.
*/
interface Scene {
  id: string;
  shots: Shot[];
  caption: string;
  push?: number;
}

export const DEMO_SCENES: Scene[] = [
  { id: "D01", shots: [{ src: "rec/landing.mp4", from: 0, dur: 9.5 }], caption: "One payment, two copies", push: 0 },
  { id: "D02", shots: [{ src: "rec/A.mp4", from: 9.5, dur: 8 }, { src: "rec/A.mp4", from: 30, dur: 2.2 }, { src: "rec/A.mp4", from: 32.5, dur: 3.3 }], caption: "Sign in. Roles. Audit log." },
  { id: "D03", shots: [{ src: "rec/A.mp4", from: 48, dur: 13 }], caption: "One account per person. Paid in ZEC, or USDC on receipt." },
  { id: "D04", shots: [{ src: "rec/A.mp4", from: 71, dur: 5 }, { src: "rec/A.mp4", from: 79, dur: 4 }, { src: "rec/A.mp4", from: 87, dur: 8 }], caption: "Requests become pay lines" },
  { id: "D05", shots: [{ src: "rec/A.mp4", from: 96, dur: 6 }], caption: "Approve before anything moves" },
  { id: "D06", shots: [{ src: "rec/A.mp4", from: 104, dur: 13.8 }], caption: "Fund from your own wallet", push: 0.04 },
  { id: "D07", shots: [{ src: "rec/C.mp4", from: 2, dur: 12 }], caption: "One shielded transaction per person" },
  { id: "D08", shots: [{ src: "rec/D.mp4", from: 0, dur: 6 }, { src: "rec/explorer.mp4", from: 0, dur: 7 }], caption: "What the explorer shows" },
  { id: "D09", shots: [{ src: "rec/E.mp4", from: 52, dur: 4 }, { src: "rec/A.mp4", from: 62, dur: 3 }], caption: "A viewing key, not a password" },
  { id: "D10", shots: [{ src: "rec/E.mp4", from: 56, dur: 8 }, { src: "rec/E.mp4", from: 64, dur: 8 }], caption: "Payslips. Requests. Tax export." },
  { id: "D11", shots: [{ src: "rec/portal-proof.mp4", from: 10, dur: 8 }, { src: "rec/verify.mp4", from: 0, dur: 5 }], caption: "Prove one payment" },
  { id: "D12", shots: [{ src: "rec/books.mp4", from: 2, dur: 14 }], caption: "Funded $10.70. Paid $10.00. $0.70 explained: fees and change.", push: 0.04 },
  { id: "D13", shots: [{ src: "rec/E.mp4", from: 12, dur: 8 }, { src: "rec/E.mp4", from: 86, dur: 6 }], caption: "Your key, in your browser" },
];
const CLOSE_SECONDS = 6;

export function demoFrames(fps: number): number {
  const scenes = DEMO_SCENES.reduce((n, s) => n + s.shots.reduce((m, sh) => m + Math.round(sh.dur * fps), 0), 0);
  return scenes + CLOSE_SECONDS * fps;
}

export const Demo = () => {
  useFonts();
  const { fps } = useVideoConfig();
  let at = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: T.desk }}>
      {DEMO_SCENES.map((s) => {
        const frames = s.shots.reduce((m, sh) => m + Math.round(sh.dur * fps), 0);
        const from = at;
        at += frames;
        return (
          <Sequence key={s.id} from={from} durationInFrames={frames} name={s.id}>
            <ScreenSheet shots={s.shots} push={s.push ?? 0}>
              <Caption text={s.caption} />
            </ScreenSheet>
            <Voice file={s.id} />
          </Sequence>
        );
      })}
      <Sequence from={at} durationInFrames={CLOSE_SECONDS * fps} name="D14">
        <TitleCard />
        <Voice file="D14" />
      </Sequence>
    </AbsoluteFill>
  );
};
