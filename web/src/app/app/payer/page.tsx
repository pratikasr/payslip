import type { Metadata } from "next";
import { PayerOverview } from "@/components/payer/payer-overview";

export const metadata: Metadata = { title: "Payer overview" };

export default function PayerOverviewPage() {
  return <PayerOverview />;
}
