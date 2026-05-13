/**
 * @vitest-environment happy-dom
 *
 * OBS-5: PostHog event-analytics tests for the game-client.
 *
 * No live PostHog network calls — we inject a mock handle via the
 * `injected` option so tests assert exact `capture()` calls without
 * touching the dynamic import.
 *
 * Test contract:
 *   - `VITE_POSTHOG_API_KEY` unset → `initPostHog` is a no-op.
 *   - `injected` mock present → init wires the handle + identifies userId.
 *   - `trackEvent` before init → no-op.
 *   - `trackEvent` after init → forwarded to handle.capture.
 *   - `shutdownPostHog` resets state so a subsequent init works again.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { PostHog as PostHogJsType } from "posthog-js";

import {
  initPostHog,
  identifyUser,
  trackEvent,
  shutdownPostHog,
  __resetPostHogForTests,
  __getPostHogHandleForTests,
} from "../posthogBootstrap.js";

function makeMockHandle(opts: { throwOnCapture?: boolean } = {}) {
  const calls = {
    inits: [] as Array<{ apiKey?: string }>,
    identifies: [] as string[],
    captures: [] as Array<{ event: string; props?: Record<string, unknown> }>,
    resets: 0,
  };
  const handle = {
    init: vi.fn((apiKey: string) => {
      calls.inits.push({ apiKey });
    }),
    identify: vi.fn((id: string) => {
      calls.identifies.push(id);
    }),
    capture: vi.fn((event: string, props?: Record<string, unknown>) => {
      if (opts.throwOnCapture) throw new Error("synthetic capture failure");
      calls.captures.push({ event, props });
    }),
    reset: vi.fn(() => {
      calls.resets += 1;
    }),
  };
  return { handle: handle as unknown as PostHogJsType, calls };
}

describe("posthogBootstrap (client)", () => {
  beforeEach(() => {
    __resetPostHogForTests();
  });

  it("initPostHog is a no-op when VITE_POSTHOG_API_KEY is unset and no injection is provided", async () => {
    // No options → resolveApiKey returns "" → init logs DISABLED and returns.
    // We exercise the path by not providing `injected` and not providing
    // `apiKey`. happy-dom env has no VITE_POSTHOG_API_KEY.
    await initPostHog("user-1");
    // After init, handle should still be null.
    expect(__getPostHogHandleForTests()).toBeNull();
  });

  it("initPostHog wires the injected mock handle when provided", async () => {
    const { handle, calls } = makeMockHandle();
    await initPostHog("user-42", { injected: handle });

    expect(__getPostHogHandleForTests()).toBe(handle);
    expect(calls.identifies).toEqual(["user-42"]);
  });

  it("initPostHog skips identify when userId is null but still wires the handle", async () => {
    const { handle, calls } = makeMockHandle();
    await initPostHog(null, { injected: handle });

    expect(__getPostHogHandleForTests()).toBe(handle);
    expect(calls.identifies).toEqual([]);
  });

  it("trackEvent is a no-op before init", () => {
    expect(() => trackEvent("test.event", { foo: "bar" })).not.toThrow();
  });

  it("trackEvent forwards event + props to handle.capture after init", async () => {
    const { handle, calls } = makeMockHandle();
    await initPostHog("user-1", { injected: handle });

    trackEvent("client.buy.popup.show", { tickets: 3, totalCents: 4500 });

    expect(calls.captures).toEqual([
      {
        event: "client.buy.popup.show",
        props: { tickets: 3, totalCents: 4500 },
      },
    ]);
  });

  it("trackEvent swallows SDK errors", async () => {
    const { handle } = makeMockHandle({ throwOnCapture: true });
    await initPostHog("user-1", { injected: handle });

    expect(() => trackEvent("test.event")).not.toThrow();
  });

  it("identifyUser forwards to handle.identify after init", async () => {
    const { handle, calls } = makeMockHandle();
    await initPostHog(null, { injected: handle });

    identifyUser("user-99");

    expect(calls.identifies).toContain("user-99");
  });

  it("identifyUser is a no-op when handle is null", () => {
    expect(() => identifyUser("user-99")).not.toThrow();
  });

  it("shutdownPostHog calls handle.reset and clears state", async () => {
    const { handle, calls } = makeMockHandle();
    await initPostHog("user-1", { injected: handle });
    expect(__getPostHogHandleForTests()).toBe(handle);

    shutdownPostHog();

    expect(calls.resets).toBe(1);
    expect(__getPostHogHandleForTests()).toBeNull();

    // After shutdown, a new init should work again.
    const second = makeMockHandle();
    await initPostHog("user-2", { injected: second.handle });
    expect(__getPostHogHandleForTests()).toBe(second.handle);
  });

  it("shutdownPostHog is a no-op when handle is null", () => {
    expect(() => shutdownPostHog()).not.toThrow();
  });
});
