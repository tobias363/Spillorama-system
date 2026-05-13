/**
 * BIN-539: Sentry wiring for the game client.
 *
 * - Lazy dynamic import so `@sentry/browser` only loads when a DSN is set
 *   in `import.meta.env.VITE_SENTRY_DSN` (build-time) or at runtime via
 *   `initSentry({ dsn })`.
 * - `hashPii` here mirrors the backend's SHA-256-truncated-to-12-hex
 *   pattern so the same player id hashes to the same value on both sides,
 *   enabling cross-stack trace correlation in the Sentry UI.
 * - `bridgeTelemetry` subscribes the Telemetry instance so every call to
 *   `trackFunnelStep` / `trackEvent` / `trackError` also flows into Sentry
 *   as breadcrumbs or captureException calls.
 */

interface SentryHandle {
  captureException: (err: unknown, hint?: { tags?: Record<string, string>; extra?: Record<string, unknown> }) => void;
  captureMessage: (msg: string, level?: "info" | "warning" | "error") => void;
  addBreadcrumb: (b: { category: string; message?: string; data?: Record<string, unknown>; level?: "info" | "warning" | "error" }) => void;
  setTag: (key: string, value: string) => void;
  setUser: (user: { id?: string; username?: string; email?: string } | null) => void;
}

let sentry: SentryHandle | null = null;
let initialized = false;

export interface ClientSentryInitOptions {
  dsn?: string;
  release?: string;
  environment?: string;
  gameSlug?: string;
  hallId?: string;
  /**
   * Opaque player identifier (accessToken or userId). Will be hashed before
   * being sent to Sentry via `setUser({ id: <hash> })`.
   */
  playerId?: string;
  /**
   * Plain-text user display fields. ONLY set these for staging/dev — Sentry
   * stores them as-is, so production should leave `userEmail` undefined and
   * rely on the hashed id.
   */
  userEmail?: string;
  userDisplayName?: string;
  /**
   * Browser-tracing sample rate (0.0–1.0). Defaults to 1.0 in dev and 0.1
   * in production. Set to 0 to disable tracing.
   */
  tracesSampleRate?: number;
  /**
   * Session-Replay sample rate (0.0–1.0). Defaults to 0.1 (10 % of sessions)
   * so we get representative DOM-replays without quota blow-up.
   */
  replaysSessionSampleRate?: number;
  /**
   * Session-Replay sample rate for sessions that hit an error (0.0–1.0).
   * Defaults to 1.0 — always record when something goes wrong.
   */
  replaysOnErrorSampleRate?: number;
}

/**
 * Read the DSN from the Vite env at build time. Runtime override is possible
 * via the `dsn` option to `initSentry`.
 */
function resolveDsn(options?: ClientSentryInitOptions): string {
  if (options?.dsn) return options.dsn.trim();
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  return env?.VITE_SENTRY_DSN?.trim() ?? "";
}

/**
 * Deterministic SHA-256-truncated-to-12-hex hash using the Web Crypto API.
 * Matches the backend's `hashPii` output so cross-stack trace correlation
 * works out of the box.
 */
export async function hashPii(value: string | undefined | null): Promise<string> {
  if (!value) return "anon";
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 12);
}

/**
 * Initialize Sentry once per session. No-op if DSN is unset. Returns true
 * when Sentry is active after the call.
 */
export async function initSentry(options: ClientSentryInitOptions = {}): Promise<boolean> {
  if (initialized) return sentry !== null;
  initialized = true;

  const dsn = resolveDsn(options);
  if (!dsn) {
    // Quiet in dev; noisy feedback in prod would be wrong since DSN-less is a
    // legitimate staging config.
    if (typeof console !== "undefined") {
      console.info("[sentry:client] DISABLED — VITE_SENTRY_DSN unset");
    }
    return false;
  }

  try {
    const mod = await import("@sentry/browser").catch(() => null);
    if (!mod) {
      console.warn("[sentry:client] DISABLED — @sentry/browser not installed");
      return false;
    }

    const environment = options.environment ?? "production";
    const isProd = environment === "production";

    // Build integrations list. browserTracing/replay integrations are
    // optional — if the SDK build doesn't expose them we silently skip.
    const integrations: unknown[] = [];
    try {
      const browserTracingFactory = (mod as unknown as { browserTracingIntegration?: () => unknown }).browserTracingIntegration;
      if (typeof browserTracingFactory === "function") {
        integrations.push(browserTracingFactory());
      }
    } catch (err) {
      console.warn("[sentry:client] browserTracing integration failed to load", err);
    }
    try {
      const replayFactory = (mod as unknown as {
        replayIntegration?: (opts: { maskAllText?: boolean; blockAllMedia?: boolean }) => unknown;
      }).replayIntegration;
      if (typeof replayFactory === "function") {
        integrations.push(
          replayFactory({
            // Tobias 2026-05-13: vi vil se hva spilleren ser, så mask=false.
            // Sentry-Replay maskerer ikke automatisk PII; bryr du deg om GDPR,
            // sett denne til true i prod og whitelist enkelt-elementer.
            maskAllText: false,
            blockAllMedia: false,
          }),
        );
      }
    } catch (err) {
      console.warn("[sentry:client] replayIntegration failed to load", err);
    }

    mod.init({
      dsn,
      release: options.release,
      environment,
      tracesSampleRate: options.tracesSampleRate ?? (isProd ? 0.1 : 1.0),
      replaysSessionSampleRate: options.replaysSessionSampleRate ?? 0.1,
      replaysOnErrorSampleRate: options.replaysOnErrorSampleRate ?? 1.0,
      integrations: integrations.length > 0 ? (integrations as Parameters<typeof mod.init>[0] extends { integrations?: infer T } ? T : never) : undefined,
    });

    // Tag every event with game + hall + hashed player id.
    const hashedPlayerId = options.playerId ? await hashPii(options.playerId) : undefined;
    mod.setTag("game", options.gameSlug ?? "unknown");
    mod.setTag("hall", options.hallId ?? "unknown");
    if (hashedPlayerId) {
      mod.setUser({
        id: hashedPlayerId,
        // Display fields only when explicitly provided — we never derive
        // them from PII sources.
        username: options.userDisplayName,
        email: options.userEmail,
      });
    }

    sentry = {
      captureException: (err, hint) => { mod.captureException(err, hint); },
      captureMessage: (msg, level) => { mod.captureMessage(msg, level); },
      addBreadcrumb: (b) => { mod.addBreadcrumb(b); },
      setTag: (k, v) => { mod.setTag(k, v); },
      setUser: (u) => { mod.setUser(u); },
    };
    console.info(
      `[sentry:client] ENABLED (env=${environment}, traces=${options.tracesSampleRate ?? (isProd ? 0.1 : 1.0)}, replay=${options.replaysSessionSampleRate ?? 0.1})`,
    );
    return true;
  } catch (err) {
    console.error("[sentry:client] init failed — continuing without", err);
    return false;
  }
}

export function captureClientError(err: unknown, tags: Record<string, string | undefined> = {}): void {
  if (!sentry) return;
  const cleanTags = Object.fromEntries(
    Object.entries(tags).filter(([, v]) => typeof v === "string" && v.length > 0),
  ) as Record<string, string>;
  sentry.captureException(err, { tags: cleanTags });
}

export function captureClientMessage(msg: string, level: "info" | "warning" | "error" = "info"): void {
  if (!sentry) return;
  sentry.captureMessage(msg, level);
}

export function addClientBreadcrumb(category: string, data: Record<string, unknown> = {}): void {
  if (!sentry) return;
  sentry.addBreadcrumb({ category, data, level: "info" });
}

/**
 * Update a runtime tag on the active Sentry scope, e.g. when the player
 * switches hall mid-session or moves between screens.
 */
export function setClientSentryTag(key: string, value: string): void {
  if (!sentry) return;
  sentry.setTag(key, value);
}

/**
 * Update the user-context. `playerId` is hashed before being sent. Use this
 * after login when the accessToken is known but `initSentry` already ran
 * with anonymous defaults.
 */
export async function setClientSentryUser(input: {
  playerId?: string;
  userDisplayName?: string;
  userEmail?: string;
} | null): Promise<void> {
  if (!sentry) return;
  if (input === null) {
    sentry.setUser(null);
    return;
  }
  const id = input.playerId ? await hashPii(input.playerId) : undefined;
  sentry.setUser({
    id,
    username: input.userDisplayName,
    email: input.userEmail,
  });
}

/** Test-only: reset so tests can re-init with different options. */
export function __resetClientSentryForTests(): void {
  sentry = null;
  initialized = false;
}

/** Test-only: inject a mock. */
export function __installMockClientSentryForTests(mock: SentryHandle): void {
  sentry = mock;
  initialized = true;
}
