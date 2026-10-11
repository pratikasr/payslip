import type { Metadata } from "next";
import { ConsoleHome } from "@/components/console/home/console-home";
import type { Contractor, PaymentRequest, PaySchedule, RequestCounts, Run, Wallet } from "@/lib/api";
import { serverGet } from "@/lib/server-api";

export const metadata: Metadata = { title: "Company home" };

/**
 * The first paint carries the treasury, people and runs (fetched on the server), so the cards are
 * in the HTML and nothing moves when client JavaScript arrives. The client then refreshes them;
 * if the server cannot reach the service, the client fetch and its error states take over.
 */
export default async function ConsoleHomePage() {
  const [wallet, contractors, runs, schedule, requests] = await Promise.all([
    serverGet<Wallet>("/api/wallet"),
    serverGet<{ contractors: Contractor[] }>("/api/contractors").then((r) => r?.contractors),
    serverGet<{ runs: Run[] }>("/api/runs").then((r) => r?.runs),
    serverGet<{ schedule: PaySchedule | null }>("/api/schedule").then((r) => r?.schedule),
    serverGet<{ requests: PaymentRequest[]; counts: RequestCounts }>("/api/requests?status=submitted"),
  ]);
  return <ConsoleHome initial={{ wallet, contractors, runs, schedule, requests }} />;
}
