"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Play, RefreshCw } from "lucide-react";
import { JobTable } from "@/components/JobTable";
import { StatusBadge } from "@/components/StatusBadge";
import { ApiError, listJobs, listScripts, startJob } from "@/lib/api";
import { clearTokens, getAccessToken } from "@/lib/auth";
import type { DeploymentJob, ScriptDefinition } from "@/lib/types";

export default function DashboardPage() {
  const router = useRouter();
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [jobs, setJobs] = useState<DeploymentJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingSlug, setStartingSlug] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeScriptSlugs = useMemo(
    () =>
      new Set(
        jobs
          .filter((job) => job.status === "queued" || job.status === "running")
          .map((job) => job.script.slug)
      ),
    [jobs]
  );

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const [scriptData, jobData] = await Promise.all([listScripts(), listJobs()]);
      setScripts(scriptData);
      setJobs(jobData);
    } catch (exc) {
      if (exc instanceof ApiError && exc.status === 401) {
        clearTokens();
        router.replace("/login");
        return;
      }
      setError(exc instanceof Error ? exc.message : "Could not load dashboard data.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }
    void loadData();
    const interval = window.setInterval(() => void loadData(), 10000);
    return () => window.clearInterval(interval);
  }, [loadData, router]);

  async function handleStart(script: ScriptDefinition) {
    setError(null);
    setStartingSlug(script.slug);
    try {
      const job = await startJob(script.slug);
      router.push(`/jobs/${job.id}`);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not start deployment.");
    } finally {
      setStartingSlug(null);
    }
  }

  function handleLogout() {
    clearTokens();
    router.replace("/login");
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-950">Deploy Control Panel</h1>
            <p className="text-sm text-zinc-600">Private deploy jobs for the target server.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="focus-ring inline-flex h-9 items-center gap-2 rounded border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={() => void loadData()}
              type="button"
            >
              <RefreshCw aria-hidden="true" size={16} /> Refresh
            </button>
            <button
              className="focus-ring inline-flex h-9 items-center gap-2 rounded border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={handleLogout}
              type="button"
            >
              <LogOut aria-hidden="true" size={16} /> Logout
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6">
        {error ? (
          <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-950">Available scripts</h2>
            {loading ? <span className="text-sm text-zinc-500">Loading...</span> : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {scripts.map((script) => {
              const isActive = activeScriptSlugs.has(script.slug);
              return (
                <div
                  className="rounded border border-zinc-200 bg-white p-4 shadow-panel"
                  key={script.slug}
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-zinc-950">{script.label}</h3>
                      <p className="mt-1 text-sm text-zinc-600">{script.description}</p>
                    </div>
                    {isActive ? <StatusBadge status="running" /> : null}
                  </div>
                  <button
                    className="focus-ring inline-flex h-9 items-center gap-2 rounded bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                    disabled={isActive || startingSlug === script.slug}
                    onClick={() => void handleStart(script)}
                    type="button"
                  >
                    <Play aria-hidden="true" size={16} />
                    {startingSlug === script.slug ? "Starting..." : "Start deploy"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-base font-semibold text-zinc-950">Recent jobs</h2>
          <JobTable jobs={jobs} />
        </section>
      </div>
    </main>
  );
}

