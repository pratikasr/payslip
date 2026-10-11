import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PresenterMode } from "@/components/app/presenter-mode";
import { ThemeProvider } from "@/components/app/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { authRequired } from "@/lib/auth-config";
import { presenterBootScript } from "@/lib/presenter";
import "./globals.css";

// One family for the whole app (docs/DESIGN.md section 16): Geist for display and text, Geist Mono
// for transaction ids, keys, addresses and block heights.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });

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
    { media: "(prefers-color-scheme: dark)", color: "#171721" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable}`}>
      <head>
        {/* Presenter mode before first paint; see src/lib/presenter.ts. */}
        <script dangerouslySetInnerHTML={{ __html: presenterBootScript }} />
        {/* With sign-in on, every service call goes through the same-origin proxy (src/lib/api.ts). */}
        {authRequired() ? <script dangerouslySetInnerHTML={{ __html: "window.__payslipProxy=true" }} /> : null}
      </head>
      <body className="min-h-dvh">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-card px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <ThemeProvider>
          {children}
          <PresenterMode />
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
