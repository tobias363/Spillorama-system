/**
 * Tester for `createResponseCacheMiddleware`.
 *
 * Dekker:
 *  - Cache miss → handler kjører → response cached → X-Cache: MISS
 *  - Cache hit → handler skip → cached body serveres → X-Cache: HIT
 *  - Non-GET (POST/PUT/DELETE) → bypass cache
 *  - Auth-guarded (default): manglende Authorization-header → bypass cache
 *  - `allowAnonymous=true` → cache for offentlige endpoints uten auth
 *  - `perUser=true` → forskjellige auth-tokens får forskjellig cache-entry
 *  - Non-200 status → IKKE cached
 *  - Redis GET-feil → fail-soft, kjør handler
 *  - Redis SET-feil → fail-soft, response sendes uansett
 *  - Cache-Control header settes på både HIT og MISS
 *  - TTL respekteres (mock kontrollerer EX-arg + intern timer)
 *  - Stable cache-key på tvers av query-rekkefølge
 *  - Cached payload som ikke parses → fall gjennom til handler
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";
import { EventEmitter } from "node:events";
import {
  createResponseCacheMiddleware,
  type RedisLike,
} from "./httpResponseCache.js";

// ── In-memory Redis mock ──────────────────────────────────────────────────

interface MockRedisOptions {
  /** Hvis satt, kaster `get` denne feilen. */
  getError?: Error;
  /** Hvis satt, kaster `set` denne feilen. */
  setError?: Error;
}

interface MockRedis extends RedisLike {
  data: Map<string, { value: string; expiresAtMs: number }>;
  getCalls: string[];
  setCalls: Array<{ key: string; value: string; ttlSec: number }>;
}

function makeMockRedis(opts: MockRedisOptions = {}): MockRedis {
  const data = new Map<string, { value: string; expiresAtMs: number }>();
  const getCalls: string[] = [];
  const setCalls: Array<{ key: string; value: string; ttlSec: number }> = [];

  return {
    data,
    getCalls,
    setCalls,
    async get(key: string): Promise<string | null> {
      if (opts.getError) throw opts.getError;
      getCalls.push(key);
      const entry = data.get(key);
      if (!entry) return null;
      if (entry.expiresAtMs <= Date.now()) {
        data.delete(key);
        return null;
      }
      return entry.value;
    },
    async set(
      key: string,
      value: string,
      mode?: string,
      duration?: number,
    ): Promise<unknown> {
      if (opts.setError) throw opts.setError;
      const ttl = mode === "EX" && typeof duration === "number" ? duration : 0;
      setCalls.push({ key, value, ttlSec: ttl });
      data.set(key, {
        value,
        expiresAtMs: Date.now() + ttl * 1000,
      });
      return "OK";
    },
  };
}

// ── Test-fixtures: minimal Express req/res-shim ───────────────────────────

interface TestReqOpts {
  method?: string;
  path?: string;
  query?: Record<string, string | string[]>;
  authHeader?: string;
}

function makeReq(opts: TestReqOpts = {}): Request {
  const headers: Record<string, string> = {};
  if (opts.authHeader !== undefined) {
    headers.authorization = opts.authHeader;
  }
  return {
    method: opts.method ?? "GET",
    path: opts.path ?? "/api/games/status",
    query: opts.query ?? {},
    headers,
  } as unknown as Request;
}

interface TestRes extends EventEmitter {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  jsonBody: unknown;
  rawSent: unknown;
  status: (code: number) => TestRes;
  json: (body: unknown) => TestRes;
  send: (body: unknown) => TestRes;
  setHeader: (name: string, value: string) => void;
  getHeader: (name: string) => string | undefined;
  finish: () => void;
}

function makeRes(): Response & TestRes {
  const emitter = new EventEmitter() as TestRes;
  emitter.statusCode = 200;
  emitter.headers = {};
  emitter.body = undefined;
  emitter.jsonBody = undefined;
  emitter.rawSent = undefined;

  emitter.status = function (code: number) {
    this.statusCode = code;
    return this;
  };
  emitter.json = function (body: unknown) {
    this.jsonBody = body;
    this.body = body;
    return this;
  };
  emitter.send = function (body: unknown) {
    this.rawSent = body;
    if (this.body === undefined) this.body = body;
    return this;
  };
  emitter.setHeader = function (name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  };
  emitter.getHeader = function (name: string) {
    return this.headers[name.toLowerCase()];
  };
  emitter.finish = function () {
    this.emit("finish");
  };

  return emitter as Response & TestRes;
}

function makeNext(): NextFunction & { called: boolean; calledWith?: unknown } {
  const fn = function next(err?: unknown) {
    (fn as { called: boolean; calledWith?: unknown }).called = true;
    (fn as { called: boolean; calledWith?: unknown }).calledWith = err;
  } as NextFunction & { called: boolean; calledWith?: unknown };
  fn.called = false;
  return fn;
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("cache miss: handler runs, response cached, X-Cache: MISS", async () => {
  const redis = makeMockRedis();
  const middleware = createResponseCacheMiddleware({ redis, ttlSeconds: 30 });

  const req = makeReq({ authHeader: "Bearer abc" });
  const res = makeRes();
  const next = makeNext();

  await middleware(req, res, next);

  assert.equal(next.called, true, "next() should be called on cache miss");
  assert.equal(res.headers["x-cache"], "MISS");
  assert.equal(redis.getCalls.length, 1, "Redis GET should be called once");

  // Simulate handler running and calling res.json with status 200
  res.statusCode = 200;
  res.json({ data: [{ slug: "bingo", status: "OPEN" }] });
  res.finish();

  // Wait microtask for redis.set fire-and-forget
  await new Promise((r) => setImmediate(r));

  assert.equal(redis.setCalls.length, 1, "Redis SET should be called once");
  assert.equal(redis.setCalls[0].ttlSec, 30);
});

test("cache hit: handler skipped, cached body served, X-Cache: HIT", async () => {
  const redis = makeMockRedis();
  const middleware = createResponseCacheMiddleware({ redis, ttlSeconds: 30 });

  // Prime cache with valid payload
  const cachedPayload = JSON.stringify({
    body: { data: [{ slug: "rocket", status: "OPEN" }] },
    contentType: "application/json; charset=utf-8",
    statusCode: 200,
    cachedAtMs: Date.now(),
  });
  await redis.set(
    `httpcache:v1:GET:/api/games/status`,
    cachedPayload,
    "EX",
    30,
  );

  const req = makeReq({ authHeader: "Bearer abc" });
  const res = makeRes();
  const next = makeNext();

  await middleware(req, res, next);

  assert.equal(next.called, false, "next() should NOT be called on cache hit");
  assert.equal(res.headers["x-cache"], "HIT");
  assert.equal(res.statusCode, 200);
  // Body skal være streng-serialisert JSON sendt via res.send()
  assert.ok(res.rawSent);
  const sent = JSON.parse(String(res.rawSent)) as { data: unknown };
  assert.deepEqual(sent, { data: [{ slug: "rocket", status: "OPEN" }] });
});

test("non-GET request bypasses cache", async () => {
  const redis = makeMockRedis();
  const middleware = createResponseCacheMiddleware({ redis, ttlSeconds: 30 });

  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    const req = makeReq({ method, authHeader: "Bearer abc" });
    const res = makeRes();
    const next = makeNext();

    await middleware(req, res, next);

    assert.equal(next.called, true, `${method} should bypass to next()`);
  }
  assert.equal(
    redis.getCalls.length,
    0,
    "Redis GET should never fire on non-GET",
  );
});

test("missing Authorization header bypasses cache (defense-in-depth)", async () => {
  const redis = makeMockRedis();
  const middleware = createResponseCacheMiddleware({ redis, ttlSeconds: 30 });

  // Prime cache som om noen tidligere fikk 200
  await redis.set(
    `httpcache:v1:GET:/api/games/status`,
    JSON.stringify({
      body: { data: "secret-data" },
      contentType: "application/json; charset=utf-8",
      statusCode: 200,
      cachedAtMs: Date.now(),
    }),
    "EX",
    30,
  );

  // Request UTEN Authorization-header
  const req = makeReq({ authHeader: undefined });
  const res = makeRes();
  const next = makeNext();

  await middleware(req, res, next);

  assert.equal(
    next.called,
    true,
    "anonymous request should NOT be served from cache — must pass through to handler so 401 fires",
  );
  // Vi MÅ ikke ha lest fra cache i det hele tatt — Redis.get bør ikke vært kalt
  assert.equal(
    redis.getCalls.length,
    0,
    "Redis GET should not be called when auth header missing and allowAnonymous=false",
  );
});

test("allowAnonymous=true: anonymous requests can hit cache", async () => {
  const redis = makeMockRedis();
  const middleware = createResponseCacheMiddleware({
    redis,
    ttlSeconds: 60,
    allowAnonymous: true,
  });

  const req = makeReq({
    path: "/api/halls/abc-123/client-variant",
    authHeader: undefined,
  });
  const res = makeRes();
  const next = makeNext();

  await middleware(req, res, next);

  // Cache miss: next() kjører
  assert.equal(next.called, true);
  assert.equal(res.headers["x-cache"], "MISS");
  // Redis.get SKAL ha vært kalt selv uten auth
  assert.equal(redis.getCalls.length, 1);

  // Simulate handler runs
  res.statusCode = 200;
  res.json({ data: { clientVariant: "web" } });
  res.finish();

  await new Promise((r) => setImmediate(r));

  // Andre request — cache hit
  const req2 = makeReq({
    path: "/api/halls/abc-123/client-variant",
    authHeader: undefined,
  });
  const res2 = makeRes();
  const next2 = makeNext();

  await middleware(req2, res2, next2);

  assert.equal(next2.called, false);
  assert.equal(res2.headers["x-cache"], "HIT");
});

test("perUser=true: different auth tokens get different cache entries", async () => {
  const redis = makeMockRedis();
  const middleware = createResponseCacheMiddleware({
    redis,
    ttlSeconds: 30,
    perUser: true,
  });

  // Bruker A
  const reqA = makeReq({ authHeader: "Bearer token-A" });
  const resA = makeRes();
  const nextA = makeNext();
  await middleware(reqA, resA, nextA);
  resA.statusCode = 200;
  resA.json({ data: "user-A-payload" });
  resA.finish();
  await new Promise((r) => setImmediate(r));

  // Bruker B — skal IKKE få As cache
  const reqB = makeReq({ authHeader: "Bearer token-B" });
  const resB = makeRes();
  const nextB = makeNext();
  await middleware(reqB, resB, nextB);

  assert.equal(nextB.called, true, "user B should see cache miss");
  assert.equal(resB.headers["x-cache"], "MISS");

  // Begge skal være cached separat
  resB.statusCode = 200;
  resB.json({ data: "user-B-payload" });
  resB.finish();
  await new Promise((r) => setImmediate(r));

  assert.equal(redis.setCalls.length, 2);
  const keys = redis.setCalls.map((c) => c.key);
  assert.notEqual(keys[0], keys[1], "cache keys for user A and B should differ");

  // Re-request bruker A — skal nå hit cache
  const reqA2 = makeReq({ authHeader: "Bearer token-A" });
  const resA2 = makeRes();
  const nextA2 = makeNext();
  await middleware(reqA2, resA2, nextA2);

  assert.equal(nextA2.called, false);
  assert.equal(resA2.headers["x-cache"], "HIT");
  const sent = JSON.parse(String(resA2.rawSent));
  assert.deepEqual(sent, { data: "user-A-payload" });
});

test("non-200 status responses are NOT cached", async () => {
  const redis = makeMockRedis();
  const middleware = createResponseCacheMiddleware({ redis, ttlSeconds: 30 });

  const req = makeReq({ authHeader: "Bearer abc" });
  const res = makeRes();
  const next = makeNext();

  await middleware(req, res, next);

  // Simulate handler returning 401
  res.statusCode = 401;
  res.json({ ok: false, error: { code: "UNAUTHORIZED" } });
  res.finish();

  await new Promise((r) => setImmediate(r));

  assert.equal(
    redis.setCalls.length,
    0,
    "Redis SET should not fire for 401 response",
  );
});

test("Redis GET error: fail-soft, handler runs", async () => {
  const redis = makeMockRedis({ getError: new Error("ECONNREFUSED") });
  const middleware = createResponseCacheMiddleware({ redis, ttlSeconds: 30 });

  const req = makeReq({ authHeader: "Bearer abc" });
  const res = makeRes();
  const next = makeNext();

  // Capture console.error
  const origError = console.error;
  const logs: unknown[][] = [];
  console.error = (...args: unknown[]) => logs.push(args);

  try {
    await middleware(req, res, next);
  } finally {
    console.error = origError;
  }

  assert.equal(next.called, true, "next() must be called when Redis GET fails");
  // X-Cache satt til MISS — fall gjennom til miss-path
  assert.equal(res.headers["x-cache"], "MISS");
  // Error skal være logget
  assert.ok(logs.length >= 1);
});

test("Redis SET error: response still sent, error logged", async () => {
  const redis = makeMockRedis({ setError: new Error("ECONNREFUSED") });
  const middleware = createResponseCacheMiddleware({ redis, ttlSeconds: 30 });

  const req = makeReq({ authHeader: "Bearer abc" });
  const res = makeRes();
  const next = makeNext();

  const origError = console.error;
  const logs: unknown[][] = [];
  console.error = (...args: unknown[]) => logs.push(args);

  try {
    await middleware(req, res, next);
    assert.equal(next.called, true);

    res.statusCode = 200;
    res.json({ data: "test" });
    res.finish();

    // La SET-feilen propagere
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  } finally {
    console.error = origError;
  }

  // Response gikk OK; error skal være logget
  assert.deepEqual(res.body, { data: "test" });
  assert.ok(
    logs.some((l) => String(l[0]).includes("redis SET error")),
    "should log SET error",
  );
});

test("Cache-Control header set on both HIT and MISS", async () => {
  const redis = makeMockRedis();
  const middleware = createResponseCacheMiddleware({ redis, ttlSeconds: 45 });

  // MISS
  const reqMiss = makeReq({ authHeader: "Bearer abc" });
  const resMiss = makeRes();
  const nextMiss = makeNext();
  await middleware(reqMiss, resMiss, nextMiss);

  assert.equal(
    resMiss.headers["cache-control"],
    "public, max-age=45, must-revalidate",
  );

  // Prime + HIT
  resMiss.statusCode = 200;
  resMiss.json({ data: "x" });
  resMiss.finish();
  await new Promise((r) => setImmediate(r));

  const reqHit = makeReq({ authHeader: "Bearer abc" });
  const resHit = makeRes();
  const nextHit = makeNext();
  await middleware(reqHit, resHit, nextHit);

  assert.equal(
    resHit.headers["cache-control"],
    "public, max-age=45, must-revalidate",
  );
});

test("perUser=true: Cache-Control is private", async () => {
  const redis = makeMockRedis();
  const middleware = createResponseCacheMiddleware({
    redis,
    ttlSeconds: 30,
    perUser: true,
  });

  const req = makeReq({ authHeader: "Bearer xyz" });
  const res = makeRes();
  const next = makeNext();
  await middleware(req, res, next);

  assert.equal(res.headers["cache-control"], "private, max-age=30");
});

test("TTL: cached entry expires after ttlSeconds", async () => {
  const redis = makeMockRedis();
  const middleware = createResponseCacheMiddleware({ redis, ttlSeconds: 1 });

  // Prime cache
  const req1 = makeReq({ authHeader: "Bearer abc" });
  const res1 = makeRes();
  const next1 = makeNext();
  await middleware(req1, res1, next1);
  res1.statusCode = 200;
  res1.json({ data: "fresh" });
  res1.finish();
  await new Promise((r) => setImmediate(r));

  // Lure mock-en til å tro at TTL er passert
  const key = redis.setCalls[0].key;
  const entry = redis.data.get(key);
  assert.ok(entry);
  entry.expiresAtMs = Date.now() - 100; // expired 100ms ago

  // Second request — should miss (expired)
  const req2 = makeReq({ authHeader: "Bearer abc" });
  const res2 = makeRes();
  const next2 = makeNext();
  await middleware(req2, res2, next2);

  assert.equal(next2.called, true, "expired entry should result in MISS");
  assert.equal(res2.headers["x-cache"], "MISS");
});

test("stable cache key across query parameter ordering", async () => {
  const redis = makeMockRedis();
  const middleware = createResponseCacheMiddleware({ redis, ttlSeconds: 30 });

  // Request 1 with query a=1, b=2
  const req1 = makeReq({
    authHeader: "Bearer abc",
    query: { a: "1", b: "2" },
  });
  const res1 = makeRes();
  const next1 = makeNext();
  await middleware(req1, res1, next1);
  res1.statusCode = 200;
  res1.json({ data: "stable" });
  res1.finish();
  await new Promise((r) => setImmediate(r));

  // Request 2 with query b=2, a=1 (different insertion order)
  const req2 = makeReq({
    authHeader: "Bearer abc",
    query: { b: "2", a: "1" },
  });
  const res2 = makeRes();
  const next2 = makeNext();
  await middleware(req2, res2, next2);

  assert.equal(next2.called, false, "should hit cache regardless of query order");
  assert.equal(res2.headers["x-cache"], "HIT");
});

test("corrupted cached body falls through to handler", async () => {
  const redis = makeMockRedis();
  const middleware = createResponseCacheMiddleware({ redis, ttlSeconds: 30 });

  // Prime cache with INVALID JSON
  await redis.set(
    `httpcache:v1:GET:/api/games/status`,
    "{not valid json",
    "EX",
    30,
  );

  const req = makeReq({ authHeader: "Bearer abc" });
  const res = makeRes();
  const next = makeNext();

  const origError = console.error;
  const logs: unknown[][] = [];
  console.error = (...args: unknown[]) => logs.push(args);

  try {
    await middleware(req, res, next);
  } finally {
    console.error = origError;
  }

  assert.equal(
    next.called,
    true,
    "corrupted cache should fall through to handler",
  );
  assert.equal(res.headers["x-cache"], "MISS");
  assert.ok(
    logs.some((l) => String(l[0]).includes("parse cached body")),
    "should log parse error",
  );
});

test("custom keyDeriver is respected", async () => {
  const redis = makeMockRedis();
  const middleware = createResponseCacheMiddleware({
    redis,
    ttlSeconds: 30,
    keyDeriver: (req) => `custom:${req.path}`,
  });

  const req = makeReq({ authHeader: "Bearer abc", path: "/foo" });
  const res = makeRes();
  const next = makeNext();
  await middleware(req, res, next);
  res.statusCode = 200;
  res.json({ data: "x" });
  res.finish();
  await new Promise((r) => setImmediate(r));

  assert.equal(redis.setCalls.length, 1);
  assert.equal(redis.setCalls[0].key, "httpcache:v1:custom:/foo");
});

test("custom version invalidates older cache", async () => {
  const redis = makeMockRedis();

  // Prime cache with v1
  const middlewareV1 = createResponseCacheMiddleware({
    redis,
    ttlSeconds: 30,
    version: "v1",
  });
  const req1 = makeReq({ authHeader: "Bearer abc" });
  const res1 = makeRes();
  const next1 = makeNext();
  await middlewareV1(req1, res1, next1);
  res1.statusCode = 200;
  res1.json({ data: "v1-payload" });
  res1.finish();
  await new Promise((r) => setImmediate(r));

  assert.equal(redis.setCalls[0].key.startsWith("httpcache:v1:"), true);

  // Bytt til v2 — skal IKKE finne v1-cache
  const middlewareV2 = createResponseCacheMiddleware({
    redis,
    ttlSeconds: 30,
    version: "v2",
  });
  const req2 = makeReq({ authHeader: "Bearer abc" });
  const res2 = makeRes();
  const next2 = makeNext();
  await middlewareV2(req2, res2, next2);

  assert.equal(next2.called, true, "v2 middleware should miss v1 cache");
});

test("baseUrl (Express mount-prefix) is included in cache key", async () => {
  // Når middleware er mountet via `app.use('/api/games/status', mw)` strippes
  // baseUrl fra req.path inne i handler. Default-deriveren skal lese baseUrl
  // og bygge full path så cache-key er korrekt.
  const redis = makeMockRedis();
  const middleware = createResponseCacheMiddleware({ redis, ttlSeconds: 30 });

  // Simulate Express mount-state: req.baseUrl satt, req.path strippet
  const reqMounted = makeReq({ authHeader: "Bearer abc", path: "/" });
  (reqMounted as unknown as { baseUrl: string }).baseUrl = "/api/games/status";
  const res = makeRes();
  const next = makeNext();
  await middleware(reqMounted, res, next);
  res.statusCode = 200;
  res.json({ data: "x" });
  res.finish();
  await new Promise((r) => setImmediate(r));

  assert.equal(redis.setCalls.length, 1);
  // Key skal inkludere full path (/api/games/status), ikke bare /
  const key = redis.setCalls[0].key;
  assert.ok(
    key.includes("/api/games/status"),
    `cache key should include mounted path: got ${key}`,
  );
});

test("throws if ttlSeconds <= 0", () => {
  const redis = makeMockRedis();
  assert.throws(
    () => createResponseCacheMiddleware({ redis, ttlSeconds: 0 }),
    /ttlSeconds must be > 0/,
  );
  assert.throws(
    () => createResponseCacheMiddleware({ redis, ttlSeconds: -1 }),
    /ttlSeconds must be > 0/,
  );
});
