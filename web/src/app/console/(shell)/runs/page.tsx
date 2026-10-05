import type { Metadata } from "next";
import { RunsList } from "@/components/runs/runs-list";
import type { Run } from "@/lib/api";
import { serverGet } from "@/lib/server-api";

export const metadata: Metadata = { title: "Payroll runs" };

/** The first paint carries the runs fetched on the server; the client refreshes them on mount. */
export default async function RunsPage() {
  const initial = await serverGet<{ runs: Run[] }>("/api/runs");
  return <RunsList initial={initial?.runs} />;
}
