/**
 * BIN-17.32: integrasjonstester for /api/agent/reports/past-winning-history.
 *
 * Dekker:
 *   - AGENT må ha aktiv shift; fail-closed uten shift (SHIFT_NOT_ACTIVE).
 *   - AGENT kan ikke overstyre hallId til annen hall (FORBIDDEN).
 *   - HALL_OPERATOR auto-scope til user.hallId.
 *   - ADMIN kan se alle haller og filtrere på hallId.
 *   - Response-shape: rows + total + from/to + limit/offset.
 *   - Ugyldig vindu → INVALID_INPUT.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgentReportsPastWinningRouter } from "../agentReportsPastWinning.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import type { AgentService } from "../../agent/AgentService.js";
import type { AgentShiftService } from "../../agent/AgentShiftService.js";
import type { StaticTicketService } from "../../compliance/StaticTicketService.js";
import type { StaticTicket } from "../../compliance/StaticTicketService.js";
import { DomainError } from "../../game/BingoEngine.js";

const baseUser: PublicAppUser = {
  id: "u-1",
  email: "x@x.no",
  displayName: "X",
  walletId: "w",
  role: "AGENT",
  hallId: null,
  kycStatus: "VERIFIED",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  balance: 0,
};
const agentUser: PublicAppUser = { ...baseUser, id: "ag-1", role: "AGENT" };
const hallOperator: PublicAppUser = {
  ...baseUser,
  id: "op-1",
  role: "HALL_OPERATOR",
  hallId: "hall-a",
};
const adminUser: PublicAppUser = { ...baseUser, id: "adm-1", role: "ADMIN" };
const playerUser: PublicAppUser = { ...baseUser, id: "pl-1", role: "PLAYER" };

function ticket(overrides: Partial<StaticTicket> = {}): StaticTicket {
  return {
    id: overrides.id ?? "t-1",
    hallId: overrides.hallId ?? "hall-a",
    ticketSerial: overrides.ticketSerial ?? "01-1001",
    ticketColor: overrides.ticketColor ?? "small",
    ticketType: overrides.ticketType ?? "small_yellow",
    cardMatrix: Array.from({ length: 25 }, (_, i) => i + 1),
    isPurchased: true,
    purchasedAt: "2026-04-01T10:00:00.000Z",
    importedAt: "2026-03-01T00:00:00.000Z",
    soldByUserId: "ag-1",
    soldFromRangeId: "r-1",
    responsibleUserId: "ag-1",
    soldToScheduledGameId: null,
    reservedByRangeId: null,
    paidOutAt: overrides.paidOutAt ?? "2026-04-10T18:30:00.000Z",
    paidOutAmountCents: overrides.paidOutAmountCents ?? 200_00,
    paidOutByUserId: overrides.paidOutByUserId ?? "ag-1",
  };
}

interface Ctx {
  baseUrl: string;
  spy: { listCalls: unknown[] };
  close: () => Promise<void>;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  opts?: {
    /** Shift for current AGENT user. Default: null (no active shift). */
    shift?: { id: string; hallId: string } | null;
    tickets?: StaticTicket[];
  },
): Promise<Ctx> {
  const spy: Ctx["spy"] = { listCalls: [] };

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad");
      return u;
    },
  } as unknown as PlatformService;

  const agentService = {
    async requireActiveAgent() {
      // Mock: all agents are active for the tests.
      return undefined;
    },
  } as unknown as AgentService;

  const agentShiftService = {
    async getCurrentShift() {
      return opts?.shift ?? null;
    },
  } as unknown as AgentShiftService;

  const staticTicketService = {
    async listPaidOutInRange(input: unknown) {
      spy.listCalls.push(input);
      return opts?.tickets ?? [];
    },
  } as unknown as StaticTicketService;

  const app = express();
  app.use(express.json());
  app.use(
    createAgentReportsPastWinningRouter({
      platformService,
      agentService,
      agentShiftService,
      staticTicketService,
    }),
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spy,
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

test("BIN-17.32: PLAYER blokkert", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/agent/reports/past-winning-history",
      "pl-tok",
    );
    assert.equal(r.json.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-17.32: AGENT uten aktiv shift → SHIFT_NOT_ACTIVE", async () => {
  const ctx = await startServer({ "ag-tok": agentUser }, { shift: null });
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/agent/reports/past-winning-history",
      "ag-tok",
    );
    assert.equal(r.json.error?.code, "SHIFT_NOT_ACTIVE");
  } finally {
    await ctx.close();
  }
});

test("BIN-17.32: AGENT med shift får rows scopet til egen hall", async () => {
  const ctx = await startServer(
    { "ag-tok": agentUser },
    {
      shift: { id: "s-1", hallId: "hall-a" },
      tickets: [
        ticket({ ticketSerial: "01-1001", paidOutAt: "2026-04-10T12:00:00.000Z" }),
        ticket({ ticketSerial: "01-1002", paidOutAt: "2026-04-12T12:00:00.000Z" }),
      ],
    },
  );
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/agent/reports/past-winning-history?from=2026-04-01&to=2026-04-30",
      "ag-tok",
    );
    assert.equal(r.status, 200);
    const data = r.json.data as {
      rows: Array<{ ticketId: string; ticketType: string; priceCents: number | null }>;
      hallId: string | null;
      total: number;
    };
    assert.equal(data.rows.length, 2);
    assert.equal(data.hallId, "hall-a");
    // Sortert descending på dateTime.
    assert.equal(data.rows[0]?.ticketId, "01-1002");
    // Service ble kalt med hall-scoped filter.
    const call = ctx.spy.listCalls[0] as { hallId?: string };
    assert.equal(call?.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("BIN-17.32: AGENT kan ikke overstyre hallId til annen hall", async () => {
  const ctx = await startServer(
    { "ag-tok": agentUser },
    { shift: { id: "s-1", hallId: "hall-a" } },
  );
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/agent/reports/past-winning-history?hallId=hall-b",
      "ag-tok",
    );
    assert.equal(r.json.error?.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("BIN-17.32: HALL_OPERATOR auto-scope til user.hallId", async () => {
  const ctx = await startServer(
    { "op-tok": hallOperator },
    { tickets: [ticket({ ticketSerial: "01-1001" })] },
  );
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/agent/reports/past-winning-history",
      "op-tok",
    );
    assert.equal(r.status, 200);
    const data = r.json.data as { hallId: string | null };
    assert.equal(data.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("BIN-17.32: ADMIN kan spesifisere hallId eller se alle haller", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    {
      tickets: [
        ticket({ hallId: "hall-a", ticketSerial: "01-1001" }),
        ticket({ hallId: "hall-b", ticketSerial: "02-2002" }),
      ],
    },
  );
  try {
    // Uten hallId → globalt scope. Vinduet må eksplisitt dekke ticket-datoen.
    const r1 = await req(
      ctx.baseUrl,
      "/api/agent/reports/past-winning-history?from=2026-04-01&to=2026-04-30",
      "adm-tok",
    );
    assert.equal(r1.status, 200);
    const data1 = r1.json.data as { hallId: string | null; rows: unknown[] };
    assert.equal(data1.hallId, null);
    assert.equal(data1.rows.length, 2);

    // Med hallId → scoped.
    const r2 = await req(
      ctx.baseUrl,
      "/api/agent/reports/past-winning-history?from=2026-04-01&to=2026-04-30&hallId=hall-a",
      "adm-tok",
    );
    assert.equal(r2.status, 200);
    const data2 = r2.json.data as { hallId: string | null };
    assert.equal(data2.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("BIN-17.32: ugyldig vindu → INVALID_INPUT", async () => {
  const ctx = await startServer(
    { "ag-tok": agentUser },
    { shift: { id: "s-1", hallId: "hall-a" } },
  );
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/agent/reports/past-winning-history?from=2026-05-01&to=2026-04-01",
      "ag-tok",
    );
    assert.equal(r.json.error?.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("BIN-17.32: paginering med offset+limit", async () => {
  const many = Array.from({ length: 10 }, (_, i) =>
    ticket({
      ticketSerial: `T-${i.toString().padStart(2, "0")}`,
      paidOutAt: `2026-04-${(i + 1).toString().padStart(2, "0")}T12:00:00.000Z`,
    })
  );
  const ctx = await startServer(
    { "adm-tok": adminUser },
    { tickets: many },
  );
  try {
    const r = await req(
      ctx.baseUrl,
      "/api/agent/reports/past-winning-history?from=2026-04-01&to=2026-04-30&offset=5&limit=3",
      "adm-tok",
    );
    assert.equal(r.status, 200);
    const data = r.json.data as {
      rows: unknown[];
      total: number;
      offset: number;
      limit: number;
    };
    assert.equal(data.total, 10);
    assert.equal(data.offset, 5);
    assert.equal(data.limit, 3);
    assert.equal(data.rows.length, 3);
  } finally {
    await ctx.close();
  }
});
