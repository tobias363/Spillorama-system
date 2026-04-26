/**
 * REQ-101 (PDF 17 §17.24 / BIR-299-300): inline Add Physical Ticket popup.
 *
 * Spec:
 *   docs/architecture/WIREFRAME_CATALOG.md § "17.24 Add Physical Ticket Popup
 *   (inne i Sub Game Details)"
 *   docs/architecture/WIREFRAME_BACKEND_REQUIREMENTS_2026-04-25.md REQ-101
 *
 * Forskjell fra eksisterende `TicketRegistrationService`:
 *   - `TicketRegistrationService` er den TO-FASE-flyten brukt av "Register
 *     Sold Tickets"-skjermen (17.15) hvor agenten først får forhåndsfylte
 *     initial-IDs (carry-forward) og deretter scanner final-IDs.
 *   - **Denne** servicen er den ÉN-OPERASJON-inline-flyten brukt fra Sub
 *     Game Details (17.23 → 17.24): agenten har én farge + Initial ID +
 *     Final ID i ett kall (kalles fra popup-modalen). Idempotent re-call
 *     med samme range = no-op + ack (samme rad oppdateres uendret).
 *
 * Wireframe-eksempel (17.24):
 *   Agent klikker "Add Physical Ticket" → popup åpner →
 *     Color: "Small Yellow", Initial ID: 1, Final ID: 10 → Submit
 *     → backend lagrer rad i `app_ticket_ranges_per_game` (samme tabell som
 *     to-fase-flyten — det er samme regulatoriske range-modell).
 *
 * Validering:
 *   - color ∈ TICKET_TYPES (small_yellow … large_purple)
 *   - initialId/finalId positive integers, finalId >= initialId
 *   - range overlapper ikke med en annen game's range i samme (hall, color)
 *   - agent har tilgang til hall (caller-laget gjør hall-scope-sjekk;
 *     servicen tar bare en hallId-parameter og stoler på den)
 *   - game er i editable status (purchase_open / scheduled / ready_to_start)
 *
 * Idempotens:
 *   Re-kall med samme (game, hall, color, initial, final) → no-op +
 *   returnerer eksisterende rad. Hvis FINAL_ID endres → UPDATE.
 *
 * Audit-log:
 *   Caller (route-laget) skriver audit-event "physical_ticket.inline_register"
 *   etter vellykket retur. Servicen logger med pino men eier ikke audit-laget.
 */

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import {
  TICKET_TYPES,
  TICKET_TYPE_LABELS,
  isTicketType,
  type TicketRange,
  type TicketType,
} from "./TicketRegistrationService.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-physical-ticket-inline-service" });

export interface InlineRegisterInput {
  /** scheduled_game_id som popup-en ble åpnet for. */
  subGameId: string;
  /** hall der ticket-stack finnes (typisk agent.shift.hallId). */
  hallId: string;
  /** Initial ID på stacken (heltall >= 0). */
  initialId: number;
  /** Final ID på stacken (heltall >= initialId). */
  finalId: number;
  /** Farge — kombinert farge+størrelse, matcher TicketType-enum. */
  color: TicketType | string;
  /** Bruker-ID for audit (typisk agent.userId). */
  userId: string;
}

export interface InlineRegisterResult {
  range: TicketRange;
  /** True hvis raden ble opprettet i dette kallet; false ved no-op idempotent re-call. */
  created: boolean;
  /** True hvis raden allerede fantes med samme range — ingen endring gjort. */
  idempotent: boolean;
  soldCount: number;
}

export interface AgentPhysicalTicketInlineServiceOptions {
  pool: Pool;
  schema?: string;
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

export class AgentPhysicalTicketInlineService {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(options: AgentPhysicalTicketInlineServiceOptions) {
    this.pool = options.pool;
    this.schema = assertSchemaName(options.schema ?? "public");
  }

  /** @internal — test-hook. */
  static forTesting(pool: Pool, schema = "public"): AgentPhysicalTicketInlineService {
    return new AgentPhysicalTicketInlineService({ pool, schema });
  }

  private rangesTable(): string {
    return `"${this.schema}"."app_ticket_ranges_per_game"`;
  }

  private scheduledGamesTable(): string {
    return `"${this.schema}"."app_game1_scheduled_games"`;
  }

  /**
   * Register en physical-ticket-range inline. Én operasjon: validate +
   * UPSERT + return.
   *
   * Idempotens:
   *   - Hvis (subGameId, hallId, color) allerede har rad MED samme initial+
   *     final: returner uendret + idempotent=true.
   *   - Hvis rad eksisterer men final_id er forskjellig: UPDATE final_id +
   *     sold_count + recorded_at (samme oppførsel som to-fase-flyten).
   *   - Hvis ingen rad: INSERT med round_number=1 + carriedFromGameId=null
   *     (denne servicen brukes for inline-add fra Sub Game Details, ikke
   *     for carry-forward-flyten).
   */
  async inlineRegister(input: InlineRegisterInput): Promise<InlineRegisterResult> {
    const subGameId = assertNonEmpty(input.subGameId, "subGameId");
    const hallId = assertNonEmpty(input.hallId, "hallId");
    const userId = assertNonEmpty(input.userId, "userId");
    const colorInput = assertNonEmpty(input.color, "color");
    if (!isTicketType(colorInput)) {
      throw new DomainError(
        "INVALID_TICKET_COLOR",
        `Ugyldig farge '${colorInput}'. Gyldig: ${TICKET_TYPES.join(", ")}.`,
      );
    }
    const color = colorInput;
    const initialId = assertInteger(input.initialId, "initialId", 0);
    const finalId = assertInteger(input.finalId, "finalId", 0);
    if (finalId < initialId) {
      throw new DomainError(
        "FINAL_LESS_THAN_INITIAL",
        `${TICKET_TYPE_LABELS[color]}: final_id (${finalId}) må være >= initial_id (${initialId}).`,
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Verifiser at spillet eksisterer + er i editable status. Lås raden
      // for å serialisere konkurrerende inline-add-kall mot samme spill.
      const { rows: gameRows } = await client.query<{ id: string; status: string }>(
        `SELECT id, status FROM ${this.scheduledGamesTable()} WHERE id = $1 FOR UPDATE`,
        [subGameId],
      );
      if (gameRows.length === 0) {
        throw new DomainError("GAME_NOT_FOUND", `Spillet '${subGameId}' finnes ikke.`);
      }
      const editable = new Set(["scheduled", "purchase_open", "ready_to_start"]);
      const status = gameRows[0]!.status;
      if (!editable.has(status)) {
        throw new DomainError(
          "GAME_NOT_EDITABLE",
          `Spillet '${subGameId}' har status '${status}' — kan ikke legge til physical ticket.`,
        );
      }

      // Lås eksisterende rad for (game, hall, color) hvis den finnes.
      const { rows: existingRows } = await client.query<RangeRow>(
        `SELECT id, game_id, hall_id, ticket_type, initial_id, final_id,
                sold_count, round_number, carried_from_game_id,
                recorded_by_user_id, recorded_at, created_at, updated_at
           FROM ${this.rangesTable()}
          WHERE game_id = $1 AND hall_id = $2 AND ticket_type = $3
          FOR UPDATE`,
        [subGameId, hallId, color],
      );
      const existing = existingRows[0] ? mapRow(existingRows[0]) : null;

      // Idempotent re-call: samme (initial, final) → returner som no-op.
      if (
        existing
        && existing.initialId === initialId
        && existing.finalId === finalId
      ) {
        await client.query("COMMIT");
        return {
          range: existing,
          created: false,
          idempotent: true,
          soldCount: existing.soldCount,
        };
      }

      // Range-overlap: ingen annen rad i samme (hall, color) med
      // overlappende [initial, final] får eksistere — bortsett fra raden
      // for samme (game, hall, color) som vi oppdaterer.
      const { rows: overlapRows } = await client.query<{ id: string; game_id: string }>(
        `SELECT id, game_id
           FROM ${this.rangesTable()}
          WHERE hall_id = $1
            AND ticket_type = $2
            AND NOT (game_id = $3)
            AND final_id IS NOT NULL
            AND NOT (final_id < $4 OR initial_id > $5)
          LIMIT 1`,
        [hallId, color, subGameId, initialId, finalId],
      );
      if (overlapRows.length > 0) {
        throw new DomainError(
          "RANGE_OVERLAP",
          `${TICKET_TYPE_LABELS[color]}: range [${initialId}, ${finalId}] overlapper med en eksisterende range for spill '${overlapRows[0]!.game_id}'.`,
        );
      }

      const soldCount = finalId - initialId + 1;

      let resultRow: RangeRow;
      if (existing) {
        // UPDATE: agenten endret final (eller initial). Behold round_number
        // + carried_from for å bevare audit-historikk.
        const { rows } = await client.query<RangeRow>(
          `UPDATE ${this.rangesTable()}
              SET initial_id          = $1,
                  final_id            = $2,
                  sold_count          = $3,
                  recorded_by_user_id = $4,
                  recorded_at         = now(),
                  updated_at          = now()
            WHERE id = $5
            RETURNING id, game_id, hall_id, ticket_type, initial_id, final_id,
                      sold_count, round_number, carried_from_game_id,
                      recorded_by_user_id, recorded_at, created_at, updated_at`,
          [initialId, finalId, soldCount, userId, existing.id],
        );
        resultRow = rows[0]!;
      } else {
        const newId = randomUUID();
        const { rows } = await client.query<RangeRow>(
          `INSERT INTO ${this.rangesTable()}
             (id, game_id, hall_id, ticket_type, initial_id, final_id,
              sold_count, round_number, carried_from_game_id,
              recorded_by_user_id, recorded_at, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, 1, NULL, $8, now(), now(), now())
           RETURNING id, game_id, hall_id, ticket_type, initial_id, final_id,
                     sold_count, round_number, carried_from_game_id,
                     recorded_by_user_id, recorded_at, created_at, updated_at`,
          [
            newId,
            subGameId,
            hallId,
            color,
            initialId,
            finalId,
            soldCount,
            userId,
          ],
        );
        resultRow = rows[0]!;
      }

      await client.query("COMMIT");

      const range = mapRow(resultRow);
      logger.info(
        {
          subGameId,
          hallId,
          color,
          initialId,
          finalId,
          soldCount,
          created: !existing,
          userId,
        },
        "[REQ-101] inline physical ticket registered",
      );

      return {
        range,
        created: !existing,
        idempotent: false,
        soldCount,
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
}
