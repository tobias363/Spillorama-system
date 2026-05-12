/**
 * BIN-277: Per-route sliding-window rate limiter for Express REST endpoints.
 *
 * Tracks requests by IP (or authenticated user when available). Each route
 * prefix can have its own limit. Stale entries are garbage-collected
 * periodically to prevent memory leaks.
 */

import type { Request, Response, NextFunction } from "express";

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
   * Check whether a request is allowed.
   * Returns { allowed, retryAfterMs } — retryAfterMs is set when blocked.
   */
  check(
    key: string,
    config: HttpRateLimitConfig,
    nowMs: number = Date.now()
  ): { allowed: boolean; retryAfterMs?: number } {
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

    if (timestamps.length >= config.maxRequests) {
      const oldestInWindow = timestamps[0];
      const retryAfterMs = oldestInWindow + config.windowMs - nowMs;
      return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000) };
    }

    timestamps.push(nowMs);
    return { allowed: true };
  }

  /** Express middleware factory */
  middleware(): (req: Request, res: Response, next: NextFunction) => void {
    return (req: Request, res: Response, next: NextFunction) => {
      // Tobias-direktiv 2026-05-12: dev-stack ratelimits seg selv. NODE_ENV != production
      // → bypass globalt (canary 2026-05-12 oppdaget at publicGameHealth.ts hadde sin
      // egen rate-limiter, den er nå også scoped til /api/games/spill*).
      if ((process.env["NODE_ENV"] ?? "").trim().toLowerCase() !== "production") {
        return next();
      }
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
      //   3. Default per-IP sliding window — eneste mode i prod.
      // Tobias-direktiv 2026-05-12 (akutt): dev-stack ratelimits seg selv
      // når NODE_ENV != production. Tidligere bypass via env-flag + localhost-
      // check var brutt fordi `req.ip` ikke alltid er "::1"/"127.0.0.1"
      // selv for connections fra loopback (avhenger av Host-header,
      // dual-stack-listening, og X-Forwarded-For-håndtering i trust-proxy:true).
      // Forenklet til: hvis ikke prod → ALWAYS bypass. Trygt fordi rate-limit
      // i dev/staging er mot tester-team, ikke spillere.
      const isProductionEnv =
        (process.env["NODE_ENV"] ?? "").trim().toLowerCase() === "production";
      if (
        !isProductionEnv ||
        process.env["HTTP_RATE_LIMIT_DISABLED"] === "true"
      ) {
        return next();
      }

      const config = this.resolveConfig(req.path);
      if (!config) return next();

      // Key: IP + path prefix for the matching tier
      const ip = req.ip || req.socket.remoteAddress || "unknown";

      // Localhost-bypass: prod (Render) kjører bak proxy, så ::1/127.0.0.1
      // betyr aldri spiller-trafikk i prod. Beholdes for defense-in-depth.
      if (ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1") {
        return next();
      }

      const tierPrefix = this.tiers.find((t) => req.path.startsWith(t.prefix))?.prefix ?? req.path;
      const key = `${ip}:${tierPrefix}`;

      const result = this.check(key, config);
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
      while (timestamps.length > 0 && timestamps[0] <= now - 120_000) {
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
