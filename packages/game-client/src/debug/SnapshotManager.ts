/**
 * Snapshot manager (Component 10).
 *
 * On every captured error (client-side `error`/`unhandledrejection`, or
 * a manual `takeSnapshot` call), persist:
 *
 *   - the last 100 events from the buffer
 *   - the current sanitised game-state (via the registered state-getter)
 *   - environmental info (URL, user-agent, performance.memory, network)
 *
 * Storage backend is IndexedDB when available, with an in-memory fallback
 * for environments that block it (private-mode Safari, etc.). Storage cap
 * = 20 snapshots; oldest evicted FIFO so the operator never needs to
 * manage disk.
 *
 * Each snapshot is exportable as a JSON blob the operator pastes into a
 * bug report — `snapshot.export()` returns the JSON string. We don't
 * call `URL.createObjectURL` here to keep the surface simple; operators
 * who want a file can wrap the JSON themselves.
 */

import type { DebugSnapshot, DebugEvent } from "./types.js";
import type { EventBuffer } from "./EventBuffer.js";

const DB_NAME = "spillorama.debug";
const DB_VERSION = 1;
const STORE = "snapshots";
const MAX_SNAPSHOTS = 20;

export class SnapshotManager {
  private buffer: EventBuffer;
  private stateGetter: (() => unknown) | null = null;
  /** In-memory mirror so synchronous `snapshots()` always works. */
  private memory: DebugSnapshot[] = [];
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private nextId = 1;

  constructor(buffer: EventBuffer) {
    this.buffer = buffer;
  }

  setStateGetter(getter: (() => unknown) | null): void {
    this.stateGetter = getter;
  }

  async init(): Promise<void> {
    this.dbPromise = openDb();
    const all = await this.loadFromDb();
    this.memory = all;
    if (this.memory.length > 0) {
      this.nextId = (parseSeq(this.memory[this.memory.length - 1].id) ?? 0) + 1;
    }
  }

  /**
   * Manually take a snapshot. Reason is short free-form text — typically
   * a one-word summary like "stuck-draw" or "host-offline".
   */
  async takeSnapshot(reason: string): Promise<DebugSnapshot> {
    const snapshot: DebugSnapshot = {
      id: `snap-${this.nextId.toString().padStart(4, "0")}`,
      createdAt: Date.now(),
      reason,
      events: clipEvents(this.buffer.last(100)),
      state: this.captureState(),
      env: captureEnv(),
    };
    this.nextId++;
    this.memory.push(snapshot);
    if (this.memory.length > MAX_SNAPSHOTS) {
      this.memory.splice(0, this.memory.length - MAX_SNAPSHOTS);
    }
    await this.persist(snapshot);
    return snapshot;
  }

  list(): DebugSnapshot[] {
    return this.memory.slice();
  }

  get(id: string): DebugSnapshot | null {
    return this.memory.find((s) => s.id === id) ?? null;
  }

  /**
   * Auto-capture hook. When wired up by the suite installer, every
   * `window.error` and `unhandledrejection` triggers a snapshot. We
   * include a small dedupe window so a runaway loop doesn't fill the
   * 20-snapshot quota with the same error in 200ms.
   */
  private lastAutoCaptureAt = 0;
  async maybeAutoCapture(reason: string): Promise<DebugSnapshot | null> {
    const now = Date.now();
    if (now - this.lastAutoCaptureAt < 1000) {
      return null;
    }
    this.lastAutoCaptureAt = now;
    try {
      return await this.takeSnapshot(reason);
    } catch {
      return null;
    }
  }

  // ---- internal ----

  private captureState(): unknown {
    if (!this.stateGetter) return null;
    try {
      return JSON.parse(JSON.stringify(this.stateGetter()));
    } catch {
      return "[unserialisable]";
    }
  }

  private async persist(snapshot: DebugSnapshot): Promise<void> {
    const db = await this.dbPromise;
    if (!db) return;
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(snapshot, snapshot.id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      // Cap on disk too — read all, drop oldest if over.
      const all = await this.loadFromDb();
      if (all.length > MAX_SNAPSHOTS) {
        const drop = all.slice(0, all.length - MAX_SNAPSHOTS);
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          for (const s of drop) tx.objectStore(STORE).delete(s.id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
    } catch {
      /* IDB can fail in restricted modes; we still have memory copy */
    }
  }

  private async loadFromDb(): Promise<DebugSnapshot[]> {
    const db = await (this.dbPromise ?? openDb());
    if (!db) return [];
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => {
          const items = (req.result ?? []) as DebugSnapshot[];
          items.sort((a, b) => a.createdAt - b.createdAt);
          resolve(items);
        };
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });
  }
}

/**
 * Open the IndexedDB. Returns `null` when IDB is unavailable so callers
 * fall back to in-memory storage gracefully.
 */
function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Trim large payloads so a 100-event tail fits comfortably (~50KB total).
 * We drop deeply nested payloads beyond 4KB.
 */
function clipEvents(events: DebugEvent[]): DebugEvent[] {
  return events.map((e) => {
    let payload = e.payload;
    try {
      const s = JSON.stringify(payload);
      if (s && s.length > 4096) {
        payload = `[clipped ${s.length} bytes]`;
      }
    } catch {
      payload = "[unserialisable]";
    }
    return { ...e, payload };
  });
}

function parseSeq(id: string): number | null {
  const m = /snap-(\d+)/.exec(id);
  return m ? Number(m[1]) : null;
}

function captureEnv(): DebugSnapshot["env"] {
  const memSrc = (performance as unknown as { memory?: { jsHeapSizeLimit?: number; totalJSHeapSize?: number; usedJSHeapSize?: number } }).memory;
  const conn = (navigator as unknown as { connection?: { effectiveType?: string; rtt?: number; downlink?: number } }).connection;
  return {
    href: typeof location !== "undefined" ? location.href : "",
    userAgent: typeof navigator !== "undefined" ? (navigator.userAgent ?? "").slice(0, 256) : "",
    memory: memSrc
      ? {
          jsHeapSizeLimit: memSrc.jsHeapSizeLimit,
          totalJSHeapSize: memSrc.totalJSHeapSize,
          usedJSHeapSize: memSrc.usedJSHeapSize,
        }
      : undefined,
    connection: conn
      ? {
          effectiveType: conn.effectiveType,
          rtt: conn.rtt,
          downlink: conn.downlink,
        }
      : undefined,
  };
}

/**
 * Convenience wrapper exposed via `window.spillorama.debug.snapshot(id)`.
 * Returns the snapshot AND adds an `export()` helper to it lazily.
 */
export function decorateSnapshotForExport(snap: DebugSnapshot): DebugSnapshot & { export: () => string } {
  return Object.assign({}, snap, {
    export: () => JSON.stringify(snap, null, 2),
  });
}
