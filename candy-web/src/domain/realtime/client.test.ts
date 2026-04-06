import { describe, it, expect, vi } from "vitest";
import { emitWithAck } from "@/domain/realtime/client";

function createMockSocket(ackDelayMs: number | null, ackResponse?: unknown) {
  return {
    emit: vi.fn((_event: string, _payload: unknown, callback: (response: unknown) => void) => {
      if (ackDelayMs !== null) {
        setTimeout(() => callback(ackResponse ?? { ok: true, data: {} }), ackDelayMs);
      }
      // If ackDelayMs is null, never call the callback (simulate server not responding)
    }),
  } as unknown as import("socket.io-client").Socket;
}

describe("emitWithAck", () => {
  it("resolves with the server response when ack arrives before timeout", async () => {
    const socket = createMockSocket(10, { ok: true, data: { value: 42 } });
    const result = await emitWithAck(socket, "test:event", { foo: "bar" }, 500);
    expect(result).toEqual({ ok: true, data: { value: 42 } });
  });

  it("resolves with a timeout error when server does not respond", async () => {
    vi.useFakeTimers();
    const socket = createMockSocket(null);
    const promise = emitWithAck(socket, "test:event", {}, 200);
    vi.advanceTimersByTime(200);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TIMEOUT");
    expect(result.error?.message).toContain("test:event");
    expect(result.error?.message).toContain("200ms");
    vi.useRealTimers();
  });

  it("ignores a late server response after timeout has fired", async () => {
    vi.useFakeTimers();
    const socket = createMockSocket(500, { ok: true, data: { late: true } });
    const promise = emitWithAck(socket, "test:event", {}, 100);
    vi.advanceTimersByTime(100);
    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("TIMEOUT");

    // Advance past the late ack — should not throw or change the resolved value
    vi.advanceTimersByTime(500);
    vi.useRealTimers();
  });

  it("passes event name and payload to the socket", async () => {
    const socket = createMockSocket(0, { ok: true });
    await emitWithAck(socket, "room:state", { roomCode: "ABC" }, 500);
    expect(socket.emit).toHaveBeenCalledWith("room:state", { roomCode: "ABC" }, expect.any(Function));
  });
});
