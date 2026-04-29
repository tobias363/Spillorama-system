/**
 * BIN-583 B3.1: AgentService unit tests.
 *
 * Uses InMemoryAgentStore + a stub PlatformService that exposes the
 * two methods AgentService actually calls (createAdminProvisionedUser,
 * softDeletePlayer). We assert on domain rules: hall-assignment sync,
 * self-service whitelist, active-shift block on delete, primary-hall
 * invariants.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { AgentService } from "../AgentService.js";
import { InMemoryAgentStore } from "../AgentStore.js";
import type { AppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../errors/DomainError.js";

interface StubCreatedUser {
  email: string;
  password: string;
  role: string;
  displayName: string;
  surname: string;
  phone?: string;
}

function makeServices() {
  const store = new InMemoryAgentStore();
  const created: StubCreatedUser[] = [];
  const softDeletes: string[] = [];
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
      created.push({ ...input });
      const id = `user-${nextUserId++}`;
      // Seed the InMemoryAgentStore so later reads find the row.
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
        phone: input.phone,
        walletId: `wallet-${id}`,
        role: input.role,
        hallId: null,
        kycStatus: "UNVERIFIED",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    },
    async softDeletePlayer(userId: string): Promise<void> {
      softDeletes.push(userId);
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new AgentService({ platformService: stubPlatform as any, agentStore: store });
  return { service, store, created, softDeletes };
}

test("createAgent opprett-er user + profil + hall-tildeling", async () => {
  const { service, store } = makeServices();
  const agent = await service.createAgent({
    email: "agent1@test.no",
    password: "hunter2hunter2",
    displayName: "Agent One",
    surname: "Testesen",
    hallIds: ["hall-a", "hall-b"],
    primaryHallId: "hall-b",
    language: "nb",
  });
  assert.equal(agent.email, "agent1@test.no");
  assert.equal(agent.role, "AGENT");
  assert.equal(agent.halls.length, 2);
  assert.equal(agent.halls.find((h) => h.isPrimary)?.hallId, "hall-b");
  const halls = await store.listAssignedHalls(agent.userId);
  assert.equal(halls.filter((h) => h.isPrimary).length, 1);
});

test("createAgent default primary = første hall hvis primaryHallId mangler", async () => {
  const { service } = makeServices();
  const agent = await service.createAgent({
    email: "a@b.no",
    password: "hunter2hunter2",
    displayName: "A",
    surname: "B",
    hallIds: ["first", "second"],
  });
  assert.equal(agent.halls.find((h) => h.isPrimary)?.hallId, "first");
});

test("createAgent feiler hvis primaryHallId ikke er med i hallIds", async () => {
  const { service } = makeServices();
  await assert.rejects(
    service.createAgent({
      email: "a@b.no",
      password: "hunter2hunter2",
      displayName: "A",
      surname: "B",
      hallIds: ["hall-a"],
      primaryHallId: "hall-z",
    }),
    (err) => err instanceof DomainError && err.code === "INVALID_PRIMARY_HALL"
  );
});

test("createAgent avviser ugyldig språk", async () => {
  const { service } = makeServices();
  await assert.rejects(
    service.createAgent({
      email: "a@b.no",
      password: "hunter2hunter2",
      displayName: "A",
      surname: "B",
      language: "klingon",
    }),
    (err) => err instanceof DomainError && err.code === "INVALID_LANGUAGE"
  );
});

test("updateAgent — agent kan oppdatere displayName/phone, ikke agentStatus", async () => {
  const { service } = makeServices();
  const agent = await service.createAgent({
    email: "a@b.no",
    password: "hunter2hunter2",
    displayName: "Old",
    surname: "Doe",
  });
  const updated = await service.updateAgent(
    agent.userId,
    { displayName: "New Name", phone: "+4712345678" },
    { role: "AGENT", userId: agent.userId }
  );
  assert.equal(updated.displayName, "New Name");
  assert.equal(updated.phone, "+4712345678");

  await assert.rejects(
    service.updateAgent(
      agent.userId,
      { agentStatus: "inactive" },
      { role: "AGENT", userId: agent.userId }
    ),
    (err) => err instanceof DomainError && err.code === "FORBIDDEN"
  );
});

test("updateAgent — agent kan ikke oppdatere andres profil", async () => {
  const { service } = makeServices();
  const agent = await service.createAgent({
    email: "a@b.no",
    password: "hunter2hunter2",
    displayName: "A",
    surname: "B",
  });
  await assert.rejects(
    service.updateAgent(
      agent.userId,
      { displayName: "Hacked" },
      { role: "AGENT", userId: "some-other-id" }
    ),
    (err) => err instanceof DomainError && err.code === "FORBIDDEN"
  );
});

test("updateAgent — admin endrer hallIds diff-merger korrekt", async () => {
  const { service } = makeServices();
  const agent = await service.createAgent({
    email: "a@b.no",
    password: "hunter2hunter2",
    displayName: "A",
    surname: "B",
    hallIds: ["hall-a", "hall-b"],
    primaryHallId: "hall-a",
  });
  const updated = await service.updateAgent(
    agent.userId,
    { hallIds: ["hall-b", "hall-c"] },
    { role: "ADMIN", userId: "admin-1" }
  );
  const ids = updated.halls.map((h) => h.hallId).sort();
  assert.deepEqual(ids, ["hall-b", "hall-c"]);
  // hall-a er fjernet; primary promoteres til hall-b siden hall-a ikke er med lenger.
  assert.equal(updated.halls.find((h) => h.isPrimary)?.hallId, "hall-b");
});

test("updateAgent — primaryHallId må være i hallIds", async () => {
  const { service } = makeServices();
  const agent = await service.createAgent({
    email: "a@b.no",
    password: "hunter2hunter2",
    displayName: "A",
    surname: "B",
    hallIds: ["hall-a"],
  });
  await assert.rejects(
    service.updateAgent(
      agent.userId,
      { hallIds: ["hall-a"], primaryHallId: "hall-z" },
      { role: "ADMIN", userId: "admin-1" }
    ),
    (err) => err instanceof DomainError && err.code === "INVALID_PRIMARY_HALL"
  );
});

test("softDeleteAgent blokkerer hvis agenten har aktiv shift", async () => {
  const { service, store } = makeServices();
  const agent = await service.createAgent({
    email: "a@b.no",
    password: "hunter2hunter2",
    displayName: "A",
    surname: "B",
    hallIds: ["hall-a"],
  });
  await store.insertShift({ userId: agent.userId, hallId: "hall-a" });
  await assert.rejects(
    service.softDeleteAgent(agent.userId),
    (err) => err instanceof DomainError && err.code === "AGENT_HAS_ACTIVE_SHIFT"
  );
});

test("softDeleteAgent setter agent_status=inactive + kaller platform.softDeletePlayer", async () => {
  const { service, store, softDeletes } = makeServices();
  const agent = await service.createAgent({
    email: "a@b.no",
    password: "hunter2hunter2",
    displayName: "A",
    surname: "B",
  });
  await service.softDeleteAgent(agent.userId);
  const after = await store.getAgentById(agent.userId);
  assert.equal(after?.agentStatus, "inactive");
  assert.deepEqual(softDeletes, [agent.userId]);
});

test("requireActiveAgent kaster hvis agent er inaktiv", async () => {
  const { service, store } = makeServices();
  const agent = await service.createAgent({
    email: "a@b.no",
    password: "hunter2hunter2",
    displayName: "A",
    surname: "B",
  });
  await store.updateAgentProfile(agent.userId, { agentStatus: "inactive" });
  await assert.rejects(
    service.requireActiveAgent(agent.userId),
    (err) => err instanceof DomainError && err.code === "ACCOUNT_INACTIVE"
  );
});

test("assertHallMembership kaster på ukjent hall", async () => {
  const { service } = makeServices();
  const agent = await service.createAgent({
    email: "a@b.no",
    password: "hunter2hunter2",
    displayName: "A",
    surname: "B",
    hallIds: ["hall-a"],
  });
  await assert.rejects(
    service.assertHallMembership(agent.userId, "hall-z"),
    (err) => err instanceof DomainError && err.code === "HALL_NOT_ASSIGNED"
  );
});
