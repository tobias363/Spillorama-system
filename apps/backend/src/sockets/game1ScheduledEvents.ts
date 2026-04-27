/**
 * GAME1_SCHEDULE PR 4d.2: socket player-join for schedulert Spill 1.
 *
 * Spec: docs/architecture/GAME1_PR4D_SOCKET_REALTIME_DESIGN_2026-04-21.md §3.3.
 *
 * Eget handler-sett (isolert fra `gameEvents.ts` per design-dok §9) for
 * Spill 1-spesifikke socket-events. I 4d.2 registreres kun
 * `game1:join-scheduled`; real-time broadcast-events kommer i 4d.3 og
 * stop-refund i 4d.4.
 *
 * Flyt:
 *   1. Auth via accessToken (samme mekanikk som room:create).
 *   2. SELECT app_game1_scheduled_games → valider status ∈
 *      {purchase_open, running} og hallId ∈ participating_halls_json.
 *   3. Slå opp eksisterende room_code. Hvis satt: engine.joinRoom
 *      (reconnect eller ny spiller). Hvis null: engine.createRoom +
 *      Game1DrawEngineService.assignRoomCode (atomisk persist med race-
 *      safety mot samtidige joins).
 *   4. ACK { roomCode, playerId, snapshot } — samme shape som
 *      room:create/room:join.
 */

import type { Pool } from "pg";
import type { Socket } from "socket.io";
import type { BingoEngine } from "../game/BingoEngine.js";
import { DomainError, toPublicError } from "../game/BingoEngine.js";
import type { RoomSnapshot } from "../game/types.js";
import type { Game1DrawEngineService } from "../game/Game1DrawEngineService.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../platform/PlatformService.js";
import type { SocketRateLimiter } from "../middleware/socketRateLimit.js";
import {
  Game1JoinScheduledPayloadSchema,
  type Game1JoinScheduledPayload,
} from "@spillorama/shared-types/socket-events";
import { getAccessTokenFromSocketPayload } from "../util/httpHelpers.js";
import { logger as rootLogger } from "../util/logger.js";
import { captureError } from "../observability/sentry.js";

const log = rootLogger.child({ module: "game1-scheduled-events" });

export interface Game1ScheduledEventsDeps {
  pool: Pool;
  engine: BingoEngine;
  game1DrawEngine: Game1DrawEngineService;
  platformService: PlatformService;
  socketRateLimiter: SocketRateLimiter;
  emitRoomUpdate: (roomCode: string) => Promise<RoomSnapshot>;
  /**
   * Hook for å binde variant-config når nytt bingo-rom opprettes. Matcher
   * gameEvents.ts' `bindVariantConfigForRoom` / `bindDefaultVariantConfig`.
   * Optional så testing kan operere uten denne.
   */
  bindDefaultVariantConfig?: (roomCode: string, gameSlug: string) => void;
}

interface AckResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

interface JoinScheduledAckData {
  roomCode: string;
  playerId: string;
  snapshot: RoomSnapshot;
}

interface ScheduledGameJoinRow {
  id: string;
  status: string;
  room_code: string | null;
  participating_halls_json: unknown;
}

const JOINABLE_STATUSES = new Set(["purchase_open", "running"]);

export function createGame1ScheduledEventHandlers(
  deps: Game1ScheduledEventsDeps
) {
  const {
    pool,
    engine,
    game1DrawEngine,
    platformService,
    socketRateLimiter,
    emitRoomUpdate,
    bindDefaultVariantConfig,
  } = deps;

  function ackSuccess<T>(
    callback: (response: AckResponse<T>) => void,
    data: T
  ): void {
    callback({ ok: true, data });
  }

  function ackFailure<T>(
    callback: (response: AckResponse<T>) => void,
    error: unknown,
    eventName?: string
  ): void {
    const publicErr = toPublicError(error);
    if (!(error instanceof DomainError)) {
      captureError(error, { event: eventName, errCode: publicErr.code });
    }
    callback({ ok: false, error: publicErr });
  }

  async function getAuthenticatedUser(
    payload: Game1JoinScheduledPayload
  ): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromSocketPayload(payload);
    return platformService.getUserFromAccessToken(accessToken);
  }

  /**
   * Les scheduled_game for join-validering. Inkluderer room_code og
   * participating_halls_json.
   */
  async function loadScheduledGameForJoin(
    scheduledGameId: string
  ): Promise<ScheduledGameJoinRow> {
    const { rows } = await pool.query<ScheduledGameJoinRow>(
      `SELECT id, status, room_code, participating_halls_json
         FROM app_game1_scheduled_games
         WHERE id = $1`,
      [scheduledGameId]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("GAME_NOT_FOUND", "Spillet finnes ikke.");
    }
    return row;
  }

  function assertHallAllowedForGame(
    hallId: string,
    row: ScheduledGameJoinRow
  ): void {
    const halls = row.participating_halls_json;
    if (!Array.isArray(halls) || halls.length === 0) {
      throw new DomainError(
        "HALL_NOT_ALLOWED",
        "Spillet har ingen deltagende haller definert."
      );
    }
    const allowed = halls.every((h) => typeof h === "string")
      ? (halls as string[]).includes(hallId)
      : false;
    if (!allowed) {
      throw new DomainError(
        "HALL_NOT_ALLOWED",
        "Hallen din deltar ikke i dette spillet."
      );
    }
  }

  function assertGameJoinable(status: string): void {
    if (!JOINABLE_STATUSES.has(status)) {
      throw new DomainError(
        "GAME_NOT_JOINABLE",
        `Kan ikke joine spill i status '${status}'.`
      );
    }
  }

  /**
   * Hovedflyt: player-join inn i schedulert rom.
   *
   * - Hvis room_code allerede satt: joinRoom (reconnect-trygg — samme wallet
   *   → samme player per eksisterende joinRoom-logikk).
   * - Ellers: createRoom + assignRoomCode. Hvis race (annen request vant):
   *   destroy egen, joinRoom inn i vinneren.
   */
  async function joinScheduledGame(
    row: ScheduledGameJoinRow,
    user: PublicAppUser,
    hallId: string,
    playerName: string,
    socketId: string
  ): Promise<JoinScheduledAckData> {
    if (row.room_code) {
      // Eksisterende rom — gjenta join (idempotent hvis samme wallet).
      const { roomCode, playerId } = await engine.joinRoom({
        roomCode: row.room_code,
        hallId,
        playerName,
        walletId: user.walletId,
        socketId,
      });
      // CRIT-4: rommet kan ha blitt rebygget av en restart (Render-instans
      // som lastet state fra Redis-store) uten at scheduledGameId ble
      // hydrert fra DB-mappingen. Marker idempotent her så guarden
      // dekker tilfellet "room re-joined etter restart".
      try {
        engine.markRoomAsScheduled(roomCode, row.id);
      } catch (err) {
        log.warn(
          { err, roomCode, scheduledGameId: row.id },
          "markRoomAsScheduled på existing-rom feilet — scheduled-engine er autoritativ"
        );
      }
      const snapshot = engine.getRoomSnapshot(roomCode);
      return { roomCode, playerId, snapshot };
    }

    // Demo Hall bypass (Tobias 2026-04-27): hent `isTestHall` fra hallen
    // så `RoomState.isTestHall=true` for test-haller propageres til
    // `BingoEnginePatternEval.evaluateActivePhase`. Uten dette slår
    // Spill 1 auto-pause (PR #643) inn etter Phase 1 og scheduled-spillet
    // henger til master resumer manuelt — bug rapportert 2026-04-27.
    let isTestHall = false;
    try {
      const hall = await platformService.getHall(hallId);
      isTestHall = hall.isTestHall === true;
    } catch (err) {
      log.warn(
        { err, hallId },
        "isTestHall lookup failed — defaulting to false (regular hall)"
      );
    }
    // Ingen room_code enda. Opprett nytt rom, persister mapping.
    const created = await engine.createRoom({
      hallId,
      playerName,
      walletId: user.walletId,
      socketId,
      gameSlug: "bingo",
      ...(isTestHall ? { isTestHall: true } : {}),
    });
    if (bindDefaultVariantConfig) {
      bindDefaultVariantConfig(created.roomCode, "bingo");
    }

    const actualRoomCode = await game1DrawEngine.assignRoomCode(
      row.id,
      created.roomCode
    );

    if (actualRoomCode === created.roomCode) {
      // CRIT-4: marker rommet som scheduled så BingoEngine.startGame /
      // drawNextNumber / submitClaim defensivt blokkerer ad-hoc-mutasjon.
      // Best-effort — hvis dette kaster (rommet borte etter race) er
      // scheduled-flyten allerede ansvarlig for state via
      // Game1DrawEngineService.
      try {
        engine.markRoomAsScheduled(created.roomCode, row.id);
      } catch (err) {
        log.warn(
          { err, roomCode: created.roomCode, scheduledGameId: row.id },
          "markRoomAsScheduled feilet etter assignRoomCode — fortsetter, scheduled-engine er autoritativ"
        );
      }
      const snapshot = engine.getRoomSnapshot(created.roomCode);
      return {
        roomCode: created.roomCode,
        playerId: created.playerId,
        snapshot,
      };
    }

    // Race: annen request vant. Rydd eget rom og join vinneren.
    log.warn(
      {
        scheduledGameId: row.id,
        ourCode: created.roomCode,
        winnerCode: actualRoomCode,
      },
      "assignRoomCode-race: annen request vant, joinRoom inn i vinneren"
    );
    try {
      engine.destroyRoom?.(created.roomCode);
    } catch (err) {
      log.warn(
        { err, roomCode: created.roomCode },
        "destroyRoom feilet etter race — room kan bli liggende orphan"
      );
    }
    const joined = await engine.joinRoom({
      roomCode: actualRoomCode,
      hallId,
      playerName,
      walletId: user.walletId,
      socketId,
    });
    // CRIT-4: vinner-rommet kan også være "fresh" (annen race-vinner
    // markerte det allerede), men markeringen er idempotent.
    try {
      engine.markRoomAsScheduled(actualRoomCode, row.id);
    } catch (err) {
      log.warn(
        { err, roomCode: actualRoomCode, scheduledGameId: row.id },
        "markRoomAsScheduled på winner-rom feilet — scheduled-engine er autoritativ"
      );
    }
    const snapshot = engine.getRoomSnapshot(actualRoomCode);
    return {
      roomCode: actualRoomCode,
      playerId: joined.playerId,
      snapshot,
    };
  }

  return function registerHandlers(socket: Socket): void {
    socket.on(
      "game1:join-scheduled",
      async (
        raw: unknown,
        callback: (response: AckResponse<JoinScheduledAckData>) => void
      ) => {
        try {
          if (!socketRateLimiter.check(socket.id, "game1:join-scheduled")) {
            ackFailure(
              callback,
              new DomainError(
                "RATE_LIMITED",
                "For mange foresporsler. Vent litt."
              ),
              "game1:join-scheduled"
            );
            return;
          }

          const parsed = Game1JoinScheduledPayloadSchema.safeParse(raw);
          if (!parsed.success) {
            throw new DomainError(
              "INVALID_INPUT",
              "Ugyldig payload for game1:join-scheduled."
            );
          }
          const payload = parsed.data;
          const user = await getAuthenticatedUser(payload);
          // BIN-720 follow-up: assertUserEligibleForGameplay is now async
          // (gates on blocked_until via ProfileSettingsService).
          await platformService.assertUserEligibleForGameplay(user);
          engine.assertWalletAllowedForGameplay(user.walletId);

          const row = await loadScheduledGameForJoin(payload.scheduledGameId);
          assertGameJoinable(row.status);
          assertHallAllowedForGame(payload.hallId, row);

          const result = await joinScheduledGame(
            row,
            user,
            payload.hallId,
            payload.playerName,
            socket.id
          );

          socket.join(result.roomCode);
          await emitRoomUpdate(result.roomCode);
          ackSuccess(callback, result);
        } catch (error) {
          log.warn(
            { err: error, event: "game1:join-scheduled" },
            "join-scheduled failed"
          );
          ackFailure(callback, error, "game1:join-scheduled");
        }
      }
    );
  };
}
