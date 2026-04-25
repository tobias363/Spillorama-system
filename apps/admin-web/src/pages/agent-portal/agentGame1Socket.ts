/**
 * Task 1.4 (2026-04-24): agent-portal socket-klient for `/admin-game1`-
 * namespace.
 *
 * Spill 1-bølgen forener agent + master mot scheduled_game_id. Agent-
 * portalen må derfor også lytte på samme socket-events som
 * `Game1MasterConsole.ts`:
 *   - game1:status-update   (start/pause/resume/stop via master-actions)
 *   - game1:draw-progressed (hver ball)
 *   - game1:phase-won       (fase-overgang)
 *
 * Wrapper gjenbruker samme handshake som `adminGame1Socket.ts` men er
 * eksponert fra agent-portal-mappen slik at Spill 1 agent-komponentene
 * kan importere uten å krysse pagekatalogen. Siden `/admin-game1`-
 * namespacet er JWT-auth + GAME1_MASTER_WRITE (hvilket inkluderer
 * AGENT-rollen), trenger vi ingen egen permission-sjekk på socket-
 * siden — handshake-avvisning gir feil før events leveres.
 *
 * Invariant: én instans abonnerer på maks ett gameId. Dispose rydder
 * socket + timers.
 */

import { io, type Socket } from "socket.io-client";
import { getToken } from "../../api/client.js";

export interface AgentGame1StatusUpdate {
  gameId: string;
  status: string;
  action: string;
  auditId: string;
  actorUserId: string;
  at: number;
}

export interface AgentGame1DrawProgressed {
  gameId: string;
  ballNumber: number;
  drawIndex: number;
  currentPhase: number;
  at: number;
}

export interface AgentGame1PhaseWon {
  gameId: string;
  patternName: string;
  phase: number;
  winnerIds: string[];
  winnerCount: number;
  drawIndex: number;
  at: number;
}

export interface AgentGame1SocketOptions {
  /** Base-URL for Socket.IO-serveren. Default: window.location.origin. */
  baseUrl?: string;
  /**
   * Ms frakoblet før `onFallbackActive(true)` kalles. Default 10 000.
   * Agent-UI starter REST-polling når fallback er aktiv; stopper ved
   * reconnect.
   */
  disconnectGraceMs?: number;
  onStatusUpdate: (payload: AgentGame1StatusUpdate) => void;
  onDrawProgressed?: (payload: AgentGame1DrawProgressed) => void;
  onPhaseWon?: (payload: AgentGame1PhaseWon) => void;
  onFallbackActive: (fallbackActive: boolean) => void;
  /** Testing-hook: bytte ut io-factory. */
  _ioFactory?: typeof io;
}

export class AgentGame1Socket {
  private readonly socket: Socket;
  private readonly options: Required<
    Omit<AgentGame1SocketOptions, "_ioFactory" | "onDrawProgressed" | "onPhaseWon">
  > & {
    _ioFactory: typeof io;
    onDrawProgressed: (payload: AgentGame1DrawProgressed) => void;
    onPhaseWon: (payload: AgentGame1PhaseWon) => void;
  };
  private currentGameId: string | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackActive = false;
  private disposed = false;

  constructor(options: AgentGame1SocketOptions) {
    this.options = {
      baseUrl:
        options.baseUrl ??
        (typeof window !== "undefined" ? window.location.origin : ""),
      disconnectGraceMs: options.disconnectGraceMs ?? 10_000,
      onStatusUpdate: options.onStatusUpdate,
      onDrawProgressed: options.onDrawProgressed ?? (() => {}),
      onPhaseWon: options.onPhaseWon ?? (() => {}),
      onFallbackActive: options.onFallbackActive,
      _ioFactory: options._ioFactory ?? io,
    };

    this.socket = this.options._ioFactory(
      `${this.options.baseUrl}/admin-game1`,
      {
        auth: { token: getToken() },
        transports: ["websocket"],
        reconnection: true,
        reconnectionDelay: 1_000,
        reconnectionDelayMax: 5_000,
      }
    );

    this.socket.on("connect", () => {
      this.cancelFallbackTimer();
      if (this.fallbackActive) {
        this.fallbackActive = false;
        this.options.onFallbackActive(false);
      }
      if (this.currentGameId) {
        this.socket.emit("game1:subscribe", { gameId: this.currentGameId });
      }
    });

    this.socket.on("disconnect", () => {
      this.scheduleFallbackTimer();
    });

    this.socket.on("connect_error", () => {
      this.scheduleFallbackTimer();
    });

    this.socket.on(
      "game1:status-update",
      (payload: AgentGame1StatusUpdate) => {
        if (!this.currentGameId || payload.gameId !== this.currentGameId)
          return;
        this.options.onStatusUpdate(payload);
      }
    );

    this.socket.on(
      "game1:draw-progressed",
      (payload: AgentGame1DrawProgressed) => {
        if (!this.currentGameId || payload.gameId !== this.currentGameId)
          return;
        this.options.onDrawProgressed(payload);
      }
    );

    this.socket.on("game1:phase-won", (payload: AgentGame1PhaseWon) => {
      if (!this.currentGameId || payload.gameId !== this.currentGameId) return;
      this.options.onPhaseWon(payload);
    });
  }

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
  }

  isFallbackActive(): boolean {
    return this.fallbackActive;
  }

  isConnected(): boolean {
    return this.socket.connected;
  }

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
    if (this.fallbackTimer !== null || this.fallbackActive || this.disposed)
      return;
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
