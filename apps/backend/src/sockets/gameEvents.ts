import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import { DomainError, toPublicError } from "../game/BingoEngine.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { SocketRateLimiter } from "../middleware/socketRateLimit.js";
import type { RoomSnapshot, Ticket, ClaimType } from "../game/types.js";
import type { RoomUpdatePayload } from "../util/roomHelpers.js";
import { getAccessTokenFromSocketPayload, mustBeNonEmptyString, parseOptionalNonNegativeNumber, parseTicketsPerPlayerInput } from "../util/httpHelpers.js";
import { assertTicketsPerPlayerWithinHallLimit } from "../game/compliance.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "gameEvents" });

// ── Socket payload types ──────────────────────────────────────────────────────

interface AckResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface AuthenticatedSocketPayload {
  accessToken?: string;
}

interface RoomActionPayload extends AuthenticatedSocketPayload {
  roomCode: string;
  playerId?: string;
}

interface CreateRoomPayload extends AuthenticatedSocketPayload {
  playerName?: string;
  walletId?: string;
  hallId?: string;
  gameSlug?: string;
}

interface JoinRoomPayload extends CreateRoomPayload {
  roomCode: string;
}

interface ResumeRoomPayload extends RoomActionPayload {}

interface StartGamePayload extends RoomActionPayload {
  entryFee?: number;
  ticketsPerPlayer?: number;
}

interface ConfigureRoomPayload extends RoomActionPayload {
  entryFee?: number;
}

interface EndGamePayload extends RoomActionPayload {
  reason?: string;
}

interface MarkPayload extends RoomActionPayload {
  number: number;
}

interface ClaimPayload extends RoomActionPayload {
  type: ClaimType;
}

interface RoomStatePayload extends AuthenticatedSocketPayload {
  roomCode: string;
}

interface ExtraDrawPayload extends RoomActionPayload {
  requestedCount?: number;
  packageId?: string;
}

interface ChatSendPayload extends RoomActionPayload {
  message: string;
  emojiId?: number;
}

interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  emojiId: number;
  createdAt: string;
}

interface LuckyNumberPayload extends RoomActionPayload {
  luckyNumber: number;
}

interface LeaderboardPayload extends AuthenticatedSocketPayload {
  roomCode?: string;
}

interface LeaderboardEntry {
  nickname: string;
  points: number;
}

// ── Deps ──────────────────────────────────────────────────────────────────────

export interface BingoSchedulerSettings {
  autoRoundStartEnabled: boolean;
  autoRoundStartIntervalMs: number;
  autoRoundMinPlayers: number;
  autoRoundTicketsPerPlayer: number;
  autoRoundEntryFee: number;
  payoutPercent: number;
  autoDrawEnabled: boolean;
  autoDrawIntervalMs: number;
}

export interface GameEventsDeps {
  engine: BingoEngine;
  platformService: PlatformService;
  io: Server;
  socketRateLimiter: SocketRateLimiter;
  emitRoomUpdate: (roomCode: string) => Promise<RoomUpdatePayload>;
  emitManyRoomUpdates: (roomCodes: Iterable<string>) => Promise<void>;
  buildRoomUpdatePayload: (snapshot: RoomSnapshot) => RoomUpdatePayload;
  enforceSingleRoomPerHall: boolean;
  runtimeBingoSettings: BingoSchedulerSettings;
  chatHistoryByRoom: Map<string, ChatMessage[]>;
  luckyNumbersByRoom: Map<string, Map<string, number>>;
  armedPlayerIdsByRoom: Map<string, Map<string, number>>;
  roomConfiguredEntryFeeByRoom: Map<string, number>;
  displayTicketCache: Map<string, Ticket[]>;
  getPrimaryRoomForHall: (hallId: string) => { code: string; hallId: string } | null;
  findPlayerInRoomByWallet: (snapshot: RoomSnapshot, walletId: string) => RoomSnapshot["players"][number] | null;
  getRoomConfiguredEntryFee: (roomCode: string) => number;
  getArmedPlayerIds: (roomCode: string) => string[];
  armPlayer: (roomCode: string, playerId: string, ticketCount?: number, selections?: Array<{ type: string; qty: number }>) => void;
  getArmedPlayerTicketCounts: (roomCode: string) => Record<string, number>;
  getArmedPlayerSelections: (roomCode: string) => Record<string, Array<{ type: string; qty: number }>>;
  disarmPlayer: (roomCode: string, playerId: string) => void;
  disarmAllPlayers: (roomCode: string) => void;
  clearDisplayTicketCache: (roomCode: string) => void;
  resolveBingoHallGameConfigForRoom: (roomCode: string) => Promise<{ hallId: string; maxTicketsPerPlayer: number }>;
  requireActiveHallIdFromInput: (input: unknown) => Promise<string>;
  buildLeaderboard: (roomCode?: string) => LeaderboardEntry[];
  /** BIN-445: Get active variant config for a room (from schedule or default). */
  getVariantConfig?: (roomCode: string) => { gameType: string; config: import("../game/variantConfig.js").GameVariantConfig } | null;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createGameEventHandlers(deps: GameEventsDeps) {
  const {
    engine,
    platformService,
    io,
    socketRateLimiter,
    emitRoomUpdate,
    buildRoomUpdatePayload,
    enforceSingleRoomPerHall,
    runtimeBingoSettings,
    chatHistoryByRoom,
    luckyNumbersByRoom,
    armedPlayerIdsByRoom,
    getPrimaryRoomForHall,
    findPlayerInRoomByWallet,
    getRoomConfiguredEntryFee,
    getArmedPlayerIds,
    armPlayer,
    disarmPlayer,
    disarmAllPlayers,
    clearDisplayTicketCache,
    resolveBingoHallGameConfigForRoom,
    requireActiveHallIdFromInput,
    buildLeaderboard,
  } = deps;

  function ackSuccess<T>(callback: (response: AckResponse<T>) => void, data: T): void {
    callback({ ok: true, data });
  }

  function ackFailure<T>(callback: (response: AckResponse<T>) => void, error: unknown): void {
    callback({
      ok: false,
      error: toPublicError(error)
    });
  }

  const MAX_CHAT_MESSAGES_PER_ROOM = 100;

  function appendChatMessage(roomCode: string, msg: ChatMessage): void {
    let history = chatHistoryByRoom.get(roomCode);
    if (!history) {
      history = [];
      chatHistoryByRoom.set(roomCode, history);
    }
    history.push(msg);
    if (history.length > MAX_CHAT_MESSAGES_PER_ROOM) {
      history.splice(0, history.length - MAX_CHAT_MESSAGES_PER_ROOM);
    }
  }

  function setLuckyNumber(roomCode: string, playerId: string, number: number): void {
    let roomMap = luckyNumbersByRoom.get(roomCode);
    if (!roomMap) {
      roomMap = new Map();
      luckyNumbersByRoom.set(roomCode, roomMap);
    }
    roomMap.set(playerId, number);
  }

  async function getAuthenticatedSocketUser(payload: AuthenticatedSocketPayload | undefined): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromSocketPayload(payload);
    return platformService.getUserFromAccessToken(accessToken);
  }

  function assertUserCanActAsPlayer(user: PublicAppUser, roomCode: string, playerId: string): void {
    const snapshot = engine.getRoomSnapshot(roomCode);
    const player = snapshot.players.find((entry) => entry.id === playerId);
    if (!player) {
      throw new DomainError("PLAYER_NOT_FOUND", "Spiller finnes ikke i rommet.");
    }
    if (user.role === "ADMIN") {
      return;
    }
    if (player.walletId !== user.walletId) {
      throw new DomainError("FORBIDDEN", "Du kan bare utføre handlinger for egen spiller.");
    }
  }

  function assertUserCanAccessRoom(user: PublicAppUser, roomCode: string): void {
    if (user.role === "ADMIN") {
      return;
    }
    const snapshot = engine.getRoomSnapshot(roomCode);
    const inRoom = snapshot.players.some((player) => player.walletId === user.walletId);
    if (!inRoom) {
      throw new DomainError("FORBIDDEN", "Du har ikke tilgang til dette rommet.");
    }
  }

  async function requireAuthenticatedPlayerAction(
    payload: RoomActionPayload
  ): Promise<{ roomCode: string; playerId: string }> {
    const user = await getAuthenticatedSocketUser(payload);
    platformService.assertUserEligibleForGameplay(user);
    engine.assertWalletAllowedForGameplay(user.walletId);
    let roomCode = mustBeNonEmptyString(payload?.roomCode, "roomCode").toUpperCase();

    // BIN-134: SPA sends "BINGO1" as canonical room alias.
    if (roomCode === "BINGO1" && enforceSingleRoomPerHall) {
      const hallId = (payload as unknown as Record<string, unknown>)?.hallId || "default-hall";
      const canonicalRoom = getPrimaryRoomForHall(hallId as string);
      if (canonicalRoom) {
        roomCode = canonicalRoom.code;
        logger.debug({ roomCode }, "BIN-134: requireAuthenticatedPlayerAction BINGO1 → canonical room");
      }
    }

    // BIN-46: Derive playerId from token, NOT from client payload.
    // The player's walletId from the authenticated token is the source of truth.
    // We find the player in the room by matching walletId, preventing spoofing.
    if (user.role !== "ADMIN") {
      const snapshot = engine.getRoomSnapshot(roomCode);
      const player = snapshot.players.find((p) => p.walletId === user.walletId);
      if (!player) {
        throw new DomainError("PLAYER_NOT_FOUND", "Du er ikke med i dette rommet.");
      }
      // Warn if client sent a mismatching playerId (potential spoofing attempt)
      const clientPlayerId = typeof payload?.playerId === "string" ? payload.playerId.trim() : "";
      if (clientPlayerId && clientPlayerId !== player.id) {
        console.warn(
          `SECURITY: playerId mismatch — client sent "${clientPlayerId}" but token resolves to "${player.id}" (user ${user.id}, room ${roomCode})`
        );
      }
      return { roomCode, playerId: player.id };
    }

    // Admin: still accept payload playerId but verify it exists
    const playerId = mustBeNonEmptyString(payload?.playerId, "playerId");
    assertUserCanActAsPlayer(user, roomCode, playerId);
    return { roomCode, playerId };
  }

  return function registerGameEvents(socket: Socket): void {
    /** BIN-164/BIN-247: Wrap a socket handler with rate limiting.
     * Checks both by socket.id (unauthenticated events) and by walletId when available
     * so reconnects don't reset rate limit counters for authenticated players. */
    function rateLimited<P, R>(
      eventName: string,
      handler: (payload: P, callback: (response: AckResponse<R>) => void) => Promise<void>
    ): (payload: P, callback: (response: AckResponse<R>) => void) => void {
      return (payload, callback) => {
        // Always check by socket.id
        if (!socketRateLimiter.check(socket.id, eventName)) {
          ackFailure(callback, new DomainError("RATE_LIMITED", "For mange foresporsler. Vent litt."));
          return;
        }
        // BIN-247: Also check by walletId when authenticated — reconnects get a new socket.id
        // but must not bypass rate limits by simply reconnecting
        const walletId = socket.data.user?.walletId;
        if (walletId && !socketRateLimiter.checkByKey(walletId, eventName)) {
          ackFailure(callback, new DomainError("RATE_LIMITED", "For mange foresporsler. Vent litt."));
          return;
        }
        handler(payload, callback).catch((err) => {
          console.error(`[socket] unhandled error in ${eventName}:`, err);
        });
      };
    }

    async function resolveIdentityFromPayload(payload: CreateRoomPayload): Promise<{
      playerName: string;
      walletId: string;
      hallId: string;
    }> {
      const user = await getAuthenticatedSocketUser(payload);
      platformService.assertUserEligibleForGameplay(user);
      engine.assertWalletAllowedForGameplay(user.walletId);
      const hallId = await requireActiveHallIdFromInput(payload?.hallId);
      return {
        playerName: user.displayName,
        walletId: user.walletId,
        hallId
      };
    }

    socket.on("room:create", rateLimited("room:create", async (payload: CreateRoomPayload, callback: (response: AckResponse<{ roomCode: string; playerId: string; snapshot: RoomSnapshot }>) => void) => {
      logger.debug({ hallId: payload?.hallId, hasAccessToken: !!payload?.accessToken }, "BIN-134: room:create received");
      try {
        const identity = await resolveIdentityFromPayload(payload);
        logger.debug({ hallId: identity.hallId }, "BIN-134: room:create identity resolved");
        if (enforceSingleRoomPerHall) {
          const canonicalRoom = getPrimaryRoomForHall(identity.hallId);
          if (canonicalRoom) {
            const canonicalSnapshot = engine.getRoomSnapshot(canonicalRoom.code);
            const existingPlayer = findPlayerInRoomByWallet(canonicalSnapshot, identity.walletId);

            let playerId = existingPlayer?.id ?? "";
            if (existingPlayer) {
              engine.attachPlayerSocket(canonicalRoom.code, existingPlayer.id, socket.id);
            } else {
              const joined = await engine.joinRoom({
                roomCode: canonicalRoom.code,
                hallId: identity.hallId,
                playerName: identity.playerName,
                walletId: identity.walletId,
                socketId: socket.id
              });
              playerId = joined.playerId;
            }

            socket.join(canonicalRoom.code);
            const snapshot = await emitRoomUpdate(canonicalRoom.code);
            logger.debug({ roomCode: canonicalRoom.code }, "BIN-134: room:create → existing canonical");
            ackSuccess(callback, { roomCode: canonicalRoom.code, playerId, snapshot });
            return;
          }
        }

        const { roomCode, playerId } = await engine.createRoom({
          playerName: identity.playerName,
          hallId: identity.hallId,
          walletId: identity.walletId,
          socketId: socket.id,
          // BIN-134: Use "BINGO1" as actual room code so SPA alias = real code
          roomCode: enforceSingleRoomPerHall ? "BINGO1" : undefined,
          gameSlug: typeof payload?.gameSlug === "string" ? payload.gameSlug : undefined
        });
        socket.join(roomCode);
        const snapshot = await emitRoomUpdate(roomCode);
        logger.debug({ roomCode }, "BIN-134: room:create SUCCESS");
        ackSuccess(callback, { roomCode, playerId, snapshot });
      } catch (error) {
        logger.error({ err: error, code: (error as Record<string, unknown>).code }, "BIN-134: room:create FAILED");
        ackFailure(callback, error);
      }
    }));

    socket.on("room:join", rateLimited("room:join", async (payload: JoinRoomPayload, callback: (response: AckResponse<{ roomCode: string; playerId: string; snapshot: RoomSnapshot }>) => void) => {
      try {
        let roomCode = mustBeNonEmptyString(payload?.roomCode, "roomCode").toUpperCase();
        const identity = await resolveIdentityFromPayload(payload);
        if (enforceSingleRoomPerHall) {
          // BIN-134: resolve BINGO1 alias
          if (roomCode === "BINGO1") {
            const canonicalRoom = getPrimaryRoomForHall(identity.hallId);
            if (canonicalRoom) {
              roomCode = canonicalRoom.code;
            } else {
              // Auto-create room for this hall if none exists
              logger.debug({ hallId: identity.hallId }, "room:join auto-creating room for hall");
              const newRoom = await engine.createRoom({
                hallId: identity.hallId,
                playerName: identity.playerName,
                walletId: identity.walletId,
                socketId: socket.id,
              });
              roomCode = newRoom.roomCode;
            }
          }
          const canonicalRoom = getPrimaryRoomForHall(identity.hallId);
          if (canonicalRoom && canonicalRoom.code !== roomCode) {
            throw new DomainError(
              "SINGLE_ROOM_ONLY",
              `Kun ett bingo-rom er aktivt per hall. Bruk rom ${canonicalRoom.code}.`
            );
          }
        }

        const roomSnapshot = engine.getRoomSnapshot(roomCode);
        const existingPlayer = findPlayerInRoomByWallet(roomSnapshot, identity.walletId);
        if (existingPlayer) {
          engine.attachPlayerSocket(roomCode, existingPlayer.id, socket.id);
          socket.join(roomCode);
          const snapshot = await emitRoomUpdate(roomCode);
          ackSuccess(callback, { roomCode, playerId: existingPlayer.id, snapshot });
          return;
        }

        const { playerId } = await engine.joinRoom({
          roomCode,
          hallId: identity.hallId,
          playerName: identity.playerName,
          walletId: identity.walletId,
          socketId: socket.id
        });
        socket.join(roomCode);
        const snapshot = await emitRoomUpdate(roomCode);
        ackSuccess(callback, { roomCode, playerId, snapshot });
      } catch (error) {
        console.error("[room:join] FAILED:", toPublicError(error));
        ackFailure(callback, error);
      }
    }));

    socket.on("room:resume", rateLimited("room:resume", async (payload: ResumeRoomPayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        engine.attachPlayerSocket(roomCode, playerId, socket.id);
        socket.join(roomCode);
        const snapshot = await emitRoomUpdate(roomCode);
        ackSuccess(callback, { snapshot });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("room:configure", rateLimited("room:configure", async (
      payload: ConfigureRoomPayload,
      callback: (response: AckResponse<{ snapshot: RoomSnapshot; entryFee: number }>) => void
    ) => {
      try {
        const { roomCode } = await requireAuthenticatedPlayerAction(payload);
        engine.getRoomSnapshot(roomCode);

        const requestedEntryFee = parseOptionalNonNegativeNumber(payload?.entryFee, "entryFee");
        if (requestedEntryFee === undefined) {
          throw new DomainError("INVALID_INPUT", "entryFee må oppgis.");
        }

        // setRoomConfiguredEntryFee
        const normalized = Math.max(0, Math.round(requestedEntryFee * 100) / 100);
        deps.roomConfiguredEntryFeeByRoom.set(roomCode, normalized);
        const entryFee = normalized;

        const updatedSnapshot = await emitRoomUpdate(roomCode);
        ackSuccess(callback, { snapshot: updatedSnapshot, entryFee });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("room:state", rateLimited("room:state", async (payload: RoomStatePayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
      try {
        const user = await getAuthenticatedSocketUser(payload);
        let roomCode = mustBeNonEmptyString(payload?.roomCode, "roomCode").toUpperCase();

        // BIN-134: SPA sends "BINGO1" as canonical room code.
        // Map it to the actual canonical room for the hall.
        if (roomCode === "BINGO1" && enforceSingleRoomPerHall) {
          const hallId = (payload as unknown as Record<string, unknown>)?.hallId || "default-hall";
          const canonicalRoom = getPrimaryRoomForHall(hallId as string);
          if (canonicalRoom) {
            roomCode = canonicalRoom.code;
            logger.debug({ roomCode }, "BIN-134: room:state BINGO1 → canonical room");
          }
          // If no canonical room exists, fall through — ROOM_NOT_FOUND triggers SPA auto-create
        }

        assertUserCanAccessRoom(user, roomCode);
        const snapshot = buildRoomUpdatePayload(engine.getRoomSnapshot(roomCode));
        ackSuccess(callback, { snapshot });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("bet:arm", rateLimited("bet:arm", async (
      payload: RoomActionPayload & { armed?: boolean; ticketCount?: number; ticketSelections?: Array<{ type: string; qty: number }> },
      callback: (response: AckResponse<{ snapshot: RoomSnapshot; armed: boolean }>) => void
    ) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        const wantArmed = payload.armed !== false;
        if (wantArmed) {
          // New path: per-type selections
          if (Array.isArray(payload.ticketSelections) && payload.ticketSelections.length > 0) {
            const selections = payload.ticketSelections
              .filter((s) => s && typeof s.type === "string" && typeof s.qty === "number" && s.qty > 0)
              .map((s) => ({ type: s.type, qty: Math.max(1, Math.round(s.qty)) }));

            if (selections.length === 0) {
              throw new DomainError("INVALID_INPUT", "Ingen gyldige billettvalg.");
            }

            // Validate total weighted count <= 30 using variant config ticketTypes for weights
            const variantInfo = deps.getVariantConfig?.(roomCode);
            const ticketTypes = variantInfo?.config?.ticketTypes ?? [];
            let totalWeighted = 0;
            for (const sel of selections) {
              const tt = ticketTypes.find((t) => t.type === sel.type);
              const weight = tt?.ticketCount ?? 1; // ticketCount IS the weight (small=1, large=3, elvis=2)
              totalWeighted += sel.qty * weight;
            }
            if (totalWeighted > 30) {
              throw new DomainError("INVALID_INPUT", `Totalt antall brett (${totalWeighted}) overstiger maks 30.`);
            }
            if (totalWeighted < 1) {
              throw new DomainError("INVALID_INPUT", "Du må velge minst 1 brett.");
            }
            armPlayer(roomCode, playerId, totalWeighted, selections);
          } else {
            // Backward compat: flat ticketCount
            const ticketCount = Math.min(30, Math.max(1, Math.round(payload.ticketCount ?? 1)));
            armPlayer(roomCode, playerId, ticketCount);
          }
        } else {
          disarmPlayer(roomCode, playerId);
        }
        const snapshot = await emitRoomUpdate(roomCode);
        ackSuccess(callback, { snapshot, armed: wantArmed });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("game:start", rateLimited("game:start", async (payload: StartGamePayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        const requestedTicketsPerPlayer =
          payload?.ticketsPerPlayer === undefined || payload?.ticketsPerPlayer === null
            ? undefined
            : parseTicketsPerPlayerInput(payload.ticketsPerPlayer);
        const hallGameConfig = await resolveBingoHallGameConfigForRoom(roomCode);
        const ticketsPerPlayer =
          requestedTicketsPerPlayer ??
          Math.min(hallGameConfig.maxTicketsPerPlayer, runtimeBingoSettings.autoRoundTicketsPerPlayer);
        assertTicketsPerPlayerWithinHallLimit(ticketsPerPlayer, hallGameConfig.maxTicketsPerPlayer);
        const variantInfo = deps.getVariantConfig?.(roomCode);
        await engine.startGame({
          roomCode,
          actorPlayerId: playerId,
          entryFee: payload?.entryFee ?? getRoomConfiguredEntryFee(roomCode),
          ticketsPerPlayer,
          payoutPercent: runtimeBingoSettings.payoutPercent,
          armedPlayerIds: getArmedPlayerIds(roomCode),
          armedPlayerTicketCounts: deps.getArmedPlayerTicketCounts(roomCode),
          armedPlayerSelections: deps.getArmedPlayerSelections(roomCode),
          gameType: variantInfo?.gameType,
          variantConfig: variantInfo?.config,
        });
        disarmAllPlayers(roomCode);
        clearDisplayTicketCache(roomCode);
        const snapshot = await emitRoomUpdate(roomCode);
        ackSuccess(callback, { snapshot });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("game:end", rateLimited("game:end", async (payload: EndGamePayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        await engine.endGame({
          roomCode,
          actorPlayerId: playerId,
          reason: payload?.reason
        });
        const snapshot = await emitRoomUpdate(roomCode);
        ackSuccess(callback, { snapshot });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("draw:next", rateLimited("draw:next", async (payload: RoomActionPayload, callback: (response: AckResponse<{ number: number; snapshot: RoomSnapshot }>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        const { number, drawIndex, gameId } = await engine.drawNextNumber({ roomCode, actorPlayerId: playerId });
        io.to(roomCode).emit("draw:new", { number, drawIndex, gameId });
        const snapshot = await emitRoomUpdate(roomCode);
        ackSuccess(callback, { number, snapshot });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("draw:extra:purchase", rateLimited("draw:extra:purchase", async (payload: ExtraDrawPayload, callback: (response: AckResponse<{ denied: true }>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        engine.rejectExtraDrawPurchase({
          source: "SOCKET",
          roomCode,
          playerId,
          metadata: {
            requestedCount:
              payload?.requestedCount === undefined ? undefined : Number(payload.requestedCount),
            packageId: typeof payload?.packageId === "string" ? payload.packageId : undefined
          }
        });
        ackSuccess(callback, { denied: true });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("ticket:mark", rateLimited("ticket:mark", async (payload: MarkPayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        if (!Number.isFinite(payload?.number)) {
          throw new DomainError("INVALID_INPUT", "number mangler.");
        }
        await engine.markNumber({
          roomCode,
          playerId,
          number: Number(payload.number)
        });
        const snapshot = await emitRoomUpdate(roomCode);
        ackSuccess(callback, { snapshot });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("claim:submit", rateLimited("claim:submit", async (payload: ClaimPayload, callback: (response: AckResponse<{ snapshot: RoomSnapshot }>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        if (payload?.type !== "LINE" && payload?.type !== "BINGO") {
          throw new DomainError("INVALID_INPUT", "type må være LINE eller BINGO.");
        }
        const claim = await engine.submitClaim({
          roomCode,
          playerId,
          type: payload.type
        });
        const snapshot = await emitRoomUpdate(roomCode);
        // Emit pattern:won if a pattern was completed by this claim
        if (claim.valid) {
          const wonPattern = snapshot.currentGame?.patternResults?.find(
            (r) => r.claimId === claim.id && r.isWon
          );
          if (wonPattern) {
            io.to(roomCode).emit("pattern:won", {
              patternId: wonPattern.patternId,
              patternName: wonPattern.patternName,
              winnerId: wonPattern.winnerId,
              wonAtDraw: wonPattern.wonAtDraw,
              payoutAmount: wonPattern.payoutAmount,
              claimType: wonPattern.claimType,
              gameId: snapshot.currentGame?.id
            });
          }
          // Game 1 (Classic Bingo): activate mini-game after BINGO win
          if (payload.type === "BINGO" && snapshot.gameSlug === "bingo") {
            const miniGame = engine.activateMiniGame(roomCode, playerId);
            if (miniGame) {
              socket.emit("minigame:activated", {
                gameId: snapshot.currentGame?.id,
                playerId,
                type: miniGame.type,
                prizeList: miniGame.prizeList,
              });
            }
          }
          // Game 5 (Spillorama): activate jackpot after BINGO win
          if (payload.type === "BINGO" && snapshot.gameSlug === "spillorama") {
            const jackpot = engine.activateJackpot(roomCode, playerId);
            if (jackpot) {
              // Send jackpot activation to the winning player only
              socket.emit("jackpot:activated", {
                gameId: snapshot.currentGame?.id,
                playerId,
                prizeList: jackpot.prizeList,
                totalSpins: jackpot.totalSpins,
                playedSpins: jackpot.playedSpins,
                spinHistory: jackpot.spinHistory,
              });
            }
          }
        }
        ackSuccess(callback, { snapshot });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    // ── Lucky number ──────────────────────────────────────────────────────────
    socket.on("lucky:set", rateLimited("lucky:set", async (payload: LuckyNumberPayload, callback: (response: AckResponse<{ luckyNumber: number }>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        const num = payload?.luckyNumber;
        if (!Number.isInteger(num) || num < 1 || num > 60) {
          throw new DomainError("INVALID_INPUT", "luckyNumber må være mellom 1 og 60.");
        }
        // Only allow setting before game starts or during waiting
        const snapshot = engine.getRoomSnapshot(roomCode);
        if (snapshot.currentGame?.status === "RUNNING") {
          throw new DomainError("GAME_IN_PROGRESS", "Kan ikke endre lykketall mens spillet pågår.");
        }
        setLuckyNumber(roomCode, playerId, num);
        await emitRoomUpdate(roomCode);
        ackSuccess(callback, { luckyNumber: num });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    // ── Jackpot (Game 5 Free Spin) ─────────────────────────────────────────
    socket.on("jackpot:spin", rateLimited("jackpot:spin", async (payload: RoomActionPayload, callback: (response: AckResponse<unknown>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        const result = await engine.spinJackpot(roomCode, playerId);
        ackSuccess(callback, result);
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    // ── Mini-game (Game 1 — Wheel of Fortune / Treasure Chest) ─────────────
    socket.on("minigame:play", rateLimited("minigame:play", async (payload: RoomActionPayload & { selectedIndex?: number }, callback: (response: AckResponse<unknown>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        const selectedIndex = typeof payload?.selectedIndex === "number" ? payload.selectedIndex : undefined;
        const result = await engine.playMiniGame(roomCode, playerId, selectedIndex);
        ackSuccess(callback, result);
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    // ── Chat ─────────────────────────────────────────────────────────────────
    socket.on("chat:send", rateLimited("chat:send", async (payload: ChatSendPayload, callback: (response: AckResponse<{ message: ChatMessage }>) => void) => {
      try {
        const { roomCode, playerId } = await requireAuthenticatedPlayerAction(payload);
        const message = (payload?.message ?? "").trim();
        if (!message && (payload?.emojiId ?? 0) === 0) {
          throw new DomainError("INVALID_INPUT", "Meldingen kan ikke være tom.");
        }
        const snapshot = engine.getRoomSnapshot(roomCode);
        const player = snapshot.players.find((p) => p.id === playerId);
        const chatMsg: ChatMessage = {
          id: randomUUID(),
          playerId,
          playerName: player?.name ?? "Ukjent",
          message: message.slice(0, 500),
          emojiId: payload?.emojiId ?? 0,
          createdAt: new Date().toISOString()
        };
        appendChatMessage(roomCode, chatMsg);
        io.to(roomCode).emit("chat:message", chatMsg);
        ackSuccess(callback, { message: chatMsg });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("chat:history", rateLimited("chat:history", async (payload: RoomActionPayload, callback: (response: AckResponse<{ messages: ChatMessage[] }>) => void) => {
      try {
        const { roomCode } = await requireAuthenticatedPlayerAction(payload);
        const messages = chatHistoryByRoom.get(roomCode) ?? [];
        ackSuccess(callback, { messages });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    // ── Leaderboard ──────────────────────────────────────────────────────────
    socket.on("leaderboard:get", rateLimited("leaderboard:get", async (payload: LeaderboardPayload, callback: (response: AckResponse<{ leaderboard: LeaderboardEntry[] }>) => void) => {
      try {
        const leaderboard = buildLeaderboard(payload?.roomCode);
        ackSuccess(callback, { leaderboard });
      } catch (error) {
        ackFailure(callback, error);
      }
    }));

    socket.on("disconnect", () => {
      engine.detachSocket(socket.id);
      socketRateLimiter.cleanup(socket.id);
    });
  };
}
