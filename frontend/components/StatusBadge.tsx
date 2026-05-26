import type { Status } from "@/lib/types";

const styles: Record<Status, string> = {
  queued: "bg-sky-50 text-sky-700 ring-sky-200",
  running: "bg-amber-50 text-amber-800 ring-amber-200",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  failed: "bg-rose-50 text-rose-700 ring-rose-200",
  unknown: "bg-zinc-100 text-zinc-700 ring-zinc-200",
  stopped: "bg-violet-50 text-violet-700 ring-violet-200"
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={`inline-flex h-6 items-center rounded px-2 text-xs font-semibold capitalize ring-1 ${styles[status]}`}
    >
      {status}
    </span>
  );
}

