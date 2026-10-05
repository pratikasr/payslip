import type { Metadata } from "next";
import { PortalHome } from "@/components/portal/portal-home";

export const metadata: Metadata = { title: "Home" };

export default function PortalHomePage() {
  return <PortalHome />;
}
