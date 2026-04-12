import { createHash, randomUUID } from "node:crypto";
import { DomainError } from "./BingoEngine.js";
import { roundCurrency } from "../util/currency.js";
import { logger as rootLogger } from "../util/logger.js";
import type {
  PersistedPayoutAuditEvent,
  ResponsibleGamingPersistenceAdapter,
  ResponsibleGamingPersistenceSnapshot
} from "./ResponsibleGamingPersistence.js";

const logger = rootLogger.child({ module: "payout-audit" });

// ── Exported types ────────────────────────────────────────────────

export interface PayoutAuditEvent {
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

// ── Hydration subset ──────────────────────────────────────────────

export interface PayoutAuditHydrationSnapshot {
  payoutAuditTrail: PersistedPayoutAuditEvent[];
}

// ── Constructor config ────────────────────────────────────────────

export interface PayoutAuditTrailConfig {
  persistence?: ResponsibleGamingPersistenceAdapter;
}

// ── PayoutAuditTrail ──────────────────────────────────────────────

export class PayoutAuditTrail {
  private readonly payoutAuditTrail: PayoutAuditEvent[] = [];
  private lastPayoutAuditHash = "GENESIS";

  private readonly persistence?: ResponsibleGamingPersistenceAdapter;

  constructor(config: PayoutAuditTrailConfig) {
    this.persistence = config.persistence;
  }

  // ── Hydration ───────────────────────────────────────────────────

  hydrateFromSnapshot(snapshot: PayoutAuditHydrationSnapshot): void {
    this.payoutAuditTrail.length = 0;

    for (const event of snapshot.payoutAuditTrail) {
      this.payoutAuditTrail.push({
        ...event,
        txIds: [...event.txIds]
      });
    }
    this.lastPayoutAuditHash = this.payoutAuditTrail[0]?.eventHash ?? "GENESIS";
  }

  // ── Public methods ──────────────────────────────────────────────

  async appendPayoutAuditEvent(input: {
    kind: "CLAIM_PRIZE" | "EXTRA_PRIZE";
    claimId?: string;
    gameId?: string;
    roomCode?: string;
    hallId: string;
    policyVersion?: string;
    amount: number;
    walletId: string;
    playerId?: string;
    sourceAccountId?: string;
    txIds: string[];
  }): Promise<void> {
    const now = new Date().toISOString();
    const normalizedTxIds = input.txIds.map((txId) => txId.trim()).filter(Boolean);
    const chainIndex = this.payoutAuditTrail.length + 1;
    const hashPayload = JSON.stringify({
      kind: input.kind,
      claimId: input.claimId,
      gameId: input.gameId,
      roomCode: input.roomCode,
      hallId: input.hallId,
      policyVersion: input.policyVersion,
      amount: input.amount,
      walletId: input.walletId,
      playerId: input.playerId,
      sourceAccountId: input.sourceAccountId,
      txIds: normalizedTxIds,
      createdAt: now,
      previousHash: this.lastPayoutAuditHash,
      chainIndex
    });
    const eventHash = createHash("sha256").update(hashPayload).digest("hex");
    const event: PayoutAuditEvent = {
      id: randomUUID(),
      createdAt: now,
      claimId: input.claimId?.trim() || undefined,
      gameId: input.gameId?.trim() || undefined,
      roomCode: input.roomCode?.trim() || undefined,
      hallId: this.assertHallId(input.hallId),
      policyVersion: input.policyVersion?.trim() || undefined,
      amount: roundCurrency(this.assertNonNegativeNumber(input.amount, "amount")),
      currency: "NOK",
      walletId: input.walletId.trim(),
      playerId: input.playerId?.trim() || undefined,
      sourceAccountId: input.sourceAccountId?.trim() || undefined,
      txIds: normalizedTxIds,
      kind: input.kind,
      chainIndex,
      previousHash: this.lastPayoutAuditHash,
      eventHash
    };
    this.payoutAuditTrail.unshift(event);
    this.lastPayoutAuditHash = eventHash;
    if (this.payoutAuditTrail.length > 10_000) {
      this.payoutAuditTrail.length = 10_000;
    }
    if (this.persistence) {
      await this.persistence.insertPayoutAuditEvent({
        ...event,
        txIds: [...event.txIds]
      });
    }
  }

  listPayoutAuditTrail(input?: {
    limit?: number;
    hallId?: string;
    gameId?: string;
    walletId?: string;
  }): PayoutAuditEvent[] {
    const limit = Number.isFinite(input?.limit) ? Math.max(1, Math.min(500, Math.floor(input!.limit!))) : 100;
    const hallId = input?.hallId?.trim();
    const gameId = input?.gameId?.trim();
    const walletId = input?.walletId?.trim();
    return this.payoutAuditTrail
      .filter((event) => {
        if (hallId && event.hallId !== hallId) {
          return false;
        }
        if (gameId && event.gameId !== gameId) {
          return false;
        }
        if (walletId && event.walletId !== walletId) {
          return false;
        }
        return true;
      })
      .slice(0, limit)
      .map((event) => ({ ...event, txIds: [...event.txIds] }));
  }

  // ── Private helpers ─────────────────────────────────────────────

  private assertHallId(hallId: string): string {
    const normalized = hallId.trim();
    if (!normalized || normalized.length > 120) {
      throw new DomainError("INVALID_HALL_ID", "hallId er ugyldig.");
    }
    return normalized;
  }

  private assertNonNegativeNumber(value: number, fieldName: string): number {
    if (!Number.isFinite(value) || value < 0) {
      throw new DomainError("INVALID_INPUT", `${fieldName} må være 0 eller større.`);
    }
    return value;
  }
}
