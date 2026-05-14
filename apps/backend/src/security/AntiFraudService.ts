/**
 * BIN-806 A13: Anti-fraud / velocity-checks + bot-detection.
 *
 * Heuristikk-basert risk-assessment som kjøres pre-commit på hver
 * wallet-mutasjon (debit/credit/transfer/topup/withdraw). Returnerer
 * `low|medium|high|critical`. Pipeline-utfall:
 *   - `critical` → `WalletService` kaster `DomainError("FRAUD_RISK_CRITICAL")`
 *     og transaksjonen blokkeres FØR commit.
 *   - `high`     → tillatt, men logget som `flagged_for_review` for admin.
 *   - `medium`   → tillatt, logget som `logged`.
 *   - `low`      → tillatt, logget som `logged` (fortsatt audit-trail).
 *
 * Heuristikker (alle "stable signal codes" — admin-UI matcher disse):
 *
 *   1. **VELOCITY_HOUR**: > 10 wallet-tx siste 1h fra samme bruker
 *      → MEDIUM. > 30 → HIGH. > 60 → CRITICAL.
 *   2. **VELOCITY_DAY**: > 100 wallet-tx siste 24h → MEDIUM.
 *      > 200 → HIGH. > 500 → CRITICAL.
 *   3. **AMOUNT_DEVIATION**: > 5x brukerens 30-dagers gjennomsnitt
 *      → MEDIUM. > 10x → HIGH. > 25x → CRITICAL. Krever ≥3 historiske
 *      tx-er for å unngå false-positives mot nye spillere.
 *   4. **MULTI_ACCOUNT_IP**: > 3 unike `userId` har transaksjoner fra
 *      samme IP siste 24h → MEDIUM. > 5 → HIGH. > 10 → CRITICAL.
 *   5. **BOT_TIMING**: Ticket-marks/claims med variansanalyse på
 *      timing-deltas. StdDev < 50ms over ≥100 marks → MEDIUM-bot-mistanke.
 *      StdDev < 25ms → HIGH. StdDev < 10ms → CRITICAL. (Egen `assessBotTiming`-
 *      method — kalles av game-laget separat fra wallet-pipelinen.)
 *
 * Risk-aggregering: pipeline tar maksimumsrisiko på tvers av signaler.
 * F.eks. én VELOCITY_HOUR=MEDIUM og én MULTI_ACCOUNT_IP=HIGH → HIGH totalt.
 *
 * Alle terskler er konfigurerbare via constructor-options for at pilot-
 * justering ikke skal kreve kodeendring. Defaults dekker BIN-806's
 * spesifikasjon.
 */

import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { DomainError } from "../errors/DomainError.js";
import { getPoolTuning } from "../util/pgPool.js";
import { attachPoolErrorHandler } from "../util/pgPoolErrorHandler.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "anti-fraud-service" });

// ── Types ──────────────────────────────────────────────────────────────────

export type AntiFraudRiskLevel = "low" | "medium" | "high" | "critical";

export type AntiFraudActionTaken =
  | "logged"
  | "flagged_for_review"
  | "blocked";

export type AntiFraudOperationType =
  | "DEBIT"
  | "CREDIT"
  | "TOPUP"
  | "WITHDRAWAL"
  | "TRANSFER"
  | "OTHER";

/** Stable signal-koder. Admin-UI matcher disse for visning og forklaring. */
export type AntiFraudSignalCode =
  | "VELOCITY_HOUR"
  | "VELOCITY_DAY"
  | "AMOUNT_DEVIATION"
  | "MULTI_ACCOUNT_IP"
  | "BOT_TIMING";

export interface AntiFraudSignal {
  code: AntiFraudSignalCode;
  /** Hvor sterk denne enkelt-signalet er (uavhengig av aggregat). */
  level: AntiFraudRiskLevel;
  /** Fri-formet metadata for admin-UI (telling, terskel, observerte verdier). */
  meta: Record<string, unknown>;
}

export interface AntiFraudAssessmentInput {
  userId: string;
  hallId?: string | null;
  /** Beløp i øre (cents). 0 hvis ikke tx-relatert (f.eks. ren bot-detect-call). */
  amountCents: number;
  operationType: AntiFraudOperationType;
  ipAddress?: string | null;
  /** Wallet-tx-id når en faktisk tx allerede er committet. Optional pre-commit. */
  transactionId?: string | null;
  /** Override `now()` i tester. Ms epoch. */
  nowMs?: number;
}

export interface AntiFraudAssessment {
  risk: AntiFraudRiskLevel;
  signals: AntiFraudSignal[];
  actionTaken: AntiFraudActionTaken;
  /** ID på audit-raden som ble skrevet. */
  signalId: string;
}

export interface BotTimingInput {
  userId: string;
  /** Sortert eller usortert millisekund-stempler for marks/claims. */
  timestampsMs: number[];
  hallId?: string | null;
  /** Override `now()` i tester. Ms epoch. */
  nowMs?: number;
}

export interface AntiFraudListFilter {
  hallId?: string;
  userId?: string;
  riskLevel?: AntiFraudRiskLevel;
  actionTaken?: AntiFraudActionTaken;
  fromIso?: string;
  toIso?: string;
  limit?: number;
}

export interface PersistedAntiFraudSignal {
  id: string;
  userId: string;
  hallId: string | null;
  transactionId: string | null;
  riskLevel: AntiFraudRiskLevel;
  signals: AntiFraudSignal[];
  actionTaken: AntiFraudActionTaken;
  ipAddress: string | null;
  amountCents: number | null;
  operationType: AntiFraudOperationType | null;
  assessedAt: string;
}

export interface AntiFraudThresholds {
  velocityHour: { medium: number; high: number; critical: number };
  velocityDay: { medium: number; high: number; critical: number };
  amountDeviation: { medium: number; high: number; critical: number; minHistorySamples: number };
  multiAccountIp: { medium: number; high: number; critical: number };
  botTimingStdDevMs: { medium: number; high: number; critical: number; minSamples: number };
}

export const DEFAULT_THRESHOLDS: AntiFraudThresholds = {
  velocityHour: { medium: 10, high: 30, critical: 60 },
  velocityDay: { medium: 100, high: 200, critical: 500 },
  amountDeviation: { medium: 5, high: 10, critical: 25, minHistorySamples: 3 },
  multiAccountIp: { medium: 3, high: 5, critical: 10 },
  botTimingStdDevMs: { medium: 50, high: 25, critical: 10, minSamples: 100 },
};

export interface AntiFraudServiceOptions {
  pool?: Pool;
  connectionString?: string;
  schema?: string;
  thresholds?: Partial<AntiFraudThresholds>;
  nowMs?: () => number;
  ipCacheTtlMs?: number;
}

interface IpObservation {
  users: Set<string>;
  expiresAt: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function assertSchemaName(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schema)) {
    throw new DomainError("INVALID_CONFIG", "Ugyldig schema-navn.");
  }
  return schema;
}

function asIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}

function mergeThresholds(
  defaults: AntiFraudThresholds,
  override?: Partial<AntiFraudThresholds>,
): AntiFraudThresholds {
  if (!override) return defaults;
  return {
    velocityHour: { ...defaults.velocityHour, ...override.velocityHour },
    velocityDay: { ...defaults.velocityDay, ...override.velocityDay },
    amountDeviation: { ...defaults.amountDeviation, ...override.amountDeviation },
    multiAccountIp: { ...defaults.multiAccountIp, ...override.multiAccountIp },
    botTimingStdDevMs: { ...defaults.botTimingStdDevMs, ...override.botTimingStdDevMs },
  };
}

const RISK_RANK: Record<AntiFraudRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function maxRisk(a: AntiFraudRiskLevel, b: AntiFraudRiskLevel): AntiFraudRiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

export function actionForRisk(risk: AntiFraudRiskLevel): AntiFraudActionTaken {
  if (risk === "critical") return "blocked";
  if (risk === "high") return "flagged_for_review";
  return "logged";
}

export function computeTimingStdDev(timestampsMs: number[]): number | null {
  if (timestampsMs.length < 2) return null;
  const sorted = [...timestampsMs].sort((a, b) => a - b);
  const deltas: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    deltas.push(sorted[i]! - sorted[i - 1]!);
  }
  if (deltas.length === 0) return null;
  const mean = deltas.reduce((s, d) => s + d, 0) / deltas.length;
  const variance =
    deltas.reduce((s, d) => s + (d - mean) * (d - mean), 0) / deltas.length;
  return Math.sqrt(variance);
}

// ── Service ────────────────────────────────────────────────────────────────

export class AntiFraudService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly thresholds: AntiFraudThresholds;
  private readonly now: () => number;
  private readonly ipCacheTtlMs: number;
  private readonly ipObservations = new Map<string, IpObservation>();
  private initPromise: Promise<void> | null = null;

  constructor(options: AntiFraudServiceOptions) {
    this.schema = assertSchemaName(options.schema ?? "public");
    if (options.pool) {
      this.pool = options.pool;
    } else if (options.connectionString && options.connectionString.trim()) {
      this.pool = new Pool({
        connectionString: options.connectionString,
        ...getPoolTuning(),
      });
      // Agent T (2026-05-14): attach error-handler så pg-errors (57P01 etc) ikke
      // propagerer som uncaughtException og dreper backend. Se Sentry-issue
      // SPILLORAMA-BACKEND-5 (2026-05-14) for root cause.
      attachPoolErrorHandler(this.pool, { poolName: "anti-fraud-service-pool" });
    } else {
      throw new DomainError(
        "INVALID_CONFIG",
        "AntiFraudService krever pool eller connectionString.",
      );
    }
    this.thresholds = mergeThresholds(DEFAULT_THRESHOLDS, options.thresholds);
    this.now = options.nowMs ?? (() => Date.now());
    this.ipCacheTtlMs = options.ipCacheTtlMs ?? 24 * 60 * 60 * 1000;
  }

  static forTesting(
    pool: Pool,
    options: Partial<Omit<AntiFraudServiceOptions, "pool">> = {},
  ): AntiFraudService {
    const svc = Object.create(AntiFraudService.prototype) as AntiFraudService;
    (svc as unknown as { pool: Pool }).pool = pool;
    (svc as unknown as { schema: string }).schema = assertSchemaName(options.schema ?? "public");
    (svc as unknown as { thresholds: AntiFraudThresholds }).thresholds = mergeThresholds(
      DEFAULT_THRESHOLDS,
      options.thresholds,
    );
    (svc as unknown as { now: () => number }).now = options.nowMs ?? (() => Date.now());
    (svc as unknown as { ipCacheTtlMs: number }).ipCacheTtlMs =
      options.ipCacheTtlMs ?? 24 * 60 * 60 * 1000;
    (svc as unknown as { ipObservations: Map<string, IpObservation> }).ipObservations = new Map();
    (svc as unknown as { initPromise: Promise<void> | null }).initPromise = Promise.resolve();
    return svc;
  }

  private signalsTable(): string {
    return `"${this.schema}"."app_anti_fraud_signals"`;
  }

  private walletTxTable(): string {
    return `"${this.schema}"."wallet_transactions"`;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  async assessTransaction(input: AntiFraudAssessmentInput): Promise<AntiFraudAssessment> {
    await this.ensureInitialized();
    const nowMs = input.nowMs ?? this.now();
    const signals: AntiFraudSignal[] = [];

    const velocity = await this.runVelocityCheck(input.userId, nowMs);
    if (velocity.hourSignal) signals.push(velocity.hourSignal);
    if (velocity.daySignal) signals.push(velocity.daySignal);

    if (input.amountCents > 0) {
      const amount = await this.runAmountDeviationCheck(
        input.userId,
        input.amountCents,
        nowMs,
      );
      if (amount) signals.push(amount);
    }

    if (input.ipAddress && input.ipAddress.trim()) {
      this.recordIpObservation(input.ipAddress.trim(), input.userId, nowMs);
      const ipSignal = this.runMultiAccountIpCheck(input.ipAddress.trim(), nowMs);
      if (ipSignal) signals.push(ipSignal);
    }

    let risk: AntiFraudRiskLevel = "low";
    for (const s of signals) {
      risk = maxRisk(risk, s.level);
    }
    const actionTaken = actionForRisk(risk);

    const signalId = randomUUID();
    await this.persistSignal({
      id: signalId,
      userId: input.userId,
      hallId: input.hallId ?? null,
      transactionId: input.transactionId ?? null,
      riskLevel: risk,
      signals,
      actionTaken,
      ipAddress: input.ipAddress ?? null,
      amountCents: input.amountCents > 0 ? input.amountCents : null,
      operationType: input.operationType,
      assessedAtMs: nowMs,
    });

    return { risk, signals, actionTaken, signalId };
  }

  async assessBotTiming(input: BotTimingInput): Promise<AntiFraudAssessment> {
    await this.ensureInitialized();
    const nowMs = input.nowMs ?? this.now();
    const signals: AntiFraudSignal[] = [];
    const botSignal = this.runBotTimingCheck(input.timestampsMs);
    if (botSignal) signals.push(botSignal);

    let risk: AntiFraudRiskLevel = "low";
    for (const s of signals) {
      risk = maxRisk(risk, s.level);
    }
    const actionTaken = actionForRisk(risk);

    const signalId = randomUUID();
    await this.persistSignal({
      id: signalId,
      userId: input.userId,
      hallId: input.hallId ?? null,
      transactionId: null,
      riskLevel: risk,
      signals,
      actionTaken,
      ipAddress: null,
      amountCents: null,
      operationType: "OTHER",
      assessedAtMs: nowMs,
    });

    return { risk, signals, actionTaken, signalId };
  }

  async listSignals(filter: AntiFraudListFilter = {}): Promise<PersistedAntiFraudSignal[]> {
    await this.ensureInitialized();
    const limit =
      filter.limit && filter.limit > 0 ? Math.min(Math.floor(filter.limit), 500) : 100;
    const params: unknown[] = [];
    const conditions: string[] = [];
    if (filter.hallId) {
      params.push(filter.hallId);
      conditions.push(`hall_id = $${params.length}`);
    }
    if (filter.userId) {
      params.push(filter.userId);
      conditions.push(`user_id = $${params.length}`);
    }
    if (filter.riskLevel) {
      params.push(filter.riskLevel);
      conditions.push(`risk_level = $${params.length}`);
    }
    if (filter.actionTaken) {
      params.push(filter.actionTaken);
      conditions.push(`action_taken = $${params.length}`);
    }
    if (filter.fromIso) {
      const ms = Date.parse(filter.fromIso);
      if (!Number.isFinite(ms)) {
        throw new DomainError("INVALID_INPUT", "fromDate må være ISO-8601.");
      }
      params.push(new Date(ms).toISOString());
      conditions.push(`assessed_at >= $${params.length}`);
    }
    if (filter.toIso) {
      const ms = Date.parse(filter.toIso);
      if (!Number.isFinite(ms)) {
        throw new DomainError("INVALID_INPUT", "toDate må være ISO-8601.");
      }
      params.push(new Date(ms).toISOString());
      conditions.push(`assessed_at <= $${params.length}`);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);
    const sql = `
      SELECT id, user_id, hall_id, transaction_id, risk_level, signals_json,
             action_taken, ip_address, amount_cents, operation_type, assessed_at
        FROM ${this.signalsTable()}
        ${where}
       ORDER BY assessed_at DESC
       LIMIT $${params.length}
    `;
    const { rows } = await this.pool.query<{
      id: string;
      user_id: string;
      hall_id: string | null;
      transaction_id: string | null;
      risk_level: AntiFraudRiskLevel;
      signals_json: AntiFraudSignal[] | string | null;
      action_taken: AntiFraudActionTaken;
      ip_address: string | null;
      amount_cents: string | number | null;
      operation_type: AntiFraudOperationType | null;
      assessed_at: Date | string;
    }>(sql, params);
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      hallId: r.hall_id,
      transactionId: r.transaction_id,
      riskLevel: r.risk_level,
      signals: this.parseSignalsJson(r.signals_json),
      actionTaken: r.action_taken,
      ipAddress: r.ip_address,
      amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
      operationType: r.operation_type,
      assessedAt: asIso(r.assessed_at),
    }));
  }

  // ── Heuristikker ─────────────────────────────────────────────────────────

  private async runVelocityCheck(
    userId: string,
    nowMs: number,
  ): Promise<{ hourSignal?: AntiFraudSignal; daySignal?: AntiFraudSignal }> {
    const hourAgoIso = new Date(nowMs - 60 * 60 * 1000).toISOString();
    const dayAgoIso = new Date(nowMs - 24 * 60 * 60 * 1000).toISOString();
    let hourCount = 0;
    let dayCount = 0;
    try {
      const result = await this.pool.query<{ window: string; cnt: string | number }>(
        `SELECT 'hour' AS window, COUNT(*)::bigint AS cnt
           FROM ${this.walletTxTable()}
          WHERE user_id = $1 AND created_at >= $2
         UNION ALL
         SELECT 'day' AS window, COUNT(*)::bigint AS cnt
           FROM ${this.walletTxTable()}
          WHERE user_id = $1 AND created_at >= $3`,
        [userId, hourAgoIso, dayAgoIso],
      );
      for (const row of result.rows) {
        const c = Number(row.cnt);
        if (row.window === "hour") hourCount = c;
        if (row.window === "day") dayCount = c;
      }
    } catch (err) {
      logger.warn(
        { err, userId },
        "[BIN-806 A13] velocity-check feilet — fortsetter uten signal",
      );
      return {};
    }
    return {
      hourSignal: this.buildVelocitySignal("VELOCITY_HOUR", hourCount, this.thresholds.velocityHour),
      daySignal: this.buildVelocitySignal("VELOCITY_DAY", dayCount, this.thresholds.velocityDay),
    };
  }

  private buildVelocitySignal(
    code: "VELOCITY_HOUR" | "VELOCITY_DAY",
    count: number,
    thresholds: { medium: number; high: number; critical: number },
  ): AntiFraudSignal | undefined {
    let level: AntiFraudRiskLevel | null = null;
    let breached: number | null = null;
    if (count > thresholds.critical) {
      level = "critical";
      breached = thresholds.critical;
    } else if (count > thresholds.high) {
      level = "high";
      breached = thresholds.high;
    } else if (count > thresholds.medium) {
      level = "medium";
      breached = thresholds.medium;
    }
    if (!level) return undefined;
    return {
      code,
      level,
      meta: { count, threshold: breached, thresholds },
    };
  }

  private async runAmountDeviationCheck(
    userId: string,
    amountCents: number,
    nowMs: number,
  ): Promise<AntiFraudSignal | undefined> {
    const thirtyDaysAgoIso = new Date(nowMs - 30 * 24 * 60 * 60 * 1000).toISOString();
    let avgAmountCents = 0;
    let sampleCount = 0;
    try {
      const result = await this.pool.query<{ avg_cents: string | null; cnt: string | number }>(
        `SELECT AVG(amount)::numeric(20,4) AS avg_cents, COUNT(*)::bigint AS cnt
           FROM ${this.walletTxTable()}
          WHERE user_id = $1 AND created_at >= $2 AND amount > 0`,
        [userId, thirtyDaysAgoIso],
      );
      const row = result.rows[0];
      if (row) {
        avgAmountCents = row.avg_cents === null ? 0 : Number(row.avg_cents);
        sampleCount = Number(row.cnt);
      }
    } catch (err) {
      logger.warn(
        { err, userId },
        "[BIN-806 A13] amount-deviation-check feilet — fortsetter uten signal",
      );
      return undefined;
    }
    if (sampleCount < this.thresholds.amountDeviation.minHistorySamples || avgAmountCents <= 0) {
      return undefined;
    }
    const ratio = amountCents / avgAmountCents;
    const t = this.thresholds.amountDeviation;
    let level: AntiFraudRiskLevel | null = null;
    let breached: number | null = null;
    if (ratio > t.critical) {
      level = "critical";
      breached = t.critical;
    } else if (ratio > t.high) {
      level = "high";
      breached = t.high;
    } else if (ratio > t.medium) {
      level = "medium";
      breached = t.medium;
    }
    if (!level) return undefined;
    return {
      code: "AMOUNT_DEVIATION",
      level,
      meta: {
        amountCents,
        averageCents: Math.round(avgAmountCents),
        ratio: Number(ratio.toFixed(2)),
        thresholdMultiplier: breached,
        sampleCount,
      },
    };
  }

  private recordIpObservation(ip: string, userId: string, nowMs: number): void {
    this.purgeExpiredIps(nowMs);
    const expiresAt = nowMs + this.ipCacheTtlMs;
    const existing = this.ipObservations.get(ip);
    if (existing && existing.expiresAt > nowMs) {
      existing.users.add(userId);
      existing.expiresAt = expiresAt;
    } else {
      this.ipObservations.set(ip, {
        users: new Set([userId]),
        expiresAt,
      });
    }
  }

  private runMultiAccountIpCheck(
    ip: string,
    nowMs: number,
  ): AntiFraudSignal | undefined {
    this.purgeExpiredIps(nowMs);
    const obs = this.ipObservations.get(ip);
    if (!obs) return undefined;
    const uniqueUsers = obs.users.size;
    const t = this.thresholds.multiAccountIp;
    let level: AntiFraudRiskLevel | null = null;
    let breached: number | null = null;
    if (uniqueUsers > t.critical) {
      level = "critical";
      breached = t.critical;
    } else if (uniqueUsers > t.high) {
      level = "high";
      breached = t.high;
    } else if (uniqueUsers > t.medium) {
      level = "medium";
      breached = t.medium;
    }
    if (!level) return undefined;
    return {
      code: "MULTI_ACCOUNT_IP",
      level,
      meta: {
        ip,
        uniqueUsers,
        threshold: breached,
        thresholds: t,
      },
    };
  }

  private purgeExpiredIps(nowMs: number): void {
    for (const [ip, obs] of this.ipObservations) {
      if (obs.expiresAt <= nowMs) {
        this.ipObservations.delete(ip);
      }
    }
  }

  private runBotTimingCheck(timestampsMs: number[]): AntiFraudSignal | undefined {
    const t = this.thresholds.botTimingStdDevMs;
    if (timestampsMs.length < t.minSamples) return undefined;
    const stdDev = computeTimingStdDev(timestampsMs);
    if (stdDev === null) return undefined;
    let level: AntiFraudRiskLevel | null = null;
    let breached: number | null = null;
    if (stdDev < t.critical) {
      level = "critical";
      breached = t.critical;
    } else if (stdDev < t.high) {
      level = "high";
      breached = t.high;
    } else if (stdDev < t.medium) {
      level = "medium";
      breached = t.medium;
    }
    if (!level) return undefined;
    return {
      code: "BOT_TIMING",
      level,
      meta: {
        stdDevMs: Number(stdDev.toFixed(2)),
        thresholdMs: breached,
        sampleCount: timestampsMs.length,
        thresholds: t,
      },
    };
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  private async persistSignal(input: {
    id: string;
    userId: string;
    hallId: string | null;
    transactionId: string | null;
    riskLevel: AntiFraudRiskLevel;
    signals: AntiFraudSignal[];
    actionTaken: AntiFraudActionTaken;
    ipAddress: string | null;
    amountCents: number | null;
    operationType: AntiFraudOperationType | null;
    assessedAtMs: number;
  }): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO ${this.signalsTable()}
           (id, user_id, hall_id, transaction_id, risk_level, signals_json,
            action_taken, ip_address, amount_cents, operation_type, assessed_at)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
        [
          input.id,
          input.userId,
          input.hallId,
          input.transactionId,
          input.riskLevel,
          JSON.stringify(input.signals),
          input.actionTaken,
          input.ipAddress,
          input.amountCents,
          input.operationType,
          new Date(input.assessedAtMs).toISOString(),
        ],
      );
    } catch (err) {
      logger.warn(
        { err, signalId: input.id, userId: input.userId },
        "[BIN-806 A13] persist-signal feilet — assessment returnert uansett",
      );
    }
  }

  private parseSignalsJson(value: AntiFraudSignal[] | string | null): AntiFraudSignal[] {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeSchema();
    }
    await this.initPromise;
  }

  private async initializeSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE SCHEMA IF NOT EXISTS "${this.schema}"`);
      await client.query(
        `CREATE TABLE IF NOT EXISTS ${this.signalsTable()} (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          hall_id TEXT NULL,
          transaction_id TEXT NULL,
          risk_level TEXT NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
          signals_json JSONB NOT NULL DEFAULT '[]'::jsonb,
          action_taken TEXT NOT NULL CHECK (action_taken IN ('logged','flagged_for_review','blocked')),
          ip_address TEXT NULL,
          amount_cents BIGINT NULL,
          operation_type TEXT NULL,
          assessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`,
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_app_anti_fraud_signals_review_queue
           ON ${this.signalsTable()} (assessed_at DESC)
           WHERE action_taken IN ('flagged_for_review', 'blocked')`,
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_app_anti_fraud_signals_hall
           ON ${this.signalsTable()} (hall_id, assessed_at DESC)
           WHERE hall_id IS NOT NULL`,
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_app_anti_fraud_signals_user
           ON ${this.signalsTable()} (user_id, assessed_at DESC)`,
      );
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_app_anti_fraud_signals_risk_level
           ON ${this.signalsTable()} (risk_level, assessed_at DESC)`,
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      logger.warn(
        { err },
        "[BIN-806 A13] initializeSchema feilet — service vil ikke kunne persistere signaler",
      );
      this.initPromise = null;
      throw err;
    } finally {
      client.release();
    }
  }
}
