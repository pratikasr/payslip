import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FONT, LogoMark, Sheet, T, useFonts } from "./paper";
import { Typed, Voice } from "./demo/parts";
import { Bar, DrawnBox, DrawnRing, EyeLabel, LedgerFeed, Line, MiniAdvice, SceneFrame, Slip, Stamp, StepRail, StillSheet, TapeRoll } from "./pitch/parts";
import { TitleCard } from "./Title";

/*
  The pitch video: two teams pay their people, Alpha on a public chain, Beta with Payslip, in the
  structure of a product tour. Motion graphics in the paper design with real screens on sheets;
  the founder's voice over it (scratch voice until his files arrive). Scene ids P1 to P11 follow
  the storyboard; durations in seconds.
*/
const S = (sec: number) => Math.round(sec * 30);
export const PITCH: { id: string; sec: number }[] = [
  { id: "P01", sec: 9 }, { id: "P02", sec: 10.5 }, { id: "P03", sec: 11.5 }, { id: "P04", sec: 6.5 }, { id: "P05", sec: 16 },
  { id: "P06", sec: 16.5 }, { id: "P07", sec: 9.5 }, { id: "P08", sec: 12 }, { id: "P09", sec: 9.5 }, { id: "P10", sec: 14 }, { id: "P11", sec: 4 },
];
export const pitchFrames = () => PITCH.reduce((n, s) => n + S(s.sec), 0);

/** A big inked headline, rising on a spring. */
function Inked({ text, at, size = 120, x = 120, y = 90 }: { text: string; at: number; size?: number; x?: number; y?: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 18, stiffness: 120 } });
  if (frame < at) return null;
  return (
    <div style={{ position: "absolute", left: x, top: y, fontFamily: FONT.display, fontWeight: 700, fontSize: size, lineHeight: 0.98, letterSpacing: "-0.012em", color: T.ink, opacity: Math.min(1, s * 1.2), transform: `translateY(${(1 - s) * 28}px)` }}>
      {text}
    </div>
  );
}

function Rise({ at, children, x, y }: { at: number; children: React.ReactNode; x: number; y: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - at, fps, config: { damping: 20, stiffness: 100 } });
  return <div style={{ position: "absolute", left: x, top: y, transform: `translateY(${(1 - s) * 60}px)`, opacity: frame < at ? 0 : s }}>{children}</div>;
}

const FEED = [
  "12 Oct 2026  paid 4,800.00  to u1x7a…9f2   Amara Okafor   INV-2026-014",
  "12 Oct 2026  paid 3,200.00  to u1c4d…77q   Dev Patel      INV-2026-015",
  "12 Oct 2026  paid 6,100.00  to u1m9k…e0a   Lin Zhao       INV-2026-016",
  "12 Oct 2026  paid 2,750.00  to u1q2w…b8t   Sam Rivera     INV-2026-017",
  "12 Oct 2026  paid 4,800.00  to u1x7a…9f2   Amara Okafor   INV-2026-018",
  "12 Oct 2026  paid 5,400.00  to u1h5r…31z   Noor Haddad    INV-2026-019",
  "12 Oct 2026  paid 3,900.00  to u1p0s…d4m   Jonas Weber    INV-2026-020",
  "12 Oct 2026  paid 4,800.00  to u1x7a…9f2   Amara Okafor   INV-2026-021",
];

function P1() {
  return (
    <SceneFrame>
      <Rise at={0} x={150} y={150}><MiniAdvice team="Alpha" liftAt={150} /></Rise>
      <Rise at={8} x={1030} y={150}><MiniAdvice team="Beta" barAt={150} /></Rise>
      <div style={{ position: "absolute", left: 150, top: 20, width: 740, opacity: 1 }}>
        <LedgerFeed from={168} every={10} rows={FEED.slice(0, 3)} style={{ fontSize: 18, lineHeight: 1.6, color: T.ash }} />
      </div>
      <Stamp text="SHIELDED" at={196} style={{ left: 1420, top: 120 }} />
      <Line text="Two teams. Both pay on time." at={12} />
    </SceneFrame>
  );
}

function P2() {
  return (
    <SceneFrame drop>
      <Sheet>
        <div style={{ fontFamily: FONT.type, fontSize: 18, letterSpacing: "0.18em", color: T.ash, borderBottom: `3px solid ${T.ink}`, paddingBottom: 12 }}>PUBLIC LEDGER, BLOCK 3,514,845 AND ON</div>
        <LedgerFeed from={6} every={24} rows={FEED} style={{ marginTop: 18 }} />
      </Sheet>
      <DrawnRing x={1130} y={213} w={300} h={56} at={100} />
      <EyeLabel text="a competitor" x={1460} y={212} at={104} />
      <DrawnRing x={1130} y={305} w={300} h={56} at={160} />
      <EyeLabel text="the landlord" x={1460} y={304} at={164} />
      <DrawnRing x={1130} y={397} w={300} h={56} at={220} />
      <EyeLabel text="a scammer" x={1460} y={396} at={224} />
      <Line text="Public chain: who, how much, when. For anyone." at={10} />
    </SceneFrame>
  );
}

function P3() {
  const frame = useCurrentFrame();
  const rows: [string, number][] = [["Employer", 420], ["Payee", 420], ["Amount", 260], ["Memo", 520]];
  return (
    <SceneFrame>
      <Rise at={0} x={120} y={120}>
        <div style={{ width: 1060, backgroundColor: T.carbon, border: `2px solid ${T.carbonLine}`, padding: "46px 56px 56px", transform: "rotate(-1.5deg)", boxShadow: "0 24px 60px rgba(28,34,48,0.18)", position: "relative" }}>
          <div style={{ fontFamily: FONT.type, fontSize: 22, fontWeight: 700, letterSpacing: "0.18em", color: T.carbonSoft }}>WHAT THE EXPLORER SEES</div>
          {rows.map(([k, w], i) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: i === 0 ? 30 : 18, paddingTop: 16, borderTop: `1px solid ${T.carbonLine}`, fontFamily: FONT.type, fontSize: 30, color: T.carbonInk }}>
              <span>{k}</span>
              <Bar width={w} at={30 + i * 14} height={32} />
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 18, paddingTop: 16, borderTop: `1px solid ${T.carbonLine}`, fontFamily: FONT.type, fontSize: 30, color: T.carbonInk }}>
            <span>Block</span>
            <Typed text="3,514,845" from={96} cps={24} />
          </div>
          <Stamp text="SHIELDED" at={150} style={{ right: 40, top: 20 }} />
        </div>
      </Rise>
      <Rise at={270} x={1240} y={120}>
        <div style={{ fontFamily: FONT.type, fontWeight: 700, fontSize: 22, letterSpacing: "0.18em", color: T.ink, backgroundColor: "#f0e6c8", padding: "10px 22px", display: "inline-block" }}>TAX 2026</div>
      </Rise>
      <TapeRoll x={1260} y={190} at={280} />
      <Stamp text="?" at={330} style={{ left: 1560, top: 420, fontSize: 60, padding: "0 20px" }} />
      <Line text="Shielded on Zcash: private. And unaccountable?" at={10} />
      <span style={{ display: "none" }}>{frame}</span>
    </SceneFrame>
  );
}

function P4() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - 10, fps, config: { damping: 16, stiffness: 110 } });
  return (
    <SceneFrame>
      <Sheet>
        <div style={{ position: "absolute", left: 560, top: 300, transform: `scale(${interpolate(s, [0, 1], [1.6, 1])})`, opacity: s }}>
          <LogoMark size={120} />
        </div>
        <div style={{ position: "absolute", left: 720, top: 300, fontFamily: FONT.type, fontSize: 64, fontWeight: 700, color: T.ink }}>
          <Typed text="Pratik" from={24} cps={12} />
        </div>
        <div style={{ position: "absolute", left: 720, top: 390, fontFamily: FONT.type, fontSize: 36, color: T.ash }}>
          <Typed text="building Payslip: private payroll on Zcash" from={54} cps={30} />
        </div>
      </Sheet>
      <Line text="Pratik, building Payslip" at={10} />
    </SceneFrame>
  );
}

function P5() {
  const frame = useCurrentFrame();
  const shots = ["stills/people.png", "stills/amounts.png", "stills/fund.png", "stills/pay.png"];
  return (
    <SceneFrame>
      <Sheet />
      <Inked text="Meet Payslip" at={0} size={110} x={120} y={70} />
      {shots.map((src, i) => (
        <StillSheet key={src} src={src} x={200 + i * 24} y={230 + i * 14} w={1480} h={560} at={60 + i * 105} push={0.05} focus="50% 15%" />
      ))}
      <StepRail steps={["Fund", "Approve", "Pay"]} at={165} every={105} />
      {frame > 440 ? <DrawnRing x={1310} y={330} w={220} h={70} at={440} /> : null}
      <Line text="Run payroll in three steps" at={10} />
    </SceneFrame>
  );
}

function P6() {
  return (
    <SceneFrame>
      <Sheet />
      <StillSheet src="stills/payslip.png" x={200} y={60} w={1520} h={520} at={0} push={0.04} focus="50% 36%" />
      <Slip lines={["Viewing key", "reads, never spends"]} x={1300} y={40} at={150} width={420} tilt={2} />
      <StillSheet src="stills/request.png" x={120} y={610} w={540} h={300} at={240} push={0.03} focus="50% 30%" />
      <StillSheet src="stills/tax.png" x={690} y={610} w={540} h={300} at={300} push={0.03} focus="50% 40%" />
      <StillSheet src="stills/verify.png" x={1260} y={610} w={540} h={300} at={360} push={0.03} focus="50% 30%" />
      <Line text="A viewing key per person. A proof for a landlord or a bank." at={10} />
    </SceneFrame>
  );
}

function P7() {
  return (
    <SceneFrame drop>
      <Sheet />
      <StillSheet src="stills/books.png" x={200} y={60} w={1520} h={640} at={0} push={0.05} focus="50% 40%" />
      <Slip lines={["Funded  $10.70", "Paid    $10.00", "Explained $0.70"]} x={1340} y={90} at={60} width={400} tilt={2} />
      <Stamp text="RECONCILED" at={180} style={{ left: 1180, top: 560 }} />
      <Slip lines={["BETA", "private, and accounted for"]} x={130} y={720} at={210} width={560} tilt={-1.5} big />
      <Slip lines={["Xero export"]} x={1160} y={760} at={240} width={300} tilt={3} />
      <Slip lines={["QuickBooks export"]} x={1480} y={790} at={252} width={340} tilt={-2} />
      <Line text="Beta: private, and accounted for." at={200} />
    </SceneFrame>
  );
}

function P8() {
  return (
    <SceneFrame>
      <Sheet />
      <DrawnBox x={260} y={520} w={1400} h={290} at={10} title="Zcash" lines={["the shielded pool: the payment itself is hidden", "viewing keys: read, never spend; built into the protocol"]} />
      <DrawnBox x={260} y={150} w={1400} h={290} at={120} title="Payslip" lines={["memos: period, invoice, dollar basis, in the payment", "statements, single-payment proofs, reconciliation"]} />
      <Slip lines={["Treasury key", "made in your browser"]} x={1300} y={30} at={250} width={420} tilt={2} />
      <Line text="Why Zcash. Ironwood pool, mainnet since 28 Jul 2026." at={10} />
    </SceneFrame>
  );
}

function P9() {
  return (
    <SceneFrame>
      <StillSheet src="stills/explorer.png" x={96} y={60} w={850} h={820} at={0} push={0.03} focus="50% 10%" />
      <StillSheet src="stills/arav-statement.png" x={975} y={60} w={850} h={820} at={20} push={0.03} focus="60% 20%" />
      <DrawnRing x={270} y={250} w={320} h={60} at={150} />
      <DrawnRing x={1180} y={420} w={300} h={70} at={170} />
      <Line text="Paid on mainnet, 12 Oct 2026. Block 3,515,541." at={10} />
    </SceneFrame>
  );
}

function P10() {
  return (
    <SceneFrame drop>
      <Sheet />
      <Slip lines={["Pratik", "years around THORChain, where custody and", "auditability are the product", "built Payslip solo, in the open"]} x={160} y={160} at={10} width={1040} tilt={-1} big />
      <Slip lines={["19 USD per contractor per month, hosted", "Self-hosted: free, open source, MIT"]} x={860} y={560} at={240} width={880} tilt={1.5} big />
      <Line text="19 USD per contractor per month. Self-hosted: free, MIT." at={250} />
    </SceneFrame>
  );
}

const SCENES: Record<string, () => React.JSX.Element> = { P01: P1, P02: P2, P03: P3, P04: P4, P05: P5, P06: P6, P07: P7, P08: P8, P09: P9, P10: P10, P11: TitleCard };

export const Pitch = () => {
  useFonts();
  let at = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: T.desk }}>
      {PITCH.map((s) => {
        const C = SCENES[s.id];
        const from = at;
        at += S(s.sec);
        return (
          <Sequence key={s.id} from={from} durationInFrames={S(s.sec)} name={s.id}>
            <C />
            <Voice file={s.id} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
