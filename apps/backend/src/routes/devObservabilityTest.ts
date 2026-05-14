/**
 * Dev-only test-endpoint for å verifisere at Sentry + PostHog faktisk når
 * sine dashboards. Token-gated.
 *
 *   POST /api/_dev/observability-test?token=<TOKEN>
 *
 * Sender:
 *   1. En Sentry-error med korrelations-tag `obs-test=<timestamp>`
 *   2. En PostHog-event `obs.test.smoke` med same timestamp
 *
 * Klient kan deretter sjekke Sentry-dashboard (event innen 30 sek) og
 * PostHog-dashboard (event innen 1-2 min — eventual consistency).
 *
 * Returnerer JSON med timestamp + tags så caller vet hva de skal lete etter.
 */

import express from "express";
import { captureError } from "../observability/sentry.js";
import { captureEvent } from "../observability/posthogBootstrap.js";

const DEFAULT_TOKEN_ENV = "RESET_TEST_PLAYERS_TOKEN";

function isAuthorized(req: express.Request, expectedToken: string): boolean {
  const provided = String(req.query.token ?? "").trim();
  if (!provided || !expectedToken) return false;
  return provided === expectedToken;
}

export function createDevObservabilityTestRouter(): express.Router {
  const router = express.Router();

  router.post("/api/_dev/observability-test", async (req, res) => {
    const expectedToken = (process.env[DEFAULT_TOKEN_ENV] ?? "").trim();
    if (!expectedToken) {
      res.status(503).json({
        ok: false,
        error: { code: "NOT_CONFIGURED", message: "Token-env mangler" },
      });
      return;
    }
    if (!isAuthorized(req, expectedToken)) {
      res.status(401).json({
        ok: false,
        error: { code: "UNAUTHORIZED", message: "Ugyldig token" },
      });
      return;
    }

    const timestamp = new Date().toISOString();
    const correlationId = `obs-test-${Date.now()}`;
    const results = {
      timestamp,
      correlationId,
      sentry: { sent: false, error: null as string | null },
      posthog: { sent: false, error: null as string | null },
    };

    // 1. Sentry test-error
    try {
      const testError = new Error(
        `[OBS-TEST] Smoke-test error fra /api/_dev/observability-test (${correlationId})`,
      );
      captureError(testError, {
        "obs-test": correlationId,
        "obs-test-source": "backend",
        timestamp,
      });
      results.sentry.sent = true;
    } catch (e) {
      results.sentry.error =
        e instanceof Error ? e.message : "unknown sentry error";
    }

    // 2. PostHog test-event
    try {
      captureEvent("obs-test-distinct-id", "obs.test.smoke", {
        timestamp,
        correlationId,
        source: "backend",
        note: "Smoke-test event — verify PostHog-pipeline live",
      });
      results.posthog.sent = true;
    } catch (e) {
      results.posthog.error =
        e instanceof Error ? e.message : "unknown posthog error";
    }

    res.json({
      ok: true,
      data: {
        ...results,
        verifyAt: {
          sentry: `https://spillorama.sentry.io/issues/?query=${encodeURIComponent("obs-test:" + correlationId)}`,
          posthog: `https://eu.posthog.com/project/178713/events?eventName=obs.test.smoke`,
        },
        instructions: [
          "Sentry: search for tag obs-test=" + correlationId,
          "PostHog: search for event 'obs.test.smoke' or distinct_id 'obs-test-distinct-id'",
          "Both should appear within 30s-2min (eventual consistency).",
        ],
      },
    });
  });

  return router;
}
