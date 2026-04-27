/**
 * REQ-101/146: integrasjonstester for agent manuell mini-game-trigger.
 *
 * Tester:
 *   1) Happy-path: AGENT med aktiv shift trigger mystery på spiller i
 *      egen hall — orchestrator.maybeTriggerFor kalles, audit-event
 *      skrives, response inkluderer resultId.
 *   2) Wrong-hall: AGENT i hall-A prøver å trigge mini-game for
 *      scheduled_game der master + alle deltakere er andre haller →
 *      FORBIDDEN.
 *   3) RBAC: PLAYER får FORBIDDEN; AGENT uten aktiv shift får
 *      NO_ACTIVE_SHIFT.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Pool, QueryResult, QueryResultRow } from "pg";
import { createAgentGame1MiniGameRouter } from "../agentGame1MiniGame.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
  type PersistedAuditEvent,
} from "../../compliance/AuditLogService.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import type { AgentService } from "../../agent/AgentService.js";
import type { AgentShiftService } from "../../agent/AgentShiftService.js";
import type {
  Game1MiniGameOrchestrator,
  MaybeTriggerInput,
  MaybeTriggerResult,
} from "../../game/minigames/Game1MiniGameOrchestrator.js";
import { DomainError } from "../../game/BingoEngine.js";

interface ScheduledRow {
  id: string;
  master_hall_id: string;
  participating_halls_json: string[];
  game_config_json: Record<string, unknown>;
  status: string;
}
interface UserRow {
  id: string;
  wallet_id: string;
  hall_id: string | null;
}

interface Ctx {
  baseUrl: string;
  auditStore: InMemoryAuditLogStore;
  triggerCalls: MaybeTriggerInput[];
  scheduledGames: Map<string, ScheduledRow>;
  usersByPid: Map<string, UserRow>;
  close: () => Promise<void>;
}

async function startServer(opts: {
  users: Record<string, PublicAppUser>;
  scheduledGames: ScheduledRow[];
  players: UserRow[];
  agentShifts?: Record<string, { hallId: string } | null>;
  triggerResultFactory?: (input: MaybeTriggerInput) => MaybeTriggerResult;
}): Promise<Ctx> {
  const auditStore = new InMemoryAuditLogStore();
  const auditLogService = new AuditLogService(auditStore);
  const triggerCalls: MaybeTriggerInput[] = [];
  const scheduledGames = new Map<string, ScheduledRow>();
  for (const sg of opts.scheduledGames) scheduledGames.set(sg.id, sg);
  const usersByPid = new Map<string, UserRow>();
  for (const u of opts.players) usersByPid.set(u.id, u);

  // Stub Pool: håndterer kun de SQL-spørringene routeren kjører.
  const pool: Pool = {
    async query<R extends QueryResultRow = QueryResultRow>(
      sql: string,
      params?: unknown[]
    ): Promise<QueryResult<R>> {
      // Match på SELECT … FROM "<schema>"."app_game1_scheduled_games"
      if (/app_game1_scheduled_games/.test(sql)) {
        const id = String(params?.[0] ?? "");
        const sg = scheduledGames.get(id);
        if (!sg) {
          return {
            rows: [] as R[],
            rowCount: 0,
            command: "SELECT",
            oid: 0,
            fields: [],
          };
        }
        return {
          rows: [
            {
              id: sg.id,
              master_hall_id: sg.master_hall_id,
              // Routeren godtar både string og array — vi sender array her.
              participating_halls_json: sg.participating_halls_json,
              game_config_json: sg.game_config_json,
              status: sg.status,
            } as unknown as R,
          ],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: [],
        };
      }
      if (/app_users/.test(sql)) {
        const id = String(params?.[0] ?? "");
        const u = usersByPid.get(id);
        if (!u) {
          return {
            rows: [] as R[],
            rowCount: 0,
            command: "SELECT",
            oid: 0,
            fields: [],
          };
        }
        return {
          rows: [u as unknown as R],
          rowCount: 1,
          command: "SELECT",
          oid: 0,
          fields: [],
        };
      }
      throw new Error(`Unhandled SQL in test stub: ${sql}`);
    },
  } as unknown as Pool;

  const platformService = {
    async getUserFromAccessToken(token: string): Promise<PublicAppUser> {
      const u = opts.users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const agentService = {
    async requireActiveAgent(_userId: string): Promise<void> {
      // Stub: alle godkjent.
    },
  } as unknown as AgentService;

  const agentShiftService = {
    async getCurrentShift(userId: string) {
      const shift = opts.agentShifts?.[userId];
      if (!shift) return null;
      return {
        id: `shift-${userId}`,
        hallId: shift.hallId,
        userId,
        startedAt: new Date().toISOString(),
        endedAt: null,
        status: "ACTIVE",
      };
    },
  } as unknown as AgentShiftService;

  const triggerResultFactory =
    opts.triggerResultFactory ??
    ((input: MaybeTriggerInput): MaybeTriggerResult => ({
      triggered: true,
      resultId: `mgr-stub-${input.scheduledGameId}-${input.winnerUserId}`,
      miniGameType: "mystery",
    }));

  const miniGameOrchestrator = {
    async maybeTriggerFor(input: MaybeTriggerInput): Promise<MaybeTriggerResult> {
      triggerCalls.push(input);
      return triggerResultFactory(input);
    },
  } as unknown as Game1MiniGameOrchestrator;

  const app = express();
  app.use(express.json());
  app.use(
    createAgentGame1MiniGameRouter({
      platformService,
      agentService,
      agentShiftService,
      miniGameOrchestrator,
      auditLogService,
      pool,
    })
  );
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    auditStore,
    triggerCalls,
    scheduledGames,
    usersByPid,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function req(baseUrl: string, method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; json: any }> {
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
  action: string
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
const agentUser: PublicAppUser = {
  ...adminUser,
  id: "agent-1",
  role: "AGENT",
  hallId: null, // AGENT henter hall via shift, ikke user.hallId
};
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

// ── Tests ─────────────────────────────────────────────────────────────────

test("REQ-101/146: AGENT med aktiv shift kan trigge mystery for spiller i egen hall", async () => {
  const ctx = await startServer({
    users: { "agent-tok": agentUser },
    scheduledGames: [
      {
        id: "sg-1",
        master_hall_id: "hall-a",
        participating_halls_json: ["hall-a", "hall-b"],
        game_config_json: { spill1: { miniGames: ["wheel"] } },
        status: "running",
      },
    ],
    players: [{ id: "p-1", wallet_id: "w-p1", hall_id: "hall-a" }],
    agentShifts: { "agent-1": { hallId: "hall-a" } },
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/game1/mini-game/trigger", "agent-tok", {
      scheduledGameId: "sg-1",
      playerId: "p-1",
      miniGameType: "mystery",
    });
    assert.equal(res.status, 200, `body: ${JSON.stringify(res.json)}`);
    assert.equal(res.json.data.triggered, true);
    assert.equal(res.json.data.miniGameType, "mystery");
    assert.equal(res.json.data.requestedMiniGameType, "mystery");
    assert.ok(res.json.data.resultId);

    // Orchestrator ble kalt med riktig forced config + winner-data
    assert.equal(ctx.triggerCalls.length, 1);
    const call = ctx.triggerCalls[0]!;
    assert.equal(call.scheduledGameId, "sg-1");
    assert.equal(call.winnerUserId, "p-1");
    assert.equal(call.winnerWalletId, "w-p1");
    assert.equal(call.hallId, "hall-a");
    assert.deepEqual(call.gameConfigJson, { spill1: { miniGames: ["mystery"] } });

    // Audit-event skrevet
    const event = await waitForAudit(ctx.auditStore, "agent.minigame.manual_trigger");
    assert.ok(event, "forventet audit-event agent.minigame.manual_trigger");
    assert.equal(event!.actorId, "agent-1");
    assert.equal(event!.actorType, "AGENT");
    assert.equal(event!.resource, "scheduled_game");
    assert.equal(event!.resourceId, "sg-1");
    assert.equal(event!.details.requestedMiniGameType, "mystery");
    assert.equal(event!.details.actualMiniGameType, "mystery");
    assert.equal(event!.details.triggered, true);
    assert.equal(event!.details.actorRole, "AGENT");
  } finally {
    await ctx.close();
  }
});

test("REQ-101/146: AGENT i annen hall enn scheduled_game får FORBIDDEN", async () => {
  const ctx = await startServer({
    users: { "agent-tok": agentUser },
    scheduledGames: [
      {
        id: "sg-1",
        master_hall_id: "hall-x",
        participating_halls_json: ["hall-x", "hall-y"],
        game_config_json: { spill1: { miniGames: ["wheel"] } },
        status: "running",
      },
    ],
    players: [{ id: "p-1", wallet_id: "w-p1", hall_id: "hall-x" }],
    // AGENT er på hall-a, men spillet er for hall-x/y
    agentShifts: { "agent-1": { hallId: "hall-a" } },
  });
  try {
    const res = await req(ctx.baseUrl, "POST", "/api/agent/game1/mini-game/trigger", "agent-tok", {
      scheduledGameId: "sg-1",
      playerId: "p-1",
      miniGameType: "mystery",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
    assert.match(res.json.error.message, /ikke for din hall/i);
    // Orchestrator ble IKKE kalt
    assert.equal(ctx.triggerCalls.length, 0);
  } finally {
    await ctx.close();
  }
});

test("REQ-101/146: PLAYER får FORBIDDEN; AGENT uten aktiv shift får NO_ACTIVE_SHIFT", async () => {
  // Player får FORBIDDEN
  const ctxPlayer = await startServer({
    users: { "pl-tok": playerUser },
    scheduledGames: [
      {
        id: "sg-1",
        master_hall_id: "hall-a",
        participating_halls_json: ["hall-a"],
        game_config_json: {},
        status: "running",
      },
    ],
    players: [{ id: "p-1", wallet_id: "w-p1", hall_id: "hall-a" }],
  });
  try {
    const res = await req(ctxPlayer.baseUrl, "POST", "/api/agent/game1/mini-game/trigger", "pl-tok", {
      scheduledGameId: "sg-1",
      playerId: "p-1",
      miniGameType: "mystery",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "FORBIDDEN");
    assert.equal(ctxPlayer.triggerCalls.length, 0);
  } finally {
    await ctxPlayer.close();
  }

  // Agent uten aktiv shift
  const ctxAgent = await startServer({
    users: { "agent-tok": agentUser },
    scheduledGames: [
      {
        id: "sg-1",
        master_hall_id: "hall-a",
        participating_halls_json: ["hall-a"],
        game_config_json: {},
        status: "running",
      },
    ],
    players: [{ id: "p-1", wallet_id: "w-p1", hall_id: "hall-a" }],
    agentShifts: {}, // ingen aktiv shift
  });
  try {
    const res = await req(ctxAgent.baseUrl, "POST", "/api/agent/game1/mini-game/trigger", "agent-tok", {
      scheduledGameId: "sg-1",
      playerId: "p-1",
      miniGameType: "mystery",
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, "NO_ACTIVE_SHIFT");
    assert.equal(ctxAgent.triggerCalls.length, 0);
  } finally {
    await ctxAgent.close();
  }
});
