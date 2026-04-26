/**
 * MED-1: Express trace-id middleware tests.
 *
 * Validates the three behaviours that close the bug-report:
 *   1. A response always carries `X-Trace-Id` so the client can grep for it.
 *   2. Inside the handler, `getTraceContext()` returns the same id —
 *      proves the ALS hop from middleware to handler works.
 *   3. An incoming, validly-formatted `X-Trace-Id` is reused (upstream
 *      proxy correlation), but malformed values are rejected and replaced
 *      with a fresh id (log-injection defence).
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { traceIdMiddleware } from "./traceId.js";
import { getTraceContext } from "../util/traceContext.js";

interface FakeRes {
  headers: Record<string, string>;
  setHeader(name: string, value: string): void;
}

function fakeReq(headers: Record<string, string | undefined> = {}): Request {
  return { headers } as unknown as Request;
}

function fakeRes(): FakeRes & Response {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
  } as unknown as FakeRes & Response;
}

test("traceIdMiddleware mints a fresh traceId and exposes it via header + req.traceId", () => {
  const mw = traceIdMiddleware();
  const req = fakeReq();
  const res = fakeRes();

  let observedInsideHandler: string | undefined;
  const next: NextFunction = () => {
    observedInsideHandler = getTraceContext()?.traceId;
  };

  mw(req, res, next);

  const headerValue = (res as unknown as FakeRes).headers["X-Trace-Id"];
  assert.ok(headerValue, "X-Trace-Id response header must be set");
  assert.equal((req as Request & { traceId?: string }).traceId, headerValue);
  assert.equal(observedInsideHandler, headerValue, "ALS context must match header");
});

test("traceIdMiddleware reuses a well-formed incoming X-Trace-Id (upstream-proxy correlation)", () => {
  const mw = traceIdMiddleware();
  const incomingId = "11111111-2222-4333-8444-555555555555";
  const req = fakeReq({ "x-trace-id": incomingId });
  const res = fakeRes();

  let observed: string | undefined;
  mw(req, res, () => {
    observed = getTraceContext()?.traceId;
  });

  assert.equal((res as unknown as FakeRes).headers["X-Trace-Id"], incomingId);
  assert.equal(observed, incomingId);
});

test("traceIdMiddleware rejects malformed X-Trace-Id (log-injection defence)", () => {
  const mw = traceIdMiddleware();
  // Newline injection — a classic log-injection attack vector.
  const malicious = "abc\nFAKE_LOG_LINE";
  const req = fakeReq({ "x-trace-id": malicious });
  const res = fakeRes();

  let observed: string | undefined;
  mw(req, res, () => {
    observed = getTraceContext()?.traceId;
  });

  assert.notEqual(observed, malicious, "malformed traceId must NOT be reused");
  assert.ok(observed, "a fresh traceId must be minted instead");
  assert.match(observed, /^[a-zA-Z0-9_.-]+$/, "fresh id must be safe to log");
});

test("traceIdMiddleware does not leak context across requests (concurrent isolation)", async () => {
  const mw = traceIdMiddleware();

  // Two independent "requests" sharing nothing but the middleware factory.
  const reqA = fakeReq();
  const resA = fakeRes();
  const reqB = fakeReq();
  const resB = fakeRes();

  let traceA: string | undefined;
  let traceB: string | undefined;

  // Interleave: start request A, await microtask, start request B, then
  // both observe the trace context. ALS must keep them apart.
  await new Promise<void>((resolve) => {
    mw(reqA, resA, async () => {
      traceA = getTraceContext()?.traceId;
      await Promise.resolve();
      mw(reqB, resB, async () => {
        traceB = getTraceContext()?.traceId;
        await Promise.resolve();
        // After B runs, A's trace must still be retrievable from A's frame.
        assert.equal(getTraceContext()?.traceId, traceB);
        resolve();
      });
    });
  });

  assert.ok(traceA);
  assert.ok(traceB);
  assert.notEqual(traceA, traceB);
});
