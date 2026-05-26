import { clearTokens, getAccessToken, getRefreshToken, storeAccessToken } from "./auth";
import type { DeploymentJob, ScriptDefinition, TokenPair } from "./types";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") || "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, payload: unknown) {
    super(extractErrorMessage(payload) || `API request failed with status ${status}`);
    this.status = status;
    this.payload = payload;
  }
}

export async function login(username: string, password: string): Promise<TokenPair> {
  return apiFetch<TokenPair>("/api/auth/token/", {
    method: "POST",
    body: JSON.stringify({ username, password }),
    skipAuth: true
  });
}

export async function listScripts(): Promise<ScriptDefinition[]> {
  return apiFetch<ScriptDefinition[]>("/api/scripts/");
}

export async function listJobs(): Promise<DeploymentJob[]> {
  return apiFetch<DeploymentJob[]>("/api/jobs/");
}

export async function getJob(id: string): Promise<DeploymentJob> {
  return apiFetch<DeploymentJob>(`/api/jobs/${id}/`);
}

export async function startJob(scriptSlug: string): Promise<DeploymentJob> {
  return apiFetch<DeploymentJob>("/api/jobs/start/", {
    method: "POST",
    body: JSON.stringify({ script_slug: scriptSlug })
  });
}

export async function refreshJobStatus(id: string): Promise<DeploymentJob> {
  return apiFetch<DeploymentJob>(`/api/jobs/${id}/refresh-status/`, {
    method: "POST"
  });
}

export async function stopJob(id: string): Promise<DeploymentJob> {
  return apiFetch<DeploymentJob>(`/api/jobs/${id}/stop/`, {
    method: "POST"
  });
}

interface ApiOptions extends RequestInit {
  skipAuth?: boolean;
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const response = await rawApiFetch(path, options);
  if (response.status !== 401 || options.skipAuth) {
    return decodeResponse<T>(response);
  }

  const refreshed = await refreshAccessToken();
  if (!refreshed) {
    clearTokens();
    throw new ApiError(401, { detail: "Authentication expired." });
  }
  return decodeResponse<T>(await rawApiFetch(path, options));
}

export async function refreshAccessToken(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) {
    return null;
  }

  const response = await fetch(`${API_BASE_URL}/api/auth/token/refresh/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ refresh })
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as { access: string };
  storeAccessToken(payload.access);
  return payload.access;
}

async function rawApiFetch(path: string, options: ApiOptions): Promise<Response> {
  const headers = new Headers(options.headers);
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }

  if (!options.skipAuth) {
    const accessToken = getAccessToken();
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }
  }

  return fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers
  });
}

async function decodeResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new ApiError(response.status, payload);
  }
  return payload as T;
}

function extractErrorMessage(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const detail = (payload as { detail: unknown }).detail;
    return typeof detail === "string" ? detail : null;
  }
  return null;
}

