import type { Metadata } from "next";
import { InvitationsView } from "@/components/console/org/invitations-view";
import type { Invitation } from "@/lib/api";
import { serverGet } from "@/lib/server-api";

export const metadata: Metadata = { title: "Invitations" };

export default async function InvitationsPage() {
  const invitations = await serverGet<{ invitations: Invitation[] }>("/api/org/invitations").then(
    (r) => r?.invitations,
  );
  return <InvitationsView initial={invitations} />;
}
