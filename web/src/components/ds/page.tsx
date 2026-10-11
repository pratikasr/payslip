import type { ReactNode } from "react";
import { cn } from "cn";
import { TYPE } from "@/components/ds/type";

/** Page title: Redaction 35 at the title size, inked, actions to the right on wide screens. */
export function PageTitle({
  title,
  description,
  actions,
  back,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  back?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        {back ? <div className={cn("mb-2 text-muted-foreground", TYPE.caption)}>{back}</div> : null}
        <h1 className={cn(TYPE.title, "text-balance")}>{title}</h1>
        {description ? <p className={cn("mt-2 max-w-2xl text-muted-foreground", TYPE.body)}>{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A row of actions under the title: the one ink-filled action, and outlined ones beside it. */
export function ActionRow({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      {children}
      {end ? <div className="ml-auto hidden sm:flex">{end}</div> : null}
    </div>
  );
}

/** A section heading inside a page, in Redaction at the heading size, with an optional control beside it. */
export function SectionHeader({
  title,
  children,
  id,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <div className={cn("mt-10 mb-3.5 flex flex-wrap items-center gap-x-4 gap-y-2", className)}>
      <h2 id={id} className={TYPE.heading}>
        {title}
      </h2>
      {children}
    </div>
  );
}
