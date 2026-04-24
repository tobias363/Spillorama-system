/**
 * Task 1.4 (2026-04-24): integrasjonstester for agent-Game1-router.
 *
 * Verifiserer:
 *   - current-game: returnerer aktivt scheduled_game for hallen med
 *     riktig `isMasterAgent`-flagg.
 *   - start: master-agent aksepteres, ikke-master-agent 403.
 *   - resume: samme regler som start.
 *   - hall-status: returnerer samme datakilde som master-konsollet.
 *   - SUPPORT avvises på alle endpoints (permission GAME1_MASTER_WRITE).
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import { createAgentGame1Router } from "../agentGame1.js";
import type {
  PlatformService,
  PublicAppUser,
} from "../../platform/PlatformService.js";
import type { Game1MasterControlService } from "../../game/Game1MasterControlService.js";
import type {
  Game1HallReadyService,
  HallReadyStatusRow,
} from "../../game/Game1HallReadyService.js";
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
const masterAgent: PublicAppUser = {
  ...adminUser,
  id: "ag-m",
  role: "AGENT",
  hallId: "hall-master",
};
const slaveAgent: PublicAppUser = {
  ...adminUser,
  id: "ag-s",
  role: "AGENT",
  hallId: "hall-slave",
};
const unboundAgent: PublicAppUser = {
  ...adminUser,
  id: "ag-u",
  role: "AGENT",
  hallId: null,
};
const supportUser: PublicAppUser = {
  ...adminUser,
  id: "sup",
  role: "SUPPORT",
};
const playerUser: PublicAppUser = {
  ...adminUser,
  id: "pl",
  role: "PLAYER",
};

interface MockActiveRow {
  id: string;
  status: string;
  master_hall_id: string;
  group_hall_id: string;
  participating_halls_json: unknown;
  sub_game_name: string;
  custom_game_name: string | null;
  scheduled_start_time: Date | string;
  scheduled_end_time: Date | string;
  actual_start_time: Date | string | null;
  actual_end_time: Date | string | null;
}

function defaultActiveRow(): MockActiveRow {
  return {
    id: "g1",
    status: "purchase_open",
    master_hall_id: "hall-master",
    group_hall_id: "grp-1",
    participating_halls_json: ["hall-master", "hall-slave"],
    sub_game_name: "Jackpot",
    custom_game_name: null,
    scheduled_start_time: "2026-04-24T10:00:00.000Z",
    scheduled_end_time: "2026-04-24T11:00:00.000Z",
    actual_start_time: null,
    actual_end_time: null,
  };
}

function defaultReadyRows(): HallReadyStatusRow[] {
  return [
    {
      gameId: "g1",
      hallId: "hall-master",
      isReady: true,
      readyAt: "2026-04-24T09:55:00Z",
      readyByUserId: "u-m",
      digitalTicketsSold: 10,
      physicalTicketsSold: 5,
      excludedFromGame: false,
      excludedReason: null,
      createdAt: "",
      updatedAt: "",
    },
    {
      gameId: "g1",
      hallId: "hall-slave",
      isReady: false,
      readyAt: null,
      readyByUserId: null,
      digitalTicketsSold: 0,
      physicalTicketsSold: 0,
      excludedFromGame: false,
      excludedReason: null,
      createdAt: "",
      updatedAt: "",
    },
  ];
}

interface StartOpts {
  users?: Record<string, PublicAppUser>;
  activeRow?: MockActiveRow | null;
  readyRows?: HallReadyStatusRow[];
  allReady?: boolean;
  startImpl?: Game1MasterControlService["startGame"];
  resumeImpl?: Game1MasterControlService["resumeGame"];
  halls?: Record<string, { id: string; name: string }>;
  poolError?: Error;
}

interface Ctx {
  baseUrl: string;
  serviceCalls: {
    startGame: Array<Parameters<Game1MasterControlService["startGame"]>[0]>;
    resumeGame: Array<Parameters<Game1MasterControlService["resumeGame"]>[0]>;
    getReadyStatusForGame: string[];
    allParticipatingHallsReady: string[];
  };
  poolQueries: Array<{ sql: string; params: unknown[] }>;
  close: () => Promise<void>;
}

async function startServer(opts: StartOpts = {}): Promise<Ctx> {
  const users: Record<string, PublicAppUser> = opts.users ?? {
    "t-admin": adminUser,
  };
  const active = opts.activeRow === undefined ? defaultActiveRow() : opts.activeRow;
  const readyRows = opts.readyRows ?? defaultReadyRows();
  const allReady = opts.allReady ?? false;

  const serviceCalls: Ctx["serviceCalls"] = {
    startGame: [],
    resumeGame: [],
    getReadyStatusForGame: [],
    allParticipatingHallsReady: [],
  };
  const poolQueries: Ctx["poolQueries"] = [];

  const platformService = {
    async getUserFromAccessToken(token: string) {
      const u = users[token];
      if (!u) throw new DomainError("UNAUTHORIZED", "bad token");
      return u;
    },
    async getHall(hallId: string) {
      const h = opts.halls?.[hallId];
      if (h)
        return { ...h, isActive: true } as unknown as Awaited<
          ReturnType<PlatformService["getHall"]>
        >;
      throw new DomainError("HALL_NOT_FOUND", "nope");
    },
  } as unknown as PlatformService;

  const masterControlService = {
    async startGame(
      input: Parameters<Game1MasterControlService["startGame"]>[0]
    ) {
      serviceCalls.startGame.push(input);
      if (opts.startImpl) return opts.startImpl(input);
      return {
        gameId: "g1",
        status: "running",
        actualStartTime: "2026-04-24T10:00:00Z",
        actualEndTime: null,
        auditId: "audit-start",
      };
    },
    async resumeGame(
      input: Parameters<Game1MasterControlService["resumeGame"]>[0]
    ) {
      serviceCalls.resumeGame.push(input);
      if (opts.resumeImpl) return opts.resumeImpl(input);
      return {
        gameId: "g1",
        status: "running",
        actualStartTime: "2026-04-24T10:00:00Z",
        actualEndTime: null,
        auditId: "audit-resume",
      };
    },
  } as unknown as Game1MasterControlService;

  const hallReadyService = {
    async getReadyStatusForGame(gameId: string) {
      serviceCalls.getReadyStatusForGame.push(gameId);
      return readyRows;
    },
    async allParticipatingHallsReady(gameId: string) {
      serviceCalls.allParticipatingHallsReady.push(gameId);
      return allReady;
    },
  } as unknown as Game1HallReadyService;

  const pool = {
    async query(sql: string, params: unknown[]) {
      poolQueries.push({ sql, params });
      if (opts.poolError) throw opts.poolError;
      // Simuler scheduled_games-select.
      if (
        sql.includes("app_game1_scheduled_games") &&
        active &&
        Array.isArray(params) &&
        (active.master_hall_id === params[0] ||
          (Array.isArray(active.participating_halls_json) &&
            (active.participating_halls_json as string[]).includes(
              String(params[0])
            )))
      ) {
        return { rows: [active], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Parameters<typeof createAgentGame1Router>[0]["pool"];

  const app = express();
  app.use(express.json());
  app.use(
    createAgentGame1Router({
      platformService,
      masterControlService,
      hallReadyService,
      pool,
    })
  );

  const server = app.listen(0);
  await new Promise<void>((resolve) =>
    server.once("listening", () => resolve())
  );
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    serviceCalls,
    poolQueries,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

async function post(
  ctx: Ctx,
  path: string,
  token: string,
  body: unknown = {}
): Promise<Response> {
  return fetch(`${ctx.baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function get(ctx: Ctx, path: string, token: string): Promise<Response> {
  return fetch(`${ctx.baseUrl}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ── GET /current-game ────────────────────────────────────────────────────

test("GET /current-game — master-agent ser aktivt scheduled_game + isMasterAgent=true", async () => {
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    halls: {
      "hall-master": { id: "hall-master", name: "Master Hall" },
      "hall-slave": { id: "hall-slave", name: "Slave Hall" },
    },
  });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-m");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      ok: boolean;
      data: {
        hallId: string;
        isMasterAgent: boolean;
        currentGame: { id: string; status: string; masterHallId: string } | null;
        halls: Array<{ hallId: string; hallName: string; isReady: boolean }>;
      };
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.data.hallId, "hall-master");
    assert.equal(payload.data.isMasterAgent, true);
    assert.ok(payload.data.currentGame);
    assert.equal(payload.data.currentGame!.id, "g1");
    assert.equal(payload.data.currentGame!.masterHallId, "hall-master");
    assert.equal(payload.data.halls.length, 2);
    assert.equal(payload.data.halls[0]!.hallName, "Master Hall");
  } finally {
    await ctx.close();
  }
});

test("GET /current-game — slave-agent ser samme game men isMasterAgent=false", async () => {
  const ctx = await startServer({
    users: { "t-s": slaveAgent },
  });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-s");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { isMasterAgent: boolean; currentGame: { id: string } };
    };
    assert.equal(payload.data.isMasterAgent, false);
    assert.equal(payload.data.currentGame.id, "g1");
  } finally {
    await ctx.close();
  }
});

test("GET /current-game — ingen aktiv runde returnerer currentGame=null + tom halls", async () => {
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    activeRow: null,
  });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-m");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { currentGame: null; halls: unknown[]; allReady: boolean };
    };
    assert.equal(payload.data.currentGame, null);
    assert.deepEqual(payload.data.halls, []);
    assert.equal(payload.data.allReady, false);
  } finally {
    await ctx.close();
  }
});

test("GET /current-game — manglende scheduled_games-tabell gir tom respons (fail-open)", async () => {
  const err = Object.assign(new Error("relation missing"), { code: "42P01" });
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    poolError: err,
  });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-m");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as { data: { currentGame: null } };
    assert.equal(payload.data.currentGame, null);
  } finally {
    await ctx.close();
  }
});

test("GET /current-game — AGENT uten hallId → 400 FORBIDDEN", async () => {
  const ctx = await startServer({ users: { "t-u": unboundAgent } });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-u");
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GET /current-game — SUPPORT avvises (ikke i GAME1_MASTER_WRITE)", async () => {
  const ctx = await startServer({ users: { "t-sup": supportUser } });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-sup");
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GET /current-game — PLAYER avvises med FORBIDDEN", async () => {
  const ctx = await startServer({ users: { "t-pl": playerUser } });
  try {
    const res = await get(ctx, "/api/agent/game1/current-game", "t-pl");
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("GET /current-game — ADMIN med ?hallId overstyrer scope", async () => {
  const ctx = await startServer({
    users: { "t-a": adminUser },
  });
  try {
    const res = await get(
      ctx,
      "/api/agent/game1/current-game?hallId=hall-master",
      "t-a"
    );
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { hallId: string; isMasterAgent: boolean };
    };
    assert.equal(payload.data.hallId, "hall-master");
    assert.equal(payload.data.isMasterAgent, true);
  } finally {
    await ctx.close();
  }
});

// ── POST /start ──────────────────────────────────────────────────────────

test("POST /start — master-agent kan starte", async () => {
  const ctx = await startServer({ users: { "t-m": masterAgent } });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-m", {});
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { gameId: string; status: string; auditId: string };
    };
    assert.equal(payload.data.gameId, "g1");
    assert.equal(payload.data.status, "running");
    assert.equal(payload.data.auditId, "audit-start");
    assert.equal(ctx.serviceCalls.startGame.length, 1);
    assert.equal(ctx.serviceCalls.startGame[0]!.actor.role, "AGENT");
    assert.equal(ctx.serviceCalls.startGame[0]!.actor.hallId, "hall-master");
  } finally {
    await ctx.close();
  }
});

test("POST /start — master-agent kan videreformidle confirmExcludedHalls", async () => {
  const ctx = await startServer({ users: { "t-m": masterAgent } });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-m", {
      confirmExcludedHalls: ["hall-3"],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(
      ctx.serviceCalls.startGame[0]!.confirmExcludedHalls,
      ["hall-3"]
    );
  } finally {
    await ctx.close();
  }
});

test("POST /start — slave-agent avvises med 403 FORBIDDEN", async () => {
  const ctx = await startServer({ users: { "t-s": slaveAgent } });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-s", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "FORBIDDEN");
    assert.equal(ctx.serviceCalls.startGame.length, 0);
  } finally {
    await ctx.close();
  }
});

test("POST /start — SUPPORT avvises", async () => {
  const ctx = await startServer({ users: { "t-sup": supportUser } });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-sup", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "FORBIDDEN");
  } finally {
    await ctx.close();
  }
});

test("POST /start — ingen aktiv runde gir NO_ACTIVE_GAME", async () => {
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    activeRow: null,
  });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-m", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "NO_ACTIVE_GAME");
  } finally {
    await ctx.close();
  }
});

test("POST /start — DomainError fra service propageres (HALLS_NOT_READY)", async () => {
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    startImpl: async () => {
      throw new DomainError("HALLS_NOT_READY", "ikke klare");
    },
  });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-m", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "HALLS_NOT_READY");
  } finally {
    await ctx.close();
  }
});

test("POST /start — ADMIN uten hall kan ikke starte via agent-routen (ingen scope)", async () => {
  // ADMIN uten hallId feiler resolveHallScope ved agent-routen (mangler
  // ?hallId). Dette er bevisst: POST-endepunktene tar ikke query-param
  // for sikkerhet — ADMIN bruker master-konsollet.
  const ctx = await startServer({ users: { "t-a": adminUser } });
  try {
    const res = await post(ctx, "/api/agent/game1/start", "t-a", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "INVALID_INPUT");
  } finally {
    await ctx.close();
  }
});

// ── POST /resume ─────────────────────────────────────────────────────────

test("POST /resume — master-agent kan resume", async () => {
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    activeRow: { ...defaultActiveRow(), status: "paused" },
  });
  try {
    const res = await post(ctx, "/api/agent/game1/resume", "t-m", {});
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { gameId: string; status: string; auditId: string };
    };
    assert.equal(payload.data.gameId, "g1");
    assert.equal(payload.data.auditId, "audit-resume");
    assert.equal(ctx.serviceCalls.resumeGame.length, 1);
  } finally {
    await ctx.close();
  }
});

test("POST /resume — slave-agent avvises", async () => {
  const ctx = await startServer({
    users: { "t-s": slaveAgent },
    activeRow: { ...defaultActiveRow(), status: "paused" },
  });
  try {
    const res = await post(ctx, "/api/agent/game1/resume", "t-s", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "FORBIDDEN");
    assert.equal(ctx.serviceCalls.resumeGame.length, 0);
  } finally {
    await ctx.close();
  }
});

test("POST /resume — ingen aktiv runde gir NO_ACTIVE_GAME", async () => {
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    activeRow: null,
  });
  try {
    const res = await post(ctx, "/api/agent/game1/resume", "t-m", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "NO_ACTIVE_GAME");
  } finally {
    await ctx.close();
  }
});

test("POST /resume — DomainError propageres (GAME_NOT_PAUSED)", async () => {
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    resumeImpl: async () => {
      throw new DomainError("GAME_NOT_PAUSED", "kan kun resume pauset");
    },
  });
  try {
    const res = await post(ctx, "/api/agent/game1/resume", "t-m", {});
    assert.equal(res.status, 400);
    const payload = (await res.json()) as { error: { code: string } };
    assert.equal(payload.error.code, "GAME_NOT_PAUSED");
  } finally {
    await ctx.close();
  }
});

// ── GET /hall-status ─────────────────────────────────────────────────────

test("GET /hall-status — returnerer hall-liste for aktivt spill", async () => {
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    halls: {
      "hall-master": { id: "hall-master", name: "Master" },
      "hall-slave": { id: "hall-slave", name: "Slave" },
    },
  });
  try {
    const res = await get(ctx, "/api/agent/game1/hall-status", "t-m");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: {
        hallId: string;
        gameId: string;
        halls: Array<{ hallId: string; hallName: string; isReady: boolean }>;
        allReady: boolean;
      };
    };
    assert.equal(payload.data.gameId, "g1");
    assert.equal(payload.data.halls.length, 2);
    const master = payload.data.halls.find((h) => h.hallId === "hall-master");
    assert.ok(master);
    assert.equal(master!.isReady, true);
    assert.equal(master!.hallName, "Master");
    const slave = payload.data.halls.find((h) => h.hallId === "hall-slave");
    assert.ok(slave);
    assert.equal(slave!.isReady, false);
  } finally {
    await ctx.close();
  }
});

test("GET /hall-status — ingen aktiv runde returnerer tom liste", async () => {
  const ctx = await startServer({
    users: { "t-m": masterAgent },
    activeRow: null,
  });
  try {
    const res = await get(ctx, "/api/agent/game1/hall-status", "t-m");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { gameId: null; halls: unknown[] };
    };
    assert.equal(payload.data.gameId, null);
    assert.deepEqual(payload.data.halls, []);
  } finally {
    await ctx.close();
  }
});

test("GET /hall-status — slave-agent får samme data som master-agent", async () => {
  const ctx = await startServer({ users: { "t-s": slaveAgent } });
  try {
    const res = await get(ctx, "/api/agent/game1/hall-status", "t-s");
    assert.equal(res.status, 200);
    const payload = (await res.json()) as {
      data: { gameId: string; halls: unknown[] };
    };
    assert.equal(payload.data.gameId, "g1");
    assert.equal(payload.data.halls.length, 2);
  } finally {
    await ctx.close();
  }
});

test("GET /hall-status — SUPPORT avvises", async () => {
  const ctx = await startServer({ users: { "t-sup": supportUser } });
  try {
    const res = await get(ctx, "/api/agent/game1/hall-status", "t-sup");
    assert.equal(res.status, 400);
  } finally {
    await ctx.close();
  }
});
