/**
 * BIN-17.36: integrasjonstester for /api/admin/reports/hall-specific.
 *
 * Dekker:
 *   - RBAC (DAILY_REPORT_READ kreves; PLAYER + AGENT blokkert).
 *   - HALL_OPERATOR auto-scope til egen hall (andre hallIds fail-closed).
 *   - Response-shape: rows + totals, én rad per hall.
 *   - Elvis Replacement-kolonne populeres fra metadata.isReplacement=true.
 *   - Ugyldig vindu → INVALID_INPUT.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAdminReportsHallSpecificRouter } from "../adminReportsHallSpecific.js";
import type { BingoEngine } from "../../game/BingoEngine.js";
import type {
  PlatformService,
  PublicAppUser,
  ScheduleSlot,
  ScheduleLogEntry,
  HallDefinition,
} from "../../platform/PlatformService.js";
import type { HallGroupService, HallGroup } from "../../admin/HallGroupService.js";
import type { AgentService } from "../../agent/AgentService.js";
import type { AgentProfile } from "../../agent/AgentStore.js";
import type { ComplianceLedgerEntry } from "../../game/ComplianceLedger.js";
import { DomainError } from "../../game/BingoEngine.js";

const adminUser: PublicAppUser = {
  id: "admin-1",
  email: "a@test.no",
  displayName: "Admin",
  walletId: "w-a",
  role: "ADMIN",
  hallId: null,
  kycStatus: "VERIFIED",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  balance: 0,
};
const operatorA: PublicAppUser = { ...adminUser, id: "op-a", role: "HALL_OPERATOR", hallId: "hall-a" };
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

function hall(id: string, name: string): HallDefinition {
  return {
    id,
    slug: id,
    name,
    region: "NO",
    address: "",
    isActive: true,
    clientVariant: "web",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as HallDefinition;
}

function group(id: string, name: string, hallIds: string[]): HallGroup {
  return {
    id,
    legacyGroupHallId: `GH_${id}`,
    name,
    status: "active",
    tvId: null,
    productIds: [],
    members: hallIds.map((hallId) => ({
      hallId,
      hallName: `Hall ${hallId}`,
      hallStatus: "active",
      addedAt: "2026-01-01T00:00:00.000Z",
    })),
    extra: {},
    createdBy: "admin",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
  } as HallGroup;
}

function entry(
  overrides: Partial<ComplianceLedgerEntry> &
    Pick<ComplianceLedgerEntry, "eventType" | "amount" | "hallId">
): ComplianceLedgerEntry {
  const createdAt = overrides.createdAt ?? "2026-04-18T18:00:00.000Z";
  return {
    id: overrides.id ?? `e-${Math.random().toString(36).slice(2, 9)}`,
    createdAt,
    createdAtMs: Date.parse(createdAt),
    hallId: overrides.hallId,
    gameType: overrides.gameType ?? "MAIN_GAME",
    channel: overrides.channel ?? "HALL",
    eventType: overrides.eventType,
    amount: overrides.amount,
    currency: "NOK",
    gameId: overrides.gameId,
    metadata: overrides.metadata,
  };
}

interface Ctx {
  baseUrl: string;
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  opts?: {
    halls?: HallDefinition[];
    hallGroups?: HallGroup[];
    agents?: AgentProfile[];
    slots?: ScheduleSlot[];
    logs?: ScheduleLogEntry[];
    entries?: ComplianceLedgerEntry[];
  }
): Promise<Ctx> {
  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad");
      return u;
    },
    async listHalls() {
      return opts?.halls ?? [hall("hall-a", "Alpha"), hall("hall-b", "Beta")];
    },
    async listAllScheduleSlots() {
      return opts?.slots ?? [];
    },
    async listScheduleLogInRange() {
      return opts?.logs ?? [];
    },
  } as unknown as PlatformService;

  const engine = {
    listComplianceLedgerEntries() {
      return opts?.entries ?? [];
    },
  } as unknown as BingoEngine;

  const hallGroupService = {
    async list() {
      return opts?.hallGroups ?? [];
    },
  } as unknown as HallGroupService;

  const agentService = {
    async list() {
      return opts?.agents ?? [];
    },
  } as unknown as AgentService;

  const app = express();
  app.use(express.json());
  app.use(
    createAdminReportsHallSpecificRouter({
      platformService,
      engine,
      hallGroupService,
      agentService,
    }),
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function req(
  baseUrl: string,
  path: string,
  token?: string,
): Promise<{ status: number; json: { ok?: boolean; data?: unknown; error?: { code?: string } } }> {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const parsed = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    data?: unknown;
    error?: { code?: string };
  };
  return { status: res.status, json: parsed };
}

test("BIN-17.36: PLAYER blokkert med FORBIDDEN", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const r = await req(ctx.baseUrl, "/api/admin/reports/hall-specific", "pl-tok");
    assert.equal(r.json.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-17.36: ADMIN kan lese og får rad per hall", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    {
      halls: [hall("hall-a", "Alpha"), hall("hall-b", "Beta")],
      hallGroups: [group("g1", "North", ["hall-a", "hall-b"])],
    },
  );
  try {
    const r = await req(ctx.baseUrl, "/api/admin/reports/hall-specific", "admin-tok");
    assert.equal(r.status, 200);
    const data = r.json.data as { rows: Array<{ hallId: string }> };
    assert.equal(data.rows.length, 2);
    const ids = data.rows.map((x) => x.hallId).sort();
    assert.deepEqual(ids, ["hall-a", "hall-b"]);
  } finally {
    await ctx.close();
  }
});

test("BIN-17.36: Elvis Replacement-kolonne populeres fra metadata.isReplacement=true", async () => {
  const ctx = await startServer(
    { "admin-tok": adminUser },
    {
      halls: [hall("hall-a", "Alpha")],
      entries: [
        entry({
          hallId: "hall-a",
          eventType: "STAKE",
          amount: 30,
          metadata: { isReplacement: true },
        }),
        entry({
          hallId: "hall-a",
          eventType: "STAKE",
          amount: 20,
          metadata: { isReplacement: true },
        }),
        entry({ hallId: "hall-a", eventType: "STAKE", amount: 100 }),
      ],
    },
  );
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/hall-specific?from=2026-04-01&to=2026-04-30",
      "admin-tok",
    );
    assert.equal(r.status, 200);
    const data = r.json.data as {
      rows: Array<{ elvisReplacementAmount: number }>;
      totals: { elvisReplacementAmount: number };
    };
    assert.equal(data.rows[0]?.elvisReplacementAmount, 50);
    assert.equal(data.totals.elvisReplacementAmount, 50);
  } finally {
    await ctx.close();
  }
});

test("BIN-17.36: HALL_OPERATOR auto-scopet til egen hall (andre hallIds FORBIDDEN)", async () => {
  const ctx = await startServer(
    { "op-tok": operatorA },
    { halls: [hall("hall-a", "Alpha"), hall("hall-b", "Beta")] },
  );
  try {
    // Uten hallIds — forventer kun hall-a.
    const r1 = await req(
      ctx.baseUrl,
      "/api/admin/reports/hall-specific",
      "op-tok",
    );
    assert.equal(r1.status, 200);
    const data1 = r1.json.data as { rows: Array<{ hallId: string }> };
    assert.equal(data1.rows.length, 1);
    assert.equal(data1.rows[0]?.hallId, "hall-a");

    // Med hallIds=hall-b — forventer FORBIDDEN.
    const r2 = await req(
      ctx.baseUrl,
      "/api/admin/reports/hall-specific?hallIds=hall-b",
      "op-tok",
    );
    assert.equal(r2.json.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-17.36: ugyldig vindu → INVALID_INPUT", async () => {
  const ctx = await startServer({ "admin-tok": adminUser });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/admin/reports/hall-specific?from=2026-05-01&to=2026-04-01",
      "admin-tok",
    );
    assert.equal(r.json.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});
