import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { FONT, LogoMark, Sheet, T } from "./paper";

/** The close: the mark, the line and the addresses on the sheet; it holds, no fade. */
export function TitleCard() {
  const frame = useCurrentFrame();
  const rule = interpolate(frame, [4, 24], [0, 1], { extrapolateRight: "clamp" });
  const show = (at: number) => (frame >= at ? 1 : 0);
  return (
    <AbsoluteFill>
      <Sheet>
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 34, fontWeight: 700, color: T.ink, fontFamily: FONT.type }}>
          <LogoMark size={44} />
          Payslip
          <span style={{ marginLeft: "auto", fontSize: 18, letterSpacing: "0.18em", color: T.ash }}>PRIVATE PAYROLL ON ZCASH</span>
        </div>
        <div style={{ height: 3, backgroundColor: T.ink, marginTop: 18, transform: `scaleX(${rule})`, transformOrigin: "left" }} />
        <div style={{ marginTop: 90, fontFamily: FONT.display, fontWeight: 700, fontSize: 112, lineHeight: 0.98, letterSpacing: "-0.012em", color: T.ink, maxWidth: 1300 }}>
          <div style={{ opacity: show(10) }}>Private to the world.</div>
          <div style={{ opacity: show(26) }}>Transparent to your accountant.</div>
        </div>
        <div style={{ marginTop: 60, fontFamily: FONT.type, fontSize: 30, color: T.ink, opacity: show(50), display: "grid", gap: 10 }}>
          <div>app.payslip.cash <span style={{ color: T.ash }}>for the company</span></div>
          <div>payslip.cash <span style={{ color: T.ash }}>for contractors and accountants</span></div>
          <div style={{ color: T.ash, fontSize: 24, marginTop: 10 }}>Open source, MIT. github.com/pratikasr/payslip</div>
        </div>
      </Sheet>
    </AbsoluteFill>
  );
}
