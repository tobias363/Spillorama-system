/**
 * PR-T1 Spor 4: Game1PotService — rammeverk for akkumulerende pot-er.
 *
 * Bakgrunn:
 *   Spor 4 dekker pot-er som lever MELLOM Spill 1-økter ("Jackpott",
 *   "Innsatsen"). De bygger seg opp via:
 *     * daglig boost (idempotent per UTC-dato)
 *     * andel av billettsalg (basispoeng av total-beløp)
 *   og utbetales når en gyldig vinn-betingelse inntreffer (phase + draw-
 *   threshold). Ved utløsning resettes pot til `seedAmountCents`.
 *
 *   Denne service-en er DISTINKT fra Game1JackpotService (som håndterer
 *   per-spill fixed-amount Fullt Hus-jackpot per farge) — de to skal leve
 *   i parallell, hver med egen persistens og egne regler.
 *
 * Spec-kilde:
 *   PM-brief PR-T1 "Pot-service-framework (Spor 4 fundament)", 2026-04-22.
 *
 * Persistens:
 *   - app_game1_accumulating_pots: én rad per (hall_id, pot_key).
 *   - app_game1_pot_events: append-only audit-log for alle pot-endringer.
 *   Se migrasjon 20260611000000_game1_accumulating_pots.sql for skjema.
 *
 * Design-prinsipper:
 *   - Fail-closed validering (DomainError — alle feil er 400 i API-laget).
 *   - Alle akkumuleringer og wins skriver event-rad i samme transaksjon som
 *     balanse-oppdateringen — pot_events kan ALDRI havne ut av sync.
 *   - Cap-enforcement: pot kan aldri overstige `maxAmountCents` hvis satt.
 *   - Daglig-boost er idempotent via `last_daily_boost_date` — samme UTC-
 *     dato triggerer ikke dobbel akkumulering.
 *   - WinRule sjekkes strengt (fail-closed): phase må matche, drawSequence
 *     må være PÅ eller FØR threshold, og ticket-color må være i `ticketColors`
 *     (eller listen er tom = alle farger tillatt).
 *
 * Ikke-ansvar (holdes utenfor T1):
 *   - Admin-UI (kommer i oppfølgings-PR T1b)
 *   - Socket-broadcast av pot-saldo til spiller-UI
 *   - Integrasjon i Game1TicketPurchaseService/DrawEngine — T1 leverer kun
 *     service-API + persistens, kalles inn fra eksisterende flyter i senere PR.
 */

import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { DomainError } from "../BingoEngine.js";
import { logger as rootLogger } from "../../util/logger.js";

const log = rootLogger.child({ module: "game1-pot-service" });

// ── Public types ────────────────────────────────────────────────────────────

export type PotEventKind =
  | "init"
  | "daily"
  | "sale"
  | "win"
  | "reset"
  | "config";

/**
 * Regel for når en pot utbetales. T1 støtter én variant:
 *   "phase_at_or_before_draw" — phase må matche OG draw-sekvens må være
 *   på eller før threshold.
 */
export interface PotWinRulePhaseAtOrBeforeDraw {
  kind: "phase_at_or_before_draw";
  /** Hvilken fase (1..5). 5 = Fullt Hus. */
  phase: number;
  /** Maks draw-sekvens (inklusiv) for at vinn skal trigge pot. */
  drawThreshold: number;
}

export type PotWinRule = PotWinRulePhaseAtOrBeforeDraw;

export interface PotConfig {
  /** Reset-sokkel i øre — saldo etter reset/init. */
  seedAmountCents: number;
  /** Daglig auto-påfyll i øre. 0 = av. */
  dailyBoostCents: number;
  /** Andel av billettsalg i basispoeng (0..10000 = 0..100%). */
  salePercentBps: number;
  /** Tak på pot-saldo i øre. null = ingen cap. */
  maxAmountCents: number | null;
  /** Når pot-en utbetales. */
  winRule: PotWinRule;
  /**
   * Tillatt ticket-color for vinn. Tom liste = alle farger.
   * Case-insensitiv sammenligning.
   */
  ticketColors: string[];
}

export interface PotRow {
  id: string;
  hallId: string;
  potKey: string;
  displayName: string;
  currentAmountCents: number;
  config: PotConfig;
  lastDailyBoostDate: string | null;
  lastResetAt: string | null;
  lastResetReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GetOrInitPotInput {
  hallId: string;
  potKey: string;
  displayName: string;
  /** Brukes kun når pot opprettes. Eksisterende pot endres IKKE her — bruk updateConfig. */
  config: PotConfig;
}

export interface AccumulateDailyInput {
  hallId: string;
  potKey: string;
  /** UTC-dato på formatet "YYYY-MM-DD". Forhindrer dobbel boost samme dag. */
  dateUtc: string;
}

export interface AccumulateDailyResult {
  /** true hvis boost ble applisert; false hvis allerede applisert samme dag eller boost=0. */
  applied: boolean;
  boostCents: number;
  newBalanceCents: number;
  eventId: string | null;
}

export interface AccumulateFromSaleInput {
  hallId: string;
  potKey: string;
  /** Total-salg for kjøpet i øre (før kombinasjons-rabatter). */
  ticketTotalCents: number;
  /** Valgfri kobling til scheduled-game for audit. */
  scheduledGameId?: string;
  /** Valgfri kobling til ticket-purchase for audit. */
  ticketPurchaseId?: string;
}

export interface AccumulateFromSaleResult {
  /** Faktisk akkumulert (0 hvis salePercentBps=0 eller cap nådd). */
  appliedCents: number;
  newBalanceCents: number;
  eventId: string | null;
}

export interface TryWinInput {
  hallId: string;
  potKey: string;
  /** Fasen som ble vunnet (1..5). */
  phase: number;
  /** Draw-sekvens da vinnet ble detektert (1..75). */
  drawSequenceAtWin: number;
  /** Ticket-color som vant. Brukes mot config.ticketColors. */
  ticketColor: string;
  /** Vinner-user-id for audit. */
  winnerUserId: string;
  /** Scheduled-game som utløste vinnet. */
  scheduledGameId: string;
}

export interface TryWinResult {
  triggered: boolean;
  /** Utbetalt beløp i øre (pot-saldo før reset). 0 hvis !triggered. */
  amountCents: number;
  /** Hvorfor ikke utløst (null hvis triggered). */
  reasonCode:
    | null
    | "POT_NOT_FOUND"
    | "WRONG_PHASE"
    | "DRAW_AFTER_THRESHOLD"
    | "COLOR_NOT_ALLOWED"
    | "POT_EMPTY";
  eventId: string | null;
}

export interface ResetPotInput {
  hallId: string;
  potKey: string;
  reason: string;
  actorUserId?: string;
}

export interface ResetPotResult {
  newBalanceCents: number;
  eventId: string;
}

export interface UpdateConfigInput {
  hallId: string;
  potKey: string;
  config: PotConfig;
}

export interface Game1PotServiceOptions {
  pool: Pool;
  schema?: string;
}

// ── Internal row shape ──────────────────────────────────────────────────────

interface PotDbRow {
  id: string;
  hall_id: string;
  pot_key: string;
  display_name: string;
  current_amount_cents: string | number;
  config_json: unknown;
  last_daily_boost_date: string | null;
  last_reset_at: Date | string | null;
  last_reset_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

// ── Service ─────────────────────────────────────────────────────────────────

export class Game1PotService {
  private readonly pool: Pool;
  private readonly schema: string;

  constructor(options: Game1PotServiceOptions) {
    if (!options?.pool) {
      throw new DomainError("INVALID_CONFIG", "pool mangler.");
    }
    this.pool = options.pool;
    const schema = (options.schema ?? "public").trim();
    if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
      throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
    }
    this.schema = schema;
  }

  // ── Table helpers ────────────────────────────────────────────────────────

  private potsTable(): string {
    return `"${this.schema}"."app_game1_accumulating_pots"`;
  }

  private eventsTable(): string {
    return `"${this.schema}"."app_game1_pot_events"`;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Henter pot for (hallId, potKey). Hvis ingen finnes, oppretter den med
   * gitt config og seedAmountCents som start-saldo. En "init"-event skrives.
   *
   * Idempotent: flere kall med samme (hallId, potKey) returnerer samme pot;
   * config oppdateres IKKE hvis pot allerede finnes.
   */
  async getOrInitPot(input: GetOrInitPotInput): Promise<PotRow> {
    this.validateHallAndKey(input.hallId, input.potKey);
    this.validateDisplayName(input.displayName);
    validatePotConfig(input.config);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Finn eksisterende (FOR UPDATE for å holde trygg race-free init).
      const existing = await this.loadPotForUpdate(client, input.hallId, input.potKey);
      if (existing) {
        await client.query("COMMIT");
        return existing;
      }

      // Opprett ny pot.
      const id = randomUUID();
      const seed = input.config.seedAmountCents;
      await client.query(
        `INSERT INTO ${this.potsTable()}
           (id, hall_id, pot_key, display_name, current_amount_cents, config_json)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
        [
          id,
          input.hallId,
          input.potKey,
          input.displayName,
          seed,
          JSON.stringify(input.config),
        ]
      );

      const eventId = await this.insertEvent(client, {
        potId: id,
        hallId: input.hallId,
        eventKind: "init",
        deltaCents: seed,
        balanceAfterCents: seed,
        configSnapshot: input.config,
        reason: "pot_created",
      });

      await client.query("COMMIT");
      log.info(
        { hallId: input.hallId, potKey: input.potKey, potId: id, seedCents: seed, eventId },
        "T1: pot initialisert"
      );

      const row = await this.loadPot(input.hallId, input.potKey);
      if (!row) {
        // Teoretisk umulig — vi committet nettopp.
        throw new DomainError("POT_NOT_FOUND", "Pot forsvant etter insert.");
      }
      return row;
    } catch (err) {
      await safeRollback(client);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Applisér daglig boost for pot. Idempotent per UTC-dato: hvis
   * `last_daily_boost_date == dateUtc` → ingen effekt.
   *
   * Returnerer `applied: false` også hvis `config.dailyBoostCents === 0`.
   */
  async accumulateDaily(input: AccumulateDailyInput): Promise<AccumulateDailyResult> {
    this.validateHallAndKey(input.hallId, input.potKey);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateUtc)) {
      throw new DomainError("INVALID_DATE", "dateUtc må være på formatet YYYY-MM-DD.");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const pot = await this.loadPotForUpdate(client, input.hallId, input.potKey);
      if (!pot) {
        await client.query("ROLLBACK");
        throw new DomainError("POT_NOT_FOUND", `Pot ikke funnet (${input.hallId}, ${input.potKey}).`);
      }

      // Idempotens-sjekk.
      if (pot.lastDailyBoostDate === input.dateUtc) {
        await client.query("COMMIT");
        return {
          applied: false,
          boostCents: 0,
          newBalanceCents: pot.currentAmountCents,
          eventId: null,
        };
      }

      const boost = Math.floor(pot.config.dailyBoostCents);
      if (boost <= 0) {
        // Oppdater last_daily_boost_date uansett slik at senere dager
        // ikke prøver igjen — men ikke skriv event.
        await client.query(
          `UPDATE ${this.potsTable()}
              SET last_daily_boost_date = $1, updated_at = now()
            WHERE id = $2`,
          [input.dateUtc, pot.id]
        );
        await client.query("COMMIT");
        return {
          applied: false,
          boostCents: 0,
          newBalanceCents: pot.currentAmountCents,
          eventId: null,
        };
      }

      const { appliedCents, newBalance } = computeCappedAdd(
        pot.currentAmountCents,
        boost,
        pot.config.maxAmountCents
      );

      await client.query(
        `UPDATE ${this.potsTable()}
            SET current_amount_cents = $1,
                last_daily_boost_date = $2,
                updated_at = now()
          WHERE id = $3`,
        [newBalance, input.dateUtc, pot.id]
      );

      const eventId = await this.insertEvent(client, {
        potId: pot.id,
        hallId: pot.hallId,
        eventKind: "daily",
        deltaCents: appliedCents,
        balanceAfterCents: newBalance,
        configSnapshot: pot.config,
        reason: `daily_boost:${input.dateUtc}`,
      });

      await client.query("COMMIT");
      return {
        applied: appliedCents > 0,
        boostCents: appliedCents,
        newBalanceCents: newBalance,
        eventId,
      };
    } catch (err) {
      await safeRollback(client);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Akkumulér andel av billettsalg. Andelen beregnes av
   * `ticketTotalCents * salePercentBps / 10000` og rundes ned til hele øre.
   * Cap-enforcement via maxAmountCents.
   *
   * Hvis salePercentBps=0 eller beregnet andel er 0 → ingen event, ingen UPDATE.
   */
  async accumulateFromSale(input: AccumulateFromSaleInput): Promise<AccumulateFromSaleResult> {
    this.validateHallAndKey(input.hallId, input.potKey);
    if (!Number.isFinite(input.ticketTotalCents) || input.ticketTotalCents < 0) {
      throw new DomainError(
        "INVALID_AMOUNT",
        "ticketTotalCents må være et ikke-negativt tall."
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const pot = await this.loadPotForUpdate(client, input.hallId, input.potKey);
      if (!pot) {
        await client.query("ROLLBACK");
        throw new DomainError("POT_NOT_FOUND", `Pot ikke funnet (${input.hallId}, ${input.potKey}).`);
      }

      const bps = pot.config.salePercentBps;
      const rawShare = Math.floor((input.ticketTotalCents * bps) / 10000);
      if (rawShare <= 0) {
        await client.query("COMMIT");
        return {
          appliedCents: 0,
          newBalanceCents: pot.currentAmountCents,
          eventId: null,
        };
      }

      const { appliedCents, newBalance } = computeCappedAdd(
        pot.currentAmountCents,
        rawShare,
        pot.config.maxAmountCents
      );
      if (appliedCents <= 0) {
        await client.query("COMMIT");
        return {
          appliedCents: 0,
          newBalanceCents: pot.currentAmountCents,
          eventId: null,
        };
      }

      await client.query(
        `UPDATE ${this.potsTable()}
            SET current_amount_cents = $1, updated_at = now()
          WHERE id = $2`,
        [newBalance, pot.id]
      );

      const eventId = await this.insertEvent(client, {
        potId: pot.id,
        hallId: pot.hallId,
        eventKind: "sale",
        deltaCents: appliedCents,
        balanceAfterCents: newBalance,
        scheduledGameId: input.scheduledGameId ?? null,
        ticketPurchaseId: input.ticketPurchaseId ?? null,
        configSnapshot: pot.config,
        reason: "sale_share",
      });

      await client.query("COMMIT");
      return {
        appliedCents,
        newBalanceCents: newBalance,
        eventId,
      };
    } catch (err) {
      await safeRollback(client);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Forsøk å utløse pot-vinn. Evaluerer winRule, og hvis matchende:
   *   1) skriver "win"-event med amountCents = pot-saldo FØR reset
   *   2) resetter saldo til seedAmountCents
   *
   * Returnerer detaljert reason-kode hvis ikke utløst — caller kan
   * velge å logge/varsle.
   */
  async tryWin(input: TryWinInput): Promise<TryWinResult> {
    this.validateHallAndKey(input.hallId, input.potKey);
    if (!Number.isInteger(input.phase) || input.phase < 1 || input.phase > 5) {
      throw new DomainError("INVALID_PHASE", "phase må være 1..5.");
    }
    if (
      !Number.isFinite(input.drawSequenceAtWin) ||
      input.drawSequenceAtWin < 1 ||
      input.drawSequenceAtWin > 75
    ) {
      throw new DomainError("INVALID_DRAW", "drawSequenceAtWin må være 1..75.");
    }
    if (!input.ticketColor || typeof input.ticketColor !== "string") {
      throw new DomainError("INVALID_COLOR", "ticketColor mangler.");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const pot = await this.loadPotForUpdate(client, input.hallId, input.potKey);
      if (!pot) {
        await client.query("ROLLBACK");
        return {
          triggered: false,
          amountCents: 0,
          reasonCode: "POT_NOT_FOUND",
          eventId: null,
        };
      }

      const rule = pot.config.winRule;
      if (rule.phase !== input.phase) {
        await client.query("COMMIT");
        return {
          triggered: false,
          amountCents: 0,
          reasonCode: "WRONG_PHASE",
          eventId: null,
        };
      }
      if (input.drawSequenceAtWin > rule.drawThreshold) {
        await client.query("COMMIT");
        return {
          triggered: false,
          amountCents: 0,
          reasonCode: "DRAW_AFTER_THRESHOLD",
          eventId: null,
        };
      }
      if (!isTicketColorAllowed(input.ticketColor, pot.config.ticketColors)) {
        await client.query("COMMIT");
        return {
          triggered: false,
          amountCents: 0,
          reasonCode: "COLOR_NOT_ALLOWED",
          eventId: null,
        };
      }

      const payout = pot.currentAmountCents;
      if (payout <= 0) {
        await client.query("COMMIT");
        return {
          triggered: false,
          amountCents: 0,
          reasonCode: "POT_EMPTY",
          eventId: null,
        };
      }

      const seed = pot.config.seedAmountCents;
      await client.query(
        `UPDATE ${this.potsTable()}
            SET current_amount_cents = $1,
                last_reset_at = now(),
                last_reset_reason = $2,
                updated_at = now()
          WHERE id = $3`,
        [seed, `win:phase=${input.phase},draw=${input.drawSequenceAtWin}`, pot.id]
      );

      const eventId = await this.insertEvent(client, {
        potId: pot.id,
        hallId: pot.hallId,
        eventKind: "win",
        // delta er NEGATIV for win (saldo minker fra payout til seed).
        deltaCents: seed - payout,
        balanceAfterCents: seed,
        scheduledGameId: input.scheduledGameId,
        winnerUserId: input.winnerUserId,
        winnerTicketColor: input.ticketColor,
        configSnapshot: pot.config,
        reason: `win_paid_cents:${payout}`,
      });

      await client.query("COMMIT");
      log.info(
        {
          hallId: pot.hallId,
          potKey: pot.potKey,
          winnerUserId: input.winnerUserId,
          amountCents: payout,
          eventId,
        },
        "T1: pot utløst"
      );
      return {
        triggered: true,
        amountCents: payout,
        reasonCode: null,
        eventId,
      };
    } catch (err) {
      await safeRollback(client);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Admin-override: resett pot til seed UTEN at noen har vunnet. Skriver
   * "reset"-event. Brukes for manuell rydding eller konfig-retting.
   */
  async resetPot(input: ResetPotInput): Promise<ResetPotResult> {
    this.validateHallAndKey(input.hallId, input.potKey);
    if (!input.reason || typeof input.reason !== "string") {
      throw new DomainError("INVALID_REASON", "reason må være en ikke-tom streng.");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const pot = await this.loadPotForUpdate(client, input.hallId, input.potKey);
      if (!pot) {
        await client.query("ROLLBACK");
        throw new DomainError("POT_NOT_FOUND", `Pot ikke funnet (${input.hallId}, ${input.potKey}).`);
      }

      const seed = pot.config.seedAmountCents;
      const prev = pot.currentAmountCents;

      await client.query(
        `UPDATE ${this.potsTable()}
            SET current_amount_cents = $1,
                last_reset_at = now(),
                last_reset_reason = $2,
                updated_at = now()
          WHERE id = $3`,
        [seed, input.reason, pot.id]
      );

      const eventId = await this.insertEvent(client, {
        potId: pot.id,
        hallId: pot.hallId,
        eventKind: "reset",
        deltaCents: seed - prev,
        balanceAfterCents: seed,
        winnerUserId: input.actorUserId ?? null,
        configSnapshot: pot.config,
        reason: input.reason,
      });

      await client.query("COMMIT");
      return { newBalanceCents: seed, eventId };
    } catch (err) {
      await safeRollback(client);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Oppdater pot-config uten å endre saldo. Skriver "config"-event med
   * delta=0 og config_snapshot = NY config.
   *
   * Hvis `maxAmountCents` senkes under nåværende saldo clamper IKKE
   * service automatisk — saldo får stå (for at avgått akkumulering ikke
   * skal 'tapes' uten vinn). Admin kan kjøre resetPot eksplisitt hvis
   * ønsket.
   */
  async updateConfig(input: UpdateConfigInput): Promise<PotRow> {
    this.validateHallAndKey(input.hallId, input.potKey);
    validatePotConfig(input.config);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const pot = await this.loadPotForUpdate(client, input.hallId, input.potKey);
      if (!pot) {
        await client.query("ROLLBACK");
        throw new DomainError("POT_NOT_FOUND", `Pot ikke funnet (${input.hallId}, ${input.potKey}).`);
      }

      await client.query(
        `UPDATE ${this.potsTable()}
            SET config_json = $1::jsonb, updated_at = now()
          WHERE id = $2`,
        [JSON.stringify(input.config), pot.id]
      );

      await this.insertEvent(client, {
        potId: pot.id,
        hallId: pot.hallId,
        eventKind: "config",
        deltaCents: 0,
        balanceAfterCents: pot.currentAmountCents,
        configSnapshot: input.config,
        reason: "config_update",
      });

      await client.query("COMMIT");
      const updated = await this.loadPot(input.hallId, input.potKey);
      if (!updated) {
        throw new DomainError("POT_NOT_FOUND", "Pot forsvant etter update.");
      }
      return updated;
    } catch (err) {
      await safeRollback(client);
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Read helpers ─────────────────────────────────────────────────────────

  /** Hent pot uten FOR UPDATE — les-kun. Returnerer null hvis ikke funnet. */
  async loadPot(hallId: string, potKey: string): Promise<PotRow | null> {
    const result = await this.pool.query<PotDbRow>(
      `SELECT * FROM ${this.potsTable()}
        WHERE hall_id = $1 AND pot_key = $2`,
      [hallId, potKey]
    );
    if (result.rows.length === 0) return null;
    return hydratePotRow(result.rows[0]!);
  }

  /** Liste alle pot-er for en hall. */
  async listPotsForHall(hallId: string): Promise<PotRow[]> {
    const result = await this.pool.query<PotDbRow>(
      `SELECT * FROM ${this.potsTable()}
        WHERE hall_id = $1
        ORDER BY pot_key ASC`,
      [hallId]
    );
    return result.rows.map(hydratePotRow);
  }

  // ── Internal helpers ─────────────────────────────────────────────────────

  private async loadPotForUpdate(
    client: PoolClient,
    hallId: string,
    potKey: string
  ): Promise<PotRow | null> {
    const res = await client.query<PotDbRow>(
      `SELECT * FROM ${this.potsTable()}
        WHERE hall_id = $1 AND pot_key = $2
          FOR UPDATE`,
      [hallId, potKey]
    );
    if (res.rows.length === 0) return null;
    return hydratePotRow(res.rows[0]!);
  }

  private async insertEvent(
    client: PoolClient,
    event: {
      potId: string;
      hallId: string;
      eventKind: PotEventKind;
      deltaCents: number;
      balanceAfterCents: number;
      scheduledGameId?: string | null;
      ticketPurchaseId?: string | null;
      winnerUserId?: string | null;
      winnerTicketColor?: string | null;
      configSnapshot: PotConfig;
      reason: string | null;
    }
  ): Promise<string> {
    const id = randomUUID();
    await client.query(
      `INSERT INTO ${this.eventsTable()}
         (id, pot_id, hall_id, event_kind, delta_cents, balance_after_cents,
          scheduled_game_id, ticket_purchase_id, winner_user_id,
          winner_ticket_color, reason, config_snapshot_json)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
      [
        id,
        event.potId,
        event.hallId,
        event.eventKind,
        event.deltaCents,
        event.balanceAfterCents,
        event.scheduledGameId ?? null,
        event.ticketPurchaseId ?? null,
        event.winnerUserId ?? null,
        event.winnerTicketColor ?? null,
        event.reason ?? null,
        JSON.stringify(event.configSnapshot),
      ]
    );
    return id;
  }

  // ── Validation ──────────────────────────────────────────────────────────

  private validateHallAndKey(hallId: string, potKey: string): void {
    if (!hallId || typeof hallId !== "string") {
      throw new DomainError("INVALID_HALL", "hallId mangler.");
    }
    if (!potKey || typeof potKey !== "string") {
      throw new DomainError("INVALID_POT_KEY", "potKey mangler.");
    }
    if (potKey.length > 64) {
      throw new DomainError("INVALID_POT_KEY", "potKey er for lang (> 64 tegn).");
    }
  }

  private validateDisplayName(name: string): void {
    if (!name || typeof name !== "string") {
      throw new DomainError("INVALID_DISPLAY_NAME", "displayName mangler.");
    }
    if (name.length > 128) {
      throw new DomainError("INVALID_DISPLAY_NAME", "displayName er for lang (> 128 tegn).");
    }
  }
}

// ── Pure helpers (eksportert for test) ──────────────────────────────────────

/**
 * Validér pot-config fail-closed. Alle feil kastes som DomainError med
 * INVALID_CONFIG + spesifikk melding.
 */
export function validatePotConfig(config: PotConfig): void {
  if (!config || typeof config !== "object") {
    throw new DomainError("INVALID_CONFIG", "config mangler.");
  }
  if (!Number.isFinite(config.seedAmountCents) || config.seedAmountCents < 0) {
    throw new DomainError("INVALID_CONFIG", "seedAmountCents må være >= 0.");
  }
  if (!Number.isFinite(config.dailyBoostCents) || config.dailyBoostCents < 0) {
    throw new DomainError("INVALID_CONFIG", "dailyBoostCents må være >= 0.");
  }
  if (
    !Number.isFinite(config.salePercentBps) ||
    config.salePercentBps < 0 ||
    config.salePercentBps > 10000
  ) {
    throw new DomainError(
      "INVALID_CONFIG",
      "salePercentBps må være 0..10000 (basispoeng)."
    );
  }
  if (config.maxAmountCents !== null) {
    if (
      !Number.isFinite(config.maxAmountCents) ||
      config.maxAmountCents <= 0 ||
      config.maxAmountCents < config.seedAmountCents
    ) {
      throw new DomainError(
        "INVALID_CONFIG",
        "maxAmountCents må være null eller et positivt tall >= seedAmountCents."
      );
    }
  }
  if (!config.winRule || config.winRule.kind !== "phase_at_or_before_draw") {
    throw new DomainError(
      "INVALID_CONFIG",
      "winRule.kind må være 'phase_at_or_before_draw' (T1 støtter kun denne varianten)."
    );
  }
  if (
    !Number.isInteger(config.winRule.phase) ||
    config.winRule.phase < 1 ||
    config.winRule.phase > 5
  ) {
    throw new DomainError("INVALID_CONFIG", "winRule.phase må være 1..5.");
  }
  if (
    !Number.isInteger(config.winRule.drawThreshold) ||
    config.winRule.drawThreshold < 1 ||
    config.winRule.drawThreshold > 75
  ) {
    throw new DomainError(
      "INVALID_CONFIG",
      "winRule.drawThreshold må være 1..75."
    );
  }
  if (!Array.isArray(config.ticketColors)) {
    throw new DomainError(
      "INVALID_CONFIG",
      "ticketColors må være en array (tom liste = alle farger)."
    );
  }
  for (const c of config.ticketColors) {
    if (typeof c !== "string" || c.trim().length === 0) {
      throw new DomainError(
        "INVALID_CONFIG",
        "ticketColors må inneholde ikke-tomme strenger."
      );
    }
  }
}

/**
 * Beregn addisjon med cap. Returnerer faktisk applisert og ny balanse.
 * Hvis maxAmountCents er satt og current allerede >= max → appliedCents=0.
 */
export function computeCappedAdd(
  currentCents: number,
  deltaCents: number,
  maxAmountCents: number | null
): { appliedCents: number; newBalance: number } {
  if (deltaCents <= 0) return { appliedCents: 0, newBalance: currentCents };
  if (maxAmountCents === null) {
    return { appliedCents: deltaCents, newBalance: currentCents + deltaCents };
  }
  if (currentCents >= maxAmountCents) {
    return { appliedCents: 0, newBalance: currentCents };
  }
  const room = maxAmountCents - currentCents;
  const applied = Math.min(deltaCents, room);
  return { appliedCents: applied, newBalance: currentCents + applied };
}

/**
 * Case-insensitiv sjekk. Tom liste = alle farger tillatt (fail-open for liste,
 * men resten av win-regelen er fortsatt fail-closed).
 */
export function isTicketColorAllowed(
  ticketColor: string,
  allowed: string[]
): boolean {
  if (!Array.isArray(allowed) || allowed.length === 0) return true;
  const lc = ticketColor.toLowerCase().trim();
  return allowed.some((c) => c.toLowerCase().trim() === lc);
}

function hydratePotRow(row: PotDbRow): PotRow {
  const cfg =
    typeof row.config_json === "string"
      ? (JSON.parse(row.config_json) as PotConfig)
      : (row.config_json as PotConfig);
  return {
    id: row.id,
    hallId: row.hall_id,
    potKey: row.pot_key,
    displayName: row.display_name,
    currentAmountCents: Number(row.current_amount_cents),
    config: cfg,
    lastDailyBoostDate: row.last_daily_boost_date,
    lastResetAt:
      row.last_reset_at === null
        ? null
        : typeof row.last_reset_at === "string"
          ? row.last_reset_at
          : row.last_reset_at.toISOString(),
    lastResetReason: row.last_reset_reason,
    createdAt:
      typeof row.created_at === "string"
        ? row.created_at
        : row.created_at.toISOString(),
    updatedAt:
      typeof row.updated_at === "string"
        ? row.updated_at
        : row.updated_at.toISOString(),
  };
}

async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch (err) {
    log.warn({ err }, "T1: ROLLBACK feilet — pool release cleanes opp");
  }
}
