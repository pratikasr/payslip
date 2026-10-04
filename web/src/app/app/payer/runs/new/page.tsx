import type { Metadata } from "next";
import { NewRunForm } from "@/components/payer/new-run-form";

export const metadata: Metadata = { title: "New run" };

export default function NewRunPage() {
  return <NewRunForm />;
}
