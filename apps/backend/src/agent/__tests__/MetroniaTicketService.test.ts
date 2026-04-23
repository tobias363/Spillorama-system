/**
 * BIN-583 B3.4: MetroniaTicketService unit tests.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { MetroniaTicketService, VOID_WINDOW_MS } from "../MetroniaTicketService.js";
import { AgentService } from "../AgentService.js";
import { AgentShiftService } from "../AgentShiftService.js";
import { InMemoryAgentStore } from "../AgentStore.js";
import { InMemoryAgentTransactionStore } from "../AgentTransactionStore.js";
import { InMemoryMachineTicketStore } from "../MachineTicketStore.js";
import { InMemoryWalletAdapter } from "../../adapters/InMemoryWalletAdapter.js";
import { StubMetroniaApiClient } from "../../integration/metronia/StubMetroniaApiClient.js";
import type { AppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

interface TestCtx {
  service: MetroniaTicketService;
  metronia: StubMetroniaApiClient;
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
  const metronia = new StubMetroniaApiClient();

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
  const service = new MetroniaTicketService({
    platformService,
    walletAdapter: wallet,
    agentService,
    agentShiftService,
    transactionStore: txStore,
    machineTicketStore: ticketStore,
    metroniaClient: metronia,
  });

  return {
    service, metronia, store, txStore, ticketStore, wallet,
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

test("createTicket debiterer wallet + lager DB-rad + logger MACHINE_CREATE", async () => {
  const ctx = makeSetup();
  const { shiftId } = await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  const ticket = await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
  });
  assert.equal(ticket.machineName, "METRONIA");
  assert.equal(ticket.initialAmountCents, 10000);
  assert.equal(ticket.shiftId, shiftId);
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 400);
  const txs = await ctx.txStore.list({ shiftId });
  const create = txs.find((t) => t.actionType === "MACHINE_CREATE");
  assert.ok(create);
  assert.equal(create?.amount, 100);
});

test("createTicket avviser amount under 1 eller over 1000 NOK", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 5000);
  await assert.rejects(
    ctx.service.createTicket({
      agentUserId: "a1", playerUserId: "p1", amountNok: 0.5, clientRequestId: "r-1",
    }),
    (err) => err instanceof DomainError && err.code === "INVALID_AMOUNT"
  );
  await assert.rejects(
    ctx.service.createTicket({
      agentUserId: "a1", playerUserId: "p1", amountNok: 1500, clientRequestId: "r-2",
    }),
    (err) => err instanceof DomainError && err.code === "INVALID_AMOUNT"
  );
});

test("createTicket avviser desimaler", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 5000);
  await assert.rejects(
    ctx.service.createTicket({
      agentUserId: "a1", playerUserId: "p1", amountNok: 100.5, clientRequestId: "r-1",
    }),
    (err) => err instanceof DomainError && err.code === "INVALID_AMOUNT"
  );
});

test("createTicket avviser hvis player ikke har wallet-balance", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 50);
  await assert.rejects(
    ctx.service.createTicket({
      agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    }),
    (err) => err instanceof DomainError && err.code === "INSUFFICIENT_BALANCE"
  );
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

test("createTicket: når Metronia-API kaster, refunderes wallet", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  ctx.metronia.failOnce("create", "METRONIA_API_ERROR");
  await assert.rejects(
    ctx.service.createTicket({
      agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
    }),
    (err) => err instanceof DomainError && err.code === "METRONIA_API_ERROR"
  );
  // Wallet refundert
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 500);
});

// ═══════════════════════════════════════════════════════════════════════════
// TOPUP
// ═══════════════════════════════════════════════════════════════════════════

test("topupTicket øker balance + logger MACHINE_TOPUP", async () => {
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
  assert.equal(updated.currentBalanceCents, 15000);
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 350);
});

test("topupTicket feiler hvis ticket allerede closed", async () => {
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
// CLOSE
// ═══════════════════════════════════════════════════════════════════════════

test("closeTicket henter final balance + crediterer player + logger MACHINE_CLOSE", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  const ticket = await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
  });
  // Simuler at spilleren har spilt — balance redusert til 30 kr (3000 cents)
  ctx.metronia.setBalance(ticket.ticketNumber, 3000);
  const closed = await ctx.service.closeTicket({
    agentUserId: "a1", ticketNumber: ticket.ticketNumber, clientRequestId: "r-c",
  });
  assert.equal(closed.isClosed, true);
  assert.equal(closed.payoutCents, 3000);
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 430); // 400 + 30 payout
});

test("closeTicket med 0 balance crediterer ikke wallet", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  const ticket = await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
  });
  ctx.metronia.setBalance(ticket.ticketNumber, 0);
  const closed = await ctx.service.closeTicket({
    agentUserId: "a1", ticketNumber: ticket.ticketNumber, clientRequestId: "r-c",
  });
  assert.equal(closed.payoutCents, 0);
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 400);
});

// ═══════════════════════════════════════════════════════════════════════════
// VOID
// ═══════════════════════════════════════════════════════════════════════════

test("voidTicket innen 5 min refunderer initial+topup full beløp", async () => {
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
  // Spiller har spilt litt — balance på Metronia er bare 80 kr (8000 cents)
  // Men void refunderer FULL initial+topup = 150 kr uavhengig
  ctx.metronia.setBalance(ticket.ticketNumber, 8000);
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 350);
  const voided = await ctx.service.voidTicket({
    agentUserId: "a1", agentRole: "AGENT",
    ticketNumber: ticket.ticketNumber,
    reason: "Feil amount registrert",
  });
  assert.equal(voided.isClosed, true);
  assert.ok(voided.voidAt);
  // Refund = 100 + 50 = 150 NOK
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 500);
});

test("voidTicket utenfor vindu uten ADMIN → VOID_WINDOW_EXPIRED", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  const ticket = await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
  });
  // Manipulere createdAt for å simulere alder utover vindu
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
  // ADMIN kan force
  const voided = await ctx.service.voidTicket({
    agentUserId: "admin-1", agentRole: "ADMIN",
    ticketNumber: ticket.ticketNumber, reason: "Late refund approved",
  });
  assert.equal(voided.isClosed, true);
});

test("voidTicket uten reason → VOID_REASON_REQUIRED", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  const ticket = await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
  });
  await assert.rejects(
    ctx.service.voidTicket({
      agentUserId: "a1", agentRole: "AGENT",
      ticketNumber: ticket.ticketNumber, reason: "  ",
    }),
    (err) => err instanceof DomainError && err.code === "VOID_REASON_REQUIRED"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// READ + AGGREGATES
// ═══════════════════════════════════════════════════════════════════════════

test("getDailySalesForCurrentShift aggregerer Metronia-tx for shift", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  await ctx.seedPlayer("p2", "hall-a", 500);
  const t1 = await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
  });
  await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p2", amountNok: 50, clientRequestId: "r-2",
  });
  ctx.metronia.setBalance(t1.ticketNumber, 5000);
  await ctx.service.closeTicket({
    agentUserId: "a1", ticketNumber: t1.ticketNumber, clientRequestId: "r-c",
  });
  const agg = await ctx.service.getDailySalesForCurrentShift("a1");
  assert.equal(agg.ticketCount, 2);
  assert.equal(agg.totalCreatedNok, 150);
  assert.equal(agg.totalPaidOutNok, 50);
});

test("freeze: createTicket etter close-day → SHIFT_SETTLED", async () => {
  const ctx = makeSetup();
  const { shiftId } = await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  // Mark shift som settled
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

test("autoCloseTicket lukker ticket + crediterer player + skriver agent-tx også etter shift-settlement", async () => {
  const ctx = makeSetup();
  const { shiftId } = await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  const ticket = await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
  });
  ctx.metronia.setBalance(ticket.ticketNumber, 2000); // 20 kr igjen
  // Settle shiften — simulerer at agent gikk hjem uten å lukke ticket
  await ctx.store.markShiftSettled(shiftId, "a1");

  const closed = await ctx.service.autoCloseTicket({
    ticketId: ticket.id,
    systemActorUserId: "system:auto-close-cron",
  });

  assert.equal(closed.isClosed, true);
  assert.equal(closed.closedByUserId, "system:auto-close-cron");
  assert.equal(closed.payoutCents, 2000);
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 420); // 400 + 20 auto-payout

  // Agent-tx skrevet (ticket.shiftId fortsatt satt).
  const txs = await ctx.txStore.list({ shiftId });
  const closeTx = txs.find((t) => t.actionType === "MACHINE_CLOSE");
  assert.ok(closeTx, "skal skrive MACHINE_CLOSE rad");
  assert.equal(closeTx?.amount, 20);
  assert.equal((closeTx?.otherData as { autoClosed?: boolean }).autoClosed, true);
});

test("autoCloseTicket krever ingen active-shift (fungerer fra cron)", async () => {
  const ctx = makeSetup();
  const { shiftId } = await ctx.seedAgent("a1", "hall-a");
  await ctx.seedPlayer("p1", "hall-a", 500);
  const ticket = await ctx.service.createTicket({
    agentUserId: "a1", playerUserId: "p1", amountNok: 100, clientRequestId: "r-1",
  });
  // Settle shiften — nå er ikke agenten aktiv lenger
  await ctx.store.markShiftSettled(shiftId, "a1");
  // Påstand: en direkte call til closeTicket ville kastet SHIFT_SETTLED.
  await assert.rejects(
    ctx.service.closeTicket({ agentUserId: "a1", ticketNumber: ticket.ticketNumber, clientRequestId: "manual" }),
    (err) => err instanceof DomainError && (err.code === "NO_ACTIVE_SHIFT" || err.code === "SHIFT_SETTLED")
  );
  // autoCloseTicket skal fungere fordi ingen shift-check gjøres.
  const closed = await ctx.service.autoCloseTicket({
    ticketId: ticket.id,
    systemActorUserId: "system:auto-close-cron",
  });
  assert.equal(closed.isClosed, true);
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

test("autoCloseTicket på ukjent id → MACHINE_TICKET_NOT_FOUND", async () => {
  const ctx = makeSetup();
  await assert.rejects(
    ctx.service.autoCloseTicket({
      ticketId: "does-not-exist",
      systemActorUserId: "system:auto-close-cron",
    }),
    (err) => err instanceof DomainError && err.code === "MACHINE_TICKET_NOT_FOUND"
  );
});
