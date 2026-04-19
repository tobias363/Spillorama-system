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
  constructor(message: string, code: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
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
    | { ok: boolean; data?: T; error?: { code: string; message: string } }
    | null;

  if (!response.ok || !payload || payload.ok === false) {
    const message = payload?.error?.message ?? `HTTP ${response.status}`;
    const code = payload?.error?.code ?? "REQUEST_FAILED";
    if (response.status === 401) {
      clearToken();
      window.dispatchEvent(new CustomEvent("auth:unauthorized"));
    }
    throw new ApiError(message, code, response.status);
  }

  return (payload.data ?? null) as T;
}
