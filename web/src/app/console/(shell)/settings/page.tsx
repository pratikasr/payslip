import type { Metadata } from "next";
import { SettingsView } from "@/components/console/settings/settings-view";
import type { Contractor, PaySchedule } from "@/lib/api";
import { serverGet } from "@/lib/server-api";

export const metadata: Metadata = { title: "Settings" };

/** The schedule and the people render on the server for the first paint; the client refreshes them. */
export default async function SettingsPage() {
  const [schedule, contractors] = await Promise.all([
    serverGet<{ schedule: PaySchedule | null }>("/api/schedule").then((r) => r?.schedule),
    serverGet<{ contractors: Contractor[] }>("/api/contractors").then((r) => r?.contractors),
  ]);
  return <SettingsView initial={{ schedule, contractors }} />;
}
