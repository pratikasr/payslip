import type { Metadata } from "next";
import { SettingsView } from "@/components/console/settings/settings-view";
import type { Contractor, Organisation, PaySchedule, TreasuryKey } from "@/lib/api";
import { authRequired } from "@/lib/auth-config";
import { serverGet } from "@/lib/server-api";

export const metadata: Metadata = { title: "Settings" };

/**
 * The organisation's name and logo (with sign-in on, for admins) and the pay schedule with each
 * person's default amount, rendered on the server for the first paint; the client refreshes them.
 */
export default async function SettingsPage() {
  const [org, schedule, contractors, key] = await Promise.all([
    authRequired() ? serverGet<Organisation>("/api/org") : Promise.resolve(undefined),
    serverGet<{ schedule: PaySchedule | null }>("/api/schedule").then((r) => r?.schedule),
    serverGet<{ contractors: Contractor[] }>("/api/contractors").then((r) => r?.contractors),
    serverGet<TreasuryKey>("/api/treasury/key"),
  ]);
  return <SettingsView initial={{ org, schedule, contractors, key }} />;
}
