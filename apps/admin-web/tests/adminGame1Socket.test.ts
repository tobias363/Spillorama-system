/**
 * GAME1_SCHEDULE PR 4d.3b: tester for AdminGame1Socket-wrapper.
 *
 * Dekker:
 *   - Emit subscribe ved connect + ved gameId-bytte
 *   - Filtrerer events mot currentGameId
 *   - Fallback-timer: trigges etter disconnectGraceMs uten reconnect
 *   - Fallback avsluttes ved reconnect
 *   - Dispose rydder socket + timer
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AdminGame1Socket } from "../src/pages/games/master/adminGame1Socket.js";

// Mock getToken så konstruktøren ikke faller om auth-modulen ikke er initialisert.
vi.mock("../src/api/client.js", () => ({
  getToken: () => "tok-admin",
  setToken: () => {},
  clearToken: () => {},
  apiRequest: async () => ({}),
  ApiError: class extends Error {},
}));

// ── Fake Socket ─────────────────────────────────────────────────────────────

type Listener = (payload: unknown) => void;

class FakeSocket {
  public connected = false;
  public readonly emitted: Array<{ event: string; payload: unknown }> = [];
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, cb: Listener): this {
    const arr = this.listeners.get(event) ?? [];
    arr.push(cb);
    this.listeners.set(event, arr);
    return this;
  }

  emit(event: string, payload?: unknown): this {
    this.emitted.push({ event, payload });
    return this;
  }

  removeAllListeners(): this {
    this.listeners.clear();
    return this;
  }

  disconnect(): this {
    this.connected = false;
    this.trigger("disconnect", null);
    return this;
  }

  // Test-helpers
  trigger(event: string, payload: unknown): void {
    const arr = this.listeners.get(event) ?? [];
    for (const cb of arr) cb(payload);
  }

  simulateConnect(): void {
    this.connected = true;
    this.trigger("connect", null);
  }

  simulateDisconnect(): void {
    this.connected = false;
    this.trigger("disconnect", null);
  }
}

function makeHarness() {
  const fake = new FakeSocket();
  const ioFactory = vi.fn(() => fake as never);
  const onStatusUpdate = vi.fn();
  const onDrawProgressed = vi.fn();
  const onFallbackActive = vi.fn();
  const adminSocket = new AdminGame1Socket({
    baseUrl: "http://test",
    disconnectGraceMs: 100,
    onStatusUpdate,
    onDrawProgressed,
    onFallbackActive,
    _ioFactory: ioFactory,
  });
  return {
    fake,
    adminSocket,
    onStatusUpdate,
    onDrawProgressed,
    onFallbackActive,
    ioFactory,
  };
}

describe("AdminGame1Socket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sender subscribe ved connect når gameId er satt", () => {
    const { fake, adminSocket } = makeHarness();
    adminSocket.subscribe("sg-1");
    // Ikke connected ennå → ingen subscribe emit.
    expect(fake.emitted).toEqual([]);

    fake.simulateConnect();

    expect(fake.emitted).toEqual([
      { event: "game1:subscribe", payload: { gameId: "sg-1" } },
    ]);
  });

  it("sender subscribe umiddelbart hvis allerede connected", () => {
    const { fake, adminSocket } = makeHarness();
    fake.simulateConnect();
    adminSocket.subscribe("sg-2");
    expect(fake.emitted).toEqual([
      { event: "game1:subscribe", payload: { gameId: "sg-2" } },
    ]);
  });

  it("bytter gameId → unsubscribe forrige + subscribe ny", () => {
    const { fake, adminSocket } = makeHarness();
    fake.simulateConnect();
    adminSocket.subscribe("sg-A");
    adminSocket.subscribe("sg-B");
    expect(fake.emitted).toEqual([
      { event: "game1:subscribe", payload: { gameId: "sg-A" } },
      { event: "game1:unsubscribe", payload: { gameId: "sg-A" } },
      { event: "game1:subscribe", payload: { gameId: "sg-B" } },
    ]);
  });

  it("ignorerer status-update for annen gameId", () => {
    const { fake, adminSocket, onStatusUpdate } = makeHarness();
    fake.simulateConnect();
    adminSocket.subscribe("sg-A");
    fake.trigger("game1:status-update", {
      gameId: "sg-OTHER",
      status: "paused",
      action: "pause",
      auditId: "a-1",
      actorUserId: "u-1",
      at: 1,
    });
    expect(onStatusUpdate).not.toHaveBeenCalled();
  });

  it("leverer status-update for matchende gameId", () => {
    const { fake, adminSocket, onStatusUpdate } = makeHarness();
    fake.simulateConnect();
    adminSocket.subscribe("sg-A");
    const payload = {
      gameId: "sg-A",
      status: "running",
      action: "start",
      auditId: "a-1",
      actorUserId: "u-1",
      at: 2,
    };
    fake.trigger("game1:status-update", payload);
    expect(onStatusUpdate).toHaveBeenCalledWith(payload);
  });

  it("leverer draw-progressed for matchende gameId", () => {
    const { fake, adminSocket, onDrawProgressed } = makeHarness();
    fake.simulateConnect();
    adminSocket.subscribe("sg-A");
    const payload = {
      gameId: "sg-A",
      ballNumber: 12,
      drawIndex: 3,
      currentPhase: 1,
      at: 3,
    };
    fake.trigger("game1:draw-progressed", payload);
    expect(onDrawProgressed).toHaveBeenCalledWith(payload);
  });

  it("fallback-trigger: onFallbackActive(true) etter disconnectGraceMs uten reconnect", () => {
    const { fake, adminSocket, onFallbackActive } = makeHarness();
    fake.simulateConnect();
    adminSocket.subscribe("sg-A");
    fake.simulateDisconnect();

    expect(onFallbackActive).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);

    expect(onFallbackActive).toHaveBeenCalledWith(true);
  });

  it("reconnect kansellerer fallback-timer hvis før 10s", () => {
    const { fake, adminSocket, onFallbackActive } = makeHarness();
    fake.simulateConnect();
    adminSocket.subscribe("sg-A");
    fake.simulateDisconnect();
    vi.advanceTimersByTime(50);
    fake.simulateConnect();
    vi.advanceTimersByTime(200);

    expect(onFallbackActive).not.toHaveBeenCalled();
  });

  it("reconnect etter fallback → onFallbackActive(false) + re-subscribe", () => {
    const { fake, adminSocket, onFallbackActive } = makeHarness();
    fake.simulateConnect();
    adminSocket.subscribe("sg-A");
    fake.simulateDisconnect();
    vi.advanceTimersByTime(100);
    expect(onFallbackActive).toHaveBeenCalledWith(true);

    fake.simulateConnect();

    expect(onFallbackActive).toHaveBeenLastCalledWith(false);
    // Siste emit skal være ny subscribe for sg-A.
    expect(fake.emitted.at(-1)).toEqual({
      event: "game1:subscribe",
      payload: { gameId: "sg-A" },
    });
  });

  it("dispose rydder socket + kansellerer fallback-timer", () => {
    const { fake, adminSocket, onFallbackActive } = makeHarness();
    fake.simulateConnect();
    adminSocket.subscribe("sg-A");
    fake.simulateDisconnect();
    adminSocket.dispose();
    vi.advanceTimersByTime(500);
    expect(onFallbackActive).not.toHaveBeenCalled();
    expect(fake.emitted.at(-1)?.event).toBe("game1:unsubscribe");
  });

  it("connect_error under reconnection-forsøk trigger fallback etter grace", () => {
    const { fake, adminSocket, onFallbackActive } = makeHarness();
    adminSocket.subscribe("sg-A");
    // Ingen connect skjedde — simulate connect_error direkte
    fake.trigger("connect_error", new Error("ECONNREFUSED"));
    vi.advanceTimersByTime(100);
    expect(onFallbackActive).toHaveBeenCalledWith(true);
  });

  it("isConnected + isFallbackActive eksponerer riktig tilstand", () => {
    const { fake, adminSocket } = makeHarness();
    expect(adminSocket.isConnected()).toBe(false);
    expect(adminSocket.isFallbackActive()).toBe(false);

    fake.simulateConnect();
    expect(adminSocket.isConnected()).toBe(true);

    fake.simulateDisconnect();
    vi.advanceTimersByTime(100);
    expect(adminSocket.isFallbackActive()).toBe(true);
  });
});
