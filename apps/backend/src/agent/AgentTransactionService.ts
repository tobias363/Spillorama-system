/**
 * BIN-583 B3.2: agent cash-ops + ticket sale / cancel / digital register.
 *
 * Wallet-flyt + shift-cash-column-mutation skjer atomisk via et delta-
 * mønster: vi lar WalletAdapter utføre debit/credit med idempotencyKey,
 * shifter cash-delta-update mot app_agent_shifts, og logger transaksjonen
 * i app_agent_transactions. Ingen cross-row tx per nå (wallet-adapter
 * har egen transaksjon, shift+tx i annen) — men alle operasjoner er
 * idempotente på wallet-side, så retries etter delvis feil gir samme
 * netto-effekt.
 *
 * Cancel er en counter-transaction (ny rad med related_tx_id) — vi
 * rører IKKE app_physical_tickets.status (fysisk billett ble overlevert).
 *
 * Inventory + getByUniqueId leser direkte fra app_physical_tickets (B4a
 * eksporterer ikke disse helperne ennå — TODO BIN-607 for migrering).
 */

import { randomUUID } from "node:crypto";
import { DomainError } from "../game/BingoEngine.js";
import type { PlatformService } from "../platform/PlatformService.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import type { PhysicalTicketService } from "../compliance/PhysicalTicketService.js";
import type { AgentService } from "./AgentService.js";
import type { AgentShiftService } from "./AgentShiftService.js";
import type { AgentStore, ShiftCashDelta } from "./AgentStore.js";
import type {
  AgentTransactionStore,
  AgentTransaction,
  PaymentMethod,
  ActionType,
} from "./AgentTransactionStore.js";
import type { TicketPurchasePort } from "./ports/TicketPurchasePort.js";
import type { PhysicalTicketReadPort } from "./ports/PhysicalTicketReadPort.js";

/**
 * GAME1_SCHEDULE PR 2: purchase-cutoff-guard. Kalles før physical + digital
 * ticket-sale-endepunkter godtar nye kjøp. Implementeres som en port så
 * AgentTransactionService ikke trenger å avhenge av Game1HallReadyService
 * direkte (enkel tester-substitusjon, samme mønster som
 * PhysicalTicketReadPort).
 */
export interface Game1PurchaseCutoffPort {
  /**
   * Kaster `PURCHASE_CLOSED_FOR_HALL` (DomainError) hvis hallen har
   * trykket klar for gameId. Passerer uten feil når hallen fortsatt er
   * åpen for kjøp (eller når gameId ikke er kjent — fallback for legacy
   * games uten schedule).
   */
  assertPurchaseOpenForHall(gameId: string, hallId: string): Promise<void>;
}

/** Default 10-minutters vindu for physical-sale-cancel (match legacy). */
export const CANCEL_SALE_WINDOW_MS = 10 * 60 * 1000;

export interface PhysicalTicketInventoryRow {
  uniqueId: string;
  batchId: string;
  hallId: string;
  status: "UNSOLD" | "SOLD" | "VOIDED";
  priceCents: number;
  assignedGameId: string | null;
}

export interface CashOpInput {
  agentUserId: string;
  playerUserId: string;
  amount: number;
  paymentMethod: "CASH" | "CARD";
  notes?: string;
  externalReference?: string;
  clientRequestId: string;
}

export interface SellPhysicalInput {
  agentUserId: string;
  playerUserId: string;
  ticketUniqueId: string;
  paymentMethod: PaymentMethod;
  clientRequestId: string;
}

export interface RegisterDigitalTicketInput {
  agentUserId: string;
  playerUserId: string;
  gameId: string;
  ticketCount: number;
  pricePerTicketCents: number;
  clientRequestId: string;
}

export interface CancelPhysicalSaleInput {
  agentUserId: string;
  agentRole: string;
  originalTxId: string;
  reason?: string;
}

export interface PlayerBalanceSnapshot {
  playerUserId: string;
  walletBalance: number;
  displayName: string;
  email: string;
}

export interface AgentTransactionServiceDeps {
  platformService: PlatformService;
  walletAdapter: WalletAdapter;
  physicalTicketService: PhysicalTicketService;
  physicalTicketReadPort: PhysicalTicketReadPort;
  ticketPurchasePort: TicketPurchasePort;
  agentService: AgentService;
  agentShiftService: AgentShiftService;
  agentStore: AgentStore;
  transactionStore: AgentTransactionStore;
  /**
   * GAME1_SCHEDULE PR 2: valgfri purchase-cutoff-port. Når injectet blir
   * hall-ready-statusen konsultert før physical + digital sales slippes
   * gjennom. Unntatt i testene slik at eksisterende suite ikke brekker —
   * index.ts injiserer Game1HallReadyService-adapteren i prod.
   */
  game1PurchaseCutoff?: Game1PurchaseCutoffPort;
}

export class AgentTransactionService {
  private readonly platform: PlatformService;
  private readonly wallet: WalletAdapter;
  private readonly physical: PhysicalTicketService;
  private readonly physicalRead: PhysicalTicketReadPort;
  private readonly digitalPort: TicketPurchasePort;
  private readonly agents: AgentService;
  private readonly shifts: AgentShiftService;
  private readonly store: AgentStore;
  private readonly txs: AgentTransactionStore;
  private readonly purchaseCutoff: Game1PurchaseCutoffPort | null;

  constructor(deps: AgentTransactionServiceDeps) {
    this.platform = deps.platformService;
    this.wallet = deps.walletAdapter;
    this.physical = deps.physicalTicketService;
    this.physicalRead = deps.physicalTicketReadPort;
    this.digitalPort = deps.ticketPurchasePort;
    this.agents = deps.agentService;
    this.shifts = deps.agentShiftService;
    this.store = deps.agentStore;
    this.txs = deps.transactionStore;
    this.purchaseCutoff = deps.game1PurchaseCutoff ?? null;
  }

  // ── Player lookup + balance ─────────────────────────────────────────────

  async lookupPlayers(agentUserId: string, query: string): Promise<Array<{
    id: string;
    email: string;
    displayName: string;
    phone: string | null;
  }>> {
    const shift = await this.requireActiveShift(agentUserId);
    const results = await this.platform.searchPlayersInHall({
      query,
      hallId: shift.hallId,
      limit: 20,
    });
    return results.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      phone: u.phone ?? null,
    }));
  }

  async getPlayerBalance(agentUserId: string, playerUserId: string): Promise<PlayerBalanceSnapshot> {
    const shift = await this.requireActiveShift(agentUserId);
    await this.requirePlayerInHall(playerUserId, shift.hallId);
    const player = await this.platform.getUserById(playerUserId);
    const balance = await this.wallet.getBalance(player.walletId);
    return {
      playerUserId: player.id,
      walletBalance: balance,
      displayName: player.displayName,
      email: player.email,
    };
  }

  // ── Cash in / Cash out ──────────────────────────────────────────────────

  async cashIn(input: CashOpInput): Promise<AgentTransaction> {
    return this.processCashOp(input, "CASH_IN", "CREDIT");
  }

  async cashOut(input: CashOpInput): Promise<AgentTransaction> {
    return this.processCashOp(input, "CASH_OUT", "DEBIT");
  }

  private async processCashOp(
    input: CashOpInput,
    actionType: "CASH_IN" | "CASH_OUT",
    walletDirection: "CREDIT" | "DEBIT"
  ): Promise<AgentTransaction> {
    assertPositive(input.amount, "amount");
    const shift = await this.requireActiveShift(input.agentUserId);
    await this.requirePlayerInHall(input.playerUserId, shift.hallId);
    const player = await this.platform.getUserById(input.playerUserId);
    const previousBalance = await this.wallet.getBalance(player.walletId);

    // Daily-balance-check for cash-out med CASH.
    if (actionType === "CASH_OUT" && input.paymentMethod === "CASH") {
      if (shift.dailyBalance < input.amount) {
        throw new DomainError(
          "INSUFFICIENT_DAILY_BALANCE",
          "Shift-en har ikke nok kontanter for denne uttaksoperasjonen."
        );
      }
    }
    if (walletDirection === "DEBIT" && previousBalance < input.amount) {
      throw new DomainError(
        "INSUFFICIENT_BALANCE",
        "Spilleren har ikke nok penger i wallet."
      );
    }

    const txId = `agenttx-${randomUUID()}`;
    const idempotencyKey = `agent-tx:${txId}:wallet`;
    const reason = `agent ${actionType} shift=${shift.id} clientReq=${input.clientRequestId}`;

    const walletTx = walletDirection === "CREDIT"
      ? await this.wallet.credit(player.walletId, input.amount, reason, { idempotencyKey })
      : await this.wallet.debit(player.walletId, input.amount, reason, { idempotencyKey });

    const afterBalance = walletDirection === "CREDIT"
      ? previousBalance + input.amount
      : previousBalance - input.amount;

    const delta: ShiftCashDelta = {};
    if (actionType === "CASH_IN") {
      if (input.paymentMethod === "CASH") {
        delta.totalCashIn = input.amount;
        delta.dailyBalance = input.amount;
      } else {
        delta.totalCardIn = input.amount;
      }
    } else {
      // CASH_OUT
      if (input.paymentMethod === "CASH") {
        delta.totalCashOut = input.amount;
        delta.dailyBalance = -input.amount;
      } else {
        delta.totalCardOut = input.amount;
      }
    }
    await this.store.applyShiftCashDelta(shift.id, delta);

    const tx = await this.txs.insert({
      id: txId,
      shiftId: shift.id,
      agentUserId: input.agentUserId,
      playerUserId: player.id,
      hallId: shift.hallId,
      actionType,
      walletDirection,
      paymentMethod: input.paymentMethod,
      amount: input.amount,
      previousBalance,
      afterBalance,
      walletTxId: walletTx.id,
      notes: input.notes ?? null,
      externalReference: input.externalReference ?? null,
      otherData: { clientRequestId: input.clientRequestId },
    });
    return tx;
  }

  // ── Physical ticket sale ────────────────────────────────────────────────

  async sellPhysicalTicket(input: SellPhysicalInput): Promise<AgentTransaction> {
    const shift = await this.requireActiveShift(input.agentUserId);
    await this.requirePlayerInHall(input.playerUserId, shift.hallId);

    // TODO BIN-607: Flytt til PhysicalTicketService.getByUniqueId() når
    // Agent 1 eksporterer det. Midlertidig read-only kryss-boundary via port.
    const ticket = await this.physicalRead.getByUniqueId(input.ticketUniqueId);
    if (!ticket) {
      throw new DomainError("PHYSICAL_TICKET_NOT_FOUND", "Fant ikke billetten.");
    }
    if (ticket.hallId !== shift.hallId) {
      throw new DomainError(
        "PHYSICAL_TICKET_WRONG_HALL",
        "Billetten hører ikke til agentens hall."
      );
    }
    if (ticket.status !== "UNSOLD") {
      throw new DomainError(
        "PHYSICAL_TICKET_NOT_SELLABLE",
        `Billetten har status ${ticket.status} — kan ikke selges.`
      );
    }

    // GAME1_SCHEDULE PR 2: purchase-cutoff-guard. Hvis billetten er knyttet
    // til et Game 1-spill (assignedGameId) og bingovert i denne hallen har
    // trykket klar, avvises salget med PURCHASE_CLOSED_FOR_HALL. Tickets
    // uten assignedGameId (åpen-batch-salg) passerer uendret.
    if (this.purchaseCutoff && ticket.assignedGameId) {
      await this.purchaseCutoff.assertPurchaseOpenForHall(
        ticket.assignedGameId,
        shift.hallId
      );
    }

    const player = await this.platform.getUserById(input.playerUserId);
    const previousBalance = await this.wallet.getBalance(player.walletId);
    const priceCents = ticket.priceCents;
    const priceNok = centsToAmount(priceCents);

    // Validering per payment-method.
    if (input.paymentMethod === "WALLET" && previousBalance < priceNok) {
      throw new DomainError("INSUFFICIENT_BALANCE", "Ikke nok penger i wallet.");
    }

    // Mark ticket as sold — idempotent retry-safe (B4a kaster NOT_SELLABLE
    // ved race, som vi mapper til domain-error).
    try {
      await this.physical.markSold({
        uniqueId: ticket.uniqueId,
        soldBy: input.agentUserId,
        buyerUserId: input.playerUserId,
        priceCents: priceCents,
      });
    } catch (err) {
      if (err instanceof DomainError) throw err;
      throw new DomainError("PHYSICAL_MARK_SOLD_FAILED", "Kunne ikke markere billett som solgt.");
    }

    const txId = `agenttx-${randomUUID()}`;
    let walletTxId: string | null = null;
    let afterBalance = previousBalance;
    if (input.paymentMethod === "WALLET") {
      const idempotencyKey = `agent-ticket:${ticket.uniqueId}:sell:wallet`;
      const reason = `physical ticket sale ${ticket.uniqueId} shift=${shift.id}`;
      const walletTx = await this.wallet.debit(player.walletId, priceNok, reason, { idempotencyKey });
      walletTxId = walletTx.id;
      afterBalance = previousBalance - priceNok;
    }

    // Shift cash-column update.
    const delta: ShiftCashDelta = { sellingByCustomerNumber: 1 };
    if (input.paymentMethod === "CASH") {
      delta.totalCashIn = priceNok;
      delta.dailyBalance = priceNok;
    } else if (input.paymentMethod === "CARD") {
      delta.totalCardIn = priceNok;
    }
    // WALLET: ingen shift-cash-mutation (shift er uendret for wallet-salg).
    await this.store.applyShiftCashDelta(shift.id, delta);

    const tx = await this.txs.insert({
      id: txId,
      shiftId: shift.id,
      agentUserId: input.agentUserId,
      playerUserId: player.id,
      hallId: shift.hallId,
      actionType: "TICKET_SALE",
      walletDirection: input.paymentMethod === "WALLET" ? "DEBIT" : "CREDIT",
      paymentMethod: input.paymentMethod,
      amount: priceNok,
      previousBalance,
      afterBalance,
      walletTxId,
      ticketUniqueId: ticket.uniqueId,
      otherData: {
        clientRequestId: input.clientRequestId,
        batchId: ticket.batchId,
        priceCents,
      },
    });
    return tx;
  }

  async cancelPhysicalSale(input: CancelPhysicalSaleInput): Promise<AgentTransaction> {
    const original = await this.txs.getById(input.originalTxId);
    if (!original) {
      throw new DomainError("TRANSACTION_NOT_FOUND", "Fant ikke originaltransaksjonen.");
    }
    if (original.actionType !== "TICKET_SALE") {
      throw new DomainError(
        "NOT_CANCELLABLE",
        "Kun TICKET_SALE-transaksjoner kan kanselleres via denne flyten."
      );
    }

    // Owner-sjekk: agenten må eie salget — eller ADMIN for force.
    const isOwner = input.agentUserId === original.agentUserId;
    const isAdmin = input.agentRole === "ADMIN";
    if (!isOwner && !isAdmin) {
      throw new DomainError("FORBIDDEN", "Du kan ikke kansellere denne transaksjonen.");
    }

    // Ikke-dobbel-cancel: partial-unique ikke tilstrekkelig; check explicit.
    const existingCancel = await this.txs.findCancelForTx(original.id);
    if (existingCancel) {
      throw new DomainError("ALREADY_CANCELLED", "Transaksjonen er allerede kansellert.");
    }

    // 10-min vindu — ADMIN kan kanselleere utover dette.
    const ageMs = Date.now() - new Date(original.createdAt).getTime();
    if (ageMs > CANCEL_SALE_WINDOW_MS && !isAdmin) {
      throw new DomainError(
        "CANCEL_WINDOW_EXPIRED",
        "Kanselleringsvinduet har gått ut. Kontakt admin for force-cancel."
      );
    }

    // Active shift må være agenten sin egen shift.
    const shift = isAdmin
      ? await this.shifts.getShift(original.shiftId)
      : await this.requireActiveShift(input.agentUserId);
    if (!isAdmin && shift.id !== original.shiftId) {
      throw new DomainError(
        "WRONG_SHIFT",
        "Kan kun kansellere salg som tilhører nåværende shift."
      );
    }

    const player = await this.platform.getUserById(original.playerUserId);
    const previousBalance = await this.wallet.getBalance(player.walletId);
    const amount = original.amount;

    // Refund wallet hvis original var WALLET-debit.
    let walletTxId: string | null = null;
    let afterBalance = previousBalance;
    if (original.paymentMethod === "WALLET" && original.walletDirection === "DEBIT") {
      const idempotencyKey = `agent-tx:${original.id}:cancel`;
      const reason = `physical sale cancel related=${original.id} shift=${shift.id}`;
      const walletTx = await this.wallet.credit(player.walletId, amount, reason, { idempotencyKey });
      walletTxId = walletTx.id;
      afterBalance = previousBalance + amount;
    }

    // Reverser shift-cash-delta.
    const delta: ShiftCashDelta = { sellingByCustomerNumber: -1 };
    if (original.paymentMethod === "CASH") {
      delta.totalCashIn = -amount;
      delta.dailyBalance = -amount;
    } else if (original.paymentMethod === "CARD") {
      delta.totalCardIn = -amount;
    }
    await this.store.applyShiftCashDelta(shift.id, delta);

    const counterTxId = `agenttx-${randomUUID()}`;
    const counterDirection = original.walletDirection === "DEBIT" ? "CREDIT" : "DEBIT";
    const cancel = await this.txs.insert({
      id: counterTxId,
      shiftId: shift.id,
      agentUserId: input.agentUserId,
      playerUserId: player.id,
      hallId: original.hallId,
      actionType: "TICKET_CANCEL",
      walletDirection: counterDirection,
      paymentMethod: original.paymentMethod,
      amount,
      previousBalance,
      afterBalance,
      walletTxId,
      ticketUniqueId: original.ticketUniqueId,
      relatedTxId: original.id,
      notes: input.reason ?? null,
      otherData: {
        forceAdmin: isAdmin && !isOwner,
        originalCreatedAt: original.createdAt,
      },
    });
    return cancel;
  }

  // ── Digital ticket register (stub) ──────────────────────────────────────

  async registerDigitalTicket(input: RegisterDigitalTicketInput): Promise<AgentTransaction> {
    assertPositive(input.pricePerTicketCents, "pricePerTicketCents");
    if (input.ticketCount < 1 || !Number.isInteger(input.ticketCount)) {
      throw new DomainError("INVALID_INPUT", "ticketCount må være positivt heltall.");
    }
    const shift = await this.requireActiveShift(input.agentUserId);
    await this.requirePlayerInHall(input.playerUserId, shift.hallId);
    const totalPriceCents = input.pricePerTicketCents * input.ticketCount;

    // GAME1_SCHEDULE PR 2: purchase-cutoff-guard for digital ticket-kjøp.
    // Hvis Game 1-spillet med input.gameId har bingovert-klar-status for
    // agentens hall → avvis med PURCHASE_CLOSED_FOR_HALL. Games som ikke
    // finnes i app_game1_scheduled_games (legacy, Game 2/3) passerer.
    if (this.purchaseCutoff) {
      await this.purchaseCutoff.assertPurchaseOpenForHall(
        input.gameId,
        shift.hallId
      );
    }

    // Kaller port — i B3.2 kaster stub NOT_IMPLEMENTED.
    // Når G2/G3 er web-native (BIN-608) wires real impl inn.
    await this.digitalPort.purchase({
      playerUserId: input.playerUserId,
      gameId: input.gameId,
      ticketCount: input.ticketCount,
      totalPriceCents,
      requestedByAgentUserId: input.agentUserId,
      idempotencyKey: `agent-ticket:digital:${input.gameId}:${input.playerUserId}:${input.clientRequestId}`,
    });

    // Code below runs kun når stub er erstattet med real impl. Vi lar
    // stub-error bobble opp som NOT_IMPLEMENTED så kaller får tydelig beskjed.
    const player = await this.platform.getUserById(input.playerUserId);
    const previousBalance = await this.wallet.getBalance(player.walletId);
    const priceNok = centsToAmount(totalPriceCents);
    const txId = `agenttx-${randomUUID()}`;
    const tx = await this.txs.insert({
      id: txId,
      shiftId: shift.id,
      agentUserId: input.agentUserId,
      playerUserId: player.id,
      hallId: shift.hallId,
      actionType: "TICKET_REGISTER",
      walletDirection: "DEBIT",
      paymentMethod: "WALLET",
      amount: priceNok,
      previousBalance,
      afterBalance: previousBalance - priceNok,
      walletTxId: null,
      otherData: {
        gameId: input.gameId,
        ticketCount: input.ticketCount,
        clientRequestId: input.clientRequestId,
      },
    });
    return tx;
  }

  // ── Transaction log ─────────────────────────────────────────────────────

  async listTransactionsForCurrentShift(agentUserId: string, opts?: { limit?: number; offset?: number }): Promise<AgentTransaction[]> {
    const shift = await this.shifts.getCurrentShift(agentUserId);
    if (!shift) {
      // Ingen aktiv shift — returner siste shift-logg eller tom.
      const [recent] = await this.shifts.getHistory(agentUserId, { limit: 1 });
      if (!recent) return [];
      return this.txs.list({ shiftId: recent.id, ...opts });
    }
    return this.txs.list({ shiftId: shift.id, ...opts });
  }

  async listTransactions(filter: {
    agentUserId?: string;
    shiftId?: string;
    playerUserId?: string;
    actionType?: ActionType;
    limit?: number;
    offset?: number;
  }): Promise<AgentTransaction[]> {
    return this.txs.list(filter);
  }

  async getTransaction(id: string): Promise<AgentTransaction> {
    const tx = await this.txs.getById(id);
    if (!tx) throw new DomainError("TRANSACTION_NOT_FOUND", "Fant ikke transaksjonen.");
    return tx;
  }

  // ── Physical-ticket inventory ───────────────────────────────────────────

  async listPhysicalInventory(agentUserId: string, opts?: { limit?: number; offset?: number }): Promise<PhysicalTicketInventoryRow[]> {
    const shift = await this.requireActiveShift(agentUserId);
    return this.physicalRead.listUnsoldInHall(shift.hallId, opts);
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async requireActiveShift(agentUserId: string) {
    await this.agents.requireActiveAgent(agentUserId);
    const shift = await this.shifts.getCurrentShift(agentUserId);
    if (!shift) {
      throw new DomainError(
        "NO_ACTIVE_SHIFT",
        "Du må åpne en shift før du kan utføre transaksjoner."
      );
    }
    // BIN-583 B3.3: shift-settlement freeze. Når close-day har skjedd
    // er shiften regnskapsmessig lukket — ingen nye transaksjoner.
    if (shift.settledAt) {
      throw new DomainError(
        "SHIFT_SETTLED",
        "Shiften er avsluttet med daglig oppgjør. Åpne ny shift for nye transaksjoner."
      );
    }
    return shift;
  }

  private async requirePlayerInHall(playerUserId: string, hallId: string): Promise<void> {
    const isActive = await this.platform.isPlayerActiveInHall(playerUserId, hallId);
    if (!isActive) {
      throw new DomainError(
        "PLAYER_NOT_AT_HALL",
        "Spilleren er ikke registrert med ACTIVE-status i denne hallen."
      );
    }
  }
}

function assertPositive(value: number, field: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new DomainError("INVALID_INPUT", `${field} må være et positivt tall.`);
  }
}

function centsToAmount(cents: number): number {
  return Math.round(cents) / 100;
}
