/**
 * HV2-B3 (Tobias 2026-04-30): Integrasjonstester for admin-router som
 * eksponerer per-hall Spill 1 default gevinst-floors.
 *
 * Dekker:
 *   GET  /api/admin/halls/:hallId/spill1-prize-defaults  (HALL_GAME_CONFIG_READ)
 *   PUT  /api/admin/halls/:hallId/spill1-prize-defaults  (HALL_GAME_CONFIG_WRITE)
 *
 * Bruker `InMemorySpill1PrizeDefaultsService` slik at testene kjører uten
 * Postgres. Audit-events verifiseres via `InMemoryAuditLogStore`.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminSpill1PrizeDefaultsRouter } from "../adminSpill1PrizeDefaults.js";
import { buildAdminRouterHelpers, type AdminRouterDeps } from "../adminShared.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import {
  InMemorySpill1PrizeDefaultsService,
  type Spill1PrizeDefaultsService,
} from "../../game/Spill1PrizeDefaultsService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import { DomainError } from "../../errors/DomainError.js";

// ── Test users ────────────────────────────────────────────────────────────

const adminUser: PublicAppUser = {
  id: "admin-1",
  email: "admin@test.no",
  displayName: "Admin",
  walletId: "w-admin",
  role: "ADMIN",
  hallId: null,
  kycStatus: "VERIFIED",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  balance: 0,
};
const supportUser: PublicAppUser = { ...adminUser, id: "sup-1", role: "SUPPORT" };
const ownHallOperator: PublicAppUser = {
  ...adminUser,
  id: "op-own",
  role: "HALL_OPERATOR",
  hallId: "hall-a",
};
const otherHallOperator: PublicAppUser = {
  ...adminUser,
  id: "op-other",
  role: "HALL_OPERATOR",
  hallId: "hall-b",
};
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

// ── Test harness ──────────────────────────────────────────────────────────

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  service: InMemorySpill1PrizeDefaultsService;
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const service = new InMemorySpill1PrizeDefaultsService();
  // Seed wildcard så GET-default ikke returnerer hardcoded fallback bare.
  service.seedWildcard({
    phase1: 100,
    phase2: 200,
    phase3: 200,
    phase4: 200,
    phase5: 1000,
  });

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async getHall(hallIdOrSlug: string) {
      // Test-haller: pass-through på id, slug→id-mapping for "hall-a-slug".
      if (hallIdOrSlug === "hall-a-slug") {
        return { id: "hall-a", slug: "hall-a-slug", name: "Hall A" };
      }
      if (hallIdOrSlug === "hall-a" || hallIdOrSlug === "hall-b") {
        return { id: hallIdOrSlug, slug: hallIdOrSlug, name: hallIdOrSlug };
      }
      throw new DomainError("HALL_NOT_FOUND", `Ukjent hall ${hallIdOrSlug}`);
    },
  } as unknown as PlatformService;

  // Minimal AdminRouterDeps — bare det route-fila trenger.
  const deps = {
    platformService,
    auditLogService,
    spill1PrizeDefaultsService:
      service as unknown as Spill1PrizeDefaultsService,
  } as unknown as AdminRouterDeps;
  const helpers = buildAdminRouterHelpers(deps);

  const app = express();
  app.use(express.json());
  app.use(
    createAdminSpill1PrizeDefaultsRouter({
      ...deps,
      helpers,
    }),
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const addr = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    auditStore,
    service,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

function authHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function jsonFetch(
  url: string,
  init: RequestInit,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, init);
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

async function waitForAudit(
  store: InMemoryAuditLogStore,
  action: string,
): Promise<PersistedAuditEvent | null> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const events = await store.list();
    const hit = events.find((e) => e.action === action);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 10));
  }
  return null;
}

// ── GET tests ─────────────────────────────────────────────────────────────

test("GET returns wildcard defaults when no hall override is set", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      { headers: authHeaders("tok-admin") },
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const data = body.data as Record<string, unknown>;
    assert.equal(data.hallId, "hall-a");
    assert.equal(data.phase1, 100);
    assert.equal(data.phase2, 200);
    assert.equal(data.phase3, 200);
    assert.equal(data.phase4, 200);
    assert.equal(data.phase5, 1000);
  } finally {
    await ctx.close();
  }
});

test("GET returns hall-specific overrides merged with wildcard", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  ctx.service.seedHall("hall-a", { phase1: 150, phase5: 2000 });
  try {
    const { body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      { headers: authHeaders("tok-admin") },
    );
    const data = body.data as Record<string, unknown>;
    assert.equal(data.phase1, 150); // overridden
    assert.equal(data.phase2, 200); // wildcard fallback
    assert.equal(data.phase5, 2000); // overridden
  } finally {
    await ctx.close();
  }
});

test("GET resolves slug to hall-id (platformService.getHall mapping)", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a-slug/spill1-prize-defaults`,
      { headers: authHeaders("tok-admin") },
    );
    assert.equal(status, 200);
    const data = body.data as Record<string, unknown>;
    // Slug ble løst til hall-a, og response.hallId reflekterer den faktiske id-en.
    assert.equal(data.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("GET accessible by SUPPORT (HALL_GAME_CONFIG_READ)", async () => {
  const ctx = await startServer({ "tok-sup": supportUser });
  try {
    const { status } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      { headers: authHeaders("tok-sup") },
    );
    assert.equal(status, 200);
  } finally {
    await ctx.close();
  }
});

test("GET accessible by HALL_OPERATOR for own hall", async () => {
  const ctx = await startServer({ "tok-op": ownHallOperator });
  try {
    const { status } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      { headers: authHeaders("tok-op") },
    );
    assert.equal(status, 200);
  } finally {
    await ctx.close();
  }
});

test("GET forbidden for HALL_OPERATOR on different hall (BIN-591)", async () => {
  const ctx = await startServer({ "tok-op": ownHallOperator });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-b/spill1-prize-defaults`,
      { headers: authHeaders("tok-op") },
    );
    assert.equal(status, 400);
    const err = (body.error as { code: string }).code;
    assert.equal(err, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GET forbidden for PLAYER role", async () => {
  const ctx = await startServer({ "tok-pl": playerUser });
  try {
    const { status } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      { headers: authHeaders("tok-pl") },
    );
    assert.equal(status, 400);
  } finally {
    await ctx.close();
  }
});

test("GET unauthorized without bearer token", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      {},
    );
    assert.equal(status, 400);
  } finally {
    await ctx.close();
  }
});

// ── PUT tests ─────────────────────────────────────────────────────────────

test("PUT updates phase1 only and audit-logs the diff", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      {
        method: "PUT",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ phase1: 150 }),
      },
    );
    assert.equal(status, 200);
    const data = body.data as Record<string, unknown>;
    assert.equal(data.phase1, 150);
    assert.equal(data.phase2, 200); // unchanged

    // Verifiser at servicen faktisk fikk update-en.
    const stored = await ctx.service.getDefaults("hall-a");
    assert.equal(stored.phase1, 150);

    // Verifiser audit-event.
    const event = await waitForAudit(ctx.auditStore, "spill1.prize_defaults.update");
    assert.ok(event);
    assert.equal(event.resource, "hall");
    assert.equal(event.resourceId, "hall-a");
    assert.equal(event.details?.phaseIndex, 1);
    assert.equal(event.details?.before, 100);
    assert.equal(event.details?.after, 150);
  } finally {
    await ctx.close();
  }
});

test("PUT supports partial update across multiple phases", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      {
        method: "PUT",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ phase1: 120, phase3: 250, phase5: 1500 }),
      },
    );
    assert.equal(status, 200);
    const data = body.data as Record<string, unknown>;
    assert.equal(data.phase1, 120);
    assert.equal(data.phase2, 200); // wildcard fallback (unchanged)
    assert.equal(data.phase3, 250);
    assert.equal(data.phase4, 200); // wildcard fallback (unchanged)
    assert.equal(data.phase5, 1500);
  } finally {
    await ctx.close();
  }
});

test("PUT rejects empty body", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      {
        method: "PUT",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({}),
      },
    );
    assert.equal(status, 400);
    const err = (body.error as { code: string }).code;
    assert.equal(err, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("PUT rejects negative phase value", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      {
        method: "PUT",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ phase1: -10 }),
      },
    );
    assert.equal(status, 400);
    const err = (body.error as { code: string }).code;
    assert.equal(err, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("PUT rejects phase value above 2500 kr cap (pengespillforskriften)", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      {
        method: "PUT",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ phase5: 3000 }),
      },
    );
    assert.equal(status, 400);
    const err = (body.error as { code: string; message: string }).code;
    assert.equal(err, "INVALID_INPUT");
    const msg = (body.error as { message: string }).message;
    assert.ok(msg.includes("2500"), `expected cap message, got: ${msg}`);
  } finally {
    await ctx.close();
  }
});

test("PUT accepts exactly 2500 kr (cap boundary)", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      {
        method: "PUT",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ phase5: 2500 }),
      },
    );
    assert.equal(status, 200);
    const data = body.data as Record<string, unknown>;
    assert.equal(data.phase5, 2500);
  } finally {
    await ctx.close();
  }
});

test("PUT accepts 0 (free-floor allowed for testing/policy)", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      {
        method: "PUT",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ phase1: 0 }),
      },
    );
    assert.equal(status, 200);
    const data = body.data as Record<string, unknown>;
    assert.equal(data.phase1, 0);
  } finally {
    await ctx.close();
  }
});

test("PUT rejects non-numeric phase value", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      {
        method: "PUT",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ phase1: "abc" }),
      },
    );
    assert.equal(status, 400);
    const err = (body.error as { code: string }).code;
    assert.equal(err, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("PUT accepts numeric string (form-input fallback)", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      {
        method: "PUT",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ phase1: "175" }),
      },
    );
    assert.equal(status, 200);
    const data = body.data as Record<string, unknown>;
    assert.equal(data.phase1, 175);
  } finally {
    await ctx.close();
  }
});

test("PUT accessible by HALL_OPERATOR for own hall (HALL_GAME_CONFIG_WRITE)", async () => {
  const ctx = await startServer({ "tok-op": ownHallOperator });
  try {
    const { status } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      {
        method: "PUT",
        headers: authHeaders("tok-op"),
        body: JSON.stringify({ phase1: 110 }),
      },
    );
    assert.equal(status, 200);
  } finally {
    await ctx.close();
  }
});

test("PUT forbidden for HALL_OPERATOR on different hall (BIN-591)", async () => {
  const ctx = await startServer({ "tok-op": ownHallOperator });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-b/spill1-prize-defaults`,
      {
        method: "PUT",
        headers: authHeaders("tok-op"),
        body: JSON.stringify({ phase1: 110 }),
      },
    );
    assert.equal(status, 400);
    const err = (body.error as { code: string }).code;
    assert.equal(err, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("PUT forbidden for SUPPORT (HALL_GAME_CONFIG_WRITE excludes SUPPORT)", async () => {
  const ctx = await startServer({ "tok-sup": supportUser });
  try {
    const { status, body } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      {
        method: "PUT",
        headers: authHeaders("tok-sup"),
        body: JSON.stringify({ phase1: 110 }),
      },
    );
    assert.equal(status, 400);
    const err = (body.error as { code: string }).code;
    assert.equal(err, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("PUT forbidden for cross-hall HALL_OPERATOR even with otherHallOperator", async () => {
  const ctx = await startServer({ "tok-other": otherHallOperator });
  try {
    // Other operator har hallId="hall-b", prøver å oppdatere "hall-a"
    const { status } = await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      {
        method: "PUT",
        headers: authHeaders("tok-other"),
        body: JSON.stringify({ phase1: 110 }),
      },
    );
    assert.equal(status, 400);
  } finally {
    await ctx.close();
  }
});

test("PUT skips audit when value is unchanged (idempotent re-write)", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    // Sett phase1=100 (samme som wildcard) → ingen faktisk endring.
    await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      {
        method: "PUT",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ phase1: 100 }),
      },
    );

    // Vent en kort periode for å la audit-fan-out fullføre.
    await new Promise((r) => setTimeout(r, 50));
    const events = await ctx.auditStore.list();
    const updates = events.filter((e) => e.action === "spill1.prize_defaults.update");
    // Ingen audit-event når before === after.
    assert.equal(updates.length, 0);
  } finally {
    await ctx.close();
  }
});

test("PUT writes one audit event per changed phase", async () => {
  const ctx = await startServer({ "tok-admin": adminUser });
  try {
    await jsonFetch(
      `${ctx.baseUrl}/api/admin/halls/hall-a/spill1-prize-defaults`,
      {
        method: "PUT",
        headers: authHeaders("tok-admin"),
        body: JSON.stringify({ phase1: 110, phase3: 250 }),
      },
    );
    await new Promise((r) => setTimeout(r, 50));
    const events = await ctx.auditStore.list();
    const updates = events.filter((e) => e.action === "spill1.prize_defaults.update");
    assert.equal(updates.length, 2);
    const phases = updates.map((e) => (e.details as { phaseIndex: number }).phaseIndex).sort();
    assert.deepEqual(phases, [1, 3]);
  } finally {
    await ctx.close();
  }
});
