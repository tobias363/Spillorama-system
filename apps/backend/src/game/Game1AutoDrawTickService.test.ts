/**
 * GAME1_SCHEDULE PR 4c Bolk 4: Tester for Game1AutoDrawTickService.
 *
 * Dekker:
 *   - tick: ingen running games → 0 draws trigget
 *   - tick: game med last_drawn_at + seconds <= now → drawNext kalt
 *   - tick: game ikke klar → skipped
 *   - tick: paused-game filtreres bort (SELECT ekskluderer)
 *   - tick: første draw bruker engine_started_at + seconds, ikke umiddelbart
 *   - tick: drawNext-feil blokkerer ikke tick for andre games
 *   - tick: seconds-resolution — top-level, nested, spill1-admin-form,
 *     default-fallback
 *   - tick: multiple games med ulike seconds → riktig per-game
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Game1AutoDrawTickService } from "./Game1AutoDrawTickService.js";
import type { Game1DrawEngineService } from "./Game1DrawEngineService.js";

// ── Stubs ───────────────────────────────────────────────────────────────────

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

function createStubPool(rows: unknown[]): {
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }> };
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  return {
    pool: {
      async query(sql: string, params: unknown[] = []) {
        queries.push({ sql, params });
        return { rows, rowCount: rows.length };
      },
    },
    queries,
  };
}

function makeFakeDrawEngine(opts: { throwOnIds?: string[] } = {}): {
  service: Game1DrawEngineService;
  called: string[];
} {
  const called: string[] = [];
  const service = {
    async drawNext(scheduledGameId: string) {
      called.push(scheduledGameId);
      if (opts.throwOnIds?.includes(scheduledGameId)) {
        throw new Error(`simulated drawNext failure for ${scheduledGameId}`);
      }
      return {};
    },
  } as unknown as Game1DrawEngineService;
  return { service, called };
}

function makeService(rows: unknown[], opts: Parameters<typeof makeFakeDrawEngine>[0] = {}) {
  const { pool, queries } = createStubPool(rows);
  const { service: drawEngine, called } = makeFakeDrawEngine(opts);
  const service = new Game1AutoDrawTickService({
    pool: pool as never,
    drawEngine,
  });
  return { service, drawEngine, called, queries };
}

// ── tick: ingen games ──────────────────────────────────────────────────────

test("tick: ingen running games → 0 draws", async () => {
  const { service, called } = makeService([]);
  const r = await service.tick();
  assert.equal(r.checked, 0);
  assert.equal(r.drawsTriggered, 0);
  assert.equal(called.length, 0);
});

// ── tick: game klar ────────────────────────────────────────────────────────

test("tick: game med last_drawn_at + seconds < now → drawNext trigget", async () => {
  const now = Date.now();
  const tenSecondsAgo = new Date(now - 10_000);
  const { service, called } = makeService([
    {
      id: "g1",
      ticket_config_json: { seconds: 5 },
      draws_completed: 3,
      last_drawn_at: tenSecondsAgo,
      engine_started_at: new Date(now - 60_000),
    },
  ]);
  const r = await service.tick();
  assert.equal(r.checked, 1);
  assert.equal(r.drawsTriggered, 1);
  assert.deepEqual(called, ["g1"]);
});

test("tick: game med last_drawn_at + seconds > now → skipped", async () => {
  const now = Date.now();
  const oneSecondAgo = new Date(now - 1_000);
  const { service, called } = makeService([
    {
      id: "g1",
      ticket_config_json: { seconds: 5 },
      draws_completed: 3,
      last_drawn_at: oneSecondAgo,
      engine_started_at: new Date(now - 60_000),
    },
  ]);
  const r = await service.tick();
  assert.equal(r.skippedNotDue, 1);
  assert.equal(r.drawsTriggered, 0);
  assert.equal(called.length, 0);
});

// ── Første draw — bruker engine_started_at + seconds ─────────────────────────

test("tick: første draw (last_drawn_at=null) → bruker engine_started_at + seconds", async () => {
  const now = Date.now();
  // engine startet for 10 sekunder siden, seconds=5 → due.
  const { service: svcDue, called: calledDue } = makeService([
    {
      id: "g1",
      ticket_config_json: { seconds: 5 },
      draws_completed: 0,
      last_drawn_at: null,
      engine_started_at: new Date(now - 10_000),
    },
  ]);
  const rDue = await svcDue.tick();
  assert.equal(rDue.drawsTriggered, 1);
  assert.deepEqual(calledDue, ["g1"]);

  // engine startet for 2 sekunder siden, seconds=5 → ikke due.
  const { service: svcNotDue, called: calledNotDue } = makeService([
    {
      id: "g1",
      ticket_config_json: { seconds: 5 },
      draws_completed: 0,
      last_drawn_at: null,
      engine_started_at: new Date(now - 2_000),
    },
  ]);
  const rNotDue = await svcNotDue.tick();
  assert.equal(rNotDue.drawsTriggered, 0);
  assert.equal(rNotDue.skippedNotDue, 1);
  assert.equal(calledNotDue.length, 0);
});

// ── Feilisolasjon ─────────────────────────────────────────────────────────

test("tick: drawNext-feil blokkerer ikke tick for andre games", async () => {
  const now = Date.now();
  const old = new Date(now - 10_000);
  const { service, called } = makeService(
    [
      {
        id: "g-fail",
        ticket_config_json: { seconds: 5 },
        draws_completed: 1,
        last_drawn_at: old,
        engine_started_at: old,
      },
      {
        id: "g-ok",
        ticket_config_json: { seconds: 5 },
        draws_completed: 1,
        last_drawn_at: old,
        engine_started_at: old,
      },
    ],
    { throwOnIds: ["g-fail"] }
  );
  const r = await service.tick();
  assert.equal(r.checked, 2);
  assert.equal(r.drawsTriggered, 1, "g-ok skal gå gjennom selv om g-fail feilet");
  assert.equal(r.errors, 1);
  assert.ok(r.errorMessages?.length === 1);
  assert.ok(r.errorMessages![0]!.includes("g-fail"));
  assert.deepEqual(called.sort(), ["g-fail", "g-ok"]);
});

// ── SELECT-query filter ────────────────────────────────────────────────────

test("tick: SELECT filtrerer på status='running' AND paused=false AND engine_ended_at IS NULL", async () => {
  const { service, queries } = makeService([]);
  await service.tick();
  assert.equal(queries.length, 1);
  const sql = queries[0]!.sql;
  assert.ok(sql.includes("sg.status = 'running'"));
  assert.ok(sql.includes("gs.paused = false"));
  assert.ok(sql.includes("gs.engine_ended_at IS NULL"));
});

// ── seconds-resolution ─────────────────────────────────────────────────────

test("tick: seconds fra ticket_config.spill1.timing.seconds (admin-form-shape)", async () => {
  const now = Date.now();
  const twoSecAgo = new Date(now - 2_000);
  const { service, called } = makeService([
    {
      id: "g1",
      // Admin-form: { spill1: { timing: { seconds: 1 } } }.
      ticket_config_json: { spill1: { timing: { seconds: 1 } } },
      draws_completed: 1,
      last_drawn_at: twoSecAgo, // 2s siden, seconds=1 → due.
      engine_started_at: twoSecAgo,
    },
  ]);
  const r = await service.tick();
  assert.equal(r.drawsTriggered, 1);
  assert.deepEqual(called, ["g1"]);
});

test("tick: seconds fra generisk timing.seconds", async () => {
  const now = Date.now();
  const twoSecAgo = new Date(now - 2_000);
  const { service, called } = makeService([
    {
      id: "g1",
      ticket_config_json: { timing: { seconds: 1 } },
      draws_completed: 1,
      last_drawn_at: twoSecAgo,
      engine_started_at: twoSecAgo,
    },
  ]);
  const r = await service.tick();
  assert.equal(r.drawsTriggered, 1);
  assert.deepEqual(called, ["g1"]);
});

test("tick: seconds default 5 hvis ticket_config ugyldig/mangler", async () => {
  const now = Date.now();
  const threeSecAgo = new Date(now - 3_000);
  const sixSecAgo = new Date(now - 6_000);
  // Default 5: 3s siden → ikke due, 6s siden → due.
  const { service: svcNotDue, called: calledNotDue } = makeService([
    {
      id: "g1",
      ticket_config_json: {},
      draws_completed: 1,
      last_drawn_at: threeSecAgo,
      engine_started_at: threeSecAgo,
    },
  ]);
  const r1 = await svcNotDue.tick();
  assert.equal(r1.drawsTriggered, 0);

  const { service: svcDue, called: calledDue } = makeService([
    {
      id: "g1",
      ticket_config_json: {},
      draws_completed: 1,
      last_drawn_at: sixSecAgo,
      engine_started_at: sixSecAgo,
    },
  ]);
  const r2 = await svcDue.tick();
  assert.equal(r2.drawsTriggered, 1);
  assert.deepEqual(calledDue, ["g1"]);
  assert.deepEqual(calledNotDue, []);
});

test("tick: seconds kan være string (numerisk) fra JSON-serialisering", async () => {
  const now = Date.now();
  const twoSecAgo = new Date(now - 2_000);
  const { service, called } = makeService([
    {
      id: "g1",
      ticket_config_json: { seconds: "1" },
      draws_completed: 1,
      last_drawn_at: twoSecAgo,
      engine_started_at: twoSecAgo,
    },
  ]);
  const r = await service.tick();
  assert.equal(r.drawsTriggered, 1);
});

test("tick: multiple games med ulike seconds-verdier beregnes per-game", async () => {
  const now = Date.now();
  const { service, called } = makeService([
    // g-1: seconds=10, last=5s siden → ikke due
    {
      id: "g-1",
      ticket_config_json: { seconds: 10 },
      draws_completed: 1,
      last_drawn_at: new Date(now - 5_000),
      engine_started_at: new Date(now - 60_000),
    },
    // g-2: seconds=3, last=5s siden → due
    {
      id: "g-2",
      ticket_config_json: { seconds: 3 },
      draws_completed: 1,
      last_drawn_at: new Date(now - 5_000),
      engine_started_at: new Date(now - 60_000),
    },
  ]);
  const r = await service.tick();
  assert.equal(r.checked, 2);
  assert.equal(r.drawsTriggered, 1);
  assert.equal(r.skippedNotDue, 1);
  assert.deepEqual(called, ["g-2"]);
});
