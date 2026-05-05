/**
 * PR-R4: Shared handler-context som hver cluster-fil tar inn.
 *
 * Kontrakt:
 *   - `buildRegistryContext(deps)` kalles ÉN gang i `registerGameEventHandlers`
 *     (i.e. før `io.on("connection")`) og returnerer helpers som ikke trenger
 *     socket-scope (ack, auth-asserter, chat/lucky-mutators, logger).
 *   - `buildSocketContext(socket, base, deps)` kalles per `socket`-connection og
 *     legger til `rateLimited` og `requireAuthenticatedPlayerAction` (som begge
 *     kan trenge socket-scope for rate-limiter og payload→playerId-resolving).
 *   - Hver cluster-fil tar `SocketContext` inn og registrerer `socket.on(...)`.
 *
 * Dette bevarer:
 *   - rate-limit state per-socket + per-walletId (BIN-247)
 *   - ack error-håndtering (DomainError → breadcrumb, ellers captureError)
 *   - auth/room-access-guards uendret
 *   - log-scope `{ module: "gameEvents" }`
 */
import type { Server, Socket } from "socket.io";
import type { Logger } from "pino";
import { toPublicError } from "../../game/BingoEngine.js";
import { DomainError } from "../../errors/DomainError.js";
import { addBreadcrumb, captureError } from "../../observability/sentry.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import { getAccessTokenFromSocketPayload, mustBeNonEmptyString } from "../../util/httpHelpers.js";
import { logger as rootLogger } from "../../util/logger.js";
import { getCanonicalRoomCode } from "../../util/canonicalRoomCode.js";
import { isSystemActor } from "../../game/SystemActor.js";
import type { GameEventsDeps } from "./deps.js";
import type {
  AckResponse,
  AuthenticatedSocketPayload,
  ChatMessage,
  RoomActionPayload,
} from "./types.js";

const MAX_CHAT_MESSAGES_PER_ROOM = 100;

/** Helpers som ikke trenger socket-scope — bygges én gang per server-start. */
export interface RegistryContext {
  readonly deps: GameEventsDeps;
  readonly io: Server;
  readonly engine: BingoEngine;
  readonly platformService: PlatformService;
  readonly logger: Logger;
  ackSuccess<T>(callback: (response: AckResponse<T>) => void, data: T): void;
  ackFailure<T>(callback: (response: AckResponse<T>) => void, error: unknown, eventName?: string): void;
  appendChatMessage(roomCode: string, msg: ChatMessage): void;
  setLuckyNumber(roomCode: string, playerId: string, number: number): void;
  getAuthenticatedSocketUser(payload: AuthenticatedSocketPayload | undefined): Promise<PublicAppUser>;
  assertUserCanActAsPlayer(user: PublicAppUser, roomCode: string, playerId: string): void;
  assertUserCanAccessRoom(user: PublicAppUser, roomCode: string): void;
}

/** Helpers som trenger socket-scope — bygges per `io.on("connection")`. */
export interface SocketContext extends RegistryContext {
  readonly socket: Socket;
  rateLimited<P, R>(
    eventName: string,
    handler: (payload: P, callback: (response: AckResponse<R>) => void) => Promise<void>,
  ): (payload: P, callback: (response: AckResponse<R>) => void) => void;
  requireAuthenticatedPlayerAction(
    payload: RoomActionPayload,
  ): Promise<{ roomCode: string; playerId: string }>;
  resolveIdentityFromPayload(payload: {
    accessToken?: string;
    hallId?: string;
  }): Promise<{ playerName: string; walletId: string; hallId: string }>;
}

export function buildRegistryContext(deps: GameEventsDeps): RegistryContext {
  const { engine, platformService, io, chatHistoryByRoom, luckyNumbersByRoom } = deps;
  const logger = rootLogger.child({ module: "gameEvents" });

  function ackSuccess<T>(callback: (response: AckResponse<T>) => void, data: T): void {
    callback({ ok: true, data });
  }

  function ackFailure<T>(
    callback: (response: AckResponse<T>) => void,
    error: unknown,
    eventName?: string,
  ): void {
    const publicErr = toPublicError(error);
    // BIN-539: DomainError is an expected validation outcome — don't spam
    // Sentry with client-input issues. Capture everything else.
    if (!(error instanceof DomainError)) {
      captureError(error, { event: eventName, errCode: publicErr.code });
    } else {
      addBreadcrumb("socket.domain_error", { event: eventName, code: publicErr.code }, "warning");
    }
    callback({ ok: false, error: publicErr });
  }

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

  async function getAuthenticatedSocketUser(
    payload: AuthenticatedSocketPayload | undefined,
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromSocketPayload(payload);
    return platformService.getUserFromAccessToken(accessToken);
  }

  function assertUserCanActAsPlayer(
    user: PublicAppUser,
    roomCode: string,
    playerId: string,
  ): void {
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

  return {
    deps,
    io,
    engine,
    platformService,
    logger,
    ackSuccess,
    ackFailure,
    appendChatMessage,
    setLuckyNumber,
    getAuthenticatedSocketUser,
    assertUserCanActAsPlayer,
    assertUserCanAccessRoom,
  };
}

export function buildSocketContext(socket: Socket, base: RegistryContext): SocketContext {
  const { deps, engine, platformService, logger } = base;
  const {
    socketRateLimiter,
    enforceSingleRoomPerHall,
    getPrimaryRoomForHall,
    requireActiveHallIdFromInput,
  } = deps;

  /** BIN-164/BIN-247: Wrap a socket handler with rate limiting.
   * Checks both by socket.id (unauthenticated events) and by walletId when available
   * so reconnects don't reset rate limit counters for authenticated players. */
  function rateLimited<P, R>(
    eventName: string,
    handler: (payload: P, callback: (response: AckResponse<R>) => void) => Promise<void>,
  ): (payload: P, callback: (response: AckResponse<R>) => void) => void {
    return (payload, callback) => {
      // Always check by socket.id
      if (!socketRateLimiter.check(socket.id, eventName)) {
        base.ackFailure(
          callback,
          new DomainError("RATE_LIMITED", "For mange foresporsler. Vent litt."),
        );
        return;
      }
      // BIN-247: Also check by walletId when authenticated — reconnects get a new socket.id
      // but must not bypass rate limits by simply reconnecting
      const walletId = socket.data.user?.walletId;
      if (walletId && !socketRateLimiter.checkByKey(walletId, eventName)) {
        base.ackFailure(
          callback,
          new DomainError("RATE_LIMITED", "For mange foresporsler. Vent litt."),
        );
        return;
      }
      handler(payload, callback).catch((err) => {
        console.error(`[socket] unhandled error in ${eventName}:`, err);
      });
    };
  }

  async function resolveIdentityFromPayload(payload: {
    accessToken?: string;
    hallId?: string;
  }): Promise<{ playerName: string; walletId: string; hallId: string }> {
    const user = await base.getAuthenticatedSocketUser(payload);
    // BIN-720 follow-up: assertUserEligibleForGameplay is now async (it
    // gates on blocked_until via ProfileSettingsService).
    await platformService.assertUserEligibleForGameplay(user);
    engine.assertWalletAllowedForGameplay(user.walletId);
    const hallId = await requireActiveHallIdFromInput(payload?.hallId);
    return {
      playerName: user.displayName,
      walletId: user.walletId,
      hallId,
    };
  }

  async function requireAuthenticatedPlayerAction(
    payload: RoomActionPayload,
  ): Promise<{ roomCode: string; playerId: string }> {
    // Audit-fix 2026-05-06 (SPILL2_3_CASINO_GRADE_AUDIT_2026-05-05 §2.1):
    // defense-in-depth — avvis SYSTEM_ACTOR_ID i klient-payload eksplisitt.
    // I praksis utleder vi `playerId` fra wallet-token uansett (linje ~280
    // under), så en klient kan IKKE faktisk styre playerId — men hvis en
    // ondsinnet klient sender `playerId: "__system_actor__"` i payload bør
    // vi feile høyt, ikke bare ignorere det. Beskytter også mot framtidige
    // refaktor som kan komme til å lese fra payload direkte.
    const clientPlayerIdRaw =
      typeof payload?.playerId === "string" ? payload.playerId.trim() : "";
    if (clientPlayerIdRaw && isSystemActor(clientPlayerIdRaw)) {
      logger.warn(
        {
          event: "system_actor_spoof_attempt",
          payloadPlayerId: clientPlayerIdRaw,
          socketId: socket.id,
        },
        "SECURITY: client tried to send SYSTEM_ACTOR_ID as playerId — rejected",
      );
      throw new DomainError(
        "FORBIDDEN",
        "Klient kan ikke utgi seg som system.",
      );
    }

    const user = await base.getAuthenticatedSocketUser(payload);
    // BIN-720 follow-up: assertUserEligibleForGameplay is now async (it
    // gates on blocked_until via ProfileSettingsService).
    await platformService.assertUserEligibleForGameplay(user);
    engine.assertWalletAllowedForGameplay(user.walletId);
    let roomCode = mustBeNonEmptyString(payload?.roomCode, "roomCode").toUpperCase();

    // BIN-134: SPA sends "BINGO1" as canonical room alias.
    // Bug B fix (Tobias 2026-04-28): canonical-aware lookup.
    // Tidligere `getPrimaryRoomForHall` filtrerte på room.hallId og misset
    // shared canonical rooms (Spill 1 group-of-halls). Ny logikk: bruk
    // canonical mapping direkte. Hvis rommet eksisterer → bruk det. Hvis
    // ikke → faller tilbake til legacy `getPrimaryRoomForHall` så
    // bet:arm/claim:submit fortsatt fungerer for non-canonical rom.
    if (roomCode === "BINGO1" && enforceSingleRoomPerHall) {
      const hallId = ((payload as unknown as Record<string, unknown>)?.hallId || "default-hall") as string;
      let canonicalGroupId: string | null = null;
      if (deps.getHallGroupIdForHall) {
        try {
          canonicalGroupId = await deps.getHallGroupIdForHall(hallId);
        } catch {
          // fail-soft
        }
      }
      const canonicalMapping = getCanonicalRoomCode("bingo", hallId, canonicalGroupId);
      const existingCanonical = engine.findRoomByCode(canonicalMapping.roomCode);
      if (existingCanonical) {
        roomCode = existingCanonical.code;
        logger.debug(
          { roomCode },
          "BIN-134: requireAuthenticatedPlayerAction BINGO1 → canonical room (canonical-aware)",
        );
      } else {
        // Backward-compat: fall tilbake til legacy hallId-based lookup
        const canonicalRoom = getPrimaryRoomForHall(hallId);
        if (canonicalRoom) {
          roomCode = canonicalRoom.code;
          logger.debug(
            { roomCode },
            "BIN-134: requireAuthenticatedPlayerAction BINGO1 → canonical room (legacy)",
          );
        }
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
          `SECURITY: playerId mismatch — client sent "${clientPlayerId}" but token resolves to "${player.id}" (user ${user.id}, room ${roomCode})`,
        );
      }
      return { roomCode, playerId: player.id };
    }

    // Admin-sti (to modus):
    //   1) Self-play: admin har selv en player-rad i rommet (via walletId-match
    //      fra room:create). Behandler som vanlig spiller – derive fra token.
    //      Dette lar en admin-bruker teste Spill 1 uten å måtte populere
    //      `playerId` i hver payload fra klienten.
    //   2) Agent/operator-modus: admin handler på vegne av annen spiller
    //      (agent-portal, check-bingo osv). Da SKAL `playerId` være i payload.
    const adminSnapshot = engine.getRoomSnapshot(roomCode);
    const adminPlayer = adminSnapshot.players.find((p) => p.walletId === user.walletId);
    if (adminPlayer) {
      // Admin er selv spiller – samme anti-spoof-sjekk som over.
      const clientPlayerId = typeof payload?.playerId === "string" ? payload.playerId.trim() : "";
      if (clientPlayerId && clientPlayerId !== adminPlayer.id) {
        console.warn(
          `SECURITY: admin playerId mismatch — client sent "${clientPlayerId}" but token resolves to "${adminPlayer.id}" (user ${user.id}, room ${roomCode})`,
        );
      }
      return { roomCode, playerId: adminPlayer.id };
    }

    // Admin acting on behalf of someone else: require explicit playerId.
    const playerId = mustBeNonEmptyString(payload?.playerId, "playerId");
    base.assertUserCanActAsPlayer(user, roomCode, playerId);
    return { roomCode, playerId };
  }

  return {
    ...base,
    socket,
    rateLimited,
    requireAuthenticatedPlayerAction,
    resolveIdentityFromPayload,
  };
}
