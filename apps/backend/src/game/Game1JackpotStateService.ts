/**
 * MASTER_PLAN_SPILL1_PILOT_2026-04-24 §2.3 — Jackpott daglig akkumulering.
 *
 * Spec (PM-låst, Appendix B.9):
 *   * Starter 2000 kr (200_000 øre) per hall-gruppe
 *   * +4000 kr/dag (400_000 øre) — daglig cron-tick
 *   * Max 30 000 kr (3_000_000 øre) — hard cap
 *   * Draw-thresholds: [50, 55, 56, 57] — konsumeres per sub-game (IKKE
 *     eskalering i ett spill, men progresjon mellom sub-games inntil
 *     jackpot vunnes).
 *
 * Skillelinje mot eksisterende tjenester:
 *   * Game1JackpotService — evaluerer per-farge fixed-amount jackpot for
 *     Fullt Hus. Kjøres i drawNext per spill.
 *   * Game1AccumulatingPotsService (PR-T1 framework) — generell pot per
 *     (hall, pot_key). Kan utvides senere til å subsumere denne; for pilot
 *     holder vi en dedikert tabell/service for tydelig PM-audit.
 *
 * Ansvar:
 *   1) getCurrentAmount(hallGroupId) — synkron les av state.
 *   2) accumulateDaily() — idempotent cron-metode. For hver hall-gruppe,
 *      hvis last_accumulation_date < today, addr daily_increment_cents
 *      opp til max_cap_cents. Kalles 1×/dag (kl 00:15 via jackpotDailyTick).
 *   3) getStateForGroup(hallGroupId) — full state inkl. draw-thresholds og
 *      cap (brukes av confirm-popup).
 *   4) resetToStart(hallGroupId, reason) — reset til seed (2000 kr) etter
 *      jackpot-vinning. TODO-hook for fremtidig integrasjon med drawNext.
 *   5) ensureStateExists(hallGroupId) — lazy-init (for grupper opprettet
 *      etter migrasjonen kjørte).
 *
 * DB: app_game1_jackpot_state (migrasjon 20260821000000).
 */

import type { Pool, PoolClient } from "pg";
import { logger as rootLogger } from "../util/logger.js";

const log = rootLogger.child({ module: "game1-jackpot-state-service" });

/** Øre-beløp for Spill 1 Jackpott (Appendix B.9). */
export const JACKPOT_DEFAULT_START_CENTS = 200_000; // 2000 kr
export const JACKPOT_DEFAULT_DAILY_INCREMENT_CENTS = 400_000; // 4000 kr/dag
export const JACKPOT_DEFAULT_MAX_CAP_CENTS = 3_000_000; // 30 000 kr
export const JACKPOT_DEFAULT_DRAW_THRESHOLDS: readonly number[] = [50, 55, 56, 57];

export interface Game1JackpotState {
  hallGroupId: string;
  currentAmountCents: number;
  lastAccumulationDate: string; // YYYY-MM-DD
  maxCapCents: number;
  dailyIncrementCents: number;
  drawThresholds: number[];
  updatedAt: string;
}

export interface AccumulateDailyResult {
  /** Hall-grupper som faktisk fikk påfyll (ekskl. idempotent no-ops). */
  updatedCount: number;
  /** Antall grupper som allerede var oppdatert i dag (no-op). */
  alreadyCurrentCount: number;
  /** Antall grupper som traff cap (full cap, ingen økning skjedde). */
  cappedCount: number;
  /** Antall errors i loopen (service isolerer per-rad-feil). */
  errors: number;
}

export interface Game1JackpotStateServiceOptions {
  pool: Pool;
  schema?: string;
  /**
   * Override for testing — returnerer dagens dato som 'YYYY-MM-DD'.
   * Default: UTC now(). Serveren kjører i UTC-timezone (Docker default).
   */
  todayKey?: () => string;
}

function todayUtcKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function toDateKey(value: unknown): string {
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof value === "string") {
    // Postgres DATE returns "YYYY-MM-DD" directly.
    return value.length >= 10 ? value.substring(0, 10) : value;
  }
  return "";
}

function parseThresholds(value: unknown): number[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? (() => {
          try { return JSON.parse(value); } catch { return []; }
        })()
      : [];
  if (!Array.isArray(raw)) return [...JACKPOT_DEFAULT_DRAW_THRESHOLDS];
  const out: number[] = [];
  for (const v of raw) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n) && n > 0) out.push(Math.floor(n));
  }
  return out.length > 0 ? out : [...JACKPOT_DEFAULT_DRAW_THRESHOLDS];
}

function toBigIntCents(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return Math.floor(n);
  }
  return fallback;
}

interface JackpotStateRow {
  hall_group_id: string;
  current_amount_cents: string | number;
  last_accumulation_date: string | Date;
  max_cap_cents: string | number;
  daily_increment_cents: string | number;
  draw_thresholds_json: unknown;
  updated_at: Date | string;
}

function mapRow(row: JackpotStateRow): Game1JackpotState {
  return {
    hallGroupId: row.hall_group_id,
    currentAmountCents: toBigIntCents(row.current_amount_cents, 0),
    lastAccumulationDate: toDateKey(row.last_accumulation_date),
    maxCapCents: toBigIntCents(row.max_cap_cents, JACKPOT_DEFAULT_MAX_CAP_CENTS),
    dailyIncrementCents: toBigIntCents(
      row.daily_increment_cents,
      JACKPOT_DEFAULT_DAILY_INCREMENT_CENTS
    ),
    drawThresholds: parseThresholds(row.draw_thresholds_json),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at ?? ""),
  };
}

export class Game1JackpotStateService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly todayKey: () => string;

  constructor(options: Game1JackpotStateServiceOptions) {
    this.pool = options.pool;
    this.schema = options.schema ?? "public";
    this.todayKey = options.todayKey ?? todayUtcKey;
  }

  private table(): string {
    return `"${this.schema}"."app_game1_jackpot_state"`;
  }

  private hallGroupsTable(): string {
    return `"${this.schema}"."app_hall_groups"`;
  }

  /**
   * Les nåværende jackpot-saldo for en hall-gruppe. Hvis raden ikke finnes
   * (lazy-init case), returneres start-verdi uten å skrive til DB. Kall
   * `ensureStateExists` eksplisitt hvis state skal persisteres.
   */
  async getCurrentAmount(hallGroupId: string): Promise<number> {
    const state = await this.getStateForGroup(hallGroupId);
    return state.currentAmountCents;
  }

  /**
   * Full state for confirm-popup + admin-UI.
   */
  async getStateForGroup(hallGroupId: string): Promise<Game1JackpotState> {
    const { rows } = await this.pool.query<JackpotStateRow>(
      `SELECT hall_group_id, current_amount_cents, last_accumulation_date,
              max_cap_cents, daily_increment_cents, draw_thresholds_json,
              updated_at
         FROM ${this.table()}
        WHERE hall_group_id = $1`,
      [hallGroupId]
    );
    if (rows.length === 0) {
      return {
        hallGroupId,
        currentAmountCents: JACKPOT_DEFAULT_START_CENTS,
        lastAccumulationDate: this.todayKey(),
        maxCapCents: JACKPOT_DEFAULT_MAX_CAP_CENTS,
        dailyIncrementCents: JACKPOT_DEFAULT_DAILY_INCREMENT_CENTS,
        drawThresholds: [...JACKPOT_DEFAULT_DRAW_THRESHOLDS],
        updatedAt: new Date().toISOString(),
      };
    }
    return mapRow(rows[0]!);
  }

  /**
   * Opprett state-rad for hall-gruppe hvis den mangler (lazy-init for
   * grupper opprettet etter migrasjonen). Idempotent: INSERT ... ON CONFLICT.
   */
  async ensureStateExists(hallGroupId: string, client?: PoolClient): Promise<Game1JackpotState> {
    const executor = client ?? this.pool;
    await executor.query(
      `INSERT INTO ${this.table()}
         (hall_group_id, current_amount_cents, last_accumulation_date,
          max_cap_cents, daily_increment_cents, draw_thresholds_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (hall_group_id) DO NOTHING`,
      [
        hallGroupId,
        JACKPOT_DEFAULT_START_CENTS,
        this.todayKey(),
        JACKPOT_DEFAULT_MAX_CAP_CENTS,
        JACKPOT_DEFAULT_DAILY_INCREMENT_CENTS,
        JSON.stringify([...JACKPOT_DEFAULT_DRAW_THRESHOLDS]),
      ]
    );
    return this.getStateForGroup(hallGroupId);
  }

  /**
   * Idempotent daglig akkumulering (kalles av jackpotDailyTick cron).
   *
   * Logikk per hall-gruppe:
   *   1) Hvis last_accumulation_date >= today → no-op (allerede oppdatert).
   *   2) Hvis current_amount_cents >= max_cap_cents → kun oppdater
   *      last_accumulation_date (så cron ikke retrier hele dagen).
   *   3) Ellers: new_amount = min(current + daily_increment, max_cap),
   *      last_accumulation_date = today.
   *
   * Alt skjer i én SQL UPDATE med LEAST(...) og en WHERE-klausul som
   * implisitt gir idempotens.
   */
  async accumulateDaily(): Promise<AccumulateDailyResult> {
    const today = this.todayKey();
    let updatedCount = 0;
    let alreadyCurrentCount = 0;
    let cappedCount = 0;
    let errors = 0;

    try {
      // Atomisk UPDATE — bruker LEAST for cap og WHERE for idempotens.
      // RETURNING gir oss både ny og gammel amount så vi kan skille
      // "økt" vs "capped (oppdaterte bare dato)".
      const { rows: updatedRows } = await this.pool.query<{
        hall_group_id: string;
        current_amount_cents: string | number;
        prev_amount_cents: string | number;
        max_cap_cents: string | number;
      }>(
        `WITH before AS (
           SELECT hall_group_id, current_amount_cents AS prev_amount_cents
             FROM ${this.table()}
            WHERE last_accumulation_date < $1::date
         )
         UPDATE ${this.table()} t
            SET current_amount_cents   = LEAST(
                                            t.current_amount_cents + t.daily_increment_cents,
                                            t.max_cap_cents
                                          ),
                last_accumulation_date = $1::date,
                updated_at             = now()
           FROM before b
          WHERE t.hall_group_id = b.hall_group_id
          RETURNING t.hall_group_id,
                    t.current_amount_cents,
                    b.prev_amount_cents,
                    t.max_cap_cents`,
        [today]
      );

      for (const row of updatedRows) {
        const prev = toBigIntCents(row.prev_amount_cents, 0);
        const curr = toBigIntCents(row.current_amount_cents, 0);
        const cap = toBigIntCents(row.max_cap_cents, JACKPOT_DEFAULT_MAX_CAP_CENTS);
        if (prev >= cap) {
          cappedCount += 1;
        } else {
          updatedCount += 1;
          if (curr >= cap) {
            // Rent audit: akkurat nådd cap denne tick-en.
            log.info(
              { hallGroupId: row.hall_group_id, prev, curr, cap },
              "jackpot.accumulate.reached_cap"
            );
          }
        }
      }

      // Grupper som allerede var oppdatert i dag:
      const { rows: currentRows } = await this.pool.query<{ cnt: string }>(
        `SELECT COUNT(*)::text AS cnt
           FROM ${this.table()}
          WHERE last_accumulation_date = $1::date`,
        [today]
      );
      const totalCurrent = Number(currentRows[0]?.cnt ?? "0");
      // totalCurrent inkluderer de vi nettopp oppdaterte pluss evt.
      // capped-rader vi oppdaterte. alreadyCurrent = total - dagens updates.
      const thisTickTotal = updatedCount + cappedCount;
      alreadyCurrentCount = Math.max(0, totalCurrent - thisTickTotal);

      log.info(
        { today, updatedCount, alreadyCurrentCount, cappedCount },
        "jackpot.accumulate.done"
      );
    } catch (err) {
      errors += 1;
      log.error({ err }, "jackpot.accumulate.failed");
      throw err;
    }

    return { updatedCount, alreadyCurrentCount, cappedCount, errors };
  }

  /**
   * Reset jackpot til seed etter at den er vunnet. Skriver også en
   * oppdatert last_accumulation_date = today (så vi ikke får dobbelt
   * påfyll samme dag).
   *
   * TODO(PR-T2+): hooke på drawNext-path når Fullt Hus vinnes innenfor
   * gjeldende draw-threshold. For pilot kjøres dette manuelt fra admin-UI
   * eller via jackpot-vinn-event i Game1DrawEngine.
   */
  async resetToStart(hallGroupId: string, _reason: string): Promise<Game1JackpotState> {
    await this.pool.query(
      `UPDATE ${this.table()}
          SET current_amount_cents   = $2,
              last_accumulation_date = $3::date,
              updated_at             = now()
        WHERE hall_group_id = $1`,
      [hallGroupId, JACKPOT_DEFAULT_START_CENTS, this.todayKey()]
    );
    return this.getStateForGroup(hallGroupId);
  }
}
