/**
 * BIN-587 B2.1: integrasjonstester for /api/players/me* endepunkter.
 *
 * Dekker profil-GET, profil-PUT, GDPR-delete, samt audit-log-
 * sideeffekter.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createPlayersRouter } from "../players.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../game/BingoEngine.js";

function makeUser(overrides: Partial<PublicAppUser> = {}): PublicAppUser {
  return {
    id: "user-alice",
    email: "alice@test.no",
    displayName: "Alice",
    walletId: "wallet-alice",
    role: "PLAYER",
    hallId: null,
    kycStatus: "VERIFIED",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    balance: 1000,
    ...overrides,
  };
}

interface Ctx {
  baseUrl: string;
  spies: {
    updates: Array<{ userId: string; input: Record<string, unknown> }>;
    deletes: string[];
    auditStore: InMemoryAuditLogStore;
  };
  close: () => Promise<void>;
}

async function startServer(user: PublicAppUser, opts?: { deleteFails?: boolean }): Promise<Ctx> {
  const updates: Ctx["spies"]["updates"] = [];
  const deletes: string[] = [];
  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      if (token !== "alice-token") throw new DomainError("UNAUTHORIZED", "bad token");
      return user;
    },
    async updateProfile(userId: string, input: Record<string, unknown>) {
      updates.push({ userId, input });
      return { ...user, ...input };
    },
    async deleteAccount(userId: string) {
      if (opts?.deleteFails) throw new DomainError("LAST_ADMIN_REQUIRED", "cant");
      deletes.push(userId);
    },
  } as unknown as PlatformService;

  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);

  const app = express();
  app.use(express.json());
  app.use(createPlayersRouter({ platformService, auditLogService }));

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { updates, deletes, auditStore },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(url: string, method: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// Små hjelpere for å vente på fire-and-forget audit-append.
async function waitForAuditEvent(store: InMemoryAuditLogStore, action: string, timeoutMs = 500): Promise<PersistedAuditEvent | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const events = await store.list();
    const hit = events.find((e) => e.action === action);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 10));
  }
  return null;
}

// ── Tests ─────────────────────────────────────────────────────────────────

test("BIN-587 B2.1: GET /api/players/me/profile returnerer profil-felter", async () => {
  const ctx = await startServer(makeUser({ phone: "+4799999999", surname: "Testesen" }));
  try {
    const res = await req(`${ctx.baseUrl}/api/players/me/profile`, "GET", "alice-token");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.id, "user-alice");
    assert.equal(res.json.data.email, "alice@test.no");
    assert.equal(res.json.data.phone, "+4799999999");
    assert.equal(res.json.data.surname, "Testesen");
    assert.equal(res.json.data.kycStatus, "VERIFIED");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.1: GET /api/players/me/profile uten token gir 400 UNAUTHORIZED", async () => {
  const ctx = await startServer(makeUser());
  try {
    const res = await req(`${ctx.baseUrl}/api/players/me/profile`, "GET");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.1: PUT /api/players/me/profile oppdaterer og logger audit", async () => {
  const ctx = await startServer(makeUser());
  try {
    const res = await req(`${ctx.baseUrl}/api/players/me/profile`, "PUT", "alice-token", {
      displayName: "Alice A.",
      phone: "+4712345678",
    });
    assert.equal(res.status, 200);
    assert.equal(ctx.spies.updates.length, 1);
    assert.deepEqual(ctx.spies.updates[0]!.input, {
      displayName: "Alice A.",
      phone: "+4712345678",
    });
    const event = await waitForAuditEvent(ctx.spies.auditStore, "player.profile.update");
    assert.ok(event, "forventet audit-event player.profile.update");
    assert.equal(event!.actorId, "user-alice");
    assert.equal(event!.actorType, "PLAYER");
    assert.equal(event!.resource, "user");
    assert.deepEqual(event!.details.changed, ["displayName", "phone"]);
    // BIN-588 wire-up: before/after diff per endret felt.
    const diff = event!.details.diff as Record<string, { from: unknown; to: unknown }>;
    assert.deepEqual(diff.displayName, { from: "Alice", to: "Alice A." });
    assert.deepEqual(diff.phone, { from: null, to: "+4712345678" });
    assert.ok(!("email" in diff), "email skal ikke være i diff når den ikke er endret");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.1: PUT profile med uendrede verdier gir tom diff (ikke noise i audit)", async () => {
  const ctx = await startServer(makeUser());
  try {
    const res = await req(`${ctx.baseUrl}/api/players/me/profile`, "PUT", "alice-token", {
      displayName: "Alice", // samme verdi som makeUser-default
    });
    assert.equal(res.status, 200);
    const event = await waitForAuditEvent(ctx.spies.auditStore, "player.profile.update");
    assert.ok(event);
    assert.deepEqual(event!.details.changed, []);
    assert.deepEqual(event!.details.diff, {});
  } finally {
    await ctx.close();
  }
});

test("BIN-588 wire-up: PUT profile med e-post-endring maskerer e-posten til domenet i audit", async () => {
  const ctx = await startServer(makeUser());
  try {
    const res = await req(`${ctx.baseUrl}/api/players/me/profile`, "PUT", "alice-token", {
      email: "alice@newdomain.no",
    });
    assert.equal(res.status, 200);
    const event = await waitForAuditEvent(ctx.spies.auditStore, "player.profile.update");
    assert.ok(event);
    const diff = event!.details.diff as Record<string, { from: unknown; to: unknown }>;
    assert.deepEqual(diff.email, { from: "@test.no", to: "@newdomain.no" });
    // Kryss-sjekk: ingen klartekst-e-post noe sted i audit-payload.
    const serialized = JSON.stringify(event!.details);
    assert.ok(!serialized.includes("alice@test.no"));
    assert.ok(!serialized.includes("alice@newdomain.no"));
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.1: PUT /api/players/me/profile ignorerer ukjente felter", async () => {
  const ctx = await startServer(makeUser());
  try {
    const res = await req(`${ctx.baseUrl}/api/players/me/profile`, "PUT", "alice-token", {
      displayName: "Alice",
      hallId: "hall-malicious", // skal IKKE havne i updateProfile-input
      role: "ADMIN",
    });
    assert.equal(res.status, 200);
    const input = ctx.spies.updates[0]!.input;
    assert.deepEqual(Object.keys(input), ["displayName"]);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.1: DELETE /api/players/me sletter og logger GDPR-audit", async () => {
  const ctx = await startServer(makeUser({ email: "alice@test.no" }));
  try {
    const res = await req(`${ctx.baseUrl}/api/players/me`, "DELETE", "alice-token");
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.data, { deleted: true });
    assert.deepEqual(ctx.spies.deletes, ["user-alice"]);

    const event = await waitForAuditEvent(ctx.spies.auditStore, "account.self_delete");
    assert.ok(event, "forventet audit-event account.self_delete");
    assert.equal(event!.actorType, "PLAYER");
    assert.equal(event!.resourceId, "user-alice");
    assert.equal(event!.details.reason, "gdpr-self-service");
    assert.equal(event!.details.emailDomain, "test.no");
    // E-post skal ikke være logget i klartekst.
    const serialized = JSON.stringify(event!.details);
    assert.ok(!serialized.includes("alice@test.no"), "E-post skal ikke logges i klartekst i audit");
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.1: DELETE feiler hvis deleteAccount kaster (f.eks. siste admin)", async () => {
  const ctx = await startServer(makeUser({ role: "ADMIN" }), { deleteFails: true });
  try {
    const res = await req(`${ctx.baseUrl}/api/players/me`, "DELETE", "alice-token");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "LAST_ADMIN_REQUIRED");
    assert.deepEqual(ctx.spies.deletes, []);
  } finally {
    await ctx.close();
  }
});

test("BIN-587 B2.1: DELETE uten token gir UNAUTHORIZED", async () => {
  const ctx = await startServer(makeUser());
  try {
    const res = await req(`${ctx.baseUrl}/api/players/me`, "DELETE");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
    assert.deepEqual(ctx.spies.deletes, []);
  } finally {
    await ctx.close();
  }
});
