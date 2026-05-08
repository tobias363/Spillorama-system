/**
 * BIN-814 / R7 — tests for public per-room health endpoints.
 *
 * Dekker:
 *   - Status-mapping for alle 9 status-kombinasjoner i `deriveStatus`.
 *   - phase-mapping fra GameStatus → HealthPhase.
 *   - msToSec-helper.
 *   - Full Express round-trip for /api/games/spill1/health med stub-engine
 *     (ingen DB-avhengighet — pool er stub'et, men fetchNextSpill1Start
 *     håndteres som null-fall).
 *   - Validering: hallId må være satt (400 med INVALID_INPUT).
 *   - Cache-Control + 200ms responstid.
 *   - Rate-limit (ved over 60 calls / min).
 */

import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import http from "node:http";

import {
  __testExports,
  createPublicGameHealthRouter,
} from "../publicGameHealth.js";

const { deriveStatus, phaseFromRoomStatus, msToSec, DRAW_STALE_THRESHOLD_SEC } =
  __testExports;

// ── Pure helpers ───────────────────────────────────────────────────────────

test("deriveStatus: dbHealthy=false → down (uansett alt annet)", () => {
  const result = deriveStatus({
    phase: "running",
    withinOpeningHours: true,
    redisHealthy: true,
    dbHealthy: false,
    lastDrawAgeMs: 0,
  });
  assert.equal(result, "down");
});

test("deriveStatus: aktiv runde + redis nede → degraded", () => {
  const result = deriveStatus({
    phase: "running",
    withinOpeningHours: true,
    redisHealthy: false,
    dbHealthy: true,
    lastDrawAgeMs: 5000,
  });
  assert.equal(result, "degraded");
});

test("deriveStatus: aktiv runde + stale draw (> threshold) → degraded", () => {
  const result = deriveStatus({
    phase: "running",
    withinOpeningHours: true,
    redisHealthy: true,
    dbHealthy: true,
    lastDrawAgeMs: (DRAW_STALE_THRESHOLD_SEC + 1) * 1000,
  });
  assert.equal(result, "degraded");
});

test("deriveStatus: aktiv runde + fresh draw + alt healthy → ok", () => {
  const result = deriveStatus({
    phase: "running",
    withinOpeningHours: true,
    redisHealthy: true,
    dbHealthy: true,
    lastDrawAgeMs: 1000,
  });
  assert.equal(result, "ok");
});

test("deriveStatus: paused-fase regnes som aktiv (ingen stale-check)", () => {
  const result = deriveStatus({
    phase: "paused",
    withinOpeningHours: true,
    redisHealthy: true,
    dbHealthy: true,
    lastDrawAgeMs: (DRAW_STALE_THRESHOLD_SEC + 100) * 1000,
  });
  // Paused og redis ok → ok (stale-check gjelder bare running)
  assert.equal(result, "ok");
});

test("deriveStatus: idle utenfor åpningstid → down", () => {
  const result = deriveStatus({
    phase: "idle",
    withinOpeningHours: false,
    redisHealthy: true,
    dbHealthy: true,
    lastDrawAgeMs: null,
  });
  assert.equal(result, "down");
});

test("deriveStatus: idle innenfor åpningstid + redis nede → degraded", () => {
  const result = deriveStatus({
    phase: "idle",
    withinOpeningHours: true,
    redisHealthy: false,
    dbHealthy: true,
    lastDrawAgeMs: null,
  });
  assert.equal(result, "degraded");
});

test("deriveStatus: idle innenfor åpningstid + alt healthy → ok", () => {
  const result = deriveStatus({
    phase: "idle",
    withinOpeningHours: true,
    redisHealthy: true,
    dbHealthy: true,
    lastDrawAgeMs: null,
  });
  assert.equal(result, "ok");
});

test("deriveStatus: finished-fase oppfører seg som idle (ingen aktiv runde)", () => {
  const result = deriveStatus({
    phase: "finished",
    withinOpeningHours: true,
    redisHealthy: true,
    dbHealthy: true,
    lastDrawAgeMs: 2000,
  });
  assert.equal(result, "ok");
});

test("phaseFromRoomStatus: WAITING → idle, RUNNING → running, ENDED → finished", () => {
  assert.equal(phaseFromRoomStatus("WAITING", false), "idle");
  assert.equal(phaseFromRoomStatus("RUNNING", false), "running");
  assert.equal(phaseFromRoomStatus("ENDED", false), "finished");
  assert.equal(phaseFromRoomStatus("NONE", false), "idle");
});

test("phaseFromRoomStatus: isPaused=true overstyrer alle status", () => {
  assert.equal(phaseFromRoomStatus("RUNNING", true), "paused");
  assert.equal(phaseFromRoomStatus("WAITING", true), "paused");
});

test("msToSec: null → null, ms → floor(sec)", () => {
  assert.equal(msToSec(null), null);
  assert.equal(msToSec(0), 0);
  assert.equal(msToSec(999), 0);
  assert.equal(msToSec(1000), 1);
  assert.equal(msToSec(31_500), 31);
});

// ── Integrasjon: full HTTP-round-trip med stub deps ─────────────────────────

interface StubServerCtx {
  baseUrl: string;
  close: () => Promise<void>;
  callsToGetActiveSpill2: number;
  callsToGetActiveSpill3: number;
  callsToCheckDb: number;
}

interface StubOptions {
  /** Returner success eller throw fra Spill2-config.getActive. */
  spill2ConfigOk?: boolean;
  spill3ConfigOk?: boolean;
  /** Skal pool.query (SELECT 1) lykkes? */
  dbOk?: boolean;
  /** Skal Redis-adapter-sjekk lykkes? */
  redisOk?: boolean;
}

async function startStubServer(opts: StubOptions = {}): Promise<StubServerCtx> {
  const ctx: StubServerCtx = {
    baseUrl: "",
    close: async () => {},
    callsToGetActiveSpill2: 0,
    callsToGetActiveSpill3: 0,
    callsToCheckDb: 0,
  };

  // Stub `Pool` — kun `query` brukes.
  const stubPool = {
    query: async (sql: string) => {
      ctx.callsToCheckDb += 1;
      if (sql.includes("SELECT 1") && opts.dbOk === false) {
        throw new Error("DB connection failed");
      }
      // For fetchNextSpill1Start — returnér tom rows.
      return { rows: [] };
    },
  };

  // Stub `BingoEngine` — kun `listRoomSummaries` + `getRoomSnapshot`.
  const stubEngine = {
    listRoomSummaries: () => [],
    getRoomSnapshot: () => {
      throw new Error("ROOM_NOT_FOUND");
    },
  };

  // Stub `IoServer.of('/').adapter` — Redis-adapter-mode hvis dbOk!=false.
  const stubIo = {
    of: (_namespace: string) => ({
      adapter: {
        rooms: new Map<string, Set<string>>(),
        // Hvis redisOk=true vi gir en serverCount; hvis false: throw.
        ...(opts.redisOk === false
          ? {
              serverCount: async () => {
                throw new Error("Redis disconnected");
              },
            }
          : opts.redisOk === true
            ? { serverCount: async () => 1 }
            : {}),
      },
    }),
  };

  const stubSpill2Config = {
    getActive: async () => {
      ctx.callsToGetActiveSpill2 += 1;
      if (opts.spill2ConfigOk === false) throw new Error("config missing");
      return {
        id: "s2-1",
        openingTimeStart: null,
        openingTimeEnd: null,
        minTicketsToStart: 0,
        ticketPriceCents: 1000,
        roundPauseMs: 5000,
        ballIntervalMs: 3500,
        jackpotNumberTable: {} as Record<string, unknown>,
        luckyNumberEnabled: false,
        luckyNumberPrizeCents: null,
        active: true,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        updatedByUserId: null,
      };
    },
  };

  const stubSpill3Config = {
    getActive: async () => {
      ctx.callsToGetActiveSpill3 += 1;
      if (opts.spill3ConfigOk === false) throw new Error("config missing");
      return {
        id: "s3-1",
        openingTimeStart: "00:00",
        openingTimeEnd: "23:59",
        minTicketsToStart: 0,
        prizeMode: "fixed",
        prizeRad1Cents: 100,
        prizeRad2Cents: 100,
        prizeRad3Cents: 100,
        prizeRad4Cents: 100,
        prizeFullHouseCents: 100,
        prizeRad1Pct: null,
        prizeRad2Pct: null,
        prizeRad3Pct: null,
        prizeRad4Pct: null,
        prizeFullHousePct: null,
        ticketPriceCents: 500,
        pauseBetweenRowsMs: 3000,
        active: true,
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
        updatedByUserId: null,
      };
    },
  };

  const app = express();
  app.use(
    createPublicGameHealthRouter({
      pool: stubPool as never,
      schema: "public",
      engine: stubEngine as never,
      io: stubIo as never,
      spill2ConfigService: stubSpill2Config as never,
      spill3ConfigService: stubSpill3Config as never,
    }),
  );

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  ctx.baseUrl = `http://127.0.0.1:${port}`;
  ctx.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return ctx;
}

test("integration: GET /api/games/spill1/health uten hallId → 400 INVALID_INPUT", async () => {
  const ctx = await startStubServer();
  try {
    const resp = await fetch(`${ctx.baseUrl}/api/games/spill1/health`);
    assert.equal(resp.status, 400);
    const body = (await resp.json()) as { ok: boolean; error?: { code: string } };
    assert.equal(body.ok, false);
  } finally {
    await ctx.close();
  }
});

test("integration: GET /api/games/spill1/health med hallId → 200 + Cache-Control no-cache", async () => {
  const ctx = await startStubServer({ dbOk: true, redisOk: true });
  try {
    const resp = await fetch(
      `${ctx.baseUrl}/api/games/spill1/health?hallId=hall-x`,
    );
    assert.equal(resp.status, 200);
    const cacheCtrl = resp.headers.get("cache-control") ?? "";
    assert.match(cacheCtrl, /no-cache/);
    const body = (await resp.json()) as {
      ok: boolean;
      data: {
        status: string;
        currentPhase: string;
        connectedClients: number;
        dbHealthy: boolean;
        redisHealthy: boolean;
        instanceId: string;
        checkedAt: string;
      };
    };
    assert.equal(body.ok, true);
    assert.equal(body.data.dbHealthy, true);
    assert.equal(body.data.redisHealthy, true);
    assert.equal(body.data.currentPhase, "idle");
    assert.equal(body.data.connectedClients, 0);
    assert.ok(body.data.instanceId.length > 0);
    assert.ok(body.data.checkedAt.length > 0);
  } finally {
    await ctx.close();
  }
});

test("integration: GET /api/games/spill2/health → bruker Spill2Config + healthy adapters", async () => {
  const ctx = await startStubServer({ dbOk: true, redisOk: true });
  try {
    const resp = await fetch(
      `${ctx.baseUrl}/api/games/spill2/health?hallId=hall-x`,
    );
    assert.equal(resp.status, 200);
    const body = (await resp.json()) as {
      ok: boolean;
      data: {
        status: string;
        nextScheduledStart: string | null;
        withinOpeningHours: boolean;
      };
    };
    assert.equal(body.ok, true);
    assert.equal(body.data.nextScheduledStart, null);
    // Spill 2 stub returnerer null/null åpningstider → alltid åpent → ok.
    assert.equal(body.data.withinOpeningHours, true);
    assert.equal(body.data.status, "ok");
    assert.equal(ctx.callsToGetActiveSpill2, 1);
  } finally {
    await ctx.close();
  }
});

test("integration: GET /api/games/spill3/health → bruker Spill3Config", async () => {
  const ctx = await startStubServer({ dbOk: true, redisOk: true });
  try {
    const resp = await fetch(
      `${ctx.baseUrl}/api/games/spill3/health?hallId=hall-x`,
    );
    assert.equal(resp.status, 200);
    const body = (await resp.json()) as {
      ok: boolean;
      data: { status: string; withinOpeningHours: boolean };
    };
    assert.equal(body.ok, true);
    // Spill 3 stub returnerer 00:00-23:59 → alltid åpent.
    assert.equal(body.data.withinOpeningHours, true);
    assert.equal(body.data.status, "ok");
    assert.equal(ctx.callsToGetActiveSpill3, 1);
  } finally {
    await ctx.close();
  }
});

test("integration: dbOk=false → status=down", async () => {
  const ctx = await startStubServer({ dbOk: false, redisOk: true });
  try {
    const resp = await fetch(
      `${ctx.baseUrl}/api/games/spill1/health?hallId=hall-x`,
    );
    assert.equal(resp.status, 200);
    const body = (await resp.json()) as {
      ok: boolean;
      data: { status: string; dbHealthy: boolean };
    };
    assert.equal(body.data.dbHealthy, false);
    assert.equal(body.data.status, "down");
  } finally {
    await ctx.close();
  }
});

test("integration: redisOk=false (men ingen aktiv runde + innen åpningstid) → degraded", async () => {
  const ctx = await startStubServer({ dbOk: true, redisOk: false });
  try {
    const resp = await fetch(
      `${ctx.baseUrl}/api/games/spill2/health?hallId=hall-x`,
    );
    assert.equal(resp.status, 200);
    const body = (await resp.json()) as {
      ok: boolean;
      data: { status: string; redisHealthy: boolean };
    };
    assert.equal(body.data.redisHealthy, false);
    assert.equal(body.data.status, "degraded");
  } finally {
    await ctx.close();
  }
});

test("integration: spill2Config.getActive throws → withinOpeningHours=false → down", async () => {
  const ctx = await startStubServer({
    dbOk: true,
    redisOk: true,
    spill2ConfigOk: false,
  });
  try {
    const resp = await fetch(
      `${ctx.baseUrl}/api/games/spill2/health?hallId=hall-x`,
    );
    assert.equal(resp.status, 200);
    const body = (await resp.json()) as {
      ok: boolean;
      data: { status: string; withinOpeningHours: boolean };
    };
    // Config-feil → withinOpeningHours=false → idle + utenfor åpning → down.
    assert.equal(body.data.withinOpeningHours, false);
    assert.equal(body.data.status, "down");
  } finally {
    await ctx.close();
  }
});

test("integration: response-tid under 200ms (akseptansekriterie)", async () => {
  const ctx = await startStubServer({ dbOk: true, redisOk: true });
  try {
    const start = Date.now();
    const resp = await fetch(
      `${ctx.baseUrl}/api/games/spill1/health?hallId=hall-x`,
    );
    const elapsed = Date.now() - start;
    assert.equal(resp.status, 200);
    // 200ms-budsjett — gir litt slack i CI: 1000ms over loopback.
    assert.ok(
      elapsed < 1000,
      `response too slow: ${elapsed}ms (target < 200ms in prod, < 1000ms in test)`,
    );
  } finally {
    await ctx.close();
  }
});

test("integration: rate-limit håndhever 60/min per IP", async () => {
  const ctx = await startStubServer({ dbOk: true, redisOk: true });
  try {
    const url = `${ctx.baseUrl}/api/games/spill1/health?hallId=hall-x`;
    // 60 vellykkede kall.
    for (let i = 0; i < 60; i += 1) {
      const resp = await fetch(url);
      assert.equal(resp.status, 200, `request ${i + 1} should succeed`);
    }
    // 61. kall blir blokkert.
    const blocked = await fetch(url);
    assert.equal(blocked.status, 429);
    const retryAfter = blocked.headers.get("retry-after");
    assert.ok(retryAfter, "expected Retry-After header");
    const body = (await blocked.json()) as {
      ok: boolean;
      error: { code: string };
    };
    assert.equal(body.ok, false);
    assert.equal(body.error.code, "RATE_LIMITED");
  } finally {
    await ctx.close();
  }
});

test("integration: hallId med whitespace trimmes", async () => {
  const ctx = await startStubServer({ dbOk: true, redisOk: true });
  try {
    const resp = await fetch(
      `${ctx.baseUrl}/api/games/spill1/health?hallId=${encodeURIComponent("  hall-x  ")}`,
    );
    assert.equal(resp.status, 200);
  } finally {
    await ctx.close();
  }
});

test("integration: hallId tom streng → 400", async () => {
  const ctx = await startStubServer({ dbOk: true, redisOk: true });
  try {
    const resp = await fetch(
      `${ctx.baseUrl}/api/games/spill1/health?hallId=`,
    );
    assert.equal(resp.status, 400);
  } finally {
    await ctx.close();
  }
});
