import type { ReactNode } from "react";
import { cn } from "cn";

/** Page title: Mercury's 28px light headline, actions to the right on wide screens. */
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
        {back ? <div className="mb-2 text-[0.8125rem] text-muted-foreground">{back}</div> : null}
        <h1 className="text-[1.75rem] leading-tight font-[380] tracking-[-0.015em] text-balance">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-[0.9375rem] text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** A row of pill actions under the title (Mercury's Send, Transfer, Deposit...). */
export function ActionRow({ children, end }: { children: ReactNode; end?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2">
      {children}
      {end ? <div className="ml-auto hidden sm:flex">{end}</div> : null}
    </div>
  );
}

/** A section heading inside a page: 19px, with an optional control beside it. */
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
      <h2 id={id} className="text-[1.1875rem] font-normal tracking-[-0.01em]">
        {title}
      </h2>
      {children}
    </div>
  );
}
