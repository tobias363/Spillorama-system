/**
 * Agent-portal Next Game — live-socket wrapper.
 *
 * Lytter på default-namespace for `admin:hall-event` og `room:update`
 * broadcasts fra backend (BIN-515 + BIN-460). Dette er en progressive-
 * enhancement — primær state-refresh i Next-Game-panel skjer via
 * HTTP-polling (5s) mot `GET /api/admin/rooms/:code`, siden agent-
 * socketen ikke er player/display og derfor ikke automatisk er medlem av
 * room.<code>-socket.io-room.
 *
 * Hvis socketen likevel er i rett room (fks. etter en `admin:force-end`-
 * ack som backend-en emitter i samme tick), vil callbacken trigge
 * umiddelbar refresh uten å vente på neste poll-tick.
 *
 * Invariant: én instans lytter på events for ett roomCode om gangen.
 * Dispose rydder opp.
 *
 * Fallback-timer: hvis socket er frakoblet > `disconnectGraceMs`, kalles
 * `onFallbackActive(true)` slik at Next-Game-panel kan vise "socket nede"
 * -varsel og tvinge manuell refresh.
 */

import { io, type Socket } from "socket.io-client";
import { getToken } from "../../api/client.js";

export interface AgentHallEvent {
  kind: "room-ready" | "paused" | "resumed" | "force-ended";
  roomCode: string;
  hallId: string | null;
  at: number;
  countdownSeconds?: number;
  message?: string;
  actor: { id: string; displayName: string };
}

export interface AgentRoomUpdate {
  roomCode?: string;
  hallId?: string | null;
  /** Åpen-shape for nå — Next-Game-panel leser kun `status` + noen få felt. */
  [key: string]: unknown;
}

export interface AgentHallSocketOptions {
  baseUrl?: string;
  disconnectGraceMs?: number;
  onHallEvent: (evt: AgentHallEvent) => void;
  onRoomUpdate?: (evt: AgentRoomUpdate) => void;
  onFallbackActive?: (active: boolean) => void;
  /** Testing-hook: bytte ut io-factory for å slippe ekte nettverkskall. */
  _ioFactory?: typeof io;
}

export class AgentHallSocket {
  private readonly socket: Socket;
  private readonly options: Required<
    Omit<AgentHallSocketOptions, "_ioFactory" | "onRoomUpdate" | "onFallbackActive">
  > & {
    _ioFactory: typeof io;
    onRoomUpdate: (evt: AgentRoomUpdate) => void;
    onFallbackActive: (active: boolean) => void;
  };
  private currentRoomCode: string | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackActive = false;
  private disposed = false;

  constructor(options: AgentHallSocketOptions) {
    this.options = {
      baseUrl: options.baseUrl ?? (typeof window !== "undefined" ? window.location.origin : ""),
      disconnectGraceMs: options.disconnectGraceMs ?? 10_000,
      onHallEvent: options.onHallEvent,
      onRoomUpdate: options.onRoomUpdate ?? (() => {}),
      onFallbackActive: options.onFallbackActive ?? (() => {}),
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
    });

    this.socket.on("disconnect", () => {
      this.scheduleFallbackTimer();
    });

    this.socket.on("connect_error", () => {
      this.scheduleFallbackTimer();
    });

    this.socket.on("admin:hall-event", (payload: AgentHallEvent) => {
      if (!this.currentRoomCode) return;
      if (payload.roomCode !== this.currentRoomCode) return;
      this.options.onHallEvent(payload);
    });

    this.socket.on("room:update", (payload: AgentRoomUpdate) => {
      if (!this.currentRoomCode) return;
      if (payload.roomCode && payload.roomCode !== this.currentRoomCode) return;
      this.options.onRoomUpdate(payload);
    });
  }

  /** Bytt abonnement til gitt roomCode (filtrerer innkommende events). */
  subscribe(roomCode: string): void {
    if (this.disposed) return;
    this.currentRoomCode = roomCode;
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
    this.currentRoomCode = null;
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
