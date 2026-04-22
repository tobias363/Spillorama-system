/**
 * Scheduler-config-kobling: test at `Game1ScheduleTickService.spawnUpcomingGame1Games`
 * kopierer `GameManagement.config_json` fra daily.game_management_id inn i
 * `scheduled_games.game_config_json` ved spawn.
 *
 * Dekker:
 *   1. Happy path: daily har game_management_id → GameManagement-lookup →
 *      game_config_json settes til JSON-streng av GM.config_json.
 *   2. Bakoverkompat: daily har game_management_id=null → game_config_json=null.
 *   3. Fail-closed: GameManagement-query kaster (f.eks. tabell mangler) →
 *      spawn continues med game_config_json=null + warning logget.
 *   4. GM eksisterer men har {} config_json → game_config_json='{}' (tom JSON).
 *
 * Spec: docs/architecture/spill1-variantconfig-admin-coupling.md
 * (scheduler-fiks). Komplement til Game1ScheduleTickService.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Game1ScheduleTickService } from "./Game1ScheduleTickService.js";

// ── Stub-pool helper (matching Game1ScheduleTickService.test.ts shape) ────

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface StubResponse {
  match: (sql: string, params: unknown[]) => boolean;
  rows?: unknown[];
  rowCount?: number;
  throwErr?: { code?: string; message: string };
  once?: boolean;
}

function createStubPool(responses: StubResponse[]): {
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }> };
  queries: RecordedQuery[];
} {
  const queue = responses.slice();
  const queries: RecordedQuery[] = [];
  const runQuery = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    for (let i = 0; i < queue.length; i++) {
      const r = queue[i]!;
      if (r.match(sql, params)) {
        if (r.once !== false) queue.splice(i, 1);
        if (r.throwErr) {
          const err = Object.assign(new Error(r.throwErr.message), {
            code: r.throwErr.code,
          });
          throw err;
        }
        const rows = r.rows ?? [];
        return { rows, rowCount: r.rowCount ?? rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  };
  return { pool: { query: runQuery }, queries };
}

const fixedNow = Date.parse("2026-05-01T10:00:00.000Z"); // Fredag

function dailyRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "daily-1",
    name: "Plan A",
    hall_ids_json: {
      masterHallId: "hall-m",
      hallIds: ["hall-m", "hall-2"],
      groupHallIds: ["group-1"],
    },
    week_days: 0,
    start_date: "2026-05-01T00:00:00.000Z",
    end_date: "2026-05-10T23:59:59.000Z",
    start_time: "09:00",
    end_time: "23:00",
    status: "running",
    stop_game: false,
    other_data_json: { scheduleId: "sid-alpha" },
    game_management_id: "gm-1",
    ...overrides,
  };
}

function scheduleRow() {
  return {
    id: "sid-alpha",
    schedule_type: "Manual",
    sub_games_json: [
      {
        name: "Spill 1",
        startTime: "19:00",
        endTime: "19:45",
        notificationStartTime: "5m",
        ticketTypesData: { ticketType: ["Small Yellow"] },
        jackpotData: {},
      },
    ],
  };
}

// ── Test 1: Happy path — GM.config_json kopieres til game_config_json ────

test("scheduler-config-kobling: spawner med game_management_id → GM.config_json kopieres til game_config_json", async () => {
  const gmConfig = {
    spill1: {
      ticketColors: [
        {
          color: "small_yellow",
          priceNok: 20,
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 100 },
            row_2: { mode: "fixed", amount: 200 },
            full_house: { mode: "fixed", amount: 1000 },
          },
        },
        {
          color: "small_white",
          priceNok: 20,
          prizePerPattern: {
            row_1: { mode: "fixed", amount: 50 },
            full_house: { mode: "fixed", amount: 500 },
          },
        },
      ],
      jackpot: {
        prizeByColor: { yellow: 10000, white: 3000 },
        draw: 50,
      },
    },
  };

  const { pool, queries } = createStubPool([
    { match: (s) => s.includes("FROM ") && s.includes("app_daily_schedules"), rows: [dailyRow()] },
    { match: (s) => s.includes("FROM ") && s.includes("app_schedules"), rows: [scheduleRow()] },
    { match: (s) => s.includes("FROM ") && s.includes("app_game_management"), rows: [{ id: "gm-1", config_json: gmConfig }] },
    { match: (s) => s.includes("SELECT daily_schedule_id"), rows: [] },
  ]);

  const svc = Game1ScheduleTickService.forTesting(pool as unknown as import("pg").Pool);
  const result = await svc.spawnUpcomingGame1Games(fixedNow);

  assert.ok(result.spawned >= 1, "should spawn at least one row");
  const inserts = queries.filter((q) => q.sql.includes("INSERT INTO") && q.sql.includes("app_game1_scheduled_games"));
  assert.ok(inserts.length >= 1, "INSERT INTO app_game1_scheduled_games ble kalt");

  // Params-layout (17 params): [id, dailyId, scheduleId, subIndex, subName,
  // customName, day, start, end, notifSec, ticketJson, jackpotJson,
  // gameMode, masterHall, groupHall, participatingJson, gameConfigJson].
  const firstInsert = inserts[0]!;
  assert.equal(firstInsert.params.length, 17, "INSERT har 17 params etter scheduler-fiks");
  const gameConfigParam = firstInsert.params[16];
  assert.ok(typeof gameConfigParam === "string", "game_config_json-param er JSON-streng");
  const parsed = JSON.parse(gameConfigParam as string);
  assert.deepEqual(parsed, gmConfig, "game_config_json = GM.config_json 1:1");
});

// ── Test 2: Bakoverkompat — daily uten game_management_id → game_config_json=null

test("scheduler-config-kobling: daily uten game_management_id → game_config_json=null (bakoverkompat)", async () => {
  const { pool, queries } = createStubPool([
    {
      match: (s) => s.includes("FROM ") && s.includes("app_daily_schedules"),
      rows: [dailyRow({ game_management_id: null })],
    },
    { match: (s) => s.includes("FROM ") && s.includes("app_schedules"), rows: [scheduleRow()] },
    // Ingen GM-query forventet (ingen ID å slå opp).
    { match: (s) => s.includes("SELECT daily_schedule_id"), rows: [] },
  ]);

  const svc = Game1ScheduleTickService.forTesting(pool as unknown as import("pg").Pool);
  const result = await svc.spawnUpcomingGame1Games(fixedNow);
  assert.ok(result.spawned >= 1);

  const gmQuery = queries.find((q) => q.sql.includes("app_game_management"));
  assert.equal(gmQuery, undefined, "ingen GM-lookup når game_management_id=null");

  const inserts = queries.filter((q) => q.sql.includes("INSERT INTO") && q.sql.includes("app_game1_scheduled_games"));
  for (const ins of inserts) {
    assert.equal(ins.params[16], null, "game_config_json=null på alle spawns");
  }
});

// ── Test 3: Fail-closed — GM-query kaster → spawn fortsetter med null ─

test("scheduler-config-kobling: GM-query kaster → game_config_json=null + spawn fortsetter (fail-closed)", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.includes("FROM ") && s.includes("app_daily_schedules"), rows: [dailyRow()] },
    { match: (s) => s.includes("FROM ") && s.includes("app_schedules"), rows: [scheduleRow()] },
    {
      match: (s) => s.includes("FROM ") && s.includes("app_game_management"),
      throwErr: { code: "42P01", message: "relation app_game_management does not exist" },
    },
    { match: (s) => s.includes("SELECT daily_schedule_id"), rows: [] },
  ]);

  const svc = Game1ScheduleTickService.forTesting(pool as unknown as import("pg").Pool);
  const result = await svc.spawnUpcomingGame1Games(fixedNow);
  // Spawn skal ikke kaste pga konfig-feil (fail-closed: logg warning, fortsett).
  assert.ok(result.spawned >= 1, "spawn fortsetter selv om GM-lookup feiler");

  const inserts = queries.filter((q) => q.sql.includes("INSERT INTO") && q.sql.includes("app_game1_scheduled_games"));
  for (const ins of inserts) {
    assert.equal(ins.params[16], null, "game_config_json=null etter GM-lookup-feil");
  }
});

// ── Test 4: GM eksisterer men config_json er {} ─────────────────────────

test("scheduler-config-kobling: GM med tom config_json → game_config_json='{}'", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.includes("FROM ") && s.includes("app_daily_schedules"), rows: [dailyRow()] },
    { match: (s) => s.includes("FROM ") && s.includes("app_schedules"), rows: [scheduleRow()] },
    { match: (s) => s.includes("FROM ") && s.includes("app_game_management"), rows: [{ id: "gm-1", config_json: {} }] },
    { match: (s) => s.includes("SELECT daily_schedule_id"), rows: [] },
  ]);

  const svc = Game1ScheduleTickService.forTesting(pool as unknown as import("pg").Pool);
  await svc.spawnUpcomingGame1Games(fixedNow);

  const inserts = queries.filter((q) => q.sql.includes("INSERT INTO") && q.sql.includes("app_game1_scheduled_games"));
  assert.ok(inserts.length >= 1);
  assert.equal(inserts[0]!.params[16], "{}", "tom GM.config_json serialiseres til '{}'");
});

// ── Test 5: Multiple dailies med samme GM batches én GM-query ──────────

test("scheduler-config-kobling: flere dailies med samme game_management_id → én GM-query (batch)", async () => {
  const { pool, queries } = createStubPool([
    {
      match: (s) => s.includes("FROM ") && s.includes("app_daily_schedules"),
      rows: [
        dailyRow({ id: "daily-a" }),
        dailyRow({
          id: "daily-b",
          hall_ids_json: {
            masterHallId: "hall-x",
            hallIds: ["hall-x"],
            groupHallIds: ["group-2"],
          },
        }),
      ],
    },
    { match: (s) => s.includes("FROM ") && s.includes("app_schedules"), rows: [scheduleRow()] },
    {
      match: (s) => s.includes("FROM ") && s.includes("app_game_management"),
      rows: [{ id: "gm-1", config_json: { spill1: { ticketColors: [] } } }],
    },
    { match: (s) => s.includes("SELECT daily_schedule_id"), rows: [] },
  ]);

  const svc = Game1ScheduleTickService.forTesting(pool as unknown as import("pg").Pool);
  await svc.spawnUpcomingGame1Games(fixedNow);

  const gmQueries = queries.filter((q) => q.sql.includes("app_game_management"));
  assert.equal(gmQueries.length, 1, "én GM-query selv om flere dailies deler ID");
  // Query params er ANY($1::text[]) → skal inneholde ["gm-1"].
  assert.deepEqual(gmQueries[0]!.params[0], ["gm-1"], "batched unique IDs");
});
