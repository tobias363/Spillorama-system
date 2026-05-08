/**
 * Bølge 5 (2026-05-08): Konsolidert GoH-membership-query.
 *
 * Audit-rapport: `docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md`
 * §5 (C5) + §7 Bølge 5.
 *
 * Mål: erstatt tre nær-identiske GoH-membership-queries
 *   - `routes/agentGame1.ts:getCurrentGoHMembersByGroupId` (via HallGroupService)
 *   - `game/GamePlanEngineBridge.ts:resolveParticipatingHallIds` (raw SQL)
 *   - `game/GamePlanEngineBridge.ts:resolveGroupHallId` (raw SQL)
 * med ÉN konsolidert query-helper. Subtle forskjeller i soft-fail-strategi
 * (returner null vs. kast feil vs. returner stale snapshot) flyttes til
 * caller-laget — denne helperen returnerer bare `null` for "fant ikke"
 * og kaster `DomainError` for ekte DB-feil.
 *
 * Backwards-compat: gamle eksporter beholdes som thin wrappers (i
 * kall-sites). Public signatur-shape er bevart slik at Bølge 3 (UI-bytte)
 * ikke får konflikt.
 *
 * Robusthet (LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08):
 *   - SQL-skjema-navnet valideres mot whitelist før innsetting i SQL —
 *     samme regex som de eksisterende kall-sitene bruker
 *     (`^[a-z_][a-z0-9_]*$`).
 *   - DB-feil propageres som `DomainError` (ikke svelget) — caller
 *     velger soft-fail-strategi.
 *   - Returnerer null kun for "ikke funnet"-tilfeller (gruppe finnes
 *     ikke, hall er ikke medlem, master ikke satt). Caller skiller mellom
 *     "fant ikke" og "DB feilet" via try/catch.
 *
 * Eksempel — soft-fail i caller-laget:
 * ```ts
 * try {
 *   const members = await query.getActiveMembers(groupId);
 *   if (members === null) {
 *     // Gruppen finnes ikke — fall tilbake til legacy-oppførsel.
 *     return legacyHalls;
 *   }
 *   return members;
 * } catch (err) {
 *   logger.warn({ err, groupId }, "GoH-lookup failed; using snapshot");
 *   return staleSnapshot;
 * }
 * ```
 */

import type { Pool } from "pg";
import { DomainError } from "../errors/DomainError.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "hall-group-membership-query" });

/**
 * Ett medlem av en hall-gruppe (GoH). Returnert av `getActiveMembers`.
 *
 * - `isActive`: speiler `app_halls.is_active`. `getActiveMembers`
 *   filtrerer kun på aktive haller, så feltet er alltid `true` i
 *   responsen — det er kun beholdt slik at UI/audit kan rendre det
 *   konsekvent.
 * - `isMaster`: true hvis `hallId === group.master_hall_id` (pinned
 *   master-hall fra `app_hall_groups.master_hall_id`).
 */
export interface HallGroupMembershipMember {
  hallId: string;
  hallName: string;
  isActive: boolean;
  isMaster: boolean;
}

export interface HallGroupMembershipQueryOptions {
  pool: Pool;
  /**
   * Postgres-skjema. Default `public`. Validert mot whitelist-regex
   * (`^[a-z_][a-z0-9_]*$`) før innsetting i SQL — beskytter mot SQL-
   * injection via env-konfig.
   */
  schema?: string;
}

/**
 * Konsolidert query-helper for `app_hall_groups` + `app_hall_group_members`.
 * Brukes av agent-konsoll, master-konsoll, og engine-bridge for å:
 *   - filtrere bort haller som er fjernet fra GoH-en etter spawn
 *     (stale `participating_halls_json`)
 *   - resolve hvilken GoH en hall tilhører
 *   - sjekke om en hall er aktiv medlem av en gitt GoH
 *   - hente pinned master-hall-id for en GoH
 */
export class HallGroupMembershipQuery {
  private readonly pool: Pool;
  private readonly groupsTable: string;
  private readonly membersTable: string;
  private readonly hallsTable: string;

  constructor(opts: HallGroupMembershipQueryOptions) {
    const schema = (opts.schema ?? "public").trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
      throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
    }
    this.pool = opts.pool;
    this.groupsTable = `"${schema}"."app_hall_groups"`;
    this.membersTable = `"${schema}"."app_hall_group_members"`;
    this.hallsTable = `"${schema}"."app_halls"`;
  }

  /**
   * Henter aktive medlemmer av en GoH (Group of Halls). Filterer bort
   * deaktiverte haller (`app_halls.is_active = false`) og soft-deletede
   * eller inaktive grupper (`app_hall_groups.deleted_at IS NOT NULL` /
   * `status != 'active'`).
   *
   * Sortering: master-hall først (hvis pinned), deretter alfabetisk
   * på hall-navn — matcher master-konsollets visnings-rekkefølge.
   *
   * @returns Array av medlemmer (kan være tom hvis gruppen ikke har
   *   noen aktive medlemmer), eller `null` hvis gruppen ikke finnes /
   *   er soft-deletet / inaktiv.
   * @throws DomainError ved DB-feil (caller velger soft-fail-strategi).
   */
  async getActiveMembers(
    groupId: string,
  ): Promise<HallGroupMembershipMember[] | null> {
    if (typeof groupId !== "string" || groupId.trim().length === 0) {
      throw new DomainError(
        "INVALID_INPUT",
        "getActiveMembers: groupId må være ikke-tom string.",
      );
    }

    // Først: verifiser at gruppen finnes og er aktiv. Vi må også hente
    // `master_hall_id` for å markere `isMaster`-flagg på riktig medlem.
    let masterHallId: string | null = null;
    try {
      const { rows: groupRows } = await this.pool.query<{
        master_hall_id: string | null;
      }>(
        `SELECT master_hall_id
         FROM ${this.groupsTable}
         WHERE id = $1
           AND deleted_at IS NULL
           AND status = 'active'`,
        [groupId],
      );
      const groupRow = groupRows[0];
      if (!groupRow) {
        // Gruppen finnes ikke / er soft-deletet / inaktiv.
        return null;
      }
      masterHallId = groupRow.master_hall_id;
    } catch (err) {
      logger.warn(
        { groupId, err },
        "getActiveMembers: group-lookup feilet",
      );
      throw new DomainError(
        "DB_ERROR",
        "Kunne ikke verifisere hall-gruppe — DB-feil.",
      );
    }

    // Hent medlemmer. INNER JOIN mot `app_halls` filtrerer bort
    // deaktiverte haller. Sortering: pinned master-hall først,
    // deretter alfabetisk på hall-navn.
    try {
      const { rows } = await this.pool.query<{
        hall_id: string;
        hall_name: string;
        is_active: boolean;
      }>(
        `SELECT m.hall_id, h.name AS hall_name, h.is_active
         FROM ${this.membersTable} m
         INNER JOIN ${this.hallsTable} h ON h.id = m.hall_id
         WHERE m.group_id = $1
           AND h.is_active = true
         ORDER BY (CASE WHEN m.hall_id = $2 THEN 0 ELSE 1 END),
                  h.name ASC,
                  m.added_at ASC`,
        [groupId, masterHallId ?? ""],
      );
      return rows.map((row) => ({
        hallId: row.hall_id,
        hallName: row.hall_name,
        isActive: row.is_active,
        isMaster: masterHallId !== null && row.hall_id === masterHallId,
      }));
    } catch (err) {
      logger.warn(
        { groupId, err },
        "getActiveMembers: members-query feilet",
      );
      throw new DomainError(
        "DB_ERROR",
        "Kunne ikke hente hall-gruppe-medlemmer — DB-feil.",
      );
    }
  }

  /**
   * Henter pinned master-hall-id for en GoH. Returnerer `null` hvis:
   *   - Gruppen ikke finnes / er soft-deletet / inaktiv
   *   - `master_hall_id` er NULL (ikke pinned)
   *   - Master-hallen er deaktivert (`app_halls.is_active = false`) —
   *     defensivt så bridgen kan falle tilbake til run.hall_id.
   *
   * @throws DomainError ved DB-feil.
   */
  async getMasterHallId(groupId: string): Promise<string | null> {
    if (typeof groupId !== "string" || groupId.trim().length === 0) {
      throw new DomainError(
        "INVALID_INPUT",
        "getMasterHallId: groupId må være ikke-tom string.",
      );
    }
    try {
      const { rows } = await this.pool.query<{
        master_hall_id: string | null;
      }>(
        `SELECT g.master_hall_id
         FROM ${this.groupsTable} g
         LEFT JOIN ${this.hallsTable} h ON h.id = g.master_hall_id
         WHERE g.id = $1
           AND g.deleted_at IS NULL
           AND g.status = 'active'
           AND (g.master_hall_id IS NULL OR h.is_active = true)`,
        [groupId],
      );
      const row = rows[0];
      if (!row) return null;
      return row.master_hall_id;
    } catch (err) {
      logger.warn({ groupId, err }, "getMasterHallId failed");
      throw new DomainError(
        "DB_ERROR",
        "Kunne ikke hente master-hall — DB-feil.",
      );
    }
  }

  /**
   * Sjekker om en hall er aktivt medlem av en GoH. Krever:
   *   - Gruppen er aktiv (status='active' + ikke soft-deletet)
   *   - Hallen er med i gruppens medlemskap
   *   - Hallen er aktiv (`app_halls.is_active = true`)
   *
   * Returnerer `false` hvis noen av punktene over ikke holder.
   *
   * @throws DomainError ved DB-feil.
   */
  async isMember(groupId: string, hallId: string): Promise<boolean> {
    if (typeof groupId !== "string" || groupId.trim().length === 0) {
      throw new DomainError(
        "INVALID_INPUT",
        "isMember: groupId må være ikke-tom string.",
      );
    }
    if (typeof hallId !== "string" || hallId.trim().length === 0) {
      throw new DomainError(
        "INVALID_INPUT",
        "isMember: hallId må være ikke-tom string.",
      );
    }
    try {
      const { rows } = await this.pool.query<{ exists: boolean }>(
        `SELECT EXISTS(
           SELECT 1
             FROM ${this.membersTable} m
             INNER JOIN ${this.groupsTable} g ON g.id = m.group_id
             INNER JOIN ${this.hallsTable} h ON h.id = m.hall_id
            WHERE m.group_id = $1
              AND m.hall_id = $2
              AND g.deleted_at IS NULL
              AND g.status = 'active'
              AND h.is_active = true
         ) AS exists`,
        [groupId, hallId],
      );
      return rows[0]?.exists === true;
    } catch (err) {
      logger.warn({ groupId, hallId, err }, "isMember failed");
      throw new DomainError("DB_ERROR", "Kunne ikke sjekke medlemskap — DB-feil.");
    }
  }

  /**
   * Henter GoH-id for en hall. Brukes av engine-bridge til å resolve
   * hvilken hall-gruppe en hall tilhører når en plan-run skal spawne
   * scheduled-game (engine krever `group_hall_id`).
   *
   * Hvis hallen er medlem av flere aktive grupper, returneres den
   * eldste medlemskapet (`ORDER BY m.added_at ASC LIMIT 1`) — matcher
   * legacy-oppførselen i `GamePlanEngineBridge.resolveGroupHallId`.
   *
   * @returns groupId eller null (hallen er ikke medlem av noen aktiv gruppe).
   * @throws DomainError ved DB-feil.
   */
  async findGroupForHall(hallId: string): Promise<string | null> {
    if (typeof hallId !== "string" || hallId.trim().length === 0) {
      throw new DomainError(
        "INVALID_INPUT",
        "findGroupForHall: hallId må være ikke-tom string.",
      );
    }
    try {
      const { rows } = await this.pool.query<{ group_id: string }>(
        `SELECT m.group_id
         FROM ${this.membersTable} m
         INNER JOIN ${this.groupsTable} g ON g.id = m.group_id
         WHERE m.hall_id = $1
           AND g.deleted_at IS NULL
           AND g.status = 'active'
         ORDER BY m.added_at ASC
         LIMIT 1`,
        [hallId],
      );
      return rows[0]?.group_id ?? null;
    } catch (err) {
      logger.warn({ hallId, err }, "findGroupForHall failed");
      throw new DomainError(
        "DB_ERROR",
        "Kunne ikke finne hall-gruppe for hall — DB-feil.",
      );
    }
  }
}
