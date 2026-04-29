/**
 * BIN-700: Loyalty-system — admin-CRUD for tiers + per-spiller aggregat-state
 * + event-log.
 *
 * Vi implementerer et tier-basert system med spiller-aggregat, events, og
 * hooks for framtidig automatic assignment (utvider den historiske enkle
 * navn/points-lista).
 *
 * Scope i denne PR-en:
 *   - Tier-CRUD (list/detail/create/update/delete, soft-delete default)
 *   - Player-state getters (lifetime/month points + current tier)
 *   - Manuell points-award (admin-tildeling, skaper event + oppdaterer state)
 *   - Manuell tier-override (admin låser tier manuelt, bypass automatic)
 *   - Monthly-reset (brukes av JobScheduler for å nullstille month_points)
 *   - Auto tier-recalculation basert på lifetime_points vs min_points-bånd
 *     (kun for player-states uten tier_locked)
 *
 * Out-of-scope:
 *   - Automatisk points-award fra spill-aktivitet (ticket-kjøp, session-deltakelse,
 *     milepæler) — krever integrasjon i BingoEngine som er en egen follow-up.
 *   - Rapporter / eksport av loyalty-events.
 *
 * Gjenbruk:
 *   - Samme mønster som LeaderboardTierService (BIN-668), GameTypeService
 *     (BIN-620). Object.create test-hook, idempotent ensureInitialized,
 *     soft-delete default.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import { getPoolTuning } from "../util/pgPool.js";
import { logger as rootLogger } from "../util/logger.js";
import type {
  LoyaltyTier,
  CreateLoyaltyTierInput,
  UpdateLoyaltyTierInput,
  ListLoyaltyTierFilter,
  LoyaltyPlayerState,
  AwardLoyaltyPointsInput,
  AwardLoyaltyActivityInput,
  OverrideLoyaltyTierInput,
  LoyaltyEvent,
  AwardResult,
  MonthlyResetResult,
  LoyaltyServiceOptions,
  LoyaltyTierRow,
  LoyaltyPlayerStateRow,
  LoyaltyEventRow,
} from "./LoyaltyTypes.js";
import {
  assertSchemaName,
  assertNonEmptyString,
  assertPositiveInt,
  assertNonNegativeInt,
  assertIntOrNull,
  assertInteger,
  assertObject,
  monthKeyFromDate,
  isUniqueViolation,
} from "./LoyaltyValidators.js";
import { initializeLoyaltySchema } from "./LoyaltySchema.js";
import {
  mapTierRow,
  mapStateRow,
  mapEventRow,
} from "./LoyaltyMappers.js";

// Re-export for backward-compat (eksisterende imports fra denne modulen).
export type {
  LoyaltyTier,
  CreateLoyaltyTierInput,
  UpdateLoyaltyTierInput,
  ListLoyaltyTierFilter,
  LoyaltyPlayerState,
  AwardLoyaltyPointsInput,
  AwardLoyaltyActivityInput,
  OverrideLoyaltyTierInput,
  LoyaltyEvent,
  AwardResult,
  MonthlyResetResult,
  LoyaltyServiceOptions,
} from "./LoyaltyTypes.js";

const logger = rootLogger.child({ module: "loyalty-service" });

// ── Service ────────────────────────────────────────────────────────────────

export class LoyaltyService {
  private readonly pool: Pool;
  private readonly schema: string;
  private initPromise: Promise<void> | null = null;

  constructor(options: LoyaltyServiceOptions) {
    this.schema = assertSchemaName(options.schema ?? "public");
    if (options.pool) {
      this.pool = options.pool;
    } else if (options.connectionString && options.connectionString.trim()) {
      this.pool = new Pool({
        connectionString: options.connectionString,
        ...getPoolTuning(),
      });
    } else {
      throw new DomainError(
        "INVALID_CONFIG",
        "LoyaltyService krever pool eller connectionString."
      );
    }
  }

  /** @internal — test-hook (matches LeaderboardTierService.forTesting). */
  static forTesting(pool: Pool, schema = "public"): LoyaltyService {
    const svc = Object.create(LoyaltyService.prototype) as LoyaltyService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(schema);
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise =
      Promise.resolve();
    return svc;
  }

  private tierTable(): string {
    return `"${this.schema}"."app_loyalty_tiers"`;
  }

  private stateTable(): string {
    return `"${this.schema}"."app_loyalty_player_state"`;
  }

  private eventTable(): string {
    return `"${this.schema}"."app_loyalty_events"`;
  }

  // ── Tier CRUD ─────────────────────────────────────────────────────────────

  async listTiers(filter: ListLoyaltyTierFilter = {}): Promise<LoyaltyTier[]> {
    await this.ensureInitialized();
    const limit =
      filter.limit && filter.limit > 0
        ? Math.min(Math.floor(filter.limit), 500)
        : 200;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (!filter.includeDeleted) {
      conditions.push("deleted_at IS NULL");
    }
    if (filter.active !== undefined) {
      if (typeof filter.active !== "boolean") {
        throw new DomainError("INVALID_INPUT", "active må være boolean.");
      }
      params.push(filter.active);
      conditions.push(`active = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const { rows } = await this.pool.query<LoyaltyTierRow>(
      `SELECT id, name, rank, min_points, max_points, benefits_json, active,
              created_by_user_id, created_at, updated_at, deleted_at
       FROM ${this.tierTable()}
       ${where}
       ORDER BY rank ASC, name ASC
       LIMIT $${params.length}`,
      params
    );
    return rows.map((row) => mapTierRow(row));
  }

  async getTier(id: string): Promise<LoyaltyTier> {
    await this.ensureInitialized();
    if (!id?.trim()) {
      throw new DomainError("INVALID_INPUT", "id er påkrevd.");
    }
    const { rows } = await this.pool.query<LoyaltyTierRow>(
      `SELECT id, name, rank, min_points, max_points, benefits_json, active,
              created_by_user_id, created_at, updated_at, deleted_at
       FROM ${this.tierTable()}
       WHERE id = $1`,
      [id.trim()]
    );
    const row = rows[0];
    if (!row) {
      throw new DomainError("LOYALTY_TIER_NOT_FOUND", "Loyalty-tier finnes ikke.");
    }
    return mapTierRow(row);
  }

  async createTier(input: CreateLoyaltyTierInput): Promise<LoyaltyTier> {
    await this.ensureInitialized();
    const name = assertNonEmptyString(input.name, "name");
    const rank = assertPositiveInt(input.rank, "rank");
    const minPoints =
      input.minPoints !== undefined
        ? assertNonNegativeInt(input.minPoints, "minPoints")
        : 0;
    const maxPoints =
      input.maxPoints !== undefined
        ? assertIntOrNull(input.maxPoints, "maxPoints")
        : null;
    if (maxPoints !== null && maxPoints <= minPoints) {
      throw new DomainError(
        "INVALID_INPUT",
        "maxPoints må være større enn minPoints."
      );
    }
    const benefits = assertObject(input.benefits, "benefits");
    const active = input.active === undefined ? true : input.active === true;
    if (!input.createdByUserId?.trim()) {
      throw new DomainError("INVALID_INPUT", "createdByUserId er påkrevd.");
    }

    const id = randomUUID();
    try {
      await this.pool.query(
        `INSERT INTO ${this.tierTable()}
           (id, name, rank, min_points, max_points, benefits_json, active,
            created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
        [
          id,
          name,
          rank,
          minPoints,
          maxPoints,
          JSON.stringify(benefits),
          active,
          input.createdByUserId,
        ]
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError(
          "LOYALTY_TIER_DUPLICATE",
          `Loyalty-tier med (name='${name}' eller rank=${rank}) finnes allerede.`
        );
      }
      throw err;
    }
    return this.getTier(id);
  }

  async updateTier(
    id: string,
    update: UpdateLoyaltyTierInput
  ): Promise<LoyaltyTier> {
    await this.ensureInitialized();
    const existing = await this.getTier(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "LOYALTY_TIER_DELETED",
        "Loyalty-tier er slettet og kan ikke oppdateres."
      );
    }

    const sets: string[] = [];
    const params: unknown[] = [];

    if (update.name !== undefined) {
      sets.push(`name = $${params.length + 1}`);
      params.push(assertNonEmptyString(update.name, "name"));
    }
    if (update.rank !== undefined) {
      sets.push(`rank = $${params.length + 1}`);
      params.push(assertPositiveInt(update.rank, "rank"));
    }
    // Re-validate min/max constraint against merged state.
    const nextMinPoints =
      update.minPoints !== undefined
        ? assertNonNegativeInt(update.minPoints, "minPoints")
        : existing.minPoints;
    const nextMaxPoints =
      update.maxPoints !== undefined
        ? assertIntOrNull(update.maxPoints, "maxPoints")
        : existing.maxPoints;
    if (nextMaxPoints !== null && nextMaxPoints <= nextMinPoints) {
      throw new DomainError(
        "INVALID_INPUT",
        "maxPoints må være større enn minPoints."
      );
    }
    if (update.minPoints !== undefined) {
      sets.push(`min_points = $${params.length + 1}`);
      params.push(nextMinPoints);
    }
    if (update.maxPoints !== undefined) {
      sets.push(`max_points = $${params.length + 1}`);
      params.push(nextMaxPoints);
    }
    if (update.benefits !== undefined) {
      sets.push(`benefits_json = $${params.length + 1}::jsonb`);
      params.push(JSON.stringify(assertObject(update.benefits, "benefits")));
    }
    if (update.active !== undefined) {
      if (typeof update.active !== "boolean") {
        throw new DomainError("INVALID_INPUT", "active må være boolean.");
      }
      sets.push(`active = $${params.length + 1}`);
      params.push(update.active);
    }

    if (sets.length === 0) {
      throw new DomainError("INVALID_INPUT", "Ingen endringer oppgitt.");
    }

    sets.push("updated_at = now()");
    params.push(existing.id);
    try {
      await this.pool.query(
        `UPDATE ${this.tierTable()}
         SET ${sets.join(", ")}
         WHERE id = $${params.length}`,
        params
      );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new DomainError(
          "LOYALTY_TIER_DUPLICATE",
          "Loyalty-tier med samme name eller rank finnes allerede."
        );
      }
      throw err;
    }
    return this.getTier(existing.id);
  }

  /**
   * Default soft-delete (deleted_at + active=false). Hard=true DELETE. Tier-
   * referanser i app_loyalty_player_state.current_tier_id blir SET NULL via
   * ON DELETE SET NULL (eller beholdes ved soft-delete).
   */
  async removeTier(
    id: string,
    options: { hard?: boolean } = {}
  ): Promise<{ softDeleted: boolean }> {
    await this.ensureInitialized();
    const existing = await this.getTier(id);
    if (existing.deletedAt) {
      throw new DomainError(
        "LOYALTY_TIER_DELETED",
        "Loyalty-tier er allerede slettet."
      );
    }

    if (options.hard === true) {
      await this.pool.query(
        `DELETE FROM ${this.tierTable()} WHERE id = $1`,
        [existing.id]
      );
      return { softDeleted: false };
    }

    await this.pool.query(
      `UPDATE ${this.tierTable()}
       SET deleted_at = now(), active = false, updated_at = now()
       WHERE id = $1`,
      [existing.id]
    );
    return { softDeleted: true };
  }

  // ── Player state ──────────────────────────────────────────────────────────

  /**
   * Returnerer player-state. Oppretter en tom rad hvis ingen eksisterer —
   * dette gjør admin-GET idempotent og lar admin-UI vise null-state for
   * nyregistrerte brukere uten å feile.
   */
  async getPlayerState(userId: string): Promise<LoyaltyPlayerState> {
    await this.ensureInitialized();
    const uid = assertNonEmptyString(userId, "userId");
    const { rows } = await this.pool.query<LoyaltyPlayerStateRow>(
      `SELECT user_id, current_tier_id, lifetime_points, month_points,
              month_key, tier_locked, last_updated_at, created_at
       FROM ${this.stateTable()}
       WHERE user_id = $1`,
      [uid]
    );
    if (rows.length === 0) {
      // Ingen rad — return en tom-projeksjon (uten å skrive til DB).
      const now = new Date().toISOString();
      return {
        userId: uid,
        currentTier: null,
        lifetimePoints: 0,
        monthPoints: 0,
        monthKey: null,
        tierLocked: false,
        lastUpdatedAt: now,
        createdAt: now,
      };
    }
    return this.mapStateRowAsync(rows[0]!);
  }

  /**
   * Tildel (eller fjern ved negativ delta) loyalty-points til en spiller.
   * Oppretter state-rad ved behov, oppdaterer lifetime_points + month_points
   * + last_updated_at, skriver en event-rad, og kaller auto-tier-reassign
   * hvis tier_locked = false.
   */
  async awardPoints(input: AwardLoyaltyPointsInput): Promise<AwardResult> {
    await this.ensureInitialized();
    const userId = assertNonEmptyString(input.userId, "userId");
    const pointsDelta = assertInteger(input.pointsDelta, "pointsDelta");
    if (pointsDelta === 0) {
      throw new DomainError(
        "INVALID_INPUT",
        "pointsDelta må være ulik 0. Bruk tier-override for markør-events."
      );
    }
    const reason = assertNonEmptyString(input.reason, "reason", 500);
    const metadata = assertObject(input.metadata, "metadata");
    if (!input.createdByUserId?.trim()) {
      throw new DomainError("INVALID_INPUT", "createdByUserId er påkrevd.");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Upsert state. For negative delta, bruk GREATEST for å hindre at
      // lifetime/month-points blir negative (DB har CHECK >= 0 men vi vil
      // også trim-e i SQL for å unngå roll-back).
      const nowMonthKey = monthKeyFromDate(new Date());
      await client.query(
        `INSERT INTO ${this.stateTable()}
           (user_id, lifetime_points, month_points, month_key, last_updated_at)
         VALUES ($1, GREATEST(0, $2), GREATEST(0, $2), $3, now())
         ON CONFLICT (user_id) DO UPDATE SET
           lifetime_points = GREATEST(0, ${this.stateTable()}.lifetime_points + EXCLUDED.lifetime_points),
           month_points    = CASE
             WHEN ${this.stateTable()}.month_key = $3 OR ${this.stateTable()}.month_key IS NULL
               THEN GREATEST(0, ${this.stateTable()}.month_points + EXCLUDED.month_points)
             ELSE GREATEST(0, EXCLUDED.month_points)
           END,
           month_key       = $3,
           last_updated_at = now()`,
        [userId, pointsDelta, nowMonthKey]
      );

      // Skriv event-rad.
      const eventId = randomUUID();
      const metadataWithReason = { ...metadata, reason };
      const eventInsert = await client.query<LoyaltyEventRow>(
        `INSERT INTO ${this.eventTable()}
           (id, user_id, event_type, points_delta, metadata_json, created_by_user_id)
         VALUES ($1, $2, 'admin_award', $3, $4::jsonb, $5)
         RETURNING id, user_id, event_type, points_delta, metadata_json,
                   created_by_user_id, created_at`,
        [eventId, userId, pointsDelta, JSON.stringify(metadataWithReason), input.createdByUserId]
      );

      // Les tilbake state (etter upsert).
      const stateRes = await client.query<LoyaltyPlayerStateRow>(
        `SELECT user_id, current_tier_id, lifetime_points, month_points,
                month_key, tier_locked, last_updated_at, created_at
         FROM ${this.stateTable()} WHERE user_id = $1`,
        [userId]
      );
      const stateRow = stateRes.rows[0]!;

      // Auto tier-reassign hvis ikke låst.
      let tierChanged = false;
      if (!stateRow.tier_locked) {
        const newTierId = await this.resolveAutoTierIdInTx(
          client,
          Number(stateRow.lifetime_points)
        );
        if (newTierId !== stateRow.current_tier_id) {
          await client.query(
            `UPDATE ${this.stateTable()}
             SET current_tier_id = $1, last_updated_at = now()
             WHERE user_id = $2`,
            [newTierId, userId]
          );
          stateRow.current_tier_id = newTierId;
          tierChanged = true;
        }
      }

      await client.query("COMMIT");

      const state = await this.getPlayerState(userId);
      const eventRow = eventInsert.rows[0]!;
      return {
        state,
        event: mapEventRow(eventRow),
        tierChanged,
      };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * GAME1_SCHEDULE PR 5 (BIN-700 follow-up): automatisk points-award fra
   * spill-aktivitet (ticket-kjøp, game-win). Skiller seg fra `awardPoints`
   * ved at event-type er fritt-form, createdByUserId er NULL (system), og
   * pointsDelta=0 er tillatt (rene markør-events).
   *
   * Kalles fra `LoyaltyPointsHookAdapter` som implementerer
   * LoyaltyPointsHookPort for BingoEngine. Fire-and-forget-semantikk —
   * metoden er idempotent på event-id-nivå men idempotent-nøkkel på tvers
   * av events må enforces av kaller (port-adapter bruker randomUUID).
   *
   * Tier-reassign skjer kun når pointsDelta != 0 så 0-delta markører ikke
   * triggere unødvendig SQL-overhead.
   */
  async awardPointsForActivity(input: AwardLoyaltyActivityInput): Promise<LoyaltyEvent> {
    await this.ensureInitialized();
    const userId = assertNonEmptyString(input.userId, "userId");
    const eventType = assertNonEmptyString(input.eventType, "eventType", 120);
    const pointsDelta = assertInteger(input.pointsDelta, "pointsDelta");
    const metadata = assertObject(input.metadata, "metadata");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      if (pointsDelta !== 0) {
        const nowMonthKey = monthKeyFromDate(new Date());
        await client.query(
          `INSERT INTO ${this.stateTable()}
             (user_id, lifetime_points, month_points, month_key, last_updated_at)
           VALUES ($1, GREATEST(0, $2), GREATEST(0, $2), $3, now())
           ON CONFLICT (user_id) DO UPDATE SET
             lifetime_points = GREATEST(0, ${this.stateTable()}.lifetime_points + EXCLUDED.lifetime_points),
             month_points    = CASE
               WHEN ${this.stateTable()}.month_key = $3 OR ${this.stateTable()}.month_key IS NULL
                 THEN GREATEST(0, ${this.stateTable()}.month_points + EXCLUDED.month_points)
               ELSE GREATEST(0, EXCLUDED.month_points)
             END,
             month_key       = $3,
             last_updated_at = now()`,
          [userId, pointsDelta, nowMonthKey]
        );
      }

      const eventId = randomUUID();
      const eventInsert = await client.query<LoyaltyEventRow>(
        `INSERT INTO ${this.eventTable()}
           (id, user_id, event_type, points_delta, metadata_json, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5::jsonb, NULL)
         RETURNING id, user_id, event_type, points_delta, metadata_json,
                   created_by_user_id, created_at`,
        [eventId, userId, eventType, pointsDelta, JSON.stringify(metadata)]
      );

      // Auto-tier-reassign: bare når faktisk points-delta (state oppdatert).
      if (pointsDelta !== 0) {
        const stateRes = await client.query<LoyaltyPlayerStateRow>(
          `SELECT current_tier_id, lifetime_points, tier_locked
           FROM ${this.stateTable()} WHERE user_id = $1`,
          [userId]
        );
        const stateRow = stateRes.rows[0];
        if (stateRow && !stateRow.tier_locked) {
          const newTierId = await this.resolveAutoTierIdInTx(
            client,
            Number(stateRow.lifetime_points)
          );
          if (newTierId !== stateRow.current_tier_id) {
            await client.query(
              `UPDATE ${this.stateTable()}
               SET current_tier_id = $1, last_updated_at = now()
               WHERE user_id = $2`,
              [newTierId, userId]
            );
          }
        }
      }

      await client.query("COMMIT");
      return mapEventRow(eventInsert.rows[0]!);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Manuelt overstyr tier for en spiller. tier_locked settes til true (bypass
   * automatic) — unntatt når tierId=null, som fjerner override og tillater
   * auto-assignment igjen.
   */
  async overrideTier(input: OverrideLoyaltyTierInput): Promise<LoyaltyPlayerState> {
    await this.ensureInitialized();
    const userId = assertNonEmptyString(input.userId, "userId");
    const reason = assertNonEmptyString(input.reason, "reason", 500);
    if (!input.createdByUserId?.trim()) {
      throw new DomainError("INVALID_INPUT", "createdByUserId er påkrevd.");
    }
    const tierId =
      input.tierId === null ? null : assertNonEmptyString(input.tierId, "tierId");

    // Verifiser at tieren eksisterer (hvis satt) før vi skriver noe.
    if (tierId !== null) {
      await this.getTier(tierId);
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      // Upsert state. Setter current_tier_id eksplisitt; tier_locked=true
      // når tierId er satt, false ellers.
      const nowMonthKey = monthKeyFromDate(new Date());
      await client.query(
        `INSERT INTO ${this.stateTable()}
           (user_id, current_tier_id, tier_locked, month_key, last_updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (user_id) DO UPDATE SET
           current_tier_id = EXCLUDED.current_tier_id,
           tier_locked     = EXCLUDED.tier_locked,
           last_updated_at = now()`,
        [userId, tierId, tierId !== null, nowMonthKey]
      );

      // Skriv event-rad (pointsDelta=0, bare markør).
      const eventId = randomUUID();
      await client.query(
        `INSERT INTO ${this.eventTable()}
           (id, user_id, event_type, points_delta, metadata_json, created_by_user_id)
         VALUES ($1, $2, 'tier_override', 0, $3::jsonb, $4)`,
        [
          eventId,
          userId,
          JSON.stringify({ reason, tierId, locked: tierId !== null }),
          input.createdByUserId,
        ]
      );

      // Hvis vi fjernet override, kjør auto-assignment nå.
      if (tierId === null) {
        const stateRes = await client.query<LoyaltyPlayerStateRow>(
          `SELECT lifetime_points FROM ${this.stateTable()} WHERE user_id = $1`,
          [userId]
        );
        const lifetimePoints = Number(stateRes.rows[0]?.lifetime_points ?? 0);
        const autoTierId = await this.resolveAutoTierIdInTx(client, lifetimePoints);
        await client.query(
          `UPDATE ${this.stateTable()}
           SET current_tier_id = $1, last_updated_at = now()
           WHERE user_id = $2`,
          [autoTierId, userId]
        );
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    return this.getPlayerState(userId);
  }

  /**
   * Nullstiller month_points for alle spillere i en gitt måned (monthKey i
   * ISO-form "YYYY-MM"). Idempotent: rader med samme eller nyere month_key
   * er allerede nullstilt.
   *
   * Brukt av JobScheduler (loyalty-monthly-reset). Skriver ikke event-rader
   * per spiller — legger én aggregat-logg-rad i stedet.
   */
  async monthlyReset(monthKey: string): Promise<MonthlyResetResult> {
    await this.ensureInitialized();
    if (!/^\d{4}-\d{2}$/.test(monthKey)) {
      throw new DomainError(
        "INVALID_INPUT",
        "monthKey må være ISO YYYY-MM."
      );
    }

    const res = await this.pool.query(
      `UPDATE ${this.stateTable()}
       SET month_points = 0, month_key = $1, last_updated_at = now()
       WHERE month_key IS NULL OR month_key < $1`,
      [monthKey]
    );
    const playersReset = res.rowCount ?? 0;

    if (playersReset > 0) {
      logger.info(
        { monthKey, playersReset },
        "[BIN-700] monthly loyalty reset executed"
      );
    }

    return { playersReset, monthKey };
  }

  /**
   * List en spillers loyalty-events (nyeste først). Brukt av admin-UI
   * for å vise event-history på spiller-detalj-siden.
   */
  async listPlayerEvents(
    userId: string,
    limit = 50
  ): Promise<LoyaltyEvent[]> {
    await this.ensureInitialized();
    const uid = assertNonEmptyString(userId, "userId");
    const lim = Math.min(Math.max(1, Math.floor(limit)), 200);
    const { rows } = await this.pool.query<LoyaltyEventRow>(
      `SELECT id, user_id, event_type, points_delta, metadata_json,
              created_by_user_id, created_at
       FROM ${this.eventTable()}
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [uid, lim]
    );
    return rows.map((row) => mapEventRow(row));
  }

  /** List alle player-states (paginert, tier-filter). */
  async listPlayerStates(options: {
    tierId?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ players: LoyaltyPlayerState[]; total: number }> {
    await this.ensureInitialized();
    const limit =
      options.limit && options.limit > 0
        ? Math.min(Math.floor(options.limit), 200)
        : 50;
    const offset = options.offset && options.offset > 0 ? Math.floor(options.offset) : 0;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (options.tierId) {
      params.push(assertNonEmptyString(options.tierId, "tierId"));
      conditions.push(`current_tier_id = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRes = await this.pool.query<{ c: string | number }>(
      `SELECT COUNT(*)::bigint AS c FROM ${this.stateTable()} ${where}`,
      params
    );
    const total = Number(countRes.rows[0]?.c ?? 0);

    params.push(limit);
    params.push(offset);
    const { rows } = await this.pool.query<LoyaltyPlayerStateRow>(
      `SELECT user_id, current_tier_id, lifetime_points, month_points,
              month_key, tier_locked, last_updated_at, created_at
       FROM ${this.stateTable()}
       ${where}
       ORDER BY lifetime_points DESC, user_id ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    const players = await Promise.all(rows.map((row) => this.mapStateRowAsync(row)));
    return { players, total };
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Finn riktig tier-id for gitt lifetime_points. Velger høyeste aktive
   * tier (rank DESC) hvor min_points <= lifetime_points. Returnerer null
   * hvis ingen matcher.
   *
   * Brukt inne i transaksjoner for award/override. Leser fra samme client.
   */
  private async resolveAutoTierIdInTx(
    client: import("pg").PoolClient | Pool,
    lifetimePoints: number
  ): Promise<string | null> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM ${this.tierTable()}
       WHERE deleted_at IS NULL AND active = true AND min_points <= $1
       ORDER BY rank DESC
       LIMIT 1`,
      [lifetimePoints]
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Samme som mapStateRow men beriker currentTier via separat SELECT.
   * Brukt av getPlayerState og listPlayerStates hvor vi vil vise tier-info.
   */
  private async mapStateRowAsync(
    row: LoyaltyPlayerStateRow
  ): Promise<LoyaltyPlayerState> {
    const state = mapStateRow(row);
    if (row.current_tier_id) {
      try {
        state.currentTier = await this.getTier(row.current_tier_id);
      } catch (err) {
        if (err instanceof DomainError && err.code === "LOYALTY_TIER_NOT_FOUND") {
          // Sletting uten ON DELETE SET NULL — behandle som null.
          state.currentTier = null;
        } else {
          throw err;
        }
      }
    }
    return state;
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = initializeLoyaltySchema(this.pool, this.schema);
    }
    await this.initPromise;
  }
}
