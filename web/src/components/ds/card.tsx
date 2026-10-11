import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * A card: Paper with a border, 12px corners, no shadow. Only for an object with a boundary (a
 * balance, a run, a person); sections and page-level tables flow on the page without one.
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
    <Tag className={cn("min-w-0 rounded-xl border bg-card p-5 text-card-foreground sm:px-[22px]", className)} {...rest}>
      {children}
    </Tag>
  );
}

/** The card's title row: a body-size label on the left, round icon actions on the right. */
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
      <h2 id={id} className="text-[0.9375rem] font-medium text-strong">
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
        <div className="text-[0.8125rem] text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-[0.9375rem]">{value}</div>
      </div>
      {action}
    </div>
  );
}
