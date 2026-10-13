import { Composition } from "remotion";
import { DemoSample, SAMPLE_FRAMES } from "./DemoSample";
import { Demo, demoFrames } from "./Demo";
import { Pitch, pitchFrames } from "./Pitch";

/*
  The Payslip demo video as Remotion compositions: React components rendered frame by frame,
  in the product's own paper design (docs/DESIGN.md section 17). `remotion studio` opens the
  timeline; `remotion render DemoSample out/demo-sample.mp4` writes the file.
*/
export const RemotionRoot = () => (
  <>
    <Composition id="Pitch" component={Pitch} durationInFrames={pitchFrames()} fps={30} width={1920} height={1080} />
    <Composition id="Demo" component={Demo} durationInFrames={demoFrames(30)} fps={30} width={1920} height={1080} />
    <Composition id="DemoSample" component={DemoSample} durationInFrames={SAMPLE_FRAMES} fps={30} width={1920} height={1080} />
  </>
);
