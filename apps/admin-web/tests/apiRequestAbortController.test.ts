// FE-P0-003 (Bølge 2B pilot-blocker): tests for AbortController support in
// apiRequest() + PageLifecycle / RequestLifecycle helpers.
//
// Why this matters for pilot:
//   - Hall WiFi flaps. A user clicks "Last opp på nytt" on the cash-inout
//     page. The first slow fetch lands 6 s later AFTER they have already
//     saved a settlement — and the stale GET overwrites the just-saved
//     state. Money-data UI is at risk.
//   - Without AbortController, every retried request races every previous
//     one. Whichever lands LAST wins. That's not deterministic for an
//     operator who is reviewing daily-balance numbers.
//
// Tests cover:
//   1. apiRequest() honours signal — aborted before fetch resolves rejects
//      with AbortError.
//   2. apiRequest() honours signal — aborted BEFORE fetch starts also
//      rejects (pre-aborted signal short-circuits).
//   3. apiRequest() succeeds normally when signal is provided but never
//      aborted (no regression).
//   4. apiRequest() omits the signal field when none is provided
//      (backwards-compat for the 455 existing call-sites).
//   5. createPageLifecycle().dispose() aborts the signal.
//   6. createRequestLifecycle().start() aborts the previous controller.
//   7. isAbortError() helper recognises both DOMException and Error
//      shapes.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { apiRequest, isAbortError } from "../src/api/client.js";
import {
  createPageLifecycle,
  createRequestLifecycle,
} from "../src/api/lifecycle.js";

type FetchInit = RequestInit & { signal?: AbortSignal };

beforeEach(() => {
  window.localStorage.removeItem("bingo_admin_access_token");
});

/**
 * Build a fetch mock that respects the AbortSignal — when the signal is
 * aborted while the promise is pending, the promise rejects with an
 * AbortError (mirrors real fetch() behaviour).
 */
function mockFetchSlow(
  responseBody: unknown,
  delayMs = 50
): { fn: typeof fetch; lastInit: () => FetchInit | undefined } {
  let lastInit: FetchInit | undefined;
  const fn = vi.fn((url: string, init?: FetchInit) => {
    void url;
    lastInit = init;
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve(
          new Response(JSON.stringify({ ok: true, data: responseBody }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        );
      }, delayMs);
      if (init?.signal) {
        const onAbort = (): void => {
          clearTimeout(timer);
          const err = new DOMException("Aborted", "AbortError");
          reject(err);
        };
        if (init.signal.aborted) {
          onAbort();
        } else {
          init.signal.addEventListener("abort", onAbort, { once: true });
        }
      }
    });
  }) as unknown as typeof fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn;
  return { fn, lastInit: () => lastInit };
}

function mockFetchInstant(responseBody: unknown): {
  fn: typeof fetch;
  lastInit: () => FetchInit | undefined;
} {
  let lastInit: FetchInit | undefined;
  const fn = vi.fn(async (url: string, init?: FetchInit) => {
    void url;
    lastInit = init;
    return new Response(JSON.stringify({ ok: true, data: responseBody }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  (globalThis as unknown as { fetch: typeof fetch }).fetch = fn;
  return { fn, lastInit: () => lastInit };
}

describe("apiRequest — AbortController support (FE-P0-003)", () => {
  it("aborting an in-flight request rejects with AbortError", async () => {
    mockFetchSlow({ value: "should-never-arrive" }, 100);
    const ctrl = new AbortController();
    const promise = apiRequest("/api/test", { signal: ctrl.signal });
    // Abort before the slow response resolves
    setTimeout(() => ctrl.abort(), 10);
    await expect(promise).rejects.toSatisfy((err: unknown) => isAbortError(err));
  });

  it("aborting BEFORE the call rejects (pre-aborted signal)", async () => {
    mockFetchSlow({ value: "should-never-arrive" }, 100);
    const ctrl = new AbortController();
    ctrl.abort(); // Pre-abort
    await expect(
      apiRequest("/api/test", { signal: ctrl.signal })
    ).rejects.toSatisfy((err: unknown) => isAbortError(err));
  });

  it("succeeds normally when signal is provided but never aborted", async () => {
    const { lastInit } = mockFetchInstant({ value: 42 });
    const ctrl = new AbortController();
    const data = await apiRequest<{ value: number }>("/api/test", {
      signal: ctrl.signal,
    });
    expect(data).toEqual({ value: 42 });
    // The signal was forwarded to fetch
    expect(lastInit()?.signal).toBe(ctrl.signal);
  });

  it("omits signal field when no signal is provided (no regression)", async () => {
    const { lastInit } = mockFetchInstant({ value: 1 });
    await apiRequest("/api/test");
    // Without an explicit signal we don't set the field — fetch sees
    // `signal: undefined` rather than a fresh controller.
    expect(lastInit()?.signal).toBeUndefined();
  });

  it("aborted request does NOT execute .then() handlers", async () => {
    mockFetchSlow({ value: "stale" }, 100);
    const ctrl = new AbortController();
    let thenRan = false;
    const promise = apiRequest("/api/test", { signal: ctrl.signal })
      .then(() => {
        thenRan = true;
      })
      .catch(() => {
        // expected
      });
    setTimeout(() => ctrl.abort(), 10);
    await promise;
    expect(thenRan).toBe(false);
  });
});

describe("isAbortError helper", () => {
  it("recognises DOMException with name=AbortError", () => {
    const err = new DOMException("Aborted", "AbortError");
    expect(isAbortError(err)).toBe(true);
  });

  it("recognises a plain Error with name=AbortError", () => {
    const err = new Error("Aborted");
    err.name = "AbortError";
    expect(isAbortError(err)).toBe(true);
  });

  it("returns false for ApiError, plain errors, and non-error values", () => {
    expect(isAbortError(new Error("Network down"))).toBe(false);
    expect(isAbortError("string")).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError({ name: "AbortError" })).toBe(false);
  });
});

describe("createPageLifecycle", () => {
  it("provides an AbortSignal that fires on dispose()", () => {
    const lifecycle = createPageLifecycle();
    expect(lifecycle.signal.aborted).toBe(false);
    expect(lifecycle.disposed).toBe(false);
    lifecycle.dispose();
    expect(lifecycle.signal.aborted).toBe(true);
    expect(lifecycle.disposed).toBe(true);
  });

  it("dispose() is idempotent", () => {
    const lifecycle = createPageLifecycle();
    lifecycle.dispose();
    lifecycle.dispose();
    expect(lifecycle.signal.aborted).toBe(true);
    expect(lifecycle.disposed).toBe(true);
  });

  it("aborts an in-flight apiRequest when dispose() is called", async () => {
    mockFetchSlow({ value: "stale" }, 100);
    const lifecycle = createPageLifecycle();
    const promise = apiRequest("/api/test", { signal: lifecycle.signal });
    setTimeout(() => lifecycle.dispose(), 10);
    await expect(promise).rejects.toSatisfy((err: unknown) =>
      isAbortError(err)
    );
  });
});

describe("createRequestLifecycle", () => {
  it("start() aborts the previous controller", async () => {
    mockFetchSlow({ value: "stale" }, 100);
    const requests = createRequestLifecycle();
    const signalA = requests.start();
    const promiseA = apiRequest("/api/test", { signal: signalA });
    // Trigger a fresh request — this must abort A
    const signalB = requests.start();
    expect(signalA.aborted).toBe(true);
    expect(signalB.aborted).toBe(false);
    await expect(promiseA).rejects.toSatisfy((err: unknown) =>
      isAbortError(err)
    );
  });

  it("dispose() aborts the current controller and marks disposed", () => {
    const requests = createRequestLifecycle();
    const signal = requests.start();
    expect(requests.disposed).toBe(false);
    requests.dispose();
    expect(signal.aborted).toBe(true);
    expect(requests.disposed).toBe(true);
  });

  it("dispose() is idempotent", () => {
    const requests = createRequestLifecycle();
    requests.start();
    requests.dispose();
    requests.dispose();
    expect(requests.disposed).toBe(true);
  });

  it("cancel() aborts current controller without disposing", () => {
    const requests = createRequestLifecycle();
    const signal = requests.start();
    requests.cancel();
    expect(signal.aborted).toBe(true);
    expect(requests.disposed).toBe(false);
    // Can still start a new request after cancel
    const next = requests.start();
    expect(next.aborted).toBe(false);
  });
});
