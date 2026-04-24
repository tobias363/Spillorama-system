const ADMIN_TOKEN_KEY = "bingo_admin_access_token";

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  auth?: boolean;
}

export class ApiError extends Error {
  code: string;
  status: number;
  /**
   * Task 1.5: strukturert detalj-nyttelast som backend kan legge på
   * DomainError — propagerer via `toPublicError(err).details`. Brukes bl.a.
   * av `HALLS_NOT_READY` til å sende `{ unreadyHalls: string[] }` slik at
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

  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    credentials: "same-origin",
  });

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
