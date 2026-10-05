"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { copyText } from "@/lib/download";
import { cn } from "cn";

interface CopyButtonProps {
  value: string;
  /** What is being copied, for the accessible name and the toast: "transaction id". */
  label: string;
  className?: string;
  size?: "icon-xs" | "icon-sm" | "sm";
  children?: React.ReactNode;
  /** Called after a successful copy, for example to record that a key file was sent. */
  onCopied?: () => void;
}

export function CopyButton({ value, label, className, size = "icon-xs", children, onCopied }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const onCopy = async () => {
    const ok = await copyText(value);
    if (ok) {
      setCopied(true);
      toast.success(`Copied ${label}`);
      onCopied?.();
    } else {
      toast.error(`Could not copy the ${label}. Select the text and copy it manually.`);
    }
  };

  const Icon = copied ? Check : Copy;
  return (
    <Button
      type="button"
      variant={children ? "outline" : "ghost"}
      size={children ? "sm" : size}
      className={cn("text-muted-foreground hover:text-foreground", copied && "text-success", className)}
      onClick={onCopy}
      aria-label={children ? undefined : `Copy ${label}`}
      title={children ? undefined : `Copy ${label}`}
    >
      <Icon aria-hidden="true" />
      {children}
    </Button>
  );
}
