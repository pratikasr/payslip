import { CircleCheck, OctagonAlert, TriangleAlert } from "lucide-react";
import type { Network } from "@/lib/api";
import type { KeyClassification } from "@/lib/keys";
import { networkLabel } from "@/lib/format";

/** One line under a key input saying whether it can be used, and why not. */
export function KeyStatus({
  result,
  serviceNetwork,
  id,
}: {
  result: KeyClassification;
  serviceNetwork?: Network;
  id?: string;
}) {
  if (result.kind === "rejected") {
    const Icon = result.spending ? OctagonAlert : TriangleAlert;
    return (
      <p id={id} role="alert" className="flex items-start gap-2 text-sm text-danger">
        <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>{result.reason}</span>
      </p>
    );
  }
  if (serviceNetwork && result.network !== serviceNetwork) {
    return (
      <p id={id} role="alert" className="flex items-start gap-2 text-sm text-danger">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          This is a {networkLabel(result.network).toLowerCase()} key, but the service runs on {serviceNetwork}. Use a
          key from the {serviceNetwork} payer.
        </span>
      </p>
    );
  }
  return (
    <p id={id} className="flex items-start gap-2 text-sm text-success">
      <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <span>
        Unified full viewing key for {networkLabel(result.network).toLowerCase()}. It can read payments but cannot
        spend.
      </span>
    </p>
  );
}
