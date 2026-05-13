/**
 * BIN-539: Sentry wiring + error reporter unit tests.
 *
 * We don't call a live Sentry instance — instead, the mock handle captures
 * every function call so we can assert the right breadcrumbs + tags fire.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  initSentry,
  captureError,
  addBreadcrumb,
  hashPii,
  __resetSentryForTests,
  __installMockSentryForTests,
} from "../sentry.js";

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
      withScope: () => { /* not exercised in these tests */ },
      flush: async () => { calls.flushed += 1; return true; },
    },
    calls,
  };
}

test("BIN-539: initSentry returns false when SENTRY_DSN is unset", async () => {
  __resetSentryForTests();
  const originalDsn = process.env.SENTRY_DSN;
  delete process.env.SENTRY_DSN;
  try {
    const enabled = await initSentry();
    assert.equal(enabled, false, "should disable gracefully without DSN");
  } finally {
    if (originalDsn !== undefined) process.env.SENTRY_DSN = originalDsn;
  }
});

test("BIN-539: captureError forwards to Sentry when enabled", () => {
  __resetSentryForTests();
  const { handle, calls } = makeMockSentry();
  __installMockSentryForTests(handle);

  const err = new Error("room-join failed");
  captureError(err, { roomCode: "ABCD", hallId: "hall-42", undefinedField: undefined });

  assert.equal(calls.exceptions.length, 1, "one exception captured");
  assert.equal(calls.exceptions[0].err, err);
  assert.deepEqual(calls.exceptions[0].tags, { roomCode: "ABCD", hallId: "hall-42" }, "undefined tags stripped");
});

test("BIN-539: addBreadcrumb forwards when Sentry is enabled", () => {
  __resetSentryForTests();
  const { handle, calls } = makeMockSentry();
  __installMockSentryForTests(handle);

  addBreadcrumb("claim:submit", { roomCode: "ROOM", claimType: "BINGO" });

  assert.equal(calls.breadcrumbs.length, 1);
  assert.equal(calls.breadcrumbs[0].category, "claim:submit");
  assert.deepEqual(calls.breadcrumbs[0].data, { roomCode: "ROOM", claimType: "BINGO" });
});

test("BIN-539: captureError/addBreadcrumb are silent no-ops when Sentry is disabled", () => {
  __resetSentryForTests(); // back to disabled state
  // No throw; no SDK needed.
  assert.doesNotThrow(() => addBreadcrumb("x"));
  assert.doesNotThrow(() => captureError(new Error("ignored")));
});

test("BIN-539: hashPii is deterministic and truncated", () => {
  const a = hashPii("player-123");
  const b = hashPii("player-123");
  const c = hashPii("player-456");
  assert.equal(a, b, "same input yields same hash");
  assert.notEqual(a, c, "different inputs yield different hashes");
  assert.equal(a.length, 12, "hash is truncated to 12 hex chars");
  assert.match(a, /^[0-9a-f]{12}$/);
  assert.equal(hashPii(undefined), "anon");
  assert.equal(hashPii(""), "anon");
});
