/**
 * R1 (BIN-822, 2026-05-08): test for lobby-broadcast wireup i
 * agentGamePlan-router.
 *
 * Verifiserer at `lobbyBroadcaster.broadcastForHall(hallId)` kalles etter
 * vellykket master-handling (start/advance/pause/resume/jackpot-setup).
 * Bruker en in-memory fake-broadcaster som tracker calls — ingen
 * Socket.IO wiring kreves for denne testen.
 *
 * Begrenset scope: testen verifiserer at WIREUP er korrekt — den faktiske
 * broadcast-kjeden (broadcaster → Game1LobbyService → io.emit) testes via
 * Game1LobbyService.test.ts og spill1Lobby.test.ts som allerede er grønne.
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgentGamePlanRouter } from "../agentGamePlan.js";
import type { GamePlanRunService } from "../../game/GamePlanRunService.js";
import type { GamePlanService } from "../../game/GamePlanService.js";
import type {
  AdvanceToNextResult,
  GamePlan,
  GamePlanRun,
  GamePlanWithItems,
} from "../../game/gamePlan.types.js";
import type { GameCatalogEntry } from "../../game/gameCatalog.types.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../errors/DomainError.js";

// ── Test users ──────────────────────────────────────────────────────────

const masterAgent: PublicAppUser = {
  id: "agent-master",
  email: "m@test.no",
  displayName: "Master",
  walletId: "w-m",
  role: "AGENT",
  hallId: "hall-master",
  kycStatus: "VERIFIED",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  balance: 0,
};

// ── Fixtures ────────────────────────────────────────────────────────────

const todayStr = (() => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  let y = "";
  let m = "";
  let d = "";
  for (const p of parts) {
    if (p.type === "year") y = p.value;
    else if (p.type === "month") m = p.value;
    else if (p.type === "day") d = p.value;
  }
  return `${y}-${m}-${d}`;
})();

function makeCatalog(): GameCatalogEntry {
  return {
    id: "cat-1",
    slug: "bingo",
    displayName: "Bingo",
    description: null,
    rules: {},
    ticketColors: ["gul", "hvit"],
    ticketPricesCents: { gul: 1000, hvit: 1500 },
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 200000, hvit: 250000 },
    },
    prizeMultiplierMode: "explicit_per_color",
    bonusGameSlug: null,
    bonusGameEnabled: false,
    requiresJackpotSetup: false,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-05-07T00:00:00Z",
    updatedAt: "2026-05-07T00:00:00Z",
    createdByUserId: "admin-1",
  };
}

function makePlan(): GamePlanWithItems {
  return {
    id: "plan-1",
    name: "Pilot-plan",
    description: null,
    hallId: "hall-master",
    groupOfHallsId: null,
    weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    startTime: "11:00",
    endTime: "23:00",
    isActive: true,
    createdAt: "2026-05-07T00:00:00Z",
    updatedAt: "2026-05-07T00:00:00Z",
    createdByUserId: "admin-1",
    items: [
      {
        id: "item-1",
        planId: "plan-1",
        position: 1,
        gameCatalogId: "cat-1",
        catalogEntry: makeCatalog(),
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
      },
      {
        id: "item-2",
        planId: "plan-1",
        position: 2,
        gameCatalogId: "cat-1",
        catalogEntry: makeCatalog(),
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
      },
    ],
  };
}

function makeRun(overrides: Partial<GamePlanRun> = {}): GamePlanRun {
  return {
    id: overrides.id ?? "run-1",
    planId: "plan-1",
    hallId: "hall-master",
    businessDate: todayStr,
    currentPosition: overrides.currentPosition ?? 1,
    status: overrides.status ?? "idle",
    jackpotOverrides: overrides.jackpotOverrides ?? {},
    startedAt: overrides.startedAt ?? null,
    finishedAt: null,
    masterUserId: null,
    createdAt: "2026-05-07T00:00:00Z",
    updatedAt: "2026-05-07T00:00:00Z",
  };
}

// ── Test harness ────────────────────────────────────────────────────────

interface Ctx {
  baseUrl: string;
  broadcastCalls: string[];
  setRunStatus: (status: GamePlanRun["status"]) => void;
  close: () => Promise<void>;
}

async function startServer(): Promise<Ctx> {
  let run: GamePlanRun = makeRun();
  const plan = makePlan();
  const broadcastCalls: string[] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      if (token === "master-tok") return masterAgent;
      throw new DomainError("UNAUTHORIZED", "bad token");
    },
  } as unknown as PlatformService;

  const planService = {
    async getById(id: string) {
      return id === "plan-1" ? plan : null;
    },
  } as unknown as GamePlanService;

  const planRunService = {
    async findForDay(): Promise<GamePlanRun> {
      return run;
    },
    async getOrCreateForToday(): Promise<GamePlanRun> {
      return run;
    },
    async start(): Promise<GamePlanRun> {
      run = { ...run, status: "running", startedAt: new Date().toISOString() };
      return run;
    },
    async pause(): Promise<GamePlanRun> {
      run = { ...run, status: "paused" };
      return run;
    },
    async resume(): Promise<GamePlanRun> {
      run = { ...run, status: "running" };
      return run;
    },
    async advanceToNext(): Promise<AdvanceToNextResult> {
      run = { ...run, currentPosition: 2 };
      return {
        run,
        nextGame: plan.items[1].catalogEntry,
        jackpotSetupRequired: false,
      };
    },
    async setJackpotOverride(): Promise<GamePlanRun> {
      run = {
        ...run,
        jackpotOverrides: {
          ...run.jackpotOverrides,
          "1": { draw: 50, prizesCents: { gul: 50000 } },
        },
      };
      return run;
    },
  } as unknown as GamePlanRunService;

  // Fake broadcaster — records every broadcastForHall(hallId) call.
  const lobbyBroadcaster = {
    async broadcastForHall(hallId: string): Promise<void> {
      broadcastCalls.push(hallId);
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    createAgentGamePlanRouter({
      platformService,
      planRunService,
      planService,
      lobbyBroadcaster,
    }),
  );
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    broadcastCalls,
    setRunStatus: (status) => {
      run = { ...run, status };
    },
    close: () => new Promise((r) => server.close(() => r())),
  };
}

async function post(
  baseUrl: string,
  path: string,
  token: string,
  body?: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ── Tests ───────────────────────────────────────────────────────────────

test("R1: POST /start broadcaster lobby-state for run.hallId", async () => {
  const ctx = await startServer();
  try {
    const r = await post(ctx.baseUrl, "/api/agent/game-plan/start", "master-tok");
    assert.equal(r.status, 200);
    // Broadcaster fires fire-and-forget — gi micro-task tid.
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(ctx.broadcastCalls, ["hall-master"]);
  } finally {
    await ctx.close();
  }
});

test("R1: POST /pause broadcaster lobby-state", async () => {
  const ctx = await startServer();
  try {
    ctx.setRunStatus("running");
    const r = await post(ctx.baseUrl, "/api/agent/game-plan/pause", "master-tok");
    assert.equal(r.status, 200);
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(ctx.broadcastCalls, ["hall-master"]);
  } finally {
    await ctx.close();
  }
});

test("R1: POST /resume broadcaster lobby-state", async () => {
  const ctx = await startServer();
  try {
    ctx.setRunStatus("paused");
    const r = await post(ctx.baseUrl, "/api/agent/game-plan/resume", "master-tok");
    assert.equal(r.status, 200);
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(ctx.broadcastCalls, ["hall-master"]);
  } finally {
    await ctx.close();
  }
});

test("R1: POST /advance broadcaster lobby-state", async () => {
  const ctx = await startServer();
  try {
    ctx.setRunStatus("running");
    const r = await post(ctx.baseUrl, "/api/agent/game-plan/advance", "master-tok");
    assert.equal(r.status, 200);
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(ctx.broadcastCalls, ["hall-master"]);
  } finally {
    await ctx.close();
  }
});

test("R1: POST /jackpot-setup broadcaster lobby-state", async () => {
  const ctx = await startServer();
  try {
    ctx.setRunStatus("running");
    const r = await post(
      ctx.baseUrl,
      "/api/agent/game-plan/jackpot-setup",
      "master-tok",
      {
        position: 1,
        draw: 50,
        prizesCents: { gul: 50000 },
      },
    );
    assert.equal(r.status, 200);
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(ctx.broadcastCalls, ["hall-master"]);
  } finally {
    await ctx.close();
  }
});

test("R1: når lobbyBroadcaster ikke er injisert, ingen feil skjer", async () => {
  // Bygg en server uten lobbyBroadcaster — endepunktene må fortsatt fungere
  // (broadcasten er valgfri).
  let run: GamePlanRun = makeRun();
  const plan = makePlan();
  const platformService = {
    async getUserFromAccessToken() {
      return masterAgent;
    },
  } as unknown as PlatformService;
  const planService = {
    async getById() {
      return plan;
    },
  } as unknown as GamePlanService;
  const planRunService = {
    async findForDay() {
      return run;
    },
    async getOrCreateForToday() {
      return run;
    },
    async start(): Promise<GamePlanRun> {
      run = { ...run, status: "running" };
      return run;
    },
  } as unknown as GamePlanRunService;

  const app = express();
  app.use(express.json());
  app.use(
    createAgentGamePlanRouter({
      platformService,
      planRunService,
      planService,
      // lobbyBroadcaster er ikke satt
    }),
  );
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/agent/game-plan/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer x",
      },
    });
    assert.equal(res.status, 200);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
