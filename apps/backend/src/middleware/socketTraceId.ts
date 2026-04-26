/**
 * MED-1: Socket.IO trace-id propagation.
 *
 * Socket.IO does not run a connection inside a single async-context — each
 * incoming event is dispatched on a fresh microtask. So we cannot just call
 * `runWithTraceContext` once at connection time and have it cover all
 * subsequent events.
 *
 * Strategy:
 *   1. `socketTraceMiddleware` runs at connection-time (`io.use`) and
 *      stamps a connection-level `traceId` on `socket.data.traceId`. This
 *      id correlates the entire socket lifecycle (connect → disconnect)
 *      and is exposed on the Socket-IO ack as well as in connection-event
 *      logs.
 *   2. `wrapSocketEventHandlers(socket)` patches `socket.on` so each event
 *      handler runs inside `runWithTraceContext` with that connection's
 *      base trace-id. Per-event traces also get a fresh `requestId` so a
 *      single connection emitting many events still has distinguishable
 *      log streams.
 *
 * Both pieces are no-op-safe: a socket whose middleware was skipped (e.g.
 * a unit test that pokes the engine directly) just gets traceId injection
 * skipped, not an error.
 */

import type { Server, Socket } from "socket.io";
import {
  newTraceId,
  runWithTraceContext,
  type TraceContext,
} from "../util/traceContext.js";

/**
 * Augment Socket.IO Socket with the resolved trace-id.
 */
declare module "socket.io" {
  interface SocketData {
    traceId?: string;
  }
}

/**
 * `io.use(socketTraceMiddleware)` — registers a connection-level traceId.
 * Idempotent: if `socket.data.traceId` is already set (test-fixture or
 * upstream middleware seeded it), we keep that value.
 */
export function socketTraceMiddleware(socket: Socket, next: (err?: Error) => void): void {
  if (!socket.data.traceId) {
    socket.data.traceId = newTraceId();
  }
  next();
}

/**
 * Wrap `socket.on` so every event handler runs inside an ALS context
 * carrying the connection's base trace-id and a fresh per-event
 * requestId. Call this exactly once per socket, in the `connection`
 * handler.
 *
 * Existing handlers don't need any code change — they just gain the
 * trace-context implicitly. Acks (callback args) inherit the same
 * context because they're invoked synchronously inside the handler.
 */
export function wrapSocketEventHandlers(socket: Socket): void {
  const baseTraceId = socket.data.traceId ?? newTraceId();
  socket.data.traceId = baseTraceId;

  const originalOn = socket.on.bind(socket);
  // We can't simply replace `socket.on` with the wrapped version because
  // Socket.IO's typings make the signature awkward; the wrap-on-use
  // pattern we use here lets us stay strict without `any`-casting the
  // entire EventEmitter contract.
  type Listener = (...args: unknown[]) => void;
  const wrappedOn = (event: string, handler: Listener): Socket => {
    const wrapped: Listener = (...args: unknown[]) => {
      const ctx: TraceContext = {
        traceId: baseTraceId,
        requestId: newTraceId(),
        socketId: socket.id,
      };
      // Mirror the user-id onto the trace-context if the auth-middleware
      // already attached it to socket.data.user. Helps with grep-by-user.
      const user = (socket.data as { user?: { walletId?: string; id?: string } }).user;
      if (user?.walletId) ctx.userId = user.walletId;
      else if (user?.id) ctx.userId = user.id;

      runWithTraceContext(ctx, () => handler(...args));
    };
    return originalOn(event, wrapped);
  };
  // Type-cast at the boundary; internal users (handlers) see no diff.
  (socket as unknown as { on: typeof wrappedOn }).on = wrappedOn;
}

/**
 * Convenience: install both pieces on a Socket.IO server in one call.
 *
 *   import { installSocketTraceContext } from "./middleware/socketTraceId.js";
 *   installSocketTraceContext(io);
 *   io.on("connection", (socket) => { ... your existing handlers ... });
 *
 * Caller must invoke this BEFORE any other `io.on("connection", ...)`
 * handlers so wrapping happens before user code attaches listeners.
 */
export function installSocketTraceContext(io: Server): void {
  io.use(socketTraceMiddleware);
  io.on("connection", (socket) => {
    wrapSocketEventHandlers(socket);
  });
}
