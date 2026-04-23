/**
 * BIN-583 B3.5: OK Bingo ticket-orkestrator.
 *
 * Speil av MetroniaTicketService med roomId-feltet og openDay-call.
 * Bruker felles MachineTicketStore (machine_name='OK_BINGO').
 *
 * Orkestrering: wallet → ekstern API (SQL Server polling i prod, Stub
 * i dev/CI) → DB-update + agent-tx-log. Refunderer wallet ved API-feil.
 *
 * Refactor til generisk MachineTicketService-base-klasse er BIN-XXX
 * follow-up når begge har stabilisert i prod.
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
} from "./AgentTransactionStore.js";
import type {
  MachineTicketStore,
  MachineTicket,
} from "./MachineTicketStore.js";
import type { OkBingoApiClient } from "../integration/okbingo/OkBingoApiClient.js";

/** Vindu for å void-e en nyopprettet ticket (5 min — match B3.4). */
export const VOID_WINDOW_MS = 5 * 60 * 1000;

/** Min/max amount per legacy 1-1000 NOK. */
const MIN_AMOUNT_NOK = 1;
const MAX_AMOUNT_NOK = 1000;

export const DEFAULT_BINGO_ROOM_ID = 247;

export interface CreateOkBingoTicketInput {
  agentUserId: string;
  playerUserId: string;
  amountNok: number;
  /** Override default 247. Hentes fra hall.other_data.okbingoRoomId i fremtid. */
  roomId?: number;
  clientRequestId: string;
  notes?: string;
}

export interface TopupOkBingoTicketInput {
  agentUserId: string;
  ticketNumber: string;
  amountNok: number;
  clientRequestId: string;
}

export interface PayoutOkBingoTicketInput {
  agentUserId: string;
  ticketNumber: string;
  clientRequestId: string;
}

export interface VoidOkBingoTicketInput {
  agentUserId: string;
  agentRole: UserRole;
  ticketNumber: string;
  reason: string;
}

export interface OpenDayInput {
  agentUserId: string;
  roomId?: number;
}

export interface OkBingoDailySalesAggregate {
  shiftId: string | null;
  totalCreatedNok: number;
  totalToppedUpNok: number;
  totalPaidOutNok: number;
  ticketCount: number;
  voidCount: number;
}

export interface OkBingoTicketServiceDeps {
  platformService: PlatformService;
  walletAdapter: WalletAdapter;
  agentService: AgentService;
  agentShiftService: AgentShiftService;
  transactionStore: AgentTransactionStore;
  machineTicketStore: MachineTicketStore;
  okBingoClient: OkBingoApiClient;
  defaultRoomId?: number;
}

export class OkBingoTicketService {
  private readonly platform: PlatformService;
  private readonly wallet: WalletAdapter;
  private readonly agents: AgentService;
  private readonly shifts: AgentShiftService;
  private readonly txs: AgentTransactionStore;
  private readonly tickets: MachineTicketStore;
  private readonly okbingo: OkBingoApiClient;
  private readonly defaultRoomId: number;

  constructor(deps: OkBingoTicketServiceDeps) {
    this.platform = deps.platformService;
    this.wallet = deps.walletAdapter;
    this.agents = deps.agentService;
    this.shifts = deps.agentShiftService;
    this.txs = deps.transactionStore;
    this.tickets = deps.machineTicketStore;
    this.okbingo = deps.okBingoClient;
    this.defaultRoomId = deps.defaultRoomId ?? DEFAULT_BINGO_ROOM_ID;
  }

  // ── CREATE ──────────────────────────────────────────────────────────────

  async createTicket(input: CreateOkBingoTicketInput): Promise<MachineTicket> {
    assertAmountInRange(input.amountNok, "amountNok");
    const shift = await this.requireActiveShift(input.agentUserId);
    await this.requirePlayerInHall(input.playerUserId, shift.hallId);
    const player = await this.platform.getUserById(input.playerUserId);
    const previousBalance = await this.wallet.getBalance(player.walletId);
    if (previousBalance < input.amountNok) {
      throw new DomainError("INSUFFICIENT_BALANCE", "Spilleren har ikke nok i wallet.");
    }
    const amountCents = nokToCents(input.amountNok);
    const ticketId = `oktkt-${randomUUID()}`;
    const uniqueTransaction = `okbingo:create:${ticketId}:${input.clientRequestId}`;
    const roomId = input.roomId ?? this.defaultRoomId;

    const walletTx = await this.wallet.debit(
      player.walletId,
      input.amountNok,
      `OK Bingo ticket create ${ticketId}`,
      { idempotencyKey: uniqueTransaction }
    );

    let apiResult;
    try {
      apiResult = await this.okbingo.createTicket({
        amountCents, roomId, uniqueTransaction,
      });
    } catch (err) {
      await this.wallet.credit(
        player.walletId,
        input.amountNok,
        `Refund — OK Bingo create failed (${ticketId})`,
        { idempotencyKey: IdempotencyKeys.machineRefund({ uniqueTransaction }) }
      );
      throw err;
    }

    const ticket = await this.tickets.insert({
      id: ticketId,
      machineName: "OK_BINGO",
      ticketNumber: apiResult.ticketNumber,
      externalTicketId: apiResult.ticketId,
      hallId: shift.hallId,
      shiftId: shift.id,
      agentUserId: input.agentUserId,
      playerUserId: input.playerUserId,
      roomId: String(apiResult.roomId),
      initialAmountCents: amountCents,
      uniqueTransaction,
      otherData: {
        clientRequestId: input.clientRequestId,
        notes: input.notes ?? null,
        roomIdNumeric: apiResult.roomId,
      },
    });

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
        machineName: "OK_BINGO",
        machineTicketId: ticketId,
        externalTicketId: apiResult.ticketId,
        roomId: apiResult.roomId,
      },
    });

    return ticket;
  }

  // ── TOPUP ───────────────────────────────────────────────────────────────

  async topupTicket(input: TopupOkBingoTicketInput): Promise<MachineTicket> {
    assertAmountInRange(input.amountNok, "amountNok");
    const shift = await this.requireActiveShift(input.agentUserId);
    const ticket = await this.tickets.getByTicketNumber("OK_BINGO", input.ticketNumber);
    if (!ticket) throw new DomainError("MACHINE_TICKET_NOT_FOUND", "Ukjent OK Bingo-ticket.");
    if (ticket.isClosed) throw new DomainError("MACHINE_TICKET_CLOSED", "Ticket er lukket.");
    if (ticket.hallId !== shift.hallId) {
      throw new DomainError("MACHINE_TICKET_WRONG_HALL", "Ticket tilhører annen hall.");
    }

    const player = await this.platform.getUserById(ticket.playerUserId);
    const previousBalance = await this.wallet.getBalance(player.walletId);
    if (previousBalance < input.amountNok) {
      throw new DomainError("INSUFFICIENT_BALANCE", "Spilleren har ikke nok i wallet.");
    }
    const amountCents = nokToCents(input.amountNok);
    const uniqueTransaction = `okbingo:topup:${ticket.id}:${input.clientRequestId}`;
    const roomId = Number.parseInt(ticket.roomId ?? "", 10) || this.defaultRoomId;

    const walletTx = await this.wallet.debit(
      player.walletId,
      input.amountNok,
      `OK Bingo topup ${ticket.id}`,
      { idempotencyKey: uniqueTransaction }
    );

    let apiResult;
    try {
      apiResult = await this.okbingo.topupTicket({
        ticketNumber: ticket.ticketNumber,
        amountCents, roomId, uniqueTransaction,
      });
    } catch (err) {
      await this.wallet.credit(
        player.walletId,
        input.amountNok,
        `Refund — OK Bingo topup failed (${ticket.id})`,
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
        machineName: "OK_BINGO",
        machineTicketId: ticket.id,
        newBalanceCents: apiResult.newBalanceCents,
        roomId,
      },
    });
    return updated;
  }

  // ── PAYOUT (close) ──────────────────────────────────────────────────────

  async closeTicket(input: PayoutOkBingoTicketInput): Promise<MachineTicket> {
    const shift = await this.requireActiveShift(input.agentUserId);
    const ticket = await this.tickets.getByTicketNumber("OK_BINGO", input.ticketNumber);
    if (!ticket) throw new DomainError("MACHINE_TICKET_NOT_FOUND", "Ukjent OK Bingo-ticket.");
    if (ticket.isClosed) throw new DomainError("MACHINE_TICKET_CLOSED", "Ticket er lukket.");
    if (ticket.hallId !== shift.hallId) {
      throw new DomainError("MACHINE_TICKET_WRONG_HALL", "Ticket tilhører annen hall.");
    }

    const uniqueTransaction = `okbingo:close:${ticket.id}:${input.clientRequestId}`;
    const roomId = Number.parseInt(ticket.roomId ?? "", 10) || this.defaultRoomId;
    const apiResult = await this.okbingo.closeTicket({
      ticketNumber: ticket.ticketNumber,
      roomId, uniqueTransaction,
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
        `OK Bingo payout ${ticket.id}`,
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
        machineName: "OK_BINGO",
        machineTicketId: ticket.id,
        payoutCents: apiResult.finalBalanceCents,
        roomId,
      },
    });
    return closed;
  }

  // ── VOID (5 min vindu) ──────────────────────────────────────────────────

  async voidTicket(input: VoidOkBingoTicketInput): Promise<MachineTicket> {
    if (!input.reason?.trim()) {
      throw new DomainError("VOID_REASON_REQUIRED", "Du må oppgi grunn for void.");
    }
    const ticket = await this.tickets.getByTicketNumber("OK_BINGO", input.ticketNumber);
    if (!ticket) throw new DomainError("MACHINE_TICKET_NOT_FOUND", "Ukjent OK Bingo-ticket.");
    if (ticket.isClosed) throw new DomainError("MACHINE_TICKET_CLOSED", "Ticket er lukket.");

    const isOwner = input.agentUserId === ticket.agentUserId;
    const isAdmin = input.agentRole === "ADMIN";
    if (!isOwner && !isAdmin) {
      throw new DomainError("FORBIDDEN", "Du kan ikke void-e denne ticket-en.");
    }
    const ageMs = Date.now() - new Date(ticket.createdAt).getTime();
    if (ageMs > VOID_WINDOW_MS && !isAdmin) {
      throw new DomainError(
        "VOID_WINDOW_EXPIRED",
        `Void-vinduet (${VOID_WINDOW_MS / 60000} min) er utløpt.`
      );
    }

    const shift = isAdmin
      ? await this.shifts.getShift(ticket.shiftId ?? "")
      : await this.requireActiveShift(input.agentUserId);

    const uniqueTransaction = `okbingo:void:${ticket.id}`;
    const roomId = Number.parseInt(ticket.roomId ?? "", 10) || this.defaultRoomId;

    try {
      await this.okbingo.closeTicket({
        ticketNumber: ticket.ticketNumber,
        roomId, uniqueTransaction,
      });
    } catch (err) {
      if (err instanceof DomainError && err.code === "OKBINGO_TICKET_CLOSED") {
        // Allerede lukket på OK Bingo-siden — fortsett med refund.
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
        `OK Bingo void refund ${ticket.id}`,
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
        machineName: "OK_BINGO",
        machineTicketId: ticket.id,
        forceAdmin: isAdmin && !isOwner,
        ageMs,
        roomId,
      },
    });
    return voided;
  }

  // ── OPEN DAY (OK-Bingo-spesifikk) ───────────────────────────────────────

  async openDay(input: OpenDayInput): Promise<{ opened: true; roomId: number }> {
    await this.requireActiveShift(input.agentUserId);
    const roomId = input.roomId ?? this.defaultRoomId;
    await this.okbingo.openDay(roomId);
    return { opened: true, roomId };
  }

  // ── READ paths ──────────────────────────────────────────────────────────

  async getTicketByNumber(ticketNumber: string): Promise<MachineTicket> {
    const ticket = await this.tickets.getByTicketNumber("OK_BINGO", ticketNumber);
    if (!ticket) throw new DomainError("MACHINE_TICKET_NOT_FOUND", "Ukjent OK Bingo-ticket.");
    return ticket;
  }

  async getDailySalesForCurrentShift(agentUserId: string): Promise<OkBingoDailySalesAggregate> {
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
      return this.aggregateForShift(recent.id);
    }
    return this.aggregateForShift(shift.id);
  }

  async getHallSummary(hallId: string, opts: { fromDate?: string; toDate?: string }): Promise<OkBingoDailySalesAggregate & { hallId: string }> {
    const txs = await this.txs.list({
      hallId, limit: 500, ...(opts.fromDate && { since: opts.fromDate }),
    });
    const aggregate = aggregateOkBingoTxs(txs.filter((t) => isOkBingoAction(t.actionType)));
    return { hallId, ...aggregate, shiftId: null };
  }

  async getDailyReport(opts: { fromDate?: string; toDate?: string }): Promise<{
    totals: OkBingoDailySalesAggregate;
    perHall: Array<OkBingoDailySalesAggregate & { hallId: string }>;
  }> {
    const txs = await this.txs.list({
      limit: 500, ...(opts.fromDate && { since: opts.fromDate }),
    });
    const okbingoTxs = txs.filter((t) => isOkBingoAction(t.actionType));
    const totals = aggregateOkBingoTxs(okbingoTxs);
    const perHallMap = new Map<string, AgentTransaction[]>();
    for (const t of okbingoTxs) {
      const list = perHallMap.get(t.hallId) ?? [];
      list.push(t);
      perHallMap.set(t.hallId, list);
    }
    const perHall = Array.from(perHallMap.entries()).map(([hallId, list]) => ({
      hallId,
      ...aggregateOkBingoTxs(list),
      shiftId: null as string | null,
    }));
    return { totals: { ...totals, shiftId: null }, perHall };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async aggregateForShift(shiftId: string): Promise<OkBingoDailySalesAggregate> {
    const txs = await this.txs.list({ shiftId, limit: 500 });
    const aggregate = aggregateOkBingoTxs(txs.filter((t) => isOkBingoAction(t.actionType)));
    return { shiftId, ...aggregate };
  }

  private async requireActiveShift(agentUserId: string) {
    await this.agents.requireActiveAgent(agentUserId);
    const shift = await this.shifts.getCurrentShift(agentUserId);
    if (!shift) throw new DomainError("NO_ACTIVE_SHIFT", "Du må åpne en shift.");
    if (shift.settledAt) throw new DomainError("SHIFT_SETTLED", "Shiften er avsluttet med daglig oppgjør.");
    return shift;
  }

  private async requirePlayerInHall(playerUserId: string, hallId: string): Promise<void> {
    const isActive = await this.platform.isPlayerActiveInHall(playerUserId, hallId);
    if (!isActive) {
      throw new DomainError("PLAYER_NOT_AT_HALL", "Spilleren er ikke registrert i denne hallen.");
    }
  }
}

function nokToCents(nok: number): number { return Math.round(nok * 100); }
function centsToNok(cents: number): number { return Math.round(cents) / 100; }

function assertAmountInRange(nok: number, field: string): void {
  if (!Number.isFinite(nok) || nok < MIN_AMOUNT_NOK || nok > MAX_AMOUNT_NOK) {
    throw new DomainError(
      "INVALID_AMOUNT",
      `${field} må være mellom ${MIN_AMOUNT_NOK} og ${MAX_AMOUNT_NOK} NOK.`
    );
  }
  if (Math.abs(nok - Math.round(nok)) > 1e-9) {
    throw new DomainError("INVALID_AMOUNT", `${field} må være et heltall (NOK).`);
  }
}

function isOkBingoAction(action: string): boolean {
  return action === "MACHINE_CREATE" || action === "MACHINE_TOPUP" ||
         action === "MACHINE_CLOSE" || action === "MACHINE_VOID";
}

function aggregateOkBingoTxs(txs: AgentTransaction[]): Omit<OkBingoDailySalesAggregate, "shiftId"> {
  let totalCreatedNok = 0;
  let totalToppedUpNok = 0;
  let totalPaidOutNok = 0;
  let ticketCount = 0;
  let voidCount = 0;
  for (const t of txs) {
    const machineName = (t.otherData as { machineName?: string }).machineName;
    if (machineName !== "OK_BINGO") continue;
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
