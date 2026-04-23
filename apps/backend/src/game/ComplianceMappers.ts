// ── Persistence conversion helpers ───────────────────────────────
//
// Pure mapper-funksjoner som konverterer in-memory compliance-state til
// PersistedX-formater forventet av ResponsibleGamingPersistenceAdapter.
// Viktig: disse MÅ holde eksisterende normalisering (Math.floor/Math.max på
// ms-verdier) for å bevare audit-kompatibilitet.

import type {
  PersistedLossEntry,
  PersistedMandatoryBreakSummary,
  PersistedPendingLossLimitChange,
  PersistedPlaySessionState,
  PersistedRestrictionState
} from "./ResponsibleGamingPersistence.js";
import type {
  LossLedgerEntry,
  MandatoryBreakSummary,
  PendingLossLimitChange,
  PlaySessionState,
  RestrictionState
} from "./ComplianceManagerTypes.js";

export function toPersistedRestrictionState(
  walletId: string,
  state: RestrictionState
): PersistedRestrictionState {
  return {
    walletId,
    timedPauseUntilMs: state.timedPauseUntilMs,
    timedPauseSetAtMs: state.timedPauseSetAtMs,
    selfExcludedAtMs: state.selfExcludedAtMs,
    selfExclusionMinimumUntilMs: state.selfExclusionMinimumUntilMs
  };
}

export function toPersistedPlaySessionState(
  walletId: string,
  state: PlaySessionState
): PersistedPlaySessionState {
  return {
    walletId,
    accumulatedMs: Math.max(0, Math.floor(state.accumulatedMs)),
    activeFromMs: state.activeFromMs,
    pauseUntilMs: state.pauseUntilMs,
    gamesPlayedInSession: state.gamesPlayedInSession ?? 0,
    lastMandatoryBreak: state.lastMandatoryBreak
      ? toPersistedMandatoryBreakSummary(state.lastMandatoryBreak)
      : undefined
  };
}

export function toPersistedMandatoryBreakSummary(
  summary: MandatoryBreakSummary
): PersistedMandatoryBreakSummary {
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

export function toPersistedPendingLossLimitChange(
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

export function toPersistedLossEntry(
  walletId: string,
  hallId: string,
  entry: LossLedgerEntry
): PersistedLossEntry {
  return {
    walletId,
    hallId,
    type: entry.type,
    amount: entry.amount,
    createdAtMs: entry.createdAtMs
  };
}
