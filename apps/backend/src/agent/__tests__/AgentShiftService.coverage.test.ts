/**
 * AgentShiftService — additional coverage.
 *
 * Test-engineer Bølge B: fills gaps in:
 *   - listActiveInHall (multiple agents, isolation between halls)
 *   - getShift (existing + SHIFT_NOT_FOUND)
 *   - listPendingCashouts WITH port + filtering rules
 *   - startShift unique-violation race-condition (DB code 23505 → SHIFT_ALREADY_ACTIVE)
 *   - endShift logout-flags pass-through (transferRegisterTickets / distributeWinnings)
 *   - HALL_OPERATOR / SUPPORT cannot endShift another agent's shift
 *   - getShift after endShift still returns the shift (history accessible)
 */

import assert from "node:assert/strict";
import test from "node:test";
import { AgentShiftService } from "../AgentShiftService.js";
import { AgentService } from "../AgentService.js";
import {
  InMemoryAgentStore,
  type AgentShift,
  type AgentStore,
  type StartShiftInput,
} from "../AgentStore.js";
import { InMemoryShiftPendingPayoutPort } from "../ports/ShiftLogoutPorts.js";
import type { AppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../errors/DomainError.js";

function makeServices(opts: { withPendingPayoutPort?: boolean } = {}) {
  const store = new InMemoryAgentStore();
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
      store.seedAgent({
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
  const agentService = new AgentService({ platformService: stubPlatform as any, agentStore: store });
  const pendingPayoutPort = new InMemoryShiftPendingPayoutPort();
  const shiftService = new AgentShiftService({
    agentStore: store,
    agentService,
    ...(opts.withPendingPayoutPort ? { pendingPayoutPort } : {}),
  });
  return { shiftService, agentService, store, pendingPayoutPort };
}

async function makeAgent(agentService: AgentService, hallIds: string[] = ["hall-a"]) {
  return agentService.createAgent({
    email: `a${Math.random()}@b.no`,
    password: "hunter2hunter2",
    displayName: "Agent",
    surname: "Test",
    hallIds,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// listActiveInHall
// ═══════════════════════════════════════════════════════════════════════════

test("listActiveInHall: returns empty for hall with no active shifts", async () => {
  const { shiftService } = makeServices();
  const result = await shiftService.listActiveInHall("hall-empty");
  assert.deepEqual(result, []);
});

test("listActiveInHall: returns only active shifts (ended shifts excluded)", async () => {
  const { shiftService, agentService } = makeServices();
  const a1 = await makeAgent(agentService, ["hall-a"]);
  const a2 = await makeAgent(agentService, ["hall-a"]);
  const s1 = await shiftService.startShift({ userId: a1.userId, hallId: "hall-a" });
  await shiftService.startShift({ userId: a2.userId, hallId: "hall-a" });
  // End one of them.
  await shiftService.endShift({
    shiftId: s1.id, actor: { userId: a1.userId, role: "AGENT" },
  });
  const active = await shiftService.listActiveInHall("hall-a");
  assert.equal(active.length, 1);
  assert.equal(active[0]!.userId, a2.userId);
});

test("listActiveInHall: isolates between halls (cross-hall agent does not bleed in)", async () => {
  const { shiftService, agentService } = makeServices();
  const a1 = await makeAgent(agentService, ["hall-a"]);
  const a2 = await makeAgent(agentService, ["hall-b"]);
  await shiftService.startShift({ userId: a1.userId, hallId: "hall-a" });
  await shiftService.startShift({ userId: a2.userId, hallId: "hall-b" });
  const inA = await shiftService.listActiveInHall("hall-a");
  const inB = await shiftService.listActiveInHall("hall-b");
  assert.equal(inA.length, 1);
  assert.equal(inB.length, 1);
  assert.equal(inA[0]!.userId, a1.userId);
  assert.equal(inB[0]!.userId, a2.userId);
});

// ═══════════════════════════════════════════════════════════════════════════
// getShift
// ═══════════════════════════════════════════════════════════════════════════

test("getShift: returns active shift by id", async () => {
  const { shiftService, agentService } = makeServices();
  const agent = await makeAgent(agentService);
  const shift = await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  const found = await shiftService.getShift(shift.id);
  assert.equal(found.id, shift.id);
  assert.equal(found.isActive, true);
});

test("getShift: SHIFT_NOT_FOUND for unknown id", async () => {
  const { shiftService } = makeServices();
  await assert.rejects(
    shiftService.getShift("no-such-shift"),
    (err) => err instanceof DomainError && err.code === "SHIFT_NOT_FOUND"
  );
});

test("getShift: still returns shift after it has been ended (history-readable)", async () => {
  const { shiftService, agentService } = makeServices();
  const agent = await makeAgent(agentService);
  const shift = await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  await shiftService.endShift({
    shiftId: shift.id, actor: { userId: agent.userId, role: "AGENT" },
  });
  const ended = await shiftService.getShift(shift.id);
  assert.equal(ended.id, shift.id);
  assert.equal(ended.isActive, false);
});

// ═══════════════════════════════════════════════════════════════════════════
// listPendingCashouts WITH port
// ═══════════════════════════════════════════════════════════════════════════

test("listPendingCashouts: returns only pending (not paid_out) rows for that agent", async () => {
  const { shiftService, agentService, pendingPayoutPort } = makeServices({ withPendingPayoutPort: true });
  const agent = await makeAgent(agentService);
  // Seed: one pending, one paid_out, one rejected — only pending should surface.
  pendingPayoutPort.seed({
    id: "pending-1", ticketId: "t1", hallId: "hall-a", scheduledGameId: "game-1",
    patternPhase: "FOUR_CORNERS", expectedPayoutCents: 5000, color: "red",
    detectedAt: "2026-04-25T10:00:00Z", verifiedAt: null, adminApprovalRequired: false,
    responsibleUserId: agent.userId, paidOutAt: null, rejectedAt: null,
    pendingForNextAgent: false,
  });
  pendingPayoutPort.seed({
    id: "paid-1", ticketId: "t2", hallId: "hall-a", scheduledGameId: "game-1",
    patternPhase: "FULL_HOUSE", expectedPayoutCents: 10000, color: "blue",
    detectedAt: "2026-04-25T11:00:00Z", verifiedAt: null, adminApprovalRequired: false,
    responsibleUserId: agent.userId, paidOutAt: "2026-04-25T11:30:00Z", rejectedAt: null,
    pendingForNextAgent: false,
  });
  pendingPayoutPort.seed({
    id: "rejected-1", ticketId: "t3", hallId: "hall-a", scheduledGameId: "game-1",
    patternPhase: "DIAGONAL", expectedPayoutCents: 2500, color: "green",
    detectedAt: "2026-04-25T12:00:00Z", verifiedAt: null, adminApprovalRequired: false,
    responsibleUserId: agent.userId, paidOutAt: null, rejectedAt: "2026-04-25T12:30:00Z",
    pendingForNextAgent: false,
  });
  const list = await shiftService.listPendingCashouts(agent.userId);
  assert.equal(list.length, 1);
  assert.equal(list[0]!.id, "pending-1");
  assert.equal(list[0]!.expectedPayoutCents, 5000);
});

test("listPendingCashouts: empty when port returns no rows for this agent", async () => {
  const { shiftService, agentService, pendingPayoutPort } = makeServices({ withPendingPayoutPort: true });
  const agent = await makeAgent(agentService);
  // Seed only OTHER agent's pending — should NOT surface.
  pendingPayoutPort.seed({
    id: "other-pending", ticketId: "t9", hallId: "hall-a", scheduledGameId: "game-1",
    patternPhase: "FOUR_CORNERS", expectedPayoutCents: 1000, color: "yellow",
    detectedAt: "2026-04-25T10:00:00Z", verifiedAt: null, adminApprovalRequired: false,
    responsibleUserId: "other-agent", paidOutAt: null, rejectedAt: null,
    pendingForNextAgent: false,
  });
  const list = await shiftService.listPendingCashouts(agent.userId);
  assert.deepEqual(list, []);
});

// ═══════════════════════════════════════════════════════════════════════════
// startShift unique-violation race
// ═══════════════════════════════════════════════════════════════════════════

test("startShift: throws SHIFT_ALREADY_ACTIVE when DB raises unique-violation 23505 (race-condition path)", async () => {
  // Build an agent + setup, then wrap the store with a stub that throws 23505.
  const { agentService, store } = makeServices();
  const agent = await makeAgent(agentService);
  // Custom store wrapper that bypasses the in-memory check (returns null for
  // getActiveShiftForUser) but raises 23505 on insertShift — simulating two
  // concurrent calls where both passed the read-check but the DB caught the dup.
  const wrappedStore: AgentStore = Object.assign(Object.create(store) as AgentStore, {
    async getActiveShiftForUser(): Promise<AgentShift | null> {
      return null; // Pretend no active shift
    },
    async insertShift(_input: StartShiftInput): Promise<AgentShift> {
      const err: { code: string } & Error = Object.assign(new Error("duplicate key"), { code: "23505" });
      throw err;
    },
  });
  // Re-create service with our wrapped store.
  const racingService = new AgentShiftService({
    agentStore: wrappedStore, agentService,
  });
  await assert.rejects(
    racingService.startShift({ userId: agent.userId, hallId: "hall-a" }),
    (err) => err instanceof DomainError && err.code === "SHIFT_ALREADY_ACTIVE"
  );
});

test("startShift: re-raises non-23505 errors unchanged", async () => {
  const { agentService, store } = makeServices();
  const agent = await makeAgent(agentService);
  const wrappedStore: AgentStore = Object.assign(Object.create(store) as AgentStore, {
    async getActiveShiftForUser(): Promise<AgentShift | null> { return null; },
    async insertShift(): Promise<AgentShift> {
      const err: { code: string } & Error = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
      throw err;
    },
  });
  const racingService = new AgentShiftService({ agentStore: wrappedStore, agentService });
  await assert.rejects(
    racingService.startShift({ userId: agent.userId, hallId: "hall-a" }),
    (err: unknown) => err instanceof Error && (err as { code?: string }).code === "ECONNREFUSED"
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// endShift role / flags pass-through
// ═══════════════════════════════════════════════════════════════════════════

test("endShift: HALL_OPERATOR cannot end another agent's shift (FORBIDDEN)", async () => {
  const { shiftService, agentService } = makeServices();
  const agent = await makeAgent(agentService);
  const shift = await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  await assert.rejects(
    shiftService.endShift({
      shiftId: shift.id,
      actor: { userId: "operator-1", role: "HALL_OPERATOR" },
    }),
    (err) => err instanceof DomainError && err.code === "FORBIDDEN"
  );
});

test("endShift: SUPPORT cannot end another agent's shift (FORBIDDEN)", async () => {
  const { shiftService, agentService } = makeServices();
  const agent = await makeAgent(agentService);
  const shift = await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  await assert.rejects(
    shiftService.endShift({
      shiftId: shift.id,
      actor: { userId: "support-1", role: "SUPPORT" },
    }),
    (err) => err instanceof DomainError && err.code === "FORBIDDEN"
  );
});

test("endShift: SHIFT_NOT_FOUND when shift doesn't exist", async () => {
  const { shiftService } = makeServices();
  await assert.rejects(
    shiftService.endShift({
      shiftId: "no-such",
      actor: { userId: "any-1", role: "AGENT" },
    }),
    (err) => err instanceof DomainError && err.code === "SHIFT_NOT_FOUND"
  );
});

test("endShift: passes flags through to store (transferred + distributed flags reflected on shift)", async () => {
  const { shiftService, agentService } = makeServices();
  const agent = await makeAgent(agentService);
  const shift = await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  const ended = await shiftService.endShift({
    shiftId: shift.id,
    actor: { userId: agent.userId, role: "AGENT" },
    flags: {
      distributeWinnings: true,
      transferRegisterTickets: true,
      logoutNotes: "End-of-shift handover",
    },
  });
  assert.equal(ended.distributedWinnings, true);
  assert.equal(ended.transferredRegisterTickets, true);
  assert.equal(ended.logoutNotes, "End-of-shift handover");
});

// ═══════════════════════════════════════════════════════════════════════════
// startShift idempotency-style
// ═══════════════════════════════════════════════════════════════════════════

test("startShift: after endShift, agent can start new shift (no leftover active block)", async () => {
  const { shiftService, agentService } = makeServices();
  const agent = await makeAgent(agentService);
  const first = await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  await shiftService.endShift({
    shiftId: first.id, actor: { userId: agent.userId, role: "AGENT" },
  });
  const second = await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  assert.notEqual(second.id, first.id);
  assert.equal(second.isActive, true);
});
