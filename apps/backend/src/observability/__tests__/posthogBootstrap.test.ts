/**
 * OBS-5: PostHog event-analytics unit tests.
 *
 * No live PostHog ping — we install a mock handle via the test-only
 * `__installMockPostHogForTests` shim and assert that `captureEvent`
 * routes the right `distinctId/event/properties` shape into the SDK.
 *
 * Test contract:
 *   - `POSTHOG_API_KEY` unset → `initPostHog()` returns null, every
 *     subsequent `captureEvent` is a no-op.
 *   - `POSTHOG_API_KEY` set → `initPostHog()` constructs a client.
 *   - `captureEvent` swallows SDK errors so a crashing PostHog never
 *     bubbles up to the request that triggered the event.
 *   - `shutdownPostHog` flushes safely + handles null client + handles
 *     shutdown-error gracefully.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  initPostHog,
  captureEvent,
  shutdownPostHog,
  getPostHog,
  __resetPostHogForTests,
  __installMockPostHogForTests,
} from "../posthogBootstrap.js";

type CaptureCall = {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
};

function makeMockClient(opts: { throwOnCapture?: boolean; throwOnShutdown?: boolean } = {}): {
  handle: import("posthog-node").PostHog;
  calls: { captured: CaptureCall[]; shutdowns: number };
} {
  const calls = {
    captured: [] as CaptureCall[],
    shutdowns: 0,
  };
  const handle = {
    capture(input: CaptureCall) {
      if (opts.throwOnCapture) throw new Error("synthetic capture failure");
      calls.captured.push({
        distinctId: input.distinctId,
        event: input.event,
        properties: input.properties,
      });
    },
    async shutdown() {
      if (opts.throwOnShutdown) throw new Error("synthetic shutdown failure");
      calls.shutdowns += 1;
    },
  };
  // Cast through unknown — we only exercise the two methods we actually use.
  return { handle: handle as unknown as import("posthog-node").PostHog, calls };
}

test("initPostHog returns null when POSTHOG_API_KEY is unset", () => {
  __resetPostHogForTests();
  const prev = process.env.POSTHOG_API_KEY;
  delete process.env.POSTHOG_API_KEY;
  try {
    const client = initPostHog();
    assert.equal(client, null, "client should be null when env var missing");
    assert.equal(getPostHog(), null);
  } finally {
    if (prev !== undefined) process.env.POSTHOG_API_KEY = prev;
  }
});

test("initPostHog initializes a client when POSTHOG_API_KEY + host are set", () => {
  __resetPostHogForTests();
  const prevKey = process.env.POSTHOG_API_KEY;
  const prevHost = process.env.POSTHOG_HOST;
  process.env.POSTHOG_API_KEY = "test-key-not-real";
  process.env.POSTHOG_HOST = "https://eu.i.posthog.com";
  try {
    const client = initPostHog();
    assert.ok(client !== null, "client should be non-null after init");
    assert.strictEqual(getPostHog(), client, "getPostHog should return same instance");
    // Cleanup so we don't leak a live PostHog client past this test.
    __resetPostHogForTests();
  } finally {
    if (prevKey === undefined) delete process.env.POSTHOG_API_KEY;
    else process.env.POSTHOG_API_KEY = prevKey;
    if (prevHost === undefined) delete process.env.POSTHOG_HOST;
    else process.env.POSTHOG_HOST = prevHost;
  }
});

test("captureEvent is a no-op when client is null", () => {
  __resetPostHogForTests();
  // No mock installed → client is null. Should not throw.
  assert.doesNotThrow(() => captureEvent("user-1", "test.event", { foo: "bar" }));
});

test("captureEvent forwards distinctId + event + properties to the SDK", () => {
  __resetPostHogForTests();
  const { handle, calls } = makeMockClient();
  __installMockPostHogForTests(handle);

  captureEvent("user-42", "ticket.purchase.success", {
    hallId: "demo-hall-001",
    ticketCount: 3,
    totalCents: 4500,
  });

  assert.equal(calls.captured.length, 1);
  const captured = calls.captured[0];
  assert.equal(captured?.distinctId, "user-42");
  assert.equal(captured?.event, "ticket.purchase.success");
  assert.deepEqual(captured?.properties, {
    hallId: "demo-hall-001",
    ticketCount: 3,
    totalCents: 4500,
  });

  __resetPostHogForTests();
});

test("captureEvent is a no-op when distinctId or event is empty", () => {
  __resetPostHogForTests();
  const { handle, calls } = makeMockClient();
  __installMockPostHogForTests(handle);

  captureEvent("", "test.event");
  captureEvent("user-1", "");

  assert.equal(calls.captured.length, 0, "empty inputs should be dropped");
  __resetPostHogForTests();
});

test("captureEvent swallows SDK errors so callers never crash", () => {
  __resetPostHogForTests();
  const { handle } = makeMockClient({ throwOnCapture: true });
  __installMockPostHogForTests(handle);

  assert.doesNotThrow(() => captureEvent("user-1", "test.event", { ok: true }));
  __resetPostHogForTests();
});

test("shutdownPostHog handles null-client gracefully", async () => {
  __resetPostHogForTests();
  // No client installed.
  await assert.doesNotReject(() => shutdownPostHog());
});

test("shutdownPostHog calls client.shutdown when client exists", async () => {
  __resetPostHogForTests();
  const { handle, calls } = makeMockClient();
  __installMockPostHogForTests(handle);

  await shutdownPostHog();

  assert.equal(calls.shutdowns, 1, "shutdown should be invoked once");
  assert.equal(getPostHog(), null, "client reference should be cleared");
});

test("shutdownPostHog swallows SDK shutdown errors", async () => {
  __resetPostHogForTests();
  const { handle } = makeMockClient({ throwOnShutdown: true });
  __installMockPostHogForTests(handle);

  await assert.doesNotReject(() => shutdownPostHog());
  assert.equal(getPostHog(), null, "client should still be cleared after error");
});
