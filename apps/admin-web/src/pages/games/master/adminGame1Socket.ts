/**
 * GAME1_SCHEDULE PR 4d.3b: socket-klient for `/admin-game1`-namespace.
 *
 * Spec: docs/architecture/GAME1_PR4D_SOCKET_REALTIME_DESIGN_2026-04-21.md §3.5.
 *
 * Wrapper rundt socket.io-client for master-konsollens real-time-
 * subscription. Håndterer:
 *   - JWT-handshake-auth via `auth.token` (getToken() fra client.ts).
 *   - Abonnement på ett gameId av gangen (bytte via resubscribe).
 *   - Disconnect-fallback: når socket er frakoblet > disconnectGraceMs
 *     (default 10 000 ms), kaller `onFallbackActive(true)` slik at
 *     caller kan re-starte REST-polling. Ved reconnect kalles
 *     `onFallbackActive(false)` og polling kan stoppes.
 *
 * Invariant: én AdminGame1Socket-instans abonnerer på maks ett gameId.
 * Ny subscribe bytter abonnement. Dispose rydder socket + timers.
 */

import { io, type Socket } from "socket.io-client";
import { getToken } from "../../../api/client.js";

export interface AdminGame1StatusUpdate {
  gameId: string;
  status: string;
  action: string;
  auditId: string;
  actorUserId: string;
  at: number;
}

export interface AdminGame1DrawProgressed {
  gameId: string;
  ballNumber: number;
  drawIndex: number;
  currentPhase: number;
  at: number;
}

export interface AdminGame1SocketOptions {
  /** Base-URL for Socket.IO-serveren. Default: window.location.origin. */
  baseUrl?: string;
  /**
   * Ms frakoblet før `onFallbackActive(true)` kalles. Default 10 000.
   * Admin-UI starter REST-polling når fallback er aktiv; stopper ved
   * reconnect.
   */
  disconnectGraceMs?: number;
  onStatusUpdate: (payload: AdminGame1StatusUpdate) => void;
  onDrawProgressed: (payload: AdminGame1DrawProgressed) => void;
  onFallbackActive: (fallbackActive: boolean) => void;
  /** Testing-hook: bytte ut io-factory for å slippe ekte nettverks-call. */
  _ioFactory?: typeof io;
}

export class AdminGame1Socket {
  private readonly socket: Socket;
  private readonly options: Required<Omit<AdminGame1SocketOptions, "_ioFactory">> & {
    _ioFactory: typeof io;
  };
  private currentGameId: string | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackActive = false;
  private disposed = false;

  constructor(options: AdminGame1SocketOptions) {
    this.options = {
      baseUrl: options.baseUrl ?? window.location.origin,
      disconnectGraceMs: options.disconnectGraceMs ?? 10_000,
      onStatusUpdate: options.onStatusUpdate,
      onDrawProgressed: options.onDrawProgressed,
      onFallbackActive: options.onFallbackActive,
      _ioFactory: options._ioFactory ?? io,
    };

    this.socket = this.options._ioFactory(`${this.options.baseUrl}/admin-game1`, {
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
      if (this.currentGameId) {
        // Re-subscribe etter reconnect.
        this.socket.emit("game1:subscribe", { gameId: this.currentGameId });
      }
    });

    this.socket.on("disconnect", () => {
      this.scheduleFallbackTimer();
    });

    this.socket.on("connect_error", () => {
      // Socket.IO reconnection-loop prøver igjen selv; vi planlegger
      // fallback hvis timeren ikke allerede er aktiv.
      this.scheduleFallbackTimer();
    });

    this.socket.on(
      "game1:status-update",
      (payload: AdminGame1StatusUpdate) => {
        if (!this.currentGameId || payload.gameId !== this.currentGameId) return;
        this.options.onStatusUpdate(payload);
      }
    );

    this.socket.on(
      "game1:draw-progressed",
      (payload: AdminGame1DrawProgressed) => {
        if (!this.currentGameId || payload.gameId !== this.currentGameId) return;
        this.options.onDrawProgressed(payload);
      }
    );
  }

  /** Abonnér på events for gitt gameId. Bytter abonnement hvis en annen var aktiv. */
  subscribe(gameId: string): void {
    if (this.disposed) return;
    if (this.currentGameId === gameId) return;
    if (this.currentGameId) {
      this.socket.emit("game1:unsubscribe", { gameId: this.currentGameId });
    }
    this.currentGameId = gameId;
    if (this.socket.connected) {
      this.socket.emit("game1:subscribe", { gameId });
    }
    // Hvis ikke connected enda, sender vi subscribe i `connect`-handleren.
  }

  /** Debug/inspeksjon: true hvis vi er i fallback-modus. */
  isFallbackActive(): boolean {
    return this.fallbackActive;
  }

  /** Debug/inspeksjon: true hvis socket er koblet til. */
  isConnected(): boolean {
    return this.socket.connected;
  }

  /** Rydd opp: lukk socket, stop timer, forhindre videre callbacks. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelFallbackTimer();
    if (this.currentGameId) {
      try {
        this.socket.emit("game1:unsubscribe", { gameId: this.currentGameId });
      } catch {
        // ignorer — socket kan allerede være nede
      }
      this.currentGameId = null;
    }
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }

  private scheduleFallbackTimer(): void {
    if (this.fallbackTimer !== null || this.fallbackActive || this.disposed) return;
    this.fallbackTimer = setTimeout(() => {
      this.fallbackTimer = null;
      if (this.disposed || this.socket.connected) return;
      this.fallbackActive = true;
      this.options.onFallbackActive(true);
    }, this.options.disconnectGraceMs);
  }

  private cancelFallbackTimer(): void {
    if (this.fallbackTimer !== null) {
      clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
  }
}
