/*
  Real Zcash testnet transactions from Payslip runs, for the landing page.
  Copied from docs/proof/rehearsal-1.json, docs/proof/rehearsal-2.json and the
  README Proof table. Each txid and height was checked on testnet.zecblock.com
  on 5 Oct 2026: all fifteen resolve at the height below as shielded
  transactions. The landing page is static, so these are recorded here rather
  than fetched; in the app every txid and explorer link comes from the service.
*/

/** The explorer the README and docs/DEMO.md link to (testnet). */
const TESTNET_EXPLORER_TX = "https://testnet.zecblock.com/tx/";

export interface ProofTx {
  txid: string;
  height: number;
  url: string;
}

export interface ProofLine extends ProofTx {
  /** From the run's own records; the explorer shows no name. */
  name: string;
}

export interface ProofRun {
  title: string;
  runId: string;
  date: string;
  allocation: ProofTx;
  lines: ProofLine[];
}

const tx = (txid: string, height: number): ProofTx => ({ txid, height, url: `${TESTNET_EXPLORER_TX}${txid}` });
const line = (name: string, txid: string, height: number): ProofLine => ({ name, ...tx(txid, height) });

export const TESTNET_RUNS: ProofRun[] = [
  {
    title: "Rehearsal 1",
    runId: "61e7687c-51b4-49c3-8836-b86570e9c8f8",
    date: "5 Oct 2026",
    allocation: tx("98977de93e11f4b0ed23847937856ab4690647f2c7edff87bb7a595b33423298", 4465896),
    lines: [
      line("Amara Okafor", "cad00d2ffc7395f6efbce3c8e85cc1e8f1cb9097f4159e7efe41d02243253072", 4465898),
      line("Mateo Fernandez", "49c338336bc94dfeb21239f4faf2595cd2004e7f4df968013ac0e43a50faae70", 4465899),
      line("Priya Raman", "2da6e11c026837da7565a2988093942b44f0a1bff4a6b3e669eeeb557451433b", 4465899),
      line("Jonas Lindqvist", "c34fb793b524e621251c34fa2785ee547d360dd2a99b3b2509e515035fd3e0ef", 4465899),
      line("Mei Chen", "aa68a24e60821142e41c3abe4253085c5d01f18c62481f83a6ad8199ba43adba", 4465899),
      line("Kwame Mensah", "acfd8d4b1d97d044011e0f93ee484bf5b5bbd48a600e9438695b2feb2049d65f", 4465899),
    ],
  },
  {
    title: "Rehearsal 2",
    runId: "2c3c69da-45f1-4a8c-92ef-6f61f0d991f4",
    date: "5 Oct 2026",
    allocation: tx("73620ccfad5813ed90359f0746f2ac5aa3f51a26a6f5cbc7b78e6c6a0439eb57", 4465907),
    lines: [
      line("Amara Okafor", "c9af878a2502c3357f513fa35924edfe38d314b8515a7d675505e419d67572dc", 4465909),
      line("Mateo Fernandez", "c799afa886a1eb68b721742e2cac022c416bdab89301c503e70b981a5babc202", 4465909),
      line("Priya Raman", "9bf11723bfd3ad2b1a2ce1f722a1138044c2ecd298da09e3322a2472b6739c1e", 4465909),
      line("Jonas Lindqvist", "01b3f8180282d4057cb68e3cfa083314176f7dd769abef4b9f5c576d0540cc85", 4465909),
      line("Mei Chen", "eb0290bd999ad7d8ca9fb1af4a871a6056e6f4786e2c6e6270d7171bbcd11fdf", 4465911),
      line("Kwame Mensah", "36b5db028e261887534a28d9f559965bf2bf99e95365c25ecd1e1952dd30f338", 4465911),
    ],
  },
];

/** README, run d9248c70: a contractor who converts to USDC (the conversion is simulated on testnet). */
export const TESTNET_CONVERSION: ProofTx & { runId: string } = {
  runId: "d9248c70",
  ...tx("118c665f71d082eba1f02777f3d271fc111716725ee4b256c6c3b9bcccae33ca", 4465711),
};
