import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { PresenterMode } from "@/components/app/presenter-mode";
import { ThemeProvider } from "@/components/app/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { presenterBootScript } from "@/lib/presenter";
import "./globals.css";

// Inter with its optical-size axis stands in for Mercury's Arcadia (proprietary): light weights for
// titles and money, 400 for body. IBM Plex Mono for keys and transaction ids.
const inter = Inter({ subsets: ["latin"], axes: ["opsz"], variable: "--font-inter", display: "swap" });
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
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
    { media: "(prefers-color-scheme: dark)", color: "#171721" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${plexMono.variable}`}>
      <head>
        {/* Presenter mode before first paint; see src/lib/presenter.ts. */}
        <script dangerouslySetInnerHTML={{ __html: presenterBootScript }} />
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
