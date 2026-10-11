import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { LucideProvider } from "lucide-react";
import { PresenterMode } from "@/components/app/presenter-mode";
import { ThemeProvider } from "@/components/app/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { authRequired } from "@/lib/auth-config";
import { presenterBootScript } from "@/lib/presenter";
import "./globals.css";

// The identity faces (docs/DESIGN.md section 16), three and no more, each loaded as the app uses it:
// - Instrument Sans for all text, at 400 and 500: one variable file (wght only), smaller than the
//   two static weights. Every route renders it, so it is preloaded.
// - Bricolage Grotesque for page titles, the company name and headline money, with its optical
//   size axis (font-optical-sizing picks the display cut at large sizes). Every route opens on a
//   display title, so it is preloaded.
// - IBM Plex Mono at 400 for chain data (txids, keys, heights, addresses, memos). Not every route
//   shows chain data above the fold, so it is not preloaded; it loads when a page first uses it.
const instrument = Instrument_Sans({ subsets: ["latin"], variable: "--font-instrument", display: "swap" });
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-bricolage",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-plex-mono",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: "Payslip: private payroll on Zcash",
    template: "%s | Payslip",
  },
  description:
    "Payroll where every payment is shielded on Zcash. Contractors and accountants hold viewing keys that reveal exactly their slice, with USD cost basis and period statements.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#14181f" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${bricolage.variable} ${instrument.variable} ${plexMono.variable}`}
    >
      <head>
        {/* Presenter mode before first paint; see src/lib/presenter.ts. */}
        <script dangerouslySetInnerHTML={{ __html: presenterBootScript }} />
        {/* With sign-in on, every service call goes through the same-origin proxy (src/lib/api.ts). */}
        {authRequired() ? <script dangerouslySetInnerHTML={{ __html: "window.__payslipProxy=true" }} /> : null}
      </head>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-card px-3 py-2 text-[0.9375rem] font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
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
