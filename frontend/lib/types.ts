export type Status = "queued" | "running" | "success" | "failed" | "unknown" | "stopped";

export interface ScriptDefinition {
  id: number;
  slug: string;
  label: string;
  remote_key: string;
  description: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface DeploymentJob {
  id: string;
  script: ScriptDefinition;
  remote_job_id: string;
  remote_log_file: string;
  remote_pid_file: string;
  remote_status_file: string;
  status: Status;
  exit_code: number | null;
  started_by: string;
  started_at: string;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TokenPair {
  access: string;
  refresh: string;
}

