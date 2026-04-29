const ADMIN_TOKEN_KEY = "bingo_admin_access_token";

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  auth?: boolean;
  /**
   * FE-P0-003 (Bølge 2B pilot-blocker): optional AbortSignal so callers can
   * cancel an in-flight request when the user navigates away, switches hall,
   * or triggers a fresh fetch on a flaky hall-WiFi connection. Without
   * cancellation, a slow stale fetch can land 5-10s after a quick refresh
   * and overwrite money-data UI with pre-action state.
   *
   * When the signal aborts mid-fetch, fetch() rejects with a DOMException
   * whose `name === "AbortError"`. apiRequest() lets that exception bubble
   * to callers — they should branch on `isAbortError(err)` and skip
   * post-fetch handling (e.g. don't render an error toast).
   */
  signal?: AbortSignal;
}

export class ApiError extends Error {
  code: string;
  status: number;
  /**
   * Task 1.5: strukturert detalj-nyttelast som backend kan legge på
   * DomainError — propagerer via `toPublicError(err).details`. Brukes bl.a.
   * av `HALLS_NOT_READY` til å sende `{ unreadyHalls: string[] }` og av
   * `JACKPOT_CONFIRM_REQUIRED` for å sende current pot-amount, slik at
   * frontend kan rendre popup uten ekstra round-trip.
   */
  details?: Record<string, unknown>;
  constructor(
    message: string,
    code: string,
    status: number,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.code = code;
    this.status = status;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

/**
 * FE-P0-003: helper for callers to detect AbortError so they can skip
 * post-fetch handling (toast, error UI, state update) when a request is
 * cancelled intentionally — e.g. on unmount or hall-context-change.
 *
 * Standard pattern in callers:
 *   try { await apiRequest(...); ... }
 *   catch (err) { if (isAbortError(err)) return; ... }
 */
export function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === "AbortError") return true;
  if (err instanceof Error && err.name === "AbortError") return true;
  return false;
}

export function getToken(): string {
  return window.localStorage.getItem(ADMIN_TOKEN_KEY) ?? "";
}

export function setToken(token: string): void {
  if (!token) {
    window.localStorage.removeItem(ADMIN_TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearToken(): void {
  window.localStorage.removeItem(ADMIN_TOKEN_KEY);
}

export async function apiRequest<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers ?? {}),
  };
  if (options.auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  // FE-P0-003: thread the optional AbortSignal through to fetch(). If the
  // signal is already aborted we let fetch() reject immediately with the
  // standard AbortError — no special-casing needed.
  const fetchInit: RequestInit = {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
  };
  if (options.signal) fetchInit.signal = options.signal;

  const response = await fetch(path, fetchInit);

  const payload = (await response.json().catch(() => null)) as
    | {
        ok: boolean;
        data?: T;
        error?: {
          code: string;
          message: string;
          details?: Record<string, unknown>;
        };
      }
    | null;

  if (!response.ok || !payload || payload.ok === false) {
    const message = payload?.error?.message ?? `HTTP ${response.status}`;
    const code = payload?.error?.code ?? "REQUEST_FAILED";
    const details = payload?.error?.details;
    if (response.status === 401) {
      clearToken();
      window.dispatchEvent(new CustomEvent("auth:unauthorized"));
    }
    throw new ApiError(message, code, response.status, details);
  }

  return (payload.data ?? null) as T;
}
