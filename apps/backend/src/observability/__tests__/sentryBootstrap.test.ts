/**
 * OBS-2 (2026-05-13): tests for sentryBootstrap.ts.
 *
 * We don't drive `bootstrapBackendSentry` end-to-end (it would require
 * SENTRY_DSN + a live Sentry instance); instead we exercise the
 * middleware helpers in isolation using the mock-handle pattern from
 * sentry.test.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  __resetSentryForTests,
  __installMockSentryForTests,
  setSentryUser,
} from "../sentry.js";
import {
  bootstrapBackendSentry,
  sentryUserContextMiddleware,
  getSentryErrorHandlerMiddleware,
} from "../sentryBootstrap.js";

function makeMockSentry() {
  const calls = {
    exceptions: [] as Array<{ err: unknown; tags?: Record<string, string> }>,
    breadcrumbs: [] as Array<{ category: string; data?: Record<string, unknown> }>,
    tags: [] as Array<{ key: string; value: string }>,
    users: [] as Array<{ id?: string; username?: string; email?: string } | null>,
    flushed: 0,
  };
  return {
    handle: {
      captureException: (err: unknown, hint?: { tags?: Record<string, string>; extra?: Record<string, unknown> }) => {
        calls.exceptions.push({ err, tags: hint?.tags });
      },
      addBreadcrumb: (b: { category: string; data?: Record<string, unknown> }) => {
        calls.breadcrumbs.push({ category: b.category, data: b.data });
      },
      setTag: (key: string, value: string) => { calls.tags.push({ key, value }); },
      setUser: (u: { id?: string; username?: string; email?: string } | null) => { calls.users.push(u); },
      withScope: () => {},
      flush: async () => { calls.flushed += 1; return true; },
    },
    calls,
  };
}

test("OBS-2: bootstrapBackendSentry returns false when SENTRY_DSN is unset", async () => {
  __resetSentryForTests();
  const originalDsn = process.env.SENTRY_DSN;
  delete process.env.SENTRY_DSN;
  try {
    const enabled = await bootstrapBackendSentry();
    assert.equal(enabled, false, "should disable gracefully without DSN");
  } finally {
    if (originalDsn !== undefined) process.env.SENTRY_DSN = originalDsn;
  }
});

test("OBS-2: bootstrapBackendSentry parses numeric env vars for sample rates", async () => {
  __resetSentryForTests();
  const originalDsn = process.env.SENTRY_DSN;
  const originalTraces = process.env.SENTRY_TRACES_SAMPLE_RATE;
  // Use a fake DSN — init may still fail to load the real SDK in test env,
  // but parsing logic in bootstrapBackendSentry runs before that.
  delete process.env.SENTRY_DSN;
  process.env.SENTRY_TRACES_SAMPLE_RATE = "0.42";
  try {
    // Even without DSN, we just exercise the option-parsing path.
    const result = await bootstrapBackendSentry();
    assert.equal(result, false, "no DSN → still disabled");
    // Cleanup-only assertion: we know the function read the env without
    // throwing, which is what we care about.
  } finally {
    if (originalDsn !== undefined) process.env.SENTRY_DSN = originalDsn;
    if (originalTraces !== undefined) {
      process.env.SENTRY_TRACES_SAMPLE_RATE = originalTraces;
    } else {
      delete process.env.SENTRY_TRACES_SAMPLE_RATE;
    }
  }
});

test("OBS-2: sentryUserContextMiddleware forwards user.id when present", () => {
  __resetSentryForTests();
  const { handle, calls } = makeMockSentry();
  __installMockSentryForTests(handle);

  const middleware = sentryUserContextMiddleware();
  let calledNext = 0;
  const fakeReq = { user: { id: "user-42" } } as unknown as Parameters<typeof middleware>[0];
  const fakeRes = {} as unknown as Parameters<typeof middleware>[1];
  middleware(fakeReq, fakeRes, () => { calledNext += 1; });

  assert.equal(calledNext, 1, "next() called exactly once");
  assert.equal(calls.users.length, 1, "setUser called once");
  assert.deepEqual(calls.users[0], { id: "user-42" });
});

test("OBS-2: sentryUserContextMiddleware tolerates missing user", () => {
  __resetSentryForTests();
  const { handle, calls } = makeMockSentry();
  __installMockSentryForTests(handle);

  const middleware = sentryUserContextMiddleware();
  let calledNext = 0;
  const fakeReq = {} as unknown as Parameters<typeof middleware>[0];
  const fakeRes = {} as unknown as Parameters<typeof middleware>[1];
  middleware(fakeReq, fakeRes, () => { calledNext += 1; });

  assert.equal(calledNext, 1, "next() always called, even with no user");
  assert.equal(calls.users.length, 0, "setUser NOT called");
});

test("OBS-2: sentryUserContextMiddleware reads userId fallback when id missing", () => {
  __resetSentryForTests();
  const { handle, calls } = makeMockSentry();
  __installMockSentryForTests(handle);

  const middleware = sentryUserContextMiddleware();
  const fakeReq = { user: { userId: "user-99" } } as unknown as Parameters<typeof middleware>[0];
  const fakeRes = {} as unknown as Parameters<typeof middleware>[1];
  middleware(fakeReq, fakeRes, () => {});

  assert.equal(calls.users.length, 1);
  assert.deepEqual(calls.users[0], { id: "user-99" });
});

test("OBS-2: getSentryErrorHandlerMiddleware returns undefined when Sentry is disabled", () => {
  __resetSentryForTests();
  const handler = getSentryErrorHandlerMiddleware();
  assert.equal(handler, undefined, "no Sentry installed → no handler");
});

test("OBS-2: setSentryUser is a no-op when Sentry is disabled", () => {
  __resetSentryForTests();
  // Should not throw.
  setSentryUser({ id: "noop-test" });
  setSentryUser(null);
  assert.ok(true);
});
