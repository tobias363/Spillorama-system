/**
 * BIN-277: Per-route sliding-window rate limiter for Express REST endpoints.
 *
 * Tracks requests by **userId** (extracted from the Bearer token) when an
 * Authorization header is present, falling back to **IP** for anonymous
 * traffic. Each route prefix has its own tier-config. Stale entries are
 * garbage-collected periodically to prevent memory leaks.
 *
 * ## Per-user keying (industry-standard, 2026-05-11)
 *
 * Stripe, GitHub, Cloudflare, Discord rate-limit autenticerte routes
 * **per user / per API-key**, not per IP. Per-IP collapses in production
 * for NAT'd networks — a bingo hall with 250 players behind one NAT-IP
 * would share one bucket and lock the whole hall out simultaneously.
 *
 * Spillorama uses opaque session tokens (not JWTs). The bearer token IS
 * the user-identity for rate-limiting purposes: two users have different
 * tokens → different keys, same user across requests → same key. We hash
 * the token (truncated SHA-256) so the raw token never enters memory
 * bucket-keys, logs, or error messages.
 *
 * For anonymous routes (`/api/auth/login`, `/api/auth/register`,
 * `/api/auth/forgot-password`, etc.) the request has no Authorization
 * header, so we fall back to per-IP keying — which is the **correct**
 * brute-force defense for those routes.
 *
 * ## Soft-fail on invalid bearer
 *
 * If the Authorization header is malformed or empty (`"Bearer "`), we
 * **do not** return 401 from this middleware — auth-middleware downstream
 * owns auth-rejection. We silently fall back to per-IP keying so the
 * request proceeds to the real auth-guard and gets a proper 401 with
 * domain-specific error code.
 *
 * ## X-RateLimit-* response headers (GitHub-style)
 *
 * Industry-standard so the client can pre-emptively back off polling
 * BEFORE hitting 429. We set on every response (200 OK + 429):
 *
 *   X-RateLimit-Limit:     <maxRequests> for matched tier
 *   X-RateLimit-Remaining: <maxRequests - current bucket size>
 *   X-RateLimit-Reset:     <unix-epoch-seconds when oldest sample expires>
 *   Retry-After:           <seconds> (only on 429)
 */

import type { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";

export interface HttpRateLimitConfig {
  /** Window duration in milliseconds */
  windowMs: number;
  /** Maximum requests allowed within the window */
  maxRequests: number;
}

export interface HttpRateLimitTier {
  /** Route prefix to match (e.g. "/api/auth") */
  prefix: string;
  config: HttpRateLimitConfig;
}

/** Default rate limit tiers — strictest match wins (longest prefix). */
export const DEFAULT_HTTP_RATE_LIMITS: HttpRateLimitTier[] = [
  // ── Strict: auth-WRITE endpoints (brute-force-vern) ───────────────────
  { prefix: "/api/auth/login",           config: { windowMs: 60_000,  maxRequests: 5  } },
  // REQ-130: PIN brute force-vern. 5 forsøk / 15 min per IP, men service-laget
  // har sin egen lockout per bruker (5 forsøk → admin reset).
  { prefix: "/api/auth/login-phone",     config: { windowMs: 15 * 60_000, maxRequests: 5  } },
  { prefix: "/api/auth/pin/disable",     config: { windowMs: 60_000,  maxRequests: 5  } },
  { prefix: "/api/auth/pin/setup",       config: { windowMs: 60_000,  maxRequests: 10 } },
  { prefix: "/api/auth/register",        config: { windowMs: 60_000,  maxRequests: 3  } },
  { prefix: "/api/auth/forgot-password", config: { windowMs: 60_000,  maxRequests: 3  } },
  { prefix: "/api/auth/change-password", config: { windowMs: 60_000,  maxRequests: 5  } },

  // ── Moderate: auth-READ endpoints (polling fra profil-side) ───────────
  //
  // Tobias-bug 2026-05-11: page-load fyrer 4-5 auth-reads (/me, /pin/status,
  // /2fa/status, /sessions). 4 refresh → 16-20 calls → traff gamle 20/min
  // limit → 429. Spillere ble kastet ut etter ~4 refreshes. Det er ikke
  // akseptabelt for vanlig bruk — kun login/register/passord-skriv trenger
  // strict-cap. Auth-leser har auth-guard så høyere cap er trygt.
  //
  // 2026-05-11 (per-user keying landet): disse limits er nå per-bruker
  // (ikke per-IP) når Authorization header er til stede. Det betyr at en
  // bingohall med 250 spillere bak samme NAT-IP ikke lenger deler bucket.
  // I oppfølger-PR kan vi vurdere å bumpe ytterligere (1000/min er
  // sant industry-standard for auth-guarded reads), men beholder dagens
  // tall for å redusere risiko i denne refaktoren.
  { prefix: "/api/auth/me",              config: { windowMs: 60_000,  maxRequests: 200 } },
  { prefix: "/api/auth/sessions",        config: { windowMs: 60_000,  maxRequests: 200 } },
  { prefix: "/api/auth/pin/status",      config: { windowMs: 60_000,  maxRequests: 200 } },
  { prefix: "/api/auth/2fa/status",      config: { windowMs: 60_000,  maxRequests: 200 } },
  // Catch-all for andre auth-endpoints (refresh, logout, verify-email, etc.)
  // 100/min er nok for refresh-token-rotasjon + utilsiktede dobbel-kall.
  { prefix: "/api/auth",                 config: { windowMs: 60_000,  maxRequests: 100 } },

  // ── Payments: moderate (skriv-tunge) ──────────────────────────────────
  { prefix: "/api/payments",             config: { windowMs: 60_000,  maxRequests: 30 } },
  { prefix: "/api/wallet/me/topup",      config: { windowMs: 60_000,  maxRequests: 10 } },

  // Compliance/wallet writes — strict (regulatorisk)
  { prefix: "/api/wallet/me/self-exclusion", config: { windowMs: 60_000, maxRequests: 5 } },
  { prefix: "/api/wallet/me/timed-pause",   config: { windowMs: 60_000, maxRequests: 5 } },
  { prefix: "/api/wallet/me/loss-limits",   config: { windowMs: 60_000, maxRequests: 10 } },

  // ── Admin og agent: høye cap-er (auth-guarded) ────────────────────────
  // Admin catalog reads: the admin dashboard polls 6 endpoints every 10s
  // (~36 req/min/tab), on top of click-through traffic across list/view pages.
  // The shared `/api/` 120/min tier leaves almost no headroom for a single
  // logged-in admin. Admin routes are auth-guarded (requireAdmin) so a higher
  // limit is safe — anonymous abuse still falls back to /api/ below.
  { prefix: "/api/admin",                config: { windowMs: 60_000,  maxRequests: 600 } },

  // Agent dashboard fyrer 7-10 parallelle requests ved page-load (auth/me,
  // dashboard, payments, permissions, context, game-plan/current). Auth-
  // guarded så høyere limit er trygg. Tobias-feedback 2026-05-08.
  { prefix: "/api/agent",                config: { windowMs: 60_000,  maxRequests: 600 } },

  // ── General API reads: very generous (Tobias-direktiv 2026-05-11) ─────
  //
  // Spillere refresher siden, åpner BuyPopup, polleer balance/lobby/games-
  // status hvert 30s + spillvett-poll. 4-5 refreshes innen 1 min er
  // realistisk og kan ikke kaste dem ut. Økt fra 300 → 1000.
  { prefix: "/api/",                     config: { windowMs: 60_000,  maxRequests: 1000 } },
];

const GC_INTERVAL_MS = 60_000;
/**
 * Hash-prefix length for bearer-tokens used as bucket keys. SHA-256
 * truncated to 16 hex chars (64 bits) gives ~2^32 collision resistance,
 * which is more than enough for rate-limit-bucket identity. Different
 * users have different tokens → different keys with overwhelming
 * probability. The raw token never appears in memory bucket-keys or
 * logs.
 */
const TOKEN_KEY_HASH_LEN = 16;

/**
 * Result from `check()`. `allowed` + `retryAfterMs` are the original
 * contract (existing callers). `current`, `limit`, `resetAtMs` are added
 * for X-RateLimit-* response-headers (industry-standard, GitHub-style).
 */
export interface HttpRateLimitCheckResult {
  allowed: boolean;
  /** ms until the bucket allows another request (only set when blocked). */
  retryAfterMs?: number;
  /** Number of requests recorded in the current window (AFTER this call). */
  current: number;
  /** Tier's maxRequests. */
  limit: number;
  /**
   * Unix epoch ms when the OLDEST timestamp in the bucket expires (i.e.
   * when at least one slot frees up). If the bucket is empty, this is
   * `nowMs + windowMs`. Clients can pre-compute backoff against this.
   */
  resetAtMs: number;
}

/**
 * Derive the rate-limit-bucket key from a request. Per-user when an
 * Authorization Bearer token is present and parseable; per-IP otherwise.
 *
 * Soft-fail on invalid bearer (empty `"Bearer "`, malformed scheme): we
 * silently fall back to per-IP. Auth-middleware downstream owns 401-
 * rejection — this middleware should never short-circuit a request with
 * 401, only with 429.
 *
 * Exported for testing (see `httpRateLimit.test.ts`).
 */
export function deriveRateLimitKey(
  req: Pick<Request, "headers" | "ip" | "socket">,
  tierPrefix: string
): { key: string; mode: "user" | "ip" } {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.length > 0) {
    // Match "Bearer <token>" case-insensitively (RFC 6750 §2.1 says the
    // scheme is case-insensitive, though Bearer is canonical).
    const match = /^Bearer\s+(\S.*)$/i.exec(auth);
    if (match && match[1]) {
      const token = match[1].trim();
      if (token.length > 0) {
        // Hash so the raw token never appears in memory bucket-keys, GC
        // dumps, or error messages. 16 hex chars = 64-bit prefix —
        // collision probability is negligible for rate-limit identity.
        const hashed = createHash("sha256")
          .update(token, "utf8")
          .digest("hex")
          .slice(0, TOKEN_KEY_HASH_LEN);
        return { key: `user:${hashed}:${tierPrefix}`, mode: "user" };
      }
    }
    // Soft-fail: malformed Authorization header → fall back to per-IP.
    // Don't reject here — let downstream auth-middleware return 401.
  }
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  return { key: `ip:${ip}:${tierPrefix}`, mode: "ip" };
}

export class HttpRateLimiter {
  private readonly buckets = new Map<string, number[]>();
  private readonly tiers: HttpRateLimitTier[];
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  constructor(tiers?: HttpRateLimitTier[]) {
    // Sort by prefix length descending so longest-prefix match wins first.
    this.tiers = [...(tiers ?? DEFAULT_HTTP_RATE_LIMITS)].sort(
      (a, b) => b.prefix.length - a.prefix.length
    );
  }

  start(): void {
    if (this.gcTimer) return;
    this.gcTimer = setInterval(() => this.gc(), GC_INTERVAL_MS);
    if (this.gcTimer.unref) this.gcTimer.unref();
  }

  stop(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer);
      this.gcTimer = null;
    }
  }

  /**
   * Resolve the rate limit config for a given path.
   * Returns undefined if no tier matches (no limiting applied).
   */
  resolveConfig(path: string): HttpRateLimitConfig | undefined {
    for (const tier of this.tiers) {
      if (path.startsWith(tier.prefix)) {
        return tier.config;
      }
    }
    return undefined;
  }

  /**
   * Resolve the tier-prefix for a given path. Returns the path itself as
   * fallback if no tier matches (matches resolveConfig's no-op behavior).
   */
  resolveTierPrefix(path: string): string {
    for (const tier of this.tiers) {
      if (path.startsWith(tier.prefix)) {
        return tier.prefix;
      }
    }
    return path;
  }

  /**
   * Check whether a request is allowed.
   * Returns { allowed, retryAfterMs?, current, limit, resetAtMs }.
   *
   * `current` and `resetAtMs` enable X-RateLimit-* response headers.
   * `retryAfterMs` is only set when blocked.
   */
  check(
    key: string,
    config: HttpRateLimitConfig,
    nowMs: number = Date.now()
  ): HttpRateLimitCheckResult {
    const bucketKey = key;
    let timestamps = this.buckets.get(bucketKey);
    if (!timestamps) {
      timestamps = [];
      this.buckets.set(bucketKey, timestamps);
    }

    // Prune timestamps outside window
    const cutoff = nowMs - config.windowMs;
    while (timestamps.length > 0 && timestamps[0] <= cutoff) {
      timestamps.shift();
    }

    // resetAtMs = when the OLDEST timestamp in the window expires.
    // For an empty bucket, the bucket would never fill so reset is
    // "now + windowMs" — that's the worst-case from the client's view.
    const resetAtMs = timestamps.length > 0
      ? timestamps[0]! + config.windowMs
      : nowMs + config.windowMs;

    if (timestamps.length >= config.maxRequests) {
      const oldestInWindow = timestamps[0]!;
      const retryAfterMs = oldestInWindow + config.windowMs - nowMs;
      return {
        allowed: false,
        retryAfterMs: Math.max(retryAfterMs, 1000),
        current: timestamps.length,
        limit: config.maxRequests,
        resetAtMs,
      };
    }

    timestamps.push(nowMs);
    return {
      allowed: true,
      current: timestamps.length,
      limit: config.maxRequests,
      resetAtMs,
    };
  }

  /** Express middleware factory */
  middleware(): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction) => {
      // Tobias-direktiv 2026-05-11: Industry-standard tre-lags bypass for å
      // unngå at dev/staging-traffikk kvelner egen utvikling. Match hvordan
      // de fleste plattformer (Stripe, GitHub, Cloudflare) håndterer dev-
      // tooling: full bypass for localhost + env-kontrollerbar global disable.
      //
      //   1. `HTTP_RATE_LIMIT_DISABLED=true` → full bypass globalt (kjøres
      //      automatisk av `npm run dev:all` så lokale Mac-er aldri kan
      //      lock-out seg selv). Aldri satt i prod-env på Render.
      //   2. localhost-bypass (`::1`, `127.0.0.1`) — sliding-window er meningsløs
      //      når alle klient-vinduer deler samme IP. Forhindrer at 2-3 tabs
      //      i Tobias' browser fyller opp tier-en samtidig.
      //   3. Default sliding-window per (user OR IP) — eneste mode i prod.
      if (process.env["HTTP_RATE_LIMIT_DISABLED"] === "true") {
        return next();
      }

      const config = this.resolveConfig(req.path);
      if (!config) return next();

      // Localhost-bypass: dev-miljø har ALLE klient-vinduer på samme IP
      // (`::1` eller `127.0.0.1`). Sliding-window straffer da multi-tab-
      // workflows + browser-refresh urettferdig. I prod kjører backend
      // bak Render-proxy som setter `X-Forwarded-For` til ekte klient-IP,
      // så dette bare matcher i dev.
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      if (ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1") {
        return next();
      }

      const tierPrefix = this.resolveTierPrefix(req.path);
      const { key } = deriveRateLimitKey(req, tierPrefix);

      const result = this.check(key, config);

      // Set X-RateLimit-* response headers on every response (200 OK
      // and 429 alike). Industry-standard (GitHub, Stripe) so clients
      // can pre-emptively back off polling. Reset is unix-epoch seconds.
      res.set("X-RateLimit-Limit", String(result.limit));
      const remaining = Math.max(0, result.limit - result.current);
      res.set("X-RateLimit-Remaining", String(remaining));
      res.set("X-RateLimit-Reset", String(Math.ceil(result.resetAtMs / 1000)));

      if (!result.allowed) {
        const retryAfterSec = Math.ceil((result.retryAfterMs ?? 1000) / 1000);
        res.set("Retry-After", String(retryAfterSec));
        res.status(429).json({
          ok: false,
          error: {
            code: "RATE_LIMITED",
            message: `For mange forespørsler. Prøv igjen om ${retryAfterSec} sekunder.`,
          },
        });
        return;
      }

      next();
    };
  }

  private gc(): void {
    const now = Date.now();
    for (const [key, timestamps] of this.buckets) {
      // Remove all expired timestamps
      while (timestamps.length > 0 && timestamps[0]! <= now - 120_000) {
        timestamps.shift();
      }
      if (timestamps.length === 0) {
        this.buckets.delete(key);
      }
    }
  }

  /** Visible for testing */
  get bucketCount(): number {
    return this.buckets.size;
  }
}
