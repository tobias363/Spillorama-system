/**
 * OBS-5: PostHog event-analytics integration for the backend.
 *
 * Pure event-capture wrapper around `posthog-node`. Complements Sentry
 * (errors) and Rrweb (DOM-replay) with funnel + cohort analytics. The
 * module is a thin facade that:
 *
 *   - Lazily initializes the PostHog client when `POSTHOG_API_KEY` is set
 *   - Returns `null` (no-op) when the key is unset (dev/test stays quiet)
 *   - Swallows all client errors so analytics never crashes the host
 *   - Provides `shutdownPostHog()` that flushes the queue before exit
 *
 * Usage:
 *   initPostHog();                                       // call once at startup
 *   captureEvent(userId, "ticket.purchase.success", {…}); // per business event
 *   await shutdownPostHog();                              // on SIGTERM/SIGINT
 *
 * No-op contract: if `POSTHOG_API_KEY` is missing, every public function
 * is a silent no-op. There is nothing to mock in tests — just leave the
 * env var unset and assertions still pass.
 */

import { PostHog } from "posthog-node";

let client: PostHog | null = null;

/**
 * Initialize the PostHog client if `POSTHOG_API_KEY` is set. Safe to call
 * multiple times — subsequent calls return the existing client. Returns
 * the active client or `null` if analytics is disabled.
 */
export function initPostHog(): PostHog | null {
  if (client) return client;

  const apiKey = process.env.POSTHOG_API_KEY?.trim();
  if (!apiKey) {
    console.warn("[posthog] POSTHOG_API_KEY not set — analytics disabled");
    return null;
  }

  const host = process.env.POSTHOG_HOST?.trim() ?? "https://eu.i.posthog.com";

  try {
    client = new PostHog(apiKey, {
      host,
      // Batch up to 20 events before flushing.
      flushAt: 20,
      // Force a flush every 10s even if batch isn't full.
      flushInterval: 10_000,
    });
    console.info(`[posthog] initialized (host=${host})`);
    return client;
  } catch (err) {
    console.warn("[posthog] init failed:", err);
    return null;
  }
}

/**
 * Return the active client (or null when analytics is disabled). Mainly
 * intended for tests + advanced call-sites that want to bypass
 * `captureEvent`.
 */
export function getPostHog(): PostHog | null {
  return client;
}

/**
 * Capture a single business event. No-op when analytics is disabled or
 * when the underlying SDK throws. Errors are logged at `warn` so ops can
 * still detect outages without crashing the request that triggered it.
 */
export function captureEvent(
  distinctId: string,
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!client) return;
  if (!distinctId || !event) return;
  try {
    client.capture({ distinctId, event, properties });
  } catch (err) {
    console.warn("[posthog] capture failed:", err);
  }
}

/**
 * Flush any pending events and shut down the client. Safe to call when
 * the client is `null` (no-op). Swallows shutdown errors so the host
 * process can continue its own graceful-shutdown path.
 */
export async function shutdownPostHog(): Promise<void> {
  if (!client) return;
  try {
    await client.shutdown();
  } catch (err) {
    console.warn("[posthog] shutdown failed:", err);
  } finally {
    client = null;
  }
}

/**
 * Test-only: forcibly reset the singleton between test cases. Production
 * code should not call this.
 */
export function __resetPostHogForTests(): void {
  client = null;
}

/**
 * Test-only: inject a mock PostHog handle so unit tests can assert that
 * `capture` is called with expected props without spinning up the real
 * SDK.
 */
export function __installMockPostHogForTests(mock: PostHog): void {
  client = mock;
}
