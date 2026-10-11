import type { Metadata } from "next";
import { MembersView } from "@/components/console/org/members-view";
import type { OrgMember } from "@/lib/api";
import { serverGet } from "@/lib/server-api";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage() {
  const members = await serverGet<{ members: OrgMember[] }>("/api/org/members").then((r) => r?.members);
  return <MembersView initial={members} />;
}
