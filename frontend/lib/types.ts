export type Status = "queued" | "running" | "success" | "failed" | "unknown" | "stopped";

export interface UserProfile {
  username: string;
  is_staff: boolean;
}

export interface TargetServerSummary {
  id: number;
  slug: string;
  name: string;
  agent_token_prefix: string;
  last_seen_at: string | null;
  enabled: boolean;
}

export interface TargetServer extends TargetServerSummary {
  allowed_script_dir: string;
  log_dir: string;
  agent_version: string;
  created_at: string;
  updated_at: string;
}

export interface CreatedTargetServer extends TargetServer {
  agent_token: string;
}

export interface AgentSetupGuide {
  agent_filename: string;
  agent_source: string;
  agent_install_dir: string;
  agent_path: string;
  log_retention_days: number;
  log_cleanup_seconds: number;
  targets: TargetServer[];
}

export interface ScriptDefinition {
  id: number;
  target: TargetServerSummary;
  slug: string;
  label: string;
  remote_key: string;
  remote_script_path: string;
  description: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface DeploymentJob {
  id: string;
  script: ScriptDefinition;
  target: TargetServerSummary;
  agent_run_id: string;
  status: Status;
  exit_code: number | null;
  stop_requested: boolean;
  started_by: string;
  started_at: string;
  claimed_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TokenPair {
  access: string;
  refresh: string;
}

export interface TargetServerPayload {
  slug: string;
  name: string;
  allowed_script_dir: string;
  log_dir: string;
  enabled: boolean;
}

export interface ScriptDefinitionPayload {
  target_server_id: number;
  slug: string;
  label: string;
  remote_key: string;
  remote_script_path: string;
  description: string;
  enabled: boolean;
}
