"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileCode, LogOut, Play, Plus, RefreshCw, Server, Wifi } from "lucide-react";
import { JobTable } from "@/components/JobTable";
import { StatusBadge } from "@/components/StatusBadge";
import {
  ApiError,
  API_BASE_URL,
  createScript,
  createTarget,
  getCurrentUser,
  listJobs,
  listScripts,
  listTargets,
  startJob,
  testTargetConnection
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

export default function DashboardPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [targets, setTargets] = useState<TargetServer[]>([]);
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [jobs, setJobs] = useState<DeploymentJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [startingSlug, setStartingSlug] = useState<string | null>(null);
  const [savingTarget, setSavingTarget] = useState(false);
  const [savingScript, setSavingScript] = useState(false);
  const [testingTargetId, setTestingTargetId] = useState<number | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [createdTarget, setCreatedTarget] = useState<CreatedTargetServer | null>(null);
  const [targetForm, setTargetForm] = useState(defaultTargetForm);
  const [scriptForm, setScriptForm] = useState(defaultScriptForm);
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

  const availableScripts = useMemo(
    () => scripts.filter((script) => script.enabled && script.target.enabled),
    [scripts]
  );

  const loadData = useCallback(async () => {
    setError(null);
    try {
      const profileData = await getCurrentUser();
      const [scriptData, jobData, targetData] = await Promise.all([
        listScripts(profileData.is_staff),
        listJobs(),
        profileData.is_staff ? listTargets() : Promise.resolve([])
      ]);
      setProfile(profileData);
      setScripts(scriptData);
      setJobs(jobData);
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

  async function handleCreateTarget(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingTarget(true);
    setError(null);
    setTestResult(null);
    setCreatedTarget(null);
    try {
      const target = await createTarget(targetForm);
      setCreatedTarget(target);
      setTargetForm(defaultTargetForm);
      await loadData();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not create target server.");
    } finally {
      setSavingTarget(false);
    }
  }

  async function handleCreateScript(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!scriptForm.target_server_id) {
      setError("Choose a target server for this script.");
      return;
    }

    setSavingScript(true);
    setError(null);
    try {
      await createScript({
        ...scriptForm,
        target_server_id: Number(scriptForm.target_server_id)
      });
      setScriptForm({
        ...defaultScriptForm,
        target_server_id: scriptForm.target_server_id
      });
      await loadData();
    } catch (exc) {
      setError(exc instanceof Error ? exc.message : "Could not create script.");
    } finally {
      setSavingScript(false);
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
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-950">Deploy Control Panel</h1>
            <p className="text-sm text-zinc-600">Private deploy jobs for target servers.</p>
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
          <div className="grid gap-4 md:grid-cols-2">
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
          <section className="mb-8 grid gap-6 lg:grid-cols-2">
            <TargetServerPanel
              form={targetForm}
              onChange={setTargetForm}
              onSubmit={handleCreateTarget}
              onTest={handleTestTarget}
              createdTarget={createdTarget}
              saving={savingTarget}
              targets={targets}
              testingTargetId={testingTargetId}
            />
            <ScriptPanel
              form={scriptForm}
              onChange={setScriptForm}
              onSubmit={handleCreateScript}
              saving={savingScript}
              scripts={scripts}
              targets={targets}
            />
          </section>
        ) : null}

        <section>
          <h2 className="mb-3 text-base font-semibold text-zinc-950">Recent jobs</h2>
          <JobTable jobs={jobs} />
        </section>
      </div>
    </main>
  );
}

function TargetServerPanel({
  createdTarget,
  form,
  onChange,
  onSubmit,
  onTest,
  saving,
  targets,
  testingTargetId
}: {
  createdTarget: CreatedTargetServer | null;
  form: typeof defaultTargetForm;
  onChange: (value: typeof defaultTargetForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTest: (target: TargetServer) => void;
  saving: boolean;
  targets: TargetServer[];
  testingTargetId: number | null;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Server aria-hidden="true" size={18} />
        <h2 className="text-base font-semibold text-zinc-950">Target servers</h2>
      </div>
      <div className="mb-4 overflow-hidden rounded border border-zinc-200 bg-white shadow-panel">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Agent</th>
              <th className="px-3 py-2 text-right">Check</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {targets.map((target) => (
              <tr key={target.id}>
                <td className="px-3 py-2 font-medium text-zinc-950">{target.name}</td>
                <td className="px-3 py-2 text-zinc-600">
                  {target.last_seen_at
                    ? `Seen ${formatDate(target.last_seen_at)}`
                    : "Not connected"}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    className="focus-ring inline-flex h-8 items-center gap-1 rounded border border-zinc-300 bg-white px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:bg-zinc-100"
                    disabled={testingTargetId === target.id}
                    onClick={() => onTest(target)}
                    type="button"
                  >
                    <Wifi aria-hidden="true" size={14} />
                    {testingTargetId === target.id ? "Checking" : "Check"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
python3 /opt/deploy-control-agent/deploy_agent.py`}
          </pre>
        </div>
      ) : null}

      <form
        className="grid gap-3 rounded border border-zinc-200 bg-white p-4 shadow-panel"
        onSubmit={onSubmit}
      >
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
            <Plus aria-hidden="true" size={16} />
            {saving ? "Saving" : "Add target"}
          </button>
        </div>
      </form>
    </div>
  );
}

function ScriptPanel({
  form,
  onChange,
  onSubmit,
  saving,
  scripts,
  targets
}: {
  form: typeof defaultScriptForm;
  onChange: (value: typeof defaultScriptForm) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  saving: boolean;
  scripts: ScriptDefinition[];
  targets: TargetServer[];
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <FileCode aria-hidden="true" size={18} />
        <h2 className="text-base font-semibold text-zinc-950">Scripts</h2>
      </div>
      <div className="mb-4 overflow-hidden rounded border border-zinc-200 bg-white shadow-panel">
        <table className="min-w-full divide-y divide-zinc-200 text-sm">
          <thead className="bg-zinc-50 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
            <tr>
              <th className="px-3 py-2">Script</th>
              <th className="px-3 py-2">Target</th>
              <th className="px-3 py-2">Enabled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {scripts.map((script) => (
              <tr key={script.id}>
                <td className="px-3 py-2 font-medium text-zinc-950">{script.label}</td>
                <td className="px-3 py-2 text-zinc-600">{script.target.name}</td>
                <td className="px-3 py-2 text-zinc-600">{script.enabled ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form
        className="grid gap-3 rounded border border-zinc-200 bg-white p-4 shadow-panel"
        onSubmit={onSubmit}
      >
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
            <Plus aria-hidden="true" size={16} />
            {saving ? "Saving" : "Add script"}
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
