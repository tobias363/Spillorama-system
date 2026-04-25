/**
 * BIN-GAP#4 — integrasjonstester for agentTicketRegistration-router.
 *
 * Dekker:
 *   - GET  /api/agent/ticket-registration/:gameId/initial-ids
 *   - POST /api/agent/ticket-registration/:gameId/final-ids
 *   - GET  /api/agent/ticket-registration/:gameId/summary
 *
 * RBAC + hall-scope + status-koder + audit-log + Game1HallReadyService-hook.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgentTicketRegistrationRouter } from "../agentTicketRegistration.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  TicketRegistrationService,
  GetInitialIdsInput,
  GetInitialIdsResult,
  RecordFinalIdsInput,
  RecordFinalIdsResult,
  GetSummaryResult,
} from "../../agent/TicketRegistrationService.js";
import type { PlatformService, PublicAppUser } from "../../platform/PlatformService.js";
import type { AgentService } from "../../agent/AgentService.js";
import type { AgentShiftService } from "../../agent/AgentShiftService.js";
import type { Game1HallReadyService, HallReadyStatusRow } from "../../game/Game1HallReadyService.js";
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
const operatorA: PublicAppUser = {
  ...adminUser,
  id: "op-a",
  role: "HALL_OPERATOR",
  hallId: "hall-a",
};
const operatorB: PublicAppUser = {
  ...adminUser,
  id: "op-b",
  role: "HALL_OPERATOR",
  hallId: "hall-b",
};
const agentUser: PublicAppUser = {
  ...adminUser,
  id: "agent-1",
  role: "AGENT",
  hallId: null,
};
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

interface Ctx {
  baseUrl: string;
  spies: {
    auditStore: InMemoryAuditLogStore;
    getInitialCalls: GetInitialIdsInput[];
    recordFinalCalls: RecordFinalIdsInput[];
    summaryCalls: Array<{ gameId: string }>;
    markReadyCalls: Array<{ gameId: string; hallId: string; userId: string }>;
  };
  close: () => Promise<void>;
}

interface ServiceBehaviour {
  getInitialResult?: GetInitialIdsResult;
  getInitialFail?: DomainError;
  recordFinalResult?: RecordFinalIdsResult;
  recordFinalFail?: DomainError;
  summaryResult?: GetSummaryResult;
  summaryFail?: DomainError;
  markReadyFail?: DomainError;
  skipHallReadyService?: boolean;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  behaviour: ServiceBehaviour = {},
  opts: { agentShift?: { hallId: string } | null } = {},
): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);

  const getInitialCalls: GetInitialIdsInput[] = [];
  const recordFinalCalls: RecordFinalIdsInput[] = [];
  const summaryCalls: Array<{ gameId: string }> = [];
  const markReadyCalls: Array<{ gameId: string; hallId: string; userId: string }> = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const agentService = {
    async requireActiveAgent() { /* ok */ },
  } as unknown as AgentService;

  const agentShiftService = {
    async getCurrentShift() {
      if (opts.agentShift === null) return null;
      return opts.agentShift ?? { hallId: "hall-a" };
    },
  } as unknown as AgentShiftService;

  const ticketRegistrationService = {
    async getInitialIds(input: GetInitialIdsInput): Promise<GetInitialIdsResult> {
      getInitialCalls.push(input);
      if (behaviour.getInitialFail) throw behaviour.getInitialFail;
      return behaviour.getInitialResult ?? {
        gameId: input.gameId,
        hallId: input.hallId,
        entries: [
          { ticketType: "small_yellow", initialId: 1, roundNumber: 1, carriedFromGameId: null, existingRange: null },
          { ticketType: "small_white", initialId: 1, roundNumber: 1, carriedFromGameId: null, existingRange: null },
          { ticketType: "large_yellow", initialId: 1, roundNumber: 1, carriedFromGameId: null, existingRange: null },
          { ticketType: "large_white", initialId: 1, roundNumber: 1, carriedFromGameId: null, existingRange: null },
          { ticketType: "small_purple", initialId: 1, roundNumber: 1, carriedFromGameId: null, existingRange: null },
          { ticketType: "large_purple", initialId: 1, roundNumber: 1, carriedFromGameId: null, existingRange: null },
        ],
      };
    },
    async recordFinalIds(input: RecordFinalIdsInput): Promise<RecordFinalIdsResult> {
      recordFinalCalls.push(input);
      if (behaviour.recordFinalFail) throw behaviour.recordFinalFail;
      const now = new Date().toISOString();
      const ranges = Object.entries(input.perTypeFinalIds).map(([type, finalId], idx) => ({
        id: `r-${idx}`,
        gameId: input.gameId,
        hallId: input.hallId,
        ticketType: type as never,
        initialId: 1,
        finalId: finalId as number,
        soldCount: (finalId as number),
        roundNumber: 1,
        carriedFromGameId: null,
        recordedByUserId: input.userId,
        recordedAt: now,
        createdAt: now,
        updatedAt: now,
      }));
      return behaviour.recordFinalResult ?? {
        gameId: input.gameId,
        hallId: input.hallId,
        totalSoldCount: ranges.reduce((s, r) => s + r.soldCount, 0),
        ranges,
      };
    },
    async getSummary(input: { gameId: string }): Promise<GetSummaryResult> {
      summaryCalls.push(input);
      if (behaviour.summaryFail) throw behaviour.summaryFail;
      return behaviour.summaryResult ?? {
        gameId: input.gameId,
        ranges: [],
        totalSoldCount: 0,
      };
    },
    validateRange(initial: number, final: number): boolean {
      return Number.isInteger(initial) && Number.isInteger(final) && final >= initial;
    },
  } as unknown as TicketRegistrationService;

  const game1HallReadyService = behaviour.skipHallReadyService
    ? undefined
    : ({
      async markReady(input: { gameId: string; hallId: string; userId: string }): Promise<HallReadyStatusRow> {
        markReadyCalls.push(input);
        if (behaviour.markReadyFail) throw behaviour.markReadyFail;
        return {
          gameId: input.gameId,
          hallId: input.hallId,
          isReady: true,
          readyAt: new Date().toISOString(),
          readyByUserId: input.userId,
          digitalTicketsSold: 0,
          physicalTicketsSold: 0,
          excludedFromGame: false,
          excludedReason: null,
          startTicketId: null,
          startScannedAt: null,
          finalScanTicketId: null,
          finalScannedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      },
    } as unknown as Game1HallReadyService);

  const app = express();
  app.use(express.json());
  app.use(
    createAgentTicketRegistrationRouter({
      platformService,
      agentService,
      agentShiftService,
      auditLogService,
      ticketRegistrationService,
      game1HallReadyService,
    }),
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    spies: { auditStore, getInitialCalls, recordFinalCalls, summaryCalls, markReadyCalls },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
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

// ── RBAC ─────────────────────────────────────────────────────────────────

test("GET initial-ids: PLAYER får 403 FORBIDDEN", async () => {
  const ctx = await startServer({ tok: playerUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/ticket-registration/g-1/initial-ids", "tok");
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("POST final-ids: ingen token → 403 UNAUTHORIZED", async () => {
  const ctx = await startServer({ adm: adminUser });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/ticket-registration/g-1/final-ids",
      undefined,
      { perTypeFinalIds: { small_yellow: 10 }, hallId: "hall-a" },
    );
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "UNAUTHORIZED");
  } finally {
    await ctx.close();
  }
});

// ── GET initial-ids ──────────────────────────────────────────────────────

test("GET initial-ids: HALL_OPERATOR får 6 typer for egen hall", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/ticket-registration/g-1/initial-ids", "op-a-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.data.entries.length, 6);
    assert.equal(ctx.spies.getInitialCalls.length, 1);
    assert.equal(ctx.spies.getInitialCalls[0]!.hallId, "hall-a");
  } finally {
    await ctx.close();
  }
});

test("GET initial-ids: HALL_OPERATOR kan ikke overstyre hallId til annen hall", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA });
  try {
    const res = await req(
      ctx.baseUrl,
      "GET",
      "/api/agent/ticket-registration/g-1/initial-ids?hallId=hall-b",
      "op-a-tok",
    );
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GET initial-ids: ADMIN må spesifisere hallId eksplisitt", async () => {
  const ctx = await startServer({ "adm-tok": adminUser });
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/ticket-registration/g-1/initial-ids", "adm-tok");
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");

    const ok = await req(
      ctx.baseUrl,
      "GET",
      "/api/agent/ticket-registration/g-1/initial-ids?hallId=hall-x",
      "adm-tok",
    );
    assert.equal(ok.status, 200);
    assert.equal(ctx.spies.getInitialCalls[0]!.hallId, "hall-x");
  } finally {
    await ctx.close();
  }
});

test("GET initial-ids: GAME_NOT_FOUND → 404", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA },
    { getInitialFail: new DomainError("GAME_NOT_FOUND", "nope") },
  );
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/ticket-registration/ghost/initial-ids", "op-a-tok");
    assert.equal(res.status, 404);
    assert.equal(res.json.error.code, "GAME_NOT_FOUND");
  } finally {
    await ctx.close();
  }
});

// ── POST final-ids ───────────────────────────────────────────────────────

test("POST final-ids: HALL_OPERATOR happy-path — 200 + audit + markReady", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/ticket-registration/g-1/final-ids",
      "op-a-tok",
      { perTypeFinalIds: { small_yellow: 10, small_white: 20 } },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.json.data.totalSoldCount, 30);
    assert.equal(res.json.data.hallReadyStatus.isReady, true);

    // Service kalt med riktig userId + hallId
    assert.equal(ctx.spies.recordFinalCalls[0]!.hallId, "hall-a");
    assert.equal(ctx.spies.recordFinalCalls[0]!.userId, "op-a");
    // markReady kalt
    assert.equal(ctx.spies.markReadyCalls.length, 1);
    assert.equal(ctx.spies.markReadyCalls[0]!.gameId, "g-1");
    assert.equal(ctx.spies.markReadyCalls[0]!.hallId, "hall-a");

    // Audit skrevet
    const audit = await waitForAudit(ctx.spies.auditStore, "ticket_registration.recorded");
    assert.ok(audit);
    assert.equal(audit!.actorId, "op-a");
    assert.equal((audit!.details as { totalSoldCount: number }).totalSoldCount, 30);
  } finally {
    await ctx.close();
  }
});

test("POST final-ids: FINAL_LESS_THAN_INITIAL → 409", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA },
    {
      recordFinalFail: new DomainError("FINAL_LESS_THAN_INITIAL", "final < initial"),
    },
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/ticket-registration/g-1/final-ids",
      "op-a-tok",
      { perTypeFinalIds: { small_yellow: 5 } },
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "FINAL_LESS_THAN_INITIAL");
  } finally {
    await ctx.close();
  }
});

test("POST final-ids: ugyldig body (ikke objekt) → 400", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/ticket-registration/g-1/final-ids",
      "op-a-tok",
      { perTypeFinalIds: "not-an-object" },
    );
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("POST final-ids: ukjent ticket_type → 409 INVALID_TICKET_TYPE", async () => {
  const ctx = await startServer({ "op-a-tok": operatorA });
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/ticket-registration/g-1/final-ids",
      "op-a-tok",
      { perTypeFinalIds: { bogus_type: 10 } },
    );
    assert.equal(res.status, 409);
    assert.equal(res.json.error.code, "INVALID_TICKET_TYPE");
  } finally {
    await ctx.close();
  }
});

test("POST final-ids: markReady-feil skal ikke velte hovedretur", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA },
    { markReadyFail: new DomainError("GAME_NOT_READY_ELIGIBLE", "wrong status") },
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/ticket-registration/g-1/final-ids",
      "op-a-tok",
      { perTypeFinalIds: { small_yellow: 10 } },
    );
    assert.equal(res.status, 200);
    assert.equal(res.json.data.hallReadyStatus.isReady, false);
    assert.equal(res.json.data.hallReadyStatus.error, "GAME_NOT_READY_ELIGIBLE");
  } finally {
    await ctx.close();
  }
});

test("POST final-ids: AGENT uten aktiv shift → 403 SHIFT_NOT_ACTIVE", async () => {
  const ctx = await startServer(
    { "agent-tok": agentUser },
    {},
    { agentShift: null },
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/ticket-registration/g-1/final-ids",
      "agent-tok",
      { perTypeFinalIds: { small_yellow: 10 } },
    );
    assert.equal(res.status, 403);
    assert.equal(res.json.error.code, "SHIFT_NOT_ACTIVE");
  } finally {
    await ctx.close();
  }
});

test("POST final-ids: AGENT bruker shift.hallId som scope", async () => {
  const ctx = await startServer(
    { "agent-tok": agentUser },
    {},
    { agentShift: { hallId: "hall-z" } },
  );
  try {
    const res = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/ticket-registration/g-1/final-ids",
      "agent-tok",
      { perTypeFinalIds: { small_yellow: 10 } },
    );
    assert.equal(res.status, 200);
    assert.equal(ctx.spies.recordFinalCalls[0]!.hallId, "hall-z");
  } finally {
    await ctx.close();
  }
});

// ── GET summary ──────────────────────────────────────────────────────────

test("GET summary: HALL_OPERATOR får kun egne haller", async () => {
  const ctx = await startServer(
    { "op-a-tok": operatorA },
    {
      summaryResult: {
        gameId: "g-1",
        ranges: [
          // hall-a (tilhører operatorA)
          {
            id: "r1",
            gameId: "g-1",
            hallId: "hall-a",
            ticketType: "small_yellow",
            initialId: 1,
            finalId: 10,
            soldCount: 10,
            roundNumber: 1,
            carriedFromGameId: null,
            recordedByUserId: "op-a",
            recordedAt: null,
            createdAt: "2026-04-24T00:00:00Z",
            updatedAt: "2026-04-24T00:00:00Z",
          },
          // hall-b (skal filtreres bort)
          {
            id: "r2",
            gameId: "g-1",
            hallId: "hall-b",
            ticketType: "small_yellow",
            initialId: 1,
            finalId: 5,
            soldCount: 5,
            roundNumber: 1,
            carriedFromGameId: null,
            recordedByUserId: "op-b",
            recordedAt: null,
            createdAt: "2026-04-24T00:00:00Z",
            updatedAt: "2026-04-24T00:00:00Z",
          },
        ],
        totalSoldCount: 15,
      },
    },
  );
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/ticket-registration/g-1/summary", "op-a-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.ranges.length, 1);
    assert.equal(res.json.data.ranges[0].hallId, "hall-a");
    assert.equal(res.json.data.totalSoldCount, 10);
  } finally {
    await ctx.close();
  }
});

test("GET summary: ADMIN ser alle haller", async () => {
  const ctx = await startServer(
    { "adm-tok": adminUser },
    {
      summaryResult: {
        gameId: "g-1",
        ranges: [
          {
            id: "r1",
            gameId: "g-1",
            hallId: "hall-a",
            ticketType: "small_yellow",
            initialId: 1,
            finalId: 10,
            soldCount: 10,
            roundNumber: 1,
            carriedFromGameId: null,
            recordedByUserId: "op-a",
            recordedAt: null,
            createdAt: "2026-04-24T00:00:00Z",
            updatedAt: "2026-04-24T00:00:00Z",
          },
          {
            id: "r2",
            gameId: "g-1",
            hallId: "hall-b",
            ticketType: "small_yellow",
            initialId: 1,
            finalId: 5,
            soldCount: 5,
            roundNumber: 1,
            carriedFromGameId: null,
            recordedByUserId: "op-b",
            recordedAt: null,
            createdAt: "2026-04-24T00:00:00Z",
            updatedAt: "2026-04-24T00:00:00Z",
          },
        ],
        totalSoldCount: 15,
      },
    },
  );
  try {
    const res = await req(ctx.baseUrl, "GET", "/api/agent/ticket-registration/g-1/summary", "adm-tok");
    assert.equal(res.status, 200);
    assert.equal(res.json.data.ranges.length, 2);
    assert.equal(res.json.data.totalSoldCount, 15);
  } finally {
    await ctx.close();
  }
});
