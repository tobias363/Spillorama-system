/**
 * BIN-583 B3.2: AgentTransactionService unit tests.
 *
 * Bruker InMemory-implementasjoner for alle ports + adapters. Dekker
 * cash-in/out (CASH/CARD-skille), physical sell (CASH/CARD/WALLET),
 * cancel-counter-transaction, shift-cash-column-mutation, og owner-
 * / window-sjekker.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  AgentTransactionService,
  CANCEL_SALE_WINDOW_MS,
  AGENT_USER_CASH_AML_THRESHOLD_NOK,
} from "../AgentTransactionService.js";
import { AgentService } from "../AgentService.js";
import { AgentShiftService } from "../AgentShiftService.js";
import { InMemoryAgentStore } from "../AgentStore.js";
import { InMemoryAgentTransactionStore } from "../AgentTransactionStore.js";
import { InMemoryPhysicalTicketReadPort } from "../ports/PhysicalTicketReadPort.js";
import { NotImplementedTicketPurchasePort } from "../ports/TicketPurchasePort.js";
import { InMemoryWalletAdapter } from "../../adapters/InMemoryWalletAdapter.js";
import type { AppUser, PublicAppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

interface TestCtx {
  service: AgentTransactionService;
  store: InMemoryAgentStore;
  txs: InMemoryAgentTransactionStore;
  wallet: InMemoryWalletAdapter;
  physicalRead: InMemoryPhysicalTicketReadPort;
  physicalMark: {
    calls: Array<{ uniqueId: string; soldBy: string; buyerUserId: string | null; priceCents: number | null }>;
    throwOnNext: string | null;
  };
  seedPlayer(id: string, hallId: string, initialBalance?: number): void;
  seedAgent(id: string, hallId: string): Promise<string>; // returns shiftId
}

function makeSetup(): TestCtx {
  const store = new InMemoryAgentStore();
  const txs = new InMemoryAgentTransactionStore();
  // defaultInitialBalance=0 — tester seed eksplisitt via seedPlayerBalance.
  const wallet = new InMemoryWalletAdapter(0);
  const physicalRead = new InMemoryPhysicalTicketReadPort();
  const digitalPort = new NotImplementedTicketPurchasePort();
  const physicalMark = {
    calls: [] as Array<{ uniqueId: string; soldBy: string; buyerUserId: string | null; priceCents: number | null }>,
    throwOnNext: null as string | null,
  };

  const playersById = new Map<string, AppUser>();
  const playerHallRegistrations = new Map<string, Set<string>>(); // userId -> Set of hallIds (ACTIVE)

  let nextUserId = 1;

  const stubPlatform = {
    async getUserById(userId: string): Promise<AppUser> {
      const u = playersById.get(userId);
      if (!u) throw new DomainError("USER_NOT_FOUND", "not found");
      return u;
    },
    async getUserFromAccessToken(): Promise<PublicAppUser> {
      throw new Error("not used in service tests");
    },
    async createAdminProvisionedUser(input: {
      email: string;
      password: string;
      displayName: string;
      surname: string;
      role: "ADMIN" | "HALL_OPERATOR" | "SUPPORT" | "PLAYER" | "AGENT";
      phone?: string;
    }): Promise<AppUser> {
      const id = `user-${nextUserId++}`;
      const walletId = `wallet-${id}`;
      await wallet.ensureAccount(walletId);
      store.seedAgent({
        userId: id,
        email: input.email,
        displayName: input.displayName,
        surname: input.surname,
        phone: input.phone,
      });
      const appUser: AppUser = {
        id,
        email: input.email,
        displayName: input.displayName,
        surname: input.surname,
        walletId,
        role: input.role,
        hallId: null,
        kycStatus: "UNVERIFIED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      playersById.set(id, appUser);
      return appUser;
    },
    async softDeletePlayer(): Promise<void> {},
    async isPlayerActiveInHall(userId: string, hallId: string): Promise<boolean> {
      return playerHallRegistrations.get(userId)?.has(hallId) ?? false;
    },
    async searchPlayersInHall(input: { query: string; hallId: string; limit?: number }): Promise<AppUser[]> {
      const lower = input.query.toLowerCase();
      const candidates: AppUser[] = [];
      for (const [userId, hallSet] of playerHallRegistrations.entries()) {
        if (!hallSet.has(input.hallId)) continue;
        const user = playersById.get(userId);
        if (!user || user.role !== "PLAYER") continue;
        if (
          user.displayName.toLowerCase().startsWith(lower) ||
          user.email.toLowerCase().startsWith(lower) ||
          (user.phone ?? "").toLowerCase().startsWith(lower)
        ) {
          candidates.push(user);
        }
      }
      return candidates.slice(0, input.limit ?? 20);
    },
  };

  const stubPhysicalTicketService = {
    async markSold(input: { uniqueId: string; soldBy: string; buyerUserId?: string | null; priceCents?: number | null }): Promise<unknown> {
      if (physicalMark.throwOnNext) {
        const code = physicalMark.throwOnNext;
        physicalMark.throwOnNext = null;
        throw new DomainError(code, "stubbed");
      }
      physicalMark.calls.push({
        uniqueId: input.uniqueId,
        soldBy: input.soldBy,
        buyerUserId: input.buyerUserId ?? null,
        priceCents: input.priceCents ?? null,
      });
      physicalRead.setStatus(input.uniqueId, "SOLD");
      return { uniqueId: input.uniqueId };
    },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const platformService = stubPlatform as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const physicalTicketService = stubPhysicalTicketService as any;

  const agentService = new AgentService({ platformService, agentStore: store });
  const agentShiftService = new AgentShiftService({ agentStore: store, agentService });
  const service = new AgentTransactionService({
    platformService,
    walletAdapter: wallet,
    physicalTicketService,
    physicalTicketReadPort: physicalRead,
    ticketPurchasePort: digitalPort,
    agentService,
    agentShiftService,
    agentStore: store,
    transactionStore: txs,
  });

  return {
    service,
    store,
    txs,
    wallet,
    physicalRead,
    physicalMark,
    seedPlayer(id: string, hallId: string, initialBalance = 0) {
      const walletId = `wallet-${id}`;
      void wallet.ensureAccount(walletId).then(() => {
        if (initialBalance > 0) {
          void wallet.credit(walletId, initialBalance, "seed-balance");
        }
      });
      playersById.set(id, {
        id,
        email: `${id}@test.no`,
        displayName: `Player ${id}`,
        walletId,
        role: "PLAYER",
        hallId: null,
        kycStatus: "VERIFIED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const set = playerHallRegistrations.get(id) ?? new Set<string>();
      set.add(hallId);
      playerHallRegistrations.set(id, set);
    },
    async seedAgent(id: string, hallId: string) {
      store.seedAgent({ userId: id, email: `${id}@x.no`, displayName: id });
      const walletId = `wallet-${id}`;
      await wallet.ensureAccount(walletId);
      playersById.set(id, {
        id,
        email: `${id}@x.no`,
        displayName: id,
        walletId,
        role: "AGENT",
        hallId: null,
        kycStatus: "UNVERIFIED",
        createdAt: "",
        updatedAt: "",
      });
      await store.assignHall({ userId: id, hallId, isPrimary: true });
      const shift = await store.insertShift({ userId: id, hallId });
      return shift.id;
    },
  };
}

async function seedPlayerBalance(ctx: TestCtx, playerId: string, amount: number): Promise<void> {
  await ctx.wallet.ensureAccount(`wallet-${playerId}`);
  if (amount > 0) await ctx.wallet.credit(`wallet-${playerId}`, amount, "seed");
}

// ═══════════════════════════════════════════════════════════════════════════
// CASH IN
// ═══════════════════════════════════════════════════════════════════════════

test("cashIn (CASH) debiterer wallet + øker shift.total_cash_in + daily_balance", async () => {
  const ctx = makeSetup();
  const shiftId = await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  await seedPlayerBalance(ctx, "p1", 100);
  const tx = await ctx.service.cashIn({
    agentUserId: "a1", playerUserId: "p1", amount: 50,
    paymentMethod: "CASH", clientRequestId: "req-1",
  });
  assert.equal(tx.actionType, "CASH_IN");
  assert.equal(tx.walletDirection, "CREDIT");
  assert.equal(tx.amount, 50);
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 150);
  const shift = await ctx.store.getShiftById(shiftId);
  assert.equal(shift?.totalCashIn, 50);
  assert.equal(shift?.dailyBalance, 50);
  assert.equal(shift?.totalCardIn, 0);
});

test("cashIn (CARD) kun øker total_card_in, rører ikke daily_balance", async () => {
  const ctx = makeSetup();
  const shiftId = await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  const tx = await ctx.service.cashIn({
    agentUserId: "a1", playerUserId: "p1", amount: 75,
    paymentMethod: "CARD", clientRequestId: "req-1",
  });
  assert.equal(tx.paymentMethod, "CARD");
  const shift = await ctx.store.getShiftById(shiftId);
  assert.equal(shift?.totalCardIn, 75);
  assert.equal(shift?.dailyBalance, 0);
  assert.equal(shift?.totalCashIn, 0);
});

test("cashIn feiler hvis player ikke er ACTIVE i agentens hall", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-b"); // annen hall
  await assert.rejects(
    ctx.service.cashIn({
      agentUserId: "a1", playerUserId: "p1", amount: 50,
      paymentMethod: "CASH", clientRequestId: "req-1",
    }),
    (err) => err instanceof DomainError && err.code === "PLAYER_NOT_AT_HALL"
  );
});

test("cashIn feiler hvis agent ikke har aktiv shift", async () => {
  const ctx = makeSetup();
  const shiftId = await ctx.seedAgent("a1", "hall-a");
  await ctx.store.endShift(shiftId);
  ctx.seedPlayer("p1", "hall-a");
  await assert.rejects(
    ctx.service.cashIn({
      agentUserId: "a1", playerUserId: "p1", amount: 50,
      paymentMethod: "CASH", clientRequestId: "req-1",
    }),
    (err) => err instanceof DomainError && err.code === "NO_ACTIVE_SHIFT"
  );
});

test("cashIn avviser null/negativt beløp", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  await assert.rejects(
    ctx.service.cashIn({
      agentUserId: "a1", playerUserId: "p1", amount: 0,
      paymentMethod: "CASH", clientRequestId: "req-1",
    }),
    (err) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// CASH OUT
// ═══════════════════════════════════════════════════════════════════════════

test("cashOut (CASH) feiler hvis daily_balance < amount", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  await seedPlayerBalance(ctx, "p1", 1000);
  // shift.daily_balance er 0 — cash-out av 100 skal feile
  await assert.rejects(
    ctx.service.cashOut({
      agentUserId: "a1", playerUserId: "p1", amount: 100,
      paymentMethod: "CASH", clientRequestId: "r-1",
    }),
    (err) => err instanceof DomainError && err.code === "INSUFFICIENT_DAILY_BALANCE"
  );
});

test("cashOut (CASH) reduserer wallet + shift.total_cash_out + daily_balance", async () => {
  const ctx = makeSetup();
  const shiftId = await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  await seedPlayerBalance(ctx, "p1", 500);
  // Bygg opp shift-daily_balance først
  await ctx.service.cashIn({
    agentUserId: "a1", playerUserId: "p1", amount: 200,
    paymentMethod: "CASH", clientRequestId: "r-1",
  });
  const out = await ctx.service.cashOut({
    agentUserId: "a1", playerUserId: "p1", amount: 150,
    paymentMethod: "CASH", clientRequestId: "r-2",
  });
  assert.equal(out.actionType, "CASH_OUT");
  assert.equal(out.walletDirection, "DEBIT");
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 550);
  const shift = await ctx.store.getShiftById(shiftId);
  assert.equal(shift?.totalCashOut, 150);
  assert.equal(shift?.dailyBalance, 50); // 200 - 150
});

test("cashOut (CARD) ignorerer daily_balance-check", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  await seedPlayerBalance(ctx, "p1", 1000);
  const out = await ctx.service.cashOut({
    agentUserId: "a1", playerUserId: "p1", amount: 200,
    paymentMethod: "CARD", clientRequestId: "r-1",
  });
  assert.equal(out.paymentMethod, "CARD");
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 800);
});

test("cashOut feiler hvis player ikke har nok wallet-balance", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  await seedPlayerBalance(ctx, "p1", 50);
  // Build daily balance
  await ctx.service.cashIn({
    agentUserId: "a1", playerUserId: "p1", amount: 200,
    paymentMethod: "CASH", clientRequestId: "r-1",
  });
  await assert.rejects(
    ctx.service.cashOut({
      agentUserId: "a1", playerUserId: "p1", amount: 500,
      paymentMethod: "CARD", clientRequestId: "r-2",
    }),
    (err) => err instanceof DomainError && err.code === "INSUFFICIENT_BALANCE"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// PHYSICAL SELL
// ═══════════════════════════════════════════════════════════════════════════

test("sellPhysicalTicket (CASH) markerer solgt + øker shift-cash", async () => {
  const ctx = makeSetup();
  const shiftId = await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  ctx.physicalRead.seed({
    uniqueId: "T-001", batchId: "b1", hallId: "hall-a",
    status: "UNSOLD", priceCents: 5000, assignedGameId: "g1",
  });
  const tx = await ctx.service.sellPhysicalTicket({
    agentUserId: "a1", playerUserId: "p1", ticketUniqueId: "T-001",
    paymentMethod: "CASH", clientRequestId: "r-1",
  });
  assert.equal(tx.actionType, "TICKET_SALE");
  assert.equal(tx.amount, 50);
  assert.equal(tx.ticketUniqueId, "T-001");
  assert.equal(ctx.physicalMark.calls.length, 1);
  assert.equal(ctx.physicalMark.calls[0]!.buyerUserId, "p1");
  const shift = await ctx.store.getShiftById(shiftId);
  assert.equal(shift?.totalCashIn, 50);
  assert.equal(shift?.dailyBalance, 50);
  assert.equal(shift?.sellingByCustomerNumber, 1);
});

test("sellPhysicalTicket (WALLET) debiterer spiller-wallet; shift uendret", async () => {
  const ctx = makeSetup();
  const shiftId = await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  await seedPlayerBalance(ctx, "p1", 100);
  ctx.physicalRead.seed({
    uniqueId: "T-002", batchId: "b1", hallId: "hall-a",
    status: "UNSOLD", priceCents: 3000, assignedGameId: null,
  });
  await ctx.service.sellPhysicalTicket({
    agentUserId: "a1", playerUserId: "p1", ticketUniqueId: "T-002",
    paymentMethod: "WALLET", clientRequestId: "r-1",
  });
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 70);
  const shift = await ctx.store.getShiftById(shiftId);
  assert.equal(shift?.totalCashIn, 0);
  assert.equal(shift?.dailyBalance, 0);
  assert.equal(shift?.sellingByCustomerNumber, 1); // Antall kunder fortsatt inkrementert
});

test("sellPhysicalTicket feiler hvis ticket hører til annen hall", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  ctx.physicalRead.seed({
    uniqueId: "T-003", batchId: "b1", hallId: "hall-b",
    status: "UNSOLD", priceCents: 5000, assignedGameId: null,
  });
  await assert.rejects(
    ctx.service.sellPhysicalTicket({
      agentUserId: "a1", playerUserId: "p1", ticketUniqueId: "T-003",
      paymentMethod: "CASH", clientRequestId: "r-1",
    }),
    (err) => err instanceof DomainError && err.code === "PHYSICAL_TICKET_WRONG_HALL"
  );
});

test("sellPhysicalTicket feiler hvis ticket allerede SOLD", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  ctx.physicalRead.seed({
    uniqueId: "T-004", batchId: "b1", hallId: "hall-a",
    status: "SOLD", priceCents: 5000, assignedGameId: null,
  });
  await assert.rejects(
    ctx.service.sellPhysicalTicket({
      agentUserId: "a1", playerUserId: "p1", ticketUniqueId: "T-004",
      paymentMethod: "CASH", clientRequestId: "r-1",
    }),
    (err) => err instanceof DomainError && err.code === "PHYSICAL_TICKET_NOT_SELLABLE"
  );
});

test("sellPhysicalTicket kan ikke selge samme ticket to ganger (partial unique-index)", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  ctx.physicalRead.seed({
    uniqueId: "T-005", batchId: "b1", hallId: "hall-a",
    status: "UNSOLD", priceCents: 5000, assignedGameId: null,
  });
  await ctx.service.sellPhysicalTicket({
    agentUserId: "a1", playerUserId: "p1", ticketUniqueId: "T-005",
    paymentMethod: "CASH", clientRequestId: "r-1",
  });
  // Simuler at B4a mark-sold kastet allerede — uavhengig av det skal vår
  // unique-index også blokkere (hvis ticket-status ble manuelt reset i test).
  ctx.physicalRead.setStatus("T-005", "UNSOLD");
  await assert.rejects(
    ctx.service.sellPhysicalTicket({
      agentUserId: "a1", playerUserId: "p1", ticketUniqueId: "T-005",
      paymentMethod: "CASH", clientRequestId: "r-2",
    }),
    // InMemoryStore kaster Postgres-style 23505 — service bobler opp.
    (err) => (err as { code?: string }).code === "23505"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// GAME1_SCHEDULE PR 2: Purchase-cutoff-guard
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Monkey-patch cutoff inn på eksisterende service-instans (bruker makeSetup-
 * infrastruktur for agent/player/physical-ticket seeding). Service er
 * stateless etter konstruktion, og feltet er private; vi omgår via
 * (service as unknown as { purchaseCutoff }) slik at testene slipper å
 * duplisere hele makeSetup-stiloppsettet.
 */
function attachPurchaseCutoff(
  service: AgentTransactionService,
  cutoff: { assertPurchaseOpenForHall: (gameId: string, hallId: string) => Promise<void> }
): void {
  (service as unknown as { purchaseCutoff: typeof cutoff }).purchaseCutoff = cutoff;
}

test("GAME1_SCHEDULE PR2: sellPhysicalTicket avvises hvis purchase-cutoff kaster PURCHASE_CLOSED_FOR_HALL", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  ctx.physicalRead.seed({
    uniqueId: "T-pr2",
    batchId: "b1",
    hallId: "hall-a",
    status: "UNSOLD",
    priceCents: 5000,
    assignedGameId: "g1", // knyttet til spesifikt Game 1-spill
  });

  attachPurchaseCutoff(ctx.service, {
    assertPurchaseOpenForHall: async () => {
      throw new DomainError(
        "PURCHASE_CLOSED_FOR_HALL",
        "Stengt for salg."
      );
    },
  });

  await assert.rejects(
    ctx.service.sellPhysicalTicket({
      agentUserId: "a1",
      playerUserId: "p1",
      ticketUniqueId: "T-pr2",
      paymentMethod: "CASH",
      clientRequestId: "r-1",
    }),
    (err) =>
      err instanceof DomainError && err.code === "PURCHASE_CLOSED_FOR_HALL"
  );
  // Guard skal ha triggered før mark-sold.
  assert.equal(ctx.physicalMark.calls.length, 0);
});

test("GAME1_SCHEDULE PR2: sellPhysicalTicket passerer cutoff for tickets uten assignedGameId", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  ctx.physicalRead.seed({
    uniqueId: "T-nogame",
    batchId: "b1",
    hallId: "hall-a",
    status: "UNSOLD",
    priceCents: 5000,
    assignedGameId: null, // ingen knytning til Game 1-spill
  });

  const cutoffCalls: Array<[string, string]> = [];
  attachPurchaseCutoff(ctx.service, {
    assertPurchaseOpenForHall: async (gameId, hallId) => {
      cutoffCalls.push([gameId, hallId]);
    },
  });

  // Salget skal passere uten å kalle purchase-cutoff.
  await ctx.service.sellPhysicalTicket({
    agentUserId: "a1",
    playerUserId: "p1",
    ticketUniqueId: "T-nogame",
    paymentMethod: "CASH",
    clientRequestId: "r-1",
  });
  assert.equal(
    cutoffCalls.length,
    0,
    "purchase-cutoff skal ikke kalles når assignedGameId=null"
  );
  assert.equal(ctx.physicalMark.calls.length, 1);
});

test("GAME1_SCHEDULE PR2: sellPhysicalTicket kaller cutoff med gameId+hallId når assignedGameId satt", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  ctx.physicalRead.seed({
    uniqueId: "T-pr2-ok",
    batchId: "b1",
    hallId: "hall-a",
    status: "UNSOLD",
    priceCents: 5000,
    assignedGameId: "g1",
  });

  const cutoffCalls: Array<[string, string]> = [];
  attachPurchaseCutoff(ctx.service, {
    assertPurchaseOpenForHall: async (gameId, hallId) => {
      cutoffCalls.push([gameId, hallId]);
    },
  });

  await ctx.service.sellPhysicalTicket({
    agentUserId: "a1",
    playerUserId: "p1",
    ticketUniqueId: "T-pr2-ok",
    paymentMethod: "CASH",
    clientRequestId: "r-1",
  });
  assert.equal(cutoffCalls.length, 1);
  assert.deepEqual(cutoffCalls[0], ["g1", "hall-a"]);
});

// ═══════════════════════════════════════════════════════════════════════════
// CANCEL SALE
// ═══════════════════════════════════════════════════════════════════════════

test("cancelPhysicalSale (WALLET) refunderer spiller + reverserer shift-counter", async () => {
  const ctx = makeSetup();
  const shiftId = await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  await seedPlayerBalance(ctx, "p1", 100);
  ctx.physicalRead.seed({
    uniqueId: "T-006", batchId: "b1", hallId: "hall-a",
    status: "UNSOLD", priceCents: 3000, assignedGameId: null,
  });
  const sale = await ctx.service.sellPhysicalTicket({
    agentUserId: "a1", playerUserId: "p1", ticketUniqueId: "T-006",
    paymentMethod: "WALLET", clientRequestId: "r-1",
  });
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 70);
  const cancel = await ctx.service.cancelPhysicalSale({
    agentUserId: "a1", agentRole: "AGENT", originalTxId: sale.id,
    reason: "customer changed mind",
  });
  assert.equal(cancel.actionType, "TICKET_CANCEL");
  assert.equal(cancel.relatedTxId, sale.id);
  assert.equal(cancel.walletDirection, "CREDIT");
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 100);
  const shift = await ctx.store.getShiftById(shiftId);
  assert.equal(shift?.sellingByCustomerNumber, 0);
});

test("cancelPhysicalSale (CASH) reverserer shift.daily_balance", async () => {
  const ctx = makeSetup();
  const shiftId = await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  ctx.physicalRead.seed({
    uniqueId: "T-007", batchId: "b1", hallId: "hall-a",
    status: "UNSOLD", priceCents: 4000, assignedGameId: null,
  });
  const sale = await ctx.service.sellPhysicalTicket({
    agentUserId: "a1", playerUserId: "p1", ticketUniqueId: "T-007",
    paymentMethod: "CASH", clientRequestId: "r-1",
  });
  await ctx.service.cancelPhysicalSale({
    agentUserId: "a1", agentRole: "AGENT", originalTxId: sale.id,
  });
  const shift = await ctx.store.getShiftById(shiftId);
  assert.equal(shift?.totalCashIn, 0);
  assert.equal(shift?.dailyBalance, 0);
  assert.equal(shift?.sellingByCustomerNumber, 0);
});

test("cancelPhysicalSale feiler etter 10-min-vindu uten ADMIN", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  ctx.physicalRead.seed({
    uniqueId: "T-008", batchId: "b1", hallId: "hall-a",
    status: "UNSOLD", priceCents: 3000, assignedGameId: null,
  });
  const sale = await ctx.service.sellPhysicalTicket({
    agentUserId: "a1", playerUserId: "p1", ticketUniqueId: "T-008",
    paymentMethod: "CASH", clientRequestId: "r-1",
  });
  // Manipuler tx-tidspunkt til å være eldre enn vinduet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const inMemRow = (ctx.txs as any).rows.find((r: { id: string }) => r.id === sale.id);
  inMemRow.createdAt = new Date(Date.now() - CANCEL_SALE_WINDOW_MS - 10_000).toISOString();

  await assert.rejects(
    ctx.service.cancelPhysicalSale({
      agentUserId: "a1", agentRole: "AGENT", originalTxId: sale.id,
    }),
    (err) => err instanceof DomainError && err.code === "CANCEL_WINDOW_EXPIRED"
  );
  // Men ADMIN kan force-cancel.
  const cancel = await ctx.service.cancelPhysicalSale({
    agentUserId: "admin-1", agentRole: "ADMIN", originalTxId: sale.id,
  });
  assert.equal(cancel.actionType, "TICKET_CANCEL");
});

test("cancelPhysicalSale avvises for agent som ikke eier salget", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  ctx.physicalRead.seed({
    uniqueId: "T-009", batchId: "b1", hallId: "hall-a",
    status: "UNSOLD", priceCents: 3000, assignedGameId: null,
  });
  const sale = await ctx.service.sellPhysicalTicket({
    agentUserId: "a1", playerUserId: "p1", ticketUniqueId: "T-009",
    paymentMethod: "CASH", clientRequestId: "r-1",
  });
  await assert.rejects(
    ctx.service.cancelPhysicalSale({
      agentUserId: "other-agent", agentRole: "AGENT", originalTxId: sale.id,
    }),
    (err) => err instanceof DomainError && err.code === "FORBIDDEN"
  );
});

test("cancelPhysicalSale er idempotent — ikke to ganger", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  ctx.physicalRead.seed({
    uniqueId: "T-010", batchId: "b1", hallId: "hall-a",
    status: "UNSOLD", priceCents: 3000, assignedGameId: null,
  });
  const sale = await ctx.service.sellPhysicalTicket({
    agentUserId: "a1", playerUserId: "p1", ticketUniqueId: "T-010",
    paymentMethod: "CASH", clientRequestId: "r-1",
  });
  await ctx.service.cancelPhysicalSale({
    agentUserId: "a1", agentRole: "AGENT", originalTxId: sale.id,
  });
  await assert.rejects(
    ctx.service.cancelPhysicalSale({
      agentUserId: "a1", agentRole: "AGENT", originalTxId: sale.id,
    }),
    (err) => err instanceof DomainError && err.code === "ALREADY_CANCELLED"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// DIGITAL TICKET REGISTER (stub)
// ═══════════════════════════════════════════════════════════════════════════

test("registerDigitalTicket kaster NOT_IMPLEMENTED (port stub)", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  await assert.rejects(
    ctx.service.registerDigitalTicket({
      agentUserId: "a1", playerUserId: "p1", gameId: "g1",
      ticketCount: 2, pricePerTicketCents: 3000, clientRequestId: "r-1",
    }),
    (err) => err instanceof DomainError && err.code === "NOT_IMPLEMENTED"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// LOOKUPS + INVENTORY
// ═══════════════════════════════════════════════════════════════════════════

test("lookupPlayers filtrerer til agentens hall", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p-alfa", "hall-a");
  ctx.seedPlayer("p-bravo", "hall-a");
  ctx.seedPlayer("p-charlie", "hall-b"); // annen hall
  const results = await ctx.service.lookupPlayers("a1", "Player");
  assert.equal(results.length, 2);
  assert.ok(results.every((r) => r.id === "p-alfa" || r.id === "p-bravo"));
});

test("getPlayerBalance returnerer wallet-saldo", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  await seedPlayerBalance(ctx, "p1", 250);
  const snapshot = await ctx.service.getPlayerBalance("a1", "p1");
  assert.equal(snapshot.walletBalance, 250);
  assert.equal(snapshot.playerUserId, "p1");
});

test("listPhysicalInventory returnerer UNSOLD-billetter i agentens hall", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.physicalRead.seed({
    uniqueId: "T-100", batchId: "b1", hallId: "hall-a",
    status: "UNSOLD", priceCents: 5000, assignedGameId: null,
  });
  ctx.physicalRead.seed({
    uniqueId: "T-101", batchId: "b1", hallId: "hall-a",
    status: "SOLD", priceCents: 5000, assignedGameId: null,
  });
  ctx.physicalRead.seed({
    uniqueId: "T-200", batchId: "b2", hallId: "hall-b",
    status: "UNSOLD", priceCents: 5000, assignedGameId: null,
  });
  const tickets = await ctx.service.listPhysicalInventory("a1");
  assert.equal(tickets.length, 1);
  assert.equal(tickets[0]!.uniqueId, "T-100");
});

// ═══════════════════════════════════════════════════════════════════════════
// TRANSACTION LOG
// ═══════════════════════════════════════════════════════════════════════════

test("listTransactionsForCurrentShift returnerer kun denne shifts tx-er", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  await ctx.service.cashIn({
    agentUserId: "a1", playerUserId: "p1", amount: 50,
    paymentMethod: "CASH", clientRequestId: "r-1",
  });
  await ctx.service.cashIn({
    agentUserId: "a1", playerUserId: "p1", amount: 75,
    paymentMethod: "CARD", clientRequestId: "r-2",
  });
  const today = await ctx.service.listTransactionsForCurrentShift("a1");
  assert.equal(today.length, 2);
  // Begge tx-er i listen (order ikke garantert ved identiske timestamps).
  const amounts = today.map((t) => t.amount).sort();
  assert.deepEqual(amounts, [50, 75]);
});

// ═══════════════════════════════════════════════════════════════════════════
// WIREFRAME 17.7 + 17.8: AGENT ADD-MONEY / WITHDRAW — REGISTERED USER
// ═══════════════════════════════════════════════════════════════════════════

test("addMoneyToUser happy path — Cash krediterer wallet + amlFlagged=false", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  const result = await ctx.service.addMoneyToUser({
    agentUserId: "a1",
    targetUserId: "p1",
    amount: 500,
    paymentType: "Cash",
    clientRequestId: "req-add-1",
  });
  assert.equal(result.transaction.actionType, "CASH_IN");
  assert.equal(result.transaction.paymentMethod, "CASH");
  assert.equal(result.transaction.amount, 500);
  assert.equal(result.amlFlagged, false);
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 500);
});

test("addMoneyToUser — Card mapper til CARD-paymentMethod", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  const result = await ctx.service.addMoneyToUser({
    agentUserId: "a1",
    targetUserId: "p1",
    amount: 200,
    paymentType: "Card",
    clientRequestId: "req-add-2",
  });
  assert.equal(result.transaction.paymentMethod, "CARD");
});

test("addMoneyToUser — beløp over AML-terskel gir amlFlagged=true", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  const result = await ctx.service.addMoneyToUser({
    agentUserId: "a1",
    targetUserId: "p1",
    amount: AGENT_USER_CASH_AML_THRESHOLD_NOK + 1,
    paymentType: "Cash",
    clientRequestId: "req-add-aml",
  });
  assert.equal(result.amlFlagged, true);
});

test("addMoneyToUser avviser hvis target er AGENT (ikke PLAYER)", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedAgent("a2", "hall-a"); // annen agent, ikke en PLAYER
  await assert.rejects(
    ctx.service.addMoneyToUser({
      agentUserId: "a1",
      targetUserId: "a2",
      amount: 100,
      paymentType: "Cash",
      clientRequestId: "req-add-forbidden",
    }),
    (err) => err instanceof DomainError && err.code === "TARGET_NOT_PLAYER",
  );
});

test("withdrawFromUser happy path — debiterer wallet + daily-balance-cover", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  // Agenten må ha kontanter i shift før uttak (daily-balance-check).
  await ctx.service.cashIn({
    agentUserId: "a1", playerUserId: "p1", amount: 1_000,
    paymentMethod: "CASH", clientRequestId: "r-seed",
  });
  const result = await ctx.service.withdrawFromUser({
    agentUserId: "a1",
    targetUserId: "p1",
    amount: 300,
    paymentType: "Cash",
    clientRequestId: "req-wd-1",
  });
  assert.equal(result.transaction.actionType, "CASH_OUT");
  assert.equal(result.transaction.paymentMethod, "CASH");
  assert.equal(result.transaction.amount, 300);
  assert.equal(result.amlFlagged, false);
  assert.equal(await ctx.wallet.getBalance("wallet-p1"), 700);
});

test("withdrawFromUser feiler hvis bruker ikke har nok balance", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  // Agenten har kontanter i shift (cash-in 100), men spilleren har bare 50.
  await seedPlayerBalance(ctx, "p1", 50);
  await ctx.service.cashIn({
    agentUserId: "a1", playerUserId: "p1", amount: 100,
    paymentMethod: "CASH", clientRequestId: "r-seed",
  });
  // Etter cash-in har spilleren 150, men vi prøver å trekke 200. Enten
  // INSUFFICIENT_BALANCE (spiller-wallet < amount) eller
  // INSUFFICIENT_DAILY_BALANCE (shift-kassa < amount) er akseptabel
  // feilkode — begge beskytter mot samme problem.
  await assert.rejects(
    ctx.service.withdrawFromUser({
      agentUserId: "a1",
      targetUserId: "p1",
      amount: 200,
      paymentType: "Cash",
      clientRequestId: "req-wd-overdraw",
    }),
    (err) =>
      err instanceof DomainError &&
      (err.code === "INSUFFICIENT_BALANCE" || err.code === "INSUFFICIENT_DAILY_BALANCE"),
  );
});

test("withdrawFromUser > AML-terskel uten requireConfirm gir CONFIRMATION_REQUIRED", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  await seedPlayerBalance(ctx, "p1", AGENT_USER_CASH_AML_THRESHOLD_NOK + 500);
  // AML-guarden sparker før daily-balance-guarden — vi trenger derfor
  // ingen seed av agent-shift-daily-balance her. CONFIRMATION_REQUIRED
  // bekrefter at service-laget avslår uttaket før det når wallet-laget.
  await assert.rejects(
    ctx.service.withdrawFromUser({
      agentUserId: "a1",
      targetUserId: "p1",
      amount: AGENT_USER_CASH_AML_THRESHOLD_NOK + 1,
      paymentType: "Cash",
      clientRequestId: "req-wd-aml",
    }),
    (err) => err instanceof DomainError && err.code === "CONFIRMATION_REQUIRED",
  );
});

test("withdrawFromUser > AML-terskel med requireConfirm=true lykkes + amlFlagged=true", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p1", "hall-a");
  await seedPlayerBalance(ctx, "p1", AGENT_USER_CASH_AML_THRESHOLD_NOK + 500);
  // Seed agent-shift-daily-balance så CASH-uttak har dekning.
  const seedTx = await ctx.service.cashIn({
    agentUserId: "a1", playerUserId: "p1", amount: 100,
    paymentMethod: "CASH", clientRequestId: "r-seed",
  });
  await ctx.store.applyShiftCashDelta(seedTx.shiftId, {
    dailyBalance: AGENT_USER_CASH_AML_THRESHOLD_NOK + 500,
  });
  const result = await ctx.service.withdrawFromUser({
    agentUserId: "a1",
    targetUserId: "p1",
    amount: AGENT_USER_CASH_AML_THRESHOLD_NOK + 1,
    paymentType: "Cash",
    clientRequestId: "req-wd-aml-ok",
    requireConfirm: true,
  });
  assert.equal(result.amlFlagged, true);
  assert.equal(result.transaction.amount, AGENT_USER_CASH_AML_THRESHOLD_NOK + 1);
});

test("withdrawFromUser avviser hvis target er AGENT (ikke PLAYER)", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  await ctx.seedAgent("a2", "hall-a");
  await assert.rejects(
    ctx.service.withdrawFromUser({
      agentUserId: "a1",
      targetUserId: "a2",
      amount: 100,
      paymentType: "Cash",
      clientRequestId: "req-wd-forbidden",
    }),
    (err) => err instanceof DomainError && err.code === "TARGET_NOT_PLAYER",
  );
});

test("searchUsers returnerer PLAYER-rader med wallet-saldo — maks 10", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p-alfa", "hall-a");
  ctx.seedPlayer("p-bravo", "hall-a");
  await seedPlayerBalance(ctx, "p-alfa", 300);
  await seedPlayerBalance(ctx, "p-bravo", 150);
  const rows = await ctx.service.searchUsers("a1", "player");
  assert.equal(rows.length, 2);
  const alfa = rows.find((r) => r.id === "p-alfa");
  const bravo = rows.find((r) => r.id === "p-bravo");
  assert.ok(alfa && bravo);
  assert.equal(alfa!.walletBalance, 300);
  assert.equal(bravo!.walletBalance, 150);
});

test("searchUsers returnerer tom liste for whitespace-query", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p-alfa", "hall-a");
  const rows = await ctx.service.searchUsers("a1", "   ");
  assert.deepEqual(rows, []);
});

test("searchUsers ekskluderer spillere i andre haller", async () => {
  const ctx = makeSetup();
  await ctx.seedAgent("a1", "hall-a");
  ctx.seedPlayer("p-alfa", "hall-a");
  ctx.seedPlayer("p-charlie", "hall-b"); // annen hall
  const rows = await ctx.service.searchUsers("a1", "player");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.id, "p-alfa");
});
