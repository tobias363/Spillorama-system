/**
 * Game1RescheduleService — runtime-justering av `scheduled_start_time` (og
 * valgfri `scheduled_end_time`) på en eksisterende rad i
 * `app_game1_scheduled_games`.
 *
 * Spec: 2026-05-07 PM-direktiv. For pilot-testing trenger Tobias / master-
 * agenter å kunne flytte planlagt starttidspunkt på et eksisterende spill
 * uten direct DB-tilgang. Cron `Game1ScheduleTickService.openPurchaseForImminentGames`
 * flipper automatisk `scheduled` → `purchase_open` på neste tick etter
 * justering — denne servicen oppdaterer kun tidspunktene.
 *
 * Reglar (regulatorisk gating før commit):
 *   - Game må eksistere (ellers `GAME_NOT_FOUND`).
 *   - Game.status MÅ være i `('scheduled', 'purchase_open')`. Andre
 *     statuser (`ready_to_start`, `running`, `paused`, `completed`,
 *     `cancelled`) tillates ikke (`RESCHEDULE_NOT_ALLOWED`).
 *   - newStart må være > now() - 60s (klokke-skew-slack — caller har
 *     sannsynligvis allerede validert i route, men servicen håndhever
 *     selv som defense-in-depth).
 *   - newEnd, hvis sendt, må være > newStart.
 *   - newEnd må være ≤ now() + 24h (typo-safety mot dato 100 år frem).
 *
 * Ansvar IKKE i scope:
 *   - Audit-logging (route-laget skriver `game1.reschedule`-event etter
 *     vellykket service-kall).
 *   - Permission-/hall-scope-sjekk (gjøres i route).
 *   - Socket-broadcast (route kan trigge ved behov).
 */

import type { Pool } from "pg";
import { DomainError } from "../errors/DomainError.js";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-reschedule-service" });

export interface Game1RescheduleServiceOptions {
  pool: Pool;
  schema?: string;
}

export interface RescheduleInput {
  gameId: string;
  newStartTime: Date;
  /** Valgfri. Hvis udefinert beholdes eksisterende `scheduled_end_time`. */
  newEndTime: Date | undefined;
  reason: string;
  /**
   * Valgfri tidspunkt-injektor for tester. Default `Date.now()`. Brukes til
   * å sammenligne newStartTime/newEndTime mot "nå" konsistent inn i tester.
   */
  nowMs?: number;
}

export interface RescheduleResult {
  /** Status før reschedule (alltid `scheduled` eller `purchase_open`). */
  status: string;
  /** Tidligere `scheduled_start_time` som ISO-streng. */
  oldStartTime: string;
  /** Tidligere `scheduled_end_time` som ISO-streng. */
  oldEndTime: string;
  /** Ny `scheduled_start_time` som ISO-streng. */
  newStartTime: string;
  /** Ny `scheduled_end_time` som ISO-streng (kan være lik oldEndTime). */
  newEndTime: string;
}

const ALLOWED_STATUSES: readonly string[] = ["scheduled", "purchase_open"];
const NOW_SLACK_MS = 60_000; // 60s klokke-skew
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000; // 24h cap mot dato-typos

interface ScheduledGameRow {
  id: string;
  status: string;
  scheduled_start_time: Date | string;
  scheduled_end_time: Date | string;
}

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  // Postgres kan returnere ISO-streng direkte (afhengig av driver-config);
  // re-parse for å normalisere offset.
  const parsed = new Date(value);
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  return String(value);
}

export class Game1RescheduleService {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(options: Game1RescheduleServiceOptions) {
    this.pool = options.pool;
    const schema = (options.schema ?? "public").trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
      throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
    }
    this.schema = schema;
  }

  /** @internal test helper. */
  static forTesting(pool: Pool, schema = "public"): Game1RescheduleService {
    return new Game1RescheduleService({ pool, schema });
  }

  private scheduledGamesTable(): string {
    return `"${this.schema}"."app_game1_scheduled_games"`;
  }

  /**
   * Rescheduling: oppdater `scheduled_start_time` (og valgfri
   * `scheduled_end_time`). Kaster `GAME_NOT_FOUND` /
   * `RESCHEDULE_NOT_ALLOWED` / `INVALID_INPUT` ved feil. Returnerer
   * before/after-snapshot for audit-logging i route.
   */
  async reschedule(input: RescheduleInput): Promise<RescheduleResult> {
    const reasonTrimmed = input.reason.trim();
    if (!reasonTrimmed) {
      throw new DomainError("INVALID_INPUT", "reason kreves ved reschedule.");
    }
    if (reasonTrimmed.length > 500) {
      throw new DomainError(
        "INVALID_INPUT",
        "reason kan ikke være lengre enn 500 tegn."
      );
    }

    const nowMs = input.nowMs ?? Date.now();
    const newStartMs = input.newStartTime.getTime();
    if (!Number.isFinite(newStartMs)) {
      throw new DomainError(
        "INVALID_INPUT",
        "scheduledStartTime må være en gyldig dato/tid."
      );
    }
    if (newStartMs < nowMs - NOW_SLACK_MS) {
      throw new DomainError(
        "INVALID_INPUT",
        "scheduledStartTime kan ikke være i fortiden."
      );
    }

    let newEndMs: number | undefined;
    if (input.newEndTime !== undefined) {
      newEndMs = input.newEndTime.getTime();
      if (!Number.isFinite(newEndMs)) {
        throw new DomainError(
          "INVALID_INPUT",
          "scheduledEndTime må være en gyldig dato/tid."
        );
      }
      if (newEndMs <= newStartMs) {
        throw new DomainError(
          "INVALID_INPUT",
          "scheduledEndTime må være etter scheduledStartTime."
        );
      }
      if (newEndMs > nowMs + MAX_FUTURE_MS) {
        throw new DomainError(
          "INVALID_INPUT",
          "scheduledEndTime kan ikke være mer enn 24 timer fram i tid."
        );
      }
    }

    // Hent rad for status-validering + before-snapshot.
    const { rows } = await this.pool.query<ScheduledGameRow>(
      `SELECT id, status, scheduled_start_time, scheduled_end_time
         FROM ${this.scheduledGamesTable()}
         WHERE id = $1`,
      [input.gameId]
    );
    const game = rows[0];
    if (!game) {
      throw new DomainError("GAME_NOT_FOUND", "Spillet finnes ikke.");
    }
    if (!ALLOWED_STATUSES.includes(game.status)) {
      throw new DomainError(
        "RESCHEDULE_NOT_ALLOWED",
        `Kan kun reschedule spill i status 'scheduled' eller 'purchase_open' (nåværende: '${game.status}').`
      );
    }

    const oldStartIso = toIso(game.scheduled_start_time);
    const oldEndIso = toIso(game.scheduled_end_time);

    // UPDATE: COALESCE($2::timestamptz, scheduled_end_time) for å støtte
    // partial-update der kun start endres. WHERE-clause beskytter mot
    // race der status flippes mellom SELECT og UPDATE.
    const newStartIso = new Date(newStartMs).toISOString();
    const newEndIsoForQuery: string | null =
      newEndMs === undefined ? null : new Date(newEndMs).toISOString();

    const { rows: updatedRows, rowCount } = await this.pool.query<{
      scheduled_start_time: Date | string;
      scheduled_end_time: Date | string;
      status: string;
    }>(
      `UPDATE ${this.scheduledGamesTable()}
          SET scheduled_start_time = $2::timestamptz,
              scheduled_end_time   = COALESCE($3::timestamptz, scheduled_end_time),
              updated_at           = now()
        WHERE id = $1
          AND status IN ('scheduled', 'purchase_open')
        RETURNING scheduled_start_time, scheduled_end_time, status`,
      [input.gameId, newStartIso, newEndIsoForQuery]
    );
    if ((rowCount ?? 0) === 0 || !updatedRows[0]) {
      // Race: status ble flippet mellom SELECT og UPDATE — kast samme
      // feilkode som primær-validering så caller får konsistent UX.
      throw new DomainError(
        "RESCHEDULE_NOT_ALLOWED",
        "Spillets status ble endret samtidig — prøv igjen."
      );
    }

    const updatedStartIso = toIso(updatedRows[0].scheduled_start_time);
    const updatedEndIso = toIso(updatedRows[0].scheduled_end_time);

    log.info(
      {
        gameId: input.gameId,
        oldStartTime: oldStartIso,
        newStartTime: updatedStartIso,
        oldEndTime: oldEndIso,
        newEndTime: updatedEndIso,
        endChanged: newEndMs !== undefined,
        reason: reasonTrimmed,
      },
      "[Game1RescheduleService] reschedule applied"
    );

    return {
      status: game.status,
      oldStartTime: oldStartIso,
      oldEndTime: oldEndIso,
      newStartTime: updatedStartIso,
      newEndTime: updatedEndIso,
    };
  }
}
