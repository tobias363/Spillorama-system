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
import {
  validateMachineBreakdown,
  validateBilagReceipt,
  computeBreakdownTotals,
  type MachineBreakdown,
  type BilagReceipt,
} from "./MachineBreakdownTypes.js";

export const DIFF_NOTE_THRESHOLD_NOK = 500;
export const DIFF_NOTE_THRESHOLD_PCT = 5;
export const DIFF_FORCE_THRESHOLD_NOK = 1000;
export const DIFF_FORCE_THRESHOLD_PCT = 10;

/**
 * K1 wireframe-regel (PDF 15 §15.8):
 * "Difference must be explained if > 100 NOK" — gjelder `difference_in_shifts`
 * felt i maskin-breakdown, ikke `daily_balance_difference`. Håndheves i UI
 * som advarsel; service validerer kun øvre grense (1000 NOK tåles uansett
 * fordi notater er allerede påkrevet ved den grensen).
 */
export const SHIFT_DIFF_WARN_THRESHOLD_CENTS = 10_000; // 100 NOK

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
  /** K1: 15-rad maskin-breakdown (wireframe PDF 13 §13.5, PDF 15 §15.8). */
  machineBreakdown?: unknown; // validert via validateMachineBreakdown
  /** K1: opplastet bilag (PDF/JPG) som data-URL. */
  bilagReceipt?: unknown; // validert via validateBilagReceipt
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

    // K1: valider maskin-breakdown + bilag hvis sendt. Valgfritt ved close-day
    // — legacy-shifts uten breakdown skal fortsatt kunne lukkes (backward-
    // compat). Nye agenter bruker UI-en som alltid sender inn.
    let breakdown: MachineBreakdown | undefined;
    if (input.machineBreakdown !== undefined && input.machineBreakdown !== null) {
      try {
        breakdown = validateMachineBreakdown(input.machineBreakdown);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "machineBreakdown ugyldig.";
        throw new DomainError("INVALID_INPUT", `machineBreakdown: ${msg}`);
      }
    }
    let receipt: BilagReceipt | undefined;
    if (input.bilagReceipt !== undefined && input.bilagReceipt !== null) {
      try {
        receipt = validateBilagReceipt(input.bilagReceipt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "bilagReceipt ugyldig.";
        throw new DomainError("INVALID_INPUT", `bilagReceipt: ${msg}`);
      }
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
      machineBreakdown: breakdown,
      bilagReceipt: receipt ?? null,
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

  // ── K1: upload bilag-receipt ──────────────────────────────────────────
  //
  // Tillatt både før og etter close-day (admin-force ved force-flagget).
  // AGENT kan laste opp/erstatte på egen settlement. ADMIN kan alltid.
  // HALL_OPERATOR / SUPPORT: read-only — returner FORBIDDEN.

  async uploadBilagReceipt(input: {
    settlementId: string;
    uploaderUserId: string;
    uploaderRole: UserRole;
    receipt: unknown;
    reason?: string;
  }): Promise<AgentSettlement> {
    if (input.uploaderRole !== "ADMIN" && input.uploaderRole !== "AGENT") {
      throw new DomainError("FORBIDDEN", "Kun AGENT eller ADMIN kan laste opp bilag.");
    }
    const settlement = await this.settlements.getById(input.settlementId);
    if (!settlement) {
      throw new DomainError("SETTLEMENT_NOT_FOUND", "Settlement finnes ikke.");
    }
    if (input.uploaderRole === "AGENT" && settlement.agentUserId !== input.uploaderUserId) {
      throw new DomainError("FORBIDDEN", "AGENT kan bare laste opp bilag på egen settlement.");
    }
    let validated: BilagReceipt;
    try {
      validated = validateBilagReceipt(input.receipt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "bilag ugyldig.";
      throw new DomainError("INVALID_INPUT", msg);
    }
    // Admin-edit krever begrunnelse; agent-upload på egen settlement nei.
    const reason = input.uploaderRole === "ADMIN"
      ? (input.reason?.trim() || "Admin uploaded/replaced bilag")
      : "Agent self-uploaded bilag";
    return this.settlements.applyEdit(
      input.settlementId,
      { bilagReceipt: validated },
      input.uploaderUserId,
      reason
    );
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
    // K1: hvis edit inkluderer breakdown/bilag, valider før skriv.
    const patch: UpdateSettlementInput = { ...input.patch };
    if (patch.machineBreakdown !== undefined) {
      try {
        patch.machineBreakdown = validateMachineBreakdown(patch.machineBreakdown);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "breakdown ugyldig.";
        throw new DomainError("INVALID_INPUT", `machineBreakdown: ${msg}`);
      }
    }
    if (patch.bilagReceipt !== undefined && patch.bilagReceipt !== null) {
      try {
        patch.bilagReceipt = validateBilagReceipt(patch.bilagReceipt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "bilag ugyldig.";
        throw new DomainError("INVALID_INPUT", `bilagReceipt: ${msg}`);
      }
    }
    return this.settlements.applyEdit(input.settlementId, patch, input.editedByUserId, reason);
  }

  /** K1: convenience wrapper — historisk oversikt for en hall i dato-range. */
  async listSettlementsByHall(
    hallId: string,
    dateRange?: { fromDate?: string; toDate?: string; limit?: number; offset?: number }
  ): Promise<AgentSettlement[]> {
    return this.settlements.list({
      hallId,
      fromDate: dateRange?.fromDate,
      toDate: dateRange?.toDate,
      limit: dateRange?.limit,
      offset: dateRange?.offset,
    });
  }

  /** K1: beregn totaler for en breakdown (convenience — brukes av PDF/report). */
  computeBreakdownTotals(breakdown: MachineBreakdown): ReturnType<typeof computeBreakdownTotals> {
    return computeBreakdownTotals(breakdown);
  }

  /**
   * K1 wireframe 17.40 — kalkuler shift-delta-felter:
   *   difference_in_shifts = shift_start_to_end - innskudd_drop_safe - ending_opptall_kassie
   *
   * Speiler klient-kalkulasjonen i SettlementBreakdownModal. Backend-service
   * eksponerer det så PDF-eksport og rapport-bygging kan bruke samme logikk.
   * Alle beløp i øre (integer) for å unngå float-feil.
   */
  static calculateShiftDelta(input: {
    shiftStartToEndCents: number;
    innskuddDropSafeCents: number;
    endingOpptallKassieCents: number;
  }): {
    differenceInShiftsCents: number;
  } {
    if (!Number.isInteger(input.shiftStartToEndCents)) {
      throw new DomainError("INVALID_INPUT", "shiftStartToEndCents må være et heltall (øre).");
    }
    if (!Number.isInteger(input.innskuddDropSafeCents) || input.innskuddDropSafeCents < 0) {
      throw new DomainError("INVALID_INPUT", "innskuddDropSafeCents må være et ikke-negativt heltall.");
    }
    if (!Number.isInteger(input.endingOpptallKassieCents) || input.endingOpptallKassieCents < 0) {
      throw new DomainError("INVALID_INPUT", "endingOpptallKassieCents må være et ikke-negativt heltall.");
    }
    return {
      differenceInShiftsCents:
        input.shiftStartToEndCents - input.innskuddDropSafeCents - input.endingOpptallKassieCents,
    };
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
