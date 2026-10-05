import type { Metadata } from "next";
import { PayerOverview } from "@/components/payer/payer-overview";
import type { Contractor, Run, Wallet } from "@/lib/api";
import { serverGet } from "@/lib/server-api";

export const metadata: Metadata = { title: "Payer overview" };

/**
 * The first paint carries the treasury, contractors and runs (fetched on the server), so the
 * setup guide and insights are in the HTML rather than arriving after client JavaScript. The
 * client then refreshes them; if the service cannot be reached from the server, the client
 * fetch and its error states take over.
 */
export default async function PayerOverviewPage() {
  const [wallet, contractors, runs] = await Promise.all([
    serverGet<Wallet>("/api/wallet"),
    serverGet<{ contractors: Contractor[] }>("/api/contractors").then((r) => r?.contractors),
    serverGet<{ runs: Run[] }>("/api/runs").then((r) => r?.runs),
  ]);
  return <PayerOverview initial={{ wallet, contractors, runs }} />;
}
