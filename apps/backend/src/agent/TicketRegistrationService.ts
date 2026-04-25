/**
 * BIN-GAP#4 (wireframe 17.15 / 15.2) — Register Sold Tickets scanner med
 * carry-forward.
 *
 * Spec: docs/architecture/WIREFRAME_CATALOG.md § "15.2 Register Sold Tickets"
 *       docs/architecture/WIREFRAME_CATALOG.md § "15.10 Register More Tickets Modal"
 *       docs/wireframes/WF_B_Spillorama_Agent_V1.0_14-10-2024.pdf skjerm 17.15
 *
 * Modell:
 *   Per pågående Spill 1-instans registrerer agenten per ticket-type:
 *     - initial_id (auto-forhåndsfylt via carry-forward eller hall-start)
 *     - final_id (scannet EFTER salg av agenten)
 *     - sold_count = final_id - initial_id + 1
 *
 *   Tabellen `app_ticket_ranges_per_game` (migrasjon 20260726000000) holder én
 *   rad per (game, hall, ticket_type). UNIQUE constraint på (game, hall, type)
 *   sikrer at registreringen er idempotent — samme agent kan åpne modalen
 *   flere ganger og oppdatere final_id inntil spillet starter.
 *
 * Integrasjon:
 *   - Carry-forward: `getInitialIds({gameId, hallId})` finner siste rad per
 *     ticket_type i samme hall og returnerer forrige rundes `final_id + 1`
 *     som nye rundens initial_id. Hvis ingen tidligere runde: initial_id = 1.
 *   - Hall-status-flyt: `recordFinalIds` integrerer med
 *     `Game1HallReadyService.markReady` via en hook (service tar en callback
 *     for å unngå hard kobling). Route-laget kaller markReady etter
 *     recordFinalIds-suksess.
 *   - Validering: final_id >= initial_id, sjekker ikke-overlapp med andre
 *     spills ranges for samme (hall, type).
 *
 * Fail-closed: enhver feil kaster DomainError, ingen partial writes.
 */

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "ticket-registration-service" });

/**
 * De 6 ticket-typene fra wireframe 15.2/15.10. Rekkefølgen matcher den
 * visuelle kolonne-rekkefølgen i UI (Small Yellow først, Large Purple sist).
 */
export const TICKET_TYPES = [
  "small_yellow",
  "small_white",
  "large_yellow",
  "large_white",
  "small_purple",
  "large_purple",
] as const;

export type TicketType = (typeof TICKET_TYPES)[number];

export function isTicketType(value: unknown): value is TicketType {
  return typeof value === "string" && (TICKET_TYPES as readonly string[]).includes(value);
}

/** Human-readable labels for TicketType. UI genererer selv via i18n, men
 * backend bruker disse i logger/audit-trail for lesbarhet. */
export const TICKET_TYPE_LABELS: Record<TicketType, string> = {
  small_yellow: "Small Yellow",
  small_white: "Small White",
  large_yellow: "Large Yellow",
  large_white: "Large White",
  small_purple: "Small Purple",
  large_purple: "Large Purple",
};

export interface TicketRange {
  id: string;
  gameId: string;
  hallId: string;
  ticketType: TicketType;
  initialId: number;
  finalId: number | null;
  soldCount: number;
  roundNumber: number;
  carriedFromGameId: string | null;
  recordedByUserId: string | null;
  recordedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InitialIdEntry {
  ticketType: TicketType;
  initialId: number;
  /** Rundenummer for den nye rundens registrering. */
  roundNumber: number;
  /** Forrige spill i samme (hall, type), null ved første runde. */
  carriedFromGameId: string | null;
  /** Eksisterende rad hvis allerede opprettet (gjentagende modal-åpning). */
  existingRange: TicketRange | null;
}

export interface GetInitialIdsInput {
  gameId: string;
  hallId: string;
}

export interface GetInitialIdsResult {
  gameId: string;
  hallId: string;
  entries: InitialIdEntry[];
}

export interface RecordFinalIdsInput {
  gameId: string;
  hallId: string;
  /**
   * Partielt kart fra ticket_type → final_id. Typer som ikke er med forblir
   * uendret (agenten kan registrere én type av gangen).
   */
  perTypeFinalIds: Partial<Record<TicketType, number>>;
  /** Bruker som utfører registreringen (audit-trail). */
  userId: string;
}

export interface RecordFinalIdsResult {
  gameId: string;
  hallId: string;
  totalSoldCount: number;
  ranges: TicketRange[];
}

export interface GetSummaryInput {
  gameId: string;
}

export interface GetSummaryResult {
  gameId: string;
  ranges: TicketRange[];
  totalSoldCount: number;
}

export interface TicketRegistrationServiceOptions {
  pool: Pool;
  schema?: string;
}

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DomainError("INVALID_INPUT", `${field} er påkrevd.`);
  }
  return value.trim();
}

function assertInteger(value: unknown, field: string, min = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
    throw new DomainError(
      "INVALID_INPUT",
      `${field} må være et heltall >= ${min}.`,
    );
  }
  return n;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return String(value);
}

function toIsoOrNull(value: unknown): string | null {
  if (value == null) return null;
  return toIso(value);
}

interface RangeRow {
  id: string;
  game_id: string;
  hall_id: string;
  ticket_type: string;
  initial_id: number;
  final_id: number | null;
  sold_count: number;
  round_number: number;
  carried_from_game_id: string | null;
  recorded_by_user_id: string | null;
  recorded_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapRow(row: RangeRow): TicketRange {
  return {
    id: row.id,
    gameId: row.game_id,
    hallId: row.hall_id,
    ticketType: row.ticket_type as TicketType,
    initialId: Number(row.initial_id),
    finalId: row.final_id == null ? null : Number(row.final_id),
    soldCount: Number(row.sold_count),
    roundNumber: Number(row.round_number),
    carriedFromGameId: row.carried_from_game_id,
    recordedByUserId: row.recorded_by_user_id,
    recordedAt: toIsoOrNull(row.recorded_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export class TicketRegistrationService {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(options: TicketRegistrationServiceOptions) {
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): TicketRegistrationService {
    return new TicketRegistrationService({ pool, schema });
  }

  private rangesTable(): string {
    return `"${this.schema}"."app_ticket_ranges_per_game"`;
  }

  private scheduledGamesTable(): string {
    return `"${this.schema}"."app_game1_scheduled_games"`;
  }

  /**
   * Henter initial-IDs for alle 6 ticket-typer for en (game, hall) — brukes av
   * modal-åpning. Carry-forward-logikken:
   *   - Hvis rad allerede finnes for denne (game, hall, type): returnér den
   *     rå — agenten fortsetter å redigere en pågående registrering.
   *   - Ellers: finn siste rad for samme (hall, type) med final_id IS NOT NULL
   *     og nyere registeredAt (innenfor dagen) → initial_id = forrige final_id
   *     + 1, round_number = forrige round_number + 1, carried_from_game_id =
   *     forrige game_id.
   *   - Hvis ingen tidligere runde: initial_id = 1, round_number = 1,
   *     carriedFromGameId = null.
   *
   * Returnerer alltid alle 6 typer (også de uten eksisterende rad) slik at UI
   * kan rendre tabellen komplett.
   */
  async getInitialIds(input: GetInitialIdsInput): Promise<GetInitialIdsResult> {
    const gameId = assertNonEmpty(input.gameId, "gameId");
    const hallId = assertNonEmpty(input.hallId, "hallId");

    // Valider at spillet finnes (defensivt — FK på INSERT ville fanget det
    // uansett, men feilmeldingen her er tydeligere).
    const { rows: gameRows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM ${this.scheduledGamesTable()} WHERE id = $1`,
      [gameId],
    );
    if (gameRows.length === 0) {
      throw new DomainError("GAME_NOT_FOUND", `Spillet '${gameId}' finnes ikke.`);
    }

    // Eksisterende rader for denne (game, hall)
    const { rows: existingRows } = await this.pool.query<RangeRow>(
      `SELECT id, game_id, hall_id, ticket_type, initial_id, final_id,
              sold_count, round_number, carried_from_game_id,
              recorded_by_user_id, recorded_at, created_at, updated_at
         FROM ${this.rangesTable()}
        WHERE game_id = $1 AND hall_id = $2`,
      [gameId, hallId],
    );
    const existingByType = new Map<TicketType, TicketRange>();
    for (const row of existingRows) {
      existingByType.set(row.ticket_type as TicketType, mapRow(row));
    }

    const entries: InitialIdEntry[] = [];
    for (const type of TICKET_TYPES) {
      const existing = existingByType.get(type);
      if (existing) {
        entries.push({
          ticketType: type,
          initialId: existing.initialId,
          roundNumber: existing.roundNumber,
          carriedFromGameId: existing.carriedFromGameId,
          existingRange: existing,
        });
        continue;
      }
      // Carry-forward-oppslag: finn siste rad for (hall, type) med
      // final_id IS NOT NULL, sortert på round_number DESC.
      const prev = await this.getLastCompletedRange(hallId, type);
      if (prev) {
        entries.push({
          ticketType: type,
          initialId: prev.finalId == null ? 1 : prev.finalId + 1,
          roundNumber: prev.roundNumber + 1,
          carriedFromGameId: prev.gameId,
          existingRange: null,
        });
      } else {
        entries.push({
          ticketType: type,
          initialId: 1,
          roundNumber: 1,
          carriedFromGameId: null,
          existingRange: null,
        });
      }
    }

    return { gameId, hallId, entries };
  }

  /**
   * Registrerer final_id per ticket-type for en (game, hall). UPSERT:
   *   - Hvis rad eksisterer: oppdaterer final_id, sold_count, recorded_at,
   *     recorded_by_user_id. initial_id forblir uendret.
   *   - Hvis rad ikke eksisterer: oppretter ny rad med initial_id fra
   *     carry-forward-logikken i getInitialIds.
   *
   * Valideringer per type:
   *   - final_id >= initial_id (FINAL_LESS_THAN_INITIAL)
   *   - final_id er positivt heltall
   *
   * Atomisk: hele operasjonen skjer i én transaksjon. Ved feil på én rad
   * rulles alle tilbake.
   */
  async recordFinalIds(input: RecordFinalIdsInput): Promise<RecordFinalIdsResult> {
    const gameId = assertNonEmpty(input.gameId, "gameId");
    const hallId = assertNonEmpty(input.hallId, "hallId");
    const userId = assertNonEmpty(input.userId, "userId");
    if (!input.perTypeFinalIds || typeof input.perTypeFinalIds !== "object") {
      throw new DomainError(
        "INVALID_INPUT",
        "perTypeFinalIds må være et objekt.",
      );
    }
    const entries = Object.entries(input.perTypeFinalIds);
    if (entries.length === 0) {
      throw new DomainError(
        "INVALID_INPUT",
        "perTypeFinalIds kan ikke være tom — spesifisér minst én ticket-type.",
      );
    }

    // Validér alle typer først (fail-fast) — så feiler vi ikke halvveis.
    const validatedEntries: Array<{ type: TicketType; finalId: number }> = [];
    for (const [type, finalId] of entries) {
      if (!isTicketType(type)) {
        throw new DomainError(
          "INVALID_TICKET_TYPE",
          `Ugyldig ticket-type '${type}'. Gyldig: ${TICKET_TYPES.join(", ")}.`,
        );
      }
      const n = assertInteger(finalId, `finalId(${type})`, 0);
      validatedEntries.push({ type, finalId: n });
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Valider at spillet finnes (defensivt — FK ville fanget det).
      const { rows: gameRows } = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM ${this.scheduledGamesTable()} WHERE id = $1 FOR UPDATE`,
        [gameId],
      );
      if (gameRows.length === 0) {
        throw new DomainError("GAME_NOT_FOUND", `Spillet '${gameId}' finnes ikke.`);
      }
      // Tillat registrering i scheduled/purchase_open/ready_to_start. Ikke i
      // running/completed/cancelled — da er salget stengt.
      const game = gameRows[0]!;
      const editableStatuses = new Set([
        "scheduled",
        "purchase_open",
        "ready_to_start",
      ]);
      if (!editableStatuses.has(game.status)) {
        throw new DomainError(
          "GAME_NOT_EDITABLE",
          `Spillet '${gameId}' har status '${game.status}' — kan ikke registrere salg.`,
        );
      }

      const resultRanges: TicketRange[] = [];
      let totalSoldCount = 0;

      for (const { type, finalId } of validatedEntries) {
        // Bestem initial_id + round_number + carried_from:
        //   - hvis rad finnes for (game, hall, type): reuse initial_id
        //   - ellers: carry-forward fra siste rad i (hall, type)
        const { rows: existingRows } = await client.query<RangeRow>(
          `SELECT id, game_id, hall_id, ticket_type, initial_id, final_id,
                  sold_count, round_number, carried_from_game_id,
                  recorded_by_user_id, recorded_at, created_at, updated_at
             FROM ${this.rangesTable()}
            WHERE game_id = $1 AND hall_id = $2 AND ticket_type = $3
            FOR UPDATE`,
          [gameId, hallId, type],
        );
        const existing = existingRows[0] ? mapRow(existingRows[0]) : null;

        let initialId: number;
        let roundNumber: number;
        let carriedFromGameId: string | null;
        if (existing) {
          initialId = existing.initialId;
          roundNumber = existing.roundNumber;
          carriedFromGameId = existing.carriedFromGameId;
        } else {
          const prev = await this.getLastCompletedRangeClient(client, hallId, type);
          if (prev) {
            initialId = prev.finalId == null ? 1 : prev.finalId + 1;
            roundNumber = prev.roundNumber + 1;
            carriedFromGameId = prev.gameId;
          } else {
            initialId = 1;
            roundNumber = 1;
            carriedFromGameId = null;
          }
        }

        if (finalId < initialId) {
          throw new DomainError(
            "FINAL_LESS_THAN_INITIAL",
            `${TICKET_TYPE_LABELS[type]}: final_id (${finalId}) må være >= initial_id (${initialId}).`,
          );
        }

        // Overlapp-sjekk: ingen annen åpen range i samme (hall, type) kan
        // overlappe med [initialId, finalId]. Samme (game, hall, type) er OK
        // (det er samme rad vi oppdaterer).
        const { rows: overlapRows } = await client.query<{ id: string; game_id: string }>(
          `SELECT id, game_id
             FROM ${this.rangesTable()}
            WHERE hall_id = $1
              AND ticket_type = $2
              AND NOT (game_id = $3)
              AND final_id IS NOT NULL
              AND NOT (final_id < $4 OR initial_id > $5)
            LIMIT 1`,
          [hallId, type, gameId, initialId, finalId],
        );
        if (overlapRows.length > 0) {
          throw new DomainError(
            "RANGE_OVERLAP",
            `${TICKET_TYPE_LABELS[type]}: range [${initialId}, ${finalId}] overlapper med en eksisterende range for spill '${overlapRows[0]!.game_id}'.`,
          );
        }

        const soldCount = finalId - initialId + 1;

        let upsertedRow: RangeRow;
        if (existing) {
          const { rows } = await client.query<RangeRow>(
            `UPDATE ${this.rangesTable()}
                SET final_id            = $1,
                    sold_count          = $2,
                    recorded_by_user_id = $3,
                    recorded_at         = now(),
                    updated_at          = now()
              WHERE id = $4
              RETURNING id, game_id, hall_id, ticket_type, initial_id, final_id,
                        sold_count, round_number, carried_from_game_id,
                        recorded_by_user_id, recorded_at, created_at, updated_at`,
            [finalId, soldCount, userId, existing.id],
          );
          upsertedRow = rows[0]!;
        } else {
          const newId = randomUUID();
          const { rows } = await client.query<RangeRow>(
            `INSERT INTO ${this.rangesTable()}
               (id, game_id, hall_id, ticket_type, initial_id, final_id,
                sold_count, round_number, carried_from_game_id,
                recorded_by_user_id, recorded_at, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), now(), now())
             RETURNING id, game_id, hall_id, ticket_type, initial_id, final_id,
                       sold_count, round_number, carried_from_game_id,
                       recorded_by_user_id, recorded_at, created_at, updated_at`,
            [
              newId,
              gameId,
              hallId,
              type,
              initialId,
              finalId,
              soldCount,
              roundNumber,
              carriedFromGameId,
              userId,
            ],
          );
          upsertedRow = rows[0]!;
        }

        resultRanges.push(mapRow(upsertedRow));
        totalSoldCount += soldCount;
      }

      await client.query("COMMIT");

      logger.info(
        {
          gameId,
          hallId,
          userId,
          totalSoldCount,
          typesRegistered: validatedEntries.map((e) => e.type),
        },
        "[GAP#4] ticket ranges recorded",
      );

      return {
        gameId,
        hallId,
        totalSoldCount,
        ranges: resultRanges,
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {
        // ignorer rollback-feil
      });
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Returnerer alle registrerte ranges for et spill (alle haller, alle typer).
   * Brukes av admin/master-UI for å vise oppsummering.
   */
  async getSummary(input: GetSummaryInput): Promise<GetSummaryResult> {
    const gameId = assertNonEmpty(input.gameId, "gameId");
    const { rows } = await this.pool.query<RangeRow>(
      `SELECT id, game_id, hall_id, ticket_type, initial_id, final_id,
              sold_count, round_number, carried_from_game_id,
              recorded_by_user_id, recorded_at, created_at, updated_at
         FROM ${this.rangesTable()}
        WHERE game_id = $1
        ORDER BY hall_id ASC, ticket_type ASC`,
      [gameId],
    );
    const ranges = rows.map(mapRow);
    const totalSoldCount = ranges.reduce((sum, r) => sum + r.soldCount, 0);
    return { gameId, ranges, totalSoldCount };
  }

  /** Valideringshjelper: final >= initial (ikke kastende, returner bool). */
  validateRange(initial: number, final: number): boolean {
    return Number.isInteger(initial)
      && Number.isInteger(final)
      && initial >= 0
      && final >= initial;
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  /**
   * Finner siste rad (DESC på round_number) for (hall, type) med
   * final_id IS NOT NULL. Brukes av carry-forward-logikken.
   */
  private async getLastCompletedRange(
    hallId: string,
    type: TicketType,
  ): Promise<TicketRange | null> {
    const { rows } = await this.pool.query<RangeRow>(
      `SELECT id, game_id, hall_id, ticket_type, initial_id, final_id,
              sold_count, round_number, carried_from_game_id,
              recorded_by_user_id, recorded_at, created_at, updated_at
         FROM ${this.rangesTable()}
        WHERE hall_id = $1 AND ticket_type = $2 AND final_id IS NOT NULL
        ORDER BY round_number DESC
        LIMIT 1`,
      [hallId, type],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  /** Transaksjons-variant av getLastCompletedRange (bruker PoolClient). */
  private async getLastCompletedRangeClient(
    client: PoolClient,
    hallId: string,
    type: TicketType,
  ): Promise<TicketRange | null> {
    const { rows } = await client.query<RangeRow>(
      `SELECT id, game_id, hall_id, ticket_type, initial_id, final_id,
              sold_count, round_number, carried_from_game_id,
              recorded_by_user_id, recorded_at, created_at, updated_at
         FROM ${this.rangesTable()}
        WHERE hall_id = $1 AND ticket_type = $2 AND final_id IS NOT NULL
        ORDER BY round_number DESC
        LIMIT 1`,
      [hallId, type],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }
}
