/**
 * Tobias 2026-04-27 (pilot-test feedback): pre-flight validator for
 * `POST /api/admin/rooms/:roomCode/start`.
 *
 * **Bakgrunn:** under pilot-test 2026-04-27 oppdaget Tobias at admin/agent
 * kunne starte trekning på et rom selv om hallen ikke var del av en
 * hall-gruppe (link), eller når gruppen ikke hadde en aktiv spilleplan.
 * Dette ga en tomtrekning uten regulatorisk binding — ingen schedule å
 * koble omsetning til, ingen group-of-halls til co-host, ingen spillere
 * forventet å bli innlogget. Det krasjet ikke, men ga "Uventet feil"-
 * tilstand resten av dagen.
 *
 * **Kontrakt:** valider at:
 *   1. Hallen er medlem av minst én aktiv hall-gruppe
 *      (`app_hall_groups` via `app_hall_group_members`).
 *   2. Minst én aktiv `app_daily_schedules`-rad eksisterer der hallen er
 *      target — enten direkte via `hall_id`, indirekte via
 *      `hall_ids_json.hallIds[]`, eller via gruppen i
 *      `hall_ids_json.groupHallIds[]`.
 *
 * Kaster:
 *   - `DomainError("HALL_NOT_IN_GROUP")` hvis (1) feiler
 *   - `DomainError("NO_SCHEDULE_FOR_HALL_GROUP")` hvis (2) feiler
 *
 * Begge feilkoder propagerer via `apiFailure(res, err)` så frontend kan
 * mappe til i18n-melding.
 */

import { Pool } from "pg";
import { DomainError } from "./BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "room-start-pre-flight-validator" });

export interface RoomStartPreFlightValidatorOptions {
  pool: Pool;
  schema?: string;
}

export interface PreFlightValidator {
  /**
   * Throws `DomainError("HALL_NOT_IN_GROUP")` or
   * `DomainError("NO_SCHEDULE_FOR_HALL_GROUP")` if the hall fails the
   * pre-flight checks. Returns silently on success.
   */
  validate(hallId: string): Promise<void>;
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

export class RoomStartPreFlightValidator implements PreFlightValidator {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(options: RoomStartPreFlightValidatorOptions) {
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
  }

  /** @internal — test-hook so tests can pass pre-built mock pool. */
  static forTesting(pool: Pool, schema = "public"): RoomStartPreFlightValidator {
    return new RoomStartPreFlightValidator({ pool, schema });
  }

  async validate(hallId: string): Promise<void> {
    const trimmed = hallId?.trim();
    if (!trimmed) {
      throw new DomainError("INVALID_INPUT", "hallId er påkrevd.");
    }

    // ── Step 1: hallen må være i minst én aktiv hall-gruppe ────────────
    const groupIds = await this.findActiveGroupsForHall(trimmed);
    if (groupIds.length === 0) {
      throw new DomainError(
        "HALL_NOT_IN_GROUP",
        "Hallen tilhører ikke en link/group-of-halls. Tilordne hallen til en gruppe i admin før du starter trekning.",
      );
    }

    // ── Step 2: minst én aktiv daily-schedule må målrette hallen eller
    //           én av gruppene den er medlem av. ────────────────────────
    const hasSchedule = await this.hasActiveScheduleForHall(trimmed, groupIds);
    if (!hasSchedule) {
      throw new DomainError(
        "NO_SCHEDULE_FOR_HALL_GROUP",
        "Hallens link har ingen aktiv spilleplan. Sett opp spilleplan i admin før du starter trekning.",
      );
    }
  }

  private async findActiveGroupsForHall(hallId: string): Promise<string[]> {
    const groupsTable = `"${this.schema}"."app_hall_groups"`;
    const membersTable = `"${this.schema}"."app_hall_group_members"`;
    try {
      const { rows } = await this.pool.query<{ id: string }>(
        `SELECT g.id
         FROM ${groupsTable} g
         INNER JOIN ${membersTable} m ON m.group_id = g.id
         WHERE m.hall_id = $1
           AND g.deleted_at IS NULL
           AND g.status = 'active'`,
        [hallId],
      );
      return rows.map((r) => r.id);
    } catch (err) {
      logger.error(
        { err, hallId },
        "[pre-flight] findActiveGroupsForHall failed — fail-closed",
      );
      throw new DomainError(
        "PRE_FLIGHT_DB_ERROR",
        "Kunne ikke verifisere hall-gruppe-medlemskap. Kontakt systemansvarlig.",
      );
    }
  }

  /**
   * Returnerer `true` hvis det finnes minst én aktiv (status='active' +
   * deleted_at IS NULL) `app_daily_schedules`-rad som målretter hallen,
   * direkte (via `hall_id`, `hall_ids_json.masterHallId`, eller
   * `hall_ids_json.hallIds[]`) eller indirekte via en av `groupIds`
   * (`hall_ids_json.groupHallIds[]`).
   *
   * Trygg matching: bruker JSONB-array-søk istedenfor `LIKE %x%` for å
   * unngå falske treff hvor `hallId` er substring av et annet felt.
   */
  private async hasActiveScheduleForHall(
    hallId: string,
    groupIds: string[],
  ): Promise<boolean> {
    const dsTable = `"${this.schema}"."app_daily_schedules"`;
    try {
      const params: unknown[] = [hallId];
      const orClauses: string[] = [
        `hall_id = $1`,
        `hall_ids_json @> jsonb_build_object('hallIds', jsonb_build_array($1::text))`,
        `(hall_ids_json ->> 'masterHallId') = $1`,
      ];
      for (const gid of groupIds) {
        params.push(gid);
        orClauses.push(
          `hall_ids_json @> jsonb_build_object('groupHallIds', jsonb_build_array($${params.length}::text))`,
        );
      }
      const sql = `
        SELECT 1
        FROM ${dsTable}
        WHERE deleted_at IS NULL
          AND status = 'active'
          AND (${orClauses.join(" OR ")})
        LIMIT 1`;
      const { rows } = await this.pool.query<{ "?column?": number }>(sql, params);
      return rows.length > 0;
    } catch (err) {
      logger.error(
        { err, hallId, groupIds },
        "[pre-flight] hasActiveScheduleForHall failed — fail-closed",
      );
      throw new DomainError(
        "PRE_FLIGHT_DB_ERROR",
        "Kunne ikke verifisere spilleplan. Kontakt systemansvarlig.",
      );
    }
  }
}
