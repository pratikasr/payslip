/*
  Real Zcash testnet records for the landing page. The page is static, so these are
  recorded here rather than fetched; in the app every figure comes from the service.

  REHEARSALS: the two six-contractor runs from docs/DEMO.md and docs/proof/rehearsal-1.json and
  rehearsal-2.json (copied from src/components/landing/testnet-proof.ts, which is retired with the
  old landing page). Their amounts are not in the repo, so the page shows them sealed.

  RUN_284C: the run that scripts/mainnet-demo.sh made on testnet, with its amounts, from
  docs/proof/testnet-rehearsal-284c2421.md and the statement and reconciliation CSVs the script
  wrote for it (fees, unspent, variance, block time).

  Every txid here was opened on testnet.zecblock.com on 5 Oct 2026 and resolves at the height
  below as a shielded transaction.
*/

export const GITHUB_URL = "https://github.com/pratikasr/payslip";
export const repoFile = (path: string) => `${GITHUB_URL}/blob/main/${path}`;
export const repoDir = (path: string) => `${GITHUB_URL}/tree/main/${path}`;
export const HACKATHON_URL = "https://colosseum.com/worldsfair";

/** The explorer the README and docs/DEMO.md link to (testnet). */
export const TESTNET_EXPLORER_TX = "https://testnet.zecblock.com/tx/";
export const explorerTx = (txid: string) => `${TESTNET_EXPLORER_TX}${txid}`;

export interface ProofLine {
  /** From Payslip's own run records; the explorer shows no name. */
  name: string;
  txid: string;
  height: number;
}

export interface ProofRun {
  title: string;
  runId: string;
  period: string;
  date: string;
  allocation: { txid: string; height: number };
  lines: ProofLine[];
}

export const REHEARSALS: ProofRun[] = [
  {
    title: "Rehearsal 1",
    runId: "61e7687c-51b4-49c3-8836-b86570e9c8f8",
    period: "Sep 2026",
    date: "5 Oct 2026",
    allocation: { txid: "98977de93e11f4b0ed23847937856ab4690647f2c7edff87bb7a595b33423298", height: 4465896 },
    lines: [
      {
        name: "Amara Okafor",
        txid: "cad00d2ffc7395f6efbce3c8e85cc1e8f1cb9097f4159e7efe41d02243253072",
        height: 4465898,
      },
      {
        name: "Mateo Fernandez",
        txid: "49c338336bc94dfeb21239f4faf2595cd2004e7f4df968013ac0e43a50faae70",
        height: 4465899,
      },
      {
        name: "Priya Raman",
        txid: "2da6e11c026837da7565a2988093942b44f0a1bff4a6b3e669eeeb557451433b",
        height: 4465899,
      },
      {
        name: "Jonas Lindqvist",
        txid: "c34fb793b524e621251c34fa2785ee547d360dd2a99b3b2509e515035fd3e0ef",
        height: 4465899,
      },
      { name: "Mei Chen", txid: "aa68a24e60821142e41c3abe4253085c5d01f18c62481f83a6ad8199ba43adba", height: 4465899 },
      {
        name: "Kwame Mensah",
        txid: "acfd8d4b1d97d044011e0f93ee484bf5b5bbd48a600e9438695b2feb2049d65f",
        height: 4465899,
      },
    ],
  },
  {
    title: "Rehearsal 2",
    runId: "2c3c69da-45f1-4a8c-92ef-6f61f0d991f4",
    period: "Sep 2026",
    date: "5 Oct 2026",
    allocation: { txid: "73620ccfad5813ed90359f0746f2ac5aa3f51a26a6f5cbc7b78e6c6a0439eb57", height: 4465907 },
    lines: [
      {
        name: "Amara Okafor",
        txid: "c9af878a2502c3357f513fa35924edfe38d314b8515a7d675505e419d67572dc",
        height: 4465909,
      },
      {
        name: "Mateo Fernandez",
        txid: "c799afa886a1eb68b721742e2cac022c416bdab89301c503e70b981a5babc202",
        height: 4465909,
      },
      {
        name: "Priya Raman",
        txid: "9bf11723bfd3ad2b1a2ce1f722a1138044c2ecd298da09e3322a2472b6739c1e",
        height: 4465909,
      },
      {
        name: "Jonas Lindqvist",
        txid: "01b3f8180282d4057cb68e3cfa083314176f7dd769abef4b9f5c576d0540cc85",
        height: 4465909,
      },
      { name: "Mei Chen", txid: "eb0290bd999ad7d8ca9fb1af4a871a6056e6f4786e2c6e6270d7171bbcd11fdf", height: 4465911 },
      {
        name: "Kwame Mensah",
        txid: "36b5db028e261887534a28d9f559965bf2bf99e95365c25ecd1e1952dd30f338",
        height: 4465911,
      },
    ],
  },
];

/** Shielded payroll payments in the two rehearsals. */
export const REHEARSAL_PAYMENTS = REHEARSALS.reduce((n, r) => n + r.lines.length, 0);

/** README, run d9248c70: a contractor who converts to USDC (the conversion is simulated on testnet). */
export const TESTNET_CONVERSION = {
  runId: "d9248c70",
  txid: "118c665f71d082eba1f02777f3d271fc111716725ee4b256c6c3b9bcccae33ca",
  height: 4465711,
};

export interface PaidLine extends ProofLine {
  usdCents: number;
  zat: number;
  invoice: string;
}

/** Run 284c2421: six contractors through scripts/mainnet-demo.sh on testnet, reconciled. */
export const RUN_284C = {
  runId: "284c2421-1fa8-4f33-8400-6a4e21ce73a7",
  short: "284c2421",
  period: "2026-09",
  periodLabel: "Sep 2026",
  fundedCents: 3250176,
  acquiredZat: 2407538,
  /** Fill rate, USD per coin, times 10^6. A fixed simulated rate on testnet. */
  rateE6: 1349999875391,
  paidCents: 3037550,
  paidZat: 2250038,
  feesZat: 95000,
  unspentZat: 62500,
  varianceCents: 212626,
  explainedCents: 212625,
  allocation: { txid: "18cdbaf8e801ea07a1ebb7e3730973f0ae72caf95a67091761521b8bf0a6e0aa", height: 4465681 },
  lines: [
    {
      name: "Amara Okafor",
      usdCents: 480000,
      zat: 355556,
      invoice: "INV-2026-014",
      txid: "76b71420ee4b72f0d5ef34ce6ba8c7dd33f0e876a38771a537dc1b54d5278685",
      height: 4465683,
    },
    {
      name: "Mateo Fernandez",
      usdCents: 625000,
      zat: 462963,
      invoice: "MF-0923",
      txid: "2a4941e69c0c466b4dd5117f11b52c8205883514745c849f92c68ef2aa267991",
      height: 4465683,
    },
    {
      name: "Priya Raman",
      usdCents: 540000,
      zat: 400000,
      invoice: "PR-INV-31",
      txid: "cb5d784deecb30776c5fae552ac352b82025bf3e6999358f7216929906e0bbf4",
      height: 4465683,
    },
    {
      name: "Jonas Lindqvist",
      usdCents: 710000,
      zat: 525926,
      invoice: "JL-2026-09",
      txid: "0f9b8ec8e839334afd62ed50bcfb0247a825b7f6db1a1d911b210322229832e1",
      height: 4465684,
    },
    {
      name: "Mei Chen",
      usdCents: 395000,
      zat: 292593,
      invoice: "INV-0047",
      txid: "6a4ccfca0f250d4b8644b2fa526d2f71a3cd9b0b0a391b80da2f8a2e7316b0b6",
      height: 4465684,
    },
    {
      name: "Kwame Mensah",
      usdCents: 287550,
      zat: 213000,
      invoice: "KM-SEP-26",
      txid: "6e247b18427613bd0ba27746d08dbf5f737548498c7a7ebe5e8e318440b4af00",
      height: 4465684,
    },
  ] satisfies PaidLine[],
  /** Amara Okafor's payment as her statement shows it (block time from the statement CSV). */
  payslip: { blockTime: "2026-10-04T23:36:39Z" },
};

/** The memo written on chain for a pay line: PS1|run|period|invoice|usd cents|rate e6 (docs/SPEC.md). */
export function payLineMemo(line: PaidLine): string {
  return `PS1|${RUN_284C.runId}|${RUN_284C.period}|${line.invoice}|${line.usdCents}|${RUN_284C.rateE6}`;
}
