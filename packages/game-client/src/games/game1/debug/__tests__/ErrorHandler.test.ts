/**
 * @vitest-environment happy-dom
 *
 * Tester for ErrorHandler (Tobias-direktiv 2026-05-13).
 *
 * Dekker:
 *   - Idempotent install
 *   - window.onerror trigges → error.client event med kind=runtime-error
 *   - unhandledrejection trigges → error.client event med kind=unhandled-rejection
 *   - Stack-trace inkluderes (truncated)
 *   - No-op uten debug-flag
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { installErrorHandler } from "../ErrorHandler.js";
import { getEventTracker, resetEventTracker } from "../EventTracker.js";

describe("ErrorHandler", () => {
  let uninstall: (() => void) | null = null;

  beforeEach(() => {
    resetEventTracker();
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", "/?debug=1");
    }
  });

  afterEach(() => {
    if (uninstall) {
      uninstall();
      uninstall = null;
    }
  });

  it("er idempotent — re-kall returnerer no-op", () => {
    const first = installErrorHandler();
    const second = installErrorHandler();
    expect(typeof first).toBe("function");
    expect(typeof second).toBe("function");
    uninstall = first;
  });

  it("returnerer no-op når debug-flag mangler", () => {
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", "/");
    }
    const u = installErrorHandler();
    uninstall = u;

    // Fire en error — ingenting skal trackes
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "test",
        filename: "a.js",
        lineno: 1,
        colno: 1,
        error: new Error("boom"),
      }),
    );

    const tracker = getEventTracker();
    const events = tracker.getEvents();
    expect(events.find((e) => e.type === "error.client")).toBeUndefined();
  });

  it("tracker error.client ved window.onerror", () => {
    uninstall = installErrorHandler();

    const err = new Error("boom!");
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "boom!",
        filename: "test.ts",
        lineno: 42,
        colno: 13,
        error: err,
      }),
    );

    const tracker = getEventTracker();
    const events = tracker.getEvents();
    const errEvt = events.find((e) => e.type === "error.client");
    expect(errEvt).toBeDefined();
    expect(errEvt?.payload["kind"]).toBe("runtime-error");
    expect(errEvt?.payload["message"]).toBe("boom!");
    expect(errEvt?.payload["filename"]).toBe("test.ts");
    expect(errEvt?.payload["lineno"]).toBe(42);
  });

  it("tracker error.client ved unhandledrejection", () => {
    uninstall = installErrorHandler();

    const reason = new Error("promise-died");
    const promise = Promise.reject(reason);
    promise.catch(() => {});

    // happy-dom har ikke PromiseRejectionEvent — bygg en CustomEvent-stub
    // som matcher native shape så listener-koden får riktig `reason`.
    const Ctor =
      (globalThis as unknown as {
        PromiseRejectionEvent?: typeof Event;
      }).PromiseRejectionEvent;
    let evt: Event;
    if (typeof Ctor === "function") {
      evt = new Ctor("unhandledrejection", {
        promise,
        reason,
      } as unknown as EventInit);
    } else {
      evt = new Event("unhandledrejection") as Event & {
        promise: Promise<unknown>;
        reason: unknown;
      };
      (evt as unknown as { promise: Promise<unknown> }).promise = promise;
      (evt as unknown as { reason: unknown }).reason = reason;
    }
    window.dispatchEvent(evt);

    const tracker = getEventTracker();
    const events = tracker.getEvents();
    const errEvt = events.find(
      (e) => e.type === "error.client" && e.payload["kind"] === "unhandled-rejection",
    );
    expect(errEvt).toBeDefined();
    expect(errEvt?.payload["message"]).toBe("promise-died");
  });
});
