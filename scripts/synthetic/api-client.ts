/**
 * Synthetic bingo-round-test — typed HTTP API-client for Spillorama.
 *
 * Thin wrapper around `fetch` that:
 *   1. Adds `Authorization: Bearer <token>` to authenticated requests.
 *   2. Unwraps the `{ ok, data, error }` response envelope.
 *   3. Throws structured `ApiError`-instances with the backend's stable
 *      error-code (`UNAUTHORIZED`, `PURCHASE_CLOSED_FOR_GAME`, etc.) so
 *      the bot can branch on them.
 *
 * Why a separate module? The bot itself ties together login, master-actions,
 * purchases, and snapshot-fetching. Keeping the HTTP transport here keeps
 * the bot readable and makes the API-client testable in isolation with
 * mocked `fetch`.
 *
 * NOTE: this module imports `@spillorama/shared-types` for response schemas
 * only — we rely on the contract-shape but do not require build-output of
 * the shared-types package (we use `type`-only imports). The unit tests
 * exercise the API-client with mocked fetch so the shared-types package
 * does not need to be built for vitest to pass.
 */

/**
 * Stable error returned by Spillorama API on `{ ok: false }` envelopes.
 * Matches `apiFailure` in `apps/backend/src/util/httpHelpers.ts`.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly url: string;
  readonly responseBody: unknown;

  constructor(opts: {
    message: string;
    code: string;
    status: number;
    url: string;
    responseBody: unknown;
  }) {
    super(opts.message);
    this.name = "ApiError";
    this.code = opts.code;
    this.status = opts.status;
    this.url = opts.url;
    this.responseBody = opts.responseBody;
  }
}

/**
 * Minimal `fetch`-compatible interface so we can swap in a mock for tests.
 *
 * We avoid the global `RequestInit` type because it requires DOM/Node
 * lib bindings; only the fields the bot uses are listed.
 */
export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  }
) => Promise<{
  status: number;
  ok: boolean;
  text(): Promise<string>;
  json(): Promise<unknown>;
  headers: { get(name: string): string | null };
}>;

export interface ApiClientOptions {
  baseUrl: string;
  fetchImpl?: FetchLike;
  /** Default request-timeout in ms. */
  timeoutMs?: number;
}

export interface AuthorizedSession {
  accessToken: string;
  userId: string;
  email: string;
  role: string;
  walletId: string;
}

/**
 * Single login response — `{ accessToken, user: { id, ... } }`. Backend
 * actually wraps it in `{ ok, data }` and we unwrap before returning.
 */
interface LoginResponseData {
  accessToken: string;
  user: {
    id: string;
    email: string;
    role: string;
    walletId: string;
  };
}

interface WalletMeData {
  account: {
    id: string;
    balance: number;
  };
}

interface MasterActionResponseData {
  scheduledGameId: string | null;
  planRunId: string;
  status: string;
  scheduledGameStatus: string | null;
  inconsistencyWarnings: string[];
}

interface PurchaseResponseData {
  purchaseId: string;
  totalAmountCents: number;
  alreadyExisted: boolean;
}

export interface TicketSpecEntry {
  color: string;
  size: "small" | "large";
  count: number;
  priceCentsEach: number;
}

export interface PurchaseTicketInput {
  scheduledGameId: string;
  buyerUserId: string;
  hallId: string;
  ticketSpec: TicketSpecEntry[];
  paymentMethod: "digital_wallet" | "cash_agent" | "card_agent";
  idempotencyKey: string;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    // Allow the caller to inject a mock fetch for testing. The cast is safe
    // because `globalThis.fetch` matches FetchLike at runtime for the subset
    // of fields we use; we deliberately do not import `RequestInit` to
    // avoid DOM-lib coupling.
    this.fetchImpl =
      opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /**
   * Perform a `POST /api/auth/login`. Returns a session with `accessToken`
   * + `userId` + `walletId` (used by subsequent ticket-purchases).
   *
   * Throws `ApiError` with a stable code:
   *   - `UNAUTHORIZED` — wrong password
   *   - `USER_NOT_FOUND` — wrong email
   *   - `REQUIRES_2FA` — account has 2FA enabled (test setup must disable)
   */
  async login(email: string, password: string): Promise<AuthorizedSession> {
    const data = await this.post<LoginResponseData>("/api/auth/login", {
      email,
      password,
    });

    // Backend has a 2FA-path that returns `{ requires2FA: true, challengeId }`
    // instead of an access-token. The synthetic test assumes a non-2FA seed.
    if ("requires2FA" in data && data.requires2FA === true) {
      throw new ApiError({
        message:
          "Account has 2FA enabled — synthetic test does not implement 2FA flow",
        code: "REQUIRES_2FA",
        status: 200,
        url: `${this.baseUrl}/api/auth/login`,
        responseBody: data,
      });
    }

    return {
      accessToken: data.accessToken,
      userId: data.user.id,
      email: data.user.email,
      role: data.user.role,
      walletId: data.user.walletId,
    };
  }

  /**
   * Wallet balance for the authenticated user (`balance` in NOK kr —
   * legacy field-shape, must be multiplied by 100 for øre comparison).
   */
  async getWalletMe(token: string): Promise<{ balanceCents: number }> {
    const data = await this.get<WalletMeData>("/api/wallet/me", token);
    // `balance` is in kr (legacy contract). Convert to øre for consistency
    // with the rest of the test (purchases are in cents).
    return { balanceCents: Math.round(data.account.balance * 100) };
  }

  /**
   * Trigger master-start for Spill 1. Returns `scheduledGameId` for the
   * spawned round. PM-AI canonical path is `POST /api/agent/game1/master/start`
   * (Bølge 2 / ADR-0020 — MasterActionService).
   */
  async masterStart(
    token: string,
    hallId: string
  ): Promise<MasterActionResponseData> {
    return this.post<MasterActionResponseData>(
      "/api/agent/game1/master/start",
      { hallId },
      token
    );
  }

  /**
   * Purchase tickets via `POST /api/game1/purchase`. The request is
   * idempotent on `idempotencyKey` — re-submits return the same
   * `purchaseId` with `alreadyExisted = true`.
   */
  async purchaseTickets(
    token: string,
    input: PurchaseTicketInput
  ): Promise<PurchaseResponseData> {
    return this.post<PurchaseResponseData>(
      "/api/game1/purchase",
      input,
      token
    );
  }

  /**
   * Fetch a room snapshot. Useful for verifying engine state mid-round.
   * Not used directly by invariants but exposed for debug-rapport.
   */
  async getRoomSnapshot(roomCode: string): Promise<unknown> {
    return this.get<unknown>(`/api/rooms/${roomCode}`);
  }

  /**
   * Generic GET. Returns `data` from `{ ok: true, data }` envelope.
   * Throws `ApiError` on `{ ok: false, error }` or non-2xx.
   */
  async get<T>(path: string, token?: string): Promise<T> {
    return this.request<T>("GET", path, undefined, token);
  }

  /**
   * Generic POST. Returns `data` from the envelope.
   */
  async post<T>(
    path: string,
    body: unknown,
    token?: string
  ): Promise<T> {
    return this.request<T>("POST", path, body, token);
  }

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    token: string | undefined
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      const res = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const responseText = await res.text();
      let parsed: unknown = undefined;
      try {
        parsed = responseText === "" ? null : JSON.parse(responseText);
      } catch {
        // Non-JSON response — keep `parsed` as undefined and surface via ApiError.
        throw new ApiError({
          message: `Non-JSON response (status=${res.status}): ${responseText.slice(0, 200)}`,
          code: "INVALID_RESPONSE",
          status: res.status,
          url,
          responseBody: responseText,
        });
      }

      if (!res.ok || !isOkEnvelope(parsed)) {
        const code =
          isFailEnvelope(parsed) && typeof parsed.error?.code === "string"
            ? parsed.error.code
            : `HTTP_${res.status}`;
        const message =
          isFailEnvelope(parsed) &&
          typeof parsed.error?.message === "string"
            ? parsed.error.message
            : `Request failed (status=${res.status})`;
        throw new ApiError({
          message,
          code,
          status: res.status,
          url,
          responseBody: parsed,
        });
      }

      return parsed.data as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ── Type-guards ─────────────────────────────────────────────────────────

function isOkEnvelope(value: unknown): value is { ok: true; data: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok: unknown }).ok === true &&
    "data" in value
  );
}

function isFailEnvelope(
  value: unknown
): value is { ok: false; error?: { code?: string; message?: string } } {
  return (
    typeof value === "object" &&
    value !== null &&
    "ok" in value &&
    (value as { ok: unknown }).ok === false
  );
}
