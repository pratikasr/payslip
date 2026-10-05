import type { Metadata } from "next";
import { AccessView } from "@/components/console/access/access-view";
import type { Contractor } from "@/lib/api";
import { serverGet } from "@/lib/server-api";

export const metadata: Metadata = { title: "Payslip access" };

/**
 * The people render on the server for the first paint. Viewing keys are fetched in the browser
 * only, so they never sit in the server-rendered HTML.
 */
export default async function AccessPage() {
  const contractors = await serverGet<{ contractors: Contractor[] }>("/api/contractors").then((r) => r?.contractors);
  return <AccessView initial={{ contractors }} />;
}
