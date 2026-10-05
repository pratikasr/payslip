import type { Metadata } from "next";
import { TreasuryView } from "@/components/console/treasury/treasury-view";
import type { Run, Wallet } from "@/lib/api";
import { serverGet } from "@/lib/server-api";

export const metadata: Metadata = { title: "Treasury" };

/** Balance, address and funding history render on the server for the first paint. */
export default async function TreasuryPage() {
  const [wallet, runs] = await Promise.all([
    serverGet<Wallet>("/api/wallet"),
    serverGet<{ runs: Run[] }>("/api/runs").then((r) => r?.runs),
  ]);
  return <TreasuryView initial={{ wallet, runs }} />;
}
