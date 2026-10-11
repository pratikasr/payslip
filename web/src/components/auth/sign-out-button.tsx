"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { cn } from "cn";

/** Ends the session and returns to the sign-in page. */
export function SignOutButton({
  className,
  variant = "ghost",
  size = "sm",
}: {
  className?: string;
  variant?: "ghost" | "secondary" | "outline";
  size?: "sm" | "default";
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    try {
      await authClient.signOut();
      router.push("/sign-in");
      router.refresh();
    } catch {
      toast.error("Could not sign out", { description: "Reload the page and try again." });
      setBusy(false);
    }
  };
  return (
    <Button type="button" variant={variant} size={size} className={cn(className)} onClick={signOut} disabled={busy}>
      <LogOut aria-hidden="true" />
      {busy ? "Signing out" : "Sign out"}
    </Button>
  );
}
