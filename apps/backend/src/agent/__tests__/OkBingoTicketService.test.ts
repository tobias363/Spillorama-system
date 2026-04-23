/**
 * BIN-583 B3.5: OkBingoTicketService unit tests.
 *
 * Speil av MetroniaTicketService.test.ts med roomId-håndtering +
 * openDay-test.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { OkBingoTicketService, VOID_WINDOW_MS, DEFAULT_BINGO_ROOM_ID } from "../OkBingoTicketService.js";
import { AgentService } from "../AgentService.js";
import { AgentShiftService } from "../AgentShiftService.js";
import { InMemoryAgentStore } from "../AgentStore.js";
import { InMemoryAgentTransactionStore } from "../AgentTransactionStore.js";
import { InMemoryMachineTicketStore } from "../MachineTicketStore.js";
import { InMemoryWalletAdapter } from "../../adapters/InMemoryWalletAdapter.js";
import { StubOkBingoApiClient } from "../../integration/okbingo/StubOkBingoApiClient.js";
import type { AppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

interface TestCtx {
  service: OkBingoTicketService;
  okbingo: StubOkBingoApiClient;
  store: InMemoryAgentStore;
  txStore: InMemoryAgentTransactionStore;
  ticketStore: InMemoryMachineTicketStore;
  wallet: InMemoryWalletAdapter;
  seedAgent(id: string, hallId: string): Promise<{ shiftId: string }>;
  seedPlayer(id: string, hallId: string, balanceNok?: number): Promise<void>;
}

function makeSetup(): TestCtx {
  const store = new InMemoryAgentStore();
  const txStore = new InMemoryAgentTransactionStore();
  const ticketStore = new InMemoryMachineTicketStore();
  const wallet = new InMemoryWalletAdapter(0);
  const okbingo = new StubOkBingoApiClient();

  const usersById = new Map<string, AppUser>();
  const playerHalls = new Map<string, Set<string>>();

  const stubPlatform = {
    async getUserById(userId: string): Promise<AppUser> {
      const u = usersById.get(userId);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      return u;
    },
    async getUserFromAccessToken(): Promise<AppUser> { throw new Error("not used"); },
    async createAdminProvisionedUser(): Promise<AppUser> { throw new Error("not used"); },
    async softDeletePlayer(): Promise<void> {},
    async isPlayerActiveInHall(userId: string, hallId: string): Promise<boolean> {
      return playerHalls.get(userId)?.has(hallId) ?? false;
    },
    async searchPlayersInHall(): Promise<AppUser[]> { return []; },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platformService = stubPlatform as any;
  const agentService = new AgentService({ platformService, agentStore: store });
  const agentShiftService = new AgentShiftService({ agentStore: store, agentService });
  const service = new OkBingoTicketService({
    platformService,
    walletAdapter: wallet,
    agentService,
    agentShiftService,
    transactionStore: txStore,
    machineTicketStore: ticketStore,
    okBingoClient: okbingo,
  });

  return {
    service, okbingo, store, txStore, ticketStore, wallet,
    async seedAgent(id, hallId) {
      store.seedAgent({ userId: id, email: `${id}@x.no`, displayName: id });
      await wallet.ensureAccount(`wallet-${id}`);
      usersById.set(id, {
        id, email: `${id}@x.no`, displayName: id,
        walletId: `wallet-${id}`, role: "AGENT", hallId: null,
        kycStatus: "UNVERIFIED", createdAt: "", updatedAt: "",
      });
      await store.assignHall({ userId: id, hallId, isPrimary: true });
      const shift = await store.insertShift({ userId: id, hallId });
      return { shiftId: shift.id };
    },
    async seedPlayer(id, hallId, balanceNok = 0) {
      const walletId = `wallet-${id}`;
      await wallet.ensureAccount(walletId);
      if (balanceNok > 0) await wallet.credit(walletId, balanceNok, "seed");
      usersById.set(id, {
        id, email: `${id}@test.no`, displayName: `Player ${id}`,
        walletId, role: "PLAYER", hallId: null,
        kycStatus: "VERIFIED", createdAt: "", updatedAt: "",
      });
      const set = playerHalls.get(id) ?? new Set<string>();
      set.add(hallId);
      playerHalls.set(id, set);
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CREATE
// ═══════════════════════════════════════════════════════════════════════════

test("createTicket debiterer wallet + DB-rad + MACHINE_CREATE-tx + roomId", async () => {
  const ctx = makeSetup();
  const { shiftId } = await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  const ticket = await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
  });
  assert.equal(ticket.machineName, "OK_BINGO");
  assert.equal(ticket.initialAmountCents, 10000);
  assert.equal(ticket.roomId, String(DEFAULT_BINGO_ROOM_ID));
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 400);
  const txs = await ctx.txStore.list({ shiftId });
  const create = txs.find((t) => t.actionType === "MACHINE_CREATE");
  assert.ok(create);
  assert.equal((create?.otherData as { machineName?: string }).machineName, "OK_BINGO");
});

test("createTicket bruker custom roomId hvis spesifisert", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  const ticket = await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100,
    roomId: 999, clientRequestId: "r-1",
  });
  assert.equal(ticket.roomId, "999");
});

test("createTicket avviser amount utenfor 1-1000 + desimaler", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 5000);
  await assert.rejects(
    ctx.service.createTicket({
      agentUserId: "a1", playerUserId: "p1", amountNok: 0, clientRequestId: "r-1",
    }),
    (err) => err instanceof DomainError && err.code === "INVALID_AMOUNT"
  );
  await assert.rejects(
    ctx.service.createTicket({
      agentUserId: "a1", playerUserId: "p1", amountNok: 100.5, clientRequestId: "r-2",
    }),
    (err) => err instanceof DomainError && err.code === "INVALID_AMOUNT"
  );
});

test("createTicket: API-feil → wallet refunderes", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  ctx.okbingo.failOnce("create", "OKBINGO_API_ERROR");
  await assert.rejects(
    ctx.service.createTicket({
      agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    }),
    (err) => err instanceof DomainError && err.code === "OKBINGO_API_ERROR"
  );
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 500);
});

test("createTicket avviser hvis player ikke i hall", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-b", 500);
  await assert.rejects(
    ctx.service.createTicket({
      agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    }),
    (err) => err instanceof DomainError && err.code === "PLAYER_NOT_AT_HALL"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// TOPUP + CLOSE
// ═══════════════════════════════════════════════════════════════════════════

test("topupTicket øker balance + MACHINE_TOPUP", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  const ticket = await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
  });
  const updated = await ctx.service.topupTicket({
    agentUserId: "a1", ticketNumber: ticket.ticketNumber,
    amountNok: 50, clientRequestId: "r-2",
  });
  assert.equal(updated.totalTopupCents, 5000);
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 350);
});

test("closeTicket henter final balance + crediterer + MACHINE_CLOSE", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  const ticket = await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
  });
  ctx.okbingo.setBalance(ticket.ticketNumber, 4500);
  const closed = await ctx.service.closeTicket({
    agentUserId: "a1", ticketNumber: ticket.ticketNumber, clientRequestId: "r-c",
  });
  assert.equal(closed.payoutCents, 4500);
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 445);
});

test("topupTicket feiler hvis ticket lukket", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  const ticket = await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
  });
  await ctx.service.closeTicket({
    agentUserId: "a1", ticketNumber: ticket.ticketNumber, clientRequestId: "r-2",
  });
  await assert.rejects(
    ctx.service.topupTicket({
      agentUserId: "a1", ticketNumber: ticket.ticketNumber,
      amountNok: 50, clientRequestId: "r-3",
    }),
    (err) => err instanceof DomainError && err.code === "MACHINE_TICKET_CLOSED"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// VOID
// ═══════════════════════════════════════════════════════════════════════════

test("voidTicket innen vindu refunderer initial+topup full beløp", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  const ticket = await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
  });
  await ctx.service.topupTicket({
    agentUserId: "a1", ticketNumber: ticket.ticketNumber,
    amountNok: 50, clientRequestId: "r-2",
  });
  ctx.okbingo.setBalance(ticket.ticketNumber, 8000);
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 350);
  const voided = await ctx.service.voidTicket({
    agentUserId: "a1", agentRole: "AGENT",
    ticketNumber: ticket.ticketNumber, reason: "Feil amount",
  });
  assert.equal(voided.isClosed, true);
  // Refund = 100 + 50 = 150 NOK uavhengig av Metronia-balance
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 500);
});

test("voidTicket utenfor vindu uten ADMIN → VOID_WINDOW_EXPIRED", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  const ticket = await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inMemTicket = (ctx.ticketStore as any).tickets.get(ticket.id);
  inMemTicket.createdAt = new Date(Date.now() - VOID_WINDOW_MS - 10_000).toISOString();
  await assert.rejects(
    ctx.service.voidTicket({
      agentUserId: "a1", agentRole: "AGENT",
      ticketNumber: ticket.ticketNumber, reason: "test",
    }),
    (err) => err instanceof DomainError && err.code === "VOID_WINDOW_EXPIRED"
  );
  // ADMIN force OK
  const voided = await ctx.service.voidTicket({
    agentUserId: "admin-1", agentRole: "ADMIN",
    ticketNumber: ticket.ticketNumber, reason: "Late refund OK",
  });
  assert.equal(voided.isClosed, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// OPEN DAY
// ═══════════════════════════════════════════════════════════════════════════

test("openDay sender signal + bruker default roomId 247", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  const result = await ctx.service.openDay({ agentUserId: "a1" });
  assert.equal(result.opened, true);
  assert.equal(result.roomId, DEFAULT_BINGO_ROOM_ID);
  assert.equal(ctx.okbingo.isDayOpened(DEFAULT_BINGO_ROOM_ID), true);
});

test("openDay med custom roomId", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.service.openDay({ agentUserId: "a1", roomId: 500 });
  assert.equal(ctx.okbingo.isDayOpened(500), true);
});

// ═══════════════════════════════════════════════════════════════════════════
// READ + AGGREGAT + FREEZE
// ═══════════════════════════════════════════════════════════════════════════

test("getDailySalesForCurrentShift filtrerer kun OK_BINGO-tx", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
  });
  const agg = await ctx.service.getDailySalesForCurrentShift("a1");
  assert.equal(agg.ticketCount, 1);
  assert.equal(agg.totalCreatedNok, 100);
});

test("freeze: createTicket etter close-day → SHIFT_SETTLED", async () => {
  const ctx = makeSetup();
  const { shiftId } = await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  await ctx.store.markShiftSettled(shiftId, "a1");
  await assert.rejects(
    ctx.service.createTicket({
      agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    }),
    (err) => err instanceof DomainError &&
      (err.code === "NO_ACTIVE_SHIFT" || err.code === "SHIFT_SETTLED")
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-CLOSE (BIN-582 cron)
// ═══════════════════════════════════════════════════════════════════════════

test("autoCloseTicket lukker + crediterer player selv etter shift-settlement", async () => {
  const ctx = makeSetup();
  const { shiftId } = await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  const ticket = await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
  });
  ctx.okbingo.setBalance(ticket.ticketNumber, 2500); // 25 kr igjen
  // Settle shiften
  await ctx.store.markShiftSettled(shiftId, "a1");

  const closed = await ctx.service.autoCloseTicket({
    ticketId: ticket.id,
    systemActorUserId: "system:auto-close-cron",
  });
  assert.equal(closed.isClosed, true);
  assert.equal(closed.closedByUserId, "system:auto-close-cron");
  assert.equal(closed.payoutCents, 2500);
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 425); // 400 + 25 payout

  const txs = await ctx.txStore.list({ shiftId });
  const closeTx = txs.find((t) => t.actionType === "MACHINE_CLOSE");
  assert.ok(closeTx);
  assert.equal((closeTx?.otherData as { autoClosed?: boolean }).autoClosed, true);
});

test("autoCloseTicket på allerede lukket ticket → MACHINE_TICKET_CLOSED", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  const ticket = await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
  });
  await ctx.service.closeTicket({
    agentUserId: "a1", ticketNumber: ticket.ticketNumber, clientRequestId: "r-c",
  });
  await assert.rejects(
    ctx.service.autoCloseTicket({
      ticketId: ticket.id,
      systemActorUserId: "system:auto-close-cron",
    }),
    (err) => err instanceof DomainError && err.code === "MACHINE_TICKET_CLOSED"
  );
});

test("autoCloseTicket bruker roomId fra ticketen (OK_BINGO-spesifikk)", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  const ticket = await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100, roomId: 500,
    clientRequestId: "r-1",
  });
  // Verifiser at ticket har roomId satt — autoClose må plukke denne,
  // ikke default.
  assert.equal(ticket.roomId, "500");
  const closed = await ctx.service.autoCloseTicket({
    ticketId: ticket.id,
    systemActorUserId: "system:auto-close-cron",
  });
  assert.equal(closed.isClosed, true);
});
