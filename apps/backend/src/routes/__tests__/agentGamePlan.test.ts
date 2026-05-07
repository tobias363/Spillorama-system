/**
 * Fase 3 (2026-05-07): integrasjonstester for agent-game-plan-router.
 *
 * Dekker alle 6 endepunkter:
 *   GET  /api/agent/game-plan/current
 *   POST /api/agent/game-plan/start
 *   POST /api/agent/game-plan/advance
 *   POST /api/agent/game-plan/jackpot-setup
 *   POST /api/agent/game-plan/pause
 *   POST /api/agent/game-plan/resume
 *
 * Use case-er:
 *   - Master-agent (plan.hallId === actor.hallId) kan starte/advance/setup
 *   - Slave-agent (egen hall, men ikke master) får 403 på write-ruter
 *   - PLAYER blokkert overalt
 *   - jackpotSetupRequired-flagg returneres når currentItem krever popup
 *   - advance returnerer { jackpotSetupRequired: true } uten å flytte run
 *     når NESTE item krever popup og override mangler
 *   - jackpot-setup-validering avviser ugyldige farger / negative beløp
 *   - Kompletteringsflyt: start → setup → advance → advance → finish
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
  JackpotOverride,
} from "../../game/gamePlan.types.js";
import type { GameCatalogEntry } from "../../game/gameCatalog.types.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import { DomainError } from "../../errors/DomainError.js";

// ── Test users ──────────────────────────────────────────────────────────

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
const masterAgent: PublicAppUser = {
  ...adminUser,
  id: "agent-master",
  role: "AGENT",
  hallId: "hall-master",
};
const slaveAgent: PublicAppUser = {
  ...adminUser,
  id: "agent-slave",
  role: "AGENT",
  hallId: "hall-slave",
};
const playerUser: PublicAppUser = { ...adminUser, id: "pl-1", role: "PLAYER" };

// ── Test fixtures ───────────────────────────────────────────────────────

const today = new Date();
const todayStr = (() => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(today);
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

function makeCatalog(
  id: string,
  opts: { requiresJackpotSetup?: boolean; ticketColors?: string[] } = {},
): GameCatalogEntry {
  return {
    id,
    slug: `slug-${id}`,
    displayName: `Spill ${id}`,
    description: null,
    rules: {},
    ticketColors: (opts.ticketColors ?? ["gul", "hvit"]) as GameCatalogEntry["ticketColors"],
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
    requiresJackpotSetup: opts.requiresJackpotSetup ?? false,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-05-07T00:00:00Z",
    updatedAt: "2026-05-07T00:00:00Z",
    createdByUserId: "admin-1",
  };
}

function makePlan(overrides: Partial<GamePlan> & { id: string; hallId: string | null }): GamePlan {
  return {
    id: overrides.id,
    name: overrides.name ?? "Plan",
    description: overrides.description ?? null,
    hallId: overrides.hallId,
    groupOfHallsId: overrides.groupOfHallsId ?? null,
    weekdays: overrides.weekdays ?? ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    startTime: overrides.startTime ?? "11:00",
    endTime: overrides.endTime ?? "23:00",
    isActive: overrides.isActive ?? true,
    createdAt: "2026-05-07T00:00:00Z",
    updatedAt: "2026-05-07T00:00:00Z",
    createdByUserId: "admin-1",
  };
}

function makeRun(overrides: Partial<GamePlanRun> & { id: string; planId: string; hallId: string }): GamePlanRun {
  return {
    id: overrides.id,
    planId: overrides.planId,
    hallId: overrides.hallId,
    businessDate: overrides.businessDate ?? todayStr,
    currentPosition: overrides.currentPosition ?? 1,
    status: overrides.status ?? "idle",
    jackpotOverrides: overrides.jackpotOverrides ?? {},
    startedAt: overrides.startedAt ?? null,
    finishedAt: overrides.finishedAt ?? null,
    masterUserId: overrides.masterUserId ?? null,
    createdAt: "2026-05-07T00:00:00Z",
    updatedAt: "2026-05-07T00:00:00Z",
  };
}

// ── In-memory fakes ─────────────────────────────────────────────────────

interface Ctx {
  baseUrl: string;
  runs: Map<string, GamePlanRun>;
  plans: Map<string, GamePlanWithItems>;
  close: () => Promise<void>;
  /** Fase 4: spawn-tracking når bridge er injisert. */
  bridgeSpawns: Array<{ runId: string; position: number; result: unknown }>;
}

interface BridgeStubOptions {
  /** Hvis satt, returner denne ved create. Default: ny UUID-streng. */
  scheduledGameId?: string;
  /** Throw denne error-en på create. */
  throwError?: Error | DomainError;
  /** Eksisterende rad — returnerer reused=true. */
  reuseExisting?: boolean;
}

async function startServer(
  users: Record<string, PublicAppUser>,
  initialPlans: GamePlanWithItems[] = [],
  initialRuns: GamePlanRun[] = [],
  bridgeOptions?: BridgeStubOptions | null,
): Promise<Ctx> {
  const plans = new Map<string, GamePlanWithItems>();
  for (const p of initialPlans) plans.set(p.id, p);
  const runs = new Map<string, GamePlanRun>();
  for (const r of initialRuns) {
    runs.set(`${r.hallId}|${r.businessDate}`, r);
  }

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
  } as unknown as PlatformService;

  const planService = {
    async getById(id: string): Promise<GamePlanWithItems | null> {
      return plans.get(id) ?? null;
    },
  } as unknown as GamePlanService;

  const planRunService = {
    async findForDay(hallId: string, businessDate: Date | string) {
      const dateStr = typeof businessDate === "string"
        ? businessDate.slice(0, 10)
        : businessDate.toISOString().slice(0, 10);
      return runs.get(`${hallId}|${dateStr}`) ?? null;
    },
    async getOrCreateForToday(hallId: string, businessDate: Date | string): Promise<GamePlanRun> {
      const dateStr = typeof businessDate === "string"
        ? businessDate.slice(0, 10)
        : businessDate.toISOString().slice(0, 10);
      const key = `${hallId}|${dateStr}`;
      const existing = runs.get(key);
      if (existing) return existing;
      // Finn første aktive plan for hallen.
      const plan = [...plans.values()].find((p) => p.hallId === hallId && p.isActive);
      if (!plan) {
        throw new DomainError(
          "NO_MATCHING_PLAN",
          `Ingen aktiv plan dekker (hall=${hallId}).`,
        );
      }
      const created = makeRun({
        id: `run-${hallId}-${dateStr}`,
        planId: plan.id,
        hallId,
        businessDate: dateStr,
      });
      runs.set(key, created);
      return created;
    },
    async start(hallId: string, businessDate: Date | string, masterUserId: string): Promise<GamePlanRun> {
      const dateStr = typeof businessDate === "string"
        ? businessDate.slice(0, 10)
        : businessDate.toISOString().slice(0, 10);
      const key = `${hallId}|${dateStr}`;
      const run = runs.get(key);
      if (!run) {
        throw new DomainError("GAME_PLAN_RUN_NOT_FOUND", "ingen run");
      }
      if (run.status !== "idle") {
        throw new DomainError(
          "GAME_PLAN_RUN_INVALID_TRANSITION",
          `Kan ikke starte fra status=${run.status}`,
        );
      }
      const updated: GamePlanRun = {
        ...run,
        status: "running",
        startedAt: new Date().toISOString(),
        currentPosition: 1,
        masterUserId,
      };
      runs.set(key, updated);
      return updated;
    },
    async pause(hallId: string, businessDate: Date | string): Promise<GamePlanRun> {
      const dateStr = typeof businessDate === "string"
        ? businessDate.slice(0, 10)
        : businessDate.toISOString().slice(0, 10);
      const key = `${hallId}|${dateStr}`;
      const run = runs.get(key);
      if (!run) throw new DomainError("GAME_PLAN_RUN_NOT_FOUND", "");
      if (run.status !== "running") {
        throw new DomainError("GAME_PLAN_RUN_INVALID_TRANSITION", "");
      }
      const updated: GamePlanRun = { ...run, status: "paused" };
      runs.set(key, updated);
      return updated;
    },
    async resume(hallId: string, businessDate: Date | string): Promise<GamePlanRun> {
      const dateStr = typeof businessDate === "string"
        ? businessDate.slice(0, 10)
        : businessDate.toISOString().slice(0, 10);
      const key = `${hallId}|${dateStr}`;
      const run = runs.get(key);
      if (!run) throw new DomainError("GAME_PLAN_RUN_NOT_FOUND", "");
      if (run.status !== "paused") {
        throw new DomainError("GAME_PLAN_RUN_INVALID_TRANSITION", "");
      }
      const updated: GamePlanRun = { ...run, status: "running" };
      runs.set(key, updated);
      return updated;
    },
    async advanceToNext(
      hallId: string,
      businessDate: Date | string,
    ): Promise<AdvanceToNextResult> {
      const dateStr = typeof businessDate === "string"
        ? businessDate.slice(0, 10)
        : businessDate.toISOString().slice(0, 10);
      const key = `${hallId}|${dateStr}`;
      const run = runs.get(key);
      if (!run) throw new DomainError("GAME_PLAN_RUN_NOT_FOUND", "");
      if (run.status !== "running" && run.status !== "paused") {
        throw new DomainError("GAME_PLAN_RUN_INVALID_TRANSITION", "");
      }
      const plan = plans.get(run.planId);
      if (!plan) throw new DomainError("GAME_PLAN_NOT_FOUND", "");
      const newPosition = run.currentPosition + 1;
      if (newPosition > plan.items.length) {
        const updated: GamePlanRun = {
          ...run,
          status: "finished",
          finishedAt: new Date().toISOString(),
        };
        runs.set(key, updated);
        return { run: updated, nextGame: null, jackpotSetupRequired: false };
      }
      const nextItem = plan.items.find((i) => i.position === newPosition);
      if (!nextItem) throw new DomainError("GAME_PLAN_RUN_CORRUPT", "");
      const overrideKey = String(newPosition);
      const hasOverride = Object.prototype.hasOwnProperty.call(
        run.jackpotOverrides,
        overrideKey,
      );
      if (nextItem.catalogEntry.requiresJackpotSetup && !hasOverride) {
        return {
          run,
          nextGame: nextItem.catalogEntry,
          jackpotSetupRequired: true,
        };
      }
      const updated: GamePlanRun = { ...run, currentPosition: newPosition };
      runs.set(key, updated);
      return { run: updated, nextGame: nextItem.catalogEntry, jackpotSetupRequired: false };
    },
    async setJackpotOverride(
      hallId: string,
      businessDate: Date | string,
      position: number,
      override: { draw: number; prizesCents: Record<string, number> },
    ): Promise<GamePlanRun> {
      const dateStr = typeof businessDate === "string"
        ? businessDate.slice(0, 10)
        : businessDate.toISOString().slice(0, 10);
      const key = `${hallId}|${dateStr}`;
      const run = runs.get(key);
      if (!run) throw new DomainError("GAME_PLAN_RUN_NOT_FOUND", "");
      if (run.status === "finished") {
        throw new DomainError("GAME_PLAN_RUN_INVALID_TRANSITION", "");
      }
      const plan = plans.get(run.planId);
      if (!plan) throw new DomainError("GAME_PLAN_NOT_FOUND", "");
      const item = plan.items.find((i) => i.position === position);
      if (!item) {
        throw new DomainError(
          "INVALID_INPUT",
          `Plan har ingen item på posisjon ${position}.`,
        );
      }
      if (!item.catalogEntry.requiresJackpotSetup) {
        throw new DomainError(
          "INVALID_INPUT",
          `Spillet på posisjon ${position} krever ikke jackpot-setup.`,
        );
      }
      // Validér farger mot catalog-entry.ticketColors.
      const allowed = new Set(item.catalogEntry.ticketColors);
      for (const k of Object.keys(override.prizesCents)) {
        if (!allowed.has(k as GameCatalogEntry["ticketColors"][number])) {
          throw new DomainError(
            "INVALID_INPUT",
            `prizesCents.${k} matcher ikke catalog-game.ticketColors.`,
          );
        }
      }
      const newOverride: JackpotOverride = {
        draw: override.draw,
        prizesCents: override.prizesCents as JackpotOverride["prizesCents"],
      };
      const updated: GamePlanRun = {
        ...run,
        jackpotOverrides: {
          ...run.jackpotOverrides,
          [String(position)]: newOverride,
        },
      };
      runs.set(key, updated);
      return updated;
    },
  } as unknown as GamePlanRunService;

  // Fase 4 (2026-05-07): valgfri bridge-stub.
  const bridgeSpawns: Array<{ runId: string; position: number; result: unknown }> = [];
  let engineBridge: import("../../game/GamePlanEngineBridge.js").GamePlanEngineBridge | null = null;
  if (bridgeOptions) {
    engineBridge = {
      async createScheduledGameForPlanRunPosition(
        runId: string,
        position: number,
      ) {
        if (bridgeOptions.throwError) throw bridgeOptions.throwError;
        const result = {
          scheduledGameId: bridgeOptions.scheduledGameId ?? `sg-${runId}-${position}`,
          catalogEntry: {
            id: "cat-stub",
          } as GameCatalogEntry,
          reused: bridgeOptions.reuseExisting ?? false,
        };
        bridgeSpawns.push({ runId, position, result });
        return result;
      },
      async getJackpotConfigForPosition() {
        return null;
      },
    } as unknown as import("../../game/GamePlanEngineBridge.js").GamePlanEngineBridge;
  }

  const app = express();
  app.use(express.json());
  app.use(
    createAgentGamePlanRouter({
      platformService,
      planRunService,
      planService,
      engineBridge,
    }),
  );
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    runs,
    plans,
    bridgeSpawns,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

async function req(
  baseUrl: string,
  method: string,
  path: string,
  token?: string,
  body?: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

// ── Tests ───────────────────────────────────────────────────────────────

test("Fase 3 plan-runtime: PLAYER blokkert på alle ruter", async () => {
  const ctx = await startServer({ "pl-tok": playerUser });
  try {
    const get = await req(
      ctx.baseUrl,
      "GET",
      "/api/agent/game-plan/current",
      "pl-tok",
    );
    assert.equal(get.status, 400);
    assert.equal(get.json.error.code, "FORBIDDEN");
    const start = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/game-plan/start",
      "pl-tok",
    );
    assert.equal(start.status, 400);
    assert.equal(start.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("Fase 3 plan-runtime: GET /current uten plan/run returnerer null", async () => {
  const ctx = await startServer({ "agent-tok": masterAgent });
  try {
    const get = await req(
      ctx.baseUrl,
      "GET",
      "/api/agent/game-plan/current",
      "agent-tok",
    );
    assert.equal(get.status, 200);
    assert.equal(get.json.data.run, null);
    assert.equal(get.json.data.plan, null);
    assert.deepEqual(get.json.data.items, []);
    assert.equal(get.json.data.currentItem, null);
    assert.equal(get.json.data.jackpotSetupRequired, false);
  } finally {
    await ctx.close();
  }
});

test("Fase 3 plan-runtime: GET /current returnerer plan + items + currentItem", async () => {
  const cat1 = makeCatalog("cat-1");
  const cat2 = makeCatalog("cat-2", { requiresJackpotSetup: true });
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-master", hallId: "hall-master" }),
    items: [
      {
        id: "i-1",
        planId: "plan-master",
        position: 1,
        gameCatalogId: cat1.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat1,
      },
      {
        id: "i-2",
        planId: "plan-master",
        position: 2,
        gameCatalogId: cat2.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat2,
      },
    ],
  };
  const run = makeRun({
    id: "run-1",
    planId: "plan-master",
    hallId: "hall-master",
    status: "running",
    currentPosition: 1,
    startedAt: "2026-05-07T11:00:00Z",
    masterUserId: "agent-master",
  });
  const ctx = await startServer(
    { "agent-tok": masterAgent },
    [plan],
    [run],
  );
  try {
    const get = await req(
      ctx.baseUrl,
      "GET",
      "/api/agent/game-plan/current",
      "agent-tok",
    );
    assert.equal(get.status, 200);
    assert.equal(get.json.data.run.id, "run-1");
    assert.equal(get.json.data.plan.id, "plan-master");
    assert.equal(get.json.data.items.length, 2);
    assert.equal(get.json.data.currentItem.position, 1);
    assert.equal(get.json.data.currentItem.catalogEntry.id, "cat-1");
    assert.equal(get.json.data.nextItem.position, 2);
    assert.equal(get.json.data.nextItem.catalogEntry.id, "cat-2");
    // Current er ikke jackpot-spill
    assert.equal(get.json.data.jackpotSetupRequired, false);
    assert.equal(get.json.data.isMaster, true);
  } finally {
    await ctx.close();
  }
});

test("Fase 3 plan-runtime: jackpotSetupRequired=true når currentItem krever popup", async () => {
  const cat = makeCatalog("cat-jp", { requiresJackpotSetup: true });
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-jp", hallId: "hall-master" }),
    items: [
      {
        id: "i-1",
        planId: "plan-jp",
        position: 1,
        gameCatalogId: cat.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat,
      },
    ],
  };
  const run = makeRun({
    id: "run-1",
    planId: "plan-jp",
    hallId: "hall-master",
    status: "running",
    currentPosition: 1,
  });
  const ctx = await startServer({ "tok": masterAgent }, [plan], [run]);
  try {
    const get = await req(
      ctx.baseUrl,
      "GET",
      "/api/agent/game-plan/current",
      "tok",
    );
    assert.equal(get.status, 200);
    assert.equal(get.json.data.jackpotSetupRequired, true);
    assert.equal(get.json.data.pendingJackpotOverride, null);
  } finally {
    await ctx.close();
  }
});

test("Fase 3 plan-runtime: master-agent kan starte plan", async () => {
  const cat = makeCatalog("cat-1");
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-master", hallId: "hall-master" }),
    items: [
      {
        id: "i-1",
        planId: "plan-master",
        position: 1,
        gameCatalogId: cat.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat,
      },
    ],
  };
  const ctx = await startServer({ "tok": masterAgent }, [plan], []);
  try {
    const start = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/game-plan/start",
      "tok",
    );
    assert.equal(start.status, 200);
    assert.equal(start.json.data.run.status, "running");
    assert.equal(start.json.data.run.currentPosition, 1);
  } finally {
    await ctx.close();
  }
});

test("Fase 3 plan-runtime: slave-agent får 403 på /start", async () => {
  // Plan tilhører hall-master, men slaveAgent.hallId === hall-slave.
  // Slave kjøper ikke "getOrCreateForToday" pga sin egen hall ikke har
  // plan, så vi forventer NO_MATCHING_PLAN istedenfor FORBIDDEN her —
  // men hvis plan FINNES for slave-hallen blir det FORBIDDEN. Vi tester
  // begge situasjoner.
  const cat = makeCatalog("cat-1");
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-slave", hallId: "hall-slave" }),
    items: [
      {
        id: "i-1",
        planId: "plan-slave",
        position: 1,
        gameCatalogId: cat.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat,
      },
    ],
  };
  // For 403-test: slave-agenten i hall-slave starter en plan som
  // tilhører hall-master. Vi seeder en run direkte for hall-slave med
  // plan-id som peker på hall-master sitt plan.
  const masterPlan: GamePlanWithItems = {
    ...makePlan({ id: "plan-master", hallId: "hall-master" }),
    items: plan.items.map((i) => ({ ...i, planId: "plan-master" })),
  };
  const slaveRun = makeRun({
    id: "run-cross",
    planId: "plan-master",
    hallId: "hall-slave",
    status: "idle",
  });
  const ctx = await startServer(
    { "tok": slaveAgent },
    [masterPlan],
    [slaveRun],
  );
  try {
    const start = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/game-plan/start",
      "tok",
    );
    // Slave-agenten kan ikke starte fordi plan.hallId !== actor.hallId.
    assert.equal(start.status, 400);
    assert.equal(start.json.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("Fase 3 plan-runtime: advance til neste posisjon", async () => {
  const cat1 = makeCatalog("cat-1");
  const cat2 = makeCatalog("cat-2");
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-master", hallId: "hall-master" }),
    items: [
      {
        id: "i-1",
        planId: "plan-master",
        position: 1,
        gameCatalogId: cat1.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat1,
      },
      {
        id: "i-2",
        planId: "plan-master",
        position: 2,
        gameCatalogId: cat2.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat2,
      },
    ],
  };
  const run = makeRun({
    id: "run-1",
    planId: "plan-master",
    hallId: "hall-master",
    status: "running",
    currentPosition: 1,
  });
  const ctx = await startServer({ "tok": masterAgent }, [plan], [run]);
  try {
    const adv = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/game-plan/advance",
      "tok",
    );
    assert.equal(adv.status, 200);
    assert.equal(adv.json.data.run.currentPosition, 2);
    assert.equal(adv.json.data.jackpotSetupRequired, false);
    assert.equal(adv.json.data.nextGame.id, "cat-2");
  } finally {
    await ctx.close();
  }
});

test("Fase 3 plan-runtime: advance signalerer jackpotSetupRequired uten å flytte", async () => {
  const cat1 = makeCatalog("cat-1");
  const cat2 = makeCatalog("cat-jp", { requiresJackpotSetup: true });
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-master", hallId: "hall-master" }),
    items: [
      {
        id: "i-1",
        planId: "plan-master",
        position: 1,
        gameCatalogId: cat1.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat1,
      },
      {
        id: "i-2",
        planId: "plan-master",
        position: 2,
        gameCatalogId: cat2.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat2,
      },
    ],
  };
  const run = makeRun({
    id: "run-1",
    planId: "plan-master",
    hallId: "hall-master",
    status: "running",
    currentPosition: 1,
  });
  const ctx = await startServer({ "tok": masterAgent }, [plan], [run]);
  try {
    const adv = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/game-plan/advance",
      "tok",
    );
    assert.equal(adv.status, 200);
    // run flyttes IKKE — currentPosition forblir 1 inntil override settes.
    assert.equal(adv.json.data.run.currentPosition, 1);
    assert.equal(adv.json.data.jackpotSetupRequired, true);
    assert.equal(adv.json.data.nextGame.id, "cat-jp");
  } finally {
    await ctx.close();
  }
});

test("Fase 3 plan-runtime: jackpot-setup lagrer override med valid bongfarger", async () => {
  const cat = makeCatalog("cat-jp", {
    requiresJackpotSetup: true,
    ticketColors: ["gul", "hvit", "lilla"],
  });
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-master", hallId: "hall-master" }),
    items: [
      {
        id: "i-1",
        planId: "plan-master",
        position: 1,
        gameCatalogId: "cat-other",
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: makeCatalog("cat-other"),
      },
      {
        id: "i-2",
        planId: "plan-master",
        position: 2,
        gameCatalogId: cat.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat,
      },
    ],
  };
  const run = makeRun({
    id: "run-1",
    planId: "plan-master",
    hallId: "hall-master",
    status: "running",
    currentPosition: 1,
  });
  const ctx = await startServer({ "tok": masterAgent }, [plan], [run]);
  try {
    const setup = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/game-plan/jackpot-setup",
      "tok",
      {
        position: 2,
        draw: 50,
        prizesCents: { gul: 500000, hvit: 600000, lilla: 700000 },
      },
    );
    assert.equal(setup.status, 200);
    assert.equal(setup.json.data.run.jackpotOverrides["2"].draw, 50);
    assert.deepEqual(setup.json.data.run.jackpotOverrides["2"].prizesCents, {
      gul: 500000,
      hvit: 600000,
      lilla: 700000,
    });
  } finally {
    await ctx.close();
  }
});

test("Fase 3 plan-runtime: jackpot-setup avslår ugyldig bongfarge", async () => {
  const cat = makeCatalog("cat-jp", {
    requiresJackpotSetup: true,
    ticketColors: ["gul", "hvit"],
  });
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-master", hallId: "hall-master" }),
    items: [
      {
        id: "i-1",
        planId: "plan-master",
        position: 1,
        gameCatalogId: cat.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat,
      },
    ],
  };
  const run = makeRun({
    id: "run-1",
    planId: "plan-master",
    hallId: "hall-master",
    status: "running",
    currentPosition: 1,
  });
  const ctx = await startServer({ "tok": masterAgent }, [plan], [run]);
  try {
    // Send "lilla" som ikke er i catalog.ticketColors.
    const setup = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/game-plan/jackpot-setup",
      "tok",
      {
        position: 1,
        draw: 50,
        prizesCents: { gul: 500000, lilla: 600000 },
      },
    );
    assert.equal(setup.status, 400);
    assert.equal(setup.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("Fase 3 plan-runtime: jackpot-setup avslår negativt beløp", async () => {
  const cat = makeCatalog("cat-jp", {
    requiresJackpotSetup: true,
    ticketColors: ["gul"],
  });
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-master", hallId: "hall-master" }),
    items: [
      {
        id: "i-1",
        planId: "plan-master",
        position: 1,
        gameCatalogId: cat.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat,
      },
    ],
  };
  const run = makeRun({
    id: "run-1",
    planId: "plan-master",
    hallId: "hall-master",
    status: "running",
    currentPosition: 1,
  });
  const ctx = await startServer({ "tok": masterAgent }, [plan], [run]);
  try {
    const setup = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/game-plan/jackpot-setup",
      "tok",
      {
        position: 1,
        draw: 50,
        prizesCents: { gul: -1000 },
      },
    );
    assert.equal(setup.status, 400);
    assert.equal(setup.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("Hotfix 2 (MEDIUM #6): jackpot-setup avslår draw > 90 i route-laget", async () => {
  // Spill 1 har maks 90 baller. draw=999 må fanges allerede i route-validering
  // før vi runtripper til service-laget. Sjekker både draw=91 (akkurat over)
  // og draw=999 (langt over).
  const cat = makeCatalog("cat-jp", {
    requiresJackpotSetup: true,
    ticketColors: ["gul"],
  });
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-master", hallId: "hall-master" }),
    items: [
      {
        id: "i-1",
        planId: "plan-master",
        position: 1,
        gameCatalogId: cat.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat,
      },
    ],
  };
  const run = makeRun({
    id: "run-1",
    planId: "plan-master",
    hallId: "hall-master",
    status: "running",
    currentPosition: 1,
  });
  const ctx = await startServer({ "tok": masterAgent }, [plan], [run]);
  try {
    // draw=999 → INVALID_INPUT
    const r1 = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/game-plan/jackpot-setup",
      "tok",
      { position: 1, draw: 999, prizesCents: { gul: 100000 } },
    );
    assert.equal(r1.status, 400);
    assert.equal(r1.json.error.code, "INVALID_INPUT");
    assert.match(r1.json.error.message, /1 og 90/);

    // draw=91 (boundary) → INVALID_INPUT
    const r2 = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/game-plan/jackpot-setup",
      "tok",
      { position: 1, draw: 91, prizesCents: { gul: 100000 } },
    );
    assert.equal(r2.status, 400);
    assert.equal(r2.json.error.code, "INVALID_INPUT");

    // draw=90 (max valid) → success
    const r3 = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/game-plan/jackpot-setup",
      "tok",
      { position: 1, draw: 90, prizesCents: { gul: 100000 } },
    );
    assert.equal(r3.status, 200);

    // draw=1 (min valid) → success
    const r4 = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/game-plan/jackpot-setup",
      "tok",
      { position: 1, draw: 1, prizesCents: { gul: 100000 } },
    );
    assert.equal(r4.status, 200);

    // draw=0 (under min) → INVALID_INPUT
    const r5 = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/game-plan/jackpot-setup",
      "tok",
      { position: 1, draw: 0, prizesCents: { gul: 100000 } },
    );
    assert.equal(r5.status, 400);
    assert.equal(r5.json.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

test("Fase 3 plan-runtime: ADMIN kan operere på vegne av master-hall via ?hallId", async () => {
  const cat = makeCatalog("cat-1");
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-master", hallId: "hall-master" }),
    items: [
      {
        id: "i-1",
        planId: "plan-master",
        position: 1,
        gameCatalogId: cat.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat,
      },
    ],
  };
  const ctx = await startServer({ "admin-tok": adminUser }, [plan], []);
  try {
    const get = await req(
      ctx.baseUrl,
      "GET",
      "/api/agent/game-plan/current?hallId=hall-master",
      "admin-tok",
    );
    assert.equal(get.status, 200);
    assert.equal(get.json.data.hallId, "hall-master");
    assert.equal(get.json.data.run, null);
  } finally {
    await ctx.close();
  }
});

test("Fase 3 plan-runtime: pause + resume status-overgang", async () => {
  const cat = makeCatalog("cat-1");
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-master", hallId: "hall-master" }),
    items: [
      {
        id: "i-1",
        planId: "plan-master",
        position: 1,
        gameCatalogId: cat.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat,
      },
    ],
  };
  const run = makeRun({
    id: "run-1",
    planId: "plan-master",
    hallId: "hall-master",
    status: "running",
    currentPosition: 1,
  });
  const ctx = await startServer({ "tok": masterAgent }, [plan], [run]);
  try {
    const pauseRes = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/game-plan/pause",
      "tok",
    );
    assert.equal(pauseRes.status, 200);
    assert.equal(pauseRes.json.data.run.status, "paused");
    const resumeRes = await req(
      ctx.baseUrl,
      "POST",
      "/api/agent/game-plan/resume",
      "tok",
    );
    assert.equal(resumeRes.status, 200);
    assert.equal(resumeRes.json.data.run.status, "running");
  } finally {
    await ctx.close();
  }
});

// ── Fase 4 (2026-05-07): bridge-integrasjon ──────────────────────────────

test("Fase 4 bridge: /start uten bridge → scheduledGameId=null", async () => {
  const cat = makeCatalog("cat-1");
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-master", hallId: "hall-master" }),
    items: [
      {
        id: "i-1",
        planId: "plan-master",
        position: 1,
        gameCatalogId: cat.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat,
      },
    ],
  };
  const ctx = await startServer({ tok: masterAgent }, [plan], [], null);
  try {
    const start = await req(ctx.baseUrl, "POST", "/api/agent/game-plan/start", "tok");
    assert.equal(start.status, 200);
    assert.equal(start.json.data.run.status, "running");
    assert.equal(start.json.data.scheduledGameId, null);
    assert.equal(ctx.bridgeSpawns.length, 0);
  } finally {
    await ctx.close();
  }
});

test("Fase 4 bridge: /start med bridge → scheduledGameId returneres", async () => {
  const cat = makeCatalog("cat-1");
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-master", hallId: "hall-master" }),
    items: [
      {
        id: "i-1",
        planId: "plan-master",
        position: 1,
        gameCatalogId: cat.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat,
      },
    ],
  };
  const ctx = await startServer({ tok: masterAgent }, [plan], [], {
    scheduledGameId: "sg-test-1",
  });
  try {
    const start = await req(ctx.baseUrl, "POST", "/api/agent/game-plan/start", "tok");
    assert.equal(start.status, 200);
    assert.equal(start.json.data.run.status, "running");
    assert.equal(start.json.data.scheduledGameId, "sg-test-1");
    assert.equal(start.json.data.bridgeError, null);
    assert.equal(ctx.bridgeSpawns.length, 1);
    assert.equal(ctx.bridgeSpawns[0].position, 1);
  } finally {
    await ctx.close();
  }
});

test("Fase 4 bridge: /start propagerer JACKPOT_SETUP_REQUIRED som domain-error", async () => {
  const cat = makeCatalog("cat-jp", { requiresJackpotSetup: true });
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-master", hallId: "hall-master" }),
    items: [
      {
        id: "i-1",
        planId: "plan-master",
        position: 1,
        gameCatalogId: cat.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat,
      },
    ],
  };
  const ctx = await startServer({ tok: masterAgent }, [plan], [], {
    throwError: new DomainError(
      "JACKPOT_SETUP_REQUIRED",
      "Jackpot-override mangler",
    ),
  });
  try {
    const start = await req(ctx.baseUrl, "POST", "/api/agent/game-plan/start", "tok");
    assert.equal(start.status, 400);
    assert.equal(start.json.error.code, "JACKPOT_SETUP_REQUIRED");
  } finally {
    await ctx.close();
  }
});

test("Fase 4 bridge: /start logger uventet bridge-feil men returnerer success", async () => {
  const cat = makeCatalog("cat-1");
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-master", hallId: "hall-master" }),
    items: [
      {
        id: "i-1",
        planId: "plan-master",
        position: 1,
        gameCatalogId: cat.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat,
      },
    ],
  };
  const ctx = await startServer({ tok: masterAgent }, [plan], [], {
    throwError: new DomainError(
      "GAME_PLAN_RUN_CORRUPT",
      "FK-violation på hall-group",
    ),
  });
  try {
    const start = await req(ctx.baseUrl, "POST", "/api/agent/game-plan/start", "tok");
    // Run-state ble fortsatt oppdatert; bare bridge-feil ble strippet
    assert.equal(start.status, 200);
    assert.equal(start.json.data.run.status, "running");
    assert.equal(start.json.data.scheduledGameId, null);
    assert.equal(start.json.data.bridgeError, "GAME_PLAN_RUN_CORRUPT");
  } finally {
    await ctx.close();
  }
});

test("Fase 4 bridge: /advance returnerer scheduledGameId for ny posisjon", async () => {
  const cat1 = makeCatalog("cat-1");
  const cat2 = makeCatalog("cat-2");
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-master", hallId: "hall-master" }),
    items: [
      {
        id: "i-1",
        planId: "plan-master",
        position: 1,
        gameCatalogId: cat1.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat1,
      },
      {
        id: "i-2",
        planId: "plan-master",
        position: 2,
        gameCatalogId: cat2.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat2,
      },
    ],
  };
  const run = makeRun({
    id: "run-1",
    planId: "plan-master",
    hallId: "hall-master",
    status: "running",
    currentPosition: 1,
  });
  const ctx = await startServer({ tok: masterAgent }, [plan], [run], {
    scheduledGameId: "sg-advance",
  });
  try {
    const adv = await req(ctx.baseUrl, "POST", "/api/agent/game-plan/advance", "tok");
    assert.equal(adv.status, 200);
    assert.equal(adv.json.data.run.currentPosition, 2);
    assert.equal(adv.json.data.scheduledGameId, "sg-advance");
    assert.equal(adv.json.data.jackpotSetupRequired, false);
    assert.equal(ctx.bridgeSpawns.length, 1);
    assert.equal(ctx.bridgeSpawns[0].position, 2);
  } finally {
    await ctx.close();
  }
});

test("Fase 4 bridge: /advance kaller IKKE bridge når jackpotSetupRequired=true", async () => {
  const cat1 = makeCatalog("cat-1");
  const cat2 = makeCatalog("cat-jp", { requiresJackpotSetup: true });
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-master", hallId: "hall-master" }),
    items: [
      {
        id: "i-1",
        planId: "plan-master",
        position: 1,
        gameCatalogId: cat1.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat1,
      },
      {
        id: "i-2",
        planId: "plan-master",
        position: 2,
        gameCatalogId: cat2.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat2,
      },
    ],
  };
  const run = makeRun({
    id: "run-1",
    planId: "plan-master",
    hallId: "hall-master",
    status: "running",
    currentPosition: 1,
    // Jackpot-override mangler for posisjon 2
    jackpotOverrides: {},
  });
  const ctx = await startServer({ tok: masterAgent }, [plan], [run], {
    scheduledGameId: "should-not-be-called",
  });
  try {
    const adv = await req(ctx.baseUrl, "POST", "/api/agent/game-plan/advance", "tok");
    assert.equal(adv.status, 200);
    assert.equal(adv.json.data.jackpotSetupRequired, true);
    assert.equal(adv.json.data.scheduledGameId, null);
    // Bridge skal IKKE være kalt
    assert.equal(ctx.bridgeSpawns.length, 0);
  } finally {
    await ctx.close();
  }
});

test("Fase 4 bridge: /advance til siste posisjon (finished) gir scheduledGameId=null", async () => {
  const cat = makeCatalog("cat-only");
  const plan: GamePlanWithItems = {
    ...makePlan({ id: "plan-master", hallId: "hall-master" }),
    items: [
      {
        id: "i-1",
        planId: "plan-master",
        position: 1,
        gameCatalogId: cat.id,
        bonusGameOverride: null,
        notes: null,
        createdAt: "2026-05-07T00:00:00Z",
        catalogEntry: cat,
      },
    ],
  };
  const run = makeRun({
    id: "run-1",
    planId: "plan-master",
    hallId: "hall-master",
    status: "running",
    currentPosition: 1,
  });
  const ctx = await startServer({ tok: masterAgent }, [plan], [run], {
    scheduledGameId: "should-not-be-called",
  });
  try {
    const adv = await req(ctx.baseUrl, "POST", "/api/agent/game-plan/advance", "tok");
    assert.equal(adv.status, 200);
    // Vi forventer at advance forbi siste posisjon → finished
    assert.equal(adv.json.data.run.status, "finished");
    assert.equal(adv.json.data.nextGame, null);
    assert.equal(adv.json.data.scheduledGameId, null);
    // Bridge skal IKKE kalles på finished
    assert.equal(ctx.bridgeSpawns.length, 0);
  } finally {
    await ctx.close();
  }
});
