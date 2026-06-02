"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban,
  FileCode,
  LogOut,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Server,
  Terminal,
  Trash2,
  Wifi,
  X
} from "lucide-react";
import { JobTable } from "@/components/JobTable";
import { StatusBadge } from "@/components/StatusBadge";
import {
  ApiError,
  API_BASE_URL,
  createScript,
  createTarget,
  disableScript,
  disableTarget,
  getCurrentUser,
  hardDeleteScript,
  hardDeleteTarget,
  listJobs,
  listScripts,
  listTargets,
  startJob,
  testTargetConnection,
  updateScript,
  updateTarget
} from "@/lib/api";
import { clearTokens, getAccessToken } from "@/lib/auth";
import type {
  DeploymentJob,
  CreatedTargetServer,
  ScriptDefinition,
  TargetServer,
  UserProfile
} from "@/lib/types";

const inputClass =
  "focus-ring h-9 w-full rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950 placeholder:text-zinc-400";
const labelClass = "text-xs font-semibold uppercase tracking-wide text-zinc-500";

const defaultTargetForm = {
  slug: "",
  name: "",
  allowed_script_dir: "/opt/scripts",
  log_dir: "/home/deployer/logs/deploy",
  enabled: true
};

const defaultScriptForm = {
  target_server_id: "",
  slug: "",
  label: "",
  remote_key: "",
  remote_script_path: "/opt/scripts/deploy-app.sh",
  description: "",
  enabled: true
};

const JOB_PAGE_SIZE = 20;

function targetToForm(target: TargetServer): typeof defaultTargetForm {
  return {
    slug: target.slug,
    name: target.name,
    allowed_script_dir: target.allowed_script_dir,
    log_dir: target.log_dir,
    enabled: target.enabled
  };
}

function scriptToForm(script: ScriptDefinition): typeof defaultScriptForm {
  return {
    target_server_id: String(script.target.id),
    slug: script.slug,
    label: script.label,
    remote_key: script.remote_key,
    remote_script_path: script.remote_script_path,
    description: script.description,
    enabled: script.enabled
  };
}

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [targets, setTargets] = useState<TargetServer[]>([]);
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [jobs, setJobs] = useState<DeploymentJob[]>([]);
  const [jobsNextOffset, setJobsNextOffset] = useState(JOB_PAGE_SIZE);
  const [jobsHasMore, setJobsHasMore] = useState(false);
  const [loadingMoreJobs, setLoadingMoreJobs] = useState(false);
  const [loading, setLoading] = useState(true);
  const [startingSlug, setStartingSlug] = useState<string | null>(null);
  const [savingTarget, setSavingTarget] = useState(false);
  const [savingScript, setSavingScript] = useState(false);
  const [disablingTargetId, setDisablingTargetId] = useState<number | null>(null);
  const [disablingScriptId, setDisablingScriptId] = useState<number | null>(null);
  const [deletingTargetId, setDeletingTargetId] = useState<number | null>(null);
  const [deletingScriptId, setDeletingScriptId] = useState<number | null>(null);
  const [testingTargetId, setTestingTargetId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [createdTarget, setCreatedTarget] = useState<CreatedTargetServer | null>(null);
  const [editingTargetId, setEditingTargetId] = useState<number | null>(null);
  const [editingScriptId, setEditingScriptId] = useState<number | null>(null);
  const [targetForm, setTargetForm] = useState(defaultTargetForm);
  const [scriptForm, setScriptForm] = useState(defaultScriptForm);
  const [error, setError] = useState<string | null>(null);
  const jobsLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadedJobLimitRef = useRef(JOB_PAGE_SIZE);
  const loadingMoreJobsRef = useRef(false);
  const jobsHasMoreRef = useRef(false);

  const activeScriptSlugs = useMemo(
    () =>
      new Set(
        jobs
          .filter((job) => job.status === "queued" || job.status === "running")
          .map((job) => job.script.slug)
      ),
    [jobs]
  );

  const activeScriptIds = useMemo(
    () =>
      new Set(
        jobs
          .filter((job) => job.status === "queued" || job.status === "running")
          .map((job) => job.script.id)
      ),
    [jobs]
  );

  const activeTargetIds = useMemo(
    () =>
      new Set(
        jobs
          .filter((job) => job.status === "queued" || job.status === "running")
          .map((job) => job.target.id)
      ),
    [jobs]
  );

  const availableScripts = useMemo(
    () => scripts.filter((script) => script.enabled && script.target.enabled),
    [scripts]
  );

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const profileData = await getCurrentUser();
      const jobLimit = Math.max(loadedJobLimitRef.current, JOB_PAGE_SIZE);
      const [scriptData, jobData, targetData] = await Promise.all([
        listScripts(profileData.is_staff),
        listJobs({ limit: jobLimit, offset: 0 }),
        profileData.is_staff ? listTargets() : Promise.resolve([])
      ]);
      setProfile(profileData);
      setScripts(scriptData);
      setJobs(jobData.results);
      setJobsNextOffset(jobData.next_offset);
      setJobsHasMore(jobData.has_more);
      jobsHasMoreRef.current = jobData.has_more;
      loadedJobLimitRef.current = Math.max(jobData.next_offset, JOB_PAGE_SIZE);
      setTargets(targetData);
      if (!scriptForm.target_server_id && targetData[0]) {
        setScriptForm((current) => ({
          ...current,
          target_server_id: current.target_server_id || String(targetData[0].id),
          remote_script_path: current.target_server_id
            ? current.remote_script_path
            : `${targetData[0].allowed_script_dir.replace(/\/$/, "")}/deploy-app.sh`
        }));
      }
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
  }, [router, scriptForm.target_server_id]);

  const loadMoreJobs = useCallback(async () => {
    if (loadingMoreJobsRef.current || !jobsHasMoreRef.current) {
      return;
    }

    loadingMoreJobsRef.current = true;
    setLoadingMoreJobs(true);
    setError(null);
    try {
      const page = await listJobs({ limit: JOB_PAGE_SIZE, offset: jobsNextOffset });
      setJobs((current) => {
        const seenJobIds = new Set(current.map((job) => job.id));
        const nextJobs = [...current];
        for (const job of page.results) {
          if (!seenJobIds.has(job.id)) {
            nextJobs.push(job);
          }
        }
        return nextJobs;
      });
      setJobsNextOffset(page.next_offset);
      setJobsHasMore(page.has_more);
      jobsHasMoreRef.current = page.has_more;
      loadedJobLimitRef.current = Math.max(loadedJobLimitRef.current, page.next_offset);
    } catch (exc) {
      if (exc instanceof ApiError && exc.status === 401) {
        clearTokens();
        router.replace("/login");
        return;
      }
      setError(exc instanceof Error ? exc.message : "Could not load more jobs.");
    } finally {
      loadingMoreJobsRef.current = false;
      setLoadingMoreJobs(false);
    }
  }, [jobsNextOffset, router]);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }
    void loadData();
    const interval = window.setInterval(() => void loadData(), 10000);
    return () => window.clearInterval(interval);
  }, [loadData, router]);

  useEffect(() => {
    const marker = jobsLoadMoreRef.current;
    if (!marker || !jobsHasMore) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          void loadMoreJobs();
        }
      },
      { rootMargin: "300px 0px" }
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [jobsHasMore, loadMoreJobs]);

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

  async function handleSaveTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingTarget(true);
    setError(null);
    setTestResult(null);
    setCreatedTarget(null);
    try {
      if (editingTargetId === null) {
        const target = await createTarget(targetForm);
        setCreatedTarget(target);
      } else {
        await updateTarget(editingTargetId, targetForm);
        setEditingTargetId(null);
      }
      setTargetForm(defaultTargetForm);
      await loadData();
    } catch (exc) {
      setError(
        exc instanceof Error
          ? exc.message
          : editingTargetId === null
            ? "Could not create target server."
            : "Could not update target server."
      );
    } finally {
      setSavingTarget(false);
    }
  }

  function handleEditTarget(target: TargetServer) {
    setCreatedTarget(null);
    setTestResult(null);
    setError(null);
    setEditingTargetId(target.id);
    setTargetForm(targetToForm(target));
  }

  function handleCancelEditTarget() {
    setEditingTargetId(null);
    setTargetForm(defaultTargetForm);
  }

  async function handleSaveScript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scriptForm.target_server_id) {
      setError("Choose a target server for this script.");
      return;
    }

    setSavingScript(true);
    setError(null);
    try {
      const payload = {
        ...scriptForm,
        target_server_id: Number(scriptForm.target_server_id)
      };
      if (editingScriptId === null) {
        await createScript(payload);
      } else {
        await updateScript(editingScriptId, payload);
        setEditingScriptId(null);
      }
      setScriptForm({
        ...defaultScriptForm,
        target_server_id: scriptForm.target_server_id
      });
      await loadData();
    } catch (exc) {
      setError(
        exc instanceof Error
          ? exc.message
          : editingScriptId === null
            ? "Could not create script."
            : "Could not update script."
      );
    } finally {
      setSavingScript(false);
    }
  }

  function handleEditScript(script: ScriptDefinition) {
    setError(null);
    setTestResult(null);
    setEditingScriptId(script.id);
    setScriptForm(scriptToForm(script));
  }

  function handleCancelEditScript() {
    setEditingScriptId(null);
    setScriptForm(defaultScriptForm);
  }

  async function handleDisableTarget(target: TargetServer) {
    if (activeTargetIds.has(target.id)) {
      setError("Stop or finish active jobs before disabling this target server.");
      return;
    }

    const confirmed = window.confirm(
      `Disable target "${target.name}"? This also disables linked scripts and keeps job history.`
    );
    if (!confirmed) {
      return;
    }

    setDisablingTargetId(target.id);
    setError(null);
    setTestResult(null);
    setCreatedTarget(null);
    try {
      await disableTarget(target.id);
      if (editingTargetId === target.id) {
        setEditingTargetId(null);
        setTargetForm(defaultTargetForm);
      }
      setTestResult(`Target ${target.name} was disabled.`);
      await loadData();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not disable target server.");
    } finally {
      setDisablingTargetId(null);
    }
  }

  async function handleDeleteTarget(target: TargetServer) {
    if (activeTargetIds.has(target.id)) {
      setError("Stop or finish active jobs before deleting this target server.");
      return;
    }

    const confirmed = window.confirm(
      `Permanently delete target "${target.name}"? This deletes linked scripts, deployment jobs, and log lines. This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }

    setDeletingTargetId(target.id);
    setError(null);
    setTestResult(null);
    setCreatedTarget(null);
    try {
      await hardDeleteTarget(target.id);
      if (editingTargetId === target.id) {
        setEditingTargetId(null);
        setTargetForm(defaultTargetForm);
      }
      setTestResult(`Target ${target.name} was permanently deleted.`);
      await loadData();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not permanently delete target server.");
    } finally {
      setDeletingTargetId(null);
    }
  }

  async function handleDisableScript(script: ScriptDefinition) {
    if (activeScriptIds.has(script.id)) {
      setError("Stop or finish active jobs before disabling this script.");
      return;
    }

    const confirmed = window.confirm(
      `Disable script "${script.label}"? This keeps deployment job history.`
    );
    if (!confirmed) {
      return;
    }

    setDisablingScriptId(script.id);
    setError(null);
    setTestResult(null);
    try {
      await disableScript(script.id);
      if (editingScriptId === script.id) {
        setEditingScriptId(null);
        setScriptForm(defaultScriptForm);
      }
      setTestResult(`Script ${script.label} was disabled.`);
      await loadData();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not disable script.");
    } finally {
      setDisablingScriptId(null);
    }
  }

  async function handleDeleteScript(script: ScriptDefinition) {
    if (activeScriptIds.has(script.id)) {
      setError("Stop or finish active jobs before deleting this script.");
      return;
    }

    const confirmed = window.confirm(
      `Permanently delete script "${script.label}"? This deletes related deployment jobs and log lines. This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }

    setDeletingScriptId(script.id);
    setError(null);
    setTestResult(null);
    try {
      await hardDeleteScript(script.id);
      if (editingScriptId === script.id) {
        setEditingScriptId(null);
        setScriptForm(defaultScriptForm);
      }
      setTestResult(`Script ${script.label} was permanently deleted.`);
      await loadData();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not permanently delete script.");
    } finally {
      setDeletingScriptId(null);
    }
  }

  async function handleTestTarget(target: TargetServer) {
    setTestingTargetId(target.id);
    setTestResult(null);
    setError(null);
    try {
      const result = await testTargetConnection(target.id);
      setTestResult(`${target.name}: ${result.detail}`);
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Agent check failed.");
    } finally {
      setTestingTargetId(null);
    }
  }

  function handleLogout() {
    clearTokens();
    router.replace("/login");
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white">
        <div className="flex w-full flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-10 xl:px-20">
          <div>
            <h1 className="text-xl font-semibold text-zinc-950">Deploy Control Panel</h1>
            <p className="text-sm text-zinc-600">Private deploy jobs for target servers.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {profile?.is_staff ? (
              <Link
                className="focus-ring inline-flex h-9 items-center gap-2 rounded border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                href="/setup"
              >
                <Terminal aria-hidden="true" size={16} /> Setup
              </Link>
            ) : null}
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

      <div className="w-full px-4 py-6 md:px-10 xl:px-20">
        {error ? (
          <div className="mb-4 rounded border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {testResult ? (
          <div className="mb-4 rounded border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {testResult}
          </div>
        ) : null}

        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-zinc-950">Available scripts</h2>
            {loading ? <span className="text-sm text-zinc-500">Loading...</span> : null}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {availableScripts.map((script) => {
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
                      <div className="mt-2 text-xs font-medium text-zinc-500">
                        {script.target.name} · {script.remote_script_path}
                      </div>
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

        {profile?.is_staff ? (
          <section className="mb-8 grid min-w-0 gap-6 lg:grid-cols-2">
            <TargetServerPanel
              form={targetForm}
              onChange={setTargetForm}
              onSubmit={handleSaveTarget}
              onEdit={handleEditTarget}
              onDisable={handleDisableTarget}
              onDelete={handleDeleteTarget}
              onCancelEdit={handleCancelEditTarget}
              onTest={handleTestTarget}
              activeTargetIds={activeTargetIds}
              createdTarget={createdTarget}
              disablingTargetId={disablingTargetId}
              deletingTargetId={deletingTargetId}
              editingTargetId={editingTargetId}
              saving={savingTarget}
              targets={targets}
              testingTargetId={testingTargetId}
            />
            <ScriptPanel
              form={scriptForm}
              onChange={setScriptForm}
              onSubmit={handleSaveScript}
              onEdit={handleEditScript}
              onDisable={handleDisableScript}
              onDelete={handleDeleteScript}
              onCancelEdit={handleCancelEditScript}
              activeScriptIds={activeScriptIds}
              disablingScriptId={disablingScriptId}
              deletingScriptId={deletingScriptId}
              editingScriptId={editingScriptId}
              saving={savingScript}
              scripts={scripts}
              targets={targets}
            />
          </section>
        ) : null}

        <section>
          <h2 className="mb-3 text-base font-semibold text-zinc-950">Recent jobs</h2>
          <JobTable jobs={jobs} />
          <div
            className="flex h-10 items-center justify-center text-sm text-zinc-500"
            ref={jobsLoadMoreRef}
          >
            {loadingMoreJobs
              ? "Loading more jobs..."
              : jobsHasMore
                ? "Scroll to load more"
                : jobs.length
                  ? "All jobs loaded"
                  : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function TargetServerPanel({
  activeTargetIds,
  createdTarget,
  disablingTargetId,
  deletingTargetId,
  editingTargetId,
  form,
  onChange,
  onCancelEdit,
  onDisable,
  onDelete,
  onEdit,
  onSubmit,
  onTest,
  saving,
  targets,
  testingTargetId
}: {
  activeTargetIds: Set<number>;
  createdTarget: CreatedTargetServer | null;
  disablingTargetId: number | null;
  deletingTargetId: number | null;
  editingTargetId: number | null;
  form: typeof defaultTargetForm;
  onChange: (value: typeof defaultTargetForm) => void;
  onCancelEdit: () => void;
  onDisable: (target: TargetServer) => void;
  onDelete: (target: TargetServer) => void;
  onEdit: (target: TargetServer) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTest: (target: TargetServer) => void;
  saving: boolean;
  targets: TargetServer[];
  testingTargetId: number | null;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-center gap-2">
        <Server aria-hidden="true" size={18} />
        <h2 className="text-base font-semibold text-zinc-950">Target servers</h2>
      </div>
      <div className="mb-4 overflow-hidden rounded border border-zinc-200 bg-white shadow-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Agent</th>
                <th className="px-3 py-2">Enabled</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {targets.map((target) => (
                <tr className={!target.enabled ? "bg-zinc-50" : undefined} key={target.id}>
                  <td className="px-3 py-2 font-medium text-zinc-950">{target.name}</td>
                  <td className="px-3 py-2 text-zinc-600">
                    {target.last_seen_at
                      ? `Seen ${formatDate(target.last_seen_at)}`
                      : "Not connected"}
                  </td>
                  <td className="px-3 py-2 text-zinc-600">{target.enabled ? "Yes" : "No"}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <button
                        className="focus-ring inline-flex h-8 items-center gap-1 rounded border border-zinc-300 bg-white px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:bg-zinc-100"
                        disabled={testingTargetId === target.id}
                        onClick={() => onTest(target)}
                        type="button"
                      >
                        <Wifi aria-hidden="true" size={14} />
                        {testingTargetId === target.id ? "Checking" : "Check"}
                      </button>
                      <button
                        className="focus-ring inline-flex h-8 items-center gap-1 rounded border border-zinc-300 bg-white px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                        onClick={() => onEdit(target)}
                        type="button"
                      >
                        <Pencil aria-hidden="true" size={14} />
                        {editingTargetId === target.id ? "Editing" : "Edit"}
                      </button>
                      <button
                        className="focus-ring inline-flex h-8 items-center gap-1 rounded border border-amber-200 bg-white px-2 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
                        disabled={
                          !target.enabled ||
                          activeTargetIds.has(target.id) ||
                          disablingTargetId === target.id
                        }
                        onClick={() => onDisable(target)}
                        title={
                          !target.enabled
                            ? "This target has already been disabled."
                            : activeTargetIds.has(target.id)
                            ? "Stop or finish active jobs before disabling this target."
                            : undefined
                        }
                        type="button"
                      >
                        <Ban aria-hidden="true" size={14} />
                        {!target.enabled
                          ? "Disabled"
                          : disablingTargetId === target.id
                            ? "Disabling"
                            : "Disable"}
                      </button>
                      <button
                        className="focus-ring inline-flex h-8 items-center gap-1 rounded border border-rose-200 bg-white px-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
                        disabled={activeTargetIds.has(target.id) || deletingTargetId === target.id}
                        onClick={() => onDelete(target)}
                        title={
                          activeTargetIds.has(target.id)
                            ? "Stop or finish active jobs before permanently deleting this target."
                            : undefined
                        }
                        type="button"
                      >
                        <Trash2 aria-hidden="true" size={14} />
                        {deletingTargetId === target.id ? "Deleting" : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {createdTarget ? (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="mb-2 font-semibold">Agent token for {createdTarget.name}</div>
          <pre className="overflow-x-auto rounded bg-white p-3 font-mono text-xs text-zinc-900">
            {createdTarget.agent_token}
          </pre>
          <pre className="mt-2 overflow-x-auto rounded bg-white p-3 font-mono text-xs text-zinc-900">
            {`DEPLOY_CONTROL_API_URL=${API_BASE_URL} \\
DEPLOY_AGENT_TOKEN=${createdTarget.agent_token} \\
DEPLOY_ALLOWED_SCRIPT_DIR=${createdTarget.allowed_script_dir} \\
DEPLOY_LOG_DIR=${createdTarget.log_dir} \\
DEPLOY_LOG_RETENTION_DAYS=30 \\
python3 /opt/deploy-control-agent/deploy_agent.py`}
          </pre>
        </div>
      ) : null}

      <form
        className="grid gap-3 rounded border border-zinc-200 bg-white p-4 shadow-panel"
        onSubmit={onSubmit}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-zinc-950">
            {editingTargetId === null ? "Add target" : "Edit target"}
          </div>
          {editingTargetId !== null ? (
            <button
              className="focus-ring inline-flex h-8 items-center gap-1 rounded border border-zinc-300 bg-white px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={onCancelEdit}
              type="button"
            >
              <X aria-hidden="true" size={14} />
              Cancel
            </button>
          ) : null}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Slug">
            <input
              className={inputClass}
              onChange={(event) => onChange({ ...form, slug: event.target.value })}
              placeholder="prod-api"
              required
              value={form.slug}
            />
          </Field>
          <Field label="Name">
            <input
              className={inputClass}
              onChange={(event) => onChange({ ...form, name: event.target.value })}
              placeholder="Production API server"
              required
              value={form.name}
            />
          </Field>
          <Field label="Allowed script dir">
            <input
              className={inputClass}
              onChange={(event) =>
                onChange({ ...form, allowed_script_dir: event.target.value })
              }
              placeholder="/opt/scripts"
              required
              value={form.allowed_script_dir}
            />
          </Field>
          <Field label="Log dir">
            <input
              className={inputClass}
              onChange={(event) => onChange({ ...form, log_dir: event.target.value })}
              placeholder="/home/deployer/logs/deploy"
              required
              value={form.log_dir}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700">
            <input
              checked={form.enabled}
              className="h-4 w-4 rounded border-zinc-300 text-emerald-700"
              onChange={(event) => onChange({ ...form, enabled: event.target.checked })}
              type="checkbox"
            />
            Enabled
          </label>
          <button
            className="focus-ring inline-flex h-9 items-center gap-2 rounded bg-zinc-900 px-3 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-400"
            disabled={saving}
            type="submit"
          >
            {editingTargetId === null ? (
              <Plus aria-hidden="true" size={16} />
            ) : (
              <Pencil aria-hidden="true" size={16} />
            )}
            {saving ? "Saving" : editingTargetId === null ? "Add target" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ScriptPanel({
  activeScriptIds,
  disablingScriptId,
  deletingScriptId,
  editingScriptId,
  form,
  onChange,
  onCancelEdit,
  onDisable,
  onDelete,
  onEdit,
  onSubmit,
  saving,
  scripts,
  targets
}: {
  activeScriptIds: Set<number>;
  disablingScriptId: number | null;
  deletingScriptId: number | null;
  editingScriptId: number | null;
  form: typeof defaultScriptForm;
  onChange: (value: typeof defaultScriptForm) => void;
  onCancelEdit: () => void;
  onDisable: (script: ScriptDefinition) => void;
  onDelete: (script: ScriptDefinition) => void;
  onEdit: (script: ScriptDefinition) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  scripts: ScriptDefinition[];
  targets: TargetServer[];
}) {
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-center gap-2">
        <FileCode aria-hidden="true" size={18} />
        <h2 className="text-base font-semibold text-zinc-950">Scripts</h2>
      </div>
      <div className="mb-4 overflow-hidden rounded border border-zinc-200 bg-white shadow-panel">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">Script</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">Enabled</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {scripts.map((script) => (
                <tr className={!script.enabled ? "bg-zinc-50" : undefined} key={script.id}>
                  <td className="px-3 py-2 font-medium text-zinc-950">{script.label}</td>
                  <td className="px-3 py-2 text-zinc-600">{script.target.name}</td>
                  <td className="px-3 py-2 text-zinc-600">{script.enabled ? "Yes" : "No"}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        className="focus-ring inline-flex h-8 items-center gap-1 rounded border border-zinc-300 bg-white px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                        onClick={() => onEdit(script)}
                        type="button"
                      >
                        <Pencil aria-hidden="true" size={14} />
                        {editingScriptId === script.id ? "Editing" : "Edit"}
                      </button>
                      <button
                        className="focus-ring inline-flex h-8 items-center gap-1 rounded border border-amber-200 bg-white px-2 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
                        disabled={
                          !script.enabled ||
                          activeScriptIds.has(script.id) ||
                          disablingScriptId === script.id
                        }
                        onClick={() => onDisable(script)}
                        title={
                          !script.enabled
                            ? "This script has already been disabled."
                            : activeScriptIds.has(script.id)
                            ? "Stop or finish active jobs before disabling this script."
                            : undefined
                        }
                        type="button"
                      >
                        <Ban aria-hidden="true" size={14} />
                        {!script.enabled
                          ? "Disabled"
                          : disablingScriptId === script.id
                            ? "Disabling"
                            : "Disable"}
                      </button>
                      <button
                        className="focus-ring inline-flex h-8 items-center gap-1 rounded border border-rose-200 bg-white px-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400"
                        disabled={activeScriptIds.has(script.id) || deletingScriptId === script.id}
                        onClick={() => onDelete(script)}
                        title={
                          activeScriptIds.has(script.id)
                            ? "Stop or finish active jobs before permanently deleting this script."
                            : undefined
                        }
                        type="button"
                      >
                        <Trash2 aria-hidden="true" size={14} />
                        {deletingScriptId === script.id ? "Deleting" : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <form
        className="grid gap-3 rounded border border-zinc-200 bg-white p-4 shadow-panel"
        onSubmit={onSubmit}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-zinc-950">
            {editingScriptId === null ? "Add script" : "Edit script"}
          </div>
          {editingScriptId !== null ? (
            <button
              className="focus-ring inline-flex h-8 items-center gap-1 rounded border border-zinc-300 bg-white px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={onCancelEdit}
              type="button"
            >
              <X aria-hidden="true" size={14} />
              Cancel
            </button>
          ) : null}
        </div>
        <Field label="Target">
          <select
            className={inputClass}
            onChange={(event) => {
              const target = targets.find((item) => item.id === Number(event.target.value));
              onChange({
                ...form,
                target_server_id: event.target.value,
                remote_script_path: target
                  ? `${target.allowed_script_dir.replace(/\/$/, "")}/deploy-app.sh`
                  : form.remote_script_path
              });
            }}
            required
            value={form.target_server_id}
          >
            <option value="">Choose target</option>
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Slug">
            <input
              className={inputClass}
              onChange={(event) => onChange({ ...form, slug: event.target.value })}
              placeholder="coin-identifier"
              required
              value={form.slug}
            />
          </Field>
          <Field label="Remote key">
            <input
              className={inputClass}
              onChange={(event) => onChange({ ...form, remote_key: event.target.value })}
              placeholder="coin-identifier"
              required
              value={form.remote_key}
            />
          </Field>
          <Field label="Label">
            <input
              className={inputClass}
              onChange={(event) => onChange({ ...form, label: event.target.value })}
              placeholder="Deploy Coin Identifier Backend"
              required
              value={form.label}
            />
          </Field>
          <Field label="Script path">
            <input
              className={inputClass}
              onChange={(event) =>
                onChange({ ...form, remote_script_path: event.target.value })
              }
              placeholder="/opt/scripts/deploy-coin-identifier.sh"
              required
              value={form.remote_script_path}
            />
          </Field>
        </div>
        <Field label="Description">
          <textarea
            className="focus-ring min-h-20 w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 placeholder:text-zinc-400"
            onChange={(event) => onChange({ ...form, description: event.target.value })}
            placeholder="Runs the backend deploy script on the selected target server."
            value={form.description}
          />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700">
            <input
              checked={form.enabled}
              className="h-4 w-4 rounded border-zinc-300 text-emerald-700"
              onChange={(event) => onChange({ ...form, enabled: event.target.checked })}
              type="checkbox"
            />
            Enabled
          </label>
          <button
            className="focus-ring inline-flex h-9 items-center gap-2 rounded bg-zinc-900 px-3 text-sm font-semibold text-white hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-400"
            disabled={saving}
            type="submit"
          >
            {editingScriptId === null ? (
              <Plus aria-hidden="true" size={16} />
            ) : (
              <Pencil aria-hidden="true" size={16} />
            )}
            {saving ? "Saving" : editingScriptId === null ? "Add script" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="grid gap-1">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
