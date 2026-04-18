/**
 * BIN-583 B3.8: agent open-day flyt.
 *
 * Port of legacy `agentcashinoutController.{addDailyBalance, getDailyBalance}`.
 * Motstykket til A4's close-day (B3.3): ved start av dagen tar agent
 * kontanter fra hall-kassen over i "dagens-balance" som alle cash-ops
 * mot i løpet av shiften justerer. Lukkes via A4's close-day.
 *
 * Atomisk to-stegs-flyt:
 *   1. HallCashLedger.applyCashTx(DEBIT, DAILY_BALANCE_TRANSFER) — logger
 *      og muterer app_halls.cash_balance
 *   2. AgentStore.applyShiftCashDelta({ dailyBalance: +amount }) — øker
 *      shift-running-balance
 *
 * Guardrails:
 *   - Agent må ha aktiv shift
 *   - Kan ikke opne dag to ganger (sjekker eksisterende DAILY_BALANCE_TRANSFER
 *     for samme shift)
 *   - Kan ikke opne dag hvis prev-shift har endted_at men mangler settlement
 *     (pending close-day fra forrige dag)
 *   - amount må være > 0 og ≤ hall.cashBalance
 */

import { DomainError } from "../game/BingoEngine.js";
import type { AgentService } from "./AgentService.js";
import type { AgentShiftService } from "./AgentShiftService.js";
import type { AgentStore, ShiftCashDelta } from "./AgentStore.js";
import type { HallCashLedger } from "./HallCashLedger.js";
import type { AgentSettlementStore } from "./AgentSettlementStore.js";
import { logger as rootLogger } from "../util/logger.js";

const logger = rootLogger.child({ module: "agent-open-day-service" });

export interface OpenDayInput {
  agentUserId: string;
  amount: number;
  notes?: string;
}

export interface OpenDayResult {
  shiftId: string;
  hallId: string;
  amount: number;
  dailyBalance: number;
  hallCashBalanceAfter: number;
  transferTxId: string;
}

export interface DailyBalanceSnapshot {
  shiftId: string | null;
  hallId: string | null;
  dailyBalance: number;
  hallCashBalance: number;
  previousSettlementPending: boolean;
  dayOpened: boolean;
}

export interface AgentOpenDayServiceDeps {
  agentService: AgentService;
  agentShiftService: AgentShiftService;
  agentStore: AgentStore;
  hallCashLedger: HallCashLedger;
  settlementStore: AgentSettlementStore;
}

export class AgentOpenDayService {
  private readonly agents: AgentService;
  private readonly shifts: AgentShiftService;
  private readonly agentStore: AgentStore;
  private readonly ledger: HallCashLedger;
  private readonly settlements: AgentSettlementStore;

  constructor(deps: AgentOpenDayServiceDeps) {
    this.agents = deps.agentService;
    this.shifts = deps.agentShiftService;
    this.agentStore = deps.agentStore;
    this.ledger = deps.hallCashLedger;
    this.settlements = deps.settlementStore;
  }

  async openDay(input: OpenDayInput): Promise<OpenDayResult> {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new DomainError("INVALID_INPUT", "amount må være større enn 0.");
    }
    await this.agents.requireActiveAgent(input.agentUserId);
    const shift = await this.shifts.getCurrentShift(input.agentUserId);
    if (!shift) {
      throw new DomainError("NO_ACTIVE_SHIFT", "Du må åpne en shift først.");
    }

    // Kan ikke open-day to ganger for samme shift.
    const existing = await this.ledger.listForHall(shift.hallId, { limit: 500 });
    const alreadyOpened = existing.some(
      (tx) => tx.shiftId === shift.id && tx.txType === "DAILY_BALANCE_TRANSFER"
    );
    if (alreadyOpened) {
      throw new DomainError(
        "DAY_ALREADY_OPENED",
        "Dagens-balance er allerede registrert for denne shiften."
      );
    }

    // Sjekk prev-day settlement ikke er pending. Vi henter siste shift for
    // agenten før nåværende; hvis den har ended_at men ingen settlement,
    // blokker open-day.
    const pending = await this.hasPendingSettlement(input.agentUserId, shift.id);
    if (pending) {
      throw new DomainError(
        "PREVIOUS_SETTLEMENT_PENDING",
        "Forrige dags kasseoppgjør må fullføres før du kan starte ny dag."
      );
    }

    // Sjekk hall-balanse er tilstrekkelig.
    const balances = await this.ledger.getHallBalances(shift.hallId);
    if (balances.cashBalance < input.amount) {
      throw new DomainError(
        "INSUFFICIENT_HALL_CASH",
        "Hallen har ikke nok kontanter i kassen."
      );
    }

    // Steg 1: hall-cash DEBIT (immutable audit-spor + cash_balance-mutasjon).
    const tx = await this.ledger.applyCashTx({
      hallId: shift.hallId,
      agentUserId: input.agentUserId,
      shiftId: shift.id,
      settlementId: null,
      txType: "DAILY_BALANCE_TRANSFER",
      direction: "DEBIT",
      amount: input.amount,
      notes: input.notes ?? null,
      otherData: { source: "open-day" },
    });

    // Steg 2: shift daily-balance CREDIT. Hvis dette feiler etter hall-debit
    // har hallen "betalt" uten at agent har balansen — vi logger + reiser feil
    // så ops kan justere manuelt (sjelden og ikke-silent-failing).
    const delta: ShiftCashDelta = { dailyBalance: input.amount };
    let updatedShift;
    try {
      updatedShift = await this.agentStore.applyShiftCashDelta(shift.id, delta);
    } catch (err) {
      logger.error(
        { err, shiftId: shift.id, amount: input.amount, hallTxId: tx.id },
        "[BIN-583 B3.8] open-day shift-delta FAILED after hall-debit — ops må justere manuelt"
      );
      throw new DomainError(
        "OPEN_DAY_PARTIAL_FAILURE",
        "Hall-balanse ble trukket, men shift-balanse ble ikke oppdatert. Kontakt ops."
      );
    }

    return {
      shiftId: shift.id,
      hallId: shift.hallId,
      amount: input.amount,
      dailyBalance: updatedShift.dailyBalance,
      hallCashBalanceAfter: tx.afterBalance,
      transferTxId: tx.id,
    };
  }

  async getDailyBalance(agentUserId: string): Promise<DailyBalanceSnapshot> {
    await this.agents.requireActiveAgent(agentUserId);
    const shift = await this.shifts.getCurrentShift(agentUserId);
    if (!shift) {
      return {
        shiftId: null,
        hallId: null,
        dailyBalance: 0,
        hallCashBalance: 0,
        previousSettlementPending: false,
        dayOpened: false,
      };
    }
    const balances = await this.ledger.getHallBalances(shift.hallId);
    const existing = await this.ledger.listForHall(shift.hallId, { limit: 500 });
    const dayOpened = existing.some(
      (tx) => tx.shiftId === shift.id && tx.txType === "DAILY_BALANCE_TRANSFER"
    );
    const previousSettlementPending = await this.hasPendingSettlement(agentUserId, shift.id);
    return {
      shiftId: shift.id,
      hallId: shift.hallId,
      dailyBalance: shift.dailyBalance,
      hallCashBalance: balances.cashBalance,
      previousSettlementPending,
      dayOpened,
    };
  }

  private async hasPendingSettlement(agentUserId: string, currentShiftId: string): Promise<boolean> {
    // Hent siste shift-historikk for agenten; se om den umiddelbart
    // forrige (ikke current) har ended_at men ingen settlement-rad.
    const history = await this.shifts.getHistory(agentUserId, { limit: 5 });
    for (const s of history) {
      if (s.id === currentShiftId) continue;
      if (s.endedAt) {
        const settled = await this.settlements.getByShiftId(s.id);
        if (!settled) return true;
        // Hvis vi finner én lukket shift med settlement, er tidligere shifts
        // for gamle til å betraktes som pending. Return ellers fortsett.
        return false;
      }
    }
    return false;
  }
}
