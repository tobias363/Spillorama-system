/**
 * Client telemetry for observability and pilot evaluation.
 *
 * Tracks:
 * - Launch funnel (lobby → loaded → connected → joined → playing → completed)
 * - Socket stability (reconnects, disconnects per session)
 * - Client errors with game context
 *
 * BIN-539: every call also flows into Sentry (when enabled via
 * VITE_SENTRY_DSN at build time). Funnel steps + events become breadcrumbs;
 * trackError calls captureException. The Sentry module is a lazy-loaded
 * sidecar, so this file stays import-safe for unit tests.
 */

import { addClientBreadcrumb, captureClientError } from "./Sentry.js";

export interface TelemetryContext {
  gameSlug: string;
  hallId: string;
  releaseVersion: string;
}

interface FunnelStep {
  step: string;
  timestamp: number;
}

export class Telemetry {
  private context: TelemetryContext | null = null;
  private funnelSteps: FunnelStep[] = [];
  private reconnectCount = 0;
  private disconnectCount = 0;
  private sessionStart = Date.now();

  init(context: TelemetryContext): void {
    this.context = context;
    this.sessionStart = Date.now();
    this.funnelSteps = [];
    this.reconnectCount = 0;
    this.disconnectCount = 0;

    // Global error handler
    window.addEventListener("error", (event) => {
      this.trackError("uncaught", event.error ?? event.message);
    });

    window.addEventListener("unhandledrejection", (event) => {
      this.trackError("unhandled_rejection", event.reason);
    });
  }

  // ── Launch funnel ─────────────────────────────────────────────────────

  trackFunnelStep(step: string): void {
    this.funnelSteps.push({ step, timestamp: Date.now() });
    this.log("funnel", { step, elapsed: Date.now() - this.sessionStart });
    addClientBreadcrumb("funnel", { step, elapsed: Date.now() - this.sessionStart });
  }

  getFunnelSteps(): FunnelStep[] {
    return [...this.funnelSteps];
  }

  // ── Socket stability ──────────────────────────────────────────────────

  trackReconnect(): void {
    this.reconnectCount++;
    this.log("socket_reconnect", { count: this.reconnectCount });
    addClientBreadcrumb("socket.reconnect", { count: this.reconnectCount });
  }

  trackDisconnect(reason: string): void {
    this.disconnectCount++;
    this.log("socket_disconnect", { reason, count: this.disconnectCount });
    addClientBreadcrumb("socket.disconnect", { reason, count: this.disconnectCount });
  }

  getSocketStats(): { reconnects: number; disconnects: number } {
    return {
      reconnects: this.reconnectCount,
      disconnects: this.disconnectCount,
    };
  }

  // ── Error tracking ────────────────────────────────────────────────────

  trackError(type: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;

    this.log("error", {
      type,
      message,
      stack: stack?.slice(0, 500),
      ...this.context,
    });

    captureClientError(error, {
      type,
      gameSlug: this.context?.gameSlug,
      hallId: this.context?.hallId,
      releaseVersion: this.context?.releaseVersion,
    });
  }

  // ── Business events ───────────────────────────────────────────────────

  trackEvent(name: string, data?: Record<string, unknown>): void {
    this.log("event", { name, ...data, ...this.context });
    addClientBreadcrumb(`event.${name}`, { ...data });
  }

  // ── Internal ──────────────────────────────────────────────────────────

  private log(category: string, data: Record<string, unknown>): void {
    if (import.meta.env.DEV) {
      console.log(`[telemetry:${category}]`, data);
    }
    // In production: batch and send to analytics endpoint
  }
}

/** Singleton instance. */
export const telemetry = new Telemetry();
