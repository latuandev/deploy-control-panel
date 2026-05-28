"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { StatusBadge } from "@/components/StatusBadge";
import type { DeploymentJob } from "@/lib/types";

export function JobTable({ jobs }: { jobs: DeploymentJob[] }) {
  if (!jobs.length) {
    return (
      <div className="rounded border border-dashed border-zinc-300 bg-white px-4 py-8 text-center text-sm text-zinc-600">
        No deployment jobs yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded border border-zinc-200 bg-white shadow-panel">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-4 py-3">Script</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Started</th>
              <th className="px-4 py-3">Started by</th>
              <th className="px-4 py-3 text-right">Job</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {jobs.map((job) => (
              <tr key={job.id} className="hover:bg-zinc-50">
                <td className="whitespace-nowrap px-4 py-3 font-medium text-zinc-900">
                  {job.script.label}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-zinc-600">
                  {job.target.name}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <StatusBadge status={job.status} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-zinc-600">
                  {formatDate(job.started_at)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-zinc-600">
                  {job.started_by}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <Link
                    className="focus-ring inline-flex items-center gap-1 rounded px-2 py-1 font-medium text-emerald-700 hover:bg-emerald-50"
                    href={`/jobs/${job.id}`}
                  >
                    Open <ExternalLink aria-hidden="true" size={14} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
