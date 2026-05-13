/**
 * @vitest-environment happy-dom
 *
 * Tester for SocketEmitInstrument (Tobias-direktiv 2026-05-13).
 *
 * Dekker:
 *   - Idempotent install
 *   - emit-metode trackes som socket.emit + socket.recv med korrelasjon
 *   - Ack med ok=false trackes med errorCode
 *   - Kastet exception fra emit trackes som socket.recv med error
 *   - uninstall restorer originale metoder
 */

import { describe, it, expect, beforeEach } from "vitest";
import { installSocketEmitInstrument } from "../SocketEmitInstrument.js";
import { getEventTracker, resetEventTracker } from "../EventTracker.js";

interface FakeSocket {
  createRoom?: (
    payload: Record<string, unknown>,
  ) => Promise<{ ok: boolean; error?: { code?: string } }>;
  buyTickets?: (
    payload: Record<string, unknown>,
  ) => Promise<{ ok: boolean; error?: { code?: string } }>;
  irrelevant?: () => void;
}

describe("SocketEmitInstrument", () => {
  beforeEach(() => {
    resetEventTracker();
  });

  it("er idempotent — re-install returnerer no-op", () => {
    const socket: FakeSocket = {
      createRoom: async () => ({ ok: true }),
    };
    const u1 = installSocketEmitInstrument(socket as unknown as object);
    const u2 = installSocketEmitInstrument(socket as unknown as object);
    expect(typeof u1).toBe("function");
    expect(typeof u2).toBe("function");
    u1();
  });

  it("tracker socket.emit + socket.recv ved vellykket call", async () => {
    const socket: FakeSocket = {
      createRoom: async () => ({ ok: true }),
    };
    const uninstall = installSocketEmitInstrument(socket as unknown as object);

    await (socket.createRoom!({ roomCode: "R1", hallId: "h1" }));

    const tracker = getEventTracker();
    const events = tracker.getEvents();
    const emit = events.find((e) => e.type === "socket.emit");
    const recv = events.find((e) => e.type === "socket.recv");
    expect(emit).toBeDefined();
    expect(emit?.payload["method"]).toBe("createRoom");
    expect(emit?.payload["roomCode"]).toBe("R1");
    expect(emit?.payload["payloadKeys"]).toEqual(["roomCode", "hallId"]);

    expect(recv).toBeDefined();
    expect(recv?.payload["method"]).toBe("createRoom");
    expect(recv?.payload["ok"]).toBe(true);
    expect(recv?.correlationId).toBe(emit?.id);

    uninstall();
  });

  it("tracker socket.recv med errorCode når ack.ok=false", async () => {
    const socket: FakeSocket = {
      buyTickets: async () => ({
        ok: false,
        error: { code: "INSUFFICIENT_FUNDS" },
      }),
    };
    const uninstall = installSocketEmitInstrument(socket as unknown as object);

    await socket.buyTickets!({ ticketCount: 5 });

    const tracker = getEventTracker();
    const events = tracker.getEvents();
    const recv = events.find((e) => e.type === "socket.recv");
    expect(recv?.payload["ok"]).toBe(false);
    expect(recv?.payload["errorCode"]).toBe("INSUFFICIENT_FUNDS");

    uninstall();
  });

  it("tracker socket.recv med error når emit kaster exception", async () => {
    const socket: FakeSocket = {
      createRoom: async () => {
        throw new Error("network down");
      },
    };
    const uninstall = installSocketEmitInstrument(socket as unknown as object);

    let caught = false;
    try {
      await socket.createRoom!({});
    } catch {
      caught = true;
    }
    expect(caught).toBe(true);

    const tracker = getEventTracker();
    const events = tracker.getEvents();
    const recv = events.find((e) => e.type === "socket.recv");
    expect(recv?.payload["ok"]).toBe(false);
    expect(recv?.payload["error"]).toContain("network down");

    uninstall();
  });

  it("rør ikke metoder som ikke er i EMIT_METHODS-listen", async () => {
    let irrelevantCalled = false;
    const socket: FakeSocket = {
      irrelevant: () => {
        irrelevantCalled = true;
      },
    };
    const uninstall = installSocketEmitInstrument(socket as unknown as object);

    socket.irrelevant!();
    expect(irrelevantCalled).toBe(true);

    // Tracker bør være tom (irrelevant er ikke EMIT_METHOD)
    const tracker = getEventTracker();
    const emits = tracker.getEvents().filter((e) => e.type === "socket.emit");
    expect(emits).toHaveLength(0);

    uninstall();
  });

  it("uninstall restorerer originale metoder", async () => {
    let counter = 0;
    const originalImpl = async () => {
      counter++;
      return { ok: true };
    };
    const socket: FakeSocket = {
      createRoom: originalImpl,
    };
    const uninstall = installSocketEmitInstrument(socket as unknown as object);

    // Etter install — `createRoom` skal være wrapped
    expect(socket.createRoom).not.toBe(originalImpl);

    uninstall();

    // Etter uninstall — restorert
    expect(socket.createRoom).toBe(originalImpl);

    await socket.createRoom!({});
    expect(counter).toBe(1);
  });
});
