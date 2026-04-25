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

/** Task 1.1: auto-pause etter phase-won. */
export interface AdminGame1AutoPaused {
  gameId: string;
  phase: number;
  pausedAt: number;
}

/** Task 1.1: manuell resume (auto- eller master-pause). */
export interface AdminGame1Resumed {
  gameId: string;
  resumedAt: number;
  actorUserId: string;
  phase: number;
  resumeType: "auto" | "manual";
}

/**
 * TASK HS: beriket per-hall status-broadcast — farge-kode + scan-data.
 */
export interface AdminGame1HallStatusUpdate {
  gameId: string;
  hallId: string;
  hallName: string;
  color: "red" | "orange" | "green";
  playerCount: number;
  startScanDone: boolean;
  finalScanDone: boolean;
  readyConfirmed: boolean;
  soldCount: number;
  startTicketId: string | null;
  finalScanTicketId: string | null;
  excludedFromGame: boolean;
  at: number;
}

/** Task 1.6: transfer-event payload (speiler Game1TransferRequestPayload). */
export interface AdminGame1TransferRequest {
  requestId: string;
  gameId: string;
  fromHallId: string;
  toHallId: string;
  initiatedByUserId: string;
  initiatedAtMs: number;
  validTillMs: number;
  status: "pending" | "approved" | "rejected" | "expired";
  respondedByUserId: string | null;
  respondedAtMs: number | null;
  rejectReason: string | null;
}

export interface AdminGame1MasterChanged {
  gameId: string;
  previousMasterHallId: string;
  newMasterHallId: string;
  transferRequestId: string;
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
  /** Task 1.1: valgfri — master-console bruker den, eksterne konsumenter kan hoppe over. */
  onAutoPaused?: (payload: AdminGame1AutoPaused) => void;
  /** Task 1.1: valgfri — master-console bruker den. */
  onResumed?: (payload: AdminGame1Resumed) => void;
  /** TASK HS: per-hall farge/scan-oppdatering. Valgfri for bakoverkompat. */
  onHallStatusUpdate?: (payload: AdminGame1HallStatusUpdate) => void;
  onFallbackActive: (fallbackActive: boolean) => void;
  /** Task 1.6: transfer-request opprettet (fra nåværende master). */
  onTransferRequest?: (payload: AdminGame1TransferRequest) => void;
  onTransferApproved?: (payload: AdminGame1TransferRequest) => void;
  onTransferRejected?: (payload: AdminGame1TransferRequest) => void;
  onTransferExpired?: (payload: AdminGame1TransferRequest) => void;
  onMasterChanged?: (payload: AdminGame1MasterChanged) => void;
  /** Testing-hook: bytte ut io-factory for å slippe ekte nettverks-call. */
  _ioFactory?: typeof io;
}

export class AdminGame1Socket {
  private readonly socket: Socket;
  private readonly options: {
    baseUrl: string;
    disconnectGraceMs: number;
    onStatusUpdate: (payload: AdminGame1StatusUpdate) => void;
    onDrawProgressed: (payload: AdminGame1DrawProgressed) => void;
    onAutoPaused?: (payload: AdminGame1AutoPaused) => void;
    onResumed?: (payload: AdminGame1Resumed) => void;
    onHallStatusUpdate: (payload: AdminGame1HallStatusUpdate) => void;
    onFallbackActive: (fallbackActive: boolean) => void;
    onTransferRequest: (payload: AdminGame1TransferRequest) => void;
    onTransferApproved: (payload: AdminGame1TransferRequest) => void;
    onTransferRejected: (payload: AdminGame1TransferRequest) => void;
    onTransferExpired: (payload: AdminGame1TransferRequest) => void;
    onMasterChanged: (payload: AdminGame1MasterChanged) => void;
    _ioFactory: typeof io;
  };
  private currentGameId: string | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackActive = false;
  private disposed = false;

  constructor(options: AdminGame1SocketOptions) {
    const noop = () => undefined;
    this.options = {
      baseUrl: options.baseUrl ?? window.location.origin,
      disconnectGraceMs: options.disconnectGraceMs ?? 10_000,
      onStatusUpdate: options.onStatusUpdate,
      onDrawProgressed: options.onDrawProgressed,
      onAutoPaused: options.onAutoPaused,
      onResumed: options.onResumed,
      onHallStatusUpdate: options.onHallStatusUpdate ?? (() => undefined),
      onFallbackActive: options.onFallbackActive,
      onTransferRequest: options.onTransferRequest ?? noop,
      onTransferApproved: options.onTransferApproved ?? noop,
      onTransferRejected: options.onTransferRejected ?? noop,
      onTransferExpired: options.onTransferExpired ?? noop,
      onMasterChanged: options.onMasterChanged ?? noop,
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

    // Task 1.1: auto-pause + resume subscriptions. Callback er valgfri —
    // hvis eksterne konsumenter ikke registrerer håndtering, faller event
    // igjennom stille.
    this.socket.on(
      "game1:auto-paused",
      (payload: AdminGame1AutoPaused) => {
        if (!this.currentGameId || payload.gameId !== this.currentGameId) return;
        this.options.onAutoPaused?.(payload);
      }
    );

    this.socket.on(
      "game1:resumed",
      (payload: AdminGame1Resumed) => {
        if (!this.currentGameId || payload.gameId !== this.currentGameId) return;
        this.options.onResumed?.(payload);
      }
    );

    // TASK HS: real-time farge/scan-oppdatering per hall.
    this.socket.on(
      "game1:hall-status-update",
      (payload: AdminGame1HallStatusUpdate) => {
        if (!this.currentGameId || payload.gameId !== this.currentGameId) return;
        this.options.onHallStatusUpdate(payload);
      }
    );

    // Task 1.6: transfer-hall-events.
    this.socket.on(
      "game1:transfer-request",
      (payload: AdminGame1TransferRequest) => {
        if (!this.currentGameId || payload.gameId !== this.currentGameId) return;
        this.options.onTransferRequest?.(payload);
      }
    );
    this.socket.on(
      "game1:transfer-approved",
      (payload: AdminGame1TransferRequest) => {
        if (!this.currentGameId || payload.gameId !== this.currentGameId) return;
        this.options.onTransferApproved?.(payload);
      }
    );
    this.socket.on(
      "game1:transfer-rejected",
      (payload: AdminGame1TransferRequest) => {
        if (!this.currentGameId || payload.gameId !== this.currentGameId) return;
        this.options.onTransferRejected?.(payload);
      }
    );
    this.socket.on(
      "game1:transfer-expired",
      (payload: AdminGame1TransferRequest) => {
        if (!this.currentGameId || payload.gameId !== this.currentGameId) return;
        this.options.onTransferExpired?.(payload);
      }
    );
    this.socket.on(
      "game1:master-changed",
      (payload: AdminGame1MasterChanged) => {
        if (!this.currentGameId || payload.gameId !== this.currentGameId) return;
        this.options.onMasterChanged?.(payload);
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
