import type { TokenPair } from "./types";

const ACCESS_TOKEN_KEY = "deploy_panel_access_token";
const REFRESH_TOKEN_KEY = "deploy_panel_refresh_token";

export function getAccessToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function storeTokens(tokens: TokenPair): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, tokens.access);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refresh);
}

export function storeAccessToken(access: string): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, access);
}

export function clearTokens(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

