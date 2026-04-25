/**
 * GAP #29: pre-join game-view validation.
 *
 * Erstatter legacy `POST /validateGameView` (routes/backend.js:567 +
 * App/Controllers/Auth.js:1579). Player-appen kaller dette ENDPOINTET FØR
 * den åpner socket-rommet, så feilkoder kan rendres som UX uten å rive
 * ned socket-logikken.
 *
 * Endpoint:
 *   POST /api/games/validate-view
 *     Body: { roomCode?: string, hallId: string, gameSlug?: string }
 *     Returnerer (200 OK): { ok: true, data: ValidateGameViewResult }
 *
 * Result-shape:
 *   { ok: true,  hallId, gameSlug, roomCode, gameStatus, balance }
 *   { ok: false, reason: <REASON_CODE>, message }
 *
 * Reason codes:
 *   HALL_BLOCKED          — spilleren er administrativt sperret i hallen
 *   PLAYER_BLOCKED        — time-based block-myself aktiv
 *   ROOM_NOT_FOUND        — roomCode finnes ikke
 *   GAME_NOT_JOINABLE     — rom finnes men er i ENDED-state
 *   HALL_MISMATCH         — angitt hallId matcher ikke rommets hallId
 *   INSUFFICIENT_BALANCE  — info-only, IKKE blokkerende (ok=true men flagg)
 *
 * Read-only — ingen audit-log, ingen mutasjoner. Side-effekter ville gjort
 * dette endepunktet ubrukelig som pre-join-check (en feilet pre-check skal
 * ikke skrive en "join-attempt" til DB).
 *
 * Auth: bearer-token. validateGameView kaster aldri 5xx selv om sjekkene
 * feiler — det vil bare returnere `{ ok: false, reason }` så klienten kan
 * vise riktig feilmelding.
 */

import express from "express";
import type { PlatformService, PublicAppUser } from "../platform/PlatformService.js";
import type { GameStatus, RoomSnapshot } from "@spillorama/shared-types";
import {
  apiSuccess,
  apiFailure,
  getAccessTokenFromRequest,
} from "../util/httpHelpers.js";
import { DomainError } from "../game/BingoEngine.js";

/**
 * Service-grensesnitt mot ProfileSettingsService for blocked-myself-sjekk.
 * Vi tar bare den ene metoden vi trenger så testene slipper å mocke hele
 * ProfileSettingsService-instansen.
 */
export interface ProfileSettingsBlockGate {
  assertUserNotBlocked(userId: string): Promise<void>;
}

/**
 * Bingo-engine-grensesnitt for read-only room-lookup. BingoEngine
 * eksponerer allerede `getRoomSnapshot` som kaster `ROOM_NOT_FOUND`-
 * DomainError når rommet ikke finnes.
 */
export interface RoomSnapshotProvider {
  getRoomSnapshot(roomCode: string): RoomSnapshot;
}

export interface ValidateGameViewRouterDeps {
  platformService: PlatformService;
  profileSettingsService: ProfileSettingsBlockGate | null;
  engine: RoomSnapshotProvider;
  /**
   * Optional: returnerer minimums-pris for et game-slug så vi kan flagge
   * INSUFFICIENT_BALANCE (info-only). Hvis ikke wired, hopper vi over
   * balance-sjekken.
   */
  getMinEntryFeeForGame?: (gameSlug: string) => number | null;
}

export type ValidateGameViewReason =
  | "HALL_BLOCKED"
  | "PLAYER_BLOCKED"
  | "ROOM_NOT_FOUND"
  | "GAME_NOT_JOINABLE"
  | "HALL_MISMATCH";

export interface ValidateGameViewSuccess {
  ok: true;
  hallId: string;
  gameSlug: string | null;
  roomCode: string | null;
  /** "WAITING" | "RUNNING" | "ENDED" | "NONE" — "NONE" betyr ingen aktiv runde. */
  gameStatus: GameStatus | "NONE" | null;
  balance: number;
  /** Info-only flagg — true hvis spillerens balanse er under entry-fee. */
  insufficientBalance: boolean;
}

export interface ValidateGameViewFailure {
  ok: false;
  reason: ValidateGameViewReason;
  message: string;
  /** Diagnostisk kontekst klient kan logge. */
  hallId?: string;
  roomCode?: string;
}

export type ValidateGameViewResult = ValidateGameViewSuccess | ValidateGameViewFailure;

export function createValidateGameViewRouter(
  deps: ValidateGameViewRouterDeps
): express.Router {
  const { platformService, profileSettingsService, engine, getMinEntryFeeForGame } = deps;
  const router = express.Router();

  async function getAuthenticatedUser(req: express.Request): Promise<PublicAppUser> {
    const accessToken = getAccessTokenFromRequest(req);
    return platformService.getUserFromAccessToken(accessToken);
  }

  router.post("/api/games/validate-view", async (req, res) => {
    try {
      const user = await getAuthenticatedUser(req);
      const body = (req.body ?? {}) as Record<string, unknown>;

      const hallIdRaw = typeof body.hallId === "string" ? body.hallId.trim() : "";
      if (!hallIdRaw) {
        throw new DomainError("INVALID_INPUT", "hallId mangler.");
      }

      const roomCodeRaw =
        typeof body.roomCode === "string" && body.roomCode.trim().length > 0
          ? body.roomCode.trim().toUpperCase()
          : null;
      const gameSlugRaw =
        typeof body.gameSlug === "string" && body.gameSlug.trim().length > 0
          ? body.gameSlug.trim().toLowerCase()
          : null;

      // 1) Hall-status: spilleren skal ikke være sperret i hallen.
      const hallStatuses = await platformService.listPlayerHallStatus(user.id);
      const blockedHall = hallStatuses.find(
        (s) => s.hallId === hallIdRaw && s.isActive === false
      );
      if (blockedHall) {
        const failure: ValidateGameViewFailure = {
          ok: false,
          reason: "HALL_BLOCKED",
          message:
            blockedHall.reason ?? "Spilleren er sperret i denne hallen.",
          hallId: hallIdRaw,
          roomCode: roomCodeRaw ?? undefined,
        };
        apiSuccess(res, failure);
        return;
      }

      // 2) Block-myself / self-exclusion. ProfileSettingsService kaster
      //    DomainError("PLAYER_BLOCKED") når aktiv. 1y/permanent håndheves
      //    av ComplianceManager andre steder; her gir vi pre-join-feil.
      if (profileSettingsService) {
        try {
          await profileSettingsService.assertUserNotBlocked(user.id);
        } catch (err) {
          if (err instanceof DomainError && err.code === "PLAYER_BLOCKED") {
            const failure: ValidateGameViewFailure = {
              ok: false,
              reason: "PLAYER_BLOCKED",
              message: err.message,
              hallId: hallIdRaw,
              roomCode: roomCodeRaw ?? undefined,
            };
            apiSuccess(res, failure);
            return;
          }
          throw err;
        }
      }

      // 3) Room-lookup. Bare hvis caller ga roomCode — pre-join-flow
      //    fra player-appen kan kalle med kun hallId for å sjekke "har jeg
      //    tilgang til denne hallen" uten å vite roomCode ennå.
      let resolvedGameStatus: GameStatus | "NONE" | null = null;
      let resolvedGameSlug: string | null = gameSlugRaw;
      if (roomCodeRaw) {
        let snapshot: RoomSnapshot | null = null;
        try {
          snapshot = engine.getRoomSnapshot(roomCodeRaw);
        } catch (err) {
          if (err instanceof DomainError && err.code === "ROOM_NOT_FOUND") {
            const failure: ValidateGameViewFailure = {
              ok: false,
              reason: "ROOM_NOT_FOUND",
              message: "Rommet finnes ikke.",
              hallId: hallIdRaw,
              roomCode: roomCodeRaw,
            };
            apiSuccess(res, failure);
            return;
          }
          throw err;
        }

        if (snapshot.hallId !== hallIdRaw) {
          const failure: ValidateGameViewFailure = {
            ok: false,
            reason: "HALL_MISMATCH",
            message: "Rommet tilhører ikke angitt hall.",
            hallId: hallIdRaw,
            roomCode: roomCodeRaw,
          };
          apiSuccess(res, failure);
          return;
        }

        resolvedGameSlug = snapshot.gameSlug ?? gameSlugRaw;
        const gameStatus: GameStatus | "NONE" = snapshot.currentGame
          ? snapshot.currentGame.status
          : "NONE";
        if (gameStatus === "ENDED") {
          const failure: ValidateGameViewFailure = {
            ok: false,
            reason: "GAME_NOT_JOINABLE",
            message: "Spillet i rommet er avsluttet.",
            hallId: hallIdRaw,
            roomCode: roomCodeRaw,
          };
          apiSuccess(res, failure);
          return;
        }
        resolvedGameStatus = gameStatus;
      }

      // 4) Wallet-info-only-sjekk.
      const minEntryFee =
        resolvedGameSlug && getMinEntryFeeForGame
          ? getMinEntryFeeForGame(resolvedGameSlug) ?? 0
          : 0;
      const insufficientBalance = minEntryFee > 0 && user.balance < minEntryFee;

      const success: ValidateGameViewSuccess = {
        ok: true,
        hallId: hallIdRaw,
        gameSlug: resolvedGameSlug,
        roomCode: roomCodeRaw,
        gameStatus: resolvedGameStatus,
        balance: user.balance,
        insufficientBalance,
      };
      apiSuccess(res, success);
    } catch (error) {
      apiFailure(res, error);
    }
  });

  return router;
}
