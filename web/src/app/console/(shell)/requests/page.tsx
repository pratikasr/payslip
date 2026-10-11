import type { Metadata } from "next";
import { RequestsView } from "@/components/console/requests/requests-view";
import type { PaymentRequest, RequestCounts } from "@/lib/api";
import { serverGet } from "@/lib/server-api";

export const metadata: Metadata = { title: "Payment requests" };

/** The queue renders on the server for the first paint; the client refreshes it. */
export default async function RequestsPage() {
  const initial = await serverGet<{ requests: PaymentRequest[]; counts: RequestCounts }>("/api/requests");
  return <RequestsView initial={initial} />;
}
