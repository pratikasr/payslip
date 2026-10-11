/*
  Real Zcash testnet records for the landing page. The page is static, so these are recorded
  here rather than fetched; in the app every figure comes from the service.

  HERO_PAYMENT: the one payment the hero's two-view panel shows. Amara Okafor's September pay
  from the sample company, checked on 11 Oct 2026 against the explorer (block 4,466,912, Ironwood
  pool, 2 actions, 5 Oct 2026 08:13:28 UTC) and against the judge kit's payment proof, which the
  service verified (355,556 zat to the address below, memo INV-2026-014). When the mainnet run is
  paid, replacing this one object swaps the hero to it.

  DEMO_RUNS: the three payrolls of the demo wallet, the wallet the published judge kit reads
  (docs/judge/judge-kit-testnet.json). Run ids, txids, heights, names, invoices and dollar
  amounts are from docs/proof/demo-wallet-runs.json; every txid and height was compared with
  that file and with a reconciliation of the kit's keys on 5 Oct 2026. So everything here can be
  checked by importing the kit in Books, or by opening each transaction in the explorer.

  SEP_RUN: the September run as Books reconciles it with the kit's keys (a statement of the
  seven keys from 1 Jul to 5 Oct 2026, read from the chain on 5 Oct 2026): the funding record,
  coin acquired, fees, unspent coin and the variance.
*/

export const GITHUB_URL = "https://github.com/pratikasr/payslip";
export const repoFile = (path: string) => `${GITHUB_URL}/blob/main/${path}`;
export const repoDir = (path: string) => `${GITHUB_URL}/tree/main/${path}`;
export const HACKATHON_URL = "https://colosseum.com/worldsfair";

/** The explorer the README and docs/DEMO.md link to (testnet). */
export const TESTNET_EXPLORER_TX = "https://testnet.zecblock.com/tx/";
export const explorerTx = (txid: string) => `${TESTNET_EXPLORER_TX}${txid}`;

/** The payment the hero opens on: what the explorer shows, and what Amara's viewing key shows. */
export const HERO_PAYMENT = {
  /** The quiet line under the panel. */
  label: "Sample company on Zcash testnet",
  network: "testnet" as const,
  coin: "TAZ",
  explorerName: "testnet.zecblock.com",
  explorerUrl: explorerTx("b597daba92b76495421d44c22b7c6282ca8f053cad6de06fdcb648a01d2bf0c3"),
  /* What the explorer shows. */
  txid: "b597daba92b76495421d44c22b7c6282ca8f053cad6de06fdcb648a01d2bf0c3",
  height: 4466912,
  pool: "Ironwood",
  actions: 2,
  blockTime: "2026-10-05T08:13:28Z",
  /* What the viewing key shows. The name comes from Payslip's records; the chain has none. */
  name: "Amara Okafor",
  /** The sender row: the sample company's payroll account for Amara. */
  payer: "Sample company",
  recipient:
    "utest1t3mcdcs2wudepqvmvcdz3ax4l778d7psqkhkhkguhk8apj9h5ctkkrzqre0ncvqcjaxpm423jmfu6gswkm08h2csh2wwsrc5cst9cp0l",
  usdCents: 480000,
  zat: 355556,
  periodLabel: "Sep 2026",
  invoice: "INV-2026-014",
  /** True on testnet: dollars convert to TAZ at the service's fixed simulated rate. */
  simulatedRate: true,
  /** The judge kit's payment proof for this payment: /verify#<token> checks it against the chain. */
  proofToken: "pp1AQEBAAHD8CsdoEi23G_gba08BY_KgmJ8K8JEHUKVZLeSutqXtUN_7qLzSGalJt-cakfV50S2hbI3TQE-GKTWn1c0nVaz",
};

export interface PaidLine {
  /** From Payslip's own run records and the judge kit's labels; the explorer shows no name. */
  name: string;
  usdCents: number;
  invoice: string;
  txid: string;
  height: number;
}

export interface ProofRun {
  runId: string;
  /** "2026-09", the pay period the run was for. */
  period: string;
  /** "Sep 2026". */
  periodLabel: string;
  /** The day the run was paid. */
  date: string;
  /** The treasury's one transaction that fills every contractor account of the run. */
  allocation: { txid: string; height: number };
  lines: PaidLine[];
}

/** The demo wallet's payrolls, latest pay period first. All three were paid on 5 Oct 2026. */
export const DEMO_RUNS: ProofRun[] = [
  {
    runId: "09019bd8-d31d-400b-a779-050afeb3083e",
    period: "2026-09",
    periodLabel: "Sep 2026",
    date: "5 Oct 2026",
    allocation: { txid: "91087ec36cce8ef64e28f71214bbd3fae457ba60a42effe54cb27ae7721a6c24", height: 4466910 },
    lines: [
      {
        name: "Amara Okafor",
        usdCents: 480000,
        invoice: "INV-2026-014",
        txid: "b597daba92b76495421d44c22b7c6282ca8f053cad6de06fdcb648a01d2bf0c3",
        height: 4466912,
      },
      {
        name: "Mateo Fernandez",
        usdCents: 625000,
        invoice: "MF-0923",
        txid: "24e99d9802a6cb0573ea309e4e2e614477ce933ebf879971fce86f7f19b2216a",
        height: 4466912,
      },
      {
        name: "Priya Raman",
        usdCents: 540000,
        invoice: "PR-INV-31",
        txid: "4a90a0894343a365e7a116457c0230bb57a350a70df82a6209c91078ff110498",
        height: 4466912,
      },
      {
        name: "Jonas Lindqvist",
        usdCents: 710000,
        invoice: "JL-2026-09",
        txid: "f2e6094e0bed1b4784e9d778bd38f30dc89beb2f5b907d4d861b73f6dcfa0919",
        height: 4466912,
      },
      {
        name: "Mei Chen",
        usdCents: 395000,
        invoice: "INV-0047",
        txid: "866266aeab8424ad048492bdc7027a9e6f900beabf4fd5b5f25d5c221705289c",
        height: 4466912,
      },
      {
        name: "Kwame Mensah",
        usdCents: 287550,
        invoice: "KM-SEP-26",
        txid: "04cffca310a3362df7fd53ccea6e8938a15c2bcd3e57c489bb856adaa96d32c4",
        height: 4466912,
      },
    ],
  },
  {
    runId: "67dd4c2e-0268-4da1-846a-729379f6278d",
    period: "2026-08",
    periodLabel: "Aug 2026",
    date: "5 Oct 2026",
    allocation: { txid: "4431a4c438c6233461fec45b897cddccf22189964a5633c89d9629de161fdb87", height: 4467191 },
    lines: [
      {
        name: "Amara Okafor",
        usdCents: 480000,
        invoice: "INV-2026-012",
        txid: "2d77f6864c9dbe69e897ae707f8711c92f3eb311dd511f872fead52ca5859be4",
        height: 4467193,
      },
      {
        name: "Mateo Fernandez",
        usdCents: 625000,
        invoice: "MF-0823",
        txid: "5e2e33003aeedddd6d5037b8fd7a236186b4ce306464a065f05268248bcd0138",
        height: 4467196,
      },
      {
        name: "Priya Raman",
        usdCents: 540000,
        invoice: "PR-INV-29",
        txid: "f7aa70bca1d6cfa2b5becd78974ee02b4a5b4aca5f79fcfc809ef3aeb909d384",
        height: 4467196,
      },
      {
        name: "Jonas Lindqvist",
        usdCents: 710000,
        invoice: "JL-2026-08",
        txid: "21ddbf23a7381be0fbe37eeda648220ba877a8a60878e1e081e8b6d5a8de4569",
        height: 4467195,
      },
      {
        name: "Mei Chen",
        usdCents: 395000,
        invoice: "INV-0045",
        txid: "b6c6f146c91f275c29e6d60eb49d8e50a78a4fe44213acfe2de297d26b3d1669",
        height: 4467195,
      },
      {
        name: "Kwame Mensah",
        usdCents: 287550,
        invoice: "KM-AUG-26",
        txid: "0ac5583a425eb533097616ce67c2bcc5319a07ba3d71b2c69c27169a1e9903b6",
        height: 4467196,
      },
    ],
  },
  {
    runId: "a738f61a-9a7a-4c65-912f-329b0c509e9b",
    period: "2026-07",
    periodLabel: "Jul 2026",
    date: "5 Oct 2026",
    allocation: { txid: "15639eb24679210544468beef92d4cdc0299b02df5ee8be166d1e9f7f2352567", height: 4467186 },
    lines: [
      {
        name: "Amara Okafor",
        usdCents: 450000,
        invoice: "INV-2026-010",
        txid: "a90585cbb49b663f1f1e809790cdcabeebd259c478f36ea0a4cefacbd820504c",
        height: 4467188,
      },
      {
        name: "Mateo Fernandez",
        usdCents: 600000,
        invoice: "MF-0723",
        txid: "37800ee7b75380855a29ac56f32cbc743a8fcaae66f2dfa5ac48ebe744f2ca9e",
        height: 4467188,
      },
      {
        name: "Priya Raman",
        usdCents: 540000,
        invoice: "PR-INV-27",
        txid: "a39e3a2e8df7fc341d1cf3b31ac82f56895d931642915979084977d2830963b7",
        height: 4467188,
      },
      {
        name: "Jonas Lindqvist",
        usdCents: 710000,
        invoice: "JL-2026-07",
        txid: "007b1aa692ecee9139422413587595293c568a1b8a3065b6c03dc314150682c2",
        height: 4467188,
      },
      {
        name: "Mei Chen",
        usdCents: 380000,
        invoice: "INV-0043",
        txid: "3058d18f616c621b8b16594eaeecd9999df6ff9f1bf5c0acfcf34f41a8c63a69",
        height: 4467188,
      },
      {
        name: "Kwame Mensah",
        usdCents: 287550,
        invoice: "KM-JUL-26",
        txid: "7636fad65db29f73e5e5a48354a33c82e660913b9ece3c6c663af4ab9934a65f",
        height: 4467188,
      },
    ],
  },
];

/** What a run paid, in cents: the sum of its lines. */
export const runTotalCents = (run: ProofRun) => run.lines.reduce((n, l) => n + l.usdCents, 0);

/** Shielded payroll payments in the demo wallet: every one readable with the judge kit. */
export const DEMO_PAYMENTS = DEMO_RUNS.reduce((n, r) => n + r.lines.length, 0);

/** The September run of the demo wallet, as Books reconciles it with the judge kit. */
export const SEP_RUN = {
  run: DEMO_RUNS[0],
  short: DEMO_RUNS[0].runId.slice(0, 8),
  fundedCents: 3250176,
  acquiredZat: 2407538,
  /** Fill rate, USD per coin, times 10^6. A fixed simulated rate on testnet. */
  rateE6: 1350000000000,
  paidCents: runTotalCents(DEMO_RUNS[0]),
  feesZat: 95000,
  unspentZat: 62500,
  varianceCents: 212626,
  /** Fees and unspent coin at the fill rate: one cent short of the variance, from rounding six lines. */
  explainedCents: 212625,
};

/** The memo written on chain for a pay line: PS1|run|period|invoice|usd cents|rate e6 (docs/SPEC.md). */
export function payLineMemo(line: PaidLine): string {
  return `PS1|${SEP_RUN.run.runId}|${SEP_RUN.run.period}|${line.invoice}|${line.usdCents}|${SEP_RUN.rateE6}`;
}

/** The judge kit: seven testnet viewing keys for the sample company, published with the repository. */
export const JUDGE_KIT = {
  path: "docs/judge/judge-kit-testnet.json",
  keys: 7,
  contractors: 6,
  /** Amara Okafor's viewing key from the kit, shown shortened; it reads her account and cannot spend. */
  amaraKey: { head: "uvftest1wl9rx9cj", tail: "eshul4j4" },
  /** The entry points' own labels in the app (components/books/key-import.tsx, components/portal/unlock-card.tsx). */
  booksAction: "Load the judge kit",
  portalAction: "Try it with a demo key",
};

/** Pricing as the README states it; the comparison from deel.com/pricing and riseworks.io/pricing (5 Oct 2026). */
export const PRICING = {
  hostedUsd: 19,
  swapFee: "0.25%",
  competitorUsd: 49,
  competitors: "Deel and Rise",
  checked: "5 Oct 2026",
};
