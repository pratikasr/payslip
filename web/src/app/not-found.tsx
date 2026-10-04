import Link from "next/link";
import { Logo } from "@/components/app/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4">
      <Logo />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">This page does not exist</h1>
        <p className="text-muted-foreground">Check the address, or start again from the role chooser.</p>
      </div>
      <div className="flex gap-2">
        <Button asChild>
          <Link href="/app">Open the app</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Home</Link>
        </Button>
      </div>
    </main>
  );
}
