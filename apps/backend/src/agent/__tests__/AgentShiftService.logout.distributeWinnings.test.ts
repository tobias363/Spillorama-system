/**
 * Wireframe Gap #9 (PDF 17.6): AgentShiftService.logout — distributeWinnings-flagg.
 *
 * Dekker:
 *   - logout uten flagg = legacy-oppførsel (0 flagg satt, ingen pending oppdatert)
 *   - logout med distributeWinnings=true markerer alle åpne pending-rader
 *     for agenten som pending_for_next_agent=true
 *   - logout med distributeWinnings=true uten port = log-only (shift-flagg satt, 0 rader)
 *   - logout med distributeWinnings=false skriver ingen pending-endring selv med port
 *   - kun rader for riktig agent oppdateres (isolasjon)
 *   - allerede utbetalte + rejected rader ignoreres
 */

import assert from "node:assert/strict";
import test from "node:test";
import { AgentShiftService } from "../AgentShiftService.js";
import { AgentService } from "../AgentService.js";
import { InMemoryAgentStore } from "../AgentStore.js";
import type { AppUser } from "../../platform/PlatformService.js";
import {
  InMemoryShiftPendingPayoutPort,
  type InMemoryPendingRow,
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
  const pendingPayoutPort = new InMemoryShiftPendingPayoutPort();
  const shiftService = new AgentShiftService({
    agentStore: store,
    agentService,
    ...(opts.withPort ? { pendingPayoutPort } : {}),
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

function seedPending(
  port: InMemoryShiftPendingPayoutPort,
  overrides: Partial<InMemoryPendingRow> & { id: string; responsibleUserId: string }
): void {
  port.seed({
    ticketId: "tkt-1",
    hallId: "hall-a",
    scheduledGameId: "game-1",
    patternPhase: "row_1",
    expectedPayoutCents: 20000,
    color: "large",
    detectedAt: new Date().toISOString(),
    verifiedAt: null,
    adminApprovalRequired: false,
    paidOutAt: null,
    rejectedAt: null,
    pendingForNextAgent: false,
    ...overrides,
  });
}

test("logout uten flagg setter kun shift.isActive=false; ingen pending-row-endring", async () => {
  const { shiftService, agentService, pendingPayoutPort } = makeServices({ withPort: true });
  const agent = await makeAgent(agentService);
  await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  seedPending(pendingPayoutPort, { id: "p1", responsibleUserId: agent.userId });

  const result = await shiftService.logout(agent.userId);

  assert.equal(result.shift.isActive, false);
  assert.equal(result.shift.isLoggedOut, true);
  assert.equal(result.shift.distributedWinnings, false);
  assert.equal(result.pendingCashoutsFlagged, 0);
  const snap = pendingPayoutPort.snapshot();
  assert.equal(snap[0]?.pendingForNextAgent, false, "pending row skal IKKE flagges uten flagg");
});

test("logout med distributeWinnings=true flagger alle åpne pending-rader for agenten", async () => {
  const { shiftService, agentService, pendingPayoutPort } = makeServices({ withPort: true });
  const agent = await makeAgent(agentService);
  await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  seedPending(pendingPayoutPort, { id: "p1", responsibleUserId: agent.userId });
  seedPending(pendingPayoutPort, { id: "p2", responsibleUserId: agent.userId });

  const result = await shiftService.logout(agent.userId, { distributeWinnings: true });

  assert.equal(result.shift.distributedWinnings, true);
  assert.equal(result.pendingCashoutsFlagged, 2);
  const snap = pendingPayoutPort.snapshot();
  assert.equal(snap.find((r) => r.id === "p1")?.pendingForNextAgent, true);
  assert.equal(snap.find((r) => r.id === "p2")?.pendingForNextAgent, true);
});

test("logout med distributeWinnings=true og uten port = shift-flagg satt, 0 rader flagget", async () => {
  const { shiftService, agentService } = makeServices({ withPort: false });
  const agent = await makeAgent(agentService);
  await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });

  const result = await shiftService.logout(agent.userId, { distributeWinnings: true });

  assert.equal(result.shift.distributedWinnings, true);
  assert.equal(result.pendingCashoutsFlagged, 0);
});

test("logout med distributeWinnings=false skriver ingen pending-endring", async () => {
  const { shiftService, agentService, pendingPayoutPort } = makeServices({ withPort: true });
  const agent = await makeAgent(agentService);
  await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  seedPending(pendingPayoutPort, { id: "p1", responsibleUserId: agent.userId });

  const result = await shiftService.logout(agent.userId, { distributeWinnings: false });

  assert.equal(result.shift.distributedWinnings, false);
  assert.equal(result.pendingCashoutsFlagged, 0);
  assert.equal(pendingPayoutPort.snapshot()[0]?.pendingForNextAgent, false);
});

test("logout påvirker kun rader for agenten selv (isolasjon)", async () => {
  const { shiftService, agentService, pendingPayoutPort } = makeServices({ withPort: true });
  const agentA = await makeAgent(agentService);
  const agentB = await makeAgent(agentService);
  await shiftService.startShift({ userId: agentA.userId, hallId: "hall-a" });
  seedPending(pendingPayoutPort, { id: "a1", responsibleUserId: agentA.userId });
  seedPending(pendingPayoutPort, { id: "b1", responsibleUserId: agentB.userId });

  const result = await shiftService.logout(agentA.userId, { distributeWinnings: true });

  assert.equal(result.pendingCashoutsFlagged, 1);
  const snap = pendingPayoutPort.snapshot();
  assert.equal(snap.find((r) => r.id === "a1")?.pendingForNextAgent, true);
  assert.equal(snap.find((r) => r.id === "b1")?.pendingForNextAgent, false);
});

test("logout med distributeWinnings=true ignorerer paid_out/rejected rader", async () => {
  const { shiftService, agentService, pendingPayoutPort } = makeServices({ withPort: true });
  const agent = await makeAgent(agentService);
  await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  seedPending(pendingPayoutPort, { id: "open", responsibleUserId: agent.userId });
  seedPending(pendingPayoutPort, {
    id: "paid",
    responsibleUserId: agent.userId,
    paidOutAt: new Date().toISOString(),
  });
  seedPending(pendingPayoutPort, {
    id: "rejected",
    responsibleUserId: agent.userId,
    rejectedAt: new Date().toISOString(),
  });

  const result = await shiftService.logout(agent.userId, { distributeWinnings: true });

  assert.equal(result.pendingCashoutsFlagged, 1);
  const snap = pendingPayoutPort.snapshot();
  assert.equal(snap.find((r) => r.id === "open")?.pendingForNextAgent, true);
  assert.equal(snap.find((r) => r.id === "paid")?.pendingForNextAgent, false);
  assert.equal(snap.find((r) => r.id === "rejected")?.pendingForNextAgent, false);
});

test("logout uten aktiv shift kaster NO_ACTIVE_SHIFT", async () => {
  const { shiftService, agentService } = makeServices({ withPort: true });
  const agent = await makeAgent(agentService);
  // Ingen startShift.
  await assert.rejects(
    shiftService.logout(agent.userId, { distributeWinnings: true }),
    (err: unknown) =>
      err instanceof Error && "code" in err && (err as { code: string }).code === "NO_ACTIVE_SHIFT"
  );
});
