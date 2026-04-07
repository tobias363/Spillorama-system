/**
 * theme1Session.ts — session resolution, storage, and URL helpers for Theme1.
 *
 * Extracted from useTheme1Store.ts to keep the Zustand store focused on
 * runtime state management. Every function here is pure or side-effect-scoped
 * to localStorage / window.location and does NOT depend on Zustand.
 */

import type { RealtimeSession } from "@/domain/realtime/contracts";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STORAGE_KEY = "candy-web.realtime-session";
export const PORTAL_AUTH_STORAGE_KEY = "bingo.portal.auth";
export const DEFAULT_CANDY_HALL_ID = "default-hall";
export const DEFAULT_CANDY_ROOM_CODE = "CANDY1";
export const THEME1_RECOVERABLE_SYNC_ERROR_CODES = new Set([
  "FORBIDDEN",
  "PLAYER_NOT_FOUND",
  "ROOM_NOT_FOUND",
  "ROOM_BLOCKED_NON_CANONICAL",
  "SINGLE_ROOM_ONLY",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Theme1AccessTokenSource =
  | "url"
  | "storage"
  | "portal-storage"
  | "launch-token"
  | "manual"
  | "none";

// ---------------------------------------------------------------------------
// URL / hostname helpers
// ---------------------------------------------------------------------------

export function resolveDefaultBackendUrl(): string {
  const envValue =
    typeof import.meta !== "undefined" &&
    typeof import.meta.env?.VITE_CANDY_API_BASE_URL === "string"
      ? import.meta.env.VITE_CANDY_API_BASE_URL.trim()
      : "";
  if (envValue) {
    return envValue;
  }

  if (typeof window === "undefined") {
    return "http://127.0.0.1:4000";
  }

  const host = window.location.hostname.trim().toLowerCase();
  if (host === "127.0.0.1" || host === "localhost") {
    return "http://127.0.0.1:4000";
  }

  return window.location.origin;
}

export function isLocalTheme1RuntimeHost(hostname: string): boolean {
  const normalizedHostname = hostname.trim().toLowerCase();
  return normalizedHostname === "127.0.0.1" || normalizedHostname === "localhost";
}

export function isLocalhostUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

export function isRunningLocally(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const host = window.location.hostname.trim().toLowerCase();
  return host === "127.0.0.1" || host === "localhost";
}

export function resolveHostnameFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Session normalisation & persistence
// ---------------------------------------------------------------------------

export function normalizeSession(session: RealtimeSession): RealtimeSession {
  return {
    baseUrl: session.baseUrl.trim() || resolveDefaultBackendUrl(),
    roomCode: session.roomCode.trim(),
    playerId: session.playerId.trim(),
    accessToken: session.accessToken.trim(),
    hallId: session.hallId.trim(),
  };
}

export function readStoredSession(): Partial<RealtimeSession> {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as Partial<RealtimeSession>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeSession(session: RealtimeSession): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

// ---------------------------------------------------------------------------
// Portal auth
// ---------------------------------------------------------------------------

export function readPortalAuthAccessToken(): string {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const raw = window.localStorage.getItem(PORTAL_AUTH_STORAGE_KEY);
    if (!raw) {
      return "";
    }

    const parsed = JSON.parse(raw) as { accessToken?: unknown };
    return typeof parsed?.accessToken === "string" ? parsed.accessToken.trim() : "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Room / auto-create helpers
// ---------------------------------------------------------------------------

export function canAutoCreateRoom(session: RealtimeSession): boolean {
  return session.accessToken.trim().length > 0 && session.hallId.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Redirect & portal helpers
// ---------------------------------------------------------------------------

export function shouldRedirectTheme1ToPortalOnLiveHost(input: {
  hostname: string;
  accessToken: string;
}): boolean {
  if (isLocalTheme1RuntimeHost(input.hostname)) {
    return false;
  }

  return input.accessToken.trim().length === 0;
}

export function canonicalizeTheme1LiveSession(
  session: RealtimeSession,
  hostname: string,
): RealtimeSession {
  const normalizedSession = normalizeSession(session);
  if (isLocalTheme1RuntimeHost(hostname)) {
    return normalizedSession;
  }

  return normalizeSession({
    ...normalizedSession,
    roomCode: DEFAULT_CANDY_ROOM_CODE,
    playerId: "",
    hallId: normalizedSession.hallId || DEFAULT_CANDY_HALL_ID,
  });
}

export function resolveTheme1PortalUrl(): string {
  if (typeof window === "undefined") {
    return "/";
  }

  return new URL("/", window.location.href).toString();
}

export function redirectTheme1ToPortal(): void {
  if (typeof window === "undefined") {
    return;
  }

  const targetUrl = resolveTheme1PortalUrl();
  console.error("[BIN-134] redirectTheme1ToPortal BLOCKED — would go to: " + targetUrl + " | trace:", new Error().stack);
  // BIN-134 DEBUG: ALL redirects disabled to diagnose iframe double-load
  // if (window.location.href !== targetUrl) {
  //   window.location.replace(targetUrl);
  // }
}

export function resolveTheme1LiveConnectionErrorMessage(message: string, hostname: string): string {
  if (isLocalTheme1RuntimeHost(hostname)) {
    return message;
  }

  const normalized = message.trim().toLowerCase();
  if (
    normalized.includes("accesstoken") ||
    normalized.includes("authorization") ||
    normalized.includes("unauthorized")
  ) {
    return "Logg inn i portalen for å åpne Candy.";
  }

  return message;
}

// ---------------------------------------------------------------------------
// Launch-token helpers
// ---------------------------------------------------------------------------

export function readLaunchTokenFromLocation(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const queryToken = new URLSearchParams(window.location.search).get("lt")?.trim();
  if (queryToken) {
    return queryToken;
  }

  const rawHash = window.location.hash.startsWith("#")
    ? window.location.hash.slice(1)
    : window.location.hash;
  return new URLSearchParams(rawHash).get("lt")?.trim() || "";
}

export function clearLaunchTokenFromLocation(): void {
  if (typeof window === "undefined") {
    return;
  }

  const url = new URL(window.location.href);
  url.searchParams.delete("lt");

  const rawHash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  const hashParams = new URLSearchParams(rawHash);
  hashParams.delete("lt");
  const nextHash = hashParams.toString();
  url.hash = nextHash ? `#${nextHash}` : "";

  window.history.replaceState({}, document.title, url.toString());
}

export function resolveLaunchBaseUrl(session: RealtimeSession): string {
  if (typeof window === "undefined") {
    return normalizeSession(session).baseUrl;
  }

  const queryBaseUrl = new URLSearchParams(window.location.search).get("backendUrl")?.trim();
  if (queryBaseUrl) {
    return queryBaseUrl;
  }

  const normalizedSession = normalizeSession(session);
  const hasLaunchToken = readLaunchTokenFromLocation().length > 0;
  if (hasLaunchToken && isLocalhostUrl(normalizedSession.baseUrl)) {
    return window.location.origin;
  }

  if (!isLocalhostUrl(normalizedSession.baseUrl) || isRunningLocally()) {
    return normalizedSession.baseUrl;
  }

  return resolveDefaultBackendUrl();
}

// ---------------------------------------------------------------------------
// Initial session seed
// ---------------------------------------------------------------------------

export function readInitialSessionSeed(): {
  session: RealtimeSession;
  accessTokenSource: Theme1AccessTokenSource;
} {
  if (typeof window === "undefined") {
    return {
      session: normalizeSession({
        baseUrl: resolveDefaultBackendUrl(),
        roomCode: "",
        playerId: "",
        accessToken: "",
        hallId: "",
      }),
      accessTokenSource: "none",
    };
  }

  const stored = readStoredSession();
  const seed = resolveTheme1InitialSessionSeed({
    storedSession: stored,
    search: window.location.search,
    hostname: window.location.hostname,
    portalAuthAccessToken: readPortalAuthAccessToken(),
  });

  if (seed.accessTokenSource === "url" || seed.accessTokenSource === "portal-storage") {
    writeSession(seed.session);
  }

  return {
    session: seed.session,
    accessTokenSource: seed.accessTokenSource,
  };
}

export function resolveTheme1InitialSessionSeed(input: {
  storedSession: Partial<RealtimeSession>;
  search: string;
  hostname: string;
  portalAuthAccessToken?: string;
}): {
  session: RealtimeSession;
  accessTokenSource: Theme1AccessTokenSource;
} {
  const params = new URLSearchParams(input.search);
  const urlAccessToken = params.get("accessToken")?.trim() || "";
  const storedAccessToken =
    typeof input.storedSession.accessToken === "string"
      ? input.storedSession.accessToken.trim()
      : "";
  const portalAccessToken = (input.portalAuthAccessToken || "").trim();
  const isLocalRuntimeHost = isLocalTheme1RuntimeHost(input.hostname);
  const fallbackHallId = isLocalRuntimeHost ? "" : DEFAULT_CANDY_HALL_ID;
  const resolvedAccessToken = isLocalRuntimeHost
    ? urlAccessToken || storedAccessToken || portalAccessToken
    : urlAccessToken || portalAccessToken;

  const session = canonicalizeTheme1LiveSession(
    isLocalRuntimeHost
      ? {
          baseUrl: params.get("backendUrl") || input.storedSession.baseUrl || resolveDefaultBackendUrl(),
          roomCode: params.get("roomCode") || input.storedSession.roomCode || "",
          playerId: params.get("playerId") || input.storedSession.playerId || "",
          accessToken: resolvedAccessToken,
          hallId:
            params.get("hallId") ||
            input.storedSession.hallId ||
            (resolvedAccessToken ? fallbackHallId : ""),
        }
      : {
          baseUrl: params.get("backendUrl") || input.storedSession.baseUrl || resolveDefaultBackendUrl(),
          roomCode: params.get("roomCode") || DEFAULT_CANDY_ROOM_CODE,
          playerId: params.get("playerId") || "",
          accessToken: resolvedAccessToken,
          hallId: params.get("hallId") || fallbackHallId,
        },
    input.hostname,
  );

  if (urlAccessToken) {
    return {
      session,
      accessTokenSource: "url",
    };
  }

  return {
    session,
    accessTokenSource: !isLocalRuntimeHost
      ? portalAccessToken
        ? "portal-storage"
        : "none"
      : storedAccessToken
        ? "storage"
        : portalAccessToken
          ? "portal-storage"
          : "none",
  };
}

// ---------------------------------------------------------------------------
// Auto-bootstrap & recovery
// ---------------------------------------------------------------------------

export function shouldAutoBootstrapDefaultLiveSession(
  _session: RealtimeSession,
  options: {
    hostname?: string;
    hasLaunchToken?: boolean;
  } = {},
): boolean {
  if (options.hasLaunchToken) return false;
  const hostname = options.hostname ?? (typeof window !== "undefined" ? window.location.hostname : "");
  return isLocalTheme1RuntimeHost(hostname);
}

export function shouldAttemptLiveRoomRecoveryFromSyncFailure(
  session: RealtimeSession,
  errorCode?: string,
): boolean {
  const normalizedSession = normalizeSession(session);
  if (!normalizedSession.roomCode && !normalizedSession.playerId) {
    return false;
  }

  if (!canAutoCreateRoom(normalizedSession)) {
    return false;
  }

  return Boolean(errorCode && THEME1_RECOVERABLE_SYNC_ERROR_CODES.has(errorCode));
}
