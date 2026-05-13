/**
 * OBS-5: PostHog event-analytics for the Spillorama game-client.
 *
 * Tracks player-side funnel events:
 *
 *   - `client.screen.transition` — every PlayScreen state change
 *   - `client.buy.popup.show` — buy-popup opens with N tickets
 *   - `client.buy.confirm.success` / `client.buy.confirm.error`
 *
 * No-op contract: if `VITE_POSTHOG_API_KEY` is unset (typical in dev/test),
 * every public function is a silent no-op. The `posthog-js` module is
 * dynamically imported so it never ships into the dev bundle when the
 * key is missing.
 *
 * Mirrors the backend `posthogBootstrap.ts` API surface so backend +
 * client share the same mental model:
 *
 *   - `initPostHog(userId)` — call once after auth resolves
 *   - `identifyUser(userId)` — switch the distinctId mid-session
 *   - `trackEvent(event, props)` — capture a single business event
 *   - `shutdownPostHog()` — reset the local handle on game-tear-down
 */

import type { PostHog as PostHogJsType } from "posthog-js";

let handle: PostHogJsType | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;

interface ClientPostHogInitOptions {
  /** Override API key at runtime — primarily for tests. */
  apiKey?: string;
  /** Override host at runtime — primarily for tests. */
  host?: string;
  /** Skip the network init entirely — primarily for tests. */
  injected?: PostHogJsType;
}

/**
 * Read the API key from the Vite env at build time. Runtime override is
 * possible via the `apiKey` option for tests.
 */
function resolveApiKey(options?: ClientPostHogInitOptions): string {
  if (options?.apiKey) return options.apiKey.trim();
  const env = (import.meta as unknown as {
    env?: Record<string, string | undefined>;
  }).env;
  return env?.VITE_POSTHOG_API_KEY?.trim() ?? "";
}

function resolveHost(options?: ClientPostHogInitOptions): string {
  if (options?.host) return options.host.trim();
  const env = (import.meta as unknown as {
    env?: Record<string, string | undefined>;
  }).env;
  return env?.VITE_POSTHOG_HOST?.trim() ?? "https://eu.i.posthog.com";
}

/**
 * Initialize PostHog once per session. No-op when `VITE_POSTHOG_API_KEY`
 * is unset. Safe to call multiple times — subsequent calls return the
 * existing init-promise.
 */
export async function initPostHog(
  userId: string | null,
  options?: ClientPostHogInitOptions,
): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    if (initialized) return;
    initialized = true;

    // Test injection bypasses the dynamic import entirely.
    if (options?.injected) {
      handle = options.injected;
      if (userId) {
        try {
          handle.identify(userId);
        } catch (err) {
          console.warn("[posthog:client] identify failed (injected):", err);
        }
      }
      return;
    }

    const apiKey = resolveApiKey(options);
    if (!apiKey) {
      console.info("[posthog:client] DISABLED — VITE_POSTHOG_API_KEY unset");
      return;
    }

    const host = resolveHost(options);

    try {
      const mod = await import("posthog-js").catch(() => null);
      if (!mod) {
        console.warn("[posthog:client] dynamic import failed");
        return;
      }
      // posthog-js default export is the singleton handle.
      const ph = mod.default as PostHogJsType;
      ph.init(apiKey, {
        api_host: host,
        // Only build identity profiles when we explicitly identify a user —
        // anonymous traffic is anonymized.
        person_profiles: "identified_only",
        // We don't want PostHog's heuristic autocapture clicking around the
        // Pixi canvas. All events are explicit `trackEvent` calls.
        autocapture: false,
        capture_pageview: true,
        capture_pageleave: true,
        // Session recording is owned by Rrweb (OBS-2), so disable PostHog's
        // built-in recorder to avoid double-recording the DOM.
        disable_session_recording: true,
      });
      handle = ph;
      if (userId) {
        try {
          ph.identify(userId);
        } catch (err) {
          console.warn("[posthog:client] identify failed:", err);
        }
      }
      console.info(`[posthog:client] initialized (host=${host})`);
    } catch (err) {
      console.warn("[posthog:client] init failed:", err);
    }
  })();
  return initPromise;
}

/**
 * Switch the distinctId mid-session (e.g. after the player completes
 * registration). No-op when PostHog is disabled.
 */
export function identifyUser(userId: string): void {
  if (!handle || !userId) return;
  try {
    handle.identify(userId);
  } catch (err) {
    console.warn("[posthog:client] identify failed:", err);
  }
}

/**
 * Capture a single business event. No-op when PostHog is disabled or
 * when the SDK throws. Errors are logged at `warn` so dev devtools can
 * still surface them, but the game never crashes.
 */
export function trackEvent(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!handle || !event) return;
  try {
    handle.capture(event, properties);
  } catch (err) {
    console.warn("[posthog:client] capture failed:", err);
  }
}

/**
 * Reset the local handle. Called on game-tear-down (GameApp.destroy) so
 * subsequent mounts re-init cleanly. Safe to call repeatedly.
 */
export function shutdownPostHog(): void {
  if (!handle) {
    initialized = false;
    initPromise = null;
    return;
  }
  try {
    handle.reset();
  } catch (err) {
    console.warn("[posthog:client] reset failed:", err);
  } finally {
    handle = null;
    initialized = false;
    initPromise = null;
  }
}

/**
 * Test-only: forcibly reset the singleton between test cases.
 */
export function __resetPostHogForTests(): void {
  handle = null;
  initialized = false;
  initPromise = null;
}

/**
 * Test-only: inspect the active handle so tests can verify trackEvent
 * forwarded the expected args.
 */
export function __getPostHogHandleForTests(): PostHogJsType | null {
  return handle;
}
