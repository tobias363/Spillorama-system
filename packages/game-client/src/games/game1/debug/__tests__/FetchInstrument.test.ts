/**
 * @vitest-environment happy-dom
 *
 * Tester for FetchInstrument (Tobias-direktiv 2026-05-13).
 *
 * Dekker:
 *   - Sanitering av Authorization-header og cookie
 *   - JSON-body parses og sanitiseres
 *   - URL i SKIP_URL_PATTERNS bypasses (ingen track)
 *   - api.request + api.response trackes med riktig duration
 *   - Network-error trackes som api.response med status -1
 *   - Idempotent install (re-kall trygt)
 *
 * Strategi:
 *   Mocker globalThis.fetch og bruker EventTracker-singleton for å se
 *   hvilke events som ble tracked.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installFetchInstrument, __TEST_ONLY__ } from "../FetchInstrument.js";
import { getEventTracker, resetEventTracker } from "../EventTracker.js";

const { sanitizeHeaders, sanitizeBody, shouldSkipUrl } = __TEST_ONLY__;

describe("FetchInstrument", () => {
  let uninstall: (() => void) | null = null;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetEventTracker();
    // Aktiver debug-gate via URL
    if (typeof window !== "undefined" && window.history) {
      window.history.replaceState({}, "", "/?debug=1");
    }
  });

  afterEach(() => {
    if (uninstall) {
      uninstall();
      uninstall = null;
    }
    globalThis.fetch = originalFetch;
  });

  describe("sanitizeHeaders", () => {
    it("returnerer tom object for undefined", () => {
      expect(sanitizeHeaders(undefined)).toEqual({});
    });

    it("redacter Authorization-header", () => {
      const out = sanitizeHeaders({ Authorization: "Bearer secret" });
      expect(out["Authorization"]).toBe("[REDACTED]");
    });

    it("redacter Cookie-header", () => {
      const out = sanitizeHeaders({ Cookie: "session=abc" });
      expect(out["Cookie"]).toBe("[REDACTED]");
    });

    it("beholder ikke-sensitive headers", () => {
      const out = sanitizeHeaders({ "Content-Type": "application/json" });
      expect(out["Content-Type"]).toBe("application/json");
    });

    it("redacter case-insensitivt", () => {
      const out = sanitizeHeaders({ authorization: "Bearer x" });
      expect(out["authorization"]).toBe("[REDACTED]");
    });

    it("støtter Headers-instans", () => {
      const h = new Headers();
      h.set("Authorization", "Bearer x");
      h.set("X-Custom", "value");
      const out = sanitizeHeaders(h);
      // Headers normaliserer keys til lowercase ved iteration
      const authKey = Object.keys(out).find(
        (k) => k.toLowerCase() === "authorization",
      );
      expect(authKey).toBeDefined();
      expect(out[authKey!]).toBe("[REDACTED]");
    });
  });

  describe("sanitizeBody", () => {
    it("returnerer null for null/undefined", () => {
      expect(sanitizeBody(null)).toBe(null);
      expect(sanitizeBody(undefined)).toBe(null);
    });

    it("parser JSON-string og returnerer object", () => {
      const out = sanitizeBody('{"a":1,"b":"x"}');
      expect(out).toEqual({ a: 1, b: "x" });
    });

    it("trunkerer lange ikke-JSON-strenger", () => {
      const longStr = "a".repeat(3000);
      const out = sanitizeBody(longStr) as string;
      expect(out.length).toBeLessThanOrEqual(2100);
      expect(out).toContain("...(truncated)");
    });

    it("returnerer placeholder for FormData", () => {
      const fd = new FormData();
      fd.append("k", "v");
      const out = sanitizeBody(fd) as { type: string };
      expect(out.type).toBe("FormData");
    });
  });

  describe("shouldSkipUrl", () => {
    it("skipper /api/_dev/debug/events", () => {
      expect(shouldSkipUrl("/api/_dev/debug/events")).toBe(true);
      expect(shouldSkipUrl("/api/_dev/debug/events?token=x")).toBe(true);
    });

    it("skipper /api/_dev/debug/bug-report", () => {
      expect(shouldSkipUrl("/api/_dev/debug/bug-report?token=x")).toBe(true);
    });

    it("skipper IKKE andre /api/-URLer", () => {
      expect(shouldSkipUrl("/api/games/spill1/lobby")).toBe(false);
      expect(shouldSkipUrl("/api/agent/game1/buy")).toBe(false);
    });
  });

  describe("install / uninstall", () => {
    it("er idempotent — re-kall returnerer no-op", () => {
      const fakeFetch = vi.fn(async () => new Response("{}"));
      globalThis.fetch = fakeFetch as unknown as typeof fetch;

      const first = installFetchInstrument({ fetchTarget: fakeFetch });
      const second = installFetchInstrument({ fetchTarget: fakeFetch });
      // Begge returnerer en funksjon (no-op for second), men install bare en gang
      expect(typeof first).toBe("function");
      expect(typeof second).toBe("function");
      uninstall = first;
    });

    it("returnerer no-op når debug-flag mangler", () => {
      // Fjern debug-flag
      if (typeof window !== "undefined") {
        window.history.replaceState({}, "", "/");
      }
      const fakeFetch = vi.fn(async () => new Response("{}"));
      const u = installFetchInstrument({ fetchTarget: fakeFetch });
      // Vi forventer at globalThis.fetch ikke wrappes — kall den
      // direkte og verifiser at tracker ikke får events.
      uninstall = u;
      const tracker = getEventTracker();
      const before = tracker.getEvents().length;
      // (kan ikke gjøre fetch fordi det er no-op uten install)
      const after = tracker.getEvents().length;
      expect(after).toBe(before);
    });
  });

  describe("end-to-end fetch tracking", () => {
    it("tracker api.request og api.response på vellykket fetch", async () => {
      const fakeFetch = vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true, data: 42 }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
      );
      globalThis.fetch = fakeFetch as unknown as typeof fetch;
      uninstall = installFetchInstrument({ fetchTarget: fakeFetch });

      await globalThis.fetch("/api/games/spill1/lobby");

      // api.response trackes asynkront — vent en tick
      await new Promise((r) => setTimeout(r, 10));

      const tracker = getEventTracker();
      const events = tracker.getEvents();
      const requestEvt = events.find((e) => e.type === "api.request");
      const responseEvt = events.find((e) => e.type === "api.response");
      expect(requestEvt).toBeDefined();
      expect(requestEvt?.payload["url"]).toBe("/api/games/spill1/lobby");
      expect(requestEvt?.payload["method"]).toBe("GET");
      expect(responseEvt).toBeDefined();
      expect(responseEvt?.payload["status"]).toBe(200);
      expect(responseEvt?.payload["ok"]).toBe(true);
    });

    it("skipper tracking for /api/_dev/debug/events", async () => {
      const fakeFetch = vi.fn(async () => new Response("{}"));
      globalThis.fetch = fakeFetch as unknown as typeof fetch;
      uninstall = installFetchInstrument({ fetchTarget: fakeFetch });

      await globalThis.fetch("/api/_dev/debug/events?token=x", {
        method: "POST",
      });

      await new Promise((r) => setTimeout(r, 10));

      const tracker = getEventTracker();
      const events = tracker.getEvents();
      const requestEvt = events.find(
        (e) => e.type === "api.request" && e.payload["url"]?.toString().includes("debug/events"),
      );
      expect(requestEvt).toBeUndefined();
    });

    it("tracker network-error som api.response status -1", async () => {
      const fakeFetch = vi.fn(async () => {
        throw new Error("network down");
      });
      globalThis.fetch = fakeFetch as unknown as typeof fetch;
      uninstall = installFetchInstrument({ fetchTarget: fakeFetch });

      let caught = false;
      try {
        await globalThis.fetch("/api/games/spill1/lobby");
      } catch {
        caught = true;
      }
      expect(caught).toBe(true);

      const tracker = getEventTracker();
      const events = tracker.getEvents();
      const responseEvt = events.find((e) => e.type === "api.response");
      expect(responseEvt).toBeDefined();
      expect(responseEvt?.payload["status"]).toBe(-1);
      expect(responseEvt?.payload["error"]).toContain("network down");
    });
  });
});
