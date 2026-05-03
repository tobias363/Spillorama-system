/**
 * BIN-776 / M2 — Strict security-header middleware.
 *
 * Goal: A+ score on https://securityheaders.com plus a strict CSP that
 * locks down what the player-shell, admin-web, and Candy iframe-host
 * are allowed to load.
 *
 * Headers set on every response:
 *   - Content-Security-Policy (or -Report-Only) — see `buildCspDirectives`
 *   - Strict-Transport-Security (HSTS) — production only, with preload
 *   - X-Content-Type-Options: nosniff
 *   - X-Frame-Options: DENY  — Candy is allowed via CSP `frame-src`,
 *                              but no other origin may iframe us.
 *   - Referrer-Policy: strict-origin-when-cross-origin
 *   - Permissions-Policy: minimal feature-set (no camera/mic/geo/USB)
 *   - Cross-Origin-Opener-Policy: same-origin
 *   - Cross-Origin-Resource-Policy: same-site
 *
 * Modes (env `CSP_MODE`):
 *   - `report-only` (default) — sends `Content-Security-Policy-Report-Only`.
 *     Browsers POST violations to `/api/csp-report` but do NOT block
 *     resources. Safe to deploy first; verify the report stream is empty
 *     before flipping to enforce.
 *   - `enforce` — sends `Content-Security-Policy`. Browsers block any
 *     resource that violates the policy.
 *
 * Wire-up (in `apps/backend/src/index.ts`):
 *
 *     import { securityHeadersMiddleware } from "./middleware/securityHeaders.js";
 *     app.use(securityHeadersMiddleware());
 *
 * Order: register AFTER `traceIdMiddleware()` (so violation reports get a
 * traceId) but BEFORE `cors()` and routers — headers must be set before
 * the response is sent.
 *
 * NOTE on CSP scope: this middleware applies only to API responses + the
 * static SPA shell. The CSP we emit is intentionally permissive enough to
 * let the admin-Vite bundle, the player-shell bundle, and the Pixi.js
 * game-client run without `unsafe-eval`. `'unsafe-inline'` for `style-src`
 * is required because Pixi/Tailwind inject inline `<style>` blocks at
 * runtime; we do NOT enable inline scripts.
 *
 * Future: replace `'unsafe-inline'` with nonces once the SPA build emits
 * a deterministic style bundle. Tracked in BIN-777.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";

export type CspMode = "report-only" | "enforce";

export interface SecurityHeadersOptions {
  /**
   * `"report-only"` (default) only logs violations; `"enforce"` blocks them.
   * Resolved from `process.env.CSP_MODE` when not provided.
   */
  cspMode?: CspMode;

  /**
   * If true, emit `Strict-Transport-Security`. Default: only when
   * `NODE_ENV === "production"`.
   *
   * HSTS in development would lock localhost to HTTPS, breaking dev
   * servers, so it is opt-in outside production.
   */
  emitHsts?: boolean;

  /**
   * Path of the CSP-violation reporting endpoint. Defaults to
   * `/api/csp-report`. The middleware writes this into the `report-uri`
   * directive.
   */
  cspReportPath?: string;

  /**
   * Extra `connect-src` origins. Useful when staging adds a new
   * monitoring/analytics endpoint without code changes — ops sets the env
   * variable and the next deploy picks it up.
   *
   * Resolved from `process.env.CSP_EXTRA_CONNECT_SRC` (CSV) when not
   * provided. Each entry is trimmed; whitespace-only entries are
   * dropped.
   */
  extraConnectSrc?: string[];
}

/**
 * Production-default CSP directives. Order does NOT matter for browsers,
 * but we keep the ordering stable so unit-tests can do exact-string
 * matching.
 */
export interface CspDirectives {
  defaultSrc: string[];
  scriptSrc: string[];
  styleSrc: string[];
  imgSrc: string[];
  fontSrc: string[];
  connectSrc: string[];
  frameSrc: string[];
  frameAncestors: string[];
  objectSrc: string[];
  baseUri: string[];
  formAction: string[];
  reportUri?: string;
}

/**
 * Resolve the CSP mode from an explicit option, falling back to the
 * `CSP_MODE` env var, falling back to `"report-only"`. Anything other
 * than the two known values is treated as `"report-only"` so a typo
 * never silently disables enforcement guarantees.
 */
export function resolveCspMode(explicit?: CspMode): CspMode {
  if (explicit === "enforce" || explicit === "report-only") return explicit;
  const raw = (process.env.CSP_MODE ?? "").trim().toLowerCase();
  if (raw === "enforce") return "enforce";
  return "report-only";
}

/**
 * Build the directive table that we serialise into the CSP header.
 *
 * Allow-listed third parties:
 *   - `https://res.cloudinary.com` — admin-uploaded photo IDs are stored
 *     on Cloudinary; KYC-moderation needs to display them.
 *   - `https://api.swedbankpay.com` — top-up redirect targets
 *     Swedbank Pay's hosted page; the player-shell `connect-src` must
 *     allow XHR to the SDK init endpoint.
 *   - `wss://*.spillorama-system.onrender.com` — Socket.IO transports
 *     fall back to WebSocket to our own host (Render production).
 *   - `https://candy-backend-ldvg.onrender.com` — Candy iframe origin
 *     (LIVE_BINGO_CANDY_BOUNDARY_2026-04-09).
 *
 * No `'unsafe-eval'` — modern Vite + Pixi work without it.
 */
export function buildCspDirectives(opts: {
  reportUri?: string;
  extraConnectSrc?: string[];
}): CspDirectives {
  const extraConnect = (opts.extraConnectSrc ?? []).filter(
    (s) => typeof s === "string" && s.trim().length > 0
  );

  return {
    defaultSrc: ["'self'"],
    // Pixi/Vite emit hashed bundles served from our own origin.
    // No inline scripts — admin/player shells must not use `eval`/onclick=.
    scriptSrc: ["'self'"],
    // Tailwind + Pixi runtime inject inline `<style>` tags. Until we
    // adopt nonces (BIN-777) we need 'unsafe-inline' here.
    styleSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: [
      "'self'",
      "data:",                       // base64 thumbnails for ticket previews
      "blob:",                       // canvas snapshots in dev tools
      "https://res.cloudinary.com",  // KYC photo IDs
    ],
    fontSrc: ["'self'", "data:"],
    connectSrc: [
      "'self'",
      "https://api.swedbankpay.com",
      "wss://*.spillorama-system.onrender.com",
      "https://candy-backend-ldvg.onrender.com",
      ...extraConnect,
    ],
    frameSrc: ["https://candy-backend-ldvg.onrender.com"],
    // Defence-in-depth duplicate of X-Frame-Options:
    // explicit `frame-ancestors 'none'` blocks all framing of our origin.
    frameAncestors: ["'none'"],
    objectSrc: ["'none'"],            // no Flash/Java applets
    baseUri: ["'self'"],              // <base> tag injection defence
    formAction: ["'self'"],           // forms can only POST back to us
    reportUri: opts.reportUri,
  };
}

function serialiseCsp(directives: CspDirectives): string {
  const parts: string[] = [];
  const push = (name: string, values: string[]) => {
    if (values.length > 0) parts.push(`${name} ${values.join(" ")}`);
  };

  push("default-src", directives.defaultSrc);
  push("script-src", directives.scriptSrc);
  push("style-src", directives.styleSrc);
  push("img-src", directives.imgSrc);
  push("font-src", directives.fontSrc);
  push("connect-src", directives.connectSrc);
  push("frame-src", directives.frameSrc);
  push("frame-ancestors", directives.frameAncestors);
  push("object-src", directives.objectSrc);
  push("base-uri", directives.baseUri);
  push("form-action", directives.formAction);

  if (directives.reportUri) {
    parts.push(`report-uri ${directives.reportUri}`);
  }

  return parts.join("; ");
}

/**
 * Lock down browser feature surface. The shells do not use camera, mic,
 * geolocation, USB, MIDI, payment APIs, or the experimental
 * interest-cohort tracking. Disabling them eliminates a class of
 * compromised-extension attack vectors.
 *
 * Note: Permissions-Policy syntax is `feature=()` for "deny everywhere".
 */
function buildPermissionsPolicy(): string {
  const denied = [
    "accelerometer",
    "autoplay",
    "camera",
    "display-capture",
    "encrypted-media",
    "fullscreen",
    "geolocation",
    "gyroscope",
    "magnetometer",
    "microphone",
    "midi",
    "payment",
    "picture-in-picture",
    "publickey-credentials-get",
    "screen-wake-lock",
    "sync-xhr",
    "usb",
    "web-share",
    "xr-spatial-tracking",
    "interest-cohort",
  ];
  return denied.map((f) => `${f}=()`).join(", ");
}

const HSTS_MAX_AGE_SECONDS = 31_536_000; // 1 year
const HSTS_HEADER_VALUE = `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains; preload`;

export function securityHeadersMiddleware(opts: SecurityHeadersOptions = {}): RequestHandler {
  const cspMode = resolveCspMode(opts.cspMode);
  const cspReportPath = opts.cspReportPath ?? "/api/csp-report";

  const explicitHsts = opts.emitHsts;
  const isProduction =
    (process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
  const emitHsts = typeof explicitHsts === "boolean" ? explicitHsts : isProduction;

  const extraConnectFromEnv = (process.env.CSP_EXTRA_CONNECT_SRC ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const extraConnect = opts.extraConnectSrc ?? extraConnectFromEnv;

  const directives = buildCspDirectives({
    reportUri: cspReportPath,
    extraConnectSrc: extraConnect,
  });
  const cspValue = serialiseCsp(directives);

  const cspHeaderName =
    cspMode === "enforce"
      ? "Content-Security-Policy"
      : "Content-Security-Policy-Report-Only";

  const permissionsPolicyValue = buildPermissionsPolicy();

  return function securityHeadersHandler(
    _req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    res.setHeader(cspHeaderName, cspValue);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", permissionsPolicyValue);
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-site");

    if (emitHsts) {
      res.setHeader("Strict-Transport-Security", HSTS_HEADER_VALUE);
    }

    next();
  };
}

/** Exported for tests + ops verification scripts. */
export const SECURITY_HEADERS_INTERNALS = {
  buildCspDirectives,
  serialiseCsp,
  buildPermissionsPolicy,
  HSTS_HEADER_VALUE,
  HSTS_MAX_AGE_SECONDS,
};
