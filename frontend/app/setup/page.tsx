"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Copy,
  Download,
  FileCode,
  LogOut,
  RefreshCw,
  Server,
  Terminal
} from "lucide-react";
import { API_BASE_URL, ApiError, getAgentSetupGuide, getCurrentUser } from "@/lib/api";
import { clearTokens, getAccessToken } from "@/lib/auth";
import type { AgentSetupGuide, TargetServer, UserProfile } from "@/lib/types";

const TOKEN_PLACEHOLDER = "PASTE_AGENT_TOKEN_HERE";
const TARGET_HOST_PLACEHOLDER = "TARGET_SERVER_IP";

export default function SetupPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [guide, setGuide] = useState<AgentSetupGuide | null>(null);
  const [targetId, setTargetId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const selectedTarget = useMemo(
    () => guide?.targets.find((target) => String(target.id) === targetId) || null,
    [guide, targetId]
  );

  const setup = useMemo(() => {
    if (!guide) {
      return null;
    }
    return buildSetupContent(guide, selectedTarget);
  }, [guide, selectedTarget]);

  const loadSetup = useCallback(async () => {
    setError(null);
    try {
      const [profileData, guideData] = await Promise.all([
        getCurrentUser(),
        getAgentSetupGuide()
      ]);
      setProfile(profileData);
      setGuide(guideData);
      setTargetId((current) => {
        if (current && guideData.targets.some((target) => String(target.id) === current)) {
          return current;
        }
        const defaultTarget = guideData.targets.find((target) => target.enabled) || guideData.targets[0];
        return defaultTarget ? String(defaultTarget.id) : "";
      });
    } catch (exc) {
      if (exc instanceof ApiError && exc.status === 401) {
        clearTokens();
        router.replace("/login");
        return;
      }
      setError(exc instanceof Error ? exc.message : "Could not load setup guide.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }
    void loadSetup();
  }, [loadSetup, router]);

  async function copyValue(key: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
  }

  function downloadAgent() {
    if (!guide) {
      return;
    }
    const blob = new Blob([guide.agent_source], { type: "text/x-python;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = guide.agent_filename;
    anchor.click();
    window.URL.revokeObjectURL(url);
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
            <Link
              className="focus-ring mb-2 inline-flex items-center gap-1 rounded px-1 py-1 text-sm font-medium text-zinc-600 hover:text-zinc-950"
              href="/dashboard"
            >
              <ArrowLeft aria-hidden="true" size={16} /> Dashboard
            </Link>
            <h1 className="text-xl font-semibold text-zinc-950">Agent setup</h1>
            <p className="text-sm text-zinc-600">
              Install and configure the target server agent.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="focus-ring inline-flex h-9 items-center gap-2 rounded border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              onClick={() => void loadSetup()}
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

        {loading ? (
          <div className="rounded border border-zinc-200 bg-white px-4 py-8 text-center text-sm text-zinc-600">
            Loading setup guide...
          </div>
        ) : null}

        {!loading && guide && setup ? (
          <div className="grid gap-6">
            <section className="rounded border border-zinc-200 bg-white p-4 shadow-panel">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Server aria-hidden="true" size={18} />
                    <h2 className="text-base font-semibold text-zinc-950">
                      Target configuration
                    </h2>
                  </div>
                  <p className="text-sm text-zinc-600">
                    Choose a target to generate commands with its script and log paths.
                  </p>
                </div>
                <div className="w-full md:w-80">
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    Target server
                  </label>
                  <select
                    className="focus-ring h-9 w-full rounded border border-zinc-300 bg-white px-3 text-sm text-zinc-950"
                    disabled={!guide.targets.length}
                    onChange={(event) => setTargetId(event.target.value)}
                    value={targetId}
                  >
                    {guide.targets.length ? (
                      guide.targets.map((target) => (
                        <option key={target.id} value={target.id}>
                          {target.name}
                          {target.enabled ? "" : " (disabled)"}
                        </option>
                      ))
                    ) : (
                      <option value="">Create a target first</option>
                    )}
                  </select>
                </div>
              </div>
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <SummaryItem label="Agent path" value={guide.agent_path} />
                <SummaryItem label="Script dir" value={setup.allowedScriptDir} />
                <SummaryItem label="Log retention" value={`${guide.log_retention_days} days`} />
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <GuideStep
                icon={<Terminal aria-hidden="true" size={18} />}
                step="1"
                title="Prepare directories"
              >
                <CodeBlock
                  copied={copiedKey === "prepare"}
                  label="Run on target VPS"
                  onCopy={() => void copyValue("prepare", setup.prepareCommand)}
                  value={setup.prepareCommand}
                />
              </GuideStep>

              <GuideStep
                icon={<FileCode aria-hidden="true" size={18} />}
                step="2"
                title="Copy agent file"
              >
                <div className="mb-3 flex flex-wrap gap-2">
                  <button
                    className="focus-ring inline-flex h-9 items-center gap-2 rounded border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                    onClick={() => void copyValue("agent-source", guide.agent_source)}
                    type="button"
                  >
                    <Copy aria-hidden="true" size={16} />
                    {copiedKey === "agent-source" ? "Copied" : "Copy file"}
                  </button>
                  <button
                    className="focus-ring inline-flex h-9 items-center gap-2 rounded bg-zinc-950 px-3 text-sm font-semibold text-white hover:bg-zinc-800"
                    onClick={downloadAgent}
                    type="button"
                  >
                    <Download aria-hidden="true" size={16} /> Download
                  </button>
                </div>
                <CodeBlock
                  copied={copiedKey === "copy-agent"}
                  label="Copy to target VPS"
                  onCopy={() => void copyValue("copy-agent", setup.copyAgentCommand)}
                  value={setup.copyAgentCommand}
                />
              </GuideStep>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <GuideStep
                icon={<Terminal aria-hidden="true" size={18} />}
                step="3"
                title="Run once for testing"
              >
                <p className="mb-3 text-sm text-zinc-600">
                  Use the agent token shown when the target was created.
                </p>
                <CodeBlock
                  copied={copiedKey === "run-agent"}
                  label="Run as deployer"
                  onCopy={() => void copyValue("run-agent", setup.runCommand)}
                  value={setup.runCommand}
                />
              </GuideStep>

              <GuideStep
                icon={<Terminal aria-hidden="true" size={18} />}
                step="4"
                title="Install systemd service"
              >
                <CodeBlock
                  copied={copiedKey === "systemd"}
                  label="/etc/systemd/system/deploy-control-agent.service"
                  maxHeightClass="max-h-[32rem]"
                  onCopy={() => void copyValue("systemd", setup.systemdUnit)}
                  value={setup.systemdUnit}
                />
                <CodeBlock
                  copied={copiedKey === "systemd-commands"}
                  label="Enable service"
                  onCopy={() => void copyValue("systemd-commands", setup.systemdCommands)}
                  value={setup.systemdCommands}
                />
              </GuideStep>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <GuideStep
                icon={<FileCode aria-hidden="true" size={18} />}
                step="5"
                title="Create deploy script"
              >
                <CodeBlock
                  copied={copiedKey === "script-template"}
                  label={`${setup.deployScriptPath}`}
                  maxHeightClass="max-h-[28rem]"
                  onCopy={() => void copyValue("script-template", setup.deployScriptTemplate)}
                  value={setup.deployScriptTemplate}
                />
              </GuideStep>

              <GuideStep
                icon={<Server aria-hidden="true" size={18} />}
                step="6"
                title="Create script record"
              >
                <p className="mb-3 text-sm text-zinc-600">
                  Add a script in the dashboard with these values, then press Check on the target.
                </p>
                <CodeBlock
                  copied={copiedKey === "script-record"}
                  label="Dashboard script fields"
                  onCopy={() => void copyValue("script-record", setup.scriptRecord)}
                  value={setup.scriptRecord}
                />
              </GuideStep>
            </section>

            <section className="rounded border border-zinc-200 bg-white p-4 shadow-panel">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-zinc-950">
                    {guide.agent_filename}
                  </h2>
                  <p className="text-sm text-zinc-600">
                    Full source of the file that must be copied to the target VPS.
                  </p>
                </div>
                <button
                  className="focus-ring inline-flex h-9 items-center gap-2 rounded border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  onClick={() => void copyValue("agent-full", guide.agent_source)}
                  type="button"
                >
                  <Copy aria-hidden="true" size={16} />
                  {copiedKey === "agent-full" ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="max-h-[34rem] overflow-auto rounded border border-zinc-200 bg-zinc-950 p-4 text-xs leading-5 text-zinc-100">
                {guide.agent_source}
              </pre>
            </section>
          </div>
        ) : null}

        {!loading && profile && !profile.is_staff ? (
          <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Admin permission is required to view setup instructions.
          </div>
        ) : null}
      </div>
    </main>
  );
}

function GuideStep({
  children,
  icon,
  step,
  title
}: {
  children: ReactNode;
  icon: ReactNode;
  step: string;
  title: string;
}) {
  return (
    <section className="rounded border border-zinc-200 bg-white p-4 shadow-panel">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded bg-zinc-950 text-xs font-semibold text-white">
          {step}
        </span>
        {icon}
        <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function CodeBlock({
  copied,
  label,
  maxHeightClass = "max-h-80",
  onCopy,
  value
}: {
  copied: boolean;
  label: string;
  maxHeightClass?: string;
  onCopy: () => void;
  value: string;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="truncate text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {label}
        </div>
        <button
          className="focus-ring inline-flex h-8 shrink-0 items-center gap-1 rounded border border-zinc-300 bg-white px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          onClick={onCopy}
          type="button"
        >
          <Copy aria-hidden="true" size={14} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className={`${maxHeightClass} overflow-auto rounded border border-zinc-200 bg-zinc-950 p-3 text-xs leading-5 text-zinc-100`}
      >
        {value}
      </pre>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 px-3 py-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </div>
      <div className="mt-1 break-words text-sm font-medium text-zinc-950">{value}</div>
    </div>
  );
}

function buildSetupContent(guide: AgentSetupGuide, target: TargetServer | null) {
  const allowedScriptDir = target?.allowed_script_dir || "/opt/scripts";
  const logDir = target?.log_dir || "/home/deployer/logs/deploy";
  const deployScriptPath = `${allowedScriptDir.replace(/\/$/, "")}/deploy-app.sh`;

  const prepareCommand = [
    "sudo useradd -m -s /bin/bash deployer || true",
    `sudo mkdir -p ${shellQuote(guide.agent_install_dir)} ${shellQuote(allowedScriptDir)} ${shellQuote(logDir)}`,
    `sudo chown -R deployer:deployer ${shellQuote(guide.agent_install_dir)} ${shellQuote(allowedScriptDir)} ${shellQuote(logDir)}`
  ].join("\n");

  const copyAgentCommand = [
    `scp ${guide.agent_filename} deployer@${TARGET_HOST_PLACEHOLDER}:${shellQuote(guide.agent_path)}`,
    `ssh deployer@${TARGET_HOST_PLACEHOLDER} 'chmod 750 ${guide.agent_path}'`
  ].join("\n");

  const runCommand = [
    `DEPLOY_CONTROL_API_URL=${shellQuote(API_BASE_URL)} \\`,
    `DEPLOY_AGENT_TOKEN=${TOKEN_PLACEHOLDER} \\`,
    `DEPLOY_ALLOWED_SCRIPT_DIR=${shellQuote(allowedScriptDir)} \\`,
    `DEPLOY_LOG_DIR=${shellQuote(logDir)} \\`,
    `DEPLOY_LOG_RETENTION_DAYS=${guide.log_retention_days} \\`,
    `python3 ${shellQuote(guide.agent_path)}`
  ].join("\n");

  const systemdUnit = [
    "[Unit]",
    "Description=Deploy Control Agent",
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "User=deployer",
    "Group=deployer",
    systemdEnvironment("DEPLOY_CONTROL_API_URL", API_BASE_URL),
    systemdEnvironment("DEPLOY_AGENT_TOKEN", TOKEN_PLACEHOLDER),
    systemdEnvironment("DEPLOY_ALLOWED_SCRIPT_DIR", allowedScriptDir),
    systemdEnvironment("DEPLOY_LOG_DIR", logDir),
    systemdEnvironment("DEPLOY_LOG_RETENTION_DAYS", String(guide.log_retention_days)),
    systemdEnvironment("DEPLOY_LOG_CLEANUP_SECONDS", String(guide.log_cleanup_seconds)),
    `ExecStart=/usr/bin/python3 ${guide.agent_path}`,
    "Restart=always",
    "RestartSec=5",
    "",
    "[Install]",
    "WantedBy=multi-user.target"
  ].join("\n");

  const systemdCommands = [
    "sudo systemctl daemon-reload",
    "sudo systemctl enable --now deploy-control-agent",
    "sudo systemctl status deploy-control-agent"
  ].join("\n");

  const deployScriptTemplate = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "",
    "cd /path/to/app",
    "git pull --ff-only",
    "",
    "# Add the deploy steps for this app.",
    "# npm ci",
    "# npm run build",
    "# pm2 restart app-name"
  ].join("\n");

  const scriptRecord = [
    `Target: ${target?.name || "Choose the target server"}`,
    "Slug: deploy-app",
    "Remote key: deploy-app",
    "Label: Deploy app",
    `Script path: ${deployScriptPath}`,
    "Enabled: Yes"
  ].join("\n");

  return {
    allowedScriptDir,
    copyAgentCommand,
    deployScriptPath,
    deployScriptTemplate,
    logDir,
    prepareCommand,
    runCommand,
    scriptRecord,
    systemdCommands,
    systemdUnit
  };
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

function systemdEnvironment(name: string, value: string): string {
  return `Environment="${name}=${value.replace(/(["\\])/g, "\\$1")}"`;
}
