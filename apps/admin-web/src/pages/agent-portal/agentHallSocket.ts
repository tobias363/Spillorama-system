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

/** Task 1.6: master-transfer-event mottatt på default-namespace hall-rom. */
export interface AgentTransferRequest {
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

export interface AgentHallSocketOptions {
  baseUrl?: string;
  disconnectGraceMs?: number;
  /**
   * Task 1.6: agentens egen hallId. Hvis satt, emitter socketen
   * `admin-display:subscribe { hallId }` ved tilkobling slik at server
   * joiner `hall:<hallId>:display`-rommet og transfer-events fanges opp.
   */
  hallId?: string | null;
  onHallEvent: (evt: AgentHallEvent) => void;
  onRoomUpdate?: (evt: AgentRoomUpdate) => void;
  onFallbackActive?: (active: boolean) => void;
  /** Task 1.6: master-transfer events levert til hall-display-rom. */
  onTransferRequest?: (evt: AgentTransferRequest) => void;
  onTransferApproved?: (evt: AgentTransferRequest) => void;
  onTransferRejected?: (evt: AgentTransferRequest) => void;
  onTransferExpired?: (evt: AgentTransferRequest) => void;
  /** Testing-hook: bytte ut io-factory for å slippe ekte nettverkskall. */
  _ioFactory?: typeof io;
}

export class AgentHallSocket {
  private readonly socket: Socket;
  private readonly options: Required<
    Omit<
      AgentHallSocketOptions,
      | "_ioFactory"
      | "onRoomUpdate"
      | "onFallbackActive"
      | "onTransferRequest"
      | "onTransferApproved"
      | "onTransferRejected"
      | "onTransferExpired"
      | "hallId"
    >
  > & {
    _ioFactory: typeof io;
    hallId: string | null;
    onRoomUpdate: (evt: AgentRoomUpdate) => void;
    onFallbackActive: (active: boolean) => void;
    onTransferRequest: (evt: AgentTransferRequest) => void;
    onTransferApproved: (evt: AgentTransferRequest) => void;
    onTransferRejected: (evt: AgentTransferRequest) => void;
    onTransferExpired: (evt: AgentTransferRequest) => void;
  };
  private currentRoomCode: string | null = null;
  /**
   * ADR-0019 P0-3 (Wave 1): gameId vi er abonnert på via
   * `admin:game1:subscribe` — backend leverer transfer-events kun til
   * sockets som har joinet `admin:masters:<gameId>` (ikke lenger via
   * global io.emit). Re-sendes ved reconnect.
   */
  private currentGameId: string | null = null;
  private fallbackTimer: ReturnType<typeof setTimeout> | null = null;
  private fallbackActive = false;
  private disposed = false;

  constructor(options: AgentHallSocketOptions) {
    const noop = () => undefined;
    this.options = {
      baseUrl: options.baseUrl ?? (typeof window !== "undefined" ? window.location.origin : ""),
      disconnectGraceMs: options.disconnectGraceMs ?? 10_000,
      hallId: options.hallId ?? null,
      onHallEvent: options.onHallEvent,
      onRoomUpdate: options.onRoomUpdate ?? (() => {}),
      onFallbackActive: options.onFallbackActive ?? (() => {}),
      onTransferRequest: options.onTransferRequest ?? noop,
      onTransferApproved: options.onTransferApproved ?? noop,
      onTransferRejected: options.onTransferRejected ?? noop,
      onTransferExpired: options.onTransferExpired ?? noop,
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
      // ADR-0019 P0-3 (Wave 1, 2026-05-10): backend bruker IKKE lenger
      // global io.emit for transfer-events. Vi må gjøre admin:login + så
      // admin:game1:subscribe når vi vet hvilken gameId vi er interessert
      // i. Selve admin:login er nødvendig fordi admin:game1:subscribe-
      // handleren krever en autentisert socket. Re-emit ved reconnect
      // håndteres av `subscribeGame` cached i `currentGameId`.
      const token = getToken();
      if (token) {
        this.socket.emit("admin:login", { accessToken: token }, () => {
          // Re-subscribe ved reconnect hvis vi hadde et aktivt gameId.
          if (this.currentGameId) {
            this.socket.emit("admin:game1:subscribe", {
              gameId: this.currentGameId,
            });
          }
        });
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

    // Task 1.6: transfer-events. Backend emitter globalt (`io.emit`) med
    // hall-filter, så vi filtrerer klient-side på agentens egen hallId.
    // Hvis `options.hallId` ikke er satt, leverer vi alle events (backwards-
    // compat for test-kontekst).
    const isEventRelevant = (payload: AgentTransferRequest): boolean => {
      if (!options.hallId) return true;
      return (
        payload.toHallId === options.hallId ||
        payload.fromHallId === options.hallId
      );
    };
    this.socket.on("game1:transfer-request", (payload: AgentTransferRequest) => {
      if (!isEventRelevant(payload)) return;
      this.options.onTransferRequest(payload);
    });
    this.socket.on("game1:transfer-approved", (payload: AgentTransferRequest) => {
      if (!isEventRelevant(payload)) return;
      this.options.onTransferApproved(payload);
    });
    this.socket.on("game1:transfer-rejected", (payload: AgentTransferRequest) => {
      if (!isEventRelevant(payload)) return;
      this.options.onTransferRejected(payload);
    });
    this.socket.on("game1:transfer-expired", (payload: AgentTransferRequest) => {
      if (!isEventRelevant(payload)) return;
      this.options.onTransferExpired(payload);
    });
  }

  /** Bytt abonnement til gitt roomCode (filtrerer innkommende events). */
  subscribe(roomCode: string): void {
    if (this.disposed) return;
    this.currentRoomCode = roomCode;
  }

  /**
   * ADR-0019 P0-3 (Wave 1): abonnér på master-events for gitt gameId.
   * Sender `admin:game1:subscribe { gameId }` slik at backend joiner
   * socketen i `admin:masters:<gameId>`. Bytter abonnement hvis en annen
   * gameId allerede var aktiv (unsubscribe + subscribe). Re-sendes
   * automatisk i `connect`-handleren ved reconnect.
   *
   * Caller bør kalle denne så snart neste-spill-gameId er kjent. Hvis
   * gameId ikke er kjent enda, kan den utelates — transfer-events
   * leveres bare for gameId-er vi er abonnert på.
   */
  subscribeGame(gameId: string): void {
    if (this.disposed) return;
    if (this.currentGameId === gameId) return;
    if (this.currentGameId && this.socket.connected) {
      this.socket.emit("admin:game1:unsubscribe", {
        gameId: this.currentGameId,
      });
    }
    this.currentGameId = gameId;
    if (this.socket.connected) {
      this.socket.emit("admin:game1:subscribe", { gameId });
    }
    // Hvis ikke connected enda — connect-handleren re-emitter
    // admin:login + admin:game1:subscribe.
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
    if (this.currentGameId && this.socket.connected) {
      try {
        this.socket.emit("admin:game1:unsubscribe", {
          gameId: this.currentGameId,
        });
      } catch {
        // ignorer — socket kan allerede være nede
      }
    }
    this.currentGameId = null;
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
