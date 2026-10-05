import type { Metadata } from "next";
import { Suspense } from "react";
import { PeopleView } from "@/components/console/people/people-view";
import type { Contractor, Run } from "@/lib/api";
import { serverGet } from "@/lib/server-api";

export const metadata: Metadata = { title: "People" };

/** People and their last payments render on the server for the first paint; the client refreshes them. */
export default async function PeoplePage() {
  const [contractors, runs] = await Promise.all([
    serverGet<{ contractors: Contractor[] }>("/api/contractors").then((r) => r?.contractors),
    serverGet<{ runs: Run[] }>("/api/runs").then((r) => r?.runs),
  ]);
  return (
    <Suspense>
      <PeopleView initial={{ contractors, runs }} />
    </Suspense>
  );
}
