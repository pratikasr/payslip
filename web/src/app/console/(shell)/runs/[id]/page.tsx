import type { Metadata } from "next";
import { RunPage } from "@/components/runs/run-page";
import { runTitle } from "@/components/runs/run-meta";
import type { Run } from "@/lib/api";
import { serverGet } from "@/lib/server-api";

async function initialRun(id: string): Promise<Run | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  return serverGet<Run>(`/api/runs/${id}`);
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const run = await initialRun((await params).id);
  return { title: run ? `${runTitle(run)} payroll` : "Payroll run" };
}

/**
 * The first paint carries the run fetched on the server, so the pay lines show without waiting
 * for client JavaScript. The client then keeps it live over the run's event stream.
 */
export default async function ConsoleRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunPage runId={id} initial={await initialRun(id)} />;
}
