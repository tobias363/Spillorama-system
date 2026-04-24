/**
 * Profile Settings Service (BIN-720).
 *
 * Selv-service-endepunkter for spillere, fra wireframe-PDF 8 (Frontend CR
 * 21.02.2024) + PDF 9 (Frontend CR 2024):
 *   - Daglig + månedlig tapsgrense. Senking er umiddelbar. Økning
 *     lagres i `app_rg_pending_loss_limit_changes` med 48h-forsinkelse
 *     før den blir aktiv.
 *   - Block-myself (1d/7d/30d/1y/permanent). 1d/7d/30d bruker
 *     `app_user_profile_settings.blocked_until`. `1y`/`permanent`
 *     bruker `app_rg_restrictions` (eksisterende selvutelukkelse).
 *   - Language (nb-NO / en-US).
 *   - Pause (cooldown-pause) — wrapper over ComplianceManager.setTimedPause.
 *
 * Design-prinsipper:
 *   - ComplianceManager er single source of truth for loss-enforcement
 *     under gameplay. Denne servicen duplicerer IKKE den logikken; den
 *     bruker persistence-adapteren direkte for 48h-queue-timingen, og
 *     snapshotten leses fra ComplianceManager.
 *   - Audit-log alle endringer.
 *   - Fail-closed: Hvis DB er nede kastes feilen opp (ikke fire-and-forget
 *     fordi spilleren må vite om endringen ble lagret).
 *   - Per-hall-loss-limits: PDF spesifiserer ett sett per spiller. For
 *     å være konservativt i MVP speiler vi innstillingen til ALLE
 *     spillerens aktive haller ved oppdatering. Spillere som er bundet
 *     til én hall (vanlig case per user_hall_binding) får dermed én
 *     konsistent verdi.
 */

import type { Pool } from "pg";
import { DomainError } from "../game/BingoEngine.js";
import type { BingoEngine } from "../game/BingoEngine.js";
import type { PlayerComplianceSnapshot } from "../game/ComplianceManagerTypes.js";
import type { ResponsibleGamingPersistenceAdapter } from "../game/ResponsibleGamingPersistence.js";
import type { AuditLogService, AuditActorType } from "./AuditLogService.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "profile-settings" });

// 48h i millisekunder — spesifisert av wireframe-krav.
const LOSS_LIMIT_INCREASE_DELAY_MS = 48 * 60 * 60 * 1000;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const SUPPORTED_LANGUAGES = ["nb-NO", "en-US"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const SELF_EXCLUDE_DURATIONS = ["1d", "7d", "30d", "1y", "permanent"] as const;
export type SelfExcludeDuration = (typeof SELF_EXCLUDE_DURATIONS)[number];

function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

function isSelfExcludeDuration(value: unknown): value is SelfExcludeDuration {
  return typeof value === "string" && (SELF_EXCLUDE_DURATIONS as readonly string[]).includes(value);
}

export interface ProfileSettingsView {
  userId: string;
  walletId: string;
  language: SupportedLanguage;
  hallId: string | null;
  lossLimits: {
    daily: number;
    monthly: number;
    regulatory: { daily: number; monthly: number };
  };
  pendingLossLimits: {
    daily?: { value: number; effectiveAt: string };
    monthly?: { value: number; effectiveAt: string };
  };
  block: {
    blockedUntil: string | null;
    reason: string | null;
    /** Ikke-utløpt 1y/permanent selvutelukkelse fra ComplianceManager. */
    selfExcludedUntil: string | null;
  };
  pause: {
    pausedUntil: string | null;
  };
}

export interface ProfileSettingsServiceDeps {
  pool: Pool;
  schema?: string;
  engine: BingoEngine;
  rgPersistence: ResponsibleGamingPersistenceAdapter;
  auditLogService: AuditLogService;
  /** Overstyres i tester for 48h-queue-verifisering. */
  now?: () => number;
  /** Overstyres i tester for å forkorte 48h. Default 48h. */
  lossLimitIncreaseDelayMs?: number;
}

interface ProfileSettingsRow {
  user_id: string;
  language: string;
  blocked_until: Date | string | null;
  blocked_reason: string | null;
}

interface UserLookupRow {
  id: string;
  wallet_id: string;
  hall_id: string | null;
  role: string;
}

function schemaIdent(schema: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) {
    throw new Error("Ugyldig schema-navn for ProfileSettingsService.");
  }
  return `"${schema}"`;
}

export class ProfileSettingsService {
  private readonly pool: Pool;
  private readonly schema: string;
  private readonly engine: BingoEngine;
  private readonly rgPersistence: ResponsibleGamingPersistenceAdapter;
  private readonly audit: AuditLogService;
  private readonly now: () => number;
  private readonly lossLimitIncreaseDelayMs: number;

  constructor(deps: ProfileSettingsServiceDeps) {
    this.pool = deps.pool;
    this.schema = deps.schema || "public";
    this.engine = deps.engine;
    this.rgPersistence = deps.rgPersistence;
    this.audit = deps.auditLogService;
    this.now = deps.now ?? (() => Date.now());
    this.lossLimitIncreaseDelayMs = deps.lossLimitIncreaseDelayMs ?? LOSS_LIMIT_INCREASE_DELAY_MS;
  }

  // ── Table helpers ────────────────────────────────────────────────

  private profileTable(): string {
    return `${schemaIdent(this.schema)}."app_user_profile_settings"`;
  }

  private usersTable(): string {
    return `${schemaIdent(this.schema)}."app_users"`;
  }

  // ── Public API ───────────────────────────────────────────────────

  async getSettings(userId: string): Promise<ProfileSettingsView> {
    const user = await this.loadUser(userId);
    const row = await this.loadProfileRow(user.id);
    const complianceSnapshot = this.engine.getPlayerCompliance(user.wallet_id, user.hall_id ?? undefined);
    return this.renderView(user, row, complianceSnapshot);
  }

  /**
   * Gate-metode for gameplay/login: kaster `PLAYER_BLOCKED`-feil hvis
   * spilleren har en aktiv time-based block-myself (1d/7d/30d). 1y/permanent-
   * selvutelukkelse håndheves av ComplianceManager.assertWalletAllowedForGameplay.
   */
  async assertUserNotBlocked(userId: string, nowMs = this.now()): Promise<void> {
    const { rows } = await this.pool.query<{ blocked_until: Date | string | null }>(
      `SELECT blocked_until FROM ${this.profileTable()} WHERE user_id = $1`,
      [userId]
    );
    const row = rows[0];
    if (!row || !row.blocked_until) return;
    const blockedUntilMs =
      row.blocked_until instanceof Date
        ? row.blocked_until.getTime()
        : new Date(row.blocked_until).getTime();
    if (blockedUntilMs > nowMs) {
      throw new DomainError(
        "PLAYER_BLOCKED",
        `Spiller er blokkert til ${new Date(blockedUntilMs).toISOString()}.`
      );
    }
  }

  async updateLossLimits(input: {
    userId: string;
    actor: { type: AuditActorType; ipAddress?: string | null; userAgent?: string | null };
    daily?: number;
    monthly?: number;
  }): Promise<ProfileSettingsView> {
    const user = await this.loadUser(input.userId);
    const hallId = user.hall_id;
    if (!hallId) {
      throw new DomainError(
        "HALL_BINDING_REQUIRED",
        "Spilleren må være bundet til en hall for å sette tapsgrenser."
      );
    }
    if (input.daily === undefined && input.monthly === undefined) {
      throw new DomainError("INVALID_INPUT", "dailyLossLimit eller monthlyLossLimit må oppgis.");
    }
    this.assertLossLimit(input.daily, "daily");
    this.assertLossLimit(input.monthly, "monthly");

    const nowMs = this.now();
    const before = this.engine.getPlayerCompliance(user.wallet_id, hallId);
    const current = before.personalLossLimits;
    const regulatory = before.regulatoryLossLimits;

    // Split: senking umiddelbart. Økning lagres som pending med
    // effectiveFromMs = now + 48h. ComplianceManager-metoden
    // setPlayerLossLimitsWithEffectiveAt håndterer begge deler atomisk,
    // så in-memory cachen og persistence er i sync.
    const updateArgs: {
      daily?: { value: number; effectiveFromMs: number };
      monthly?: { value: number; effectiveFromMs: number };
      dailyDecrease?: number;
      monthlyDecrease?: number;
    } = {};
    const increases: Array<{ field: "daily" | "monthly"; value: number; effectiveAtMs: number }> = [];

    if (input.daily !== undefined) {
      const next = Math.floor(input.daily);
      if (next > regulatory.daily) {
        throw new DomainError(
          "INVALID_INPUT",
          `dailyLossLimit kan ikke være høyere enn regulatorisk grense (${regulatory.daily}).`
        );
      }
      if (next <= current.daily) {
        updateArgs.dailyDecrease = next;
      } else {
        const effectiveAtMs = nowMs + this.lossLimitIncreaseDelayMs;
        updateArgs.daily = { value: next, effectiveFromMs: effectiveAtMs };
        increases.push({ field: "daily", value: next, effectiveAtMs });
      }
    }
    if (input.monthly !== undefined) {
      const next = Math.floor(input.monthly);
      if (next > regulatory.monthly) {
        throw new DomainError(
          "INVALID_INPUT",
          `monthlyLossLimit kan ikke være høyere enn regulatorisk grense (${regulatory.monthly}).`
        );
      }
      if (next <= current.monthly) {
        updateArgs.monthlyDecrease = next;
      } else {
        const effectiveAtMs = nowMs + this.lossLimitIncreaseDelayMs;
        updateArgs.monthly = { value: next, effectiveFromMs: effectiveAtMs };
        increases.push({ field: "monthly", value: next, effectiveAtMs });
      }
    }

    // Ingen reell endring — returnér snapshot uten å røre stores.
    if (Object.keys(updateArgs).length === 0) {
      return this.getSettings(user.id);
    }

    await this.engine.setPlayerLossLimitsWithEffectiveAt({
      walletId: user.wallet_id,
      hallId,
      ...updateArgs,
    });

    const after = await this.getSettings(user.id);
    const diff = this.computeLossLimitDiff(before, after);
    await this.writeAudit({
      actor: input.actor,
      action: "profile.loss_limits.update",
      userId: user.id,
      details: { diff, increases: increases.map((i) => ({ ...i })) },
    });

    return after;
  }

  async selfExclude(input: {
    userId: string;
    actor: { type: AuditActorType; ipAddress?: string | null; userAgent?: string | null };
    duration: SelfExcludeDuration;
  }): Promise<ProfileSettingsView> {
    if (!isSelfExcludeDuration(input.duration)) {
      throw new DomainError(
        "INVALID_INPUT",
        "duration må være én av '1d', '7d', '30d', '1y', 'permanent'."
      );
    }

    const user = await this.loadUser(input.userId);
    const nowMs = this.now();

    if (input.duration === "1y" || input.duration === "permanent") {
      // 1y/permanent -> delegér til ComplianceManager (eksisterende
      // self-exclusion bruker hardkodet 1-år-minimum; permanent-varianten
      // er samme mekanisme med blocked_until også satt til null slik at
      // admin-manuelt må fjerne den).
      await this.engine.setSelfExclusion(user.wallet_id);
      await this.clearBlockedUntil(user.id);
    } else {
      const days = input.duration === "1d" ? 1 : input.duration === "7d" ? 7 : 30;
      const untilMs = nowMs + days * MS_PER_DAY;
      await this.upsertBlockedUntil(user.id, new Date(untilMs), `self-exclude-${input.duration}`);
    }

    const after = await this.getSettings(user.id);
    await this.writeAudit({
      actor: input.actor,
      action: "profile.self_exclude.set",
      userId: user.id,
      details: {
        duration: input.duration,
        blockedUntil: after.block.blockedUntil,
        selfExcludedUntil: after.block.selfExcludedUntil,
      },
    });
    return after;
  }

  async setLanguage(input: {
    userId: string;
    actor: { type: AuditActorType; ipAddress?: string | null; userAgent?: string | null };
    language: unknown;
  }): Promise<ProfileSettingsView> {
    if (!isSupportedLanguage(input.language)) {
      throw new DomainError(
        "INVALID_INPUT",
        "language må være 'nb-NO' eller 'en-US'."
      );
    }

    const user = await this.loadUser(input.userId);
    const before = await this.loadProfileRow(user.id);
    await this.pool.query(
      `INSERT INTO ${this.profileTable()} (user_id, language, created_at, updated_at)
       VALUES ($1, $2, now(), now())
       ON CONFLICT (user_id) DO UPDATE SET language = EXCLUDED.language`,
      [user.id, input.language]
    );

    const after = await this.getSettings(user.id);
    if (!before || before.language !== input.language) {
      await this.writeAudit({
        actor: input.actor,
        action: "profile.language.set",
        userId: user.id,
        details: {
          from: before?.language ?? "nb-NO",
          to: input.language,
        },
      });
    }
    return after;
  }

  async setPause(input: {
    userId: string;
    actor: { type: AuditActorType; ipAddress?: string | null; userAgent?: string | null };
    durationMinutes: number;
  }): Promise<ProfileSettingsView> {
    if (!Number.isFinite(input.durationMinutes) || input.durationMinutes <= 0) {
      throw new DomainError("INVALID_INPUT", "durationMinutes må være større enn 0.");
    }

    const user = await this.loadUser(input.userId);
    await this.engine.setTimedPause({
      walletId: user.wallet_id,
      durationMinutes: Math.floor(input.durationMinutes),
    });

    const after = await this.getSettings(user.id);
    await this.writeAudit({
      actor: input.actor,
      action: "profile.pause.set",
      userId: user.id,
      details: {
        durationMinutes: Math.floor(input.durationMinutes),
        pausedUntil: after.pause.pausedUntil,
      },
    });
    return after;
  }

  /**
   * 48h-queue cron: flush ventende loss-limit-endringer der
   * `effective_at <= now()`. Kjøres av `profile-pending-loss-limits-flush`
   * jobben (se src/jobs/). Returnerer antall aktiverte rader.
   *
   * Implementasjon: henter (wallet_id, hall_id) for pending-rader som har
   * passert fristen, og kaller `engine.getPlayerCompliance(...)` for hver.
   * `ComplianceManager.resolveLossLimitState` promoterer automatisk pending
   * → active når `effectiveFromMs <= nowMs`, persisterer, og fjerner raden
   * fra pending-tabellen. Dette holder in-memory-cache og DB synkronisert.
   */
  async flushPendingLossLimits(nowMs = this.now()): Promise<number> {
    const { rows } = await this.pool.query<{
      wallet_id: string;
      hall_id: string;
      daily_pending_value: string | null;
      daily_effective_from_ms: string | null;
      monthly_pending_value: string | null;
      monthly_effective_from_ms: string | null;
    }>(
      `SELECT wallet_id, hall_id, daily_pending_value, daily_effective_from_ms,
              monthly_pending_value, monthly_effective_from_ms
         FROM ${schemaIdent(this.schema)}."app_rg_pending_loss_limit_changes"
        WHERE (daily_effective_from_ms IS NOT NULL AND daily_effective_from_ms <= $1)
           OR (monthly_effective_from_ms IS NOT NULL AND monthly_effective_from_ms <= $1)`,
      [nowMs]
    );

    let activated = 0;
    for (const row of rows) {
      try {
        const changed = await this.engine.promotePendingLossLimitIfDue(row.wallet_id, row.hall_id, nowMs);
        if (changed) activated++;
      } catch (err) {
        logger.warn({ err, walletId: row.wallet_id, hallId: row.hall_id }, "pending loss-limit flush failed");
      }
    }

    if (activated > 0) {
      logger.info({ activated }, "pending loss-limit changes activated (48h flush)");
    }
    return activated;
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async loadUser(userIdInput: string): Promise<UserLookupRow> {
    const userId = String(userIdInput ?? "").trim();
    if (!userId) {
      throw new DomainError("INVALID_INPUT", "userId mangler.");
    }
    const { rows } = await this.pool.query<UserLookupRow>(
      `SELECT id, wallet_id, hall_id, role FROM ${this.usersTable()} WHERE id = $1`,
      [userId]
    );
    if (!rows[0]) {
      throw new DomainError("USER_NOT_FOUND", "Bruker finnes ikke.");
    }
    return rows[0];
  }

  private async loadProfileRow(userId: string): Promise<ProfileSettingsRow | null> {
    const { rows } = await this.pool.query<ProfileSettingsRow>(
      `SELECT user_id, language, blocked_until, blocked_reason
         FROM ${this.profileTable()}
        WHERE user_id = $1`,
      [userId]
    );
    return rows[0] ?? null;
  }

  private async upsertBlockedUntil(userId: string, blockedUntil: Date, reason: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO ${this.profileTable()} (user_id, language, blocked_until, blocked_reason, created_at, updated_at)
       VALUES ($1, 'nb-NO', $2, $3, now(), now())
       ON CONFLICT (user_id) DO UPDATE
         SET blocked_until = EXCLUDED.blocked_until,
             blocked_reason = EXCLUDED.blocked_reason`,
      [userId, blockedUntil, reason]
    );
  }

  private async clearBlockedUntil(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ${this.profileTable()}
          SET blocked_until = NULL, blocked_reason = NULL
        WHERE user_id = $1`,
      [userId]
    );
  }

  private renderView(
    user: UserLookupRow,
    row: ProfileSettingsRow | null,
    compliance: PlayerComplianceSnapshot
  ): ProfileSettingsView {
    const blockedUntilRaw = row?.blocked_until ?? null;
    const blockedUntilIso = blockedUntilRaw
      ? blockedUntilRaw instanceof Date
        ? blockedUntilRaw.toISOString()
        : new Date(blockedUntilRaw).toISOString()
      : null;
    // Utløpt block_until skal ikke vises som aktiv.
    const nowMs = this.now();
    const blockedActive = blockedUntilIso && new Date(blockedUntilIso).getTime() > nowMs ? blockedUntilIso : null;

    return {
      userId: user.id,
      walletId: user.wallet_id,
      language: (row?.language as SupportedLanguage) || "nb-NO",
      hallId: user.hall_id ?? null,
      lossLimits: {
        daily: compliance.personalLossLimits.daily,
        monthly: compliance.personalLossLimits.monthly,
        regulatory: {
          daily: compliance.regulatoryLossLimits.daily,
          monthly: compliance.regulatoryLossLimits.monthly,
        },
      },
      pendingLossLimits: {
        daily: compliance.pendingLossLimits?.daily
          ? {
              value: compliance.pendingLossLimits.daily.value,
              effectiveAt: compliance.pendingLossLimits.daily.effectiveFrom,
            }
          : undefined,
        monthly: compliance.pendingLossLimits?.monthly
          ? {
              value: compliance.pendingLossLimits.monthly.value,
              effectiveAt: compliance.pendingLossLimits.monthly.effectiveFrom,
            }
          : undefined,
      },
      block: {
        blockedUntil: blockedActive,
        reason: row?.blocked_reason ?? null,
        selfExcludedUntil: compliance.restrictions.selfExclusion.isActive
          ? compliance.restrictions.selfExclusion.minimumUntil ?? null
          : null,
      },
      pause: {
        // Voluntary-pause (selv-service fra Spillvett) lever i
        // compliance.restrictions.timedPause. `pause.isOnPause` er reservert
        // for mandatory-break etter 60min session-limit.
        pausedUntil: compliance.restrictions.timedPause.isActive
          ? compliance.restrictions.timedPause.pauseUntil ?? null
          : null,
      },
    };
  }

  private computeLossLimitDiff(
    before: PlayerComplianceSnapshot,
    after: ProfileSettingsView
  ): Record<string, { from: unknown; to: unknown }> {
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    if (before.personalLossLimits.daily !== after.lossLimits.daily) {
      diff.dailyLimit = { from: before.personalLossLimits.daily, to: after.lossLimits.daily };
    }
    if (before.personalLossLimits.monthly !== after.lossLimits.monthly) {
      diff.monthlyLimit = { from: before.personalLossLimits.monthly, to: after.lossLimits.monthly };
    }
    const beforeDailyPending = before.pendingLossLimits?.daily?.value ?? null;
    const afterDailyPending = after.pendingLossLimits.daily?.value ?? null;
    if (beforeDailyPending !== afterDailyPending) {
      diff.dailyPending = { from: beforeDailyPending, to: afterDailyPending };
    }
    const beforeMonthlyPending = before.pendingLossLimits?.monthly?.value ?? null;
    const afterMonthlyPending = after.pendingLossLimits.monthly?.value ?? null;
    if (beforeMonthlyPending !== afterMonthlyPending) {
      diff.monthlyPending = { from: beforeMonthlyPending, to: afterMonthlyPending };
    }
    return diff;
  }

  private assertLossLimit(value: number | undefined, field: "daily" | "monthly"): void {
    if (value === undefined) return;
    if (!Number.isFinite(value) || value < 0) {
      throw new DomainError("INVALID_INPUT", `${field}LossLimit må være 0 eller større.`);
    }
  }

  private async writeAudit(input: {
    actor: { type: AuditActorType; ipAddress?: string | null; userAgent?: string | null };
    action: string;
    userId: string;
    details: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.audit.record({
        actorId: input.userId,
        actorType: input.actor.type,
        action: input.action,
        resource: "user",
        resourceId: input.userId,
        details: input.details,
        ipAddress: input.actor.ipAddress ?? null,
        userAgent: input.actor.userAgent ?? null,
      });
    } catch (err) {
      // Audit-logger bør være fire-and-forget for å ikke blokkere
      // spillerens profil-oppdatering på audit-DB-feil.
      logger.warn({ err, action: input.action }, "profile settings audit append failed");
    }
  }
}
