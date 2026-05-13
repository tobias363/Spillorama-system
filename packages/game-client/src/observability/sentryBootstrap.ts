/**
 * OBS-2 (2026-05-13): Game-client Sentry bootstrap.
 *
 * Thin facade over `../telemetry/Sentry.ts` that wires the SDK from
 * `import.meta.env.VITE_SENTRY_DSN` with sensible defaults:
 *   - browserTracing integration
 *   - Replay integration (10 % session, 100 % on error)
 *   - User context (hashed playerId, optional username/email)
 *   - Game/hall/screen tags
 *
 * The actual SDK calls live in `Sentry.ts` — this module exists so the
 * call-site in `GameApp.ts` (or a future `main.ts`) can hide all of the
 * Sentry boilerplate behind a one-liner.
 *
 * The module is import-safe in tests: the underlying `initSentry` is a
 * lazy dynamic import.
 */

import {
  initSentry as initClientSentry,
  setClientSentryTag,
  setClientSentryUser,
  type ClientSentryInitOptions,
} from "../telemetry/Sentry.js";

export interface BootstrapClientSentryInput {
  /**
   * Game slug (e.g. `bingo`, `rocket`, `monsterbingo`). Tagged on every event.
   */
  gameSlug?: string;
  /**
   * Hall-id the player is bound to. Tagged on every event so Sentry queries
   * like `hall:demo-hall-001` can isolate hall-specific spikes.
   */
  hallId?: string;
  /**
   * Opaque player identifier (accessToken, userId). Will be hashed before
   * being sent to Sentry — never sent in plain text.
   */
  playerId?: string;
  /**
   * Optional display name. Only set in non-production environments to keep
   * PII out of Sentry events; production should rely on hashed ids alone.
   */
  userDisplayName?: string;
  /**
   * Optional user email. Same PII caveat as `userDisplayName` — only set
   * when explicitly enabled.
   */
  userEmail?: string;
  /**
   * Release identifier — typically the build SHA. Falls back to "0.1.0"
   * for backwards compatibility with the existing GameApp call-site.
   */
  release?: string;
}

/**
 * Initialise Sentry for the game-client. Idempotent; subsequent calls
 * after the first DSN-driven init are no-ops.
 *
 * Reads `VITE_SENTRY_DSN` from the Vite env at build time. When unset the
 * SDK stays disabled and every helper becomes a silent no-op.
 */
export async function bootstrapClientSentry(input: BootstrapClientSentryInput = {}): Promise<boolean> {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const mode = env?.MODE ?? env?.NODE_ENV ?? "development";
  const isProd = mode === "production";

  const options: ClientSentryInitOptions = {
    release: input.release ?? "0.1.0",
    environment: mode,
    gameSlug: input.gameSlug,
    hallId: input.hallId,
    playerId: input.playerId,
    userDisplayName: input.userDisplayName,
    userEmail: input.userEmail,
    // Tobias 2026-05-13: 10 % session-replay (representative without quota
    // blow-up), 100 % on-error so we always see the runup to a crash. In
    // dev we can run 100 % traces; in prod fall back to 10 %.
    tracesSampleRate: isProd ? 0.1 : 1.0,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  };

  return initClientSentry(options);
}

/**
 * Re-export the per-screen tag setter so callers don't need to import from
 * two modules. Useful when the active screen changes (e.g. PlayScreen →
 * EndOfRoundOverlay).
 */
export function setClientScreen(screen: string): void {
  setClientSentryTag("screen", screen);
}

/**
 * Convenience: scoped-game-id tag for use during a Spill 1 round.
 */
export function setClientScheduledGameId(scheduledGameId: string): void {
  setClientSentryTag("scheduledGameId", scheduledGameId);
}

/**
 * Convenience: plan-run-id tag for use during a Spill 1 plan-runtime.
 */
export function setClientPlanRunId(planRunId: string): void {
  setClientSentryTag("planRunId", planRunId);
}

/**
 * Update the Sentry user-context after login (when accessToken becomes
 * available). Hashes the playerId before sending.
 */
export async function updateClientSentryUser(input: {
  playerId?: string;
  userDisplayName?: string;
  userEmail?: string;
} | null): Promise<void> {
  await setClientSentryUser(input);
}
