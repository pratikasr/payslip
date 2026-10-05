import { notFound } from "next/navigation";

/** Any other address under /books: "Page not found" inside Books, so its shell stays. */
export default function BooksMissing() {
  notFound();
}
