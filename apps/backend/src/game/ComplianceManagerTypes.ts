import type {
  PersistedLossEntry,
  PersistedLossLimit,
  PersistedPendingLossLimitChange,
  PersistedPlaySessionState,
  PersistedRestrictionState,
  ResponsibleGamingPersistenceAdapter
} from "./ResponsibleGamingPersistence.js";

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
