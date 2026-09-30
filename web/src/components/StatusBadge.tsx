import type { RequestStatus, RideStatus } from "@/lib/api";
import { cx } from "./ui";

const styles: Record<RequestStatus | RideStatus, string> = {
  REQUESTED: "bg-amber-100 text-amber-800",
  MATCHED: "bg-blue-100 text-blue-800",
  IN_PROGRESS: "bg-violet-100 text-violet-800",
  COMPLETED: "bg-emerald-100 text-emerald-800",
  CANCELLED: "bg-zinc-200 text-zinc-700",
  OPEN: "bg-amber-100 text-amber-800",
  DRIVER_ARRIVED: "bg-blue-100 text-blue-800",
  STARTED: "bg-violet-100 text-violet-800",
};

export function StatusBadge({ status }: { status: RequestStatus | RideStatus }) {
  return (
    <span
      data-status={status}
      className={cx(
        "inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide",
        styles[status],
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}
