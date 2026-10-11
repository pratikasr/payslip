import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * A card: a piece of paper with a ruled edge and square corners (docs/DESIGN.md section 17). Only
 * for an object with a boundary (a balance, a run, a person); sections and page-level tables
 * flow on the sheet without one.
 */
export function Card({
  children,
  className,
  as: Tag = "section",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "article" | "li";
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <Tag className={cn("paper min-w-0 border p-5 text-card-foreground sm:px-[22px]", className)} {...rest}>
      {children}
    </Tag>
  );
}

/** The card's title row: the title in the display face, inked, with actions on the right. */
export function CardHeader({
  title,
  actions,
  id,
  className,
}: {
  title: ReactNode;
  actions?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-3", className)}>
      <h2 id={id} className="inked font-display text-[1.125rem] leading-tight font-bold text-foreground">
        {title}
      </h2>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A card footer split by a hairline: a small label over a value, with an action at the end. */
export function CardFoot({ label, value, action }: { label: ReactNode; value: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-4 flex items-end justify-between gap-3 border-t border-hairline pt-3.5">
      <div className="min-w-0">
        <div className="form-label text-[0.75rem] text-muted-foreground">{label}</div>
        <div className="mt-0.5 font-type text-[0.9375rem]">{value}</div>
      </div>
      {action}
    </div>
  );
}
