import type { Metadata } from "next";
import { TreasuryKeyView } from "@/components/console/treasury-key/treasury-key-view";
import type { TreasuryKey } from "@/lib/api";
import { serverGet } from "@/lib/server-api";

export const metadata: Metadata = { title: "Treasury key" };

/** The key's state, address and storage render on the server for the first paint; the client refreshes them. */
export default async function TreasuryKeyPage() {
  const key = await serverGet<TreasuryKey>("/api/treasury/key");
  return <TreasuryKeyView initial={{ key }} />;
}
