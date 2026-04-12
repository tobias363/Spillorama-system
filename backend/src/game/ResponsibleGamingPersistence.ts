export interface PersistedLossLimit {
  walletId: string;
  hallId: string;
  daily: number;
  monthly: number;
}

export interface PersistedPendingLossLimitChange {
  walletId: string;
  hallId: string;
  dailyPendingValue?: number;
  dailyEffectiveFromMs?: number;
  monthlyPendingValue?: number;
  monthlyEffectiveFromMs?: number;
}

export interface PersistedRestrictionState {
  walletId: string;
  timedPauseUntilMs?: number;
  timedPauseSetAtMs?: number;
  selfExcludedAtMs?: number;
  selfExclusionMinimumUntilMs?: number;
}

export interface PersistedMandatoryBreakSummary {
  triggeredAtMs: number;
  pauseUntilMs: number;
  totalPlayMs: number;
  hallId: string;
  netLoss: {
    daily: number;
    monthly: number;
  };
}

export interface PersistedPlaySessionState {
  walletId: string;
  accumulatedMs: number;
  activeFromMs?: number;
  pauseUntilMs?: number;
  lastMandatoryBreak?: PersistedMandatoryBreakSummary;
}

export interface PersistedLossEntry {
  walletId: string;
  hallId: string;
  type: "BUYIN" | "PAYOUT";
  amount: number;
  createdAtMs: number;
}

export type PersistedPrizeGameType = "DATABINGO";

export interface PersistedPrizePolicy {
  id: string;
  gameType: PersistedPrizeGameType;
  hallId: string;
  linkId: string;
  effectiveFromMs: number;
  singlePrizeCap: number;
  dailyExtraPrizeCap: number;
  createdAtMs: number;
}

export interface PersistedExtraPrizeEntry {
  hallId: string;
  linkId: string;
  amount: number;
  createdAtMs: number;
  policyId: string;
}

export type PersistedLedgerGameType = "MAIN_GAME" | "DATABINGO";
export type PersistedLedgerChannel = "HALL" | "INTERNET";
export type PersistedLedgerEventType = "STAKE" | "PRIZE" | "EXTRA_PRIZE" | "ORG_DISTRIBUTION";

export interface PersistedComplianceLedgerEntry {
  id: string;
  createdAt: string;
  createdAtMs: number;
  hallId: string;
  gameType: PersistedLedgerGameType;
  channel: PersistedLedgerChannel;
  eventType: PersistedLedgerEventType;
  amount: number;
  currency: "NOK";
  roomCode?: string;
  gameId?: string;
  claimId?: string;
  playerId?: string;
  walletId?: string;
  sourceAccountId?: string;
  targetAccountId?: string;
  policyVersion?: string;
  batchId?: string;
  metadata?: Record<string, unknown>;
}

export interface PersistedPayoutAuditEvent {
  id: string;
  createdAt: string;
  claimId?: string;
  gameId?: string;
  roomCode?: string;
  hallId: string;
  policyVersion?: string;
  amount: number;
  currency: "NOK";
  walletId: string;
  playerId?: string;
  sourceAccountId?: string;
  txIds: string[];
  kind: "CLAIM_PRIZE" | "EXTRA_PRIZE";
  chainIndex: number;
  previousHash: string;
  eventHash: string;
}

export interface PersistedDailyReportRow {
  hallId: string;
  gameType: PersistedLedgerGameType;
  channel: PersistedLedgerChannel;
  grossTurnover: number;
  prizesPaid: number;
  net: number;
  stakeCount: number;
  prizeCount: number;
  extraPrizeCount: number;
}

export interface PersistedDailyReport {
  date: string;
  generatedAt: string;
  rows: PersistedDailyReportRow[];
  totals: {
    grossTurnover: number;
    prizesPaid: number;
    net: number;
    stakeCount: number;
    prizeCount: number;
    extraPrizeCount: number;
  };
}

export interface ResponsibleGamingPersistenceSnapshot {
  personalLossLimits: PersistedLossLimit[];
  pendingLossLimitChanges: PersistedPendingLossLimitChange[];
  restrictions: PersistedRestrictionState[];
  playStates: PersistedPlaySessionState[];
  lossEntries: PersistedLossEntry[];
  prizePolicies: PersistedPrizePolicy[];
  extraPrizeEntries: PersistedExtraPrizeEntry[];
  payoutAuditTrail: PersistedPayoutAuditEvent[];
  complianceLedger: PersistedComplianceLedgerEntry[];
  dailyReports: PersistedDailyReport[];
}

export interface ResponsibleGamingPersistenceAdapter {
  ensureInitialized(): Promise<void>;
  loadSnapshot(): Promise<ResponsibleGamingPersistenceSnapshot>;
  upsertLossLimit(entry: PersistedLossLimit): Promise<void>;
  upsertPendingLossLimitChange(entry: PersistedPendingLossLimitChange): Promise<void>;
  deletePendingLossLimitChange(walletId: string, hallId: string): Promise<void>;
  upsertRestriction(entry: PersistedRestrictionState): Promise<void>;
  deleteRestriction(walletId: string): Promise<void>;
  upsertPlaySessionState(entry: PersistedPlaySessionState): Promise<void>;
  deletePlaySessionState(walletId: string): Promise<void>;
  insertLossEntry(entry: PersistedLossEntry): Promise<void>;
  upsertPrizePolicy(policy: PersistedPrizePolicy): Promise<void>;
  insertExtraPrizeEntry(entry: PersistedExtraPrizeEntry): Promise<void>;
  insertPayoutAuditEvent(event: PersistedPayoutAuditEvent): Promise<void>;
  insertComplianceLedgerEntry(entry: PersistedComplianceLedgerEntry): Promise<void>;
  upsertDailyReport(report: PersistedDailyReport): Promise<void>;
  shutdown(): Promise<void>;
}
