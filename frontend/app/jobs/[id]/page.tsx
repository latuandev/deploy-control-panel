"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { ArrowLeft, RefreshCw, Square } from "lucide-react";
import { LogViewer } from "@/components/LogViewer";
import { StatusBadge } from "@/components/StatusBadge";
import { API_BASE_URL, ApiError, getJob, refreshAccessToken, refreshJobStatus, stopJob } from "@/lib/api";
import { clearTokens, getAccessToken } from "@/lib/auth";
import type { DeploymentJob } from "@/lib/types";

interface LogEntry {
  line: string;
  timestamp: string;
}

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [job, setJob] = useState<DeploymentJob | null>(null);
  const [lines, setLines] = useState<LogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const streamStarted = useRef(false);

  const loadJob = useCallback(async () => {
    setError(null);
    try {
      setJob(await getJob(params.id));
    } catch (exc) {
      if (exc instanceof ApiError && exc.status === 401) {
        clearTokens();
        router.replace("/login");
        return;
      }
      setError(exc instanceof Error ? exc.message : "Could not load job.");
    }
  }, [params.id, router]);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }
    void loadJob();
  }, [loadJob, router]);

  useEffect(() => {
    if (!job || streamStarted.current) {
      return;
    }
    streamStarted.current = true;
    const jobId = job.id;
    const controller = new AbortController();

    async function startStream() {
      let accessToken = getAccessToken();
      if (!accessToken) {
        accessToken = await refreshAccessToken();
      }
      if (!accessToken) {
        clearTokens();
        router.replace("/login");
        return;
      }

      await fetchEventSource(`${API_BASE_URL}/api/jobs/${jobId}/logs/stream/`, {
        signal: controller.signal,
        openWhenHidden: true,
        headers: {
          Authorization: `Bearer ${accessToken}`
        },
        onmessage(message) {
          if (!message.data) {
            return;
          }

          if (message.event === "status") {
            const payload = JSON.parse(message.data) as {
              status: DeploymentJob["status"];
              exit_code: number | null;
            };
            setJob((current) =>
              current
                ? { ...current, status: payload.status, exit_code: payload.exit_code }
                : current
            );
            controller.abort();
            return;
          }

          if (message.event === "error") {
            const payload = JSON.parse(message.data) as { detail?: string };
            setError(payload.detail || "Log stream failed.");
            controller.abort();
            return;
          }

          const payload = JSON.parse(message.data) as LogEntry;
          setLines((current) => [...current, payload]);
        },
        onerror(exc) {
          setError(exc instanceof Error ? exc.message : "Log stream failed.");
          throw exc;
        }
      });
    }

    void startStream();
    return () => controller.abort();
  }, [job, router]);

  async function handleRefresh() {
    if (!job) {
      return;
    }
    try {
      setJob(await refreshJobStatus(job.id));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not refresh status.");
    }
  }

  async function handleStop() {
    if (!job) {
      return;
    }
    setStopping(true);
    setError(null);
    try {
      setJob(await stopJob(job.id));
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not stop job.");
    } finally {
      setStopping(false);
    }
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <Link
              className="focus-ring mb-2 inline-flex items-center gap-1 rounded px-1 py-1 text-sm font-medium text-zinc-600 hover:text-zinc-950"
              href="/dashboard"
            >
              <ArrowLeft aria-hidden="true" size={16} /> Dashboard
            </Link>
            <h1 className="text-xl font-semibold text-zinc-950">
              {job ? job.script.label : "Deployment job"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {job ? <StatusBadge status={job.status} /> : null}
            <button
              className="focus-ring inline-flex h-9 items-center gap-2 rounded border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={() => void handleRefresh()}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={16} /> Refresh
            </button>
            {job?.status === "running" || job?.status === "queued" ? (
              <button
                className="focus-ring inline-flex h-9 items-center gap-2 rounded bg-rose-700 px-3 text-sm font-semibold text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                disabled={stopping}
                onClick={() => void handleStop()}
                type="button"
              >
                <Square aria-hidden="true" size={15} /> {stopping ? "Stopping..." : "Stop"}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6">
        {error ? (
          <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {job ? (
          <section className="mb-4 grid gap-3 md:grid-cols-4">
            <Meta label="Remote job" value={job.remote_job_id} />
            <Meta label="Started by" value={job.started_by} />
            <Meta label="Started" value={formatDate(job.started_at)} />
            <Meta label="Exit code" value={job.exit_code === null ? "Pending" : String(job.exit_code)} />
          </section>
        ) : null}

        <LogViewer lines={lines} />
      </div>
    </main>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-200 bg-white px-4 py-3 shadow-panel">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 truncate text-sm font-medium text-zinc-950" title={value}>
        {value}
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
