/**
 * Task 1.6: tester for master-transfer-UI-integrasjonen i Game1MasterConsole.
 *
 * Scope:
 *   - AdminGame1Socket-wrapper: onTransferRequest/Approved/Rejected/Expired
 *     callbacks trigges på matching gameId
 *   - fetchActiveGame1Transfer + request/approve/reject API-calls bruker
 *     riktige URLer og body-shapes
 */

import { describe, it, expect, vi } from "vitest";
import { AdminGame1Socket } from "../src/pages/games/master/adminGame1Socket.js";
import {
  requestGame1MasterTransfer,
  approveGame1MasterTransfer,
  rejectGame1MasterTransfer,
  fetchActiveGame1Transfer,
} from "../src/api/admin-game1-master.js";

vi.mock("../src/api/client.js", () => ({
  getToken: () => "tok",
  setToken: () => {},
  clearToken: () => {},
  apiRequest: vi.fn(async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    // Rutespesifikke mocks
    if (path.includes("/transfer-master/request")) {
      return {
        request: {
          id: "req-1",
          gameId: "g1",
          fromHallId: "hall-a",
          toHallId: (opts.body as { toHallId: string }).toHallId,
          initiatedByUserId: "u-a",
          initiatedAt: "2026-04-24T10:00:00Z",
          validTill: new Date(Date.now() + 60_000).toISOString(),
          status: "pending",
          respondedByUserId: null,
          respondedAt: null,
          rejectReason: null,
        },
      };
    }
    if (path.includes("/master-transfers/") && path.endsWith("/approve")) {
      return {
        request: {
          id: "req-1",
          gameId: "g1",
          fromHallId: "hall-a",
          toHallId: "hall-b",
          initiatedByUserId: "u-a",
          initiatedAt: "2026-04-24T10:00:00Z",
          validTill: "2026-04-24T10:01:00Z",
          status: "approved",
          respondedByUserId: "u-b",
          respondedAt: "2026-04-24T10:00:30Z",
          rejectReason: null,
        },
        previousMasterHallId: "hall-a",
        newMasterHallId: "hall-b",
      };
    }
    if (path.includes("/master-transfers/") && path.endsWith("/reject")) {
      return {
        request: {
          id: "req-1",
          gameId: "g1",
          fromHallId: "hall-a",
          toHallId: "hall-b",
          initiatedByUserId: "u-a",
          initiatedAt: "2026-04-24T10:00:00Z",
          validTill: "2026-04-24T10:01:00Z",
          status: "rejected",
          respondedByUserId: "u-b",
          respondedAt: "2026-04-24T10:00:30Z",
          rejectReason: (opts.body as { reason?: string } | undefined)?.reason ?? null,
        },
      };
    }
    if (path.includes("/transfer-request")) {
      return { request: null };
    }
    return {};
  }),
  ApiError: class extends Error {},
}));

// ── Socket-wrapper ─────────────────────────────────────────────────────────

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
    return this;
  }
  trigger(event: string, payload: unknown): void {
    const arr = this.listeners.get(event) ?? [];
    for (const cb of arr) cb(payload);
  }
  simulateConnect(): void {
    this.connected = true;
    this.trigger("connect", null);
  }
}

describe("Task 1.6: AdminGame1Socket transfer-event callbacks", () => {
  it("onTransferRequest trigges når payload.gameId matcher subscribed gameId", () => {
    const fake = new FakeSocket();
    const onTransferRequest = vi.fn();
    const socket = new AdminGame1Socket({
      baseUrl: "http://t",
      disconnectGraceMs: 1000,
      onStatusUpdate: () => {},
      onDrawProgressed: () => {},
      onFallbackActive: () => {},
      onTransferRequest,
      _ioFactory: (() => fake as never) as never,
    });
    socket.subscribe("g1");
    fake.simulateConnect();
    fake.trigger("game1:transfer-request", {
      requestId: "r1",
      gameId: "g1",
      fromHallId: "hall-a",
      toHallId: "hall-b",
      initiatedByUserId: "u",
      initiatedAtMs: Date.now(),
      validTillMs: Date.now() + 60_000,
      status: "pending",
      respondedByUserId: null,
      respondedAtMs: null,
      rejectReason: null,
    });
    expect(onTransferRequest).toHaveBeenCalledTimes(1);
    socket.dispose();
  });

  it("onTransferRequest ignoreres når payload.gameId er annet spill", () => {
    const fake = new FakeSocket();
    const onTransferRequest = vi.fn();
    const socket = new AdminGame1Socket({
      baseUrl: "http://t",
      onStatusUpdate: () => {},
      onDrawProgressed: () => {},
      onFallbackActive: () => {},
      onTransferRequest,
      _ioFactory: (() => fake as never) as never,
    });
    socket.subscribe("g1");
    fake.simulateConnect();
    fake.trigger("game1:transfer-request", {
      requestId: "r1",
      gameId: "g2", // annet spill
      fromHallId: "hall-a",
      toHallId: "hall-b",
      initiatedByUserId: "u",
      initiatedAtMs: Date.now(),
      validTillMs: Date.now() + 60_000,
      status: "pending",
      respondedByUserId: null,
      respondedAtMs: null,
      rejectReason: null,
    });
    expect(onTransferRequest).not.toHaveBeenCalled();
    socket.dispose();
  });

  it("onMasterChanged trigges for subscribed gameId", () => {
    const fake = new FakeSocket();
    const onMasterChanged = vi.fn();
    const socket = new AdminGame1Socket({
      baseUrl: "http://t",
      onStatusUpdate: () => {},
      onDrawProgressed: () => {},
      onFallbackActive: () => {},
      onMasterChanged,
      _ioFactory: (() => fake as never) as never,
    });
    socket.subscribe("g1");
    fake.simulateConnect();
    fake.trigger("game1:master-changed", {
      gameId: "g1",
      previousMasterHallId: "hall-a",
      newMasterHallId: "hall-b",
      transferRequestId: "r1",
      at: Date.now(),
    });
    expect(onMasterChanged).toHaveBeenCalledTimes(1);
    socket.dispose();
  });
});

describe("Task 1.6: admin-game1-master API-adapter", () => {
  it("requestGame1MasterTransfer sender POST med toHallId", async () => {
    const result = await requestGame1MasterTransfer("g1", "hall-b");
    expect(result.request.toHallId).toBe("hall-b");
  });

  it("approveGame1MasterTransfer returnerer previousMasterHallId + newMasterHallId", async () => {
    const result = await approveGame1MasterTransfer("req-1");
    expect(result.newMasterHallId).toBe("hall-b");
    expect(result.previousMasterHallId).toBe("hall-a");
  });

  it("rejectGame1MasterTransfer med reason → rejectReason speiles", async () => {
    const result = await rejectGame1MasterTransfer("req-1", "opptatt");
    expect(result.request.status).toBe("rejected");
    expect(result.request.rejectReason).toBe("opptatt");
  });

  it("fetchActiveGame1Transfer returnerer {request: null} når ingen pending", async () => {
    const result = await fetchActiveGame1Transfer("g1");
    expect(result.request).toBeNull();
  });
});
