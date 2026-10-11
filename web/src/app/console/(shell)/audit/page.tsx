import type { Metadata } from "next";
import { AuditView } from "@/components/console/org/audit-view";
import type { AuditEntry } from "@/lib/api";
import { serverGet } from "@/lib/server-api";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  const entries = await serverGet<{ entries: AuditEntry[] }>("/api/org/audit?limit=100").then((r) => r?.entries);
  return <AuditView initial={entries} />;
}
