import type { Metadata } from "next";
import { SettingsView } from "@/components/console/org/settings-view";
import type { Organisation } from "@/lib/api";
import { serverGet } from "@/lib/server-api";

export const metadata: Metadata = { title: "Settings" };

/** The organisation's name and logo (admins), rendered on the server for the first paint. */
export default async function SettingsPage() {
  const org = await serverGet<Organisation>("/api/org");
  return <SettingsView initial={org} />;
}
