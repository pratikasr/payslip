import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { LucideProvider } from "lucide-react";
import { PresenterMode } from "@/components/app/presenter-mode";
import { ThemeProvider } from "@/components/app/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { authRequired } from "@/lib/auth-config";
import { presenterBootScript } from "@/lib/presenter";
import "./globals.css";

// One family for the whole app (docs/DESIGN.md section 16): Geist for display and text (one variable
// file, weights 400 to 700), Geist Mono for transaction ids, keys, addresses and block heights.
// Every route renders Geist, so it is preloaded; not every route shows chain data above the fold,
// so Geist Mono is not preloaded and loads when a page first uses it.
const geist = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap", preload: false });

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
