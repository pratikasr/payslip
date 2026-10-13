import type { CSSProperties, ReactNode } from "react";
import { useEffect, useState } from "react";
import { AbsoluteFill, continueRender, delayRender, staticFile } from "remotion";
import { loadFont as loadCourier } from "@remotion/google-fonts/CourierPrime";
import { loadFont as loadFranklin } from "@remotion/google-fonts/LibreFranklin";

/* The site's paper tokens (web/src/app/globals.css). */
export const T = {
  desk: "#e8e9eb",
  paper: "#ffffff",
  ink: "#1c2230",
  ash: "#545b69",
  rule: "#cfd3da",
  carbon: "#fbf1c7",
  carbonLine: "#e5d48f",
  carbonInk: "#2a3557",
  carbonSoft: "#5d5638",
  stamp: "#b42a2a",
  gold: "#f4b728",
};

const courier = loadCourier("normal", { weights: ["400", "700"], subsets: ["latin"] });
const franklin = loadFranklin("normal", { weights: ["400", "500"], subsets: ["latin"] });
export const FONT = {
  display: '"Redaction 35", Georgia, serif',
  type: courier.fontFamily,
  text: franklin.fontFamily,
};

/** Loads Redaction 35 (the site's own file) before any frame is rendered. */
export function useFonts() {
  const [handle] = useState(() => delayRender("Loading Redaction 35"));
  useEffect(() => {
    const face = new FontFace("Redaction 35", `url(${staticFile("fonts/redaction-35-latin-700-normal.woff2")})`, {
      weight: "700",
    });
    face
      .load()
      .then((f) => {
        document.fonts.add(f);
        continueRender(handle);
      })
      .catch(() => continueRender(handle));
  }, [handle]);
}

/** The desk, and a sheet of continuous-form paper on it with its tractor-feed holes. */
export function Sheet({ children, style }: { children?: ReactNode; style?: CSSProperties }) {
  const holes = Array.from({ length: 13 }, (_, i) => 36 + i * 76);
  return (
    <AbsoluteFill style={{ backgroundColor: T.desk, justifyContent: "center", alignItems: "center" }}>
      <div
        style={{
          position: "relative",
          width: 1720,
          height: 980,
          backgroundColor: T.paper,
          boxShadow: "0 24px 60px rgba(28,34,48,0.18)",
          ...style,
        }}
      >
        {(["left", "right"] as const).map((side) => (
          <div
            key={side}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              [side]: 0,
              width: 56,
              [side === "left" ? "borderRight" : "borderLeft"]: `1px dashed ${T.rule}`,
            }}
          >
            {holes.map((y) => (
              <div
                key={y}
                style={{
                  position: "absolute",
                  top: y,
                  left: 18,
                  width: 20,
                  height: 20,
                  borderRadius: "50%",
                  backgroundColor: T.desk,
                  boxShadow: "inset 0 1px 2px rgba(0,0,0,0.18)",
                }}
              />
            ))}
          </div>
        ))}
        <div style={{ position: "absolute", inset: 0, padding: "64px 120px" }}>{children}</div>
      </div>
    </AbsoluteFill>
  );
}

/** The mark: two rings and the gold bar. */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true">
      <circle cx="13" cy="13" r="12" fill="none" stroke={T.ink} strokeWidth="1.3" />
      <circle cx="13" cy="13" r="7.6" fill="none" stroke={T.ink} strokeWidth="1" opacity="0.7" />
      <rect x="7.4" y="11.6" width="11.2" height="2.8" rx="1" fill={T.gold} />
    </svg>
  );
}
