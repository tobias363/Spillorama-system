/**
 * BIN-776 / M2 — securityHeadersMiddleware tests.
 *
 * Co-located with the source per codebase convention (see
 * httpRateLimit.test.ts, traceId.test.ts). The task brief asked for
 * `__tests__/securityHeaders.test.ts`, but that folder does not exist
 * for middleware in this repo and the test runner glob
 * `src/<dirs>/<file>.test.ts` (see package.json `test` script) picks
 * up co-located tests automatically.
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import {
  securityHeadersMiddleware,
  resolveCspMode,
  SECURITY_HEADERS_INTERNALS,
} from "./securityHeaders.js";

interface FakeRes {
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
}

function fakeReq(): Request {
  return {} as unknown as Request;
}

function fakeRes(): FakeRes & Response {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) {
      // lower-case to mirror Node's HTTP header behaviour
      headers[name.toLowerCase()] = value;
    },
  } as unknown as FakeRes & Response;
}

function runMiddleware(opts: Parameters<typeof securityHeadersMiddleware>[0] = {}) {
  const mw = securityHeadersMiddleware(opts);
  const req = fakeReq();
  const res = fakeRes();
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };
  mw(req, res, next);
  return { res: res as unknown as FakeRes, nextCalled };
}

test("securityHeadersMiddleware sets baseline static headers on every response", () => {
  const { res, nextCalled } = runMiddleware({ cspMode: "report-only" });
  assert.equal(nextCalled, true, "must call next() to continue the chain");

  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.equal(res.headers["referrer-policy"], "strict-origin-when-cross-origin");
  assert.equal(res.headers["cross-origin-opener-policy"], "same-origin");
  assert.equal(res.headers["cross-origin-resource-policy"], "same-site");
  assert.ok(
    res.headers["permissions-policy"]?.includes("camera=()"),
    "Permissions-Policy must deny camera",
  );
  assert.ok(
    res.headers["permissions-policy"]?.includes("microphone=()"),
    "Permissions-Policy must deny microphone",
  );
});

test("securityHeadersMiddleware defaults to report-only when CSP_MODE is unset", () => {
  const prev = process.env.CSP_MODE;
  delete process.env.CSP_MODE;
  try {
    const { res } = runMiddleware();
    assert.ok(
      res.headers["content-security-policy-report-only"],
      "report-only header must be set",
    );
    assert.equal(
      res.headers["content-security-policy"],
      undefined,
      "enforce header must NOT be set in report-only mode",
    );
  } finally {
    if (prev !== undefined) process.env.CSP_MODE = prev;
  }
});

test("securityHeadersMiddleware switches header name when cspMode='enforce'", () => {
  const { res } = runMiddleware({ cspMode: "enforce" });
  assert.ok(res.headers["content-security-policy"], "enforce header must be set");
  assert.equal(
    res.headers["content-security-policy-report-only"],
    undefined,
    "report-only header must NOT be set in enforce mode",
  );
});

test("CSP includes self, no inline scripts, Candy frame-src, swedbank connect-src", () => {
  const { res } = runMiddleware({ cspMode: "enforce" });
  const csp = res.headers["content-security-policy"];
  assert.ok(csp);

  // default-src 'self'
  assert.match(csp, /default-src 'self'/);

  // script-src must NOT include unsafe-inline or unsafe-eval
  assert.ok(/script-src [^;]*'self'/.test(csp));
  assert.ok(!/script-src [^;]*'unsafe-inline'/.test(csp));
  assert.ok(!csp.includes("'unsafe-eval'"));

  // style-src needs unsafe-inline (Tailwind/Pixi inject style tags)
  assert.match(csp, /style-src [^;]*'unsafe-inline'/);

  // img-src: self + data + Cloudinary
  assert.match(csp, /img-src [^;]*'self'/);
  assert.match(csp, /img-src [^;]*data:/);
  assert.match(csp, /img-src [^;]*https:\/\/res\.cloudinary\.com/);

  // connect-src: self + Swedbank + Render WSS + Candy
  assert.match(csp, /connect-src [^;]*'self'/);
  assert.match(csp, /connect-src [^;]*https:\/\/api\.swedbankpay\.com/);
  assert.match(csp, /connect-src [^;]*wss:\/\/\*\.spillorama-system\.onrender\.com/);
  assert.match(csp, /connect-src [^;]*https:\/\/candy-backend-ldvg\.onrender\.com/);

  // Candy iframe is allowed
  assert.match(csp, /frame-src https:\/\/candy-backend-ldvg\.onrender\.com/);

  // Defence-in-depth: nobody may iframe us
  assert.match(csp, /frame-ancestors 'none'/);

  // No legacy plugin embeds, base-uri locked, form-action locked
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /form-action 'self'/);

  // Reporter wired to default path
  assert.match(csp, /report-uri \/api\/csp-report/);
});

test("CSP report-uri can be overridden via cspReportPath option", () => {
  const { res } = runMiddleware({
    cspMode: "enforce",
    cspReportPath: "/internal/csp",
  });
  const csp = res.headers["content-security-policy"];
  assert.ok(csp);
  assert.match(csp, /report-uri \/internal\/csp/);
  assert.ok(!csp.includes("/api/csp-report"));
});

test("CSP picks up extra connect-src origins from CSP_EXTRA_CONNECT_SRC env", () => {
  const prev = process.env.CSP_EXTRA_CONNECT_SRC;
  process.env.CSP_EXTRA_CONNECT_SRC =
    "https://sentry.io, https://o123.ingest.sentry.io , ";
  try {
    const { res } = runMiddleware({ cspMode: "enforce" });
    const csp = res.headers["content-security-policy"];
    assert.ok(csp);
    assert.match(csp, /connect-src [^;]*https:\/\/sentry\.io/);
    assert.match(csp, /connect-src [^;]*https:\/\/o123\.ingest\.sentry\.io/);
  } finally {
    if (prev === undefined) delete process.env.CSP_EXTRA_CONNECT_SRC;
    else process.env.CSP_EXTRA_CONNECT_SRC = prev;
  }
});

test("HSTS is emitted only in production by default", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const { res: devRes } = runMiddleware();
    assert.equal(
      devRes.headers["strict-transport-security"],
      undefined,
      "HSTS must NOT be emitted in development by default",
    );
  } finally {
    process.env.NODE_ENV = prev;
  }

  const prev2 = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const { res: prodRes } = runMiddleware();
    const hsts = prodRes.headers["strict-transport-security"];
    assert.ok(hsts, "HSTS must be emitted in production");
    assert.match(hsts, /max-age=31536000/);
    assert.match(hsts, /includeSubDomains/);
    assert.match(hsts, /preload/);
  } finally {
    process.env.NODE_ENV = prev2;
  }
});

test("HSTS can be force-enabled in non-production via emitHsts flag", () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  try {
    const { res } = runMiddleware({ emitHsts: true });
    assert.ok(
      res.headers["strict-transport-security"],
      "HSTS must be emitted when emitHsts=true even outside production",
    );
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test("resolveCspMode falls back to report-only on bad input", () => {
  const prev = process.env.CSP_MODE;
  try {
    process.env.CSP_MODE = "ENFORCE";
    assert.equal(resolveCspMode(), "enforce", "case-insensitive env handling");

    process.env.CSP_MODE = "garbage";
    assert.equal(resolveCspMode(), "report-only", "unknown value defaults safe");

    delete process.env.CSP_MODE;
    assert.equal(resolveCspMode(), "report-only", "missing env defaults safe");

    // Explicit option always wins.
    process.env.CSP_MODE = "enforce";
    assert.equal(resolveCspMode("report-only"), "report-only");
  } finally {
    if (prev === undefined) delete process.env.CSP_MODE;
    else process.env.CSP_MODE = prev;
  }
});

test("buildCspDirectives returns a frozen, non-empty directive set", () => {
  const d = SECURITY_HEADERS_INTERNALS.buildCspDirectives({
    reportUri: "/api/csp-report",
  });
  assert.deepEqual(d.defaultSrc, ["'self'"]);
  assert.equal(d.objectSrc[0], "'none'");
  assert.equal(d.frameAncestors[0], "'none'");
  assert.ok(d.connectSrc.includes("'self'"));
  assert.equal(d.reportUri, "/api/csp-report");
});

test("serialiseCsp produces deterministic output (regression guard)", () => {
  const directives = SECURITY_HEADERS_INTERNALS.buildCspDirectives({
    reportUri: "/api/csp-report",
  });
  const a = SECURITY_HEADERS_INTERNALS.serialiseCsp(directives);
  const b = SECURITY_HEADERS_INTERNALS.serialiseCsp(directives);
  assert.equal(a, b, "same directives must produce byte-identical output");
  // Serialisation joins directives with "; "
  assert.ok(a.includes("; "));
  // No trailing semicolon
  assert.ok(!a.endsWith(";"));
});
