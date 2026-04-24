/**
 * Wireframe gaps #8/#10/#11: UniqueIdService unit tests.
 *
 * Covers create / add-money / withdraw / details / reprint / regenerate.
 * Uses InMemoryUniqueIdStore — the Postgres implementation mirrors 1:1.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../../game/BingoEngine.js";
import { AgentService } from "../AgentService.js";
import { InMemoryAgentStore } from "../AgentStore.js";
import type { AppUser } from "../../platform/PlatformService.js";
import { InMemoryUniqueIdStore } from "../UniqueIdStore.js";
import { UniqueIdService } from "../UniqueIdService.js";

async function makeHarness() {
  const agentStore = new InMemoryAgentStore();
  let nextUserId = 1;
  const stubPlatform = {
    async createAdminProvisionedUser(input: {
      email: string;
      password: string;
      displayName: string;
      surname: string;
      role: "ADMIN" | "HALL_OPERATOR" | "SUPPORT" | "PLAYER" | "AGENT";
      phone?: string;
    }): Promise<AppUser> {
      const id = `user-${nextUserId++}`;
      agentStore.seedAgent({
        userId: id,
        email: input.email,
        displayName: input.displayName,
        surname: input.surname,
        phone: input.phone,
      });
      return {
        id,
        email: input.email,
        displayName: input.displayName,
        surname: input.surname,
        walletId: `wallet-${id}`,
        role: input.role,
        hallId: null,
        kycStatus: "UNVERIFIED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    async softDeletePlayer(): Promise<void> {},
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const agentService = new AgentService({ platformService: stubPlatform as any, agentStore });
  const store = new InMemoryUniqueIdStore();
  const service = new UniqueIdService({ store, agentService });
  const agent = await agentService.createAgent({
    email: `a${Math.random()}@b.no`,
    password: "hunter2hunter2",
    displayName: "Agent",
    surname: "Test",
    hallIds: ["hall-a"],
  });
  return { service, store, agentService, agent };
}

// ───────── Create ─────────

test("create: valid input returns card + CREATE transaction", async () => {
  const { service, agent } = await makeHarness();
  const res = await service.create({
    hallId: "hall-a",
    amount: 250,
    hoursValidity: 24,
    paymentType: "CASH",
    agentUserId: agent.userId,
  });
  assert.equal(res.card.balanceCents, 25_000);
  assert.equal(res.card.status, "ACTIVE");
  assert.equal(res.card.paymentType, "CASH");
  assert.equal(res.card.hallId, "hall-a");
  assert.equal(res.card.reprintedCount, 0);
  assert.match(res.card.id, /^\d{9}$/);
  assert.ok(res.card.printedAt);
  assert.equal(res.transaction.actionType, "CREATE");
  assert.equal(res.transaction.amountCents, 25_000);
  assert.equal(res.transaction.newBalance, 25_000);
});

test("create: hoursValidity < 24 throws INVALID_HOURS_VALIDITY (400)", async () => {
  const { service, agent } = await makeHarness();
  await assert.rejects(
    service.create({
      hallId: "hall-a",
      amount: 100,
      hoursValidity: 23,
      paymentType: "CASH",
      agentUserId: agent.userId,
    }),
    (err) => err instanceof DomainError && err.code === "INVALID_HOURS_VALIDITY"
  );
});

test("create: hoursValidity = 0 rejects", async () => {
  const { service, agent } = await makeHarness();
  await assert.rejects(
    service.create({
      hallId: "hall-a",
      amount: 100,
      hoursValidity: 0,
      paymentType: "CASH",
      agentUserId: agent.userId,
    }),
    (err) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("create: non-positive amount rejects", async () => {
  const { service, agent } = await makeHarness();
  await assert.rejects(
    service.create({
      hallId: "hall-a",
      amount: 0,
      hoursValidity: 24,
      paymentType: "CASH",
      agentUserId: agent.userId,
    }),
    (err) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("create: agent without hall access gets HALL_NOT_ASSIGNED", async () => {
  const { service, agent } = await makeHarness();
  await assert.rejects(
    service.create({
      hallId: "hall-z",
      amount: 100,
      hoursValidity: 24,
      paymentType: "CASH",
      agentUserId: agent.userId,
    }),
    (err) => err instanceof DomainError && err.code === "HALL_NOT_ASSIGNED"
  );
});

test("create: non-CASH/CARD paymentType rejects", async () => {
  const { service, agent } = await makeHarness();
  await assert.rejects(
    service.create({
      hallId: "hall-a",
      amount: 100,
      hoursValidity: 24,
      paymentType: "WALLET" as unknown as "CASH",
      agentUserId: agent.userId,
    }),
    (err) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

// ───────── Add Money (PM rule: AKKUMULERES) ─────────

test("addMoney: 170 kr + 200 kr = 370 kr (AKKUMULERES, not overwrite)", async () => {
  const { service, agent } = await makeHarness();
  const created = await service.create({
    hallId: "hall-a",
    amount: 170,
    hoursValidity: 24,
    paymentType: "CASH",
    agentUserId: agent.userId,
  });
  const res = await service.addMoney({
    uniqueId: created.card.id,
    amount: 200,
    paymentType: "CASH",
    agentUserId: agent.userId,
  });
  assert.equal(res.card.balanceCents, 37_000, "Balance must accumulate 170 + 200 = 370");
  assert.equal(res.transaction.actionType, "ADD_MONEY");
  assert.equal(res.transaction.previousBalance, 17_000);
  assert.equal(res.transaction.amountCents, 20_000);
  assert.equal(res.transaction.newBalance, 37_000);
});

test("addMoney: multiple top-ups keep accumulating", async () => {
  const { service, agent } = await makeHarness();
  const created = await service.create({
    hallId: "hall-a",
    amount: 100,
    hoursValidity: 24,
    paymentType: "CASH",
    agentUserId: agent.userId,
  });
  await service.addMoney({ uniqueId: created.card.id, amount: 50, paymentType: "CASH", agentUserId: agent.userId });
  await service.addMoney({ uniqueId: created.card.id, amount: 25, paymentType: "CARD", agentUserId: agent.userId });
  const details = await service.getDetails({ uniqueId: created.card.id });
  assert.equal(details.card.balanceCents, 17_500, "100 + 50 + 25 = 175");
});

test("addMoney: non-existent id throws UNIQUE_ID_NOT_FOUND", async () => {
  const { service, agent } = await makeHarness();
  await assert.rejects(
    service.addMoney({
      uniqueId: "does-not-exist",
      amount: 100,
      paymentType: "CASH",
      agentUserId: agent.userId,
    }),
    (err) => err instanceof DomainError && err.code === "UNIQUE_ID_NOT_FOUND"
  );
});

// ───────── Withdraw (cash-only) ─────────

test("withdraw: cash-only — no explicit paymentType uses CASH", async () => {
  const { service, agent } = await makeHarness();
  const { card } = await service.create({
    hallId: "hall-a",
    amount: 300,
    hoursValidity: 24,
    paymentType: "CASH",
    agentUserId: agent.userId,
  });
  const res = await service.withdraw({
    uniqueId: card.id,
    amount: 100,
    agentUserId: agent.userId,
  });
  assert.equal(res.card.balanceCents, 20_000);
  assert.equal(res.transaction.paymentType, "CASH");
});

test("withdraw: non-CASH paymentType throws PAYMENT_TYPE_NOT_ALLOWED (400)", async () => {
  const { service, agent } = await makeHarness();
  const { card } = await service.create({
    hallId: "hall-a",
    amount: 300,
    hoursValidity: 24,
    paymentType: "CASH",
    agentUserId: agent.userId,
  });
  await assert.rejects(
    service.withdraw({
      uniqueId: card.id,
      amount: 100,
      agentUserId: agent.userId,
      paymentType: "CARD",
    }),
    (err) => err instanceof DomainError && err.code === "PAYMENT_TYPE_NOT_ALLOWED"
  );
});

test("withdraw: amount > balance throws INSUFFICIENT_BALANCE", async () => {
  const { service, agent } = await makeHarness();
  const { card } = await service.create({
    hallId: "hall-a",
    amount: 50,
    hoursValidity: 24,
    paymentType: "CASH",
    agentUserId: agent.userId,
  });
  await assert.rejects(
    service.withdraw({ uniqueId: card.id, amount: 100, agentUserId: agent.userId }),
    (err) => err instanceof DomainError && err.code === "INSUFFICIENT_BALANCE"
  );
});

test("withdraw: full withdrawal sets status=WITHDRAWN", async () => {
  const { service, agent } = await makeHarness();
  const { card } = await service.create({
    hallId: "hall-a",
    amount: 50,
    hoursValidity: 24,
    paymentType: "CASH",
    agentUserId: agent.userId,
  });
  const res = await service.withdraw({ uniqueId: card.id, amount: 50, agentUserId: agent.userId });
  assert.equal(res.card.balanceCents, 0);
  assert.equal(res.card.status, "WITHDRAWN");
});

// ───────── Details ─────────

test("getDetails: returns card + all transactions", async () => {
  const { service, agent } = await makeHarness();
  const { card } = await service.create({
    hallId: "hall-a",
    amount: 100,
    hoursValidity: 24,
    paymentType: "CASH",
    agentUserId: agent.userId,
  });
  await service.addMoney({ uniqueId: card.id, amount: 50, paymentType: "CASH", agentUserId: agent.userId });
  await service.withdraw({ uniqueId: card.id, amount: 30, agentUserId: agent.userId });
  const details = await service.getDetails({ uniqueId: card.id });
  assert.equal(details.transactions.length, 3);
  assert.deepEqual(
    details.transactions.map((t) => t.actionType).sort(),
    ["ADD_MONEY", "CREATE", "WITHDRAW"]
  );
});

test("getDetails: gameType filter returns only matching history", async () => {
  const { service, store, agent } = await makeHarness();
  const { card } = await service.create({
    hallId: "hall-a",
    amount: 100,
    hoursValidity: 24,
    paymentType: "CASH",
    agentUserId: agent.userId,
  });
  // Simulate per-game play-history by manually seeding a GAME-tagged tx.
  await store.insertTransaction({
    uniqueId: card.id,
    actionType: "ADD_MONEY",
    amountCents: 100,
    previousBalance: 10_000,
    newBalance: 10_100,
    agentUserId: agent.userId,
    gameType: "game-1",
  });
  await store.insertTransaction({
    uniqueId: card.id,
    actionType: "ADD_MONEY",
    amountCents: 50,
    previousBalance: 10_100,
    newBalance: 10_150,
    agentUserId: agent.userId,
    gameType: "game-2",
  });
  const details = await service.getDetails({ uniqueId: card.id, gameType: "game-1" });
  assert.equal(details.gameHistory.length, 1);
  assert.equal(details.gameHistory[0]!.gameType, "game-1");
});

test("getDetails: non-existent id throws UNIQUE_ID_NOT_FOUND", async () => {
  const { service } = await makeHarness();
  await assert.rejects(
    service.getDetails({ uniqueId: "missing" }),
    (err) => err instanceof DomainError && err.code === "UNIQUE_ID_NOT_FOUND"
  );
});

// ───────── Reprint ─────────

test("reprint: bumps reprinted_count + appends REPRINT audit row", async () => {
  const { service, agent } = await makeHarness();
  const { card } = await service.create({
    hallId: "hall-a",
    amount: 100,
    hoursValidity: 24,
    paymentType: "CASH",
    agentUserId: agent.userId,
  });
  const first = await service.reprint({
    uniqueId: card.id,
    agentUserId: agent.userId,
    reason: "printer jammed",
  });
  assert.equal(first.card.reprintedCount, 1);
  assert.ok(first.card.lastReprintedAt);
  assert.equal(first.card.lastReprintedBy, agent.userId);

  await service.reprint({ uniqueId: card.id, agentUserId: agent.userId });
  const details = await service.getDetails({ uniqueId: card.id });
  assert.equal(details.card.reprintedCount, 2);
  const reprintRows = details.transactions.filter((t) => t.actionType === "REPRINT");
  assert.equal(reprintRows.length, 2);
});

// ───────── Regenerate ─────────

test("regenerate: new id, balance transferred, old card REGENERATED", async () => {
  const { service, agent } = await makeHarness();
  const { card: oldCard } = await service.create({
    hallId: "hall-a",
    amount: 200,
    hoursValidity: 48,
    paymentType: "CARD",
    agentUserId: agent.userId,
  });
  const res = await service.regenerate({
    uniqueId: oldCard.id,
    agentUserId: agent.userId,
  });
  assert.notEqual(res.newCard.id, oldCard.id);
  assert.equal(res.transferredBalanceCents, 20_000);
  assert.equal(res.newCard.balanceCents, 20_000);
  assert.equal(res.newCard.status, "ACTIVE");
  assert.equal(res.newCard.regeneratedFromId, oldCard.id);
  assert.equal(res.previousCard.status, "REGENERATED");
  assert.equal(res.previousCard.balanceCents, 0);
});

test("regenerate: audit-trail writes REGENERATE on old + CREATE on new", async () => {
  const { service, agent } = await makeHarness();
  const { card: oldCard } = await service.create({
    hallId: "hall-a",
    amount: 150,
    hoursValidity: 24,
    paymentType: "CASH",
    agentUserId: agent.userId,
  });
  const res = await service.regenerate({
    uniqueId: oldCard.id,
    agentUserId: agent.userId,
  });
  const oldDetails = await service.getDetails({ uniqueId: oldCard.id });
  const newDetails = await service.getDetails({ uniqueId: res.newCard.id });
  assert.ok(oldDetails.transactions.some((t) => t.actionType === "REGENERATE"));
  assert.ok(newDetails.transactions.some((t) => t.actionType === "CREATE" && t.newBalance === 15_000));
});

test("regenerate: inactive card rejects (can't regen withdrawn card)", async () => {
  const { service, agent } = await makeHarness();
  const { card } = await service.create({
    hallId: "hall-a",
    amount: 50,
    hoursValidity: 24,
    paymentType: "CASH",
    agentUserId: agent.userId,
  });
  await service.withdraw({ uniqueId: card.id, amount: 50, agentUserId: agent.userId });
  await assert.rejects(
    service.regenerate({ uniqueId: card.id, agentUserId: agent.userId }),
    (err) => err instanceof DomainError && err.code === "UNIQUE_ID_NOT_ACTIVE"
  );
});

// ───────── List ─────────

test("list: filters by hall + status", async () => {
  const { service, agent } = await makeHarness();
  await service.create({ hallId: "hall-a", amount: 100, hoursValidity: 24, paymentType: "CASH", agentUserId: agent.userId });
  await service.create({ hallId: "hall-a", amount: 200, hoursValidity: 24, paymentType: "CARD", agentUserId: agent.userId });
  const all = await service.list({ hallId: "hall-a" });
  assert.equal(all.length, 2);
  const withdrawn = await service.list({ hallId: "hall-a", status: "WITHDRAWN" });
  assert.equal(withdrawn.length, 0);
});
