/**
 * @vitest-environment happy-dom
 *
 * Tester for RrwebRecorder (Tobias-direktiv 2026-05-13).
 *
 * Dekker:
 *   - Constructor validerer token (kreves non-empty)
 *   - start() initialiserer rrweb (via injisert recordFn) og scheduler flush
 *   - Events fra rrweb buffres og flushes som batch
 *   - flushNow() trigger umiddelbar batch-send
 *   - HTTP 401/403 dropper batch og setter lastErrorCode
 *   - Network error øker failureCount, queue beholdes for retry
 *   - markBug() legger til type=99-event og flusher umiddelbart
 *   - stop() rydder timer + kaller rrweb's stop-callback
 *   - getStatus() returner full snapshot for HUD
 *   - Idempotency: start() to ganger er no-op
 *   - Singleton: setupRrwebRecorder / getRrwebRecorder / reset
 *   - Path: fetch URL inneholder ?token=
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  RrwebRecorder,
  type RrwebEvent,
  type RrwebRecordFn,
  setupRrwebRecorder,
  getRrwebRecorder,
  resetRrwebRecorder,
} from "./RrwebRecorder.js";

/**
 * Mock rrweb's `record`-funksjon. Returnerer en stop-callback og lar
 * caller fyre events ved å kalle den returnerte `emit`-callback-en.
 *
 * Bruksmønster:
 *   const { recordFn, emit, stopSpy } = createMockRecord();
 *   const recorder = new RrwebRecorder({ token: "x", recordFn });
 *   await recorder.start();
 *   emit({ type: 2, timestamp: 1, data: {} }); // simuler DOM-mutation
 */
function createMockRecord(): {
  recordFn: RrwebRecordFn;
  emit: (event: RrwebEvent) => void;
  stopSpy: ReturnType<typeof vi.fn>;
} {
  let capturedEmit: ((event: RrwebEvent) => void) | null = null;
  const stopSpy = vi.fn();
  const recordFn: RrwebRecordFn = (opts) => {
    capturedEmit = opts.emit;
    return stopSpy;
  };
  return {
    recordFn,
    emit: (event: RrwebEvent) => {
      if (capturedEmit) capturedEmit(event);
    },
    stopSpy,
  };
}

/**
 * Mock fetch som returnerer ok=true status 200 by default.
 * Sporer alle calls slik at tester kan inspisere body / url / token.
 */
function createMockFetch(opts: {
  ok?: boolean;
  status?: number;
  throwError?: Error;
} = {}) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (opts.throwError) throw opts.throwError;
      const status = opts.status ?? 200;
      return {
        ok: opts.ok ?? status < 400,
        status,
      } as Response;
    },
  );
  return { fetchImpl, calls };
}

describe("RrwebRecorder", () => {
  beforeEach(() => {
    resetRrwebRecorder();
  });

  afterEach(() => {
    resetRrwebRecorder();
  });

  describe("constructor", () => {
    it("krever non-empty token", () => {
      expect(
        () =>
          new RrwebRecorder({
            token: "",
            fetchImpl: vi.fn(),
            recordFn: vi.fn(),
          }),
      ).toThrow(/token er påkrevd/);
    });

    it("trimmed empty token er ikke OK", () => {
      expect(
        () =>
          new RrwebRecorder({
            token: "   ",
            fetchImpl: vi.fn(),
            recordFn: vi.fn(),
          }),
      ).toThrow(/token er påkrevd/);
    });

    it("setter sensible defaults", () => {
      const { recordFn } = createMockRecord();
      const recorder = new RrwebRecorder({
        token: "x",
        fetchImpl: vi.fn(),
        recordFn,
      });
      const status = recorder.getStatus();
      expect(status.running).toBe(false);
      expect(status.sessionId).toBe(null);
      expect(status.queueLength).toBe(0);
      expect(status.markedBugs).toEqual([]);
    });
  });

  describe("start()", () => {
    it("initialiserer rrweb via recordFn og setter running=true", async () => {
      const { recordFn } = createMockRecord();
      const recorder = new RrwebRecorder({
        token: "x",
        fetchImpl: vi.fn(),
        recordFn,
      });
      await recorder.start();
      const status = recorder.getStatus();
      expect(status.running).toBe(true);
      expect(status.sessionId).toMatch(/^\d+-[a-z0-9]{6}$/);
      expect(status.startedAt).toBeGreaterThan(0);
      recorder.stop();
    });

    it("er idempotent — andre start() er no-op", async () => {
      const recordFnSpy = vi.fn().mockReturnValue(vi.fn());
      const recorder = new RrwebRecorder({
        token: "x",
        fetchImpl: vi.fn(),
        recordFn: recordFnSpy as unknown as RrwebRecordFn,
      });
      await recorder.start();
      await recorder.start();
      expect(recordFnSpy).toHaveBeenCalledTimes(1);
      recorder.stop();
    });

    it("bruker custom sessionId hvis angitt", async () => {
      const { recordFn } = createMockRecord();
      const recorder = new RrwebRecorder({
        token: "x",
        fetchImpl: vi.fn(),
        recordFn,
        sessionId: "custom-session-1",
      });
      await recorder.start();
      expect(recorder.getStatus().sessionId).toBe("custom-session-1");
      recorder.stop();
    });

    it("håndterer null fra recordFn (rrweb returnerer undefined)", async () => {
      const recordFn: RrwebRecordFn = () => undefined;
      const recorder = new RrwebRecorder({
        token: "x",
        fetchImpl: vi.fn(),
        recordFn,
      });
      await recorder.start();
      expect(recorder.getStatus().running).toBe(true);
      recorder.stop();
    });
  });

  describe("event buffering and flush", () => {
    it("buffers events fra rrweb i kø", async () => {
      const { fetchImpl } = createMockFetch();
      const { recordFn, emit } = createMockRecord();
      const recorder = new RrwebRecorder({
        token: "x",
        fetchImpl,
        recordFn,
        flushIntervalMs: 100_000, // for å unngå auto-flush i test
      });
      await recorder.start();
      emit({ type: 2, timestamp: 100, data: {} });
      emit({ type: 3, timestamp: 200, data: {} });
      const status = recorder.getStatus();
      expect(status.queueLength).toBe(2);
      expect(status.eventsRecorded).toBe(2);
      recorder.stop();
    });

    it("flushNow() sender batch til endpoint med token i URL", async () => {
      const { fetchImpl, calls } = createMockFetch();
      const { recordFn, emit } = createMockRecord();
      const recorder = new RrwebRecorder({
        token: "my-test-token",
        fetchImpl,
        recordFn,
        flushIntervalMs: 100_000,
        sessionId: "test-session-x",
      });
      await recorder.start();
      emit({ type: 2, timestamp: 1, data: { node: "root" } });
      emit({ type: 3, timestamp: 2, data: { source: 1 } });
      await recorder.flushNow();
      expect(calls).toHaveLength(1);
      expect(calls[0]!.url).toContain("/api/_dev/debug/rrweb-events");
      expect(calls[0]!.url).toContain("token=my-test-token");
      const body = JSON.parse(calls[0]!.init?.body as string);
      expect(body.sessionId).toBe("test-session-x");
      expect(body.events).toHaveLength(2);
      expect(body.events[0]).toEqual({ type: 2, timestamp: 1, data: { node: "root" } });
      expect(recorder.getStatus().eventsSent).toBe(2);
      expect(recorder.getStatus().queueLength).toBe(0);
      recorder.stop();
    });

    it("respekterer maxBatchSize ved flush", async () => {
      const { fetchImpl, calls } = createMockFetch();
      const { recordFn, emit } = createMockRecord();
      const recorder = new RrwebRecorder({
        token: "x",
        fetchImpl,
        recordFn,
        flushIntervalMs: 100_000,
        maxBatchSize: 3,
      });
      await recorder.start();
      for (let i = 0; i < 5; i++) {
        emit({ type: 3, timestamp: i, data: {} });
      }
      await recorder.flushNow();
      // Første flush sendte 3, 2 igjen i kø
      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0]!.init?.body as string);
      expect(body.events).toHaveLength(3);
      expect(recorder.getStatus().queueLength).toBe(2);
      recorder.stop();
    });

    it("ved HTTP 200: tømmer batch fra kø", async () => {
      const { fetchImpl } = createMockFetch({ status: 200 });
      const { recordFn, emit } = createMockRecord();
      const recorder = new RrwebRecorder({
        token: "x",
        fetchImpl,
        recordFn,
        flushIntervalMs: 100_000,
      });
      await recorder.start();
      emit({ type: 3, timestamp: 1, data: {} });
      await recorder.flushNow();
      expect(recorder.getStatus().queueLength).toBe(0);
      expect(recorder.getStatus().flushCount).toBe(1);
      expect(recorder.getStatus().lastErrorCode).toBe(null);
      recorder.stop();
    });
  });

  describe("error handling", () => {
    it("ved HTTP 401: dropper batch + setter errorCode HTTP_401", async () => {
      const { fetchImpl } = createMockFetch({ status: 401 });
      const { recordFn, emit } = createMockRecord();
      const recorder = new RrwebRecorder({
        token: "x",
        fetchImpl,
        recordFn,
        flushIntervalMs: 100_000,
      });
      await recorder.start();
      emit({ type: 3, timestamp: 1, data: {} });
      await recorder.flushNow();
      expect(recorder.getStatus().queueLength).toBe(0);
      expect(recorder.getStatus().failureCount).toBe(1);
      expect(recorder.getStatus().lastErrorCode).toBe("HTTP_401");
      recorder.stop();
    });

    it("ved HTTP 403: dropper batch + setter errorCode HTTP_403", async () => {
      const { fetchImpl } = createMockFetch({ status: 403 });
      const { recordFn, emit } = createMockRecord();
      const recorder = new RrwebRecorder({
        token: "x",
        fetchImpl,
        recordFn,
        flushIntervalMs: 100_000,
      });
      await recorder.start();
      emit({ type: 3, timestamp: 1, data: {} });
      await recorder.flushNow();
      expect(recorder.getStatus().queueLength).toBe(0);
      expect(recorder.getStatus().failureCount).toBe(1);
      expect(recorder.getStatus().lastErrorCode).toBe("HTTP_403");
      recorder.stop();
    });

    it("ved HTTP 500: BEHOLDER batch i kø for retry", async () => {
      const { fetchImpl } = createMockFetch({ status: 500 });
      const { recordFn, emit } = createMockRecord();
      const recorder = new RrwebRecorder({
        token: "x",
        fetchImpl,
        recordFn,
        flushIntervalMs: 100_000,
      });
      await recorder.start();
      emit({ type: 3, timestamp: 1, data: {} });
      await recorder.flushNow();
      // 500 ≠ 401/403 → vi beholder batchen så neste flush kan retry
      expect(recorder.getStatus().queueLength).toBe(1);
      expect(recorder.getStatus().failureCount).toBe(1);
      expect(recorder.getStatus().lastErrorCode).toBe("HTTP_500");
      recorder.stop();
    });

    it("ved network error: increment failureCount, behold kø", async () => {
      const { fetchImpl } = createMockFetch({
        throwError: new Error("network failure"),
      });
      const { recordFn, emit } = createMockRecord();
      const recorder = new RrwebRecorder({
        token: "x",
        fetchImpl,
        recordFn,
        flushIntervalMs: 100_000,
      });
      await recorder.start();
      emit({ type: 3, timestamp: 1, data: {} });
      await recorder.flushNow();
      expect(recorder.getStatus().queueLength).toBe(1);
      expect(recorder.getStatus().failureCount).toBe(1);
      expect(recorder.getStatus().lastErrorCode).toContain("NETWORK_");
      recorder.stop();
    });

    it("ved rrweb.record() throw: setter errorCode + running=false", async () => {
      const recordFn: RrwebRecordFn = () => {
        throw new Error("rrweb internal error");
      };
      const recorder = new RrwebRecorder({
        token: "x",
        fetchImpl: vi.fn(),
        recordFn,
      });
      await recorder.start();
      expect(recorder.getStatus().running).toBe(false);
      expect(recorder.getStatus().lastErrorCode).toBe("RRWEB_RECORD_THREW");
    });
  });

  describe("markBug()", () => {
    it("legger til type=99-event og flusher umiddelbart", async () => {
      const { fetchImpl, calls } = createMockFetch();
      const { recordFn, emit } = createMockRecord();
      const recorder = new RrwebRecorder({
        token: "x",
        fetchImpl,
        recordFn,
        flushIntervalMs: 100_000,
        sessionId: "bug-test",
      });
      await recorder.start();
      emit({ type: 2, timestamp: 100, data: {} });
      await recorder.markBug("popup-blocked");
      // markBug skal ha flushet
      expect(calls).toHaveLength(1);
      const body = JSON.parse(calls[0]!.init?.body as string);
      // Type=99-marker er siste event i batchen
      const lastEvent = body.events[body.events.length - 1];
      expect(lastEvent.type).toBe(99);
      expect(lastEvent.data.__bugMark).toBe(true);
      expect(lastEvent.data.label).toBe("popup-blocked");
      // Status reflekterer marker
      const status = recorder.getStatus();
      expect(status.markedBugs).toHaveLength(1);
      expect(status.markedBugs[0]!.label).toBe("popup-blocked");
      recorder.stop();
    });

    it("warner men ikke krasjer hvis markBug kalt før start()", async () => {
      const { recordFn } = createMockRecord();
      const recorder = new RrwebRecorder({
        token: "x",
        fetchImpl: vi.fn(),
        recordFn,
      });
      // Ikke kalt start() — skal logge warning + returnere uten throws
      await expect(recorder.markBug("never-started")).resolves.toBeUndefined();
      expect(recorder.getStatus().markedBugs).toHaveLength(0);
    });
  });

  describe("stop()", () => {
    it("kaller rrweb-stop-callback og rydder timer", async () => {
      const { recordFn, stopSpy } = createMockRecord();
      const recorder = new RrwebRecorder({
        token: "x",
        fetchImpl: vi.fn(),
        recordFn,
        flushIntervalMs: 100_000,
      });
      await recorder.start();
      recorder.stop();
      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(recorder.getStatus().running).toBe(false);
    });

    it("er idempotent — to stop() er no-op", async () => {
      const { recordFn, stopSpy } = createMockRecord();
      const recorder = new RrwebRecorder({
        token: "x",
        fetchImpl: vi.fn(),
        recordFn,
      });
      await recorder.start();
      recorder.stop();
      recorder.stop();
      expect(stopSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("singleton API", () => {
    it("setupRrwebRecorder er idempotent", () => {
      const { recordFn } = createMockRecord();
      const a = setupRrwebRecorder({
        token: "x",
        fetchImpl: vi.fn(),
        recordFn,
      });
      const b = setupRrwebRecorder({
        token: "y",  // forskjellig token — bør ignoreres
        fetchImpl: vi.fn(),
        recordFn,
      });
      expect(a).toBe(b);
    });

    it("getRrwebRecorder returnerer null før setup", () => {
      expect(getRrwebRecorder()).toBe(null);
    });

    it("getRrwebRecorder returnerer singleton etter setup", () => {
      const { recordFn } = createMockRecord();
      const r = setupRrwebRecorder({
        token: "x",
        fetchImpl: vi.fn(),
        recordFn,
      });
      expect(getRrwebRecorder()).toBe(r);
    });

    it("resetRrwebRecorder stopper og clearer singleton", async () => {
      const { recordFn, stopSpy } = createMockRecord();
      const r = setupRrwebRecorder({
        token: "x",
        fetchImpl: vi.fn(),
        recordFn,
      });
      await r.start();
      resetRrwebRecorder();
      expect(stopSpy).toHaveBeenCalledTimes(1);
      expect(getRrwebRecorder()).toBe(null);
    });
  });
});
