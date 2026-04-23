/**
 * BIN-583 B3.4: Metronia ticket-orkestrator.
 *
 * Forretningsregler:
 *   - createTicket: debit player wallet → create Metronia ticket → lagre
 *     i app_machine_tickets → log MACHINE_CREATE i agent_transactions
 *   - topupTicket: debit player wallet → upgrade Metronia ticket → update
 *     DB + log MACHINE_TOPUP
 *   - closeTicket: close Metronia API → credit player wallet med
 *     finalBalance → mark closed + log MACHINE_CLOSE
 *   - voidTicket (innen VOID_WINDOW_MS): close Metronia API → refund
 *     ALL initial+topups til player → mark voided + log MACHINE_VOID
 *   - rapporter: aggregat over agent_transactions filtrert MACHINE_*
 *
 * Atomicity-pragma: tre-fase wallet ↔ external API ↔ DB. Real-world
 * crash-recovery handles via uniqueTransaction-idempotency på Metronia
 * + DB-unique-index. Ved partial-failure blir agent og support varslet
 * via audit-log; manuell reconcile-flyt er BIN-XXX (utenfor scope).
 */

import { randomUUID } from "node:crypto";
import { DomainError } from "../game/BingoEngine.js";
import { IdempotencyKeys } from "../game/idempotency.js";
import type { PlatformService, UserRole } from "../platform/PlatformService.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import type { AgentService } from "./AgentService.js";
import type { AgentShiftService } from "./AgentShiftService.js";
import type {
  AgentTransactionStore,
  AgentTransaction,
  ShiftAggregate,
} from "./AgentTransactionStore.js";
import type {
  MachineTicketStore,
  MachineTicket,
} from "./MachineTicketStore.js";
import type { MetroniaApiClient } from "../integration/metronia/MetroniaApiClient.js";

/** Vindu for å void-e en nyopprettet ticket (5 min). */
export const VOID_WINDOW_MS = 5 * 60 * 1000;

/** Min/max amount for Metronia create-ticket — match legacy 1-1000 NOK. */
const MIN_AMOUNT_NOK = 1;
const MAX_AMOUNT_NOK = 1000;

export interface CreateMetroniaTicketInput {
  agentUserId: string;
  playerUserId: string;
  amountNok: number;
  clientRequestId: string;
  notes?: string;
}

export interface TopupMetroniaTicketInput {
  agentUserId: string;
  ticketNumber: string;
  amountNok: number;
  clientRequestId: string;
}

export interface PayoutMetroniaTicketInput {
  agentUserId: string;
  ticketNumber: string;
  clientRequestId: string;
}

export interface VoidMetroniaTicketInput {
  agentUserId: string;
  agentRole: UserRole;
  ticketNumber: string;
  reason: string;
}

/**
 * BIN-582 autoClose-cron: system-initiert close av hengende ticket.
 *
 * Kalles fra daglig cron — NO active-shift-check (agent har typisk
 * allerede settlet shiften når cron kjører). Gjør samme Metronia-API-kall
 * og wallet-credit som manuell close, men logger ikke agent-transaction
 * hvis ticketen ikke har shift_id (kan skje hvis shiften er slettet;
 * app_agent_transactions.shift_id er NOT NULL).
 *
 * Idempotent: unique-transaction-suffix `:auto` forhindrer dobbel-API-kall
 * om jobben kjører to ganger (retry etter crash).
 */
export interface AutoCloseMetroniaTicketInput {
  /** Machine-ticket ID (ikke ticket_number). */
  ticketId: string;
  /** System-user ID som skal stemples som closed_by. */
  systemActorUserId: string;
}

export interface MetroniaDailySalesAggregate {
  shiftId: string | null;
  totalCreatedNok: number;
  totalToppedUpNok: number;
  totalPaidOutNok: number;
  ticketCount: number;
  voidCount: number;
}

export interface MetroniaTicketServiceDeps {
  platformService: PlatformService;
  walletAdapter: WalletAdapter;
  agentService: AgentService;
  agentShiftService: AgentShiftService;
  transactionStore: AgentTransactionStore;
  machineTicketStore: MachineTicketStore;
  metroniaClient: MetroniaApiClient;
}

export class MetroniaTicketService {
  private readonly platform: PlatformService;
  private readonly wallet: WalletAdapter;
  private readonly agents: AgentService;
  private readonly shifts: AgentShiftService;
  private readonly txs: AgentTransactionStore;
  private readonly tickets: MachineTicketStore;
  private readonly metronia: MetroniaApiClient;

  constructor(deps: MetroniaTicketServiceDeps) {
    this.platform = deps.platformService;
    this.wallet = deps.walletAdapter;
    this.agents = deps.agentService;
    this.shifts = deps.agentShiftService;
    this.txs = deps.transactionStore;
    this.tickets = deps.machineTicketStore;
    this.metronia = deps.metroniaClient;
  }

  // ── CREATE ──────────────────────────────────────────────────────────────

  async createTicket(input: CreateMetroniaTicketInput): Promise<MachineTicket> {
    assertAmountInRange(input.amountNok, "amountNok");
    const shift = await this.requireActiveShift(input.agentUserId);
    await this.requirePlayerInHall(input.playerUserId, shift.hallId);
    const player = await this.platform.getUserById(input.playerUserId);
    const previousBalance = await this.wallet.getBalance(player.walletId);
    if (previousBalance < input.amountNok) {
      throw new DomainError("INSUFFICIENT_BALANCE", "Spilleren har ikke nok i wallet.");
    }
    const amountCents = nokToCents(input.amountNok);
    const ticketId = `mtkt-${randomUUID()}`;
    const uniqueTransaction = `metronia:create:${ticketId}:${input.clientRequestId}`;

    // 1. Debit wallet (idempotent på uniqueTransaction).
    const walletTx = await this.wallet.debit(
      player.walletId,
      input.amountNok,
      `Metronia ticket create ${ticketId}`,
      { idempotencyKey: uniqueTransaction }
    );

    // 2. Call Metronia API.
    let apiResult;
    try {
      apiResult = await this.metronia.createTicket({
        amountCents,
        uniqueTransaction,
      });
    } catch (err) {
      // Refund wallet — Metronia failed, money skal ikke være tatt fra spiller.
      await this.wallet.credit(
        player.walletId,
        input.amountNok,
        `Refund — Metronia create failed (${ticketId})`,
        { idempotencyKey: IdempotencyKeys.machineRefund({ uniqueTransaction }) }
      );
      throw err;
    }

    // 3. Persist to DB.
    const ticket = await this.tickets.insert({
      id: ticketId,
      machineName: "METRONIA",
      ticketNumber: apiResult.ticketNumber,
      externalTicketId: apiResult.ticketId,
      hallId: shift.hallId,
      shiftId: shift.id,
      agentUserId: input.agentUserId,
      playerUserId: input.playerUserId,
      initialAmountCents: amountCents,
      uniqueTransaction,
      otherData: {
        clientRequestId: input.clientRequestId,
        notes: input.notes ?? null,
      },
    });

    // 4. Log agent-transaction.
    await this.txs.insert({
      id: `agenttx-${randomUUID()}`,
      shiftId: shift.id,
      agentUserId: input.agentUserId,
      playerUserId: player.id,
      hallId: shift.hallId,
      actionType: "MACHINE_CREATE",
      walletDirection: "DEBIT",
      paymentMethod: "WALLET",
      amount: input.amountNok,
      previousBalance,
      afterBalance: previousBalance - input.amountNok,
      walletTxId: walletTx.id,
      ticketUniqueId: apiResult.ticketNumber,
      otherData: {
        machineName: "METRONIA",
        machineTicketId: ticketId,
        externalTicketId: apiResult.ticketId,
      },
    });

    return ticket;
  }

  // ── TOPUP ───────────────────────────────────────────────────────────────

  async topupTicket(input: TopupMetroniaTicketInput): Promise<MachineTicket> {
    assertAmountInRange(input.amountNok, "amountNok");
    const shift = await this.requireActiveShift(input.agentUserId);
    const ticket = await this.tickets.getByTicketNumber("METRONIA", input.ticketNumber);
    if (!ticket) throw new DomainError("MACHINE_TICKET_NOT_FOUND", "Ukjent Metronia-ticket.");
    if (ticket.isClosed) throw new DomainError("MACHINE_TICKET_CLOSED", "Ticket er allerede lukket.");
    if (ticket.hallId !== shift.hallId) {
      throw new DomainError("MACHINE_TICKET_WRONG_HALL", "Ticket tilhører annen hall.");
    }

    const player = await this.platform.getUserById(ticket.playerUserId);
    const previousBalance = await this.wallet.getBalance(player.walletId);
    if (previousBalance < input.amountNok) {
      throw new DomainError("INSUFFICIENT_BALANCE", "Spilleren har ikke nok i wallet.");
    }
    const amountCents = nokToCents(input.amountNok);
    const uniqueTransaction = `metronia:topup:${ticket.id}:${input.clientRequestId}`;

    const walletTx = await this.wallet.debit(
      player.walletId,
      input.amountNok,
      `Metronia topup ${ticket.id}`,
      { idempotencyKey: uniqueTransaction }
    );

    let apiResult;
    try {
      apiResult = await this.metronia.topupTicket({
        ticketNumber: ticket.ticketNumber,
        amountCents,
        uniqueTransaction,
        roomId: ticket.roomId,
      });
    } catch (err) {
      await this.wallet.credit(
        player.walletId,
        input.amountNok,
        `Refund — Metronia topup failed (${ticket.id})`,
        { idempotencyKey: IdempotencyKeys.machineRefund({ uniqueTransaction }) }
      );
      throw err;
    }

    const updated = await this.tickets.applyTopup(ticket.id, amountCents, apiResult.newBalanceCents);
    await this.txs.insert({
      id: `agenttx-${randomUUID()}`,
      shiftId: shift.id,
      agentUserId: input.agentUserId,
      playerUserId: player.id,
      hallId: shift.hallId,
      actionType: "MACHINE_TOPUP",
      walletDirection: "DEBIT",
      paymentMethod: "WALLET",
      amount: input.amountNok,
      previousBalance,
      afterBalance: previousBalance - input.amountNok,
      walletTxId: walletTx.id,
      ticketUniqueId: ticket.ticketNumber,
      otherData: {
        machineName: "METRONIA",
        machineTicketId: ticket.id,
        newBalanceCents: apiResult.newBalanceCents,
      },
    });
    return updated;
  }

  // ── PAYOUT (close + credit) ─────────────────────────────────────────────

  async closeTicket(input: PayoutMetroniaTicketInput): Promise<MachineTicket> {
    const shift = await this.requireActiveShift(input.agentUserId);
    const ticket = await this.tickets.getByTicketNumber("METRONIA", input.ticketNumber);
    if (!ticket) throw new DomainError("MACHINE_TICKET_NOT_FOUND", "Ukjent Metronia-ticket.");
    if (ticket.isClosed) throw new DomainError("MACHINE_TICKET_CLOSED", "Ticket er allerede lukket.");
    if (ticket.hallId !== shift.hallId) {
      throw new DomainError("MACHINE_TICKET_WRONG_HALL", "Ticket tilhører annen hall.");
    }

    const uniqueTransaction = `metronia:close:${ticket.id}:${input.clientRequestId}`;
    const apiResult = await this.metronia.closeTicket({
      ticketNumber: ticket.ticketNumber,
      uniqueTransaction,
      roomId: ticket.roomId,
    });

    const payoutNok = centsToNok(apiResult.finalBalanceCents);
    const player = await this.platform.getUserById(ticket.playerUserId);
    const previousBalance = await this.wallet.getBalance(player.walletId);
    let walletTxId: string | null = null;
    let afterBalance = previousBalance;
    if (payoutNok > 0) {
      const walletTx = await this.wallet.credit(
        player.walletId,
        payoutNok,
        `Metronia payout ${ticket.id}`,
        { idempotencyKey: IdempotencyKeys.machineCredit({ uniqueTransaction }) }
      );
      walletTxId = walletTx.id;
      afterBalance = previousBalance + payoutNok;
    }

    const closed = await this.tickets.markClosed(ticket.id, input.agentUserId, apiResult.finalBalanceCents);
    await this.txs.insert({
      id: `agenttx-${randomUUID()}`,
      shiftId: shift.id,
      agentUserId: input.agentUserId,
      playerUserId: player.id,
      hallId: shift.hallId,
      actionType: "MACHINE_CLOSE",
      walletDirection: "CREDIT",
      paymentMethod: "WALLET",
      amount: payoutNok,
      previousBalance,
      afterBalance,
      walletTxId,
      ticketUniqueId: ticket.ticketNumber,
      otherData: {
        machineName: "METRONIA",
        machineTicketId: ticket.id,
        payoutCents: apiResult.finalBalanceCents,
      },
    });
    return closed;
  }

  // ── AUTO-CLOSE (cron, BIN-582) ──────────────────────────────────────────

  /**
   * System-initiert close fra daglig cron. Speiler closeTicket() men:
   *   - Ingen active-shift-check (agent kan ha settlet shiften alt).
   *   - `ticketId` brukes direkte (cron scanner på id, ikke ticketNumber).
   *   - agent-transaction skrives kun hvis ticket.shiftId er satt (DB-CHECK
   *     krever NOT NULL). Ved NULL shift_id logger vi kun via structured log
   *     + compliance-audit (se cron-job).
   *   - uniqueTransaction-suffix `:auto` for idempotency mot Metronia-API.
   *
   * Returnerer den lukkede ticket-en. Kaster hvis allerede lukket eller
   * Metronia-API feiler — cron-jobb fanger og logger per-ticket-feil.
   */
  async autoCloseTicket(input: AutoCloseMetroniaTicketInput): Promise<MachineTicket> {
    const ticket = await this.tickets.getById(input.ticketId);
    if (!ticket) throw new DomainError("MACHINE_TICKET_NOT_FOUND", "Ukjent Metronia-ticket.");
    if (ticket.machineName !== "METRONIA") {
      throw new DomainError("MACHINE_TICKET_WRONG_TYPE", "Ticket er ikke en Metronia-ticket.");
    }
    if (ticket.isClosed) {
      throw new DomainError("MACHINE_TICKET_CLOSED", "Ticket er allerede lukket.");
    }

    const uniqueTransaction = `metronia:close:${ticket.id}:auto`;
    const apiResult = await this.metronia.closeTicket({
      ticketNumber: ticket.ticketNumber,
      uniqueTransaction,
      roomId: ticket.roomId,
    });

    const payoutNok = centsToNok(apiResult.finalBalanceCents);
    const player = await this.platform.getUserById(ticket.playerUserId);
    const previousBalance = await this.wallet.getBalance(player.walletId);
    let walletTxId: string | null = null;
    let afterBalance = previousBalance;
    if (payoutNok > 0) {
      const walletTx = await this.wallet.credit(
        player.walletId,
        payoutNok,
        `Metronia auto-close payout ${ticket.id}`,
        { idempotencyKey: IdempotencyKeys.machineCredit({ uniqueTransaction }) }
      );
      walletTxId = walletTx.id;
      afterBalance = previousBalance + payoutNok;
    }

    const closed = await this.tickets.markClosed(
      ticket.id,
      input.systemActorUserId,
      apiResult.finalBalanceCents
    );

    // agent-transactions.shift_id er NOT NULL — skipper rad hvis shift er
    // fjernet (ON DELETE SET NULL på machine_tickets). Cron logger selv
    // via compliance-audit uavhengig av dette.
    if (ticket.shiftId) {
      await this.txs.insert({
        id: `agenttx-${randomUUID()}`,
        shiftId: ticket.shiftId,
        agentUserId: ticket.agentUserId,
        playerUserId: player.id,
        hallId: ticket.hallId,
        actionType: "MACHINE_CLOSE",
        walletDirection: "CREDIT",
        paymentMethod: "WALLET",
        amount: payoutNok,
        previousBalance,
        afterBalance,
        walletTxId,
        ticketUniqueId: ticket.ticketNumber,
        notes: "auto-close (daily cron)",
        otherData: {
          machineName: "METRONIA",
          machineTicketId: ticket.id,
          payoutCents: apiResult.finalBalanceCents,
          autoClosed: true,
          systemActorUserId: input.systemActorUserId,
        },
      });
    }
    return closed;
  }

  // ── VOID (counter-tx, 5 min vindu) ──────────────────────────────────────

  async voidTicket(input: VoidMetroniaTicketInput): Promise<MachineTicket> {
    if (!input.reason?.trim()) {
      throw new DomainError("VOID_REASON_REQUIRED", "Du må oppgi grunn for void.");
    }
    const ticket = await this.tickets.getByTicketNumber("METRONIA", input.ticketNumber);
    if (!ticket) throw new DomainError("MACHINE_TICKET_NOT_FOUND", "Ukjent Metronia-ticket.");
    if (ticket.isClosed) throw new DomainError("MACHINE_TICKET_CLOSED", "Ticket er allerede lukket.");

    const isOwner = input.agentUserId === ticket.agentUserId;
    const isAdmin = input.agentRole === "ADMIN";
    if (!isOwner && !isAdmin) {
      throw new DomainError("FORBIDDEN", "Du kan ikke void-e denne ticket-en.");
    }

    const ageMs = Date.now() - new Date(ticket.createdAt).getTime();
    if (ageMs > VOID_WINDOW_MS && !isAdmin) {
      throw new DomainError(
        "VOID_WINDOW_EXPIRED",
        `Void-vinduet (${VOID_WINDOW_MS / 60000} min) er utløpt. Bruk close-ticket eller kontakt admin.`
      );
    }

    // Aktiv shift må eksistere for non-admin (matcher freeze-pattern).
    const shift = isAdmin
      ? await this.shifts.getShift(ticket.shiftId ?? "")
      : await this.requireActiveShift(input.agentUserId);

    const uniqueTransaction = `metronia:void:${ticket.id}`;

    // Lukk på Metronia-siden (samme HTTP-kall som close — vi forkaster
    // payout fordi ALL pengene refunderes uavhengig av spillet).
    try {
      await this.metronia.closeTicket({
        ticketNumber: ticket.ticketNumber,
        uniqueTransaction,
        roomId: ticket.roomId,
      });
    } catch (err) {
      // Hvis Metronia allerede har lukket (idempotent), vi fortsetter med refund.
      // Men hvis annen feil, propager.
      if (err instanceof DomainError && err.code === "METRONIA_TICKET_CLOSED") {
        // OK — fortsett med refund
      } else {
        throw err;
      }
    }

    const refundCents = ticket.initialAmountCents + ticket.totalTopupCents;
    const refundNok = centsToNok(refundCents);
    const player = await this.platform.getUserById(ticket.playerUserId);
    const previousBalance = await this.wallet.getBalance(player.walletId);
    let walletTxId: string | null = null;
    let afterBalance = previousBalance;
    if (refundNok > 0) {
      const walletTx = await this.wallet.credit(
        player.walletId,
        refundNok,
        `Metronia void refund ${ticket.id}`,
        { idempotencyKey: IdempotencyKeys.machineCredit({ uniqueTransaction }) }
      );
      walletTxId = walletTx.id;
      afterBalance = previousBalance + refundNok;
    }

    const voided = await this.tickets.markVoid(ticket.id, input.agentUserId, input.reason.trim());
    await this.txs.insert({
      id: `agenttx-${randomUUID()}`,
      shiftId: shift.id,
      agentUserId: input.agentUserId,
      playerUserId: player.id,
      hallId: ticket.hallId,
      actionType: "MACHINE_VOID",
      walletDirection: "CREDIT",
      paymentMethod: "WALLET",
      amount: refundNok,
      previousBalance,
      afterBalance,
      walletTxId,
      ticketUniqueId: ticket.ticketNumber,
      notes: input.reason.trim(),
      otherData: {
        machineName: "METRONIA",
        machineTicketId: ticket.id,
        forceAdmin: isAdmin && !isOwner,
        ageMs,
      },
    });
    return voided;
  }

  // ── READ paths ──────────────────────────────────────────────────────────

  async getTicketByNumber(ticketNumber: string): Promise<MachineTicket> {
    const ticket = await this.tickets.getByTicketNumber("METRONIA", ticketNumber);
    if (!ticket) throw new DomainError("MACHINE_TICKET_NOT_FOUND", "Ukjent Metronia-ticket.");
    return ticket;
  }

  async getDailySalesForCurrentShift(agentUserId: string): Promise<MetroniaDailySalesAggregate> {
    await this.agents.requireActiveAgent(agentUserId);
    const shift = await this.shifts.getCurrentShift(agentUserId);
    if (!shift) {
      const [recent] = await this.shifts.getHistory(agentUserId, { limit: 1 });
      if (!recent) {
        return {
          shiftId: null,
          totalCreatedNok: 0, totalToppedUpNok: 0, totalPaidOutNok: 0,
          ticketCount: 0, voidCount: 0,
        };
      }
      return this.aggregateMetroniaForShift(recent.id);
    }
    return this.aggregateMetroniaForShift(shift.id);
  }

  async getHallSummary(hallId: string, opts: { fromDate?: string; toDate?: string }): Promise<MetroniaDailySalesAggregate & { hallId: string }> {
    const txs = await this.txs.list({
      hallId,
      limit: 500,
      ...(opts.fromDate && { since: opts.fromDate }),
    });
    const aggregate = aggregateMetroniaTxs(txs.filter((t) => isMetroniaAction(t.actionType)));
    return { hallId, ...aggregate, shiftId: null };
  }

  async getDailyReport(opts: { fromDate?: string; toDate?: string }): Promise<{
    totals: MetroniaDailySalesAggregate;
    perHall: Array<MetroniaDailySalesAggregate & { hallId: string }>;
  }> {
    const txs = await this.txs.list({
      limit: 500,
      ...(opts.fromDate && { since: opts.fromDate }),
    });
    const metroniaTxs = txs.filter((t) => isMetroniaAction(t.actionType));
    const totals = aggregateMetroniaTxs(metroniaTxs);
    const perHallMap = new Map<string, AgentTransaction[]>();
    for (const t of metroniaTxs) {
      const list = perHallMap.get(t.hallId) ?? [];
      list.push(t);
      perHallMap.set(t.hallId, list);
    }
    const perHall = Array.from(perHallMap.entries()).map(([hallId, list]) => ({
      hallId,
      ...aggregateMetroniaTxs(list),
      shiftId: null as string | null,
    }));
    return { totals: { ...totals, shiftId: null }, perHall };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async aggregateMetroniaForShift(shiftId: string): Promise<MetroniaDailySalesAggregate> {
    const txs = await this.txs.list({ shiftId, limit: 500 });
    const aggregate = aggregateMetroniaTxs(txs.filter((t) => isMetroniaAction(t.actionType)));
    return { shiftId, ...aggregate };
  }

  private async requireActiveShift(agentUserId: string) {
    await this.agents.requireActiveAgent(agentUserId);
    const shift = await this.shifts.getCurrentShift(agentUserId);
    if (!shift) {
      throw new DomainError("NO_ACTIVE_SHIFT", "Du må åpne en shift.");
    }
    if (shift.settledAt) {
      throw new DomainError("SHIFT_SETTLED", "Shiften er avsluttet med daglig oppgjør.");
    }
    return shift;
  }

  private async requirePlayerInHall(playerUserId: string, hallId: string): Promise<void> {
    const isActive = await this.platform.isPlayerActiveInHall(playerUserId, hallId);
    if (!isActive) {
      throw new DomainError("PLAYER_NOT_AT_HALL", "Spilleren er ikke registrert i denne hallen.");
    }
  }
}

function nokToCents(nok: number): number {
  return Math.round(nok * 100);
}

function centsToNok(cents: number): number {
  return Math.round(cents) / 100;
}

function assertAmountInRange(nok: number, field: string): void {
  if (!Number.isFinite(nok) || nok < MIN_AMOUNT_NOK || nok > MAX_AMOUNT_NOK) {
    throw new DomainError(
      "INVALID_AMOUNT",
      `${field} må være mellom ${MIN_AMOUNT_NOK} og ${MAX_AMOUNT_NOK} NOK.`
    );
  }
  // Heltall — Metronia regner i cents/heltall.
  if (Math.abs(nok - Math.round(nok)) > 1e-9) {
    throw new DomainError("INVALID_AMOUNT", `${field} må være et heltall (NOK).`);
  }
}

function isMetroniaAction(action: string): boolean {
  return action === "MACHINE_CREATE" || action === "MACHINE_TOPUP" ||
         action === "MACHINE_CLOSE" || action === "MACHINE_VOID";
}

function aggregateMetroniaTxs(txs: AgentTransaction[]): Omit<MetroniaDailySalesAggregate, "shiftId"> {
  let totalCreatedNok = 0;
  let totalToppedUpNok = 0;
  let totalPaidOutNok = 0;
  let ticketCount = 0;
  let voidCount = 0;
  for (const t of txs) {
    const machineName = (t.otherData as { machineName?: string }).machineName;
    if (machineName !== "METRONIA") continue;
    if (t.actionType === "MACHINE_CREATE") {
      totalCreatedNok += t.amount;
      ticketCount++;
    } else if (t.actionType === "MACHINE_TOPUP") {
      totalToppedUpNok += t.amount;
    } else if (t.actionType === "MACHINE_CLOSE") {
      totalPaidOutNok += t.amount;
    } else if (t.actionType === "MACHINE_VOID") {
      voidCount++;
      totalPaidOutNok += t.amount;
    }
  }
  return { totalCreatedNok, totalToppedUpNok, totalPaidOutNok, ticketCount, voidCount };
}

export interface ShiftAggregateExport extends ShiftAggregate {}
