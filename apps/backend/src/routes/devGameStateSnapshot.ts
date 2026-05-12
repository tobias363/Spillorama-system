/**
 * 2026-05-12 (Tobias-direktiv) — Spill 1 live-state-snapshot diagnose-route.
 *
 * Bakgrunn:
 *   "vi må ha data, ikke gjette". Forrige sesjon (2026-05-11) brukte 2 dager
 *   på å finne en race-condition (sync destroyRoom vs async emitRoomUpdate)
 *   via klient-dump + backend-log-korrelering. Denne ruten lar PM-AI og
 *   Tobias se EKSAKT hva som skjer i backend mens en Spill 1-runde kjører —
 *   uten å gjette på state fra klient-side.
 *
 *   Returnerer:
 *     - In-memory engine room state (currentGame.status, drawnCount,
 *       playerCount, lastDrawAtMs, endedReason).
 *     - DB `app_game1_scheduled_games`-rad (status, paused-flag,
 *       actual_start/end_time, pause_reason).
 *     - DB `app_game1_game_state`-rad (current_phase, draws_completed,
 *       last_drawn_at, paused-flag, engine_ended_at).
 *     - Socket.IO room-size (io.sockets.adapter.rooms.get(roomCode)?.size).
 *     - Siste emitted stateVersion (roomStateVersionStore.current(code)).
 *
 *   Alt blir hentet i parallell og fail-soft — hvis én av kildene kaster,
 *   blir feilen embedded i payloaden i stedet for å felle hele requesten.
 *
 * Sikkerhet:
 *   Token-gated via `RESET_TEST_PLAYERS_TOKEN`-env-var. Hvis env-varet ikke
 *   er satt → 503 (fail-closed). Samme token-konvensjon som
 *   `/api/_dev/game2-state` og `/api/_dev/hall-room-info`.
 *
 * Endepunkt:
 *   - GET /api/_dev/game-state-snapshot?roomCode=<code>&token=<token>
 *
 * Performance:
 *   To DB-queries (scheduled_games + game_state) + én engine-call + én
 *   socket.adapter-lookup + én Redis-roundtrip (stateVersion). I praksis
 *   <30ms ende-til-ende mot lokal Postgres + Redis. Ikke ment for
 *   high-frequency polling — PM-AI poll-er på sekund-skala maks.
 */

import express from "express";
import type { Pool } from "pg";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { RoomStateVersionStore } from "../util/RoomStateVersionStore.js";
import type { Server as SocketIOServer } from "socket.io";

export interface DevGameStateSnapshotRouterDeps {
  pool: Pool;
  schema?: string;
  engine: BingoEngine;
  io: SocketIOServer;
  roomStateVersionStore: RoomStateVersionStore;
}

interface ScheduledGameRow {
  id: string;
  status: string;
  scheduled_start_time: Date | string | null;
  scheduled_end_time: Date | string | null;
  actual_start_time: Date | string | null;
  actual_end_time: Date | string | null;
  master_hall_id: string;
  group_hall_id: string;
  participating_halls_json: unknown;
  pause_reason: string | null;
  room_code: string | null;
}

interface GameStateRow {
  scheduled_game_id: string;
  draws_completed: number;
  current_phase: number;
  last_drawn_ball: number | null;
  last_drawn_at: Date | string | null;
  paused: boolean;
  next_auto_draw_at: Date | string | null;
  engine_started_at: Date | string | null;
  engine_ended_at: Date | string | null;
}

function extractToken(req: express.Request): string {
  const queryToken =
    typeof req.query.token === "string" ? req.query.token.trim() : "";
  if (queryToken) return queryToken;
  return "";
}

function checkToken(req: express.Request, res: express.Response): boolean {
  const expected = (process.env["RESET_TEST_PLAYERS_TOKEN"] ?? "").trim();
  if (!expected) {
    res.status(503).json({
      ok: false,
      error: {
        code: "DEV_TOKEN_NOT_CONFIGURED",
        message:
          "RESET_TEST_PLAYERS_TOKEN er ikke satt i env — diagnose-route disabled.",
      },
    });
    return false;
  }
  const provided = extractToken(req);
  if (!provided) {
    res.status(401).json({
      ok: false,
      error: { code: "TOKEN_REQUIRED", message: "Mangler ?token-query." },
    });
    return false;
  }
  if (provided !== expected) {
    res.status(403).json({
      ok: false,
      error: { code: "FORBIDDEN", message: "Invalid token" },
    });
    return false;
  }
  return true;
}

function errorToPayload(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      code: (err as Error & { code?: string }).code,
    };
  }
  return { value: String(err) };
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  // Postgres `timestamptz` returneres som Date av node-pg, men hvis raw
  // string brukes (eks. fra cache) støtter vi det også.
  return String(value);
}

export function createDevGameStateSnapshotRouter(
  deps: DevGameStateSnapshotRouterDeps,
): express.Router {
  const router = express.Router();
  const schema = deps.schema ?? "public";

  // Skjema-navn-whitelist (samme regex som andre _dev-routes bruker).
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error(`Invalid schema name: ${schema}`);
  }

  router.get("/api/_dev/game-state-snapshot", async (req, res) => {
    if (!checkToken(req, res)) return;

    const roomCodeRaw = req.query["roomCode"];
    if (typeof roomCodeRaw !== "string" || roomCodeRaw.trim().length === 0) {
      res.status(400).json({
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "Mangler ?roomCode=<code>",
        },
      });
      return;
    }
    const roomCode = roomCodeRaw.trim().toUpperCase();

    const checkedAtMs = Date.now();
    const checkedAtIso = new Date(checkedAtMs).toISOString();
    const out: Record<string, unknown> = {
      checkedAt: checkedAtIso,
      checkedAtMs,
      roomCode,
    };

    // ── 1. Engine in-memory snapshot ─────────────────────────────────────
    try {
      // listRoomSummaries gir oss en lett rad uten å bygge full snapshot;
      // brukes som "exists?"-sjekk og for å hente gameStatus/playerCount
      // selv hvis getRoomSnapshot kaster.
      const summaries = deps.engine.listRoomSummaries();
      const summary = summaries.find((s) => s.code === roomCode);
      if (!summary) {
        out.engineRoom = { exists: false };
      } else {
        // Full snapshot for currentGame.status + drawnNumbers.length +
        // endedReason. fail-soft hvis snapshot kaster.
        try {
          const snapshot = deps.engine.getRoomSnapshot(roomCode);
          const game = snapshot.currentGame;
          out.engineRoom = {
            exists: true,
            hostPlayerId: snapshot.hostPlayerId,
            hallId: snapshot.hallId,
            gameSlug: snapshot.gameSlug,
            createdAt: snapshot.createdAt,
            playerCount: snapshot.players.length,
            currentGame: game
              ? {
                  id: game.id,
                  status: game.status,
                  drawnCount: game.drawnNumbers.length,
                  drawnNumbers: game.drawnNumbers,
                  drawBagRemaining: game.drawBag.length,
                  startedAt: game.startedAt,
                  endedAt: game.endedAt,
                  endedReason: game.endedReason,
                  isPaused: !!game.isPaused,
                  pauseReason: game.pauseReason,
                  pauseUntil: game.pauseUntil,
                  participatingPlayerIds: game.participatingPlayerIds,
                  claimsCount: game.claims.length,
                }
              : null,
            playerSummary: snapshot.players.map((p) => ({
              id: p.id,
              walletId: p.walletId,
              hallId: p.hallId,
              hasSocket: !!p.socketId,
            })),
          };
        } catch (err) {
          out.engineRoom = {
            exists: true,
            gameStatus: summary.gameStatus,
            playerCount: summary.playerCount,
            snapshotError: errorToPayload(err),
          };
        }
      }
    } catch (err) {
      out.engineRoomError = errorToPayload(err);
    }

    // ── 2. DB app_game1_scheduled_games-rad ───────────────────────────────
    //
    // For Spill 1 lever roomCode på en aktiv scheduled-game-rad. Vi tar
    // den nyeste (DESC actual_start_time hvis satt, ellers scheduled_start_time)
    // for å håndtere edge-cases der en gammel rad henger med samme
    // roomCode etter cancel. Forventes maks én aktiv rad pga partial unique
    // index (migration 20261221000000).
    try {
      const { rows } = await deps.pool.query<ScheduledGameRow>(
        `SELECT id, status, scheduled_start_time, scheduled_end_time,
                actual_start_time, actual_end_time, master_hall_id,
                group_hall_id, participating_halls_json, pause_reason,
                room_code
           FROM ${schema}.app_game1_scheduled_games
          WHERE room_code = $1
          ORDER BY COALESCE(actual_start_time, scheduled_start_time) DESC
          LIMIT 1`,
        [roomCode],
      );
      const row = rows[0];
      if (!row) {
        out.scheduledGame = null;
      } else {
        out.scheduledGame = {
          id: row.id,
          status: row.status,
          scheduledStartTime: toIsoOrNull(row.scheduled_start_time),
          scheduledEndTime: toIsoOrNull(row.scheduled_end_time),
          actualStartTime: toIsoOrNull(row.actual_start_time),
          actualEndTime: toIsoOrNull(row.actual_end_time),
          masterHallId: row.master_hall_id,
          groupHallId: row.group_hall_id,
          participatingHalls: row.participating_halls_json,
          pauseReason: row.pause_reason,
          roomCode: row.room_code,
        };
      }
    } catch (err) {
      out.scheduledGameError = errorToPayload(err);
    }

    // ── 3. DB app_game1_game_state-rad ────────────────────────────────────
    //
    // Joins mot scheduled_games via room_code for å hente engine-state
    // (draws_completed, current_phase, paused, etc) uten å kreve at
    // caller kjenner scheduled_game_id.
    try {
      const { rows } = await deps.pool.query<GameStateRow>(
        `SELECT gs.scheduled_game_id, gs.draws_completed, gs.current_phase,
                gs.last_drawn_ball, gs.last_drawn_at, gs.paused,
                gs.next_auto_draw_at, gs.engine_started_at, gs.engine_ended_at
           FROM ${schema}.app_game1_game_state gs
           JOIN ${schema}.app_game1_scheduled_games sg
             ON gs.scheduled_game_id = sg.id
          WHERE sg.room_code = $1
          ORDER BY COALESCE(sg.actual_start_time, sg.scheduled_start_time) DESC
          LIMIT 1`,
        [roomCode],
      );
      const row = rows[0];
      if (!row) {
        out.gameState = null;
      } else {
        out.gameState = {
          scheduledGameId: row.scheduled_game_id,
          drawsCompleted: row.draws_completed,
          currentPhase: row.current_phase,
          lastDrawnBall: row.last_drawn_ball,
          lastDrawnAt: toIsoOrNull(row.last_drawn_at),
          paused: row.paused,
          nextAutoDrawAt: toIsoOrNull(row.next_auto_draw_at),
          engineStartedAt: toIsoOrNull(row.engine_started_at),
          engineEndedAt: toIsoOrNull(row.engine_ended_at),
        };
      }
    } catch (err) {
      out.gameStateError = errorToPayload(err);
    }

    // ── 4. Socket.IO room-size ────────────────────────────────────────────
    //
    // `io.sockets.adapter.rooms.get(code)?.size` returnerer antall sockets
    // som har joinet `code`-rommet. For perpetual rom (Spill 2/3) er dette
    // alle spillere globalt; for Spill 1 er det per-hall lobby-rom.
    try {
      const roomSet = deps.io.sockets.adapter.rooms.get(roomCode);
      out.socketRoomSize = roomSet?.size ?? 0;
    } catch (err) {
      out.socketRoomSizeError = errorToPayload(err);
    }

    // ── 5. Siste emitted stateVersion ─────────────────────────────────────
    //
    // `current()` returnerer 0 hvis ingen emit har skjedd enda. Brukes av
    // klienten via `room:state` resync-ack for å fastsette baseline.
    try {
      out.stateVersion = await deps.roomStateVersionStore.current(roomCode);
    } catch (err) {
      out.stateVersionError = errorToPayload(err);
    }

    // ── 6. Diagnose-hint ──────────────────────────────────────────────────
    //
    // Krysscheck engine-state vs DB-state for å flagge åpenbare avvik:
    //   - Engine sier RUNNING men DB scheduled_game.status = completed/cancelled.
    //   - Engine sier ENDED men socket-rommet har sockets fortsatt
    //     (klient ikke notifiserert).
    //   - DB draws_completed != engine drawnCount (state-divergens).
    try {
      const engineRoom = out.engineRoom as Record<string, unknown> | undefined;
      const engineGame = engineRoom?.currentGame as
        | Record<string, unknown>
        | null
        | undefined;
      const scheduledGame = out.scheduledGame as
        | Record<string, unknown>
        | null
        | undefined;
      const gameState = out.gameState as
        | Record<string, unknown>
        | null
        | undefined;
      const socketRoomSize =
        typeof out.socketRoomSize === "number" ? out.socketRoomSize : null;

      const inconsistencies: string[] = [];

      if (engineGame && scheduledGame) {
        const engineStatus = String(engineGame.status ?? "");
        const dbStatus = String(scheduledGame.status ?? "");
        if (
          engineStatus === "RUNNING" &&
          (dbStatus === "completed" || dbStatus === "cancelled")
        ) {
          inconsistencies.push(
            `ENGINE_DB_STATUS_MISMATCH: engine=RUNNING but db=${dbStatus}`,
          );
        }
      }

      if (engineGame && gameState) {
        const engineDrawn =
          typeof engineGame.drawnCount === "number" ? engineGame.drawnCount : null;
        const dbDrawn =
          typeof gameState.drawsCompleted === "number"
            ? gameState.drawsCompleted
            : null;
        if (
          engineDrawn !== null &&
          dbDrawn !== null &&
          Math.abs(engineDrawn - dbDrawn) > 1
        ) {
          inconsistencies.push(
            `DRAW_COUNT_DIVERGENCE: engine=${engineDrawn} db=${dbDrawn}`,
          );
        }
      }

      if (
        engineGame &&
        String(engineGame.status ?? "") !== "RUNNING" &&
        socketRoomSize !== null &&
        socketRoomSize > 0
      ) {
        inconsistencies.push(
          `STALE_SOCKETS: engine status=${engineGame.status} but ${socketRoomSize} sockets still in room`,
        );
      }

      out.diagnosis = {
        inconsistencies,
        hasInconsistencies: inconsistencies.length > 0,
      };
    } catch (err) {
      out.diagnosisError = errorToPayload(err);
    }

    res.json({ ok: true, data: out });
  });

  return router;
}
