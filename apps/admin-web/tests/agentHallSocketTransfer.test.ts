/**
 * Task 1.6: tester for AgentHallSocket transfer-event-filtrering.
 *
 * Verifiserer at `onTransferRequest` kun kalles når payload.toHallId eller
 * .fromHallId matcher options.hallId — event fra andre haller ignoreres.
 */

import { describe, it, expect, vi } from "vitest";
import {
  AgentHallSocket,
  type AgentTransferRequest,
} from "../src/pages/agent-portal/agentHallSocket.js";

vi.mock("../src/api/client.js", () => ({
  getToken: () => "tok",
  apiRequest: async () => ({}),
  ApiError: class extends Error {},
}));

type Listener = (payload: unknown) => void;

class FakeSocket {
  public connected = false;
  public readonly emits: Array<{ event: string; payload: unknown }> = [];
  private readonly listeners = new Map<string, Listener[]>();
  on(event: string, cb: Listener): this {
    const arr = this.listeners.get(event) ?? [];
    arr.push(cb);
    this.listeners.set(event, arr);
    return this;
  }
  emit(event: string, payload?: unknown, _ack?: (...args: unknown[]) => void): this {
    this.emits.push({ event, payload });
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

function sample(toHallId: string, fromHallId = "hall-master"): AgentTransferRequest {
  return {
    requestId: "r1",
    gameId: "g1",
    fromHallId,
    toHallId,
    initiatedByUserId: "u",
    initiatedAtMs: Date.now(),
    validTillMs: Date.now() + 60_000,
    status: "pending",
    respondedByUserId: null,
    respondedAtMs: null,
    rejectReason: null,
  };
}

describe("Task 1.6: AgentHallSocket transfer-filter", () => {
  it("onTransferRequest trigger når toHallId matcher hallId", () => {
    const fake = new FakeSocket();
    const onTransferRequest = vi.fn();
    const socket = new AgentHallSocket({
      hallId: "hall-b",
      onHallEvent: () => {},
      onTransferRequest,
      _ioFactory: (() => fake as never) as never,
    });
    fake.simulateConnect();
    fake.trigger("game1:transfer-request", sample("hall-b"));
    expect(onTransferRequest).toHaveBeenCalledTimes(1);
    socket.dispose();
  });

  it("onTransferRequest trigger når fromHallId matcher (initiator får også event)", () => {
    const fake = new FakeSocket();
    const onTransferRequest = vi.fn();
    const socket = new AgentHallSocket({
      hallId: "hall-a",
      onHallEvent: () => {},
      onTransferRequest,
      _ioFactory: (() => fake as never) as never,
    });
    fake.simulateConnect();
    fake.trigger("game1:transfer-request", sample("hall-b", "hall-a"));
    expect(onTransferRequest).toHaveBeenCalledTimes(1);
    socket.dispose();
  });

  it("onTransferRequest ignoreres når verken toHallId eller fromHallId matcher", () => {
    const fake = new FakeSocket();
    const onTransferRequest = vi.fn();
    const socket = new AgentHallSocket({
      hallId: "hall-c",
      onHallEvent: () => {},
      onTransferRequest,
      _ioFactory: (() => fake as never) as never,
    });
    fake.simulateConnect();
    fake.trigger("game1:transfer-request", sample("hall-b", "hall-a"));
    expect(onTransferRequest).not.toHaveBeenCalled();
    socket.dispose();
  });

  it("uten hallId leverer alle events (backwards-compat for test)", () => {
    const fake = new FakeSocket();
    const onTransferRequest = vi.fn();
    const socket = new AgentHallSocket({
      onHallEvent: () => {},
      onTransferRequest,
      _ioFactory: (() => fake as never) as never,
    });
    fake.simulateConnect();
    fake.trigger("game1:transfer-request", sample("hall-b", "hall-a"));
    expect(onTransferRequest).toHaveBeenCalledTimes(1);
    socket.dispose();
  });
});

// ── ADR-0019 P0-3 (Wave 1, 2026-05-10): subscribeGame for admin-masters-rom ──

describe("ADR-0019: AgentHallSocket admin:game1:subscribe wiring", () => {
  it("emits admin:login etter connect", () => {
    const fake = new FakeSocket();
    const socket = new AgentHallSocket({
      hallId: "hall-a",
      onHallEvent: () => {},
      _ioFactory: (() => fake as never) as never,
    });
    fake.simulateConnect();
    // Første emit etter connect skal være admin:login med token.
    const loginEmit = fake.emits.find((e) => e.event === "admin:login");
    expect(loginEmit).toBeDefined();
    expect(loginEmit?.payload).toEqual({ accessToken: "tok" });
    socket.dispose();
  });

  it("subscribeGame sender admin:game1:subscribe når connected", () => {
    const fake = new FakeSocket();
    const socket = new AgentHallSocket({
      hallId: "hall-a",
      onHallEvent: () => {},
      _ioFactory: (() => fake as never) as never,
    });
    fake.simulateConnect();
    fake.emits.length = 0; // clear emits-buffer
    socket.subscribeGame("scheduled-game-1");
    const subEmit = fake.emits.find((e) => e.event === "admin:game1:subscribe");
    expect(subEmit).toBeDefined();
    expect(subEmit?.payload).toEqual({ gameId: "scheduled-game-1" });
    socket.dispose();
  });

  it("subscribeGame bytter abonnement (unsubscribe + subscribe)", () => {
    const fake = new FakeSocket();
    const socket = new AgentHallSocket({
      hallId: "hall-a",
      onHallEvent: () => {},
      _ioFactory: (() => fake as never) as never,
    });
    fake.simulateConnect();
    socket.subscribeGame("game-1");
    fake.emits.length = 0;
    socket.subscribeGame("game-2");
    const unsubEmit = fake.emits.find((e) => e.event === "admin:game1:unsubscribe");
    const subEmit = fake.emits.find((e) => e.event === "admin:game1:subscribe");
    expect(unsubEmit?.payload).toEqual({ gameId: "game-1" });
    expect(subEmit?.payload).toEqual({ gameId: "game-2" });
    socket.dispose();
  });

  it("subscribeGame idempotent når samme gameId allerede aktiv", () => {
    const fake = new FakeSocket();
    const socket = new AgentHallSocket({
      hallId: "hall-a",
      onHallEvent: () => {},
      _ioFactory: (() => fake as never) as never,
    });
    fake.simulateConnect();
    socket.subscribeGame("game-1");
    fake.emits.length = 0;
    socket.subscribeGame("game-1");
    expect(fake.emits).toEqual([]);
    socket.dispose();
  });

  it("dispose sender admin:game1:unsubscribe for aktivt gameId", () => {
    const fake = new FakeSocket();
    const socket = new AgentHallSocket({
      hallId: "hall-a",
      onHallEvent: () => {},
      _ioFactory: (() => fake as never) as never,
    });
    fake.simulateConnect();
    socket.subscribeGame("game-1");
    fake.emits.length = 0;
    socket.dispose();
    const unsubEmit = fake.emits.find((e) => e.event === "admin:game1:unsubscribe");
    expect(unsubEmit?.payload).toEqual({ gameId: "game-1" });
  });
});
