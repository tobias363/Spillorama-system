/**
 * Game1JackpotStateService — DEPRECATED daglig akkumulering, beholdt
 * for admin-tooling og immutable audit-historikk.
 *
 * Historikk:
 *   MASTER_PLAN_SPILL1_PILOT_2026-04-24 §2.3 (Appendix B.9): Tjenesten
 *   implementerte daglig +4000 kr akkumulering (start 2000, max 30 000)
 *   per hall-gruppe via cron-job `jackpotDailyTick`.
 *
 * ADR-0017 (2026-05-10) — Tobias-direktiv:
 *   "Jackpot-popup gjelder kun for Jackpot-katalog-spillet (pos 7), og
 *    bingoverten setter ALLTID jackpot manuelt før spillet starter. Det
 *    skal IKKE være automatisk akkumulering."
 *
 *   Konsekvens:
 *     1. `accumulateDaily()` er deprecated til no-op (cron-jobben er
 *        deaktivert i index.ts).
 *     2. `app_game1_jackpot_state.current_amount_cents` settes til 0 i
 *        PR-D migration så stale lesninger gir 0.
 *     3. `Game1DrawEngineDailyJackpot.ts` er refaktorert til å lese
 *        per-spill jackpot-config fra `app_game_plan_run.jackpot_overrides_json`
 *        i stedet for å bruke denne tjenesten.
 *
 * Hva beholdes:
 *   1) `getCurrentAmount(hallGroupId)` — admin-UI lesning (returnerer 0
 *      etter PR-D migration).
 *   2) `getStateForGroup(hallGroupId)` — admin-UI lesning.
 *   3) `awardJackpot(input)` — admin-tool for ADMIN_MANUAL_AWARD-korreksjoner.
 *      Skriver immutable rad i `app_game1_jackpot_awards` (ADR-0004 hash-chain).
 *   4) `resetToStart(hallGroupId, reason)` — admin-tool for reset.
 *   5) `ensureStateExists(hallGroupId)` — lazy-init (idempotent).
 *   6) `isHallInGroup(hallId, hallGroupId)` — RBAC-helper for admin-router.
 *   7) `listAwards(hallGroupId, limit)` — historikk-lesning av immutable awards.
 *
 * Hva fjernes:
 *   * `accumulateDaily()` — no-op (deprecated).
 *   * `Game1DrawEngineDailyJackpot.runDailyJackpotEvaluation` bruker IKKE
 *     lenger denne tjenesten (leser plan-run-overrides direkte).
 *
 * DB: app_game1_jackpot_state (migrasjon 20260821000000) +
 *     app_game1_jackpot_awards (migrasjon 20260901000000) — beholdes som
 *     forward-only-tabeller per ADR-0014.
 */

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { logger as rootLogger } from "../util/logger.js";
import { todayOsloKey } from "../util/osloTimezone.js";

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

/**
 * Grunner som kan stå i app_game1_jackpot_awards.reason.
 * - FULL_HOUSE_WITHIN_THRESHOLD: auto-award fra DrawEngine når Fullt Hus
 *   vinnes på/innen draw_thresholds[0] (default 50).
 * - ADMIN_MANUAL_AWARD: admin trigger via POST-endepunkt (force-award).
 * - CORRECTION: senere manuell justering (audit-spor).
 */
export type JackpotAwardReason =
  | "FULL_HOUSE_WITHIN_THRESHOLD"
  | "ADMIN_MANUAL_AWARD"
  | "CORRECTION";

export interface AwardJackpotInput {
  /** Hall-gruppe som eier potten. */
  hallGroupId: string;
  /**
   * Stable nøkkel — UNIQUE i app_game1_jackpot_awards. Anbefalt format:
   *   `g1-jackpot-{scheduledGameId}-{drawSequenceAtWin}` (auto)
   *   `g1-jackpot-admin-{userId}-{ts}` (manuell)
   * Brukes for safe-retry: andre kall med samme key returnerer den
   * tidligere awarden uten dobbel-debit.
   */
  idempotencyKey: string;
  /** Audit-grunn. */
  reason: JackpotAwardReason;
  /** Auto-award: scheduled-game som utløste vinningen. */
  scheduledGameId?: string;
  /** Auto-award: draw-sekvens som utløste vinningen (typisk ≤ thresholds[0]). */
  drawSequenceAtWin?: number;
  /** Hvis admin-trigger eller dokumentasjon: bruker som autoriserte. */
  awardedByUserId?: string;
}

export interface AwardJackpotResult {
  /** Award-rad-id i app_game1_jackpot_awards. */
  awardId: string;
  /** Hall-gruppe. */
  hallGroupId: string;
  /** Beløp i øre som ble debitert fra potten og som skal distribueres til vinner(e). */
  awardedAmountCents: number;
  /** Snapshot av current_amount_cents FØR award. */
  previousAmountCents: number;
  /** Snapshot av current_amount_cents ETTER award (= JACKPOT_DEFAULT_START_CENTS ved vellykket reset). */
  newAmountCents: number;
  /** True når denne kallet ble dedupet — eksisterende rad returnert. */
  idempotent: boolean;
  /** True hvis state hadde 0 saldo og ingen debit skjedde (no-op). */
  noopZeroBalance: boolean;
}

export interface Game1JackpotStateServiceOptions {
  pool: Pool;
  schema?: string;
  /**
   * Override for testing — returnerer dagens dato som 'YYYY-MM-DD'.
   *
   * Default: `Europe/Oslo`-tidssone (LOW-2-fix 2026-04-26). Tidligere brukte
   * dette UTC, som ga 1-2 timers feil-vindu rundt midnatt der en runde
   * over UTC-midnatt akkumulerte på "feil" dag (jackpott +4 000 kr ble
   * tildelt en dato bingoen ikke skulle være på). Norge-tid løser dette
   * uavhengig av sommer-/vintertid.
   */
  todayKey?: () => string;
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
    this.todayKey = options.todayKey ?? todayOsloKey;
  }

  private table(): string {
    return `"${this.schema}"."app_game1_jackpot_state"`;
  }

  private hallGroupsTable(): string {
    return `"${this.schema}"."app_hall_groups"`;
  }

  private hallGroupMembersTable(): string {
    return `"${this.schema}"."app_hall_group_members"`;
  }

  /**
   * K1-A RBAC follow-up: hall-gruppe-medlemskap-sjekk for hall-scope-guard
   * på admin-jackpot-endpoints. Returnerer `true` kun hvis `hallId` er
   * eksplisitt medlem av `hallGroupId` i `app_hall_group_members`. Brukes
   * av `assertJackpotGroupScope` i adminGame1Master-routeren for å hindre
   * at HALL_OPERATOR for hall A leser jackpot-state for en annen gruppe.
   */
  async isHallInGroup(hallId: string, hallGroupId: string): Promise<boolean> {
    if (!hallId || !hallGroupId) return false;
    const { rows } = await this.pool.query<{ exists: boolean }>(
      `SELECT EXISTS(
         SELECT 1 FROM ${this.hallGroupMembersTable()}
          WHERE group_id = $1 AND hall_id = $2
       ) AS exists`,
      [hallGroupId, hallId]
    );
    return rows[0]?.exists === true;
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
   * @deprecated ADR-0017 (2026-05-10) — Daglig jackpot-akkumulering er fjernet.
   *
   * Tobias-direktiv 2026-05-10: "Jackpot-popup gjelder kun for Jackpot-katalog-
   * spillet (pos 7), og bingoverten setter ALLTID jackpot manuelt før spillet
   * starter. Det skal IKKE være automatisk akkumulering."
   *
   * Metoden returnerer no-op-respons uten å skrive til DB. Cron-jobben
   * (jackpotDailyTick) er deaktivert i index.ts samtidig. `app_game1_jackpot_state`-
   * tabellen beholdes for forward-only-policy (ADR-0014) men `current_amount_cents`
   * settes til 0 i PR-D migration så stale lesninger gir 0.
   *
   * `app_game1_jackpot_awards` beholdes som immutable audit-historikk
   * (ADR-0004 hash-chain).
   */
  async accumulateDaily(): Promise<AccumulateDailyResult> {
    log.info(
      {},
      "jackpot.accumulate.no_op_deprecated_per_adr_0017"
    );
    return {
      updatedCount: 0,
      alreadyCurrentCount: 0,
      cappedCount: 0,
      errors: 0,
    };
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

  /**
   * Atomisk award av jackpot-potten — debiterer current_amount_cents,
   * resetter til seed (JACKPOT_DEFAULT_START_CENTS), og logger en rad i
   * app_game1_jackpot_awards. Returnerer beløpet som skal distribueres
   * til vinner(e).
   *
   * Idempotens-modell:
   *   * Caller leverer `idempotencyKey` (anbefalt:
   *     `g1-jackpot-{scheduledGameId}-{drawSequenceAtWin}` for auto-award,
   *     `g1-jackpot-admin-{userId}-{ts}` for manuell admin-award).
   *   * Hvis raden allerede finnes i app_game1_jackpot_awards: returneres
   *     samme awardedAmountCents med `idempotent=true` og state berøres ikke.
   *   * Hele operasjonen gjøres i én transaksjon via en frisk PoolClient.
   *     SELECT ... FOR UPDATE låser state-raden mens vi sjekker og
   *     debiterer — to samtidige kall blir serialisert.
   *
   * Empty-state-handling:
   *   * Hvis state-raden ikke finnes for hall-gruppen → ensureStateExists
   *     opprettes (lazy-init), og award skjer på seed-state. Resultat:
   *     awardedAmountCents = JACKPOT_DEFAULT_START_CENTS, ny saldo = seed.
   *   * Hvis current_amount_cents == 0 (sjelden — kan skje hvis cap=0
   *     eller manuell reset til 0) → no-op award med awardedAmountCents=0
   *     og `noopZeroBalance=true`. Ingen rad i awards-tabellen, ingen
   *     state-endring. Caller kan da hoppe over wallet-credit.
   *
   * Etter award er state.current_amount_cents = JACKPOT_DEFAULT_START_CENTS
   * og last_accumulation_date = today (for å unngå dobbelt-påfyll samme dag
   * fra cron-tick).
   *
   * @throws Error hvis SQL feiler. Hele transaksjonen rulles tilbake.
   */
  async awardJackpot(input: AwardJackpotInput): Promise<AwardJackpotResult> {
    if (!input.hallGroupId || input.hallGroupId.trim().length === 0) {
      throw new Error("awardJackpot: hallGroupId er påkrevd.");
    }
    if (!input.idempotencyKey || input.idempotencyKey.trim().length === 0) {
      throw new Error("awardJackpot: idempotencyKey er påkrevd.");
    }
    if (!input.reason) {
      throw new Error("awardJackpot: reason er påkrevd.");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // 1) Idempotens-sjekk FØR vi tar lock på state-raden — kortere lock-
      //    holdetid i den vanlige no-op-pathen.
      const existing = await client.query<{
        id: string;
        awarded_amount_cents: string | number;
        previous_amount_cents: string | number;
        new_amount_cents: string | number;
      }>(
        `SELECT id, awarded_amount_cents, previous_amount_cents, new_amount_cents
           FROM ${this.awardsTable()}
          WHERE idempotency_key = $1`,
        [input.idempotencyKey]
      );
      if (existing.rows.length > 0) {
        const row = existing.rows[0]!;
        await client.query("COMMIT");
        return {
          awardId: row.id,
          hallGroupId: input.hallGroupId,
          awardedAmountCents: toBigIntCents(row.awarded_amount_cents, 0),
          previousAmountCents: toBigIntCents(row.previous_amount_cents, 0),
          newAmountCents: toBigIntCents(row.new_amount_cents, JACKPOT_DEFAULT_START_CENTS),
          idempotent: true,
          noopZeroBalance: false,
        };
      }

      // 2) Sørg for at state-raden finnes (lazy-init for grupper opprettet
      //    etter migrasjonen). ensureStateExists er ON CONFLICT DO NOTHING,
      //    så den er trygg å kjøre i samme transaksjon.
      await client.query(
        `INSERT INTO ${this.table()}
           (hall_group_id, current_amount_cents, last_accumulation_date,
            max_cap_cents, daily_increment_cents, draw_thresholds_json)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (hall_group_id) DO NOTHING`,
        [
          input.hallGroupId,
          JACKPOT_DEFAULT_START_CENTS,
          this.todayKey(),
          JACKPOT_DEFAULT_MAX_CAP_CENTS,
          JACKPOT_DEFAULT_DAILY_INCREMENT_CENTS,
          JSON.stringify([...JACKPOT_DEFAULT_DRAW_THRESHOLDS]),
        ]
      );

      // 3) Lock state-raden, les nåværende saldo.
      const lockResult = await client.query<{
        current_amount_cents: string | number;
      }>(
        `SELECT current_amount_cents
           FROM ${this.table()}
          WHERE hall_group_id = $1
          FOR UPDATE`,
        [input.hallGroupId]
      );
      if (lockResult.rows.length === 0) {
        // Skal ikke skje pga. ensureStateExists over, men fail-safe.
        await client.query("ROLLBACK");
        throw new Error(
          `awardJackpot: state-rad ble ikke opprettet for hallGroupId=${input.hallGroupId}.`
        );
      }
      const previousAmountCents = toBigIntCents(
        lockResult.rows[0]!.current_amount_cents,
        0
      );

      // 4) No-op-case: 0 saldo (cap=0 eller manuell reset). Returner uten
      //    state-endring og uten audit-rad.
      if (previousAmountCents <= 0) {
        await client.query("COMMIT");
        log.info(
          {
            hallGroupId: input.hallGroupId,
            idempotencyKey: input.idempotencyKey,
            reason: input.reason,
          },
          "jackpot.award.noop_zero_balance"
        );
        return {
          awardId: "",
          hallGroupId: input.hallGroupId,
          awardedAmountCents: 0,
          previousAmountCents: 0,
          newAmountCents: 0,
          idempotent: false,
          noopZeroBalance: true,
        };
      }

      // 5) Atomisk debit + reset. Bruker LEAST(seed, prev) for å håndtere
      //    edge-case der cap < seed (defensivt; pilotscope har cap=30k > seed=2k).
      const newAmountCents = JACKPOT_DEFAULT_START_CENTS;
      await client.query(
        `UPDATE ${this.table()}
            SET current_amount_cents   = $2,
                last_accumulation_date = $3::date,
                updated_at             = now()
          WHERE hall_group_id = $1`,
        [input.hallGroupId, newAmountCents, this.todayKey()]
      );

      // 6) Skriv audit-rad. UNIQUE(idempotency_key) er allerede sjekket
      //    over, men vi bruker fortsatt ON CONFLICT DO NOTHING som
      //    paranoia-guard mot race i parallelle transaksjoner — hvis to
      //    transaksjoner bestod step 1-sjekken samtidig, blir den ene
      //    avvist her og må returnere idempotent.
      const awardId = `g1ja-${randomUUID()}`;
      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO ${this.awardsTable()}
            (id, hall_group_id, idempotency_key, awarded_amount_cents,
             previous_amount_cents, new_amount_cents,
             scheduled_game_id, draw_sequence_at_win, reason, awarded_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [
          awardId,
          input.hallGroupId,
          input.idempotencyKey,
          previousAmountCents,
          previousAmountCents,
          newAmountCents,
          input.scheduledGameId ?? null,
          input.drawSequenceAtWin ?? null,
          input.reason,
          input.awardedByUserId ?? null,
        ]
      );

      if (insertResult.rowCount === 0) {
        // Lost the race: en annen transaksjon committed mellom step 1 og 6.
        // Rull tilbake state-endringen og returner den eksisterende awarden.
        await client.query("ROLLBACK");
        return await this.fetchExistingAwardForKey(input);
      }

      await client.query("COMMIT");
      log.info(
        {
          hallGroupId: input.hallGroupId,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          awardedAmountCents: previousAmountCents,
          previousAmountCents,
          newAmountCents,
        },
        "jackpot.award.success"
      );
      return {
        awardId,
        hallGroupId: input.hallGroupId,
        awardedAmountCents: previousAmountCents,
        previousAmountCents,
        newAmountCents,
        idempotent: false,
        noopZeroBalance: false,
      };
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // best-effort
      }
      log.error(
        { err, hallGroupId: input.hallGroupId, idempotencyKey: input.idempotencyKey },
        "jackpot.award.failed"
      );
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Hent siste N awards for en hall-gruppe (admin-UI / audit). Sortert
   * synkende på awarded_at. Default limit 50.
   */
  async listAwards(hallGroupId: string, limit = 50): Promise<Array<{
    awardId: string;
    hallGroupId: string;
    awardedAmountCents: number;
    previousAmountCents: number;
    newAmountCents: number;
    scheduledGameId: string | null;
    drawSequenceAtWin: number | null;
    reason: string | null;
    awardedByUserId: string | null;
    awardedAt: string;
  }>> {
    const safeLimit = Math.min(500, Math.max(1, Math.floor(limit)));
    const { rows } = await this.pool.query<{
      id: string;
      hall_group_id: string;
      awarded_amount_cents: string | number;
      previous_amount_cents: string | number;
      new_amount_cents: string | number;
      scheduled_game_id: string | null;
      draw_sequence_at_win: number | null;
      reason: string | null;
      awarded_by_user_id: string | null;
      awarded_at: Date | string;
    }>(
      `SELECT id, hall_group_id, awarded_amount_cents, previous_amount_cents,
              new_amount_cents, scheduled_game_id, draw_sequence_at_win,
              reason, awarded_by_user_id, awarded_at
         FROM ${this.awardsTable()}
        WHERE hall_group_id = $1
        ORDER BY awarded_at DESC
        LIMIT $2`,
      [hallGroupId, safeLimit]
    );
    return rows.map((row) => ({
      awardId: row.id,
      hallGroupId: row.hall_group_id,
      awardedAmountCents: toBigIntCents(row.awarded_amount_cents, 0),
      previousAmountCents: toBigIntCents(row.previous_amount_cents, 0),
      newAmountCents: toBigIntCents(row.new_amount_cents, 0),
      scheduledGameId: row.scheduled_game_id,
      drawSequenceAtWin: row.draw_sequence_at_win,
      reason: row.reason,
      awardedByUserId: row.awarded_by_user_id,
      awardedAt: row.awarded_at instanceof Date ? row.awarded_at.toISOString() : String(row.awarded_at ?? ""),
    }));
  }

  /**
   * Returnerer awards-tabell-navn (med schema-prefiks).
   * Eksposert som metode (ikke private) av samme grunn som table().
   */
  private awardsTable(): string {
    return `"${this.schema}"."app_game1_jackpot_awards"`;
  }

  /**
   * Henter en eksisterende award via idempotency-key. Brukes som race-
   * fallback inne i awardJackpot etter at INSERT taper en konflikt.
   */
  private async fetchExistingAwardForKey(
    input: AwardJackpotInput
  ): Promise<AwardJackpotResult> {
    const { rows } = await this.pool.query<{
      id: string;
      awarded_amount_cents: string | number;
      previous_amount_cents: string | number;
      new_amount_cents: string | number;
    }>(
      `SELECT id, awarded_amount_cents, previous_amount_cents, new_amount_cents
         FROM ${this.awardsTable()}
        WHERE idempotency_key = $1`,
      [input.idempotencyKey]
    );
    if (rows.length === 0) {
      // Skal ikke skje — race-fallbacken kalles kun når INSERT mistet
      // konflikten, så raden MÅ finnes. Defensivt:
      throw new Error(
        `awardJackpot: race-fallback fant ikke rad for key=${input.idempotencyKey}`
      );
    }
    const row = rows[0]!;
    return {
      awardId: row.id,
      hallGroupId: input.hallGroupId,
      awardedAmountCents: toBigIntCents(row.awarded_amount_cents, 0),
      previousAmountCents: toBigIntCents(row.previous_amount_cents, 0),
      newAmountCents: toBigIntCents(row.new_amount_cents, JACKPOT_DEFAULT_START_CENTS),
      idempotent: true,
      noopZeroBalance: false,
    };
  }
}
