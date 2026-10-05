import { notFound } from "next/navigation";

/** Any other address under /console: "Page not found" inside the console, so its sidebar stays. */
export default function ConsoleMissing() {
  notFound();
}
