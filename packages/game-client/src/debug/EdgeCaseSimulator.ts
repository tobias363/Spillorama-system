/**
 * Edge-case simulators (Component 6).
 *
 * Pre-canned scenarios for hard-to-trigger conditions:
 *
 *   - `simulateOffline(ms)` — disconnect socket, hold for `ms`, reconnect.
 *     Mirrors what the browser's `online`/`offline` events do, so the
 *     auto-recovery path in `SpilloramaSocket` exercises.
 *
 *   - `simulateLatency(ms)` — install a setTimeout shim around outgoing
 *     emits. Combined with simulatePacketLoss this approximates a
 *     mobile/captive-network scenario.
 *
 *   - `simulatePacketLoss(percent)` — drop a random fraction of outgoing
 *     events. Server reacts with timeouts on missing acks, exercising
 *     resync flows.
 *
 *   - `simulateRaceCondition(config)` — pre-defined named scenarios for
 *     known-bad orderings (host-disconnect-mid-draw, listener-late-bind,
 *     dual-claim-in-same-tick). Each scenario produces a sequence of
 *     synthetic events.
 *
 * All simulators log via the structured logger so the buffer captures
 * the simulation as a first-class event-stream.
 */

import type { SpilloramaSocket, SpilloramaSocketListeners } from "../net/SpilloramaSocket.js";
import type { DebugLogger } from "./debugLogger.js";

export type RaceCondition =
  | { type: "host-disconnect-mid-draw"; drawIndex?: number }
  | { type: "double-claim"; ticketId?: string }
  | { type: "listener-late-bind"; channel?: keyof SpilloramaSocketListeners }
  | { type: "duplicate-draw"; number?: number };

interface SocketLike {
  emitWithDelay?: (event: string, payload: unknown, delayMs: number) => Promise<unknown>;
  __dispatchForTest: <K extends keyof SpilloramaSocketListeners>(
    channel: K,
    payload: Parameters<SpilloramaSocketListeners[K]>[0],
  ) => void;
  disconnect: () => void;
  connect: () => void;
  isConnected: () => boolean;
}

export class EdgeCaseSimulator {
  private socket: SpilloramaSocket | null = null;
  private logger: DebugLogger | null = null;
  private latencyMs = 0;
  private packetLossPercent = 0;

  setSocket(socket: SpilloramaSocket | null): void {
    this.socket = socket;
  }

  setLogger(logger: DebugLogger): void {
    this.logger = logger;
  }

  /** Read latency setting — callers (the suite installer) install the actual emit-shim. */
  getLatency(): number {
    return this.latencyMs;
  }

  /** Read packet-loss setting. Range 0..100. */
  getPacketLoss(): number {
    return this.packetLossPercent;
  }

  setLatency(ms: number): void {
    this.latencyMs = Math.max(0, ms);
    this.logger?.info("system", "simulate.latency.set", { ms: this.latencyMs });
  }

  setPacketLoss(percent: number): void {
    this.packetLossPercent = Math.min(100, Math.max(0, percent));
    this.logger?.info("system", "simulate.packetLoss.set", {
      percent: this.packetLossPercent,
    });
  }

  /**
   * Returns true if a synthesised "drop" should happen for this emit, based
   * on the configured packet-loss percent. Used by the suite installer's
   * emit-shim. Stateless RNG so test-doubles can replace `Math.random`.
   */
  shouldDrop(rng: () => number = Math.random): boolean {
    if (this.packetLossPercent <= 0) return false;
    return rng() * 100 < this.packetLossPercent;
  }

  async simulateOffline(durationMs: number): Promise<void> {
    if (!this.socket) {
      this.logger?.warn("system", "simulate.offline.no-socket");
      return;
    }
    const sock = this.socket as unknown as SocketLike;
    this.logger?.warn("system", "simulate.offline.start", { durationMs });
    sock.disconnect();
    // Wait — the backend's keepalive will eventually consider us gone, and
    // the auto-reconnect window in SpilloramaSocket triggers on `online`.
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.max(0, durationMs)),
    );
    sock.connect();
    this.logger?.success("system", "simulate.offline.end");
  }

  /**
   * Run a named race-condition. Each scenario synthesises events on the
   * receive path so the operator can observe how the client recovers.
   *
   * The scenarios deliberately use safe payloads (small numeric ticks,
   * empty strings) so they don't corrupt the operator's session.
   */
  async simulateRaceCondition(config: RaceCondition): Promise<void> {
    if (!this.socket) {
      this.logger?.warn("system", "simulate.race.no-socket");
      return;
    }
    this.logger?.warn("system", "simulate.race.start", { config });
    const sock = this.socket as unknown as SocketLike;

    switch (config.type) {
      case "host-disconnect-mid-draw": {
        // Issue a `drawNew` then immediately drop the connection, then
        // come back. This is the classic "host went offline mid-round"
        // scenario.
        const number = Math.floor(Math.random() * 75) + 1;
        const drawIndex = config.drawIndex ?? 1;
        sock.__dispatchForTest("drawNew", {
          roomCode: "SIM-HD",
          number,
          drawIndex,
          drawnNumbers: [number],
          // Other fields filled in defensively as undefined so the
          // GameBridge handler fails gracefully if it expects them.
        } as unknown as Parameters<SpilloramaSocketListeners["drawNew"]>[0]);
        sock.disconnect();
        await new Promise((r) => setTimeout(r, 1500));
        sock.connect();
        break;
      }
      case "double-claim": {
        const ticketId = config.ticketId ?? "ticket-debug-1";
        for (let i = 0; i < 2; i++) {
          sock.__dispatchForTest("patternWon", {
            roomCode: "SIM-DC",
            ticketId,
            patternId: "row-1",
            playerId: "debug-player",
          } as unknown as Parameters<SpilloramaSocketListeners["patternWon"]>[0]);
        }
        break;
      }
      case "listener-late-bind": {
        // We can't actually "un-bind" listeners from outside, but we can
        // demonstrate the buffer behaviour: dispatch into a channel
        // before any listener attaches. The BIN-501 buffer should catch
        // it.
        const channel = (config.channel ?? "drawNew") as keyof SpilloramaSocketListeners;
        sock.__dispatchForTest(channel as "drawNew", {
          roomCode: "SIM-LB",
          number: 1,
          drawIndex: 0,
          drawnNumbers: [1],
        } as unknown as Parameters<SpilloramaSocketListeners["drawNew"]>[0]);
        break;
      }
      case "duplicate-draw": {
        const number = config.number ?? 7;
        sock.__dispatchForTest("drawNew", {
          roomCode: "SIM-DD",
          number,
          drawIndex: 5,
          drawnNumbers: [number],
        } as unknown as Parameters<SpilloramaSocketListeners["drawNew"]>[0]);
        // immediately again with same drawIndex — bridge should dedupe
        sock.__dispatchForTest("drawNew", {
          roomCode: "SIM-DD",
          number,
          drawIndex: 5,
          drawnNumbers: [number],
        } as unknown as Parameters<SpilloramaSocketListeners["drawNew"]>[0]);
        break;
      }
      default: {
        const exhaustive: never = config;
        void exhaustive;
        this.logger?.warn("system", "simulate.race.unknown");
      }
    }

    this.logger?.success("system", "simulate.race.end", { config });
  }
}
