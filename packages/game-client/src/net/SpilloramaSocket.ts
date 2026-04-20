import { io, type Socket } from "socket.io-client";
import type {
  AckResponse,
  RoomUpdatePayload,
  DrawNewPayload,
  PatternWonPayload,
  ChatMessage,
  RoomCreatePayload,
  RoomJoinPayload,
  RoomActionPayload,
  BetArmPayload,
  GameStartPayload,
  TicketMarkPayload,
  ClaimSubmitPayload,
  LuckyNumberPayload,
  ChatSendPayload,
  LeaderboardEntry,
  JackpotActivatedPayload,
  JackpotSpinResult,
  MiniGameActivatedPayload,
  MiniGamePlayResult,
} from "@spillorama/shared-types/socket-events";
import type { RoomSnapshot } from "@spillorama/shared-types/game";
import { SocketEvents } from "@spillorama/shared-types/socket-events";

// ── Connection state ────────────────────────────────────────────────────────

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting";

type ConnectionListener = (state: ConnectionState) => void;

// ── Event listener types ────────────────────────────────────────────────────

export interface SpilloramaSocketListeners {
  roomUpdate: (payload: RoomUpdatePayload) => void;
  drawNew: (payload: DrawNewPayload) => void;
  patternWon: (payload: PatternWonPayload) => void;
  chatMessage: (payload: ChatMessage) => void;
  jackpotActivated: (payload: JackpotActivatedPayload) => void;
  minigameActivated: (payload: MiniGameActivatedPayload) => void;
  connectionStateChanged: ConnectionListener;
}

type ListenerMap = {
  [K in keyof SpilloramaSocketListeners]: Set<SpilloramaSocketListeners[K]>;
};

// ── Token source ────────────────────────────────────────────────────────────

const TOKEN_KEY = "spillorama.accessToken";

function getToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) || "";
}

// ── Socket wrapper ──────────────────────────────────────────────────────────

/**
 * Type-safe Socket.IO client for the Spillorama backend.
 *
 * Key design decisions matching the backend:
 * - accessToken is sent in EVERY emit payload (not just handshake)
 * - Backend derives playerId from JWT, client-supplied playerId is ignored
 * - All emits use ack callbacks with AckResponse<T>
 */
export class SpilloramaSocket {
  private socket: Socket | null = null;
  private serverUrl: string;
  private connectionState: ConnectionState = "disconnected";
  private listeners: ListenerMap = {
    roomUpdate: new Set(),
    drawNew: new Set(),
    patternWon: new Set(),
    chatMessage: new Set(),
    jackpotActivated: new Set(),
    minigameActivated: new Set(),
    connectionStateChanged: new Set(),
  };

  /**
   * BIN-501: Event-buffer between socket.connect() and the first listener
   * registration.
   *
   * Race scenario we fix: the socket connects faster than GameBridge.start(),
   * so the backend can fire a `draw:new` (or any other broadcast) before
   * the bridge has subscribed via `socket.on("drawNew", ...)`. Without a
   * buffer those events are dropped silently — the client's drawIndex gap
   * detector (BIN-502) would later catch it, but that costs a full
   * resync round-trip per miss. The buffer avoids the drop entirely.
   *
   * Policy:
   *   - Only *broadcast* channels are buffered (not connectionStateChanged).
   *   - Buffering only happens while a channel has zero subscribers.
   *   - When the first listener attaches, the queue is drained in order
   *     and cleared. Later listeners see only live events.
   *   - Capped at BUFFER_LIMIT per channel (FIFO eviction).
   *   - Cleared on disconnect — a fresh session starts fresh.
   */
  private static readonly BUFFER_LIMIT = 100;
  private readonly bufferedEvents: {
    [K in keyof SpilloramaSocketListeners]: Array<Parameters<SpilloramaSocketListeners[K]>[0]>;
  } = {
    roomUpdate: [],
    drawNew: [],
    patternWon: [],
    chatMessage: [],
    jackpotActivated: [],
    minigameActivated: [],
    connectionStateChanged: [],
  };

  constructor(serverUrl: string) {
    this.serverUrl = serverUrl;
  }

  /**
   * BIN-501: central dispatch. Fires all registered listeners if any exist,
   * otherwise buffers (bounded FIFO) for replay on the first subscription.
   * Exposed as `private` but called via `this` from both the socket.on
   * handlers and the test shim.
   */
  private dispatchOrBuffer<K extends keyof SpilloramaSocketListeners>(
    channel: K,
    payload: Parameters<SpilloramaSocketListeners[K]>[0],
  ): void {
    const set = this.listeners[channel] as Set<SpilloramaSocketListeners[K]>;
    if (set.size > 0) {
      // Live dispatch — no buffering while at least one listener exists.
      set.forEach((fn) => (fn as (p: typeof payload) => void)(payload));
      return;
    }
    const buffer = this.bufferedEvents[channel] as Array<typeof payload>;
    buffer.push(payload);
    if (buffer.length > SpilloramaSocket.BUFFER_LIMIT) {
      buffer.splice(0, buffer.length - SpilloramaSocket.BUFFER_LIMIT);
    }
  }

  /**
   * BIN-501: replay any buffered events of the given channel to a
   * newly-attached listener, then clear the buffer.
   */
  private drainBufferTo<K extends keyof SpilloramaSocketListeners>(
    channel: K,
    listener: SpilloramaSocketListeners[K],
  ): void {
    const buffer = this.bufferedEvents[channel] as Array<Parameters<SpilloramaSocketListeners[K]>[0]>;
    if (buffer.length === 0) return;
    const queued = buffer.splice(0, buffer.length);
    for (const payload of queued) {
      (listener as (p: typeof payload) => void)(payload);
    }
  }

  /** BIN-501 test-only: read current buffer size for a channel. */
  __getBufferedCount(channel: keyof SpilloramaSocketListeners): number {
    return this.bufferedEvents[channel].length;
  }

  /**
   * BIN-501 test-only: invoke the internal dispatch path as if the socket
   * had just received `channel`. Lets unit tests simulate an init race
   * without wiring a fake io-client.
   */
  __dispatchForTest<K extends keyof SpilloramaSocketListeners>(
    channel: K,
    payload: Parameters<SpilloramaSocketListeners[K]>[0],
  ): void {
    this.dispatchOrBuffer(channel, payload);
  }

  // ── Connection ──────────────────────────────────────────────────────────

  connect(): void {
    if (this.socket?.connected) return;

    this.setConnectionState("connecting");

    this.socket = io(this.serverUrl, {
      auth: { accessToken: getToken() },
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
    });

    this.socket.on("connect", () => {
      this.setConnectionState("connected");
    });

    this.socket.on("disconnect", () => {
      this.setConnectionState("disconnected");
    });

    this.socket.io.on("reconnect_attempt", () => {
      // Update auth token on reconnect (may have been refreshed)
      if (this.socket) {
        this.socket.auth = { accessToken: getToken() };
      }
      this.setConnectionState("reconnecting");
    });

    this.socket.io.on("reconnect", () => {
      this.setConnectionState("connected");
    });

    // Server → Client broadcasts. All routed through dispatchOrBuffer so
    // early events (BIN-501 init-race) are queued until the first listener
    // subscribes.
    this.socket.on(SocketEvents.ROOM_UPDATE, (payload: RoomUpdatePayload) => {
      this.dispatchOrBuffer("roomUpdate", payload);
    });

    this.socket.on(SocketEvents.DRAW_NEW, (payload: DrawNewPayload) => {
      this.dispatchOrBuffer("drawNew", payload);
    });

    this.socket.on(SocketEvents.PATTERN_WON, (payload: PatternWonPayload) => {
      this.dispatchOrBuffer("patternWon", payload);
    });

    this.socket.on(SocketEvents.CHAT_MESSAGE, (payload: ChatMessage) => {
      this.dispatchOrBuffer("chatMessage", payload);
    });

    this.socket.on(SocketEvents.JACKPOT_ACTIVATED, (payload: JackpotActivatedPayload) => {
      this.dispatchOrBuffer("jackpotActivated", payload);
    });

    this.socket.on(SocketEvents.MINIGAME_ACTIVATED, (payload: MiniGameActivatedPayload) => {
      this.dispatchOrBuffer("minigameActivated", payload);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    // BIN-501: a fresh session starts with a fresh buffer. Leftover events
    // from a previous session would be out-of-date (e.g. draws for a game
    // that has long since ended) and could confuse the next bridge.
    for (const channel of Object.keys(this.bufferedEvents) as Array<keyof SpilloramaSocketListeners>) {
      this.bufferedEvents[channel].length = 0;
    }
    this.setConnectionState("disconnected");
  }

  isConnected(): boolean {
    return this.connectionState === "connected";
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  // ── Event subscription ────────────────────────────────────────────────

  on<K extends keyof SpilloramaSocketListeners>(
    event: K,
    listener: SpilloramaSocketListeners[K],
  ): () => void {
    const set = this.listeners[event] as Set<SpilloramaSocketListeners[K]>;
    const wasEmpty = set.size === 0;
    set.add(listener);
    // BIN-501: drain any events buffered between connect() and this first
    // listener subscription. Skip connectionStateChanged — that channel is
    // state-transition-only and never buffered.
    if (wasEmpty && event !== "connectionStateChanged") {
      this.drainBufferTo(event, listener);
    }
    return () => set.delete(listener);
  }

  // ── Client → Server emits (with ack) ─────────────────────────────────

  /** Every emit includes accessToken in payload per backend requirement. */
  private emit<T>(event: string, payload: Record<string, unknown>): Promise<AckResponse<T>> {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        resolve({ ok: false, error: { code: "NOT_CONNECTED", message: "Ikke tilkoblet." } });
        return;
      }
      this.socket.emit(
        event,
        { ...payload, accessToken: getToken() },
        (response: AckResponse<T>) => {
          resolve(response);
        },
      );
      // Timeout safety
      setTimeout(() => {
        reject(new Error(`Socket emit timeout: ${event}`));
      }, 15000);
    });
  }

  async createRoom(payload: Omit<RoomCreatePayload, "accessToken">): Promise<AckResponse<{ roomCode: string; playerId: string; snapshot: RoomSnapshot }>> {
    return this.emit(SocketEvents.ROOM_CREATE, payload);
  }

  async joinRoom(payload: Omit<RoomJoinPayload, "accessToken">): Promise<AckResponse<{ roomCode: string; playerId: string; snapshot: RoomSnapshot }>> {
    return this.emit(SocketEvents.ROOM_JOIN, payload);
  }

  async resumeRoom(payload: { roomCode: string }): Promise<AckResponse<{ snapshot: RoomSnapshot }>> {
    return this.emit(SocketEvents.ROOM_RESUME, payload);
  }

  async getRoomState(payload: { roomCode: string; hallId?: string }): Promise<AckResponse<{ snapshot: RoomSnapshot }>> {
    return this.emit(SocketEvents.ROOM_STATE, payload);
  }

  async armBet(payload: { roomCode: string; armed?: boolean; ticketCount?: number; ticketSelections?: Array<{ type: string; qty: number; name?: string }> }): Promise<AckResponse<{ snapshot: RoomSnapshot; armed: boolean }>> {
    return this.emit(SocketEvents.BET_ARM, payload);
  }

  async startGame(payload: { roomCode: string; entryFee?: number; ticketsPerPlayer?: number }): Promise<AckResponse<{ snapshot: RoomSnapshot }>> {
    return this.emit(SocketEvents.GAME_START, payload);
  }

  async drawNext(payload: { roomCode: string }): Promise<AckResponse<{ number: number; snapshot: RoomSnapshot }>> {
    return this.emit(SocketEvents.DRAW_NEXT, payload);
  }

  async markTicket(payload: { roomCode: string; number: number }): Promise<AckResponse<{ snapshot: RoomSnapshot }>> {
    return this.emit(SocketEvents.TICKET_MARK, payload);
  }

  async submitClaim(payload: { roomCode: string; type: "LINE" | "BINGO" }): Promise<AckResponse<{ snapshot: RoomSnapshot }>> {
    return this.emit(SocketEvents.CLAIM_SUBMIT, payload);
  }

  async setLuckyNumber(payload: { roomCode: string; luckyNumber: number }): Promise<AckResponse<unknown>> {
    return this.emit(SocketEvents.LUCKY_SET, payload);
  }

  async sendChat(payload: { roomCode: string; message: string; emojiId?: number }): Promise<AckResponse<{ message: ChatMessage }>> {
    return this.emit(SocketEvents.CHAT_SEND, payload);
  }

  async getChatHistory(payload: { roomCode: string }): Promise<AckResponse<{ messages: ChatMessage[] }>> {
    return this.emit(SocketEvents.CHAT_HISTORY, payload);
  }

  async getLeaderboard(payload: { roomCode?: string }): Promise<AckResponse<{ leaderboard: LeaderboardEntry[] }>> {
    return this.emit(SocketEvents.LEADERBOARD_GET, payload);
  }

  async spinJackpot(payload: { roomCode: string }): Promise<AckResponse<JackpotSpinResult>> {
    return this.emit(SocketEvents.JACKPOT_SPIN, payload);
  }

  async playMiniGame(payload: { roomCode: string; selectedIndex?: number }): Promise<AckResponse<MiniGamePlayResult>> {
    return this.emit(SocketEvents.MINIGAME_PLAY, payload);
  }

  // ── Private ───────────────────────────────────────────────────────────

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.listeners.connectionStateChanged.forEach((fn) => fn(state));
  }
}
