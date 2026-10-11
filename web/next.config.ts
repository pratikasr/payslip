import type { NextConfig } from "next";

/*
  wagmi's connector bundle imports every wallet SDK, including Coinbase's
  CDP SDK, which statically imports its optional @x402 peer packages. Payslip
  uses only injected, MetaMask, Rainbow and WalletConnect wallets, so these
  optional modules are never executed; aliasing them to empty modules lets the
  lazily loaded wallet chunk build without installing them. Same for the
  optional pretty printer of the WalletConnect logger and React Native storage
  of the MetaMask SDK.
*/
const OPTIONAL_UNUSED_MODULES = [
  "@x402/core",
  "@x402/evm",
  "@x402/svm",
  "@x402/extensions",
  "pino-pretty",
  "@react-native-async-storage/async-storage",
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // A self-contained server in .next/standalone for the container image (deploy/Dockerfile.web);
  // `pnpm start` and `next dev` are unchanged.
  output: "standalone",
  experimental: {
    // Import only the Radix primitives used, not the whole radix-ui barrel.
    optimizePackageImports: ["radix-ui"],
  },
  // Security headers on every page: no framing by other sites (clickjacking on Run payroll or the
  // key file download), no MIME sniffing, no referrer leaks, camera only for this origin's QR scan.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  // The app moved from /app/<role> to one product per role (docs/DESIGN.md section 15); old
  // links and bookmarks keep working.
  async redirects() {
    return [
      { source: "/app", destination: "/console", permanent: true },
      { source: "/app/payer", destination: "/console", permanent: true },
      { source: "/app/payer/contractors", destination: "/console/people", permanent: true },
      { source: "/app/payer/runs", destination: "/console/runs", permanent: true },
      { source: "/app/payer/runs/new", destination: "/console/runs/new", permanent: true },
      { source: "/app/payer/runs/:id", destination: "/console/runs/:id", permanent: true },
      { source: "/app/contractor", destination: "/portal", permanent: true },
      { source: "/app/accountant", destination: "/books", permanent: true },
    ];
  },
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      ...Object.fromEntries(OPTIONAL_UNUSED_MODULES.map((m) => [m, false])),
    };
    return config;
  },
};

export default nextConfig;
