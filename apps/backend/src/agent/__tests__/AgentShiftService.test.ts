/**
 * BIN-583 B3.1: AgentShiftService unit tests.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { AgentShiftService } from "../AgentShiftService.js";
import { AgentService } from "../AgentService.js";
import { InMemoryAgentStore } from "../AgentStore.js";
import type { AppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../errors/DomainError.js";

function makeServices() {
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
  const shiftService = new AgentShiftService({ agentStore: store, agentService });
  return { shiftService, agentService, store };
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

test("startShift oppretter aktiv shift for agenten", async () => {
  const { shiftService, agentService } = makeServices();
  const agent = await makeAgent(agentService, ["hall-a"]);
  const shift = await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  assert.equal(shift.isActive, true);
  assert.equal(shift.hallId, "hall-a");
  assert.equal(shift.userId, agent.userId);
  assert.equal(shift.endedAt, null);
});

test("startShift feiler hvis agenten allerede har aktiv shift", async () => {
  const { shiftService, agentService } = makeServices();
  const agent = await makeAgent(agentService, ["hall-a"]);
  await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  await assert.rejects(
    shiftService.startShift({ userId: agent.userId, hallId: "hall-a" }),
    (err) => err instanceof DomainError && err.code === "SHIFT_ALREADY_ACTIVE"
  );
});

test("startShift feiler hvis hallId ikke er tildelt agenten", async () => {
  const { shiftService, agentService } = makeServices();
  const agent = await makeAgent(agentService, ["hall-a"]);
  await assert.rejects(
    shiftService.startShift({ userId: agent.userId, hallId: "hall-z" }),
    (err) => err instanceof DomainError && err.code === "HALL_NOT_ASSIGNED"
  );
});

test("startShift feiler hvis agenten er inaktiv", async () => {
  const { shiftService, agentService, store } = makeServices();
  const agent = await makeAgent(agentService, ["hall-a"]);
  await store.updateAgentProfile(agent.userId, { agentStatus: "inactive" });
  await assert.rejects(
    shiftService.startShift({ userId: agent.userId, hallId: "hall-a" }),
    (err) => err instanceof DomainError && err.code === "ACCOUNT_INACTIVE"
  );
});

test("endShift avslutter aktiv shift — owner-flow", async () => {
  const { shiftService, agentService } = makeServices();
  const agent = await makeAgent(agentService, ["hall-a"]);
  const shift = await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  const ended = await shiftService.endShift({
    shiftId: shift.id,
    actor: { userId: agent.userId, role: "AGENT" },
  });
  assert.equal(ended.isActive, false);
  assert.equal(ended.isLoggedOut, true);
  assert.ok(ended.endedAt, "endedAt skal være satt");
});

test("endShift feiler for annen agent som ikke eier shiften", async () => {
  const { shiftService, agentService } = makeServices();
  const agent = await makeAgent(agentService, ["hall-a"]);
  const shift = await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  await assert.rejects(
    shiftService.endShift({
      shiftId: shift.id,
      actor: { userId: "other-agent", role: "AGENT" },
    }),
    (err) => err instanceof DomainError && err.code === "FORBIDDEN"
  );
});

test("endShift tillatt for ADMIN (force-close) med reason", async () => {
  const { shiftService, agentService } = makeServices();
  const agent = await makeAgent(agentService, ["hall-a"]);
  const shift = await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  const ended = await shiftService.endShift({
    shiftId: shift.id,
    actor: { userId: "admin-1", role: "ADMIN" },
    reason: "Agent crashed; ops-cleanup",
  });
  assert.equal(ended.isActive, false);
  // PR #522 hotfix: force-close logger reason i logoutNotes med actor-prefix.
  assert.match(ended.logoutNotes ?? "", /\[ADMIN_FORCE_CLOSE by admin-1\] Agent crashed; ops-cleanup/);
});

test("endShift ADMIN force-close uten reason → FORCE_CLOSE_REASON_REQUIRED", async () => {
  const { shiftService, agentService } = makeServices();
  const agent = await makeAgent(agentService, ["hall-a"]);
  const shift = await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  await assert.rejects(
    shiftService.endShift({
      shiftId: shift.id,
      actor: { userId: "admin-1", role: "ADMIN" },
    }),
    (err) => err instanceof DomainError && err.code === "FORCE_CLOSE_REASON_REQUIRED",
  );
});

test("endShift owner-flow ignorerer reason-krav (egen shift)", async () => {
  const { shiftService, agentService } = makeServices();
  const agent = await makeAgent(agentService, ["hall-a"]);
  const shift = await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  // Owner kan kalle med ADMIN-rolle (theoretical edge case) uten reason —
  // force-close-kravet gjelder kun når caller != shift-eier.
  const ended = await shiftService.endShift({
    shiftId: shift.id,
    actor: { userId: agent.userId, role: "ADMIN" },
  });
  assert.equal(ended.isActive, false);
});

test("endShift feiler på allerede avsluttet shift", async () => {
  const { shiftService, agentService } = makeServices();
  const agent = await makeAgent(agentService, ["hall-a"]);
  const shift = await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  await shiftService.endShift({
    shiftId: shift.id,
    actor: { userId: agent.userId, role: "AGENT" },
  });
  await assert.rejects(
    shiftService.endShift({
      shiftId: shift.id,
      actor: { userId: agent.userId, role: "AGENT" },
    }),
    (err) => err instanceof DomainError && err.code === "SHIFT_ALREADY_ENDED"
  );
});

test("getCurrentShift returnerer aktiv shift; null når ingen aktiv", async () => {
  const { shiftService, agentService } = makeServices();
  const agent = await makeAgent(agentService, ["hall-a"]);
  assert.equal(await shiftService.getCurrentShift(agent.userId), null);
  const shift = await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
  const current = await shiftService.getCurrentShift(agent.userId);
  assert.equal(current?.id, shift.id);
  await shiftService.endShift({
    shiftId: shift.id,
    actor: { userId: agent.userId, role: "AGENT" },
  });
  assert.equal(await shiftService.getCurrentShift(agent.userId), null);
});

test("getHistory sortert DESC på startedAt, paginert", async () => {
  const { shiftService, agentService } = makeServices();
  const agent = await makeAgent(agentService, ["hall-a"]);
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    // eslint-disable-next-line no-await-in-loop
    const s = await shiftService.startShift({ userId: agent.userId, hallId: "hall-a" });
    ids.push(s.id);
    // eslint-disable-next-line no-await-in-loop
    await shiftService.endShift({
      shiftId: s.id,
      actor: { userId: agent.userId, role: "AGENT" },
    });
    // Liten pause for å få unik startedAt-timestamp ved in-memory-tid.
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 2));
  }
  const history = await shiftService.getHistory(agent.userId, { limit: 10 });
  assert.equal(history.length, 3);
  // Nyeste først.
  assert.equal(history[0]!.id, ids[2]);
});
