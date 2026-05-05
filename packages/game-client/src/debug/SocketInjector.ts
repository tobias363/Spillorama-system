/**
 * Socket-event injector (Component 5).
 *
 * Two operations the operator can run from console:
 *
 *   - `emit(name, payload)` — actually send an event to the backend via
 *     the live socket. Useful when the UI doesn't expose a button for a
 *     rare operator action (e.g. force-claim during a test). The injector
 *     wraps the existing `__emitForDebug` so the wire-protocol stays
 *     centralised in `SpilloramaSocket.emit()`.
 *
 *   - `simulateRecv(name, payload)` — pretend the backend just sent us
 *     `name` with `payload`. We feed the payload through the same
 *     dispatch path as a live event (`__dispatchForTest`), so listeners
 *     react identically to "the real thing". This is how an operator
 *     reproduces a server-bug without server cooperation.
 *
 * Both operations log via the debug-logger so the buffer captures them
 * alongside real traffic.
 */

import type { SpilloramaSocket, SpilloramaSocketListeners } from "../net/SpilloramaSocket.js";
import type { DebugLogger } from "./debugLogger.js";

/** Type alias kept loose — operators paste arbitrary payloads from server logs. */
type AnyPayload = Record<string, unknown> | unknown;

interface SocketLike {
  __emitForDebug?: (event: string, payload: AnyPayload) => Promise<unknown>;
  __dispatchForTest: <K extends keyof SpilloramaSocketListeners>(
    channel: K,
    payload: Parameters<SpilloramaSocketListeners[K]>[0],
  ) => void;
}

export class SocketInjector {
  private socket: SpilloramaSocket | null = null;
  private logger: DebugLogger | null = null;

  constructor(socket?: SpilloramaSocket, logger?: DebugLogger) {
    if (socket) this.socket = socket;
    if (logger) this.logger = logger;
  }

  setSocket(socket: SpilloramaSocket | null): void {
    this.socket = socket;
  }

  setLogger(logger: DebugLogger): void {
    this.logger = logger;
  }

  /**
   * Send a custom event through the live socket. Returns the ack promise
   * if the underlying socket exposes `__emitForDebug` (we add this in
   * `installDebugSuite` via prototype monkey-patch), otherwise `null`.
   *
   * SAFETY: backend authoritatively validates every emit. The injector
   * just hands the payload to socket.io — it cannot bypass server-side
   * RBAC or compliance gates.
   */
  async emit(name: string, payload: AnyPayload): Promise<unknown> {
    this.logger?.info("socket-out", `inject.${name}`, payload);
    const sock = this.socket as unknown as SocketLike | null;
    if (!sock?.__emitForDebug) {
      this.logger?.warn(
        "system",
        "inject.emit.unavailable",
        { hint: "Socket has no __emitForDebug — was suite installed before connect?" },
      );
      return null;
    }
    try {
      return await sock.__emitForDebug(name, payload);
    } catch (err) {
      this.logger?.error("socket-out", "inject.emit.failed", { err: String(err) });
      throw err;
    }
  }

  /**
   * Synthesise an incoming event. The channel-name maps onto the same
   * listener-set the live `socket.on(SocketEvents.X, ...)` handlers feed.
   *
   * Common channels: `roomUpdate`, `drawNew`, `patternWon`, `chatMessage`,
   * `walletState`, `betRejected`. See SpilloramaSocketListeners for the
   * full list.
   */
  simulateRecv<K extends keyof SpilloramaSocketListeners>(
    channel: K,
    payload: Parameters<SpilloramaSocketListeners[K]>[0],
  ): void {
    this.logger?.info("socket-in", `simulate.${String(channel)}`, payload);
    const sock = this.socket as unknown as SocketLike | null;
    if (!sock) {
      this.logger?.warn("system", "inject.simulate.no-socket");
      return;
    }
    try {
      sock.__dispatchForTest(channel, payload);
    } catch (err) {
      this.logger?.error("socket-in", "inject.simulate.failed", {
        channel: String(channel),
        err: String(err),
      });
    }
  }
}
