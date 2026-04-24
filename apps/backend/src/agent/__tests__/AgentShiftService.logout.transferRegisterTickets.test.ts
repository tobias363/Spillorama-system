/**
 * Wireframe Gap #9 (PDF 17.6): AgentShiftService.logout — transferRegisterTickets-flagg.
 *
 * Dekker:
 *   - logout uten flagg endrer ingen ranges
 *   - logout med transferRegisterTickets=true flagger alle åpne ranges
 *     for agenten (closed_at IS NULL) som transfer_to_next_agent=true
 *   - closed_at-satt ranges blir IKKE oppdatert
 *   - shift-flagg settes selv uten port, men range-tabellen uendret
 *   - isolasjon mellom agenter
 *   - listPendingCashouts returnerer tom liste uten port
 */

import assert from "node:assert/strict";
import test from "node:test";
import { AgentShiftService } from "../AgentShiftService.js";
import { AgentService } from "../AgentService.js";
import { InMemoryAgentStore } from "../AgentStore.js";
import type { AppUser } from "../../platform/PlatformService.js";
import {
  InMemoryShiftTicketRangePort,
  type InMemoryRangeRow,
} from "../ports/ShiftLogoutPorts.js";

function makeServices(opts: { withPort?: boolean } = {}) {
  const store = new InMemoryAgentStore();
  let nextUserId = 1;
  const stubPlatform = {
    async createAdminProvisionedUser(input: {
      email: string;
      password: string;
      displayName: string;
      surname: string;
      role: "ADMIN" | "HALL_OPERATOR" | "SUPPORT" | "PLAYER" | "AGENT";
    }): Promise<AppUser> {
      const id = `user-${nextUserId++}`;
      store.seedAgent({
        userId: id,
        email: input.email,
        displayName: input.displayName,
        surname: input.surname,
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
  const ticketRangePort = new InMemoryShiftTicketRangePort();
  const shiftService = new AgentShiftService({
    agentStore: store,
    agentService,
    ...(opts.withPort ? { ticketRangePort } : {}),
  });
  return { shiftService, agentService, store, ticketRangePort };
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

function seedRange(
  port: InMemoryShiftTicketRangePort,
  overrides: Partial<InMemoryRangeRow> & { id: string; agentId: string }
): void {
  port.seed({
    hallId: "hall-a",
    closedAt: null,
    transferToNextAgent: false,
    ...overrides,
  });
}

test("logout uten flagg endrer ingen ranges", async () => {
  const { shiftService, agentService, ticketRangePort } = makeServices({ withPort: true });
  const agent = await makeAgent(agentService);
  await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  seedRange(ticketRangePort, { id: "r1", agentId: agent.userId });

  const result = await shiftService.logout(agent.userId);

  assert.equal(result.shift.transferredRegisterTickets, false);
  assert.equal(result.ticketRangesFlagged, 0);
  assert.equal(ticketRangePort.snapshot()[0]?.transferToNextAgent, false);
});

test("logout med transferRegisterTickets=true flagger alle åpne ranges", async () => {
  const { shiftService, agentService, ticketRangePort } = makeServices({ withPort: true });
  const agent = await makeAgent(agentService);
  await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  seedRange(ticketRangePort, { id: "r1", agentId: agent.userId });
  seedRange(ticketRangePort, { id: "r2", agentId: agent.userId });

  const result = await shiftService.logout(agent.userId, { transferRegisterTickets: true });

  assert.equal(result.shift.transferredRegisterTickets, true);
  assert.equal(result.ticketRangesFlagged, 2);
  const snap = ticketRangePort.snapshot();
  assert.equal(snap.find((r) => r.id === "r1")?.transferToNextAgent, true);
  assert.equal(snap.find((r) => r.id === "r2")?.transferToNextAgent, true);
});

test("logout-transfer ignorerer closed ranges", async () => {
  const { shiftService, agentService, ticketRangePort } = makeServices({ withPort: true });
  const agent = await makeAgent(agentService);
  await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  seedRange(ticketRangePort, { id: "open", agentId: agent.userId });
  seedRange(ticketRangePort, {
    id: "closed",
    agentId: agent.userId,
    closedAt: new Date().toISOString(),
  });

  const result = await shiftService.logout(agent.userId, { transferRegisterTickets: true });

  assert.equal(result.ticketRangesFlagged, 1);
  const snap = ticketRangePort.snapshot();
  assert.equal(snap.find((r) => r.id === "open")?.transferToNextAgent, true);
  assert.equal(snap.find((r) => r.id === "closed")?.transferToNextAgent, false);
});

test("logout-transfer uten port = shift-flagg satt, 0 ranges", async () => {
  const { shiftService, agentService } = makeServices({ withPort: false });
  const agent = await makeAgent(agentService);
  await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });

  const result = await shiftService.logout(agent.userId, { transferRegisterTickets: true });

  assert.equal(result.shift.transferredRegisterTickets, true);
  assert.equal(result.ticketRangesFlagged, 0);
});

test("logout isolerer ranges per agent", async () => {
  const { shiftService, agentService, ticketRangePort } = makeServices({ withPort: true });
  const agentA = await makeAgent(agentService);
  const agentB = await makeAgent(agentService);
  await shiftService.startShift({ userId: agentA.userId, hallId: "hall-a" });
  seedRange(ticketRangePort, { id: "a1", agentId: agentA.userId });
  seedRange(ticketRangePort, { id: "b1", agentId: agentB.userId });

  const result = await shiftService.logout(agentA.userId, { transferRegisterTickets: true });

  assert.equal(result.ticketRangesFlagged, 1);
  const snap = ticketRangePort.snapshot();
  assert.equal(snap.find((r) => r.id === "a1")?.transferToNextAgent, true);
  assert.equal(snap.find((r) => r.id === "b1")?.transferToNextAgent, false);
});

test("listPendingCashouts returnerer tom liste uten port", async () => {
  const { shiftService, agentService } = makeServices({ withPort: false });
  const agent = await makeAgent(agentService);
  const list = await shiftService.listPendingCashouts(agent.userId);
  assert.deepEqual(list, []);
});

test("logout med begge flagg = begge portene kalt", async () => {
  // For denne testen trenger vi begge portene aktive.
  const store = new InMemoryAgentStore();
  const stubPlatform = {
    async createAdminProvisionedUser(input: {
      email: string;
      password: string;
      displayName: string;
      surname: string;
    }): Promise<AppUser> {
      const id = `user-${Math.random()}`;
      store.seedAgent({
        userId: id,
        email: input.email,
        displayName: input.displayName,
        surname: input.surname,
      });
      return {
        id,
        email: input.email,
        displayName: input.displayName,
        surname: input.surname,
        walletId: `wallet-${id}`,
        role: "AGENT",
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
  const pendingPayoutPort = new (
    await import("../ports/ShiftLogoutPorts.js")
  ).InMemoryShiftPendingPayoutPort();
  const ticketRangePort = new InMemoryShiftTicketRangePort();
  const shiftService = new AgentShiftService({
    agentStore: store,
    agentService,
    pendingPayoutPort,
    ticketRangePort,
  });
  const agent = await agentService.createAgent({
    email: "a@b.no",
    password: "hunter2hunter2",
    displayName: "Agent",
    surname: "Test",
    hallIds: ["hall-a"],
  });
  await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  pendingPayoutPort.seed({
    id: "p1",
    ticketId: "tkt-1",
    hallId: "hall-a",
    scheduledGameId: "game-1",
    patternPhase: "row_1",
    expectedPayoutCents: 1000,
    color: "large",
    detectedAt: new Date().toISOString(),
    verifiedAt: null,
    adminApprovalRequired: false,
    responsibleUserId: agent.userId,
    paidOutAt: null,
    rejectedAt: null,
    pendingForNextAgent: false,
  });
  ticketRangePort.seed({
    id: "r1",
    agentId: agent.userId,
    hallId: "hall-a",
    closedAt: null,
    transferToNextAgent: false,
  });

  const result = await shiftService.logout(agent.userId, {
    distributeWinnings: true,
    transferRegisterTickets: true,
    logoutNotes: "Overleverer til neste vakt",
  });

  assert.equal(result.shift.distributedWinnings, true);
  assert.equal(result.shift.transferredRegisterTickets, true);
  assert.equal(result.shift.logoutNotes, "Overleverer til neste vakt");
  assert.equal(result.pendingCashoutsFlagged, 1);
  assert.equal(result.ticketRangesFlagged, 1);
});
