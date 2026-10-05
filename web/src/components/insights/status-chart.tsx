import { formatCount } from "@/lib/format";
import type { StatusGroup, StatusGroupId } from "@/lib/insights";
import { cn } from "cn";

/* Status tones, the same ones the run badges use. Every segment is named in the legend beside it. */
const FILL: Record<StatusGroupId, string> = {
  open: "bg-warning",
  progress: "bg-info",
  paid: "bg-success",
  failed: "bg-danger",
};

/** Runs by status as one part-to-whole bar, with a count per status so color is never the only signal. */
export function StatusChart({ groups, total }: { groups: StatusGroup[]; total: number }) {
  const present = groups.filter((g) => g.count > 0);
  return (
    <div className="space-y-2.5">
      <p className="text-sm font-semibold">
        Runs by status <span className="num font-normal text-muted-foreground">({formatCount(total)})</span>
      </p>
      <div aria-hidden="true" className="flex h-2.5 gap-[2px] overflow-hidden rounded-[4px] bg-muted">
        {present.map((g) => (
          <span
            key={g.id}
            className={cn("h-full transition-[flex-grow] duration-500", FILL[g.id])}
            style={{ flexGrow: g.count, flexBasis: 0 }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {groups.map((g) => (
          <li key={g.id} className={cn("inline-flex items-center gap-2", g.count === 0 && "text-muted-foreground")}>
            <span aria-hidden="true" className={cn("size-2 rounded-full", g.count === 0 ? "bg-border" : FILL[g.id])} />
            {g.label}
            <span className="num font-medium text-foreground">{formatCount(g.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
