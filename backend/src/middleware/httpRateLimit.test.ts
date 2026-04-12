import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HttpRateLimiter, type HttpRateLimitTier } from "./httpRateLimit.js";

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
});
