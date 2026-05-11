import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import {
  HttpRateLimiter,
  deriveRateLimitKey,
  type HttpRateLimitTier,
} from "./httpRateLimit.js";

// ── Test helpers ──────────────────────────────────────────────────────────
// Build minimal mock req/res for middleware tests. We don't pull in
// supertest because we only test the middleware in isolation — nothing
// downstream gets called. Picks up `req.headers.authorization` and
// `req.ip` which is everything the middleware reads.

interface MockReqOptions {
  path: string;
  ip?: string;
  authorization?: string;
}

function makeReq(opts: MockReqOptions): Request {
  return {
    path: opts.path,
    ip: opts.ip ?? "203.0.113.42", // RFC 5737 documentation range (not localhost)
    socket: { remoteAddress: opts.ip ?? "203.0.113.42" },
    headers: opts.authorization
      ? { authorization: opts.authorization }
      : {},
  } as unknown as Request;
}

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  /** Cached so chained calls (res.status().json()) compose correctly. */
  ended: boolean;
}

function makeRes(): { res: Response; tracked: MockRes } {
  const tracked: MockRes = {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
  };
  const res = {
    set(field: string | Record<string, string>, value?: string) {
      if (typeof field === "string") {
        tracked.headers[field] = value ?? "";
      } else {
        for (const [k, v] of Object.entries(field)) tracked.headers[k] = v;
      }
      return this;
    },
    status(code: number) {
      tracked.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      tracked.body = payload;
      tracked.ended = true;
      return this;
    },
  } as unknown as Response;
  return { res, tracked };
}

function makeNext(): { next: NextFunction; called: () => boolean } {
  let count = 0;
  const next: NextFunction = () => {
    count += 1;
  };
  return { next, called: () => count > 0 };
}

describe("HttpRateLimiter", () => {
  const tiers: HttpRateLimitTier[] = [
    { prefix: "/api/auth/login", config: { windowMs: 60_000, maxRequests: 3 } },
    { prefix: "/api/auth",       config: { windowMs: 60_000, maxRequests: 10 } },
    { prefix: "/api/",           config: { windowMs: 60_000, maxRequests: 50 } },
  ];

  it("resolves the longest matching prefix", () => {
    const limiter = new HttpRateLimiter(tiers);
    const loginConfig = limiter.resolveConfig("/api/auth/login");
    assert.equal(loginConfig?.maxRequests, 3);

    const authConfig = limiter.resolveConfig("/api/auth/me");
    assert.equal(authConfig?.maxRequests, 10);

    const generalConfig = limiter.resolveConfig("/api/games");
    assert.equal(generalConfig?.maxRequests, 50);
  });

  it("returns undefined for non-matching paths", () => {
    const limiter = new HttpRateLimiter(tiers);
    const config = limiter.resolveConfig("/health");
    assert.equal(config, undefined);
  });

  it("allows requests within the limit", () => {
    const limiter = new HttpRateLimiter(tiers);
    const config = { windowMs: 60_000, maxRequests: 3 };
    const now = 100_000;

    assert.equal(limiter.check("ip1:/api/auth/login", config, now).allowed, true);
    assert.equal(limiter.check("ip1:/api/auth/login", config, now + 1).allowed, true);
    assert.equal(limiter.check("ip1:/api/auth/login", config, now + 2).allowed, true);
  });

  it("blocks requests exceeding the limit", () => {
    const limiter = new HttpRateLimiter(tiers);
    const config = { windowMs: 60_000, maxRequests: 3 };
    const now = 100_000;

    limiter.check("ip2:/api/auth/login", config, now);
    limiter.check("ip2:/api/auth/login", config, now + 1);
    limiter.check("ip2:/api/auth/login", config, now + 2);

    const result = limiter.check("ip2:/api/auth/login", config, now + 3);
    assert.equal(result.allowed, false);
    assert.ok(result.retryAfterMs! > 0);
  });

  it("allows requests again after window expires", () => {
    const limiter = new HttpRateLimiter(tiers);
    const config = { windowMs: 10_000, maxRequests: 2 };
    const now = 100_000;

    limiter.check("ip3:/test", config, now);
    limiter.check("ip3:/test", config, now + 1);
    assert.equal(limiter.check("ip3:/test", config, now + 2).allowed, false);

    // After window expires
    assert.equal(limiter.check("ip3:/test", config, now + 10_001).allowed, true);
  });

  it("tracks different IPs independently", () => {
    const limiter = new HttpRateLimiter(tiers);
    const config = { windowMs: 60_000, maxRequests: 1 };

    assert.equal(limiter.check("ip-a:/api/auth/login", config).allowed, true);
    assert.equal(limiter.check("ip-b:/api/auth/login", config).allowed, true);

    // ip-a is now blocked, ip-b still has capacity (also blocked at 1)
    assert.equal(limiter.check("ip-a:/api/auth/login", config).allowed, false);
    assert.equal(limiter.check("ip-b:/api/auth/login", config).allowed, false);
  });

  it("provides a valid retryAfterMs when blocked", () => {
    const limiter = new HttpRateLimiter(tiers);
    const config = { windowMs: 30_000, maxRequests: 1 };
    const now = 100_000;

    limiter.check("ip4:/test", config, now);
    const result = limiter.check("ip4:/test", config, now + 5_000);

    assert.equal(result.allowed, false);
    // Oldest timestamp is at 100_000, window is 30_000, so retry at 130_000
    // Current time is 105_000, so retryAfterMs = 130_000 - 105_000 = 25_000
    assert.equal(result.retryAfterMs, 25_000);
  });

  it("uses default tiers when none provided", () => {
    const limiter = new HttpRateLimiter();
    const loginConfig = limiter.resolveConfig("/api/auth/login");
    assert.ok(loginConfig);
    assert.equal(loginConfig.maxRequests, 5); // default from DEFAULT_HTTP_RATE_LIMITS
  });

  it("admin routes resolve to the dedicated /api/admin tier with higher limit than the shared /api/ fallback", () => {
    // Regression guard for the rate-limit bug on /gameType/view/:id in admin-
    // web: the dashboard polls 6 endpoints every 10 s plus click-through traffic,
    // so admin routes need a higher limit than the general /api/ tier. If a
    // future change removes the /api/admin tier these asserts catch it before
    // production admins start seeing "For mange forespørsler".
    //
    // OPPDATERT 2026-05-11 (Tobias-bug): /api/ default hevet 300 → 1000 så
    // spillere ikke kastes ut etter 4 refresh. /api/admin fortsatt 600.
    // Admin tier kan nå være LAVERE enn /api/ default fordi spillere har
    // mer polling-aktivitet enn admin-konsollet. Test-assertions oppdatert.
    const limiter = new HttpRateLimiter();
    const gamesConfig = limiter.resolveConfig("/api/admin/games");
    assert.ok(gamesConfig);
    assert.ok(
      gamesConfig.maxRequests >= 600,
      `expected admin tier maxRequests >= 600, got ${gamesConfig.maxRequests}`
    );
    // Non-admin routes fall back to the shared /api/ tier (currently 1000/min).
    const walletConfig = limiter.resolveConfig("/api/wallet/me");
    assert.equal(walletConfig?.maxRequests, 1000);
  });

  // ── Per-user keying (2026-05-11) ────────────────────────────────────────
  //
  // Industry-standard tilnærming (Stripe/GitHub/Cloudflare). Autenticerte
  // routes nøkles på bearer-token-hash istedenfor IP — slik at 250 spillere
  // i samme bingohall bak én NAT-IP ikke deler bucket og låser hverandre ut.

  describe("deriveRateLimitKey — per-user vs per-IP keying", () => {
    it("derives a user-keyed bucket when Authorization Bearer header is present", () => {
      const req = makeReq({
        path: "/api/auth/me",
        ip: "10.0.0.1",
        authorization: "Bearer abc123secret",
      });
      const { key, mode } = deriveRateLimitKey(req, "/api/auth/me");
      assert.equal(mode, "user");
      assert.ok(key.startsWith("user:"), `expected user-prefix key, got ${key}`);
      assert.ok(key.endsWith(":/api/auth/me"));
      // 16-char hex hash + colons → expect ~user:[16hex]:/api/auth/me
      assert.match(key, /^user:[0-9a-f]{16}:\/api\/auth\/me$/);
    });

    it("derives different user-keys for different tokens (same IP)", () => {
      const reqA = makeReq({
        path: "/api/auth/me",
        ip: "10.0.0.1",
        authorization: "Bearer token-alpha",
      });
      const reqB = makeReq({
        path: "/api/auth/me",
        ip: "10.0.0.1",
        authorization: "Bearer token-beta",
      });
      const a = deriveRateLimitKey(reqA, "/api/auth/me");
      const b = deriveRateLimitKey(reqB, "/api/auth/me");
      assert.notEqual(a.key, b.key, "different tokens must yield different keys");
      assert.equal(a.mode, "user");
      assert.equal(b.mode, "user");
    });

    it("derives identical user-keys for the same token across different IPs", () => {
      // En spiller bytter wifi midt i en sesjon: ny IP, samme token →
      // samme bucket. Det er hele poenget med per-user-keying.
      const reqWifi = makeReq({
        path: "/api/auth/me",
        ip: "10.0.0.1",
        authorization: "Bearer same-token",
      });
      const reqMobile = makeReq({
        path: "/api/auth/me",
        ip: "203.0.113.99",
        authorization: "Bearer same-token",
      });
      const a = deriveRateLimitKey(reqWifi, "/api/auth/me");
      const b = deriveRateLimitKey(reqMobile, "/api/auth/me");
      assert.equal(a.key, b.key, "same token must yield same key regardless of IP");
    });

    it("falls back to IP-keying when Authorization header is missing", () => {
      const req = makeReq({
        path: "/api/auth/login",
        ip: "203.0.113.55",
        // No authorization header — anonymous request
      });
      const { key, mode } = deriveRateLimitKey(req, "/api/auth/login");
      assert.equal(mode, "ip");
      assert.equal(key, "ip:203.0.113.55:/api/auth/login");
    });

    it("falls back to IP-keying when Authorization is empty `Bearer `", () => {
      // Soft-fail: malformed bearer must not return 401 from this layer
      // (auth-middleware downstream owns that). Just bucket by IP.
      const req = makeReq({
        path: "/api/auth/me",
        ip: "203.0.113.55",
        authorization: "Bearer ",
      });
      const { key, mode } = deriveRateLimitKey(req, "/api/auth/me");
      assert.equal(mode, "ip");
      assert.equal(key, "ip:203.0.113.55:/api/auth/me");
    });

    it("falls back to IP-keying when Authorization scheme is not Bearer", () => {
      const req = makeReq({
        path: "/api/auth/me",
        ip: "203.0.113.55",
        authorization: "Basic dXNlcjpwYXNz", // base64("user:pass")
      });
      const { key, mode } = deriveRateLimitKey(req, "/api/auth/me");
      assert.equal(mode, "ip");
    });

    it("accepts case-insensitive Bearer scheme (RFC 6750)", () => {
      const lower = makeReq({
        path: "/api/auth/me",
        authorization: "bearer my-token-xyz",
      });
      const mixed = makeReq({
        path: "/api/auth/me",
        authorization: "BEARER my-token-xyz",
      });
      const canonical = makeReq({
        path: "/api/auth/me",
        authorization: "Bearer my-token-xyz",
      });
      const a = deriveRateLimitKey(lower, "/api/auth/me");
      const b = deriveRateLimitKey(mixed, "/api/auth/me");
      const c = deriveRateLimitKey(canonical, "/api/auth/me");
      assert.equal(a.key, c.key, "lowercase scheme must work");
      assert.equal(b.key, c.key, "uppercase scheme must work");
      assert.equal(a.mode, "user");
    });

    it("hashes the bearer token so the raw token never appears in the key", () => {
      const secretToken = "this-is-a-secret-session-token-9F8A7B6C5D4E3F2A1";
      const req = makeReq({
        path: "/api/auth/me",
        authorization: `Bearer ${secretToken}`,
      });
      const { key } = deriveRateLimitKey(req, "/api/auth/me");
      assert.ok(
        !key.includes(secretToken),
        `key must not contain the raw token: ${key}`
      );
      assert.ok(
        !key.includes("session-token"),
        `key must not contain any token substring`
      );
    });
  });

  describe("middleware — per-user vs per-IP keying", () => {
    it("isolates two users on the same IP into separate buckets", () => {
      // Reproduserer pilot-scenario: 250 spillere i bingohall bak NAT-IP
      // har hver sin token → hver sin bucket. Aldri ett kveler-de-andre.
      const limiter = new HttpRateLimiter([
        { prefix: "/api/auth/me", config: { windowMs: 60_000, maxRequests: 2 } },
      ]);
      const mw = limiter.middleware();
      const sharedIp = "203.0.113.10"; // same NAT-IP for both users

      // User A burns through their 2-request limit
      for (let i = 0; i < 2; i++) {
        const req = makeReq({
          path: "/api/auth/me",
          ip: sharedIp,
          authorization: "Bearer user-A-token",
        });
        const { res, tracked } = makeRes();
        const { next, called } = makeNext();
        mw(req, res, next);
        assert.equal(called(), true, `A-req-${i + 1} should be allowed`);
        assert.equal(tracked.statusCode, 200);
      }

      // User A's 3rd request is blocked (their bucket is full)
      {
        const req = makeReq({
          path: "/api/auth/me",
          ip: sharedIp,
          authorization: "Bearer user-A-token",
        });
        const { res, tracked } = makeRes();
        const { next, called } = makeNext();
        mw(req, res, next);
        assert.equal(called(), false, "A's 3rd request should be blocked");
        assert.equal(tracked.statusCode, 429);
      }

      // User B is on the same IP — still has full quota
      for (let i = 0; i < 2; i++) {
        const req = makeReq({
          path: "/api/auth/me",
          ip: sharedIp,
          authorization: "Bearer user-B-token",
        });
        const { res, tracked } = makeRes();
        const { next, called } = makeNext();
        mw(req, res, next);
        assert.equal(
          called(),
          true,
          `B-req-${i + 1} on same NAT-IP must NOT share bucket with A`
        );
        assert.equal(tracked.statusCode, 200);
      }
    });

    it("uses per-IP bucket for anonymous requests (login/register brute-force vern)", () => {
      // Anonymous requests have no Authorization header → bucket by IP.
      // This is the correct defense for /api/auth/login (brute-force).
      const limiter = new HttpRateLimiter([
        { prefix: "/api/auth/login", config: { windowMs: 60_000, maxRequests: 2 } },
      ]);
      const mw = limiter.middleware();

      // Same IP, no auth → all share the IP bucket
      const ip = "203.0.113.20";
      for (let i = 0; i < 2; i++) {
        const req = makeReq({ path: "/api/auth/login", ip });
        const { res } = makeRes();
        const { next, called } = makeNext();
        mw(req, res, next);
        assert.equal(called(), true);
      }

      // 3rd anonymous request from same IP → blocked (brute-force defense)
      {
        const req = makeReq({ path: "/api/auth/login", ip });
        const { res, tracked } = makeRes();
        const { next, called } = makeNext();
        mw(req, res, next);
        assert.equal(called(), false, "anonymous brute-force must hit IP-bucket");
        assert.equal(tracked.statusCode, 429);
      }
    });

    it("invalid Bearer falls back to per-IP, not 401 (soft-fail)", () => {
      // If the auth-header is malformed, we must NOT short-circuit with 401.
      // Auth-middleware downstream owns that. Rate-limit just falls back
      // to per-IP keying and continues.
      const limiter = new HttpRateLimiter([
        { prefix: "/api/auth/me", config: { windowMs: 60_000, maxRequests: 100 } },
      ]);
      const mw = limiter.middleware();
      const req = makeReq({
        path: "/api/auth/me",
        ip: "203.0.113.30",
        authorization: "Bearer", // missing token
      });
      const { res, tracked } = makeRes();
      const { next, called } = makeNext();
      mw(req, res, next);
      assert.equal(called(), true, "malformed Bearer must NOT return 401 from rate-limit");
      assert.notEqual(tracked.statusCode, 401);
    });
  });

  describe("middleware — bypasses", () => {
    it("bypasses entirely when HTTP_RATE_LIMIT_DISABLED=true", () => {
      const original = process.env["HTTP_RATE_LIMIT_DISABLED"];
      process.env["HTTP_RATE_LIMIT_DISABLED"] = "true";
      try {
        const limiter = new HttpRateLimiter([
          { prefix: "/api/", config: { windowMs: 60_000, maxRequests: 1 } },
        ]);
        const mw = limiter.middleware();

        // Hammer the same key 10× — should all pass thanks to env-bypass.
        for (let i = 0; i < 10; i++) {
          const req = makeReq({
            path: "/api/auth/me",
            ip: "203.0.113.40",
            authorization: "Bearer some-token",
          });
          const { res, tracked } = makeRes();
          const { next, called } = makeNext();
          mw(req, res, next);
          assert.equal(called(), true, `iteration ${i}: env-bypass should allow`);
          // No rate-limit headers when fully bypassed
          assert.equal(tracked.headers["X-RateLimit-Limit"], undefined);
        }
      } finally {
        if (original === undefined) delete process.env["HTTP_RATE_LIMIT_DISABLED"];
        else process.env["HTTP_RATE_LIMIT_DISABLED"] = original;
      }
    });

    it("bypasses localhost IPv6 (::1)", () => {
      const original = process.env["HTTP_RATE_LIMIT_DISABLED"];
      delete process.env["HTTP_RATE_LIMIT_DISABLED"];
      try {
        const limiter = new HttpRateLimiter([
          { prefix: "/api/", config: { windowMs: 60_000, maxRequests: 1 } },
        ]);
        const mw = limiter.middleware();
        for (let i = 0; i < 5; i++) {
          const req = makeReq({ path: "/api/auth/me", ip: "::1" });
          const { res, tracked } = makeRes();
          const { next, called } = makeNext();
          mw(req, res, next);
          assert.equal(called(), true, `iteration ${i}: ::1 must bypass`);
          // No rate-limit headers when fully bypassed
          assert.equal(tracked.headers["X-RateLimit-Limit"], undefined);
        }
      } finally {
        if (original !== undefined) process.env["HTTP_RATE_LIMIT_DISABLED"] = original;
      }
    });

    it("bypasses localhost IPv4 (127.0.0.1)", () => {
      const original = process.env["HTTP_RATE_LIMIT_DISABLED"];
      delete process.env["HTTP_RATE_LIMIT_DISABLED"];
      try {
        const limiter = new HttpRateLimiter([
          { prefix: "/api/", config: { windowMs: 60_000, maxRequests: 1 } },
        ]);
        const mw = limiter.middleware();
        for (let i = 0; i < 5; i++) {
          const req = makeReq({ path: "/api/auth/me", ip: "127.0.0.1" });
          const { res } = makeRes();
          const { next, called } = makeNext();
          mw(req, res, next);
          assert.equal(called(), true, `127.0.0.1 must bypass`);
        }
      } finally {
        if (original !== undefined) process.env["HTTP_RATE_LIMIT_DISABLED"] = original;
      }
    });

    it("bypasses IPv4-mapped IPv6 localhost (::ffff:127.0.0.1)", () => {
      const original = process.env["HTTP_RATE_LIMIT_DISABLED"];
      delete process.env["HTTP_RATE_LIMIT_DISABLED"];
      try {
        const limiter = new HttpRateLimiter([
          { prefix: "/api/", config: { windowMs: 60_000, maxRequests: 1 } },
        ]);
        const mw = limiter.middleware();
        for (let i = 0; i < 5; i++) {
          const req = makeReq({
            path: "/api/auth/me",
            ip: "::ffff:127.0.0.1",
          });
          const { res } = makeRes();
          const { next, called } = makeNext();
          mw(req, res, next);
          assert.equal(called(), true, `::ffff:127.0.0.1 must bypass`);
        }
      } finally {
        if (original !== undefined) process.env["HTTP_RATE_LIMIT_DISABLED"] = original;
      }
    });
  });

  describe("middleware — X-RateLimit-* response headers", () => {
    it("sets X-RateLimit-Limit, -Remaining and -Reset on 200 OK", () => {
      const original = process.env["HTTP_RATE_LIMIT_DISABLED"];
      delete process.env["HTTP_RATE_LIMIT_DISABLED"];
      try {
        const limiter = new HttpRateLimiter([
          { prefix: "/api/auth/me", config: { windowMs: 60_000, maxRequests: 5 } },
        ]);
        const mw = limiter.middleware();
        const req = makeReq({
          path: "/api/auth/me",
          ip: "203.0.113.50",
          authorization: "Bearer user-token",
        });
        const { res, tracked } = makeRes();
        const { next, called } = makeNext();
        mw(req, res, next);

        assert.equal(called(), true);
        assert.equal(tracked.headers["X-RateLimit-Limit"], "5");
        // First request → 4 remaining
        assert.equal(tracked.headers["X-RateLimit-Remaining"], "4");
        // Reset should be a unix-epoch-seconds-string (10 digits)
        assert.ok(tracked.headers["X-RateLimit-Reset"]);
        const reset = Number(tracked.headers["X-RateLimit-Reset"]);
        assert.ok(Number.isFinite(reset) && reset > 0);
        // Reset should be approximately now + 60s (windowMs) — give 5s slop
        const nowSec = Date.now() / 1000;
        assert.ok(reset >= nowSec + 55, `reset ${reset} should be ~now+60s, now=${nowSec}`);
        assert.ok(reset <= nowSec + 65, `reset ${reset} should be ~now+60s, now=${nowSec}`);
      } finally {
        if (original !== undefined) process.env["HTTP_RATE_LIMIT_DISABLED"] = original;
      }
    });

    it("X-RateLimit-Remaining decrements with each call", () => {
      const original = process.env["HTTP_RATE_LIMIT_DISABLED"];
      delete process.env["HTTP_RATE_LIMIT_DISABLED"];
      try {
        const limiter = new HttpRateLimiter([
          { prefix: "/api/auth/me", config: { windowMs: 60_000, maxRequests: 3 } },
        ]);
        const mw = limiter.middleware();
        const expected = [2, 1, 0];
        for (let i = 0; i < 3; i++) {
          const req = makeReq({
            path: "/api/auth/me",
            ip: "203.0.113.51",
            authorization: "Bearer same-token",
          });
          const { res, tracked } = makeRes();
          const { next } = makeNext();
          mw(req, res, next);
          assert.equal(
            tracked.headers["X-RateLimit-Remaining"],
            String(expected[i]),
            `request ${i + 1} should have remaining=${expected[i]}`
          );
        }
      } finally {
        if (original !== undefined) process.env["HTTP_RATE_LIMIT_DISABLED"] = original;
      }
    });

    it("sets X-RateLimit-* AND Retry-After on 429", () => {
      const original = process.env["HTTP_RATE_LIMIT_DISABLED"];
      delete process.env["HTTP_RATE_LIMIT_DISABLED"];
      try {
        const limiter = new HttpRateLimiter([
          { prefix: "/api/auth/me", config: { windowMs: 60_000, maxRequests: 1 } },
        ]);
        const mw = limiter.middleware();

        // Burn the 1 allowed request
        {
          const req = makeReq({
            path: "/api/auth/me",
            ip: "203.0.113.60",
            authorization: "Bearer t",
          });
          const { res } = makeRes();
          const { next } = makeNext();
          mw(req, res, next);
        }

        // 2nd hit → blocked
        const req = makeReq({
          path: "/api/auth/me",
          ip: "203.0.113.60",
          authorization: "Bearer t",
        });
        const { res, tracked } = makeRes();
        const { next, called } = makeNext();
        mw(req, res, next);
        assert.equal(called(), false);
        assert.equal(tracked.statusCode, 429);
        // X-RateLimit-* must still be set on 429 (industry-standard)
        assert.equal(tracked.headers["X-RateLimit-Limit"], "1");
        assert.equal(tracked.headers["X-RateLimit-Remaining"], "0");
        assert.ok(tracked.headers["X-RateLimit-Reset"]);
        // Retry-After is only set on 429
        assert.ok(tracked.headers["Retry-After"]);
        assert.match(tracked.headers["Retry-After"]!, /^\d+$/);
      } finally {
        if (original !== undefined) process.env["HTTP_RATE_LIMIT_DISABLED"] = original;
      }
    });
  });

  describe("check() — backward-compat extended return shape", () => {
    it("returns current/limit/resetAtMs on allowed requests", () => {
      const limiter = new HttpRateLimiter([]);
      const config = { windowMs: 60_000, maxRequests: 5 };
      const now = 1_000_000;
      const r = limiter.check("test-key", config, now);
      assert.equal(r.allowed, true);
      assert.equal(r.current, 1);
      assert.equal(r.limit, 5);
      assert.equal(r.resetAtMs, now + 60_000);
    });

    it("returns current/limit/resetAtMs on blocked requests", () => {
      const limiter = new HttpRateLimiter([]);
      const config = { windowMs: 30_000, maxRequests: 2 };
      const now = 1_000_000;
      limiter.check("test-key", config, now);
      limiter.check("test-key", config, now + 100);
      const r = limiter.check("test-key", config, now + 200);
      assert.equal(r.allowed, false);
      assert.equal(r.current, 2);
      assert.equal(r.limit, 2);
      assert.equal(r.resetAtMs, now + 30_000); // oldest timestamp expires
      assert.ok(r.retryAfterMs! > 0);
    });
  });
});
