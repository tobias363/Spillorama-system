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
  private readonly listeners = new Map<string, Listener[]>();
  on(event: string, cb: Listener): this {
    const arr = this.listeners.get(event) ?? [];
    arr.push(cb);
    this.listeners.set(event, arr);
    return this;
  }
  emit(): this {
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
