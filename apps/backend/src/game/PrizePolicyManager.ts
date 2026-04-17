import { randomUUID } from "node:crypto";
import { DomainError } from "./BingoEngine.js";
import { logger as rootLogger } from "../util/logger.js";
import type {
  PersistedExtraPrizeEntry,
  PersistedPrizePolicy,
  ResponsibleGamingPersistenceAdapter,
  ResponsibleGamingPersistenceSnapshot
} from "./ResponsibleGamingPersistence.js";

const logger = rootLogger.child({ module: "prize-policy" });

const POLICY_WILDCARD = "*";

// ── Exported types ────────────────────────────────────────────────

export type PrizeGameType = "DATABINGO";

export interface PrizePolicyVersion {
  id: string;
  gameType: PrizeGameType;
  hallId: string;
  linkId: string;
  effectiveFromMs: number;
  singlePrizeCap: number;
  dailyExtraPrizeCap: number;
  createdAtMs: number;
}

export interface PrizePolicySnapshot {
  id: string;
  gameType: PrizeGameType;
  hallId: string;
  linkId: string;
  effectiveFrom: string;
  singlePrizeCap: number;
  dailyExtraPrizeCap: number;
  createdAt: string;
}

export interface ExtraPrizeEntry {
  amount: number;
  createdAtMs: number;
  policyId: string;
}

export interface ExtraDrawDenialAudit {
  id: string;
  createdAt: string;
  source: "API" | "SOCKET" | "UNKNOWN";
  roomCode?: string;
  playerId?: string;
  walletId?: string;
  hallId?: string;
  reasonCode: "EXTRA_DRAW_NOT_ALLOWED";
  metadata?: Record<string, unknown>;
}

// ── Hydration subset ──────────────────────────────────────────────

export interface PrizePolicyHydrationSnapshot {
  prizePolicies: PersistedPrizePolicy[];
  extraPrizeEntries: PersistedExtraPrizeEntry[];
}

// ── Constructor config ────────────────────────────────────────────

export interface PrizePolicyManagerConfig {
  persistence?: ResponsibleGamingPersistenceAdapter;
}

// ── PrizePolicyManager ────────────────────────────────────────────

export class PrizePolicyManager {
  private readonly prizePoliciesByScope = new Map<string, PrizePolicyVersion[]>();
  private readonly extraPrizeEntriesByScope = new Map<string, ExtraPrizeEntry[]>();
  private readonly extraDrawDenials: ExtraDrawDenialAudit[] = [];

  private readonly persistence?: ResponsibleGamingPersistenceAdapter;

  constructor(config: PrizePolicyManagerConfig) {
    this.persistence = config.persistence;

    this.applyPrizePolicy({
      gameType: "DATABINGO",
      hallId: POLICY_WILDCARD,
      linkId: POLICY_WILDCARD,
      effectiveFrom: new Date(0).toISOString(),
      singlePrizeCap: 2500,
      dailyExtraPrizeCap: 12000
    });
  }

  // ── Hydration ───────────────────────────────────────────────────

  hydrateFromSnapshot(snapshot: PrizePolicyHydrationSnapshot): void {
    if (snapshot.prizePolicies.length > 0) {
      this.prizePoliciesByScope.clear();
    }
    this.extraPrizeEntriesByScope.clear();

    for (const policy of snapshot.prizePolicies) {
      this.applyPersistedPrizePolicy(policy);
    }

    for (const entry of snapshot.extraPrizeEntries) {
      const scopeKey = this.makeExtraPrizeScopeKey(entry.hallId, entry.linkId);
      const existing = this.extraPrizeEntriesByScope.get(scopeKey) ?? [];
      existing.push({
        amount: entry.amount,
        createdAtMs: entry.createdAtMs,
        policyId: entry.policyId
      });
      this.extraPrizeEntriesByScope.set(scopeKey, existing);
    }
  }

  /** Returns default policies for persistence seeding when DB is empty. */
  getDefaultPolicies(): PrizePolicyVersion[] {
    return [...this.prizePoliciesByScope.values()].flat();
  }

  // ── Public methods ──────────────────────────────────────────────

  async upsertPrizePolicy(input: {
    gameType?: PrizeGameType;
    hallId?: string;
    linkId?: string;
    effectiveFrom: string;
    singlePrizeCap?: number;
    dailyExtraPrizeCap?: number;
  }): Promise<PrizePolicySnapshot> {
    const policy = this.applyPrizePolicy(input);
    if (this.persistence) {
      await this.persistence.upsertPrizePolicy(this.toPersistedPrizePolicy(policy));
    }
    return this.toPrizePolicySnapshot(policy);
  }

  getActivePrizePolicy(input: {
    hallId: string;
    linkId?: string;
    gameType?: PrizeGameType;
    at?: string;
  }): PrizePolicySnapshot {
    const hallId = this.assertHallId(input.hallId);
    const linkId = input.linkId?.trim() || hallId;
    const atMs = input.at ? this.assertIsoTimestampMs(input.at, "at") : Date.now();
    const policy = this.resolvePrizePolicy({
      hallId,
      linkId,
      gameType: input.gameType ?? "DATABINGO",
      atMs
    });
    return this.toPrizePolicySnapshot(policy);
  }

  getExtraPrizeEntriesForScope(scopeKey: string): ExtraPrizeEntry[] {
    return this.extraPrizeEntriesByScope.get(scopeKey) ?? [];
  }

  setExtraPrizeEntriesForScope(scopeKey: string, entries: ExtraPrizeEntry[]): void {
    this.extraPrizeEntriesByScope.set(scopeKey, entries);
  }

  async persistExtraPrizeEntry(entry: PersistedExtraPrizeEntry): Promise<void> {
    if (this.persistence) {
      await this.persistence.insertExtraPrizeEntry(entry);
    }
  }

  rejectExtraDrawPurchase(input: {
    source?: "API" | "SOCKET" | "UNKNOWN";
    roomCode?: string;
    playerId?: string;
    walletId?: string;
    hallId?: string;
    metadata?: Record<string, unknown>;
  }): never {
    const source = input.source ?? "UNKNOWN";

    const event: ExtraDrawDenialAudit = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      source,
      roomCode: input.roomCode,
      playerId: input.playerId,
      walletId: input.walletId,
      hallId: input.hallId,
      reasonCode: "EXTRA_DRAW_NOT_ALLOWED",
      metadata: input.metadata
    };
    this.extraDrawDenials.unshift(event);
    if (this.extraDrawDenials.length > 1000) {
      this.extraDrawDenials.length = 1000;
    }

    throw new DomainError(
      "EXTRA_DRAW_NOT_ALLOWED",
      "Ekstratrekk er ikke tillatt for databingo. Forsøket er logget for revisjon."
    );
  }

  listExtraDrawDenials(limit = 100): ExtraDrawDenialAudit[] {
    const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 100;
    return this.extraDrawDenials.slice(0, normalizedLimit).map((entry) => ({ ...entry }));
  }

  // ── Methods used by BingoEngine ─────────────────────────────────

  applySinglePrizeCap(input: {
    hallId: string;
    gameType: PrizeGameType;
    amount: number;
    atMs?: number;
  }): {
    cappedAmount: number;
    wasCapped: boolean;
    policy: PrizePolicyVersion;
  } {
    const amount = this.assertNonNegativeNumber(input.amount, "amount");
    const atMs = input.atMs ?? Date.now();
    const policy = this.resolvePrizePolicy({
      hallId: input.hallId,
      linkId: input.hallId,
      gameType: input.gameType,
      atMs
    });
    const cappedAmount = Math.min(amount, policy.singlePrizeCap);
    return {
      cappedAmount,
      wasCapped: cappedAmount < amount,
      policy
    };
  }

  resolvePrizePolicy(input: {
    hallId: string;
    linkId: string;
    gameType: PrizeGameType;
    atMs: number;
  }): PrizePolicyVersion {
    const hallId = this.normalizePolicyDimension(input.hallId);
    const linkId = this.normalizePolicyDimension(input.linkId);
    const gameType = input.gameType;
    const atMs = input.atMs;

    const candidateScopeKeys = [
      this.makePrizePolicyScopeKey(gameType, hallId, linkId),
      this.makePrizePolicyScopeKey(gameType, hallId, POLICY_WILDCARD),
      this.makePrizePolicyScopeKey(gameType, POLICY_WILDCARD, linkId),
      this.makePrizePolicyScopeKey(gameType, POLICY_WILDCARD, POLICY_WILDCARD)
    ];

    for (const scopeKey of candidateScopeKeys) {
      const versions = this.prizePoliciesByScope.get(scopeKey) ?? [];
      for (let i = versions.length - 1; i >= 0; i -= 1) {
        if (versions[i].effectiveFromMs <= atMs) {
          return versions[i];
        }
      }
    }

    throw new DomainError("PRIZE_POLICY_MISSING", "Fant ingen aktiv premiepolicy for spill/hall/link.");
  }

  makePrizePolicyScopeKey(gameType: PrizeGameType, hallId: string, linkId: string): string {
    return `${gameType}::${hallId}::${linkId}`;
  }

  makeExtraPrizeScopeKey(hallId: string, linkId: string): string {
    return `${hallId.trim()}::${linkId.trim()}`;
  }

  toPersistedPrizePolicy(policy: PrizePolicyVersion): PersistedPrizePolicy {
    return {
      id: policy.id,
      gameType: policy.gameType,
      hallId: policy.hallId,
      linkId: policy.linkId,
      effectiveFromMs: policy.effectiveFromMs,
      singlePrizeCap: policy.singlePrizeCap,
      dailyExtraPrizeCap: policy.dailyExtraPrizeCap,
      createdAtMs: policy.createdAtMs
    };
  }

  // ── Private methods ─────────────────────────────────────────────

  private applyPrizePolicy(input: {
    gameType?: PrizeGameType;
    hallId?: string;
    linkId?: string;
    effectiveFrom: string;
    singlePrizeCap?: number;
    dailyExtraPrizeCap?: number;
  }): PrizePolicyVersion {
    const nowMs = Date.now();
    const gameType = input.gameType ?? "DATABINGO";
    const hallId = this.normalizePolicyDimension(input.hallId);
    const linkId = this.normalizePolicyDimension(input.linkId);
    const effectiveFromMs = this.assertIsoTimestampMs(input.effectiveFrom, "effectiveFrom");
    let inheritedSinglePrizeCap: number | undefined;
    let inheritedDailyExtraPrizeCap: number | undefined;
    if (input.singlePrizeCap === undefined || input.dailyExtraPrizeCap === undefined) {
      try {
        const current = this.resolvePrizePolicy({
          gameType,
          hallId,
          linkId,
          atMs: effectiveFromMs
        });
        inheritedSinglePrizeCap = current.singlePrizeCap;
        inheritedDailyExtraPrizeCap = current.dailyExtraPrizeCap;
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== "PRIZE_POLICY_MISSING") {
          throw error;
        }
      }
    }

    const singlePrizeCap = this.assertNonNegativeNumber(
      input.singlePrizeCap ?? inheritedSinglePrizeCap ?? 2500,
      "singlePrizeCap"
    );
    const dailyExtraPrizeCap = this.assertNonNegativeNumber(
      input.dailyExtraPrizeCap ?? inheritedDailyExtraPrizeCap ?? 12000,
      "dailyExtraPrizeCap"
    );

    const policy: PrizePolicyVersion = {
      id: randomUUID(),
      gameType,
      hallId,
      linkId,
      effectiveFromMs,
      singlePrizeCap: Math.floor(singlePrizeCap),
      dailyExtraPrizeCap: Math.floor(dailyExtraPrizeCap),
      createdAtMs: nowMs
    };

    const scopeKey = this.makePrizePolicyScopeKey(gameType, hallId, linkId);
    const existing = this.prizePoliciesByScope.get(scopeKey) ?? [];
    const withoutSameEffectiveFrom = existing.filter((entry) => entry.effectiveFromMs !== effectiveFromMs);
    withoutSameEffectiveFrom.push(policy);
    withoutSameEffectiveFrom.sort((a, b) => a.effectiveFromMs - b.effectiveFromMs);
    this.prizePoliciesByScope.set(scopeKey, withoutSameEffectiveFrom);
    return policy;
  }

  private applyPersistedPrizePolicy(policy: PersistedPrizePolicy): void {
    const scopeKey = this.makePrizePolicyScopeKey(policy.gameType, policy.hallId, policy.linkId);
    const existing = this.prizePoliciesByScope.get(scopeKey) ?? [];
    const withoutSameId = existing.filter((entry) => entry.id !== policy.id);
    withoutSameId.push({
      id: policy.id,
      gameType: policy.gameType,
      hallId: policy.hallId,
      linkId: policy.linkId,
      effectiveFromMs: policy.effectiveFromMs,
      singlePrizeCap: policy.singlePrizeCap,
      dailyExtraPrizeCap: policy.dailyExtraPrizeCap,
      createdAtMs: policy.createdAtMs
    });
    withoutSameId.sort((a, b) => a.effectiveFromMs - b.effectiveFromMs);
    this.prizePoliciesByScope.set(scopeKey, withoutSameId);
  }

  private toPrizePolicySnapshot(policy: PrizePolicyVersion): PrizePolicySnapshot {
    return {
      id: policy.id,
      gameType: policy.gameType,
      hallId: policy.hallId,
      linkId: policy.linkId,
      effectiveFrom: new Date(policy.effectiveFromMs).toISOString(),
      singlePrizeCap: policy.singlePrizeCap,
      dailyExtraPrizeCap: policy.dailyExtraPrizeCap,
      createdAt: new Date(policy.createdAtMs).toISOString()
    };
  }

  private normalizePolicyDimension(value: string | undefined): string {
    if (value === undefined || value === null) {
      return POLICY_WILDCARD;
    }
    const normalized = value.trim();
    if (!normalized) {
      return POLICY_WILDCARD;
    }
    if (normalized.length > 120) {
      throw new DomainError("INVALID_INPUT", "Policy-dimensjon er for lang.");
    }
    return normalized;
  }

  private assertIsoTimestampMs(value: string, fieldName: string): number {
    const normalized = value.trim();
    if (!normalized) {
      throw new DomainError("INVALID_INPUT", `${fieldName} mangler.`);
    }
    const parsed = Date.parse(normalized);
    if (!Number.isFinite(parsed)) {
      throw new DomainError("INVALID_INPUT", `${fieldName} må være ISO-8601 dato/tid.`);
    }
    return parsed;
  }

  private assertNonNegativeNumber(value: number, fieldName: string): number {
    if (!Number.isFinite(value) || value < 0) {
      throw new DomainError("INVALID_INPUT", `${fieldName} må være 0 eller større.`);
    }
    return value;
  }

  private assertHallId(hallId: string): string {
    const normalized = hallId.trim();
    if (!normalized || normalized.length > 120) {
      throw new DomainError("INVALID_HALL_ID", "hallId er ugyldig.");
    }
    return normalized;
  }
}
