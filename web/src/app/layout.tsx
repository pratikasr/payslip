import type { Metadata, Viewport } from "next";
import { Courier_Prime, DotGothic16, Libre_Franklin } from "next/font/google";
import localFont from "next/font/local";
import { LucideProvider } from "lucide-react";
import { PresenterMode } from "@/components/app/presenter-mode";
import { ThemeProvider } from "@/components/app/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { authRequired } from "@/lib/auth-config";
import { presenterBootScript } from "@/lib/presenter";
import "./globals.css";

/*
  The faces of the pay advice on paper (docs/DESIGN.md section 17):

    Redaction 35   display: headlines, form titles, the company name (700, with the ink filter)
    Redaction      the clean cut, for small headings where the degraded cut would blur
    Courier Prime  typewriter: navigation, buttons, form labels and values, tables, chain data
    DotGothic16    dot matrix: the one large amount on a pay advice, headline money
    Libre Franklin text: paragraphs, descriptions, help, dialog bodies

  Preloaded is only what every route paints first: Libre Franklin (body text), Courier Prime
  (navigation and buttons) and Redaction 35 at 700 (every page's headline). The rest load when a
  page first uses them.
*/
const redaction35 = localFont({
  src: "../../node_modules/@fontsource/redaction-35/files/redaction-35-latin-700-normal.woff2",
  weight: "700",
  style: "normal",
  variable: "--font-redaction-35",
  display: "swap",
  fallback: ["Georgia", "serif"],
});
const redaction35Regular = localFont({
  src: "../../node_modules/@fontsource/redaction-35/files/redaction-35-latin-400-normal.woff2",
  weight: "400",
  style: "normal",
  variable: "--font-redaction-35-regular",
  display: "swap",
  preload: false,
  fallback: ["Georgia", "serif"],
});
const redaction = localFont({
  src: [
    {
      path: "../../node_modules/@fontsource/redaction/files/redaction-latin-400-normal.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/redaction/files/redaction-latin-700-normal.woff2",
      weight: "700",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource/redaction/files/redaction-latin-400-italic.woff2",
      weight: "400",
      style: "italic",
    },
  ],
  variable: "--font-redaction",
  display: "swap",
  preload: false,
  fallback: ["Georgia", "serif"],
});
const courierPrime = Courier_Prime({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-courier-prime",
  display: "swap",
});
const dotGothic = DotGothic16({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-dotgothic",
  display: "swap",
  preload: false,
});
const libreFranklin = Libre_Franklin({ subsets: ["latin"], variable: "--font-libre-franklin", display: "swap" });

const FONT_VARIABLES = [redaction35, redaction35Regular, redaction, courierPrime, dotGothic, libreFranklin]
  .map((f) => f.variable)
  .join(" ");

export const metadata: Metadata = {
  title: {
    default: "Payslip: private payroll on Zcash",
    template: "%s | Payslip",
  },
  description:
    "Payroll where every payment is shielded on Zcash. Contractors and accountants hold viewing keys that reveal exactly their slice, with USD cost basis and period statements.",
};

/** The desk the sheets lie on, in both themes. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#e8e9eb" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1218" },
  ],
};

/**
 * The three print effects, defined once and used by class (globals.css): ink (.inked) roughens
 * display type, large amounts and redaction bars like ink on paper; carbon (.carbon-print) softens
 * the impressions on the yellow copy; stamp (.stamped) wears holes in the rubber stamp.
 */
function PrintFilters() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" className="pointer-events-none absolute">
      <filter id="ps-ink" x="-2%" y="-10%" width="104%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed="7" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="1.4" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="ps-carbon" x="-2%" y="-20%" width="104%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="1" seed="3" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="0.9" />
        <feGaussianBlur stdDeviation="0.25" />
      </filter>
      <filter id="ps-stamp" x="-5%" y="-20%" width="110%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="11" result="n" />
        <feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.1 1.55" result="holes" />
        <feComposite in="SourceGraphic" in2="holes" operator="in" />
      </filter>
    </svg>
  );
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={FONT_VARIABLES}>
      <head>
        {/* Presenter mode before first paint; see src/lib/presenter.ts. */}
        <script dangerouslySetInnerHTML={{ __html: presenterBootScript }} />
        {/* With sign-in on, every service call goes through the same-origin proxy (src/lib/api.ts). */}
        {authRequired() ? <script dangerouslySetInnerHTML={{ __html: "window.__payslipProxy=true" }} /> : null}
      </head>
      <body className="min-h-dvh">
        <PrintFilters />
        <a
          href="#main"
          className="sr-only z-50 border-2 border-foreground bg-card px-3 py-2 font-type text-[0.9375rem] font-bold focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <ThemeProvider>
          {/* Every icon in the app is drawn at stroke 1.5. */}
          <LucideProvider strokeWidth={1.5}>
            {children}
            <PresenterMode />
            <Toaster position="bottom-right" />
          </LucideProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
