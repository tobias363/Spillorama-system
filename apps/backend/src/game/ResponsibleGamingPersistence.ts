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
  gamesPlayed?: number;
}

export interface PersistedPlaySessionState {
  walletId: string;
  accumulatedMs: number;
  activeFromMs?: number;
  pauseUntilMs?: number;
  lastMandatoryBreak?: PersistedMandatoryBreakSummary;
  gamesPlayedInSession?: number;
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
export type PersistedLedgerEventType =
  | "STAKE"
  | "PRIZE"
  | "EXTRA_PRIZE"
  | "ORG_DISTRIBUTION"
  | "HOUSE_RETAINED"
  | "HOUSE_DEFICIT";

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
  /**
   * PILOT-STOP-SHIP 2026-04-28: deterministisk key for retry-safe inserts.
   * Backed av UNIQUE-index `idx_app_rg_compliance_ledger_idempotency`
   * (migrations/20260428080000_compliance_ledger_idempotency.sql).
   * INSERT bruker `ON CONFLICT (idempotency_key) DO NOTHING` for å hindre
   * dobbel-telling i §71-rapport når soft-fail-call-sites retry-er etter
   * wallet-success.
   *
   * Optional på TS-nivå for backwards-compat med snapshot-loading av
   * gammel data og test-fixtures — DB-laget krever NOT NULL og bruker
   * `id` som backfill for legacy-rader.
   */
  idempotencyKey?: string;
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
  /**
   * HIGH-6: split-rounding rest-øre persistert sammen med daglig rapport.
   * Backwards-compat: gammel rapport-JSON uten dette feltet leses som
   * `undefined` av JSON.parse — caller-koden tolker dette som 0.
   */
  houseRetained?: number;
  houseRetainedCount?: number;
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
    /** HIGH-6: aggregert split-rounding-rest. Optional for backwards-compat. */
    houseRetained?: number;
    houseRetainedCount?: number;
  };
}

// Persisted overskudd batch (flat for DB-lagring, transfers og allocations som JSON)
export interface PersistedOverskuddBatch {
  id: string;
  createdAt: string;
  date: string;
  hallId?: string;
  gameType?: string;
  channel?: string;
  requiredMinimum: number;
  distributedAmount: number;
  transfersJson: string;   // JSON array av OverskuddDistributionTransfer
  allocationsJson: string; // JSON array av OrganizationAllocationInput
}

// Org allokering per hall
export interface PersistedHallOrganizationAllocation {
  id: string;
  hallId: string;
  organizationId: string;
  organizationName: string;
  organizationAccountId: string;
  sharePercent: number;
  gameType: "MAIN_GAME" | "DATABINGO" | null; // null = gjelder begge
  channel: "HALL" | "INTERNET" | null; // null = gjelder begge
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
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
  insertOverskuddBatch(batch: PersistedOverskuddBatch): Promise<void>;
  getOverskuddBatch(batchId: string): Promise<PersistedOverskuddBatch | null>;
  listOverskuddBatches(input: { hallId?: string; gameType?: string; channel?: string; dateFrom?: string; dateTo?: string; limit?: number }): Promise<PersistedOverskuddBatch[]>;
  upsertHallOrganizationAllocation(alloc: PersistedHallOrganizationAllocation): Promise<void>;
  listHallOrganizationAllocations(hallId?: string): Promise<PersistedHallOrganizationAllocation[]>;
  deleteHallOrganizationAllocation(id: string): Promise<void>;
  shutdown(): Promise<void>;
}
