/**
 * @vitest-environment happy-dom
 *
 * Tester for EventTracker (Tobias-direktiv 2026-05-12).
 *
 * Dekker:
 *   - Ring-buffer FIFO drop ved overflow
 *   - Track + getEvents + clear lifecycle
 *   - Singleton-resolution (getEventTracker / resetEventTracker)
 *   - Sanitize-helpers: redaksjon av sensitive keys, truncate, nested
 *   - Export-shape med sessionContext + droppedCount
 *   - Subscribe / fan-out av listeners
 *   - payloadKeysOnly + pickSafeFields utilities
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  EventTracker,
  getEventTracker,
  resetEventTracker,
  payloadKeysOnly,
  pickSafeFields,
} from "../EventTracker.js";

describe("EventTracker", () => {
  beforeEach(() => {
    resetEventTracker();
  });

  describe("track + getEvents", () => {
    it("legger til events i kronologisk rekkefølge", () => {
      const tracker = new EventTracker({ bufferSize: 100 });
      tracker.track("user.click", { button: "buy_popup_trigger" });
      tracker.track("api.request", { url: "/api/game1/purchase" });

      const events = tracker.getEvents();
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("user.click");
      expect(events[1].type).toBe("api.request");
    });

    it("returnerer event-id med 'evt-N'-format", () => {
      const tracker = new EventTracker();
      const id1 = tracker.track("user.click");
      const id2 = tracker.track("user.click");
      expect(id1).toMatch(/^evt-\d+$/);
      expect(id2).toMatch(/^evt-\d+$/);
      expect(id1).not.toBe(id2);
    });

    it("setter timestamp + iso på hver event", () => {
      const tracker = new EventTracker();
      const before = Date.now();
      tracker.track("user.click");
      const after = Date.now();

      const event = tracker.getEvents()[0];
      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
      expect(event.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("propagerer traceId + correlationId", () => {
      const tracker = new EventTracker();
      tracker.track(
        "socket.emit",
        { event: "bet:arm" },
        { traceId: "trace-abc", correlationId: "corr-123" },
      );
      const event = tracker.getEvents()[0];
      expect(event.traceId).toBe("trace-abc");
      expect(event.correlationId).toBe("corr-123");
    });
  });

  describe("ring-buffer FIFO", () => {
    it("dropper eldste event når buffer er full", () => {
      const tracker = new EventTracker({ bufferSize: 3 });
      tracker.track("user.click", { idx: 1 });
      tracker.track("user.click", { idx: 2 });
      tracker.track("user.click", { idx: 3 });
      tracker.track("user.click", { idx: 4 });
      tracker.track("user.click", { idx: 5 });

      const events = tracker.getEvents();
      expect(events).toHaveLength(3);
      expect(events[0].payload.idx).toBe(3);
      expect(events[2].payload.idx).toBe(5);
    });

    it("teller droppedCount korrekt", () => {
      const tracker = new EventTracker({ bufferSize: 2 });
      tracker.track("user.click");
      tracker.track("user.click");
      tracker.track("user.click");
      tracker.track("user.click");

      const exported = tracker.export();
      expect(exported.droppedCount).toBe(2);
      expect(exported.totalTracked).toBe(4);
      expect(exported.events).toHaveLength(2);
    });

    it("håndhever min-buffer 1 (clamp negative/zero opts.bufferSize)", () => {
      const tracker = new EventTracker({ bufferSize: 0 });
      tracker.track("user.click", { idx: 1 });
      tracker.track("user.click", { idx: 2 });
      // Buffer-size minimum 1 — siste event beholdes.
      expect(tracker.getEvents()).toHaveLength(1);
      expect(tracker.getEvents()[0].payload.idx).toBe(2);
    });
  });

  describe("clear", () => {
    it("tømmer buffer + resetter droppedCount + totalTracked", () => {
      const tracker = new EventTracker({ bufferSize: 5 });
      tracker.track("user.click");
      tracker.track("user.click");
      tracker.clear();

      expect(tracker.getEvents()).toHaveLength(0);
      const exported = tracker.export();
      expect(exported.droppedCount).toBe(0);
      expect(exported.totalTracked).toBe(0);
    });
  });

  describe("sessionContext", () => {
    it("starter med alle null-felter", () => {
      const tracker = new EventTracker();
      expect(tracker.getSessionContext()).toEqual({
        userId: null,
        playerId: null,
        hallId: null,
        roomCode: null,
        scheduledGameId: null,
        currentScreen: null,
      });
    });

    it("setSessionContext er partial-update", () => {
      const tracker = new EventTracker();
      tracker.setSessionContext({ userId: "user-1", hallId: "hall-A" });
      tracker.setSessionContext({ roomCode: "BINGO_ABC" });

      expect(tracker.getSessionContext()).toEqual({
        userId: "user-1",
        playerId: null,
        hallId: "hall-A",
        roomCode: "BINGO_ABC",
        scheduledGameId: null,
        currentScreen: null,
      });
    });

    it("inkluderes i export-rapport", () => {
      const tracker = new EventTracker();
      tracker.setSessionContext({ userId: "u1", playerId: "p1" });
      const exported = tracker.export();
      expect(exported.sessionContext.userId).toBe("u1");
      expect(exported.sessionContext.playerId).toBe("p1");
    });
  });

  describe("export", () => {
    it("har generatedAt + userAgent + url + events", () => {
      const tracker = new EventTracker();
      tracker.track("user.click", { button: "buy" });
      const exported = tracker.export();

      expect(exported.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof exported.userAgent).toBe("string");
      expect(typeof exported.url).toBe("string");
      expect(exported.events).toHaveLength(1);
    });
  });

  describe("subscribe", () => {
    it("kaller listener for nye events", () => {
      const tracker = new EventTracker();
      const listener = vi.fn();
      tracker.subscribe(listener);

      tracker.track("user.click", { button: "x" });
      tracker.track("api.request");

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ type: "user.click" }),
      );
    });

    it("unsubscribe stopper notifications", () => {
      const tracker = new EventTracker();
      const listener = vi.fn();
      const unsub = tracker.subscribe(listener);

      tracker.track("user.click");
      unsub();
      tracker.track("user.click");

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("syk listener tar ikke ned tracker-en", () => {
      const tracker = new EventTracker();
      const goodListener = vi.fn();
      tracker.subscribe(() => {
        throw new Error("syk");
      });
      tracker.subscribe(goodListener);

      // Skal ikke kaste; goodListener skal fortsatt få event-en.
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(() => tracker.track("user.click")).not.toThrow();
      expect(goodListener).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  describe("sanitize / GDPR", () => {
    it("redaktér password / token / accessToken", () => {
      const tracker = new EventTracker();
      tracker.track("api.request", {
        url: "/api/auth/login",
        password: "hemmelig123",
        accessToken: "jwt-abc.def",
        body: { token: "x" },
      });

      const event = tracker.getEvents()[0];
      expect(event.payload.password).toBe("[REDACTED]");
      expect(event.payload.accessToken).toBe("[REDACTED]");
      expect((event.payload.body as Record<string, unknown>).token).toBe(
        "[REDACTED]",
      );
      expect(event.payload.url).toBe("/api/auth/login");
    });

    it("trunkér strenger > 500 tegn", () => {
      const tracker = new EventTracker();
      const long = "x".repeat(700);
      tracker.track("error.client", { message: long });
      const event = tracker.getEvents()[0];
      const payloadMessage = event.payload.message as string;
      expect(payloadMessage.length).toBeLessThanOrEqual(515);
      expect(payloadMessage.endsWith("...(truncated)")).toBe(true);
    });

    it("trunkér arrays > 50 elementer", () => {
      const tracker = new EventTracker();
      const arr = Array.from({ length: 80 }, (_, i) => i);
      tracker.track("socket.recv", { ballSequence: arr });
      const event = tracker.getEvents()[0];
      const tracked = event.payload.ballSequence as unknown[];
      expect(tracked).toHaveLength(51);
      expect(tracked[50]).toBe("...(30 more)");
    });

    it("strip nested objects ned til 3 nivåer", () => {
      const tracker = new EventTracker();
      tracker.track("state.change", {
        a: {
          b: {
            c: {
              d: {
                e: "for dypt",
              },
            },
          },
        },
      });
      const event = tracker.getEvents()[0];
      // Naviger ned 4 nivåer for å treffe truncation-grensen
      const level3 = ((event.payload.a as Record<string, unknown>)
        .b as Record<string, unknown>).c as Record<string, unknown>;
      // På nivå 4 skal vi se truncation-markeren istedenfor full struktur
      expect(level3.d).toEqual({ __truncated: "(max-depth-reached)" });
    });
  });

  describe("singleton", () => {
    it("getEventTracker returnerer samme instans", () => {
      const t1 = getEventTracker();
      const t2 = getEventTracker();
      expect(t1).toBe(t2);
    });

    it("resetEventTracker lager ny instans neste gang", () => {
      const t1 = getEventTracker();
      resetEventTracker();
      const t2 = getEventTracker();
      expect(t1).not.toBe(t2);
    });
  });
});

describe("payloadKeysOnly", () => {
  it("returnerer keys-array fra payload", () => {
    expect(payloadKeysOnly({ a: 1, b: 2 })).toEqual({ payloadKeys: ["a", "b"] });
  });

  it("håndterer null/undefined", () => {
    expect(payloadKeysOnly(null)).toEqual({ payloadKeys: [] });
    expect(payloadKeysOnly(undefined)).toEqual({ payloadKeys: [] });
  });
});

describe("pickSafeFields", () => {
  it("inkluderer payloadKeys + utvalgte safe-fields", () => {
    const result = pickSafeFields(
      { roomCode: "BINGO", drawIndex: 5, tickets: [1, 2, 3] },
      ["roomCode", "drawIndex"],
    );
    expect(result).toEqual({
      payloadKeys: ["roomCode", "drawIndex", "tickets"],
      roomCode: "BINGO",
      drawIndex: 5,
    });
  });

  it("hopper over manglende safe-fields", () => {
    const result = pickSafeFields({ a: 1 }, ["b", "c"]);
    expect(result).toEqual({ payloadKeys: ["a"] });
  });

  it("håndterer null payload", () => {
    expect(pickSafeFields(null, ["a"])).toEqual({ payloadKeys: [] });
  });
});

describe("EventTracker.trackFetch (Tobias-direktiv 2026-05-12)", () => {
  beforeEach(() => {
    resetEventTracker();
  });

  it("tracker en rest.fetch-event med url + method", () => {
    const tracker = new EventTracker();
    tracker.trackFetch({ url: "/api/game1/purchase", method: "POST" });
    const events = tracker.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("rest.fetch");
    expect(events[0].payload.url).toBe("/api/game1/purchase");
    expect(events[0].payload.method).toBe("POST");
  });

  it("inkluderer request-body, response-status, response-body og varighet", () => {
    const tracker = new EventTracker();
    tracker.trackFetch({
      url: "/api/game1/purchase",
      method: "POST",
      requestBody: { scheduledGameId: "sg-1", ticketSpecCount: 3 },
      responseStatus: 200,
      responseBody: { ok: true, errorCode: null },
      durationMs: 142,
    });
    const event = tracker.getEvents()[0];
    expect(event.payload).toMatchObject({
      url: "/api/game1/purchase",
      method: "POST",
      requestBody: { scheduledGameId: "sg-1", ticketSpecCount: 3 },
      responseStatus: 200,
      durationMs: 142,
    });
    const respBody = event.payload.responseBody as Record<string, unknown>;
    expect(respBody.ok).toBe(true);
    expect(respBody.errorCode).toBeNull();
  });

  it("hopper over undefined/null felter (idempotent ved minimal input)", () => {
    const tracker = new EventTracker();
    tracker.trackFetch({
      url: "/api/x",
      method: "GET",
      // requestBody, responseStatus, responseBody, durationMs alle undefined
    });
    const event = tracker.getEvents()[0];
    expect(event.payload).not.toHaveProperty("requestBody");
    expect(event.payload).not.toHaveProperty("responseStatus");
    expect(event.payload).not.toHaveProperty("responseBody");
    expect(event.payload).not.toHaveProperty("durationMs");
  });

  it("sanitizer fjerner sensitive felter i requestBody", () => {
    const tracker = new EventTracker();
    tracker.trackFetch({
      url: "/api/auth/login",
      method: "POST",
      requestBody: { email: "test@example.com", password: "hemmelig" },
    });
    const event = tracker.getEvents()[0];
    const reqBody = event.payload.requestBody as Record<string, unknown>;
    expect(reqBody.email).toBe("test@example.com");
    expect(reqBody.password).toBe("[REDACTED]");
  });

  it("propagerer correlationId + traceId", () => {
    const tracker = new EventTracker();
    tracker.trackFetch({
      url: "/api/x",
      method: "POST",
      correlationId: "corr-1",
      traceId: "trace-2",
    });
    const event = tracker.getEvents()[0];
    expect(event.correlationId).toBe("corr-1");
    expect(event.traceId).toBe("trace-2");
  });

  it("returnerer event-id slik at caller kan korrelere senere events", () => {
    const tracker = new EventTracker();
    const id = tracker.trackFetch({ url: "/api/x", method: "GET" });
    expect(id).toMatch(/^evt-\d+$/);
    expect(tracker.getEvents()[0].id).toBe(id);
  });

  it("kan kalles flere ganger uten å forstyrre ring-buffer-en", () => {
    const tracker = new EventTracker();
    tracker.trackFetch({ url: "/api/a", method: "GET" });
    tracker.trackFetch({ url: "/api/b", method: "POST" });
    tracker.trackFetch({ url: "/api/c", method: "DELETE" });
    const events = tracker.getEvents();
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.payload.url)).toEqual([
      "/api/a",
      "/api/b",
      "/api/c",
    ]);
  });
});
