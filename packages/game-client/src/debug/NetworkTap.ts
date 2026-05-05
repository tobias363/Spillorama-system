/**
 * Network-tap (Component 9).
 *
 * In-memory ring buffer of "frame metadata" — direction, event-type,
 * payload-size, latency. The tap doesn't intercept the WebSocket directly
 * (socket.io abstracts that away into engine.io frames); instead it taps
 * the Socket.IO emit/dispatch hooks the suite installer monkey-patches.
 *
 * Why care about size? At pilot scale (24 halls × 1500 players = 36 000
 * concurrent sockets) bytes-per-second per socket multiplied by 36 000
 * tells you whether you'll saturate the 100 Mbit Render egress. A
 * `room:update` payload that grew from 2KB to 8KB is a 4x throughput
 * regression — the tap surfaces that immediately.
 *
 * Ring is FIFO with a 2000-frame default cap. At ~5 events/sec/player,
 * that's 6 minutes of history — enough to triangulate a slow-network
 * incident.
 */

export type NetworkDirection = "sent" | "received";

export interface NetworkFrame {
  /** Wall-clock millis. */
  timestamp: number;
  /** High-resolution millis (for latency math). */
  performanceTime: number;
  direction: NetworkDirection;
  eventType: string;
  /** Approx byte length of the JSON-serialised payload. */
  size: number;
  /** Latency in ms — only present for `sent` frames that got an ack. */
  latencyMs?: number;
  /** Whether the frame was dropped by an active simulator. */
  dropped?: boolean;
}

export interface NetworkAPI {
  frames: () => NetworkFrame[];
  /** Frames in the last `windowMs` milliseconds. */
  window: (windowMs: number) => NetworkFrame[];
  /** Bytes per second over the window. */
  throughput: (windowMs?: number) => { sent: number; received: number };
  clear: () => void;
}

const DEFAULT_CAP = 2000;

export class NetworkTap implements NetworkAPI {
  private cap: number;
  private items: NetworkFrame[] = [];

  constructor(cap = DEFAULT_CAP) {
    this.cap = Math.max(1, cap);
  }

  /**
   * Record a frame. The suite installer wraps `socket.emit` and the
   * dispatch path with `record(...)` calls.
   *
   * `payload` is sized via JSON.stringify; if the payload is non-
   * serialisable, we record `size: -1` rather than throwing.
   */
  record(
    direction: NetworkDirection,
    eventType: string,
    payload: unknown,
    extras: { latencyMs?: number; dropped?: boolean } = {},
  ): NetworkFrame {
    let size = -1;
    try {
      const s = JSON.stringify(payload);
      size = s ? s.length : 0;
    } catch {
      size = -1;
    }
    const frame: NetworkFrame = {
      timestamp: Date.now(),
      performanceTime: typeof performance !== "undefined" ? performance.now() : Date.now(),
      direction,
      eventType,
      size,
      latencyMs: extras.latencyMs,
      dropped: extras.dropped,
    };
    this.items.push(frame);
    if (this.items.length > this.cap) {
      this.items.splice(0, this.items.length - this.cap);
    }
    return frame;
  }

  frames(): NetworkFrame[] {
    return this.items.slice();
  }

  window(windowMs: number): NetworkFrame[] {
    if (windowMs <= 0) return [];
    const cutoff = (typeof performance !== "undefined" ? performance.now() : Date.now()) - windowMs;
    return this.items.filter((f) => f.performanceTime >= cutoff);
  }

  throughput(windowMs = 5000): { sent: number; received: number } {
    if (windowMs <= 0) return { sent: 0, received: 0 };
    const frames = this.window(windowMs);
    let sent = 0;
    let received = 0;
    for (const f of frames) {
      if (f.size < 0 || f.dropped) continue;
      if (f.direction === "sent") sent += f.size;
      else received += f.size;
    }
    const seconds = windowMs / 1000;
    return {
      sent: sent / seconds,
      received: received / seconds,
    };
  }

  clear(): void {
    this.items.length = 0;
  }
}
