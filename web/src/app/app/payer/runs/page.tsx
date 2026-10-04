import type { Metadata } from "next";
import { RunsView } from "@/components/payer/runs-view";

export const metadata: Metadata = { title: "Runs" };

export default function RunsPage() {
  return <RunsView />;
}
