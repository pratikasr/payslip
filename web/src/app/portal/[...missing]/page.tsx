import { notFound } from "next/navigation";

/** Any other address under /portal: "Page not found" inside the portal, so its shell stays. */
export default function PortalMissing() {
  notFound();
}
