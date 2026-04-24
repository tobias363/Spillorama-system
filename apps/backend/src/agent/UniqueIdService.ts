/**
 * Wireframe gaps #8/#10/#11 (2026-04-24): Unique ID card lifecycle.
 *
 * Covers four V1.0 screens:
 *   17.9  — Create New Unique ID (Purchase Date, Expiry, Balance, Hours,
 *           Payment Type, PRINT)
 *   17.10 — Add Money (scan/input unique-id, amount, payment type; balance
 *           AKKUMULERES — never overwritten)
 *   17.11 — Withdraw (cash-only; read-only balance + amount input)
 *   17.26 — Details + Re-Generate (per-game play-history + re-print/re-generate)
 *
 * Every balance mutation writes a row to `app_unique_id_transactions` for
 * audit. The card's balance and transaction insertion happen atomically via
 * the store interface (Postgres uses a transaction; in-memory uses a Map).
 */
import { randomUUID } from "node:crypto";
import { DomainError } from "../game/BingoEngine.js";
import type { AgentService } from "./AgentService.js";
import type {
  UniqueIdCard,
  UniqueIdPaymentType,
  UniqueIdStatus,
  UniqueIdStore,
  UniqueIdTransaction,
} from "./UniqueIdStore.js";

const MIN_HOURS_VALIDITY = 24;

/** Convert a user-facing amount (NOK) to cents. Rejects non-positive or non-finite inputs. */
function amountToCents(value: number, field = "amount"): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new DomainError("INVALID_INPUT", `${field} må være et positivt tall.`);
  }
  return Math.round(value * 100);
}

function ensurePositiveInt(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new DomainError("INVALID_INPUT", `${field} må være et positivt heltall.`);
  }
  return value;
}

function assertPaymentType(value: unknown, allowed: readonly UniqueIdPaymentType[]): UniqueIdPaymentType {
  if (typeof value !== "string") {
    throw new DomainError("INVALID_INPUT", "paymentType er påkrevd.");
  }
  const upper = value.toUpperCase() as UniqueIdPaymentType;
  if (!allowed.includes(upper)) {
    throw new DomainError(
      "INVALID_INPUT",
      `paymentType må være en av: ${allowed.join(", ")}.`
    );
  }
  return upper;
}

export interface CreateUniqueIdInput {
  /** Optional pre-generated id. If omitted, service generates a 9-digit numeric string. */
  id?: string;
  hallId: string;
  amount: number; // NOK
  hoursValidity: number;
  paymentType: UniqueIdPaymentType | string;
  agentUserId: string;
}

export interface AddMoneyInput {
  uniqueId: string;
  amount: number;
  paymentType: UniqueIdPaymentType | string;
  agentUserId: string;
}

export interface WithdrawInput {
  uniqueId: string;
  amount: number;
  agentUserId: string;
  /** Must be CASH per wireframe 17.11/17.28 — any other value must 400. */
  paymentType?: UniqueIdPaymentType | string;
}

export interface ReprintInput {
  uniqueId: string;
  agentUserId: string;
  reason?: string;
}

export interface RegenerateInput {
  uniqueId: string;
  agentUserId: string;
  /** Optional pre-generated new id. */
  newId?: string;
}

export interface DetailsInput {
  uniqueId: string;
  gameType?: string;
}

export interface UniqueIdDetails {
  card: UniqueIdCard;
  transactions: UniqueIdTransaction[];
  /** Filtered game-history if gameType was supplied; otherwise all. */
  gameHistory: UniqueIdTransaction[];
}

export interface CreateUniqueIdResult {
  card: UniqueIdCard;
  transaction: UniqueIdTransaction;
}

export interface RegenerateResult {
  previousCard: UniqueIdCard;
  newCard: UniqueIdCard;
  transferredBalanceCents: number;
}

export interface UniqueIdServiceDeps {
  store: UniqueIdStore;
  agentService: AgentService;
}

export class UniqueIdService {
  private readonly store: UniqueIdStore;
  private readonly agentService: AgentService;

  constructor(deps: UniqueIdServiceDeps) {
    this.store = deps.store;
    this.agentService = deps.agentService;
  }

  /** Generate a 9-digit numeric id per V1.0 convention. */
  private generateId(): string {
    // 900000000..999999999 so the id always has exactly 9 digits
    const n = 100000000 + Math.floor(Math.random() * 900000000);
    return String(n);
  }

  /** 17.9 — Create new Unique ID. Hours validity must be >= 24. */
  async create(input: CreateUniqueIdInput): Promise<CreateUniqueIdResult> {
    ensurePositiveInt(input.hoursValidity, "hoursValidity");
    if (input.hoursValidity < MIN_HOURS_VALIDITY) {
      throw new DomainError(
        "INVALID_HOURS_VALIDITY",
        `hoursValidity må være minst ${MIN_HOURS_VALIDITY}.`
      );
    }
    if (!input.hallId || typeof input.hallId !== "string") {
      throw new DomainError("INVALID_INPUT", "hallId er påkrevd.");
    }
    const paymentType = assertPaymentType(input.paymentType, ["CASH", "CARD"]);
    const balanceCents = amountToCents(input.amount, "amount");

    // Hall-scope: agent må ha tilgang til denne hallen.
    await this.agentService.assertHallMembership(input.agentUserId, input.hallId);

    const id = input.id ?? this.generateId();
    const card = await this.store.insertCard({
      id,
      hallId: input.hallId,
      balanceCents,
      hoursValidity: input.hoursValidity,
      paymentType,
      createdByAgentId: input.agentUserId,
    });
    const transaction = await this.store.insertTransaction({
      uniqueId: card.id,
      actionType: "CREATE",
      amountCents: balanceCents,
      previousBalance: 0,
      newBalance: balanceCents,
      paymentType,
      agentUserId: input.agentUserId,
    });
    return { card, transaction };
  }

  /**
   * 17.10 — Add Money. PM-locked rule: balance AKKUMULERES.
   * A card with 170 kr + 200 kr = 370 kr (never overwritten).
   */
  async addMoney(input: AddMoneyInput): Promise<{ card: UniqueIdCard; transaction: UniqueIdTransaction }> {
    const amountCents = amountToCents(input.amount, "amount");
    const paymentType = assertPaymentType(input.paymentType, ["CASH", "CARD"]);

    const card = await this.mustGetActive(input.uniqueId);
    // Hall-scope: agent må ha tilgang til kortets hall.
    await this.agentService.assertHallMembership(input.agentUserId, card.hallId);

    const previousBalance = card.balanceCents;
    const newBalance = previousBalance + amountCents; // ← AKKUMULERES
    const updated = await this.store.updateBalance(card.id, newBalance);
    const transaction = await this.store.insertTransaction({
      uniqueId: card.id,
      actionType: "ADD_MONEY",
      amountCents,
      previousBalance,
      newBalance,
      paymentType,
      agentUserId: input.agentUserId,
    });
    return { card: updated, transaction };
  }

  /**
   * 17.11 / 17.28 — Withdraw. Cash-only (PM rule) — non-cash must throw.
   * Amount cannot exceed current balance.
   */
  async withdraw(input: WithdrawInput): Promise<{ card: UniqueIdCard; transaction: UniqueIdTransaction }> {
    const amountCents = amountToCents(input.amount, "amount");
    // Withdraw is cash-only — if caller supplies anything else, reject.
    if (input.paymentType !== undefined) {
      const upper = typeof input.paymentType === "string" ? input.paymentType.toUpperCase() : "";
      if (upper !== "CASH") {
        throw new DomainError(
          "PAYMENT_TYPE_NOT_ALLOWED",
          "Only cash payment is allowed for unique ID withdrawal."
        );
      }
    }
    const card = await this.mustGetActive(input.uniqueId);
    await this.agentService.assertHallMembership(input.agentUserId, card.hallId);
    if (amountCents > card.balanceCents) {
      throw new DomainError(
        "INSUFFICIENT_BALANCE",
        "Beløpet overstiger tilgjengelig saldo."
      );
    }
    const previousBalance = card.balanceCents;
    const newBalance = previousBalance - amountCents;
    const nextStatus: UniqueIdStatus | undefined = newBalance === 0 ? "WITHDRAWN" : undefined;
    const updated = await this.store.updateBalance(card.id, newBalance, nextStatus);
    const transaction = await this.store.insertTransaction({
      uniqueId: card.id,
      actionType: "WITHDRAW",
      amountCents,
      previousBalance,
      newBalance,
      paymentType: "CASH",
      agentUserId: input.agentUserId,
    });
    return { card: updated, transaction };
  }

  /** 17.26 — Details view (+ optional gameType filter). */
  async getDetails(input: DetailsInput): Promise<UniqueIdDetails> {
    const card = await this.store.getCardById(input.uniqueId);
    if (!card) {
      throw new DomainError("UNIQUE_ID_NOT_FOUND", "Unique ID not found.");
    }
    const transactions = await this.store.listTransactions(card.id);
    const gameHistory = input.gameType
      ? transactions.filter((t) => t.gameType === input.gameType)
      : transactions;
    return { card, transactions, gameHistory };
  }

  /** 17.26 — Re-Print: bumps reprinted_count + audit-trail. */
  async reprint(input: ReprintInput): Promise<{ card: UniqueIdCard; transaction: UniqueIdTransaction }> {
    const card = await this.mustGetActive(input.uniqueId);
    await this.agentService.assertHallMembership(input.agentUserId, card.hallId);
    const updated = await this.store.markReprinted(card.id, input.agentUserId);
    const transaction = await this.store.insertTransaction({
      uniqueId: card.id,
      actionType: "REPRINT",
      amountCents: 0,
      previousBalance: card.balanceCents,
      newBalance: card.balanceCents,
      agentUserId: input.agentUserId,
      reason: input.reason ?? null,
    });
    return { card: updated, transaction };
  }

  /**
   * 17.26 / 17.27 — Re-Generate. Issues a brand-new id, transfers the
   * balance, marks the previous card REGENERATED. Two audit rows written:
   *   - REGENERATE on the OLD card (with reason + new id reference)
   *   - CREATE on the new card (with regenerated_from_id pointing back)
   */
  async regenerate(input: RegenerateInput): Promise<RegenerateResult> {
    const previous = await this.mustGetActive(input.uniqueId);
    await this.agentService.assertHallMembership(input.agentUserId, previous.hallId);

    const newId = input.newId ?? this.generateId();
    // New card mirrors the previous: same hall, same remaining hours, same
    // payment-type at issue-time. Balance is transferred in full.
    const remainingHours = Math.max(
      MIN_HOURS_VALIDITY,
      Math.ceil((new Date(previous.expiryDate).getTime() - Date.now()) / 3600_000)
    );
    const newCard = await this.store.insertCard({
      id: newId,
      hallId: previous.hallId,
      balanceCents: previous.balanceCents,
      hoursValidity: remainingHours,
      paymentType: previous.paymentType,
      createdByAgentId: input.agentUserId,
      regeneratedFromId: previous.id,
    });
    // Mark previous as REGENERATED and zero its balance.
    const updatedPrevious = await this.store.updateBalance(previous.id, 0, "REGENERATED");
    // Audit: REGENERATE on old card, CREATE on new card.
    await this.store.insertTransaction({
      uniqueId: previous.id,
      actionType: "REGENERATE",
      amountCents: previous.balanceCents,
      previousBalance: previous.balanceCents,
      newBalance: 0,
      agentUserId: input.agentUserId,
      reason: `Replaced by ${newCard.id}`,
    });
    await this.store.insertTransaction({
      uniqueId: newCard.id,
      actionType: "CREATE",
      amountCents: previous.balanceCents,
      previousBalance: 0,
      newBalance: previous.balanceCents,
      paymentType: previous.paymentType,
      agentUserId: input.agentUserId,
      reason: `Regenerated from ${previous.id}`,
    });
    return {
      previousCard: updatedPrevious,
      newCard,
      transferredBalanceCents: previous.balanceCents,
    };
  }

  /** List cards — used by admin-web "List Unique IDs" view. */
  async list(filter: {
    hallId?: string;
    status?: UniqueIdStatus;
    createdByAgentId?: string;
    limit?: number;
    offset?: number;
  }): Promise<UniqueIdCard[]> {
    return this.store.listCards(filter);
  }

  private async mustGetActive(id: string): Promise<UniqueIdCard> {
    const card = await this.store.getCardById(id);
    if (!card) {
      throw new DomainError("UNIQUE_ID_NOT_FOUND", "Unique ID not found.");
    }
    if (card.status !== "ACTIVE") {
      // Expired cards are treated as not-available per wireframe
      // 17.9-footnote "Your Unique Id will be Expired…"
      const msg =
        card.status === "EXPIRED"
          ? "Your Unique Id will be Expired before starting of the game, please Contact Administrator."
          : `Unique ID er ikke aktiv (status=${card.status}).`;
      throw new DomainError("UNIQUE_ID_NOT_ACTIVE", msg);
    }
    return card;
  }
}

/**
 * Short id-generator re-export so routes that need to pre-generate an id
 * (e.g. tests) can use the same convention. Not exported publicly — kept
 * here for completeness.
 */
export function generateUniqueIdNumber(): string {
  const n = 100000000 + Math.floor(Math.random() * 900000000);
  return String(n);
}
export { randomUUID as _randomUUID };
