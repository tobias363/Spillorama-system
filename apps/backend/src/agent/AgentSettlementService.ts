/**
 * BIN-583 B3.3: agent daily-cash-settlement orkestrator.
 *
 * Forretningsregler:
 *   1. control-daily-balance — pre-close sanity-check som kan gjøres
 *      flere ganger; lagrer agentens påståtte cashBalance i shift's
 *      controlDailyBalance JSONB. Ingen wallet-mutasjon.
 *   2. close-day — atomisk: aggregér tx-totalsummer, computer diff,
 *      sjekk threshold-regler (note krevd, force krevd), sett
 *      shift.settled_at, opprett settlement-rad, transferer dailyBalance
 *      til hall.cash_balance via HallCashLedger.
 *   3. edit-settlement — admin-only, lagrer edited_by + edited_at +
 *      edit_reason. Ingen automatisk wallet-rebalansering (det krever
 *      egen counter-tx-flyt som vi parker til BIN-XXX).
 *
 * Threshold-regler:
 *   - |diff| ≤ 500 kr OG ≤ 5 % av dailyBalanceAtEnd → close OK uten note
 *   - 500 < |diff| ≤ 1000 ELLER 5 < |diff%| ≤ 10 → note required
 *   - |diff| > 1000 ELLER |diff%| > 10 → note + ADMIN force required
 */

import { randomUUID } from "node:crypto";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService, UserRole } from "../platform/PlatformService.js";
import type { AgentService } from "./AgentService.js";
import type { AgentShiftService } from "./AgentShiftService.js";
import type { AgentStore } from "./AgentStore.js";
import type {
  AgentTransactionStore,
  ShiftAggregate,
} from "./AgentTransactionStore.js";
import type {
  AgentSettlementStore,
  AgentSettlement,
  ListSettlementFilter,
  UpdateSettlementInput,
} from "./AgentSettlementStore.js";
import type { HallCashLedger } from "./HallCashLedger.js";

export const DIFF_NOTE_THRESHOLD_NOK = 500;
export const DIFF_NOTE_THRESHOLD_PCT = 5;
export const DIFF_FORCE_THRESHOLD_NOK = 1000;
export const DIFF_FORCE_THRESHOLD_PCT = 10;

export type DiffSeverity = "OK" | "NOTE_REQUIRED" | "FORCE_REQUIRED";

export interface ControlDailyBalanceInput {
  agentUserId: string;
  reportedDailyBalance: number;
  reportedTotalCashBalance: number;
  notes?: string;
}

export interface CloseDayInput {
  agentUserId: string;
  agentRole: UserRole;
  reportedCashCount: number;
  settlementToDropSafe?: number;
  withdrawFromTotalBalance?: number;
  totalDropSafe?: number;
  settlementNote?: string;
  isForceRequested?: boolean;
  otherData?: Record<string, unknown>;
}

export interface EditSettlementInput {
  settlementId: string;
  editedByUserId: string;
  editorRole: UserRole;
  reason: string;
  patch: UpdateSettlementInput;
}

export interface SettlementDateInfo {
  expectedBusinessDate: string;
  hasPendingPreviousDay: boolean;
  pendingShiftId: string | null;
}

export interface AgentSettlementServiceDeps {
  platformService: PlatformService;
  agentService: AgentService;
  agentShiftService: AgentShiftService;
  agentStore: AgentStore;
  transactionStore: AgentTransactionStore;
  settlementStore: AgentSettlementStore;
  hallCashLedger: HallCashLedger;
}

export class AgentSettlementService {
  private readonly platform: PlatformService;
  private readonly agents: AgentService;
  private readonly shifts: AgentShiftService;
  private readonly store: AgentStore;
  private readonly txs: AgentTransactionStore;
  private readonly settlements: AgentSettlementStore;
  private readonly hallCash: HallCashLedger;

  constructor(deps: AgentSettlementServiceDeps) {
    this.platform = deps.platformService;
    this.agents = deps.agentService;
    this.shifts = deps.agentShiftService;
    this.store = deps.agentStore;
    this.txs = deps.transactionStore;
    this.settlements = deps.settlementStore;
    this.hallCash = deps.hallCashLedger;
  }

  // ── Pre-close sanity-check ──────────────────────────────────────────────

  async controlDailyBalance(input: ControlDailyBalanceInput): Promise<{
    shiftDailyBalance: number;
    reportedDailyBalance: number;
    diff: number;
    diffPct: number;
    severity: DiffSeverity;
  }> {
    if (!Number.isFinite(input.reportedDailyBalance)) {
      throw new DomainError("INVALID_INPUT", "reportedDailyBalance må være et tall.");
    }
    if (!Number.isFinite(input.reportedTotalCashBalance)) {
      throw new DomainError("INVALID_INPUT", "reportedTotalCashBalance må være et tall.");
    }
    await this.agents.requireActiveAgent(input.agentUserId);
    const shift = await this.shifts.getCurrentShift(input.agentUserId);
    if (!shift) {
      throw new DomainError("NO_ACTIVE_SHIFT", "Du må åpne en shift før du kan kontrollere kassen.");
    }
    if (shift.settledAt) {
      throw new DomainError("SHIFT_SETTLED", "Shiften er allerede avsluttet.");
    }
    const diff = round2(input.reportedDailyBalance - shift.dailyBalance);
    const diffPct = shift.dailyBalance === 0
      ? (diff === 0 ? 0 : 100)
      : round2((diff / shift.dailyBalance) * 100);
    const severity = computeDiffSeverity(diff, diffPct);

    await this.store.setShiftControlDailyBalance(shift.id, {
      reportedDailyBalance: input.reportedDailyBalance,
      reportedTotalCashBalance: input.reportedTotalCashBalance,
      shiftDailyBalanceAtCheck: shift.dailyBalance,
      diff,
      diffPct,
      severity,
      notes: input.notes ?? null,
      checkedAt: new Date().toISOString(),
    });

    return {
      shiftDailyBalance: shift.dailyBalance,
      reportedDailyBalance: input.reportedDailyBalance,
      diff,
      diffPct,
      severity,
    };
  }

  // ── Close day ───────────────────────────────────────────────────────────

  async closeDay(input: CloseDayInput): Promise<AgentSettlement> {
    if (!Number.isFinite(input.reportedCashCount) || input.reportedCashCount < 0) {
      throw new DomainError("INVALID_INPUT", "reportedCashCount må være ≥ 0.");
    }
    await this.agents.requireActiveAgent(input.agentUserId);
    const shift = await this.shifts.getCurrentShift(input.agentUserId);
    if (!shift) {
      throw new DomainError("NO_ACTIVE_SHIFT", "Du må åpne en shift før du kan utføre close-day.");
    }
    if (shift.settledAt) {
      throw new DomainError("SHIFT_SETTLED", "Shiften er allerede avsluttet med close-day.");
    }

    const dailyBalanceAtEnd = round2(shift.dailyBalance);
    const diff = round2(input.reportedCashCount - dailyBalanceAtEnd);
    const diffPct = dailyBalanceAtEnd === 0
      ? (diff === 0 ? 0 : 100)
      : round2((diff / dailyBalanceAtEnd) * 100);
    const severity = computeDiffSeverity(diff, diffPct);

    if (severity === "NOTE_REQUIRED" && !(input.settlementNote && input.settlementNote.trim())) {
      throw new DomainError(
        "DIFF_NOTE_REQUIRED",
        `Diff på ${diff} kr (${diffPct} %) krever forklarende note.`
      );
    }
    if (severity === "FORCE_REQUIRED") {
      if (input.agentRole !== "ADMIN") {
        throw new DomainError(
          "ADMIN_FORCE_REQUIRED",
          `Diff på ${diff} kr (${diffPct} %) overstiger grense — krever ADMIN force-close.`
        );
      }
      if (!input.isForceRequested) {
        throw new DomainError(
          "ADMIN_FORCE_REQUIRED",
          "ADMIN må eksplisitt sette isForceRequested=true for å close-day med så stort avvik."
        );
      }
      if (!(input.settlementNote && input.settlementNote.trim())) {
        throw new DomainError(
          "DIFF_NOTE_REQUIRED",
          "Force-close krever forklarende note."
        );
      }
    }

    // Aggregér transaksjoner for snapshot.
    const aggregate = await this.txs.aggregateByShift(shift.id);

    // Mark shift settled (atomisk i Postgres; in-memory har samme effekt).
    const settledShift = await this.store.markShiftSettled(shift.id, input.agentUserId);

    const settlementId = `sett-${randomUUID()}`;
    const businessDate = new Date(settledShift.startedAt).toISOString().slice(0, 10);

    const settlement = await this.settlements.insert({
      id: settlementId,
      shiftId: shift.id,
      agentUserId: shift.userId,
      hallId: shift.hallId,
      businessDate,
      dailyBalanceAtStart: 0,
      dailyBalanceAtEnd,
      reportedCashCount: round2(input.reportedCashCount),
      dailyBalanceDifference: diff,
      settlementToDropSafe: round2(input.settlementToDropSafe ?? 0),
      withdrawFromTotalBalance: round2(input.withdrawFromTotalBalance ?? 0),
      totalDropSafe: round2(input.totalDropSafe ?? 0),
      shiftCashInTotal: round2(aggregate.cashIn),
      shiftCashOutTotal: round2(aggregate.cashOut),
      shiftCardInTotal: round2(aggregate.cardIn),
      shiftCardOutTotal: round2(aggregate.cardOut),
      settlementNote: input.settlementNote?.trim() || null,
      closedByUserId: input.agentUserId,
      isForced: severity === "FORCE_REQUIRED",
      otherData: {
        ...input.otherData,
        diffSeverity: severity,
        diffPct,
        aggregate,
      },
    });

    // Transferer daily-balance til hall cash hvis non-zero.
    if (dailyBalanceAtEnd !== 0) {
      await this.hallCash.applyCashTx({
        hallId: shift.hallId,
        agentUserId: input.agentUserId,
        shiftId: shift.id,
        settlementId: settlement.id,
        txType: "DAILY_BALANCE_TRANSFER",
        direction: dailyBalanceAtEnd > 0 ? "CREDIT" : "DEBIT",
        amount: Math.abs(dailyBalanceAtEnd),
        notes: `Close-day transfer for shift ${shift.id}`,
      });
    }
    // Hvis cash-diff != 0, registrer som SHIFT_DIFFERENCE.
    if (diff !== 0) {
      await this.hallCash.applyCashTx({
        hallId: shift.hallId,
        agentUserId: input.agentUserId,
        shiftId: shift.id,
        settlementId: settlement.id,
        txType: "SHIFT_DIFFERENCE",
        direction: diff > 0 ? "CREDIT" : "DEBIT",
        amount: Math.abs(diff),
        notes: input.settlementNote?.trim() || null,
      });
    }

    return settlement;
  }

  // ── Edit settlement (admin force) ───────────────────────────────────────

  async editSettlement(input: EditSettlementInput): Promise<AgentSettlement> {
    if (input.editorRole !== "ADMIN") {
      throw new DomainError("FORBIDDEN", "Kun ADMIN kan editere settlement.");
    }
    const reason = input.reason?.trim();
    if (!reason) {
      throw new DomainError("EDIT_REASON_REQUIRED", "Du må oppgi grunn for redigering.");
    }
    const existing = await this.settlements.getById(input.settlementId);
    if (!existing) {
      throw new DomainError("SETTLEMENT_NOT_FOUND", "Settlement finnes ikke.");
    }
    return this.settlements.applyEdit(input.settlementId, input.patch, input.editedByUserId, reason);
  }

  // ── Read paths ──────────────────────────────────────────────────────────

  async getSettlementByShiftId(shiftId: string): Promise<AgentSettlement | null> {
    return this.settlements.getByShiftId(shiftId);
  }

  async getSettlementById(settlementId: string): Promise<AgentSettlement> {
    const s = await this.settlements.getById(settlementId);
    if (!s) throw new DomainError("SETTLEMENT_NOT_FOUND", "Settlement finnes ikke.");
    return s;
  }

  async listSettlements(filter: ListSettlementFilter): Promise<AgentSettlement[]> {
    return this.settlements.list(filter);
  }

  async getSettlementDateInfo(agentUserId: string): Promise<SettlementDateInfo> {
    await this.agents.requireActiveAgent(agentUserId);
    const today = new Date().toISOString().slice(0, 10);
    // Sjekk om agenten har en pending tidligere shift uten settlement.
    const history = await this.shifts.getHistory(agentUserId, { limit: 5 });
    const pending = history.find((s) => !s.settledAt && !s.isActive);
    return {
      expectedBusinessDate: pending
        ? new Date(pending.startedAt).toISOString().slice(0, 10)
        : today,
      hasPendingPreviousDay: Boolean(pending),
      pendingShiftId: pending?.id ?? null,
    };
  }

  /** Bygger PDF-input fra settlement + assosiert hall. */
  async buildPdfInput(settlementId: string, generatedBy: string): Promise<{
    businessDate: string;
    generatedAt: string;
    generatedBy: string;
    halls: Array<{
      hallId: string;
      hallName: string;
      cashIn: number;
      cashOut: number;
      net: number;
      lineItems: Array<{ label: string; amount: number }>;
    }>;
    totals: { cashIn: number; cashOut: number; net: number };
    signatoryName: string | null;
  }> {
    const settlement = await this.getSettlementById(settlementId);
    let hallName = settlement.hallId;
    try {
      const hall = await this.platform.getHall(settlement.hallId);
      hallName = hall.name;
    } catch {
      // Bruk hallId som fallback om navn ikke tilgjengelig
    }
    const cashIn = settlement.shiftCashInTotal;
    const cashOut = settlement.shiftCashOutTotal;
    const net = round2(cashIn - cashOut);
    const lineItems: Array<{ label: string; amount: number }> = [
      { label: "Kontant inn (sum)", amount: cashIn },
      { label: "Kontant ut (sum)", amount: cashOut },
      { label: "Kort inn (sum)", amount: settlement.shiftCardInTotal },
      { label: "Kort ut (sum)", amount: settlement.shiftCardOutTotal },
      { label: "Daily balance ved end", amount: settlement.dailyBalanceAtEnd },
      { label: "Reported cash count", amount: settlement.reportedCashCount },
      { label: "Difference (rapport - shift)", amount: settlement.dailyBalanceDifference },
      { label: "Drop safe", amount: settlement.totalDropSafe },
    ];
    let signatoryName: string | null = null;
    try {
      const closedBy = await this.platform.getUserById(settlement.closedByUserId);
      signatoryName = closedBy.displayName;
    } catch {
      signatoryName = null;
    }
    return {
      businessDate: settlement.businessDate,
      generatedAt: new Date().toISOString(),
      generatedBy,
      halls: [{ hallId: settlement.hallId, hallName, cashIn, cashOut, net, lineItems }],
      totals: { cashIn, cashOut, net },
      signatoryName,
    };
  }
}

export function computeDiffSeverity(diff: number, diffPct: number): DiffSeverity {
  const absDiff = Math.abs(diff);
  const absPct = Math.abs(diffPct);
  if (absDiff > DIFF_FORCE_THRESHOLD_NOK || absPct > DIFF_FORCE_THRESHOLD_PCT) {
    return "FORCE_REQUIRED";
  }
  if (absDiff > DIFF_NOTE_THRESHOLD_NOK || absPct > DIFF_NOTE_THRESHOLD_PCT) {
    return "NOTE_REQUIRED";
  }
  return "OK";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export interface ShiftAggregateExport extends ShiftAggregate {}
