/**
 * 2026-05-11 (Tobias-direktiv) — Hall → rom-mapping debug-route.
 *
 * Bakgrunn:
 *   "default hall skal ha sitt eget rom hvor det er trekning hvert 30 sekund.
 *    kan vi lage mer debug kode slik at vi får til det? og er det nå satt opp
 *    sånn at da default får sitt eget rom hvor man da kan ha egne innstillinger
 *    for denne hallen. vi er nødt til å få kontroll på denne funksjonaliteten
 *    da vi vil ha flere haller med sitt eget rom og at man kan switche mellom."
 *
 *   Klienten kan i dag ikke verifisere om en hall er isolert eller deler rom
 *   med andre haller. Konsoll-loggen viser kun roomCode (eks `BINGO_DEMO-
 *   DEFAULT-GOH`) — uten å se medlemslisten av GoH-en er det umulig å vite
 *   om "default" er trygt isolert eller om den deler rom med pilot-haller.
 *
 *   Denne ruten avslører den fulle mapping-en:
 *     hallId → groupId? → canonicalRoomCode → andre haller i samme rom →
 *     draw-interval → nåværende scheduled-game-status.
 *
 * Sikkerhet:
 *   Krever `?token=<RESET_TEST_PLAYERS_TOKEN>`-match (samme konvensjon som
 *   `/api/_dev/game2-state`). Hvis env-varet ikke er satt → 503 (fail-closed),
 *   ingen utilsiktet eksponering.
 *
 * Endepunkt:
 *   - GET /api/_dev/hall-room-info?hallId=<hallId>&token=<token>
 *
 * Eksempel-payload:
 *   {
 *     "ok": true,
 *     "data": {
 *       "hallId": "hall-default",
 *       "hallName": "Default Hall",
 *       "hallIsActive": true,
 *       "groupOfHallsId": "demo-default-goh",
 *       "groupName": "Default Auto-GoH",
 *       "groupMasterHallId": "hall-default",
 *       "canonicalRoomCode": "BINGO_DEMO-DEFAULT-GOH",
 *       "isHallShared": true,
 *       "otherHallsInSameRoom": [],
 *       "drawIntervalSecondsConfigured": 30,
 *       "drawIntervalSource": "demo-auto-master-override",
 *       "currentScheduledGameId": "abc-123-...",
 *       "currentScheduledGameStatus": "running",
 *       "diagnosis": {
 *         "isolated": true,
 *         "reason": "Single-hall GoH (kun denne hallen som medlem)"
 *       }
 *     }
 *   }
 *
 * Isolation-diagnose-logikk:
 *   - `isolated=true` hvis `otherHallsInSameRoom.length === 0`
 *   - Hvis hallen IKKE er i en GoH → roomCode-fallback `BINGO_<HALL>` →
 *     alltid isolated=true.
 *   - Hvis hallen er i GoH med kun seg selv → isolated=true.
 *   - Hvis GoH har 2+ medlemmer → isolated=false, liste viser andre haller.
 */

import express from "express";
import type { Pool } from "pg";
import { getCanonicalRoomCode } from "../util/canonicalRoomCode.js";
import { HallGroupMembershipQuery } from "../platform/HallGroupMembershipQuery.js";
import type { BingoEngine } from "../game/BingoEngine.js";

/**
 * Tobias-direktiv 2026-05-11: hall-default får 30-sek draw-interval via
 * `DemoAutoMasterTickService.applyTimingOverride`. Andre haller styres av
 * sin egen plan-runtime + ticket_config_json.spill1.timing.seconds.
 *
 * Denne konstanten er DUPLISERT fra `DemoAutoMasterTickService.ts:102` for
 * å unngå cyclic import. Hvis denne endres ett sted, må den endres begge.
 */
const DEFAULT_HALL_BALL_INTERVAL_SECONDS = 30;
const DEFAULT_HALL_ID = "hall-default";
const SPILL1_DEFAULT_DRAW_INTERVAL_SECONDS = 5;

export interface DevHallRoomInfoRouterDeps {
  pool: Pool;
  schema?: string;
  engine: BingoEngine;
}

interface HallRow {
  id: string;
  name: string;
  is_active: boolean;
}

interface GroupMembershipRow {
  group_id: string;
  group_name: string;
  master_hall_id: string | null;
}

interface ScheduledGameRow {
  id: string;
  status: string;
  ticket_config_json: unknown;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractToken(req: express.Request): string {
  const queryToken =
    typeof req.query.token === "string" ? req.query.token.trim() : "";
  return queryToken;
}

function checkToken(req: express.Request, res: express.Response): boolean {
  const expected = (process.env["RESET_TEST_PLAYERS_TOKEN"] ?? "").trim();
  if (!expected) {
    res.status(503).json({
      ok: false,
      error: {
        code: "DEV_TOKEN_NOT_CONFIGURED",
        message:
          "RESET_TEST_PLAYERS_TOKEN er ikke satt i env — debug-route disabled.",
      },
    });
    return false;
  }
  const provided = extractToken(req);
  if (!provided) {
    res.status(401).json({
      ok: false,
      error: { code: "TOKEN_REQUIRED", message: "Mangler ?token=…" },
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

/**
 * Sniff draw-interval fra `ticket_config.spill1.timing.seconds` på en aktiv
 * scheduled-game-rad. Returnerer `null` hvis ikke satt eller invalid type.
 */
function extractDrawIntervalSeconds(ticketConfigJson: unknown): number | null {
  if (!isPlainRecord(ticketConfigJson)) return null;
  const spill1 = ticketConfigJson["spill1"];
  if (!isPlainRecord(spill1)) return null;
  const timing = spill1["timing"];
  if (!isPlainRecord(timing)) return null;
  const seconds = timing["seconds"];
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
    return seconds;
  }
  return null;
}

export function createDevHallRoomInfoRouter(
  deps: DevHallRoomInfoRouterDeps,
): express.Router {
  const router = express.Router();
  const schema = deps.schema ?? "public";
  const membershipQuery = new HallGroupMembershipQuery({
    pool: deps.pool,
    schema,
  });

  // Skjema-navn-whitelist (samme regex som HallGroupMembershipQuery bruker).
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) {
    throw new Error(`Invalid schema name: ${schema}`);
  }

  router.get("/api/_dev/hall-room-info", async (req, res) => {
    if (!checkToken(req, res)) return;

    const hallIdRaw = req.query["hallId"];
    if (typeof hallIdRaw !== "string" || hallIdRaw.trim().length === 0) {
      res.status(400).json({
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "Mangler ?hallId=<hallId>",
        },
      });
      return;
    }
    const hallId = hallIdRaw.trim();

    try {
      // 1. Hent hall (eksisterer + er aktiv?).
      const { rows: hallRows } = await deps.pool.query<HallRow>(
        `SELECT id, name, is_active FROM ${schema}.app_halls WHERE id = $1`,
        [hallId],
      );
      const hall = hallRows[0];
      if (!hall) {
        res.status(404).json({
          ok: false,
          error: {
            code: "HALL_NOT_FOUND",
            message: `Hall '${hallId}' finnes ikke i app_halls.`,
          },
        });
        return;
      }

      // 2. Hent GoH-membership for hall (én rad per gruppe hallen er medlem
      //    av). I praksis vil dette være 0 eller 1 (en hall er sjelden i
      //    flere grupper samtidig), men vi støtter listen for korrekthet.
      const { rows: groupRows } = await deps.pool.query<GroupMembershipRow>(
        `SELECT g.id AS group_id, g.name AS group_name, g.master_hall_id
         FROM ${schema}.app_hall_group_members m
         INNER JOIN ${schema}.app_hall_groups g ON g.id = m.group_id
         WHERE m.hall_id = $1
           AND g.deleted_at IS NULL
           AND g.status = 'active'
         ORDER BY g.id ASC`,
        [hallId],
      );

      const primaryGroup = groupRows[0] ?? null;
      const groupOfHallsId = primaryGroup?.group_id ?? null;
      const groupName = primaryGroup?.group_name ?? null;
      const groupMasterHallId = primaryGroup?.master_hall_id ?? null;

      // 3. Beregn canonical roomCode for Spill 1.
      const canonical = getCanonicalRoomCode("bingo", hallId, groupOfHallsId);

      // 4. Hent andre haller i samme GoH (hvis i en gruppe).
      let otherHallsInSameRoom: { hallId: string; hallName: string }[] = [];
      if (groupOfHallsId) {
        try {
          const members = await membershipQuery.getActiveMembers(groupOfHallsId);
          if (members) {
            otherHallsInSameRoom = members
              .filter((m) => m.hallId !== hallId)
              .map((m) => ({ hallId: m.hallId, hallName: m.hallName }));
          }
        } catch (memberErr) {
          // Soft-fail: ikke vi vil ikke at debug-route skal kaste hvis GoH-
          // lookup feiler. Logg via response istedet.
          res.status(500).json({
            ok: false,
            error: {
              code: "MEMBERSHIP_QUERY_FAILED",
              message:
                memberErr instanceof Error
                  ? memberErr.message
                  : String(memberErr),
            },
          });
          return;
        }
      }

      // 5. Hent siste scheduled-game (running eller siste) for å snikke ut
      //    `ticket_config.spill1.timing.seconds`. Sorter på opprettelses-tid
      //    desc og ta toppraden.
      let currentScheduledGameId: string | null = null;
      let currentScheduledGameStatus: string | null = null;
      let drawIntervalFromConfig: number | null = null;
      try {
        const { rows: gameRows } = await deps.pool.query<ScheduledGameRow>(
          `SELECT id, status, ticket_config_json
           FROM ${schema}.app_game1_scheduled_games
           WHERE master_hall_id = $1
           ORDER BY created_at DESC
           LIMIT 1`,
          [hallId],
        );
        const latest = gameRows[0];
        if (latest) {
          currentScheduledGameId = latest.id;
          currentScheduledGameStatus = latest.status;
          drawIntervalFromConfig = extractDrawIntervalSeconds(
            latest.ticket_config_json,
          );
        }
      } catch {
        // Soft-fail — game-lookup er ikke kritisk for debug-info.
      }

      // 6. Diagnose: er denne hallen isolert?
      const isolated = otherHallsInSameRoom.length === 0;
      const isolationReason = (() => {
        if (!groupOfHallsId) {
          return "Hallen er ikke i noen GoH — roomCode er per-hall (alltid isolert).";
        }
        if (isolated) {
          return `Single-hall GoH '${groupName}' (kun '${hallId}' som medlem).`;
        }
        return `GoH '${groupName}' har ${otherHallsInSameRoom.length} andre medlemmer — DELER rom.`;
      })();

      // 7. Sniff faktisk draw-interval:
      //    - For hall-default: DemoAutoMasterTickService overstyr til
      //      DEFAULT_HALL_BALL_INTERVAL_SECONDS (30s).
      //    - For andre haller: bruk ticket_config.spill1.timing.seconds
      //      hvis satt, ellers default 5.
      let drawIntervalSecondsConfigured: number;
      let drawIntervalSource: string;
      if (hallId === DEFAULT_HALL_ID) {
        drawIntervalSecondsConfigured = DEFAULT_HALL_BALL_INTERVAL_SECONDS;
        drawIntervalSource = "demo-auto-master-override";
      } else if (drawIntervalFromConfig !== null) {
        drawIntervalSecondsConfigured = drawIntervalFromConfig;
        drawIntervalSource = "ticket_config.spill1.timing.seconds";
      } else {
        drawIntervalSecondsConfigured = SPILL1_DEFAULT_DRAW_INTERVAL_SECONDS;
        drawIntervalSource = "default (catalog timing ikke satt)";
      }

      // 8. Hent engine room snapshot for å se faktisk runtime-state.
      let engineRoomKnownToEngine = false;
      let engineRoomGameStatus: string | null = null;
      let engineRoomDrawnCount: number | null = null;
      try {
        const snapshot = deps.engine.getRoomSnapshot(canonical.roomCode);
        if (snapshot) {
          engineRoomKnownToEngine = true;
          engineRoomGameStatus = snapshot.currentGame?.status ?? null;
          engineRoomDrawnCount =
            snapshot.currentGame?.drawnNumbers?.length ?? null;
        }
      } catch {
        // Soft-fail.
      }

      res.json({
        ok: true,
        data: {
          hallId,
          hallName: hall.name,
          hallIsActive: hall.is_active,
          groupOfHallsId,
          groupName,
          groupMasterHallId,
          canonicalRoomCode: canonical.roomCode,
          isHallShared: canonical.isHallShared,
          otherHallsInSameRoom,
          drawIntervalSecondsConfigured,
          drawIntervalSource,
          currentScheduledGameId,
          currentScheduledGameStatus,
          engineRoom: {
            knownToEngine: engineRoomKnownToEngine,
            gameStatus: engineRoomGameStatus,
            drawnCount: engineRoomDrawnCount,
          },
          diagnosis: {
            isolated,
            reason: isolationReason,
          },
          checkedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: {
          code: "DEV_HALL_ROOM_INFO_FAILED",
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }
  });

  return router;
}
