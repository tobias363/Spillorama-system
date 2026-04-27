// ADMIN Super-User Operations Console — socket wrapper.
//
// Default-namespace (ikke /admin-game1) for cross-cutting ops-overview.
// Backend-event: `admin:ops:update` med en partial OpsOverviewDelta.
//
// Spec:
//   - JWT-handshake-auth via `auth.token` (samme pattern som master-game1).
//   - Ved connect emit `admin:ops:subscribe` så backend vet vi vil ha push.
//   - Disconnect-fallback: hvis socket er frakoblet > disconnectGraceMs,
//     kall `onFallbackActive(true)` slik at UI kan bytte til REST-polling.
//   - Backend kan også sende en full snapshot over `admin:ops:snapshot`
//     på reconnect (vi mottar både snapshot og delta — UI merger likt).
//
// Hver kall på `subscribe()` re-emitter `admin:ops:subscribe` (idempotent).
// `dispose()` rydder timer + socket.

import { io, type Socket } from "socket.io-client";
import { getToken } from "../../api/client.js";
import type { OpsOverviewDelta, OpsOverviewResponse } from "../../api/admin-ops.js";

export interface AdminOpsSocketOptions {
  /** Base-URL for Socket.IO-serveren. Default: window.location.origin. */
  baseUrl?: string;
  /**
   * Ms frakoblet før `onFallbackActive(true)` kalles. Default 10 000.
   * UI starter REST-polling når fallback er aktiv; stopper ved reconnect.
   */
  disconnectGraceMs?: number;
  onUpdate: (delta: OpsOverviewDelta) => void;
  /** Full snapshot received on reconnect (or initial subscribe). */
  onSnapshot?: (snapshot: OpsOverviewResponse) => void;
  onFallbackActive: (fallbackActive: boolean) => void;
  /** Testing-hook: bytte ut io-factory for å slippe ekte nettverks-call. */
  _ioFactory?: typeof io;
}

export interface AdminOpsSocketHandle {
  isConnected: () => boolean;
  /** Re-emit `admin:ops:subscribe` (idempotent). */
  subscribe: () => void;
  dispose: () => void;
}

interface ResolvedOptions {
  baseUrl: string;
  disconnectGraceMs: number;
  onUpdate: (delta: OpsOverviewDelta) => void;
  onSnapshot: (snapshot: OpsOverviewResponse) => void;
  onFallbackActive: (active: boolean) => void;
  _ioFactory: typeof io;
}

class AdminOpsSocketImpl implements AdminOpsSocketHandle {
  private readonly socket: Socket;
  private readonly options: ResolvedOptions;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackActive = false;
  private disposed = false;

  constructor(options: AdminOpsSocketOptions) {
    this.options = {
      baseUrl: options.baseUrl ?? window.location.origin,
      disconnectGraceMs: options.disconnectGraceMs ?? 10_000,
      onUpdate: options.onUpdate,
      onSnapshot: options.onSnapshot ?? (() => undefined),
      onFallbackActive: options.onFallbackActive,
      _ioFactory: options._ioFactory ?? io,
    };

    this.socket = this.options._ioFactory(this.options.baseUrl, {
      auth: { token: getToken() },
      transports: ["websocket"],
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 5_000,
    });

    this.socket.on("connect", () => {
      this.cancelFallbackTimer();
      if (this.fallbackActive) {
        this.fallbackActive = false;
        this.options.onFallbackActive(false);
      }
      this.socket.emit("admin:ops:subscribe");
    });

    this.socket.on("disconnect", () => {
      this.scheduleFallbackTimer();
    });

    this.socket.on("connect_error", () => {
      this.scheduleFallbackTimer();
    });

    this.socket.on("admin:ops:update", (payload: OpsOverviewDelta) => {
      if (this.disposed) return;
      this.options.onUpdate(payload);
    });

    this.socket.on("admin:ops:snapshot", (payload: OpsOverviewResponse) => {
      if (this.disposed) return;
      this.options.onSnapshot(payload);
    });
  }

  isConnected(): boolean {
    return this.socket.connected;
  }

  subscribe(): void {
    if (this.disposed) return;
    if (this.socket.connected) {
      this.socket.emit("admin:ops:subscribe");
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelFallbackTimer();
    if (this.socket.connected) {
      // Best-effort unsubscribe — server may rely on disconnect cleanup.
      try {
        this.socket.emit("admin:ops:unsubscribe");
      } catch {
        /* ignore */
      }
    }
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }

  private scheduleFallbackTimer(): void {
    if (this.fallbackTimer || this.fallbackActive) return;
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null;
      if (this.disposed) return;
      this.fallbackActive = true;
      this.options.onFallbackActive(true);
    }, this.options.disconnectGraceMs);
  }

  private cancelFallbackTimer(): void {
    if (this.fallbackTimer) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }
}

export function createAdminOpsSocket(
  options: AdminOpsSocketOptions
): AdminOpsSocketHandle {
  return new AdminOpsSocketImpl(options);
}
