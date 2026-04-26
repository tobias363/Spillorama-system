/**
 * MED-1: Socket.IO trace-id wrapper tests.
 *
 * Socket.IO's real Server/Socket are heavyweight to spin up in a unit
 * test, so we hand-roll a minimal stub that exposes the same surface
 * area we depend on (`socket.data`, `socket.id`, `socket.on`) and verify
 * the wrap-on-event behaviour:
 *
 *   1. `socketTraceMiddleware` stamps `socket.data.traceId`.
 *   2. After `wrapSocketEventHandlers`, every emitted event handler runs
 *      inside an ALS context that carries the connection's traceId AND a
 *      unique per-event requestId.
 *   3. A handler that awaits async work still observes the same traceId.
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { Socket } from "socket.io";
import {
  socketTraceMiddleware,
  wrapSocketEventHandlers,
} from "./socketTraceId.js";
import { getTraceContext } from "../util/traceContext.js";

type Listener = (...args: unknown[]) => void;

interface FakeSocket {
  id: string;
  data: Record<string, unknown>;
  on(event: string, handler: Listener): FakeSocket;
  emit(event: string, ...args: unknown[]): void;
}

function makeFakeSocket(id: string): Socket {
  const listeners = new Map<string, Listener>();
  const fake: FakeSocket = {
    id,
    data: {},
    on(event: string, handler: Listener): FakeSocket {
      listeners.set(event, handler);
      return fake;
    },
    emit(event: string, ...args: unknown[]) {
      const handler = listeners.get(event);
      if (handler) handler(...args);
    },
  };
  return fake as unknown as Socket;
}

test("socketTraceMiddleware stamps a traceId on socket.data", () => {
  const socket = makeFakeSocket("sock-1");
  let nextCalled = false;
  socketTraceMiddleware(socket, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.ok(socket.data.traceId, "socket.data.traceId must be set");
  assert.match(socket.data.traceId as string, /^[a-zA-Z0-9_.-]+$/);
});

test("wrapSocketEventHandlers runs each event handler inside the trace-context", () => {
  const socket = makeFakeSocket("sock-2");
  socketTraceMiddleware(socket, () => {});
  const baseTraceId = socket.data.traceId as string;
  wrapSocketEventHandlers(socket);

  let observedTrace: string | undefined;
  let observedRequest: string | undefined;
  let observedSocketId: string | undefined;

  socket.on("ticket:mark", () => {
    const ctx = getTraceContext();
    observedTrace = ctx?.traceId;
    observedRequest = ctx?.requestId;
    observedSocketId = ctx?.socketId;
  });

  // Outside any event the global ALS is empty.
  assert.equal(getTraceContext(), undefined);

  // Emitting fires the wrapped handler synchronously inside ALS.
  (socket as unknown as { emit(e: string): void }).emit("ticket:mark");

  assert.equal(observedTrace, baseTraceId);
  assert.equal(observedSocketId, "sock-2");
  assert.ok(observedRequest, "per-event requestId must be set");
  assert.notEqual(observedRequest, baseTraceId, "requestId differs per event");

  // Outside the handler, the global ALS is empty again.
  assert.equal(getTraceContext(), undefined);
});

test("socket event-handler keeps trace-context across async work (DB-call case)", async () => {
  const socket = makeFakeSocket("sock-3");
  socketTraceMiddleware(socket, () => {});
  const baseTraceId = socket.data.traceId as string;
  wrapSocketEventHandlers(socket);

  const observedAfterAwait: string[] = [];

  socket.on("draw:next", async () => {
    observedAfterAwait.push(getTraceContext()!.traceId);
    await Promise.resolve();
    observedAfterAwait.push(getTraceContext()!.traceId);
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    observedAfterAwait.push(getTraceContext()!.traceId);
  });

  await new Promise<void>((resolve) => {
    socket.on("__test_done", () => resolve());
    (socket as unknown as { emit(e: string): void }).emit("draw:next");
    setTimeout(() => (socket as unknown as { emit(e: string): void }).emit("__test_done"), 20);
  });

  assert.deepEqual(observedAfterAwait, [baseTraceId, baseTraceId, baseTraceId]);
});

test("each emitted event in one connection gets a fresh requestId, but the same traceId", () => {
  const socket = makeFakeSocket("sock-4");
  socketTraceMiddleware(socket, () => {});
  const baseTraceId = socket.data.traceId as string;
  wrapSocketEventHandlers(socket);

  const requestIds: string[] = [];
  socket.on("noop", () => {
    requestIds.push(getTraceContext()!.requestId!);
    assert.equal(getTraceContext()?.traceId, baseTraceId);
  });

  for (let i = 0; i < 3; i++) {
    (socket as unknown as { emit(e: string): void }).emit("noop");
  }

  assert.equal(requestIds.length, 3);
  assert.equal(new Set(requestIds).size, 3, "each event must have a distinct requestId");
});
