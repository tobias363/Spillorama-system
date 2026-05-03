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
  MiniGameTriggerPayload,
  MiniGameResultPayload,
  WalletStateEvent,
  BetRejectedEvent,
  WalletLossStateEvent,
  G2JackpotListUpdatePayload,
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
  /**
   * Tobias prod-incident 2026-04-29 (re-added): legacy `minigame:activated`
   * channel. PR-M6 originally removed this in favor of the scheduled-games
   * `mini_game:trigger` protocol, but Spill 1's auto-claim flow (PR #727)
   * uses the legacy emit path — server calls `engine.activateMiniGame()` and
   * emits `minigame:activated` to the winner's `wallet:<walletId>` socket-
   * room. Without this listener the mini-game popup never renders for auto-
   * round games.
   *
   * Coexists with `miniGameTrigger` — `minigameActivated` for auto-round /
   * auto-claim flow (legacy server path), `miniGameTrigger` for scheduled-
   * games orchestrator path.
   */
  minigameActivated: (payload: MiniGameActivatedPayload) => void;
  /**
   * BIN-690 PR-M6: scheduled-games mini-game trigger. Server fires this
   * after Fullt Hus is won and the orchestrator has persisted a triggered-
   * row. Distinct from `minigameActivated` (legacy auto-round path).
   */
  miniGameTrigger: (payload: MiniGameTriggerPayload) => void;
  /**
   * BIN-690 PR-M6: scheduled-games mini-game result. Fires after the server
   * has resolved the player's choice (or for Oddsen, after the next game's
   * terskel-draw).
   */
  miniGameResult: (payload: MiniGameResultPayload) => void;
  /**
   * BIN-760: autoritativ `wallet:state`-push fra server. Erstatter
   * `room:update.me.balance` som primær wallet-sync. Klienten skal
   * foretrekke denne over room:update for chip-rendering — ny payload
   * inkluderer reservedAmount + availableBalance, og pusher uavhengig
   * av room:update-cadence. `room:update` skrives fortsatt for
   * bakover-kompat.
   */
  walletState: (payload: WalletStateEvent) => void;
  /**
   * Tobias 2026-04-29 (post-orphan-fix UX): server pusher denne når
   * forhåndskjøp avvises på game-start (loss-limit eller insufficient
   * funds). Klienten fjerner pre-round-bonger og viser klar Norsk
   * feilmelding i stedet for å la spilleren stå med "forsvinnende
   * brett"-UX.
   */
  betRejected: (payload: BetRejectedEvent) => void;
  /**
   * Tobias 2026-04-29 (post-orphan-fix UX): tap-status-push etter
   * committed buy-in. Klient bruker det til å oppdatere
   * "Brukt i dag: X / Y kr"-headeren i Kjøp Bonger-popup-en uten
   * round-trip via /api/wallet/me/compliance.
   */
  walletLossState: (payload: WalletLossStateEvent) => void;
  /**
   * 2026-05-02 (Tobias UX): Spill 2 jackpot-bar oppdatering. Server pusher
   * denne på hver G2-trekning med kompletten 6-slot-prize-listen
   * (9/10/11/12/13/14-21). Klient (Game2Controller) forwarder til
   * `PlayScreen.updateJackpot()`.
   */
  g2JackpotListUpdate: (payload: G2JackpotListUpdatePayload) => void;
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
    miniGameTrigger: new Set(),
    miniGameResult: new Set(),
    walletState: new Set(),
    betRejected: new Set(),
    walletLossState: new Set(),
    g2JackpotListUpdate: new Set(),
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
    miniGameTrigger: [],
    miniGameResult: [],
    walletState: [],
    betRejected: [],
    walletLossState: [],
    g2JackpotListUpdate: [],
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
      // FIFO eviction. Logging here is worth the noise — hitting the limit
      // means a listener subscribed very late (or never) and we're dropping
      // real server events, which is a bug-smell we want to notice.
      const dropped = buffer.length - SpilloramaSocket.BUFFER_LIMIT;
      buffer.splice(0, dropped);
      console.warn(
        `[SpilloramaSocket] buffer overflow on "${channel}" — dropped ${dropped} oldest event(s). ` +
        `First listener should subscribe immediately after connect().`,
      );
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
      // MED-10 disconnect-recovery: be server om å re-emitte `mini_game:trigger`
      // for evt pending mini-games etter at vi er reconnect-et. Vi joiner først
      // user-rommet (det er bundet til socketId, så det forsvinner ved
      // disconnect og må re-bindes), deretter ber om resume.
      //
      // Fail-silent: ack-feil logges men kaster ikke. Hvis brukeren ikke har
      // pending mini-games er resumedCount=0 — ingen no-op-effekt på klient.
      void this.sendMiniGameJoin()
        .then((joinAck) => {
          if (!joinAck.ok) {
            console.debug(
              "[MED-10] mini_game:join failed after reconnect",
              joinAck.error,
            );
            return;
          }
          return this.sendMiniGameResume().then((resumeAck) => {
            if (!resumeAck.ok) {
              console.debug(
                "[MED-10] mini_game:resume failed after reconnect",
                resumeAck.error,
              );
              return;
            }
            const count = resumeAck.data?.resumedCount ?? 0;
            if (count > 0) {
              console.debug(
                `[MED-10] resumed ${count} pending mini-game(s) after reconnect`,
              );
            }
          });
        })
        .catch((err) => {
          console.debug("[MED-10] mini-game resume threw after reconnect", err);
        });
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

    // 2026-05-02 (Tobias UX): Spill 2 jackpot-bar live-update.
    this.socket.on(
      SocketEvents.G2_JACKPOT_LIST_UPDATE,
      (payload: G2JackpotListUpdatePayload) => {
        this.dispatchOrBuffer("g2JackpotListUpdate", payload);
      },
    );

    // Tobias prod-incident 2026-04-29 (re-added after PR-M6 removal): legacy
    // `minigame:activated` channel. PR #727 server-side now emits this after
    // auto-claim of Fullt Hus to `wallet:<walletId>`-room. Without this
    // listener the popup never renders for auto-round Spill 1 games. Coexists
    // with `mini_game:trigger` (scheduled-games path).
    this.socket.on(SocketEvents.MINIGAME_ACTIVATED, (payload: MiniGameActivatedPayload) => {
      this.dispatchOrBuffer("minigameActivated", payload);
    });

    // BIN-690 PR-M6: scheduled-games mini-game protocol.
    this.socket.on(SocketEvents.MINI_GAME_TRIGGER, (payload: MiniGameTriggerPayload) => {
      this.dispatchOrBuffer("miniGameTrigger", payload);
    });

    this.socket.on(SocketEvents.MINI_GAME_RESULT, (payload: MiniGameResultPayload) => {
      this.dispatchOrBuffer("miniGameResult", payload);
    });

    // BIN-760: autoritativ wallet-state-push. Replays via dispatchOrBuffer
    // som alle andre kanaler — hvis bridge subscribes etter første push,
    // får den replay av buffer.
    this.socket.on(SocketEvents.WALLET_STATE, (payload: WalletStateEvent) => {
      this.dispatchOrBuffer("walletState", payload);
    });

    // Tobias 2026-04-29 (post-orphan-fix UX): bet:rejected fra server etter
    // game-start filter dropper spilleren. Klient fjerner pre-round-bonger
    // + viser klar feilmelding via GameBridge.
    this.socket.on(SocketEvents.BET_REJECTED, (payload: BetRejectedEvent) => {
      this.dispatchOrBuffer("betRejected", payload);
    });

    // Tobias 2026-04-29 (post-orphan-fix UX): wallet:loss-state push etter
    // committed buy-in. Klient oppdaterer "Brukt i dag: X / Y kr"-header
    // i Kjøp Bonger-popup-en.
    this.socket.on(SocketEvents.WALLET_LOSS_STATE, (payload: WalletLossStateEvent) => {
      this.dispatchOrBuffer("walletLossState", payload);
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

  /** Every emit includes accessToken in payload per backend requirement.
   *
   *  Never rejects — callers only need to check `result.ok`. Previously the
   *  15s timeout called `reject(...)` even when the ack had already arrived,
   *  so the Promise resolved first and the rejection became an unhandled
   *  "zombie" error. Now the timeout and the ack race cooperatively and
   *  whichever wins clears the other. */
  private emit<T>(event: string, payload: Record<string, unknown>): Promise<AckResponse<T>> {
    return new Promise((resolve) => {
      if (!this.socket?.connected) {
        resolve({ ok: false, error: { code: "NOT_CONNECTED", message: "Ikke tilkoblet." } });
        return;
      }
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve({
          ok: false,
          error: { code: "TIMEOUT", message: `Server svarte ikke innen 15s (${event}).` },
        });
      }, 15000);
      this.socket.emit(
        event,
        { ...payload, accessToken: getToken() },
        (response: AckResponse<T>) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(response);
        },
      );
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

  async armBet(
    payload: {
      roomCode: string;
      armed?: boolean;
      ticketCount?: number;
      ticketSelections?: Array<{ type: string; qty: number; name?: string }>;
    },
  ): Promise<
    AckResponse<{
      snapshot: RoomSnapshot;
      armed: boolean;
      /**
       * Tobias 2026-04-29 (post-orphan-fix UX): server returnerer
       * tap-status snapshot på success-acks. Klient bruker det for å
       * rendre "Brukt i dag: X / Y kr"-header og vise partial-buy-toast
       * når `rejected > 0`.
       */
      lossLimit?: {
        requested: number;
        accepted: number;
        rejected: number;
        rejectionReason: "DAILY_LIMIT" | "MONTHLY_LIMIT" | null;
        dailyUsed: number;
        dailyLimit: number;
        monthlyUsed: number;
        monthlyLimit: number;
        walletBalance: number | null;
      };
    }>
  > {
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

  /**
   * BIN-692: cancel a single pre-round ticket or its whole bundle.
   * Gated server-side to non-RUNNING rounds. Free (no wallet debit).
   */
  async cancelTicket(payload: { roomCode: string; ticketId: string }): Promise<AckResponse<{ removedTicketIds: string[]; remainingTicketCount: number; fullyDisarmed: boolean }>> {
    return this.emit(SocketEvents.TICKET_CANCEL, payload);
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

  /**
   * Tobias prod-incident 2026-04-29 (re-added after PR-M6 removal): legacy
   * `minigame:play` emit. Used by the LegacyMiniGameAdapter to commit a
   * choice for mini-games triggered via the legacy auto-claim path
   * (`minigame:activated` → adapter → overlay → this emit). The M6
   * orchestrator uses `sendMiniGameChoice` (with resultId) instead — see
   * MiniGameRouter.
   *
   * `selectedIndex` is cosmetic-only for chest/colordraft; the server
   * picks the prize from the activated `MiniGameState.prizeList`. Returns
   * `{ type, segmentIndex, prizeAmount, prizeList }` on success.
   */
  async playMiniGame(payload: {
    roomCode: string;
    selectedIndex?: number;
  }): Promise<AckResponse<MiniGamePlayResult>> {
    return this.emit(SocketEvents.MINIGAME_PLAY, payload);
  }

  /**
   * BIN-690 PR-M6: Send the player's mini-game choice. `choiceJson` is free-
   * form per type — see `MiniGameChoicePayload` in shared-types for the
   * per-type shapes. Server is authoritative on the outcome; the choice is
   * just input.
   */
  async sendMiniGameChoice(payload: {
    resultId: string;
    choiceJson: Readonly<Record<string, unknown>>;
  }): Promise<AckResponse<{ accepted: true }>> {
    return this.emit(SocketEvents.MINI_GAME_CHOICE, payload);
  }

  /**
   * MED-10 disconnect-recovery: re-join the user-private mini-game room
   * after a reconnect. Idempotent server-side. Should be called BEFORE
   * `sendMiniGameResume` so the user room is re-bound to the new socket
   * before pending triggers fire.
   */
  async sendMiniGameJoin(): Promise<AckResponse<{ joined: true }>> {
    return this.emit(SocketEvents.MINI_GAME_JOIN, {});
  }

  /**
   * MED-10 disconnect-recovery: ask the server to re-emit
   * `mini_game:trigger` for any pending mini-games owned by the
   * authenticated user. The triggers arrive on the standard
   * `miniGameTrigger` channel — listeners (e.g. MiniGameRouter via the
   * GameBridge) handle them as new triggers, idempotently rebuilding
   * overlays from the deterministic resultId-seed.
   *
   * Returns the count of resumed mini-games for telemetry.
   */
  async sendMiniGameResume(): Promise<AckResponse<{ resumedCount: number }>> {
    return this.emit(SocketEvents.MINI_GAME_RESUME, {});
  }

  // ── Private ───────────────────────────────────────────────────────────

  private setConnectionState(state: ConnectionState): void {
    if (this.connectionState === state) return;
    this.connectionState = state;
    this.listeners.connectionStateChanged.forEach((fn) => fn(state));
  }
}
