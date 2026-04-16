import { DomainError } from "./BingoEngine.js";
import { roundCurrency } from "../util/currency.js";
import { logger as rootLogger } from "../util/logger.js";
import type {
  PersistedLossEntry,
  PersistedLossLimit,
  PersistedMandatoryBreakSummary,
  PersistedPendingLossLimitChange,
  PersistedPlaySessionState,
  PersistedRestrictionState,
  ResponsibleGamingPersistenceAdapter,
  ResponsibleGamingPersistenceSnapshot
} from "./ResponsibleGamingPersistence.js";

const logger = rootLogger.child({ module: "compliance" });

const DEFAULT_SELF_EXCLUSION_MIN_MS = 365 * 24 * 60 * 60 * 1000;

// ── Exported interfaces ────────────────────────────────────────────

export interface LossLimits {
  daily: number;
  monthly: number;
}

export interface PendingLossLimitField {
  value: number;
  effectiveFromMs: number;
}

export interface PendingLossLimitChange {
  daily?: PendingLossLimitField;
  monthly?: PendingLossLimitField;
}

export interface LossLedgerEntry {
  type: "BUYIN" | "PAYOUT";
  amount: number;
  createdAtMs: number;
}

export interface PlaySessionState {
  accumulatedMs: number;
  activeFromMs?: number;
  pauseUntilMs?: number;
  lastMandatoryBreak?: MandatoryBreakSummary;
  gamesPlayedInSession?: number;
}

export interface MandatoryBreakSummary {
  triggeredAtMs: number;
  pauseUntilMs: number;
  totalPlayMs: number;
  hallId: string;
  netLoss: LossLimits;
  gamesPlayed: number;
}

export interface RestrictionState {
  timedPauseUntilMs?: number;
  timedPauseSetAtMs?: number;
  selfExcludedAtMs?: number;
  selfExclusionMinimumUntilMs?: number;
}

export type GameplayBlockType = "TIMED_PAUSE" | "SELF_EXCLUDED" | "MANDATORY_PAUSE";

export interface GameplayBlockState {
  type: GameplayBlockType;
  untilMs: number;
}

export interface PlayerComplianceSnapshot {
  walletId: string;
  hallId?: string;
  regulatoryLossLimits: LossLimits;
  personalLossLimits: LossLimits;
  pendingLossLimits?: {
    daily?: {
      value: number;
      effectiveFrom: string;
    };
    monthly?: {
      value: number;
      effectiveFrom: string;
    };
  };
  netLoss: LossLimits;
  pause: {
    isOnPause: boolean;
    pauseUntil?: string;
    accumulatedPlayMs: number;
    playSessionLimitMs: number;
    pauseDurationMs: number;
    lastMandatoryBreak?: {
      triggeredAt: string;
      pauseUntil: string;
      totalPlayMs: number;
      hallId: string;
      netLoss: LossLimits;
      gamesPlayed: number;
    };
  };
  restrictions: {
    isBlocked: boolean;
    blockedBy?: GameplayBlockType;
    blockedUntil?: string;
    timedPause: {
      isActive: boolean;
      pauseUntil?: string;
      setAt?: string;
    };
    selfExclusion: {
      isActive: boolean;
      setAt?: string;
      minimumUntil?: string;
      canBeRemoved: boolean;
    };
  };
}

// ── Constructor config ─────────────────────────────────────────────

export interface ComplianceManagerConfig {
  regulatoryLossLimits: LossLimits;
  playSessionLimitMs: number;
  pauseDurationMs: number;
  selfExclusionMinMs: number;
  persistence?: ResponsibleGamingPersistenceAdapter;
}

// ── Hydration subset ───────────────────────────────────────────────

export interface ComplianceHydrationSnapshot {
  personalLossLimits: PersistedLossLimit[];
  pendingLossLimitChanges: PersistedPendingLossLimitChange[];
  restrictions: PersistedRestrictionState[];
  playStates: PersistedPlaySessionState[];
  lossEntries: PersistedLossEntry[];
}

// ── ComplianceManager ──────────────────────────────────────────────

export class ComplianceManager {
  private readonly lossEntriesByScope = new Map<string, LossLedgerEntry[]>();
  private readonly personalLossLimitsByScope = new Map<string, LossLimits>();
  private readonly pendingLossLimitChangesByScope = new Map<string, PendingLossLimitChange>();
  private readonly playStateByWallet = new Map<string, PlaySessionState>();
  private readonly restrictionsByWallet = new Map<string, RestrictionState>();

  readonly regulatoryLossLimits: LossLimits;
  readonly playSessionLimitMs: number;
  readonly pauseDurationMs: number;
  readonly selfExclusionMinMs: number;
  private readonly persistence?: ResponsibleGamingPersistenceAdapter;

  constructor(config: ComplianceManagerConfig) {
    this.regulatoryLossLimits = { ...config.regulatoryLossLimits };
    this.playSessionLimitMs = config.playSessionLimitMs;
    this.pauseDurationMs = config.pauseDurationMs;
    this.selfExclusionMinMs = config.selfExclusionMinMs;
    this.persistence = config.persistence;
  }

  // ── Hydration ────────────────────────────────────────────────────

  hydrateFromSnapshot(snapshot: ComplianceHydrationSnapshot): void {
    this.lossEntriesByScope.clear();
    this.personalLossLimitsByScope.clear();
    this.pendingLossLimitChangesByScope.clear();
    this.playStateByWallet.clear();
    this.restrictionsByWallet.clear();

    for (const lossLimit of snapshot.personalLossLimits) {
      this.personalLossLimitsByScope.set(this.makeLossScopeKey(lossLimit.walletId, lossLimit.hallId), {
        daily: Math.floor(lossLimit.daily),
        monthly: Math.floor(lossLimit.monthly)
      });
    }

    for (const pendingChange of snapshot.pendingLossLimitChanges) {
      const next: PendingLossLimitChange = {};
      if (
        pendingChange.dailyPendingValue !== undefined &&
        pendingChange.dailyEffectiveFromMs !== undefined
      ) {
        next.daily = {
          value: Math.floor(pendingChange.dailyPendingValue),
          effectiveFromMs: pendingChange.dailyEffectiveFromMs
        };
      }
      if (
        pendingChange.monthlyPendingValue !== undefined &&
        pendingChange.monthlyEffectiveFromMs !== undefined
      ) {
        next.monthly = {
          value: Math.floor(pendingChange.monthlyPendingValue),
          effectiveFromMs: pendingChange.monthlyEffectiveFromMs
        };
      }
      if (next.daily || next.monthly) {
        this.pendingLossLimitChangesByScope.set(
          this.makeLossScopeKey(pendingChange.walletId, pendingChange.hallId),
          next
        );
      }
    }

    for (const restriction of snapshot.restrictions) {
      const state: RestrictionState = {
        timedPauseUntilMs: restriction.timedPauseUntilMs,
        timedPauseSetAtMs: restriction.timedPauseSetAtMs,
        selfExcludedAtMs: restriction.selfExcludedAtMs,
        selfExclusionMinimumUntilMs: restriction.selfExclusionMinimumUntilMs
      };
      const hasAnyRestriction = Object.values(state).some((value) => value !== undefined);
      if (hasAnyRestriction) {
        this.restrictionsByWallet.set(restriction.walletId, state);
      }
    }

    for (const playState of snapshot.playStates) {
      const hasLastMandatoryBreak = Boolean(playState.lastMandatoryBreak);
      if (
        playState.accumulatedMs > 0 ||
        playState.activeFromMs !== undefined ||
        playState.pauseUntilMs !== undefined ||
        hasLastMandatoryBreak
      ) {
        this.playStateByWallet.set(playState.walletId, {
          accumulatedMs: Math.max(0, Math.floor(playState.accumulatedMs)),
          activeFromMs: playState.activeFromMs,
          pauseUntilMs: playState.pauseUntilMs,
          gamesPlayedInSession: playState.gamesPlayedInSession ?? 0,
          lastMandatoryBreak: playState.lastMandatoryBreak
            ? {
                triggeredAtMs: playState.lastMandatoryBreak.triggeredAtMs,
                pauseUntilMs: playState.lastMandatoryBreak.pauseUntilMs,
                totalPlayMs: playState.lastMandatoryBreak.totalPlayMs,
                hallId: playState.lastMandatoryBreak.hallId,
                gamesPlayed: playState.lastMandatoryBreak.gamesPlayed ?? 0,
                netLoss: {
                  daily: playState.lastMandatoryBreak.netLoss.daily,
                  monthly: playState.lastMandatoryBreak.netLoss.monthly
                }
              }
            : undefined
        });
      }
    }

    for (const entry of snapshot.lossEntries) {
      const scopeKey = this.makeLossScopeKey(entry.walletId, entry.hallId);
      const existing = this.lossEntriesByScope.get(scopeKey) ?? [];
      existing.push({
        type: entry.type,
        amount: entry.amount,
        createdAtMs: entry.createdAtMs
      });
      this.lossEntriesByScope.set(scopeKey, existing);
    }
  }

  // ── Public methods (delegated by BingoEngine) ────────────────────

  getPlayerCompliance(walletId: string, hallId?: string): PlayerComplianceSnapshot {
    const normalizedWalletId = walletId.trim();
    if (!normalizedWalletId) {
      throw new DomainError("INVALID_INPUT", "walletId mangler.");
    }
    const normalizedHallId = hallId?.trim() || undefined;

    const nowMs = Date.now();
    const personalLossLimits = this.getEffectiveLossLimits(normalizedWalletId, normalizedHallId, nowMs);
    const pendingLossLimits = normalizedHallId
      ? this.getPendingLossLimitChangeSnapshot(normalizedWalletId, normalizedHallId, nowMs)
      : undefined;
    const netLoss = this.calculateNetLoss(normalizedWalletId, nowMs, normalizedHallId);
    const restrictionState = this.getRestrictionState(normalizedWalletId, nowMs);
    const playState = this.getPlaySessionState(normalizedWalletId, nowMs);
    const blockState = this.resolveGameplayBlock(normalizedWalletId, nowMs);

    return {
      walletId: normalizedWalletId,
      hallId: normalizedHallId,
      regulatoryLossLimits: { ...this.regulatoryLossLimits },
      personalLossLimits,
      pendingLossLimits,
      netLoss,
      pause: {
        isOnPause: playState.pauseUntilMs !== undefined && playState.pauseUntilMs > nowMs,
        pauseUntil:
          playState.pauseUntilMs !== undefined && playState.pauseUntilMs > nowMs
            ? new Date(playState.pauseUntilMs).toISOString()
            : undefined,
        accumulatedPlayMs: playState.accumulatedMs,
        playSessionLimitMs: this.playSessionLimitMs,
        pauseDurationMs: this.pauseDurationMs,
        lastMandatoryBreak: playState.lastMandatoryBreak
          ? {
              triggeredAt: new Date(playState.lastMandatoryBreak.triggeredAtMs).toISOString(),
              pauseUntil: new Date(playState.lastMandatoryBreak.pauseUntilMs).toISOString(),
              totalPlayMs: playState.lastMandatoryBreak.totalPlayMs,
              hallId: playState.lastMandatoryBreak.hallId,
              gamesPlayed: playState.lastMandatoryBreak.gamesPlayed,
              netLoss: {
                daily: playState.lastMandatoryBreak.netLoss.daily,
                monthly: playState.lastMandatoryBreak.netLoss.monthly
              }
            }
          : undefined
      },
      restrictions: {
        isBlocked: Boolean(blockState),
        blockedBy: blockState?.type,
        blockedUntil: blockState ? new Date(blockState.untilMs).toISOString() : undefined,
        timedPause: {
          isActive:
            restrictionState.timedPauseUntilMs !== undefined && restrictionState.timedPauseUntilMs > nowMs,
          pauseUntil:
            restrictionState.timedPauseUntilMs !== undefined && restrictionState.timedPauseUntilMs > nowMs
              ? new Date(restrictionState.timedPauseUntilMs).toISOString()
              : undefined,
          setAt:
            restrictionState.timedPauseSetAtMs !== undefined
              ? new Date(restrictionState.timedPauseSetAtMs).toISOString()
              : undefined
        },
        selfExclusion: {
          isActive:
            restrictionState.selfExcludedAtMs !== undefined &&
            restrictionState.selfExclusionMinimumUntilMs !== undefined,
          setAt:
            restrictionState.selfExcludedAtMs !== undefined
              ? new Date(restrictionState.selfExcludedAtMs).toISOString()
              : undefined,
          minimumUntil:
            restrictionState.selfExclusionMinimumUntilMs !== undefined
              ? new Date(restrictionState.selfExclusionMinimumUntilMs).toISOString()
              : undefined,
          canBeRemoved:
            restrictionState.selfExclusionMinimumUntilMs !== undefined
              ? nowMs >= restrictionState.selfExclusionMinimumUntilMs
              : false
        }
      }
    };
  }

  async setPlayerLossLimits(input: {
    walletId: string;
    hallId: string;
    daily?: number;
    monthly?: number;
  }): Promise<PlayerComplianceSnapshot> {
    const walletId = input.walletId.trim();
    if (!walletId) {
      throw new DomainError("INVALID_INPUT", "walletId mangler.");
    }
    const hallId = input.hallId.trim();
    if (!hallId) {
      throw new DomainError("INVALID_INPUT", "hallId mangler.");
    }

    const nowMs = Date.now();
    const current = this.getEffectiveLossLimits(walletId, hallId, nowMs);
    const currentPending = this.getPendingLossLimitChange(walletId, hallId, nowMs);
    const daily = input.daily ?? current.daily;
    const monthly = input.monthly ?? current.monthly;

    if (!Number.isFinite(daily) || daily < 0) {
      throw new DomainError("INVALID_INPUT", "dailyLossLimit må være 0 eller større.");
    }
    if (!Number.isFinite(monthly) || monthly < 0) {
      throw new DomainError("INVALID_INPUT", "monthlyLossLimit må være 0 eller større.");
    }
    if (daily > this.regulatoryLossLimits.daily) {
      throw new DomainError(
        "INVALID_INPUT",
        `dailyLossLimit kan ikke være høyere enn regulatorisk grense (${this.regulatoryLossLimits.daily}).`
      );
    }
    if (monthly > this.regulatoryLossLimits.monthly) {
      throw new DomainError(
        "INVALID_INPUT",
        `monthlyLossLimit kan ikke være høyere enn regulatorisk grense (${this.regulatoryLossLimits.monthly}).`
      );
    }

    const nextLimits: LossLimits = {
      daily: current.daily,
      monthly: current.monthly
    };
    const nextPending: PendingLossLimitChange = {
      daily: currentPending?.daily ? { ...currentPending.daily } : undefined,
      monthly: currentPending?.monthly ? { ...currentPending.monthly } : undefined
    };

    if (input.daily !== undefined) {
      const normalizedDaily = Math.floor(daily);
      if (normalizedDaily <= current.daily) {
        nextLimits.daily = normalizedDaily;
        delete nextPending.daily;
      } else if (!nextPending.daily || nextPending.daily.value !== normalizedDaily) {
        nextPending.daily = {
          value: normalizedDaily,
          effectiveFromMs: this.startOfNextLocalDayMs(nowMs)
        };
      }
    }

    if (input.monthly !== undefined) {
      const normalizedMonthly = Math.floor(monthly);
      if (normalizedMonthly <= current.monthly) {
        nextLimits.monthly = normalizedMonthly;
        delete nextPending.monthly;
      } else if (!nextPending.monthly || nextPending.monthly.value !== normalizedMonthly) {
        nextPending.monthly = {
          value: normalizedMonthly,
          effectiveFromMs: this.startOfNextLocalMonthMs(nowMs)
        };
      }
    }

    this.personalLossLimitsByScope.set(this.makeLossScopeKey(walletId, hallId), nextLimits);
    await this.persistLossLimitState(walletId, hallId, nextLimits, nextPending);
    return this.getPlayerCompliance(walletId, hallId);
  }

  async setTimedPause(input: {
    walletId: string;
    durationMs?: number;
    durationMinutes?: number;
  }): Promise<PlayerComplianceSnapshot> {
    const walletId = input.walletId.trim();
    if (!walletId) {
      throw new DomainError("INVALID_INPUT", "walletId mangler.");
    }

    const nowMs = Date.now();
    const durationFromMinutes =
      input.durationMinutes !== undefined ? Math.floor(Number(input.durationMinutes) * 60 * 1000) : undefined;
    const rawDurationMs = input.durationMs ?? durationFromMinutes ?? 15 * 60 * 1000;
    if (!Number.isFinite(rawDurationMs) || rawDurationMs <= 0) {
      throw new DomainError("INVALID_INPUT", "duration må være større enn 0.");
    }
    const durationMs = Math.floor(rawDurationMs);
    const untilMs = nowMs + durationMs;

    const state = this.getRestrictionState(walletId, nowMs);
    state.timedPauseSetAtMs = nowMs;
    state.timedPauseUntilMs = Math.max(untilMs, state.timedPauseUntilMs ?? 0);
    await this.persistRestrictionState(walletId, state);
    return this.getPlayerCompliance(walletId);
  }

  async clearTimedPause(walletIdInput: string): Promise<PlayerComplianceSnapshot> {
    const walletId = walletIdInput.trim();
    if (!walletId) {
      throw new DomainError("INVALID_INPUT", "walletId mangler.");
    }
    const nowMs = Date.now();
    const state = this.getRestrictionState(walletId, nowMs);
    if (state.timedPauseUntilMs !== undefined && state.timedPauseUntilMs > nowMs) {
      throw new DomainError(
        "TIMED_PAUSE_LOCKED",
        `Frivillig pause kan ikke oppheves før ${new Date(state.timedPauseUntilMs).toISOString()}.`
      );
    }

    state.timedPauseUntilMs = undefined;
    state.timedPauseSetAtMs = undefined;
    await this.persistRestrictionState(walletId, state);
    return this.getPlayerCompliance(walletId);
  }

  async setSelfExclusion(walletIdInput: string): Promise<PlayerComplianceSnapshot> {
    const walletId = walletIdInput.trim();
    if (!walletId) {
      throw new DomainError("INVALID_INPUT", "walletId mangler.");
    }
    const nowMs = Date.now();
    const state = this.getRestrictionState(walletId, nowMs);
    if (state.selfExcludedAtMs !== undefined && state.selfExclusionMinimumUntilMs !== undefined) {
      return this.getPlayerCompliance(walletId);
    }

    state.selfExcludedAtMs = nowMs;
    state.selfExclusionMinimumUntilMs = nowMs + this.selfExclusionMinMs;
    await this.persistRestrictionState(walletId, state);
    return this.getPlayerCompliance(walletId);
  }

  async clearSelfExclusion(walletIdInput: string): Promise<PlayerComplianceSnapshot> {
    const walletId = walletIdInput.trim();
    if (!walletId) {
      throw new DomainError("INVALID_INPUT", "walletId mangler.");
    }
    const nowMs = Date.now();
    const state = this.getRestrictionState(walletId, nowMs);
    if (state.selfExcludedAtMs === undefined || state.selfExclusionMinimumUntilMs === undefined) {
      return this.getPlayerCompliance(walletId);
    }
    if (nowMs < state.selfExclusionMinimumUntilMs) {
      throw new DomainError(
        "SELF_EXCLUSION_LOCKED",
        `Selvutelukkelse kan ikke oppheves før ${new Date(state.selfExclusionMinimumUntilMs).toISOString()}.`
      );
    }

    state.selfExcludedAtMs = undefined;
    state.selfExclusionMinimumUntilMs = undefined;
    await this.persistRestrictionState(walletId, state);
    return this.getPlayerCompliance(walletId);
  }

  assertWalletAllowedForGameplay(walletIdInput: string, nowMs = Date.now()): void {
    const walletId = walletIdInput.trim();
    if (!walletId) {
      return;
    }
    const blockState = this.resolveGameplayBlock(walletId, nowMs);
    if (!blockState) {
      return;
    }

    if (blockState.type === "TIMED_PAUSE") {
      throw new DomainError(
        "PLAYER_TIMED_PAUSE",
        `Spiller er på frivillig pause til ${new Date(blockState.untilMs).toISOString()}.`
      );
    }

    if (blockState.type === "MANDATORY_PAUSE") {
      const playState = this.getPlaySessionState(walletId, nowMs);
      const summary = playState.lastMandatoryBreak;
      const summaryText = summary
        ? ` Pause utløst i hall ${summary.hallId}. Netto tap: dag=${summary.netLoss.daily}, måned=${summary.netLoss.monthly}.`
        : "";
      throw new DomainError(
        "PLAYER_REQUIRED_PAUSE",
        `Spiller har pålagt pause til ${new Date(blockState.untilMs).toISOString()}.${summaryText}`
      );
    }

    throw new DomainError(
      "PLAYER_SELF_EXCLUDED",
      `Spiller er selvutestengt minst til ${new Date(blockState.untilMs).toISOString()}.`
    );
  }

  // ── Public methods used internally by BingoEngine ────────────────

  async recordLossEntry(walletId: string, hallId: string, entry: LossLedgerEntry): Promise<void> {
    const normalizedWalletId = walletId.trim();
    const normalizedHallId = hallId.trim();
    if (!normalizedWalletId) {
      return;
    }
    if (!normalizedHallId) {
      return;
    }
    const scopeKey = this.makeLossScopeKey(normalizedWalletId, normalizedHallId);
    const existing = this.lossEntriesByScope.get(scopeKey) ?? [];
    existing.push(entry);
    this.lossEntriesByScope.set(scopeKey, existing);
    if (this.persistence) {
      await this.persistence.insertLossEntry(this.toPersistedLossEntry(normalizedWalletId, normalizedHallId, entry));
    }
  }

  async incrementSessionGameCount(walletIdInput: string): Promise<void> {
    const walletId = walletIdInput.trim();
    if (!walletId) return;
    const existing = this.playStateByWallet.get(walletId);
    if (!existing) return;
    await this.persistPlaySessionState(walletId, {
      ...existing,
      gamesPlayedInSession: (existing.gamesPlayedInSession ?? 0) + 1
    });
  }

  async startPlaySession(walletIdInput: string, nowMs: number): Promise<void> {
    const walletId = walletIdInput.trim();
    if (!walletId) {
      return;
    }
    const state = this.getPlaySessionState(walletId, nowMs);
    if (state.pauseUntilMs !== undefined && state.pauseUntilMs > nowMs) {
      return;
    }
    if (state.activeFromMs !== undefined) {
      return;
    }
    await this.persistPlaySessionState(walletId, {
      ...state,
      activeFromMs: nowMs
    });
  }

  async finishPlaySession(walletIdInput: string, hallIdInput: string, endedAtMs: number): Promise<void> {
    const walletId = walletIdInput.trim();
    const hallId = hallIdInput.trim();
    if (!walletId || !hallId) {
      return;
    }
    const existing = this.playStateByWallet.get(walletId);
    const state: PlaySessionState = existing
      ? {
          accumulatedMs: existing.accumulatedMs,
          activeFromMs: existing.activeFromMs,
          pauseUntilMs: existing.pauseUntilMs,
          gamesPlayedInSession: existing.gamesPlayedInSession ?? 0,
          lastMandatoryBreak: existing.lastMandatoryBreak
            ? {
                triggeredAtMs: existing.lastMandatoryBreak.triggeredAtMs,
                pauseUntilMs: existing.lastMandatoryBreak.pauseUntilMs,
                totalPlayMs: existing.lastMandatoryBreak.totalPlayMs,
                hallId: existing.lastMandatoryBreak.hallId,
                gamesPlayed: existing.lastMandatoryBreak.gamesPlayed,
                netLoss: {
                  daily: existing.lastMandatoryBreak.netLoss.daily,
                  monthly: existing.lastMandatoryBreak.netLoss.monthly
                }
              }
            : undefined
      }
      : { accumulatedMs: 0, gamesPlayedInSession: 0 };
    if (state.activeFromMs === undefined) {
      return;
    }

    const elapsedMs = Math.max(0, endedAtMs - state.activeFromMs);
    const totalPlayMs = state.accumulatedMs + elapsedMs;
    if (totalPlayMs >= this.playSessionLimitMs) {
      const pauseUntilMs = endedAtMs + this.pauseDurationMs;
      await this.persistPlaySessionState(walletId, {
        accumulatedMs: 0,
        activeFromMs: undefined,
        pauseUntilMs,
        gamesPlayedInSession: 0,
        lastMandatoryBreak: {
          triggeredAtMs: endedAtMs,
          pauseUntilMs,
          totalPlayMs,
          hallId,
          gamesPlayed: state.gamesPlayedInSession ?? 0,
          netLoss: this.calculateNetLoss(walletId, endedAtMs, hallId)
        }
      });
      return;
    }

    await this.persistPlaySessionState(walletId, {
      ...state,
      accumulatedMs: totalPlayMs,
      activeFromMs: undefined
    });
  }

  calculateNetLoss(walletId: string, nowMs: number, hallId?: string): LossLimits {
    const dayStartMs = this.startOfLocalDayMs(nowMs);
    const monthStartMs = this.startOfLocalMonthMs(nowMs);
    const retentionCutoffMs = monthStartMs - 35 * 24 * 60 * 60 * 1000;
    const entries = hallId
      ? this.getLossEntriesForScope(walletId, hallId, retentionCutoffMs)
      : this.getLossEntriesForAllScopes(walletId, retentionCutoffMs);

    let daily = 0;
    let monthly = 0;
    for (const entry of entries) {
      const signed = entry.type === "BUYIN" ? entry.amount : -entry.amount;
      if (entry.createdAtMs >= monthStartMs) {
        monthly = roundCurrency(monthly + signed);
        if (entry.createdAtMs >= dayStartMs) {
          daily = roundCurrency(daily + signed);
        }
      }
    }

    return {
      daily: Math.max(0, daily),
      monthly: Math.max(0, monthly)
    };
  }

  wouldExceedLossLimit(walletId: string, entryFee: number, nowMs: number, hallId: string): boolean {
    if (entryFee <= 0) return false;
    const limits = this.getEffectiveLossLimits(walletId, hallId);
    const netLoss = this.calculateNetLoss(walletId, nowMs, hallId);
    return (netLoss.daily + entryFee) > limits.daily || (netLoss.monthly + entryFee) > limits.monthly;
  }

  getEffectiveLossLimits(walletId: string, hallId?: string, nowMs = Date.now()): LossLimits {
    if (!hallId) {
      return { ...this.regulatoryLossLimits };
    }
    const resolved = this.resolveLossLimitState(walletId, hallId, nowMs);
    return {
      daily: Math.min(resolved.daily, this.regulatoryLossLimits.daily),
      monthly: Math.min(resolved.monthly, this.regulatoryLossLimits.monthly)
    };
  }

  makeLossScopeKey(walletId: string, hallId: string): string {
    return `${walletId.trim()}::${hallId.trim()}`;
  }

  // ── Private methods ──────────────────────────────────────────────

  private resolveLossLimitState(walletIdInput: string, hallIdInput: string, nowMs: number): LossLimits {
    const walletId = walletIdInput.trim();
    const hallId = hallIdInput.trim();
    const scopeKey = this.makeLossScopeKey(walletId, hallId);
    const active = this.personalLossLimitsByScope.get(scopeKey) ?? { ...this.regulatoryLossLimits };
    const pending = this.pendingLossLimitChangesByScope.get(scopeKey);
    if (!pending) {
      return { ...active };
    }

    const nextActive: LossLimits = { ...active };
    const nextPending: PendingLossLimitChange = {
      daily: pending.daily ? { ...pending.daily } : undefined,
      monthly: pending.monthly ? { ...pending.monthly } : undefined
    };
    let didChange = false;

    if (nextPending.daily && nextPending.daily.effectiveFromMs <= nowMs) {
      nextActive.daily = nextPending.daily.value;
      delete nextPending.daily;
      didChange = true;
    }
    if (nextPending.monthly && nextPending.monthly.effectiveFromMs <= nowMs) {
      nextActive.monthly = nextPending.monthly.value;
      delete nextPending.monthly;
      didChange = true;
    }

    if (didChange) {
      this.personalLossLimitsByScope.set(scopeKey, nextActive);
      if (nextPending.daily || nextPending.monthly) {
        this.pendingLossLimitChangesByScope.set(scopeKey, nextPending);
      } else {
        this.pendingLossLimitChangesByScope.delete(scopeKey);
      }
      this.schedulePersistLossLimitState(walletId, hallId, nextActive, nextPending);
    }

    return nextActive;
  }

  private getPendingLossLimitChange(walletIdInput: string, hallIdInput: string, nowMs: number): PendingLossLimitChange | undefined {
    this.resolveLossLimitState(walletIdInput, hallIdInput, nowMs);
    const pending = this.pendingLossLimitChangesByScope.get(this.makeLossScopeKey(walletIdInput, hallIdInput));
    if (!pending) {
      return undefined;
    }
    return {
      daily: pending.daily ? { ...pending.daily } : undefined,
      monthly: pending.monthly ? { ...pending.monthly } : undefined
    };
  }

  private getPendingLossLimitChangeSnapshot(walletIdInput: string, hallIdInput: string, nowMs: number) {
    const pending = this.getPendingLossLimitChange(walletIdInput, hallIdInput, nowMs);
    if (!pending) {
      return undefined;
    }
    return {
      daily: pending.daily
        ? {
            value: pending.daily.value,
            effectiveFrom: new Date(pending.daily.effectiveFromMs).toISOString()
          }
        : undefined,
      monthly: pending.monthly
        ? {
            value: pending.monthly.value,
            effectiveFrom: new Date(pending.monthly.effectiveFromMs).toISOString()
          }
        : undefined
    };
  }

  private getLossEntriesForScope(walletId: string, hallId: string, retentionCutoffMs: number): LossLedgerEntry[] {
    const scopeKey = this.makeLossScopeKey(walletId, hallId);
    const existing = this.lossEntriesByScope.get(scopeKey) ?? [];
    const pruned = existing.filter((entry) => entry.createdAtMs >= retentionCutoffMs);
    if (pruned.length !== existing.length) {
      this.lossEntriesByScope.set(scopeKey, pruned);
    }
    return pruned;
  }

  private getLossEntriesForAllScopes(walletId: string, retentionCutoffMs: number): LossLedgerEntry[] {
    const normalizedWalletId = walletId.trim();
    if (!normalizedWalletId) {
      return [];
    }

    const prefix = `${normalizedWalletId}::`;
    const all: LossLedgerEntry[] = [];
    for (const [scopeKey, entries] of this.lossEntriesByScope.entries()) {
      if (!scopeKey.startsWith(prefix)) {
        continue;
      }
      const pruned = entries.filter((entry) => entry.createdAtMs >= retentionCutoffMs);
      if (pruned.length !== entries.length) {
        this.lossEntriesByScope.set(scopeKey, pruned);
      }
      all.push(...pruned);
    }
    return all;
  }

  private getPlaySessionState(walletIdInput: string, nowMs: number): PlaySessionState {
    const walletId = walletIdInput.trim();
    if (!walletId) {
      return {
        accumulatedMs: 0
      };
    }

    const existing = this.playStateByWallet.get(walletId);
    if (!existing) {
      return {
        accumulatedMs: 0
      };
    }

    const activeElapsedMs =
      existing.activeFromMs !== undefined ? Math.max(0, nowMs - existing.activeFromMs) : 0;
    return {
      accumulatedMs: Math.max(0, existing.accumulatedMs + activeElapsedMs),
      activeFromMs: existing.activeFromMs,
      pauseUntilMs: existing.pauseUntilMs,
      gamesPlayedInSession: existing.gamesPlayedInSession ?? 0,
      lastMandatoryBreak: existing.lastMandatoryBreak
        ? {
            triggeredAtMs: existing.lastMandatoryBreak.triggeredAtMs,
            pauseUntilMs: existing.lastMandatoryBreak.pauseUntilMs,
            totalPlayMs: existing.lastMandatoryBreak.totalPlayMs,
            hallId: existing.lastMandatoryBreak.hallId,
            gamesPlayed: existing.lastMandatoryBreak.gamesPlayed,
            netLoss: {
              daily: existing.lastMandatoryBreak.netLoss.daily,
              monthly: existing.lastMandatoryBreak.netLoss.monthly
            }
          }
        : undefined
    };
  }

  private getRestrictionState(walletId: string, nowMs: number): RestrictionState {
    const existing = this.restrictionsByWallet.get(walletId) ?? {};
    const next: RestrictionState = { ...existing };
    if (next.timedPauseUntilMs !== undefined && next.timedPauseUntilMs <= nowMs) {
      next.timedPauseUntilMs = undefined;
      next.timedPauseSetAtMs = undefined;
    }
    const hasAnyRestriction =
      next.timedPauseUntilMs !== undefined ||
      next.timedPauseSetAtMs !== undefined ||
      next.selfExcludedAtMs !== undefined ||
      next.selfExclusionMinimumUntilMs !== undefined;
    if (!hasAnyRestriction) {
      this.restrictionsByWallet.delete(walletId);
      return {};
    }
    this.restrictionsByWallet.set(walletId, next);
    return next;
  }

  private resolveGameplayBlock(walletId: string, nowMs: number): GameplayBlockState | undefined {
    const state = this.getRestrictionState(walletId, nowMs);
    if (state.selfExcludedAtMs !== undefined && state.selfExclusionMinimumUntilMs !== undefined) {
      return {
        type: "SELF_EXCLUDED",
        untilMs: state.selfExclusionMinimumUntilMs
      };
    }
    if (state.timedPauseUntilMs !== undefined && state.timedPauseUntilMs > nowMs) {
      return {
        type: "TIMED_PAUSE",
        untilMs: state.timedPauseUntilMs
      };
    }
    const playState = this.getPlaySessionState(walletId, nowMs);
    if (playState.pauseUntilMs !== undefined && playState.pauseUntilMs > nowMs) {
      return {
        type: "MANDATORY_PAUSE",
        untilMs: playState.pauseUntilMs
      };
    }
    return undefined;
  }

  private async persistLossLimitState(
    walletIdInput: string,
    hallIdInput: string,
    limits: LossLimits,
    pending: PendingLossLimitChange
  ): Promise<void> {
    const walletId = walletIdInput.trim();
    const hallId = hallIdInput.trim();
    if (!walletId || !hallId) {
      return;
    }
    const scopeKey = this.makeLossScopeKey(walletId, hallId);
    this.personalLossLimitsByScope.set(scopeKey, {
      daily: Math.floor(limits.daily),
      monthly: Math.floor(limits.monthly)
    });

    const hasPending = Boolean(pending.daily || pending.monthly);
    if (hasPending) {
      this.pendingLossLimitChangesByScope.set(scopeKey, {
        daily: pending.daily ? { ...pending.daily } : undefined,
        monthly: pending.monthly ? { ...pending.monthly } : undefined
      });
    } else {
      this.pendingLossLimitChangesByScope.delete(scopeKey);
    }

    if (!this.persistence) {
      return;
    }

    await this.persistence.upsertLossLimit({
      walletId,
      hallId,
      daily: Math.floor(limits.daily),
      monthly: Math.floor(limits.monthly)
    });
    if (hasPending) {
      await this.persistence.upsertPendingLossLimitChange(
        this.toPersistedPendingLossLimitChange(walletId, hallId, pending)
      );
      return;
    }
    await this.persistence.deletePendingLossLimitChange(walletId, hallId);
  }

  private schedulePersistLossLimitState(
    walletId: string,
    hallId: string,
    limits: LossLimits,
    pending: PendingLossLimitChange
  ): void {
    void this.persistLossLimitState(walletId, hallId, limits, pending).catch((error) => {
      logger.error({ err: error, walletId, hallId }, "failed to persist resolved loss limit state");
    });
  }

  private async persistRestrictionState(walletId: string, state: RestrictionState): Promise<void> {
    const hasAnyRestriction =
      state.timedPauseUntilMs !== undefined ||
      state.timedPauseSetAtMs !== undefined ||
      state.selfExcludedAtMs !== undefined ||
      state.selfExclusionMinimumUntilMs !== undefined;
    if (!hasAnyRestriction) {
      this.restrictionsByWallet.delete(walletId);
      if (this.persistence) {
        await this.persistence.deleteRestriction(walletId);
      }
      return;
    }
    this.restrictionsByWallet.set(walletId, state);
    if (this.persistence) {
      await this.persistence.upsertRestriction(this.toPersistedRestrictionState(walletId, state));
    }
  }

  private async persistPlaySessionState(walletIdInput: string, state: PlaySessionState): Promise<void> {
    const walletId = walletIdInput.trim();
    if (!walletId) {
      return;
    }

    const normalized: PlaySessionState = {
      accumulatedMs: Math.max(0, Math.floor(state.accumulatedMs ?? 0)),
      activeFromMs: state.activeFromMs,
      pauseUntilMs: state.pauseUntilMs,
      gamesPlayedInSession: state.gamesPlayedInSession ?? 0,
      lastMandatoryBreak: state.lastMandatoryBreak
        ? {
            triggeredAtMs: state.lastMandatoryBreak.triggeredAtMs,
            pauseUntilMs: state.lastMandatoryBreak.pauseUntilMs,
            totalPlayMs: Math.max(0, Math.floor(state.lastMandatoryBreak.totalPlayMs)),
            hallId: state.lastMandatoryBreak.hallId,
            gamesPlayed: state.lastMandatoryBreak.gamesPlayed,
            netLoss: {
              daily: state.lastMandatoryBreak.netLoss.daily,
              monthly: state.lastMandatoryBreak.netLoss.monthly
            }
          }
        : undefined
    };
    const isEmpty =
      normalized.accumulatedMs <= 0 &&
      normalized.activeFromMs === undefined &&
      normalized.pauseUntilMs === undefined &&
      normalized.lastMandatoryBreak === undefined;
    if (isEmpty) {
      this.playStateByWallet.delete(walletId);
      if (this.persistence) {
        await this.persistence.deletePlaySessionState(walletId);
      }
      return;
    }

    this.playStateByWallet.set(walletId, normalized);
    if (this.persistence) {
      await this.persistence.upsertPlaySessionState(this.toPersistedPlaySessionState(walletId, normalized));
    }
  }

  // ── Persistence conversion helpers ───────────────────────────────

  private toPersistedRestrictionState(walletId: string, state: RestrictionState): PersistedRestrictionState {
    return {
      walletId,
      timedPauseUntilMs: state.timedPauseUntilMs,
      timedPauseSetAtMs: state.timedPauseSetAtMs,
      selfExcludedAtMs: state.selfExcludedAtMs,
      selfExclusionMinimumUntilMs: state.selfExclusionMinimumUntilMs
    };
  }

  private toPersistedPlaySessionState(walletId: string, state: PlaySessionState): PersistedPlaySessionState {
    return {
      walletId,
      accumulatedMs: Math.max(0, Math.floor(state.accumulatedMs)),
      activeFromMs: state.activeFromMs,
      pauseUntilMs: state.pauseUntilMs,
      gamesPlayedInSession: state.gamesPlayedInSession ?? 0,
      lastMandatoryBreak: state.lastMandatoryBreak
        ? this.toPersistedMandatoryBreakSummary(state.lastMandatoryBreak)
        : undefined
    };
  }

  private toPersistedMandatoryBreakSummary(summary: MandatoryBreakSummary): PersistedMandatoryBreakSummary {
    return {
      triggeredAtMs: summary.triggeredAtMs,
      pauseUntilMs: summary.pauseUntilMs,
      totalPlayMs: Math.max(0, Math.floor(summary.totalPlayMs)),
      hallId: summary.hallId,
      gamesPlayed: summary.gamesPlayed,
      netLoss: {
        daily: summary.netLoss.daily,
        monthly: summary.netLoss.monthly
      }
    };
  }

  private toPersistedPendingLossLimitChange(
    walletId: string,
    hallId: string,
    change: PendingLossLimitChange
  ): PersistedPendingLossLimitChange {
    return {
      walletId,
      hallId,
      dailyPendingValue: change.daily?.value,
      dailyEffectiveFromMs: change.daily?.effectiveFromMs,
      monthlyPendingValue: change.monthly?.value,
      monthlyEffectiveFromMs: change.monthly?.effectiveFromMs
    };
  }

  private toPersistedLossEntry(walletId: string, hallId: string, entry: LossLedgerEntry): PersistedLossEntry {
    return {
      walletId,
      hallId,
      type: entry.type,
      amount: entry.amount,
      createdAtMs: entry.createdAtMs
    };
  }

  // ── Date helpers ─────────────────────────────────────────────────

  startOfLocalDayMs(referenceMs: number): number {
    const reference = new Date(referenceMs);
    return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate()).getTime();
  }

  private startOfNextLocalDayMs(referenceMs: number): number {
    const reference = new Date(referenceMs);
    return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate() + 1).getTime();
  }

  private startOfLocalMonthMs(referenceMs: number): number {
    const reference = new Date(referenceMs);
    return new Date(reference.getFullYear(), reference.getMonth(), 1).getTime();
  }

  private startOfNextLocalMonthMs(referenceMs: number): number {
    const reference = new Date(referenceMs);
    return new Date(reference.getFullYear(), reference.getMonth() + 1, 1).getTime();
  }
}
