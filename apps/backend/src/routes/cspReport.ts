/**
 * BIN-776 / M2 — CSP-violation report endpoint.
 *
 * Browsers POST `application/csp-report`-shaped payloads here whenever a
 * resource violates the policy declared in the `Content-Security-Policy`
 * (or `-Report-Only`) header. We log the violation as a structured warn-
 * level event so ops can grep Render logs / Sentry breadcrumbs to spot
 * regressions during the report-only rollout phase.
 *
 * Wire-up (in `apps/backend/src/index.ts`):
 *
 *     import { createCspReportRouter } from "./routes/cspReport.js";
 *     app.use(createCspReportRouter());
 *
 * Order: register AFTER `express.json()` so the body is parsed. The
 * router is intentionally unauthenticated — browsers send the report as
 * a side-effect of a violation and cannot include cookies/Bearer tokens
 * for cross-origin reports.
 *
 * Defence-in-depth:
 *   - Truncate string fields to a safe maximum so a malicious page
 *     cannot fill the log with megabyte-sized URLs.
 *   - Always reply 204 — never echo body fields back. A response body
 *     could otherwise be turned into a reflected-XSS sink if a future
 *     middleware misinterpreted the content type.
 *   - Never throw — a thrown exception here would log a 500 and pollute
 *     the dashboards. We swallow malformed bodies and log a warning.
 */

import express from "express";
import { logger } from "../util/logger.js";

const log = logger.child({ module: "csp-report" });

/**
 * Maximum number of characters we keep from any single string field
 * before logging. CSP reports include URLs which can in theory be
 * unbounded — chrome ships up to ~2KB but a buggy/forged client could
 * post much more. Truncating at 2048 keeps each log line small.
 */
const MAX_STRING_LEN = 2048;

interface ParsedCspViolation {
  documentUri: string | undefined;
  blockedUri: string | undefined;
  violatedDirective: string | undefined;
  effectiveDirective: string | undefined;
  originalPolicy: string | undefined;
  disposition: string | undefined;
  sourceFile: string | undefined;
  lineNumber: number | undefined;
  columnNumber: number | undefined;
  statusCode: number | undefined;
  referrer: string | undefined;
  scriptSample: string | undefined;
}

function clip(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  return value.length > MAX_STRING_LEN ? value.slice(0, MAX_STRING_LEN) + "…" : value;
}

function pickNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Browsers send TWO different report shapes:
 *
 *  1. Legacy report-uri:
 *     { "csp-report": { "document-uri": ..., "violated-directive": ... } }
 *
 *  2. Reporting API (report-to):
 *     [{ "type": "csp-violation", "body": { "documentURL": ..., "effectiveDirective": ... } }]
 *
 * We try both. Either one missing / malformed → return undefined and the
 * handler logs a `malformed` warning.
 */
function parseViolation(body: unknown): ParsedCspViolation | undefined {
  if (!body || typeof body !== "object") return undefined;

  // Reporting API shape: array of report objects
  if (Array.isArray(body)) {
    const first = body[0];
    if (first && typeof first === "object" && "body" in first) {
      const inner = (first as { body: unknown }).body;
      if (inner && typeof inner === "object") {
        const r = inner as Record<string, unknown>;
        return {
          documentUri: clip(r["documentURL"] ?? r["document-uri"]),
          blockedUri: clip(r["blockedURL"] ?? r["blocked-uri"]),
          violatedDirective: clip(r["violatedDirective"] ?? r["violated-directive"]),
          effectiveDirective: clip(r["effectiveDirective"] ?? r["effective-directive"]),
          originalPolicy: clip(r["originalPolicy"] ?? r["original-policy"]),
          disposition: clip(r["disposition"]),
          sourceFile: clip(r["sourceFile"] ?? r["source-file"]),
          lineNumber: pickNumber(r["lineNumber"] ?? r["line-number"]),
          columnNumber: pickNumber(r["columnNumber"] ?? r["column-number"]),
          statusCode: pickNumber(r["statusCode"] ?? r["status-code"]),
          referrer: clip(r["referrer"]),
          scriptSample: clip(r["sample"] ?? r["script-sample"]),
        };
      }
    }
    return undefined;
  }

  // Legacy shape
  const wrapper = body as Record<string, unknown>;
  const inner = wrapper["csp-report"];
  if (inner && typeof inner === "object") {
    const r = inner as Record<string, unknown>;
    return {
      documentUri: clip(r["document-uri"]),
      blockedUri: clip(r["blocked-uri"]),
      violatedDirective: clip(r["violated-directive"]),
      effectiveDirective: clip(r["effective-directive"]),
      originalPolicy: clip(r["original-policy"]),
      disposition: clip(r["disposition"]),
      sourceFile: clip(r["source-file"]),
      lineNumber: pickNumber(r["line-number"]),
      columnNumber: pickNumber(r["column-number"]),
      statusCode: pickNumber(r["status-code"]),
      referrer: clip(r["referrer"]),
      scriptSample: clip(r["script-sample"]),
    };
  }

  return undefined;
}

export function createCspReportRouter(): express.Router {
  const router = express.Router();

  // The browser's content-type for legacy report-uri is
  // `application/csp-report`. The standard JSON parser does not
  // recognise it, so we register a permissive parser bound to this
  // route only. The Reporting API uses `application/reports+json`
  // which we accept here as well. Body is small (≤ a few KB) so a
  // 16KB cap is plenty and prevents log flooding.
  const cspBodyParser = express.json({
    type: ["application/csp-report", "application/reports+json", "application/json"],
    limit: "16kb",
  });

  router.post("/api/csp-report", cspBodyParser, (req, res) => {
    try {
      const violation = parseViolation(req.body);
      if (!violation) {
        log.warn(
          { bodyType: typeof req.body },
          "csp.report received with malformed body — ignoring",
        );
      } else {
        log.warn(violation, "csp.violation");
      }
    } catch (err) {
      // Never let a logging error reach the client — that would turn a
      // browser side-effect into a noisy 500. Just record and move on.
      log.warn({ err }, "csp.report handler threw — swallowing");
    }
    // 204 No Content per W3C report-uri spec.
    res.status(204).end();
  });

  return router;
}

/** Exported for unit-tests. */
export const CSP_REPORT_INTERNALS = {
  parseViolation,
  MAX_STRING_LEN,
};
