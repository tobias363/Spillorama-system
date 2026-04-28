import { Pool, type QueryResultRow } from "pg";
import { getPoolTuning } from "../util/pgPool.js";
import type {
  PersistedComplianceLedgerEntry,
  PersistedDailyReport,
  PersistedExtraPrizeEntry,
  PersistedLossEntry,
  PersistedLossLimit,
  PersistedOverskuddBatch,
  PersistedHallOrganizationAllocation,
  PersistedPendingLossLimitChange,
  PersistedPayoutAuditEvent,
  PersistedPlaySessionState,
  PersistedPrizePolicy,
  PersistedRestrictionState,
  ResponsibleGamingPersistenceAdapter,
  ResponsibleGamingPersistenceSnapshot
} from "./ResponsibleGamingPersistence.js";

interface PostgresResponsibleGamingStoreOptions {
  connectionString: string;
  schema?: string;
  ssl?: boolean;
}

function assertSchemaName(schema: string): string {
  const trimmed = schema.trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
    throw new Error("Ugyldig schema-navn for responsible-gaming persistence.");
  }
  return trimmed;
}

function asIso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function asJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export class PostgresResponsibleGamingStore implements ResponsibleGamingPersistenceAdapter {
  private readonly pool: Pool;
  private readonly schema: string;
  private initPromise: Promise<void> | null = null;

  constructor(options: PostgresResponsibleGamingStoreOptions) {
    this.pool = new Pool({
      connectionString: options.connectionString,
      ssl: options.ssl ? { rejectUnauthorized: false } : false,
      ...getPoolTuning()
    });
    this.schema = assertSchemaName(options.schema || "public");
  }

  async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeSchema();
    }
    await this.initPromise;
  }

  async loadSnapshot(): Promise<ResponsibleGamingPersistenceSnapshot> {
    await this.ensureInitialized();

    const [
      personalLossLimits,
      pendingLossLimitChanges,
      restrictions,
      playStates,
      lossEntries,
      prizePolicies,
      extraPrizeEntries,
      payoutAuditTrail,
      complianceLedger,
      dailyReports
    ] = await Promise.all([
      this.loadPersonalLossLimits(),
      this.loadPendingLossLimitChanges(),
      this.loadRestrictions(),
      this.loadPlayStates(),
      this.loadLossEntries(),
      this.loadPrizePolicies(),
      this.loadExtraPrizeEntries(),
      this.loadPayoutAuditTrail(),
      this.loadComplianceLedger(),
      this.loadDailyReports()
    ]);

    return {
      personalLossLimits,
      pendingLossLimitChanges,
      restrictions,
      playStates,
      lossEntries,
      prizePolicies,
      extraPrizeEntries,
      payoutAuditTrail,
      complianceLedger,
      dailyReports
    };
  }

  async upsertLossLimit(entry: PersistedLossLimit): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(
      `INSERT INTO ${this.personalLossLimitsTable()} (wallet_id, hall_id, daily_limit, monthly_limit, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (wallet_id, hall_id)
       DO UPDATE SET daily_limit = EXCLUDED.daily_limit,
                     monthly_limit = EXCLUDED.monthly_limit,
                     updated_at = now()`,
      [entry.walletId, entry.hallId, entry.daily, entry.monthly]
    );
  }

  async upsertPendingLossLimitChange(entry: PersistedPendingLossLimitChange): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(
      `INSERT INTO ${this.pendingLossLimitChangesTable()} (
         wallet_id,
         hall_id,
         daily_pending_value,
         daily_effective_from_ms,
         monthly_pending_value,
         monthly_effective_from_ms,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (wallet_id, hall_id)
       DO UPDATE SET daily_pending_value = EXCLUDED.daily_pending_value,
                     daily_effective_from_ms = EXCLUDED.daily_effective_from_ms,
                     monthly_pending_value = EXCLUDED.monthly_pending_value,
                     monthly_effective_from_ms = EXCLUDED.monthly_effective_from_ms,
                     updated_at = now()`,
      [
        entry.walletId,
        entry.hallId,
        entry.dailyPendingValue ?? null,
        entry.dailyEffectiveFromMs ?? null,
        entry.monthlyPendingValue ?? null,
        entry.monthlyEffectiveFromMs ?? null
      ]
    );
  }

  async deletePendingLossLimitChange(walletId: string, hallId: string): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(
      `DELETE FROM ${this.pendingLossLimitChangesTable()} WHERE wallet_id = $1 AND hall_id = $2`,
      [walletId, hallId]
    );
  }

  async upsertRestriction(entry: PersistedRestrictionState): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(
      `INSERT INTO ${this.restrictionsTable()} (
         wallet_id,
         timed_pause_until,
         timed_pause_set_at,
         self_excluded_at,
         self_exclusion_minimum_until,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (wallet_id)
       DO UPDATE SET timed_pause_until = EXCLUDED.timed_pause_until,
                     timed_pause_set_at = EXCLUDED.timed_pause_set_at,
                     self_excluded_at = EXCLUDED.self_excluded_at,
                     self_exclusion_minimum_until = EXCLUDED.self_exclusion_minimum_until,
                     updated_at = now()`,
      [
        entry.walletId,
        entry.timedPauseUntilMs !== undefined ? new Date(entry.timedPauseUntilMs).toISOString() : null,
        entry.timedPauseSetAtMs !== undefined ? new Date(entry.timedPauseSetAtMs).toISOString() : null,
        entry.selfExcludedAtMs !== undefined ? new Date(entry.selfExcludedAtMs).toISOString() : null,
        entry.selfExclusionMinimumUntilMs !== undefined
          ? new Date(entry.selfExclusionMinimumUntilMs).toISOString()
          : null
      ]
    );
  }

  async deleteRestriction(walletId: string): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(`DELETE FROM ${this.restrictionsTable()} WHERE wallet_id = $1`, [walletId]);
  }

  async upsertPlaySessionState(entry: PersistedPlaySessionState): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(
      `INSERT INTO ${this.playStatesTable()} (
         wallet_id,
         accumulated_ms,
         active_from_ms,
         pause_until_ms,
         last_mandatory_break_json,
         games_played_in_session,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, now())
       ON CONFLICT (wallet_id)
       DO UPDATE SET accumulated_ms = EXCLUDED.accumulated_ms,
                     active_from_ms = EXCLUDED.active_from_ms,
                     pause_until_ms = EXCLUDED.pause_until_ms,
                     last_mandatory_break_json = EXCLUDED.last_mandatory_break_json,
                     games_played_in_session = EXCLUDED.games_played_in_session,
                     updated_at = now()`,
      [
        entry.walletId,
        entry.accumulatedMs,
        entry.activeFromMs ?? null,
        entry.pauseUntilMs ?? null,
        JSON.stringify(entry.lastMandatoryBreak ?? null),
        entry.gamesPlayedInSession ?? 0
      ]
    );
  }

  async deletePlaySessionState(walletId: string): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(`DELETE FROM ${this.playStatesTable()} WHERE wallet_id = $1`, [walletId]);
  }

  async insertLossEntry(entry: PersistedLossEntry): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(
      `INSERT INTO ${this.lossEntriesTable()} (wallet_id, hall_id, entry_type, amount, created_at_ms)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.walletId, entry.hallId, entry.type, entry.amount, entry.createdAtMs]
    );
  }

  async upsertPrizePolicy(policy: PersistedPrizePolicy): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(
      `INSERT INTO ${this.prizePoliciesTable()} (
         id,
         game_type,
         hall_id,
         link_id,
         effective_from_ms,
         single_prize_cap,
         daily_extra_prize_cap,
         created_at_ms
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id)
       DO UPDATE SET game_type = EXCLUDED.game_type,
                     hall_id = EXCLUDED.hall_id,
                     link_id = EXCLUDED.link_id,
                     effective_from_ms = EXCLUDED.effective_from_ms,
                     single_prize_cap = EXCLUDED.single_prize_cap,
                     daily_extra_prize_cap = EXCLUDED.daily_extra_prize_cap,
                     created_at_ms = EXCLUDED.created_at_ms`,
      [
        policy.id,
        policy.gameType,
        policy.hallId,
        policy.linkId,
        policy.effectiveFromMs,
        policy.singlePrizeCap,
        policy.dailyExtraPrizeCap,
        policy.createdAtMs
      ]
    );
  }

  async insertExtraPrizeEntry(entry: PersistedExtraPrizeEntry): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(
      `INSERT INTO ${this.extraPrizeEntriesTable()} (hall_id, link_id, amount, created_at_ms, policy_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.hallId, entry.linkId, entry.amount, entry.createdAtMs, entry.policyId]
    );
  }

  async insertPayoutAuditEvent(event: PersistedPayoutAuditEvent): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(
      `INSERT INTO ${this.payoutAuditTable()} (
         id,
         created_at,
         claim_id,
         game_id,
         room_code,
         hall_id,
         policy_version,
         amount,
         currency,
         wallet_id,
         player_id,
         source_account_id,
         tx_ids_json,
         kind,
         chain_index,
         previous_hash,
         event_hash
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14, $15, $16, $17)
       ON CONFLICT (id) DO NOTHING`,
      [
        event.id,
        event.createdAt,
        event.claimId ?? null,
        event.gameId ?? null,
        event.roomCode ?? null,
        event.hallId,
        event.policyVersion ?? null,
        event.amount,
        event.currency,
        event.walletId,
        event.playerId ?? null,
        event.sourceAccountId ?? null,
        JSON.stringify(event.txIds),
        event.kind,
        event.chainIndex,
        event.previousHash,
        event.eventHash
      ]
    );
  }

  async insertComplianceLedgerEntry(entry: PersistedComplianceLedgerEntry): Promise<void> {
    await this.ensureInitialized();
    // PILOT-STOP-SHIP 2026-04-28: ON CONFLICT mot UNIQUE(idempotency_key)
    // gir retry-safe insert for soft-fail-call-sites. Format på key er
    // bestemt av ComplianceLedger.makeComplianceLedgerIdempotencyKey og
    // bevares deterministisk mellom retries på samme logiske event.
    // Hvis caller ikke setter `idempotencyKey` (test-fixtures, gammel
    // data) bruker vi `id` som fallback — DB-kolonnen har NOT NULL.
    const idempotencyKey = entry.idempotencyKey ?? entry.id;
    await this.pool.query(
      `INSERT INTO ${this.complianceLedgerTable()} (
         id,
         created_at,
         created_at_ms,
         hall_id,
         game_type,
         channel,
         event_type,
         amount,
         currency,
         room_code,
         game_id,
         claim_id,
         player_id,
         wallet_id,
         source_account_id,
         target_account_id,
         policy_version,
         batch_id,
         metadata_json,
         idempotency_key
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20
       )
       ON CONFLICT (idempotency_key) DO NOTHING`,
      [
        entry.id,
        entry.createdAt,
        entry.createdAtMs,
        entry.hallId,
        entry.gameType,
        entry.channel,
        entry.eventType,
        entry.amount,
        entry.currency,
        entry.roomCode ?? null,
        entry.gameId ?? null,
        entry.claimId ?? null,
        entry.playerId ?? null,
        entry.walletId ?? null,
        entry.sourceAccountId ?? null,
        entry.targetAccountId ?? null,
        entry.policyVersion ?? null,
        entry.batchId ?? null,
        JSON.stringify(entry.metadata ?? null),
        idempotencyKey
      ]
    );
  }

  async upsertDailyReport(report: PersistedDailyReport): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(
      `INSERT INTO ${this.dailyReportsTable()} (date_key, generated_at, report_json)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (date_key)
       DO UPDATE SET generated_at = EXCLUDED.generated_at,
                     report_json = EXCLUDED.report_json`,
      [report.date, report.generatedAt, JSON.stringify(report)]
    );
  }

  async insertOverskuddBatch(batch: PersistedOverskuddBatch): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(
      `INSERT INTO ${this.overskuddBatchesTable()} (
         id, created_at, date, hall_id, game_type, channel,
         required_minimum, distributed_amount, transfers_json, allocations_json
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING`,
      [
        batch.id,
        batch.createdAt,
        batch.date,
        batch.hallId ?? null,
        batch.gameType ?? null,
        batch.channel ?? null,
        batch.requiredMinimum,
        batch.distributedAmount,
        batch.transfersJson,
        batch.allocationsJson
      ]
    );
  }

  async getOverskuddBatch(batchId: string): Promise<PersistedOverskuddBatch | null> {
    await this.ensureInitialized();
    const { rows } = await this.pool.query<{
      id: string;
      created_at: string;
      date: string;
      hall_id: string | null;
      game_type: string | null;
      channel: string | null;
      required_minimum: number;
      distributed_amount: number;
      transfers_json: string;
      allocations_json: string;
    }>(
      `SELECT id, created_at, date, hall_id, game_type, channel,
              required_minimum, distributed_amount, transfers_json, allocations_json
       FROM ${this.overskuddBatchesTable()}
       WHERE id = $1`,
      [batchId]
    );
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0];
    return {
      id: row.id,
      createdAt: row.created_at,
      date: row.date,
      hallId: row.hall_id ?? undefined,
      gameType: row.game_type ?? undefined,
      channel: row.channel ?? undefined,
      requiredMinimum: Number(row.required_minimum),
      distributedAmount: Number(row.distributed_amount),
      transfersJson: row.transfers_json,
      allocationsJson: row.allocations_json
    };
  }

  async listOverskuddBatches(input: {
    hallId?: string;
    gameType?: string;
    channel?: string;
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  }): Promise<PersistedOverskuddBatch[]> {
    await this.ensureInitialized();
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (input.hallId) {
      conditions.push(`hall_id = $${paramIndex++}`);
      params.push(input.hallId);
    }
    if (input.gameType) {
      conditions.push(`game_type = $${paramIndex++}`);
      params.push(input.gameType);
    }
    if (input.channel) {
      conditions.push(`channel = $${paramIndex++}`);
      params.push(input.channel);
    }
    if (input.dateFrom) {
      conditions.push(`date >= $${paramIndex++}`);
      params.push(input.dateFrom);
    }
    if (input.dateTo) {
      conditions.push(`date <= $${paramIndex++}`);
      params.push(input.dateTo);
    }

    const limit = Number.isFinite(input.limit) && (input.limit ?? 0) > 0 ? Math.min(1000, Math.floor(input.limit!)) : 200;
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const { rows } = await this.pool.query<{
      id: string;
      created_at: string;
      date: string;
      hall_id: string | null;
      game_type: string | null;
      channel: string | null;
      required_minimum: number;
      distributed_amount: number;
      transfers_json: string;
      allocations_json: string;
    }>(
      `SELECT id, created_at, date, hall_id, game_type, channel,
              required_minimum, distributed_amount, transfers_json, allocations_json
       FROM ${this.overskuddBatchesTable()}
       ${where}
       ORDER BY date DESC
       LIMIT ${limit}`,
      params
    );

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      date: row.date,
      hallId: row.hall_id ?? undefined,
      gameType: row.game_type ?? undefined,
      channel: row.channel ?? undefined,
      requiredMinimum: Number(row.required_minimum),
      distributedAmount: Number(row.distributed_amount),
      transfersJson: row.transfers_json,
      allocationsJson: row.allocations_json
    }));
  }

  async upsertHallOrganizationAllocation(alloc: PersistedHallOrganizationAllocation): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(
      `INSERT INTO ${this.hallOrganizationsTable()} (
         id, hall_id, organization_id, organization_name, organization_account_id,
         share_percent, game_type, channel, is_active, created_at, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id)
       DO UPDATE SET
         hall_id = EXCLUDED.hall_id,
         organization_id = EXCLUDED.organization_id,
         organization_name = EXCLUDED.organization_name,
         organization_account_id = EXCLUDED.organization_account_id,
         share_percent = EXCLUDED.share_percent,
         game_type = EXCLUDED.game_type,
         channel = EXCLUDED.channel,
         is_active = EXCLUDED.is_active,
         updated_at = EXCLUDED.updated_at`,
      [
        alloc.id,
        alloc.hallId,
        alloc.organizationId,
        alloc.organizationName,
        alloc.organizationAccountId,
        alloc.sharePercent,
        alloc.gameType ?? null,
        alloc.channel ?? null,
        alloc.isActive ? 1 : 0,
        alloc.createdAt,
        alloc.updatedAt
      ]
    );
  }

  async listHallOrganizationAllocations(hallId?: string): Promise<PersistedHallOrganizationAllocation[]> {
    await this.ensureInitialized();
    const { rows } = hallId
      ? await this.pool.query<{
          id: string;
          hall_id: string;
          organization_id: string;
          organization_name: string;
          organization_account_id: string;
          share_percent: number;
          game_type: string | null;
          channel: string | null;
          is_active: number;
          created_at: string;
          updated_at: string;
        }>(
          `SELECT id, hall_id, organization_id, organization_name, organization_account_id,
                  share_percent, game_type, channel, is_active, created_at, updated_at
           FROM ${this.hallOrganizationsTable()}
           WHERE hall_id = $1
           ORDER BY created_at ASC`,
          [hallId]
        )
      : await this.pool.query<{
          id: string;
          hall_id: string;
          organization_id: string;
          organization_name: string;
          organization_account_id: string;
          share_percent: number;
          game_type: string | null;
          channel: string | null;
          is_active: number;
          created_at: string;
          updated_at: string;
        }>(
          `SELECT id, hall_id, organization_id, organization_name, organization_account_id,
                  share_percent, game_type, channel, is_active, created_at, updated_at
           FROM ${this.hallOrganizationsTable()}
           ORDER BY created_at ASC`
        );

    return rows.map((row) => ({
      id: row.id,
      hallId: row.hall_id,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      organizationAccountId: row.organization_account_id,
      sharePercent: Number(row.share_percent),
      gameType: (row.game_type as "MAIN_GAME" | "DATABINGO" | null) ?? null,
      channel: (row.channel as "HALL" | "INTERNET" | null) ?? null,
      isActive: row.is_active !== 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  async deleteHallOrganizationAllocation(id: string): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(
      `DELETE FROM ${this.hallOrganizationsTable()} WHERE id = $1`,
      [id]
    );
  }

  async shutdown(): Promise<void> {
    await this.pool.end();
  }

  private async loadPersonalLossLimits(): Promise<PersistedLossLimit[]> {
    const { rows } = await this.pool.query<{
      wallet_id: string;
      hall_id: string;
      daily_limit: string;
      monthly_limit: string;
    }>(
      `SELECT wallet_id, hall_id, daily_limit, monthly_limit
       FROM ${this.personalLossLimitsTable()}`
    );
    return rows.map((row) => ({
      walletId: row.wallet_id,
      hallId: row.hall_id,
      daily: Number(row.daily_limit),
      monthly: Number(row.monthly_limit)
    }));
  }

  private async loadPendingLossLimitChanges(): Promise<PersistedPendingLossLimitChange[]> {
    const { rows } = await this.pool.query<{
      wallet_id: string;
      hall_id: string;
      daily_pending_value: string | null;
      daily_effective_from_ms: string | null;
      monthly_pending_value: string | null;
      monthly_effective_from_ms: string | null;
    }>(
      `SELECT wallet_id, hall_id, daily_pending_value, daily_effective_from_ms, monthly_pending_value, monthly_effective_from_ms
       FROM ${this.pendingLossLimitChangesTable()}`
    );
    return rows.map((row) => ({
      walletId: row.wallet_id,
      hallId: row.hall_id,
      dailyPendingValue: row.daily_pending_value !== null ? Number(row.daily_pending_value) : undefined,
      dailyEffectiveFromMs: row.daily_effective_from_ms !== null ? Number(row.daily_effective_from_ms) : undefined,
      monthlyPendingValue: row.monthly_pending_value !== null ? Number(row.monthly_pending_value) : undefined,
      monthlyEffectiveFromMs: row.monthly_effective_from_ms !== null ? Number(row.monthly_effective_from_ms) : undefined
    }));
  }

  private async loadRestrictions(): Promise<PersistedRestrictionState[]> {
    const { rows } = await this.pool.query<{
      wallet_id: string;
      timed_pause_until: Date | string | null;
      timed_pause_set_at: Date | string | null;
      self_excluded_at: Date | string | null;
      self_exclusion_minimum_until: Date | string | null;
    }>(
      `SELECT wallet_id, timed_pause_until, timed_pause_set_at, self_excluded_at, self_exclusion_minimum_until
       FROM ${this.restrictionsTable()}`
    );
    return rows.map((row) => ({
      walletId: row.wallet_id,
      timedPauseUntilMs:
        row.timed_pause_until !== null ? new Date(row.timed_pause_until).getTime() : undefined,
      timedPauseSetAtMs:
        row.timed_pause_set_at !== null ? new Date(row.timed_pause_set_at).getTime() : undefined,
      selfExcludedAtMs:
        row.self_excluded_at !== null ? new Date(row.self_excluded_at).getTime() : undefined,
      selfExclusionMinimumUntilMs:
        row.self_exclusion_minimum_until !== null ? new Date(row.self_exclusion_minimum_until).getTime() : undefined
    }));
  }

  private async loadPlayStates(): Promise<PersistedPlaySessionState[]> {
    const { rows } = await this.pool.query<{
      wallet_id: string;
      accumulated_ms: string;
      active_from_ms: string | null;
      pause_until_ms: string | null;
      last_mandatory_break_json: unknown;
      games_played_in_session: string | null;
    }>(
      `SELECT wallet_id, accumulated_ms, active_from_ms, pause_until_ms, last_mandatory_break_json, games_played_in_session
       FROM ${this.playStatesTable()}`
    );
    return rows.map((row) => ({
      walletId: row.wallet_id,
      accumulatedMs: Number(row.accumulated_ms),
      activeFromMs: row.active_from_ms !== null ? Number(row.active_from_ms) : undefined,
      pauseUntilMs: row.pause_until_ms !== null ? Number(row.pause_until_ms) : undefined,
      gamesPlayedInSession: row.games_played_in_session !== null ? Number(row.games_played_in_session) : 0,
      lastMandatoryBreak: asJsonObject(row.last_mandatory_break_json) as PersistedPlaySessionState["lastMandatoryBreak"]
    }));
  }

  private async loadLossEntries(): Promise<PersistedLossEntry[]> {
    const { rows } = await this.pool.query<{
      wallet_id: string;
      hall_id: string;
      entry_type: "BUYIN" | "PAYOUT";
      amount: string;
      created_at_ms: string;
    }>(
      `SELECT wallet_id, hall_id, entry_type, amount, created_at_ms
       FROM ${this.lossEntriesTable()}
       ORDER BY created_at_ms ASC`
    );
    return rows.map((row) => ({
      walletId: row.wallet_id,
      hallId: row.hall_id,
      type: row.entry_type,
      amount: Number(row.amount),
      createdAtMs: Number(row.created_at_ms)
    }));
  }

  private async loadPrizePolicies(): Promise<PersistedPrizePolicy[]> {
    const { rows } = await this.pool.query<{
      id: string;
      game_type: PersistedPrizePolicy["gameType"];
      hall_id: string;
      link_id: string;
      effective_from_ms: string;
      single_prize_cap: string;
      daily_extra_prize_cap: string;
      created_at_ms: string;
    }>(
      `SELECT id, game_type, hall_id, link_id, effective_from_ms, single_prize_cap, daily_extra_prize_cap, created_at_ms
       FROM ${this.prizePoliciesTable()}
       ORDER BY effective_from_ms ASC`
    );
    return rows.map((row) => ({
      id: row.id,
      gameType: row.game_type,
      hallId: row.hall_id,
      linkId: row.link_id,
      effectiveFromMs: Number(row.effective_from_ms),
      singlePrizeCap: Number(row.single_prize_cap),
      dailyExtraPrizeCap: Number(row.daily_extra_prize_cap),
      createdAtMs: Number(row.created_at_ms)
    }));
  }

  private async loadExtraPrizeEntries(): Promise<PersistedExtraPrizeEntry[]> {
    const { rows } = await this.pool.query<{
      hall_id: string;
      link_id: string;
      amount: string;
      created_at_ms: string;
      policy_id: string;
    }>(
      `SELECT hall_id, link_id, amount, created_at_ms, policy_id
       FROM ${this.extraPrizeEntriesTable()}
       ORDER BY created_at_ms ASC`
    );
    return rows.map((row) => ({
      hallId: row.hall_id,
      linkId: row.link_id,
      amount: Number(row.amount),
      createdAtMs: Number(row.created_at_ms),
      policyId: row.policy_id
    }));
  }

  private async loadPayoutAuditTrail(): Promise<PersistedPayoutAuditEvent[]> {
    const { rows } = await this.pool.query<{
      id: string;
      created_at: Date | string;
      claim_id: string | null;
      game_id: string | null;
      room_code: string | null;
      hall_id: string;
      policy_version: string | null;
      amount: string;
      currency: "NOK";
      wallet_id: string;
      player_id: string | null;
      source_account_id: string | null;
      tx_ids_json: unknown;
      kind: "CLAIM_PRIZE" | "EXTRA_PRIZE";
      chain_index: number;
      previous_hash: string;
      event_hash: string;
    }>(
      `SELECT id, created_at, claim_id, game_id, room_code, hall_id, policy_version, amount, currency,
              wallet_id, player_id, source_account_id, tx_ids_json, kind, chain_index, previous_hash, event_hash
       FROM ${this.payoutAuditTable()}
       ORDER BY chain_index DESC`
    );
    return rows.map((row) => ({
      id: row.id,
      createdAt: asIso(row.created_at),
      claimId: row.claim_id ?? undefined,
      gameId: row.game_id ?? undefined,
      roomCode: row.room_code ?? undefined,
      hallId: row.hall_id,
      policyVersion: row.policy_version ?? undefined,
      amount: Number(row.amount),
      currency: row.currency,
      walletId: row.wallet_id,
      playerId: row.player_id ?? undefined,
      sourceAccountId: row.source_account_id ?? undefined,
      txIds: Array.isArray(row.tx_ids_json) ? row.tx_ids_json.map((entry) => String(entry)) : [],
      kind: row.kind,
      chainIndex: row.chain_index,
      previousHash: row.previous_hash,
      eventHash: row.event_hash
    }));
  }

  private async loadComplianceLedger(): Promise<PersistedComplianceLedgerEntry[]> {
    const { rows } = await this.pool.query<{
      id: string;
      created_at: Date | string;
      created_at_ms: string;
      hall_id: string;
      game_type: PersistedComplianceLedgerEntry["gameType"];
      channel: PersistedComplianceLedgerEntry["channel"];
      event_type: PersistedComplianceLedgerEntry["eventType"];
      amount: string;
      currency: "NOK";
      room_code: string | null;
      game_id: string | null;
      claim_id: string | null;
      player_id: string | null;
      wallet_id: string | null;
      source_account_id: string | null;
      target_account_id: string | null;
      policy_version: string | null;
      batch_id: string | null;
      metadata_json: unknown;
    }>(
      `SELECT id, created_at, created_at_ms, hall_id, game_type, channel, event_type, amount, currency,
              room_code, game_id, claim_id, player_id, wallet_id, source_account_id, target_account_id,
              policy_version, batch_id, metadata_json
       FROM ${this.complianceLedgerTable()}
       ORDER BY created_at_ms DESC`
    );
    return rows.map((row) => ({
      id: row.id,
      createdAt: asIso(row.created_at),
      createdAtMs: Number(row.created_at_ms),
      hallId: row.hall_id,
      gameType: row.game_type,
      channel: row.channel,
      eventType: row.event_type,
      amount: Number(row.amount),
      currency: row.currency,
      roomCode: row.room_code ?? undefined,
      gameId: row.game_id ?? undefined,
      claimId: row.claim_id ?? undefined,
      playerId: row.player_id ?? undefined,
      walletId: row.wallet_id ?? undefined,
      sourceAccountId: row.source_account_id ?? undefined,
      targetAccountId: row.target_account_id ?? undefined,
      policyVersion: row.policy_version ?? undefined,
      batchId: row.batch_id ?? undefined,
      metadata: asJsonObject(row.metadata_json)
    }));
  }

  private async loadDailyReports(): Promise<PersistedDailyReport[]> {
    const { rows } = await this.pool.query<{ report_json: QueryResultRow }>(
      `SELECT report_json
       FROM ${this.dailyReportsTable()}
       ORDER BY date_key DESC`
    );
    return rows
      .map((row) => row.report_json as unknown as PersistedDailyReport | null)
      .filter((row): row is PersistedDailyReport => Boolean(row));
  }

  private async initializeSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.personalLossLimitsTable()} (
          wallet_id TEXT NOT NULL,
          hall_id TEXT NOT NULL,
          daily_limit NUMERIC(12, 2) NOT NULL,
          monthly_limit NUMERIC(12, 2) NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (wallet_id, hall_id)
        )`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.pendingLossLimitChangesTable()} (
          wallet_id TEXT NOT NULL,
          hall_id TEXT NOT NULL,
          daily_pending_value NUMERIC(12, 2),
          daily_effective_from_ms BIGINT,
          monthly_pending_value NUMERIC(12, 2),
          monthly_effective_from_ms BIGINT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (wallet_id, hall_id)
        )`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.restrictionsTable()} (
          wallet_id TEXT PRIMARY KEY,
          timed_pause_until TIMESTAMPTZ,
          timed_pause_set_at TIMESTAMPTZ,
          self_excluded_at TIMESTAMPTZ,
          self_exclusion_minimum_until TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.playStatesTable()} (
          wallet_id TEXT PRIMARY KEY,
          accumulated_ms BIGINT NOT NULL DEFAULT 0,
          active_from_ms BIGINT,
          pause_until_ms BIGINT,
          last_mandatory_break_json JSONB,
          games_played_in_session INT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`
      );
      await client.query(
        `ALTER TABLE ${this.playStatesTable()} ADD COLUMN IF NOT EXISTS games_played_in_session INT NOT NULL DEFAULT 0`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.lossEntriesTable()} (
          id BIGSERIAL PRIMARY KEY,
          wallet_id TEXT NOT NULL,
          hall_id TEXT NOT NULL,
          entry_type TEXT NOT NULL,
          amount NUMERIC(12, 2) NOT NULL,
          created_at_ms BIGINT NOT NULL
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_rg_loss_entries_scope
         ON ${this.lossEntriesTable()} (wallet_id, hall_id, created_at_ms DESC)`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.prizePoliciesTable()} (
          id TEXT PRIMARY KEY,
          game_type TEXT NOT NULL,
          hall_id TEXT NOT NULL,
          link_id TEXT NOT NULL,
          effective_from_ms BIGINT NOT NULL,
          single_prize_cap NUMERIC(12, 2) NOT NULL,
          daily_extra_prize_cap NUMERIC(12, 2) NOT NULL,
          created_at_ms BIGINT NOT NULL
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_rg_prize_policies_scope
         ON ${this.prizePoliciesTable()} (game_type, hall_id, link_id, effective_from_ms DESC)`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.extraPrizeEntriesTable()} (
          id BIGSERIAL PRIMARY KEY,
          hall_id TEXT NOT NULL,
          link_id TEXT NOT NULL,
          amount NUMERIC(12, 2) NOT NULL,
          created_at_ms BIGINT NOT NULL,
          policy_id TEXT NOT NULL
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_rg_extra_prizes_scope
         ON ${this.extraPrizeEntriesTable()} (hall_id, link_id, created_at_ms DESC)`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.payoutAuditTable()} (
          id TEXT PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL,
          claim_id TEXT,
          game_id TEXT,
          room_code TEXT,
          hall_id TEXT NOT NULL,
          policy_version TEXT,
          amount NUMERIC(12, 2) NOT NULL,
          currency TEXT NOT NULL,
          wallet_id TEXT NOT NULL,
          player_id TEXT,
          source_account_id TEXT,
          tx_ids_json JSONB NOT NULL,
          kind TEXT NOT NULL,
          chain_index INTEGER NOT NULL,
          previous_hash TEXT NOT NULL,
          event_hash TEXT NOT NULL
        )`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.complianceLedgerTable()} (
          id TEXT PRIMARY KEY,
          created_at TIMESTAMPTZ NOT NULL,
          created_at_ms BIGINT NOT NULL,
          hall_id TEXT NOT NULL,
          game_type TEXT NOT NULL,
          channel TEXT NOT NULL,
          event_type TEXT NOT NULL,
          amount NUMERIC(12, 2) NOT NULL,
          currency TEXT NOT NULL,
          room_code TEXT,
          game_id TEXT,
          claim_id TEXT,
          player_id TEXT,
          wallet_id TEXT,
          source_account_id TEXT,
          target_account_id TEXT,
          policy_version TEXT,
          batch_id TEXT,
          metadata_json JSONB
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_rg_ledger_wallet_date
         ON ${this.complianceLedgerTable()} (wallet_id, created_at_ms DESC)`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_rg_ledger_hall_date
         ON ${this.complianceLedgerTable()} (hall_id, created_at_ms DESC)`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.dailyReportsTable()} (
          date_key TEXT PRIMARY KEY,
          generated_at TIMESTAMPTZ NOT NULL,
          report_json JSONB NOT NULL
        )`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.overskuddBatchesTable()} (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          date TEXT NOT NULL,
          hall_id TEXT,
          game_type TEXT,
          channel TEXT,
          required_minimum REAL NOT NULL,
          distributed_amount REAL NOT NULL,
          transfers_json TEXT NOT NULL,
          allocations_json TEXT NOT NULL
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_rg_overskudd_batches_date
         ON ${this.overskuddBatchesTable()} (date DESC)`
      );

      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.hallOrganizationsTable()} (
          id TEXT PRIMARY KEY,
          hall_id TEXT NOT NULL,
          organization_id TEXT NOT NULL,
          organization_name TEXT NOT NULL,
          organization_account_id TEXT NOT NULL,
          share_percent REAL NOT NULL,
          game_type TEXT,
          channel TEXT,
          is_active INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_rg_hall_organizations_hall
         ON ${this.hallOrganizationsTable()} (hall_id)`
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private personalLossLimitsTable(): string {
    return `${this.schema}.app_rg_personal_loss_limits`;
  }

  private pendingLossLimitChangesTable(): string {
    return `${this.schema}.app_rg_pending_loss_limit_changes`;
  }

  private restrictionsTable(): string {
    return `${this.schema}.app_rg_restrictions`;
  }

  private playStatesTable(): string {
    return `${this.schema}.app_rg_play_states`;
  }

  private lossEntriesTable(): string {
    return `${this.schema}.app_rg_loss_entries`;
  }

  private prizePoliciesTable(): string {
    return `${this.schema}.app_rg_prize_policies`;
  }

  private extraPrizeEntriesTable(): string {
    return `${this.schema}.app_rg_extra_prize_entries`;
  }

  private payoutAuditTable(): string {
    return `${this.schema}.app_rg_payout_audit`;
  }

  private complianceLedgerTable(): string {
    return `${this.schema}.app_rg_compliance_ledger`;
  }

  private dailyReportsTable(): string {
    return `${this.schema}.app_rg_daily_reports`;
  }

  private overskuddBatchesTable(): string {
    return `${this.schema}.app_rg_overskudd_batches`;
  }

  private hallOrganizationsTable(): string {
    return `${this.schema}.app_rg_hall_organizations`;
  }
}
