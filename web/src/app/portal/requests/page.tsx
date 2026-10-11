import type { Metadata } from "next";
import { RequestPayment } from "@/components/portal/request-payment";

export const metadata: Metadata = { title: "Request a payment" };

export default function PortalRequestsPage() {
  return <RequestPayment />;
}
