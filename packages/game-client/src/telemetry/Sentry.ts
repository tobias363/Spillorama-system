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
  setUser: (user: { id?: string; username?: string }) => void;
}

let sentry: SentryHandle | null = null;
let initialized = false;

export interface ClientSentryInitOptions {
  dsn?: string;
  release?: string;
  environment?: string;
  gameSlug?: string;
  hallId?: string;
  playerId?: string;
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
    mod.init({
      dsn,
      release: options.release,
      environment: options.environment ?? "production",
      // Client-side errors can spike; sample at 30 % for now to avoid quota
      // blow-up. Operator can tune this via a build-time env var later.
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
    });

    // Tag every event with game + hall + hashed player id.
    const hashedPlayerId = options.playerId ? await hashPii(options.playerId) : undefined;
    mod.setTag("game", options.gameSlug ?? "unknown");
    mod.setTag("hall", options.hallId ?? "unknown");
    if (hashedPlayerId) mod.setUser({ id: hashedPlayerId });

    sentry = {
      captureException: (err, hint) => { mod.captureException(err, hint); },
      captureMessage: (msg, level) => { mod.captureMessage(msg, level); },
      addBreadcrumb: (b) => { mod.addBreadcrumb(b); },
      setTag: (k, v) => { mod.setTag(k, v); },
      setUser: (u) => { mod.setUser(u); },
    };
    console.info("[sentry:client] ENABLED");
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
