import type { Metadata } from "next";
import { RunDetail } from "@/components/payer/run-detail";
import { API_URL, type Run } from "@/lib/api";

export const metadata: Metadata = { title: "Run" };

/**
 * The first paint carries the run itself (fetched on the server), so the page does not wait
 * for client JavaScript to show the pay lines. The client then keeps it live over SSE. If the
 * service cannot be reached from the server, the client fetch and its error state take over.
 */
async function initialRun(id: string): Promise<Run | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  try {
    const res = await fetch(`${API_URL}/api/runs/${id}`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    return res.ok ? ((await res.json()) as Run) : undefined;
  } catch {
    return undefined;
  }
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RunDetail runId={id} initial={await initialRun(id)} />;
}
