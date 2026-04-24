/**
 * GAME1_SCHEDULE PR 1: unit-tester for Game1ScheduleTickService.
 *
 * Testene bruker en stub-pool som samler inn SQL + params for verifisering
 * og kan returnere preset-resultater. Matcher testmønsteret fra
 * ScheduleService.test.ts og swedbankPaymentSync.test.ts.
 *
 * Dekker:
 *   - parseNotificationStartToSeconds ("5m"/"60s"/tall/tom)
 *   - combineDayAndTime (gyldig + ugyldig input)
 *   - resolveScheduleIdForDay (scalar + per-day mapping)
 *   - spawnUpcomingGame1Games (happy path + idempotens + gap-håndtering)
 *   - openPurchaseForImminentGames
 *   - cancelEndOfDayUnstartedGames
 *   - transitionReadyToStartGames (PR 2)
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  combineDayAndTime,
  Game1ScheduleTickService,
  parseNotificationStartToSeconds,
  resolveScheduleIdForDay,
} from "./Game1ScheduleTickService.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

interface RecordedQuery {
  sql: string;
  params: unknown[];
  result: { rows: unknown[]; rowCount: number };
}

interface StubPoolConfig {
  /**
   * Queue of `{ when, rows }`. When the stub sees an incoming query, it
   * matches against the first `when.match(sql)` that returns true, uses
   * that row-set, and removes it from the queue. If no match, returns
   * empty rows.
   */
  responses?: Array<{
    match: (sql: string) => boolean;
    rows: unknown[];
    rowCount?: number;
  }>;
}

function createStubPool(config: StubPoolConfig = {}): {
  pool: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }> };
  queries: RecordedQuery[];
} {
  const responses = config.responses?.slice() ?? [];
  const queries: RecordedQuery[] = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      let rows: unknown[] = [];
      let rowCount = 0;
      for (let i = 0; i < responses.length; i++) {
        const r = responses[i]!;
        if (r.match(sql)) {
          rows = r.rows;
          rowCount = r.rowCount ?? r.rows.length;
          responses.splice(i, 1);
          break;
        }
      }
      const result = { rows, rowCount };
      queries.push({ sql, params, result });
      return result;
    },
  };
  return { pool, queries };
}

// ── parseNotificationStartToSeconds ──────────────────────────────────────────

test("parseNotificationStartToSeconds: '5m' → 300 sekunder", () => {
  assert.equal(parseNotificationStartToSeconds("5m"), 300);
});

test("parseNotificationStartToSeconds: '60s' → 60 sekunder", () => {
  assert.equal(parseNotificationStartToSeconds("60s"), 60);
});

test("parseNotificationStartToSeconds: '30' (tall som string, ingen suffix) → 30 sekunder", () => {
  assert.equal(parseNotificationStartToSeconds("30"), 30);
});

test("parseNotificationStartToSeconds: number → avkortet til heltall", () => {
  assert.equal(parseNotificationStartToSeconds(120), 120);
});

test("parseNotificationStartToSeconds: undefined → 300 (default 5m)", () => {
  assert.equal(parseNotificationStartToSeconds(undefined), 300);
});

test("parseNotificationStartToSeconds: '' → 300", () => {
  assert.equal(parseNotificationStartToSeconds(""), 300);
});

test("parseNotificationStartToSeconds: 'foo' → 300 (ugyldig format)", () => {
  assert.equal(parseNotificationStartToSeconds("foo"), 300);
});

test("parseNotificationStartToSeconds: '10M' (uppercase) → 600", () => {
  assert.equal(parseNotificationStartToSeconds("10M"), 600);
});

// ── combineDayAndTime ─────────────────────────────────────────────────────────

test("combineDayAndTime: '2026-05-01' + '14:30' → UTC-dato", () => {
  const d = combineDayAndTime("2026-05-01", "14:30");
  assert.ok(d);
  assert.equal(d!.toISOString(), "2026-05-01T14:30:00.000Z");
});

test("combineDayAndTime: ugyldig dato → null", () => {
  assert.equal(combineDayAndTime("2026-13-99", "14:30"), null);
  assert.equal(combineDayAndTime("not-a-date", "14:30"), null);
});

test("combineDayAndTime: ugyldig tid → null", () => {
  assert.equal(combineDayAndTime("2026-05-01", "99:00"), null);
  assert.equal(combineDayAndTime("2026-05-01", "not-a-time"), null);
});

// ── resolveScheduleIdForDay ──────────────────────────────────────────────────

test("resolveScheduleIdForDay: scalar scheduleId gjelder for alle dager", () => {
  const other = { scheduleId: "sid-alpha" };
  for (let jsDay = 0; jsDay <= 6; jsDay++) {
    assert.equal(resolveScheduleIdForDay(other, jsDay), "sid-alpha");
  }
});

test("resolveScheduleIdForDay: scheduleIdByDay mapping", () => {
  const other = {
    scheduleIdByDay: {
      monday: "sid-mon",
      tue: "sid-tue",
      wed: "sid-wed",
    },
  };
  assert.equal(resolveScheduleIdForDay(other, 1), "sid-mon"); // mon
  assert.equal(resolveScheduleIdForDay(other, 2), "sid-tue"); // tue via "tue"
  assert.equal(resolveScheduleIdForDay(other, 3), "sid-wed"); // wed
  assert.equal(resolveScheduleIdForDay(other, 4), null); // thu — ikke mapped
});

test("resolveScheduleIdForDay: scalar tar forrang over per-day", () => {
  const other = {
    scheduleId: "sid-scalar",
    scheduleIdByDay: { monday: "sid-mon" },
  };
  assert.equal(resolveScheduleIdForDay(other, 1), "sid-scalar");
});

test("resolveScheduleIdForDay: tom otherData → null", () => {
  assert.equal(resolveScheduleIdForDay({}, 1), null);
});

// ── spawnUpcomingGame1Games — happy path ──────────────────────────────────────

const fixedNow = Date.parse("2026-05-01T10:00:00.000Z"); // Friday

test("spawnUpcomingGame1Games: happy path — spawner én rad per subGame i vinduet", async () => {
  const { pool, queries } = createStubPool({
    responses: [
      // 1) SELECT daily_schedules
      {
        match: (sql) => sql.includes("FROM ") && sql.includes("app_daily_schedules"),
        rows: [
          {
            id: "daily-1",
            name: "Plan A",
            hall_ids_json: {
              masterHallId: "hall-m",
              hallIds: ["hall-m", "hall-2", "hall-3"],
              groupHallIds: ["group-1"],
            },
            week_days: 0, // no weekday filter — matches all days in range
            start_date: "2026-05-01T00:00:00.000Z",
            end_date: "2026-05-10T23:59:59.000Z",
            start_time: "09:00",
            end_time: "23:00",
            status: "running",
            stop_game: false,
            other_data_json: { scheduleId: "sid-alpha" },
          },
        ],
      },
      // 2) SELECT schedules
      {
        match: (sql) => sql.includes("FROM ") && sql.includes("app_schedules"),
        rows: [
          {
            id: "sid-alpha",
            schedule_type: "Manual",
            sub_games_json: [
              {
                name: "Traffic Light",
                customGameName: "Lys",
                startTime: "19:00",
                endTime: "19:45",
                notificationStartTime: "5m",
                ticketTypesData: { ticketType: ["Small Yellow"] },
                jackpotData: { jackpotPrize: { white: 1000 } },
              },
              {
                name: "Jackpot",
                startTime: "20:00",
                endTime: "20:30",
                notificationStartTime: "60s",
                ticketTypesData: {},
                jackpotData: {},
              },
            ],
          },
        ],
      },
      // 3) SELECT existing rows (returns empty — no existing spawns)
      {
        match: (sql) => sql.includes("SELECT daily_schedule_id"),
        rows: [],
      },
    ],
  });

  const svc = Game1ScheduleTickService.forTesting(
    pool as unknown as import("pg").Pool
  );
  const result = await svc.spawnUpcomingGame1Games(fixedNow);

  // 1 day (today → now + 24h spans 2 calendar days) × 2 subGames
  // At fixedNow = 2026-05-01 10:00 UTC, window goes to 2026-05-02 10:00 UTC.
  // For 2026-05-01: slot 1 (19:00) and slot 2 (20:00) both in future → 2 rows.
  // For 2026-05-02: also in window — slots at 19:00 and 20:00 → 2 more rows.
  // Total = 4 spawned rows.
  assert.equal(result.spawned, 4, "should spawn 4 rows (2 days × 2 subGames)");
  assert.equal(result.skipped, 0);
  assert.equal(result.errors, 0);

  // Verifiser at INSERT ble kalt med riktige params (første spawn).
  const inserts = queries.filter((q) => q.sql.includes("INSERT INTO"));
  assert.equal(inserts.length, 4);
  const firstInsert = inserts[0]!;
  // params: [id, dailyId, scheduleId, subIndex, subName, customName, day,
  //          start, end, notifSec, ticketJson, jackpotJson, gameMode,
  //          masterHall, groupHall, participatingJson]
  assert.equal(firstInsert.params[1], "daily-1");
  assert.equal(firstInsert.params[2], "sid-alpha");
  assert.equal(firstInsert.params[3], 0); // first subGame index
  assert.equal(firstInsert.params[4], "Traffic Light");
  assert.equal(firstInsert.params[5], "Lys");
  assert.equal(firstInsert.params[9], 300); // 5m = 300 sec
  assert.equal(firstInsert.params[12], "Manual");
  assert.equal(firstInsert.params[13], "hall-m");
  assert.equal(firstInsert.params[14], "group-1");
});

test("K1-C: spawnUpcomingGame1Games fletter subGame.extra.luckyBonus inn i ticket_config_json", async () => {
  const { pool, queries } = createStubPool({
    responses: [
      {
        match: (sql) => sql.includes("FROM ") && sql.includes("app_daily_schedules"),
        rows: [
          {
            id: "daily-1",
            name: "Plan A",
            hall_ids_json: {
              masterHallId: "hall-m",
              hallIds: ["hall-m"],
              groupHallIds: ["group-1"],
            },
            week_days: 0,
            start_date: "2026-05-01T00:00:00.000Z",
            end_date: "2026-05-10T23:59:59.000Z",
            start_time: "09:00",
            end_time: "23:00",
            status: "running",
            stop_game: false,
            other_data_json: { scheduleId: "sid-lb" },
          },
        ],
      },
      {
        match: (sql) => sql.includes("FROM ") && sql.includes("app_schedules"),
        rows: [
          {
            id: "sid-lb",
            schedule_type: "Manual",
            sub_games_json: [
              {
                name: "LB Test",
                startTime: "19:00",
                endTime: "19:45",
                notificationStartTime: "5m",
                ticketTypesData: { ticketType: ["Small Yellow"] },
                jackpotData: {},
                extra: {
                  luckyBonus: { amountCents: 10000, enabled: true },
                },
              },
            ],
          },
        ],
      },
      {
        match: (sql) => sql.includes("SELECT daily_schedule_id"),
        rows: [],
      },
    ],
  });

  const svc = Game1ScheduleTickService.forTesting(
    pool as unknown as import("pg").Pool
  );
  await svc.spawnUpcomingGame1Games(fixedNow);

  const inserts = queries.filter((q) => q.sql.includes("INSERT INTO"));
  assert.ok(inserts.length > 0, "minst 1 spawn");
  const firstInsert = inserts[0]!;
  // params[10] = ticket_config_json (JSON-string).
  const ticketJson = JSON.parse(firstInsert.params[10] as string);
  assert.deepEqual(
    ticketJson.luckyBonus,
    { amountCents: 10000, enabled: true },
    "luckyBonus fra extra flettet inn i ticket_config_json"
  );
  // Eksisterende ticketTypesData-felt må bevares ved siden av.
  assert.deepEqual(ticketJson.ticketType, ["Small Yellow"]);
});

test("K1-C: spawnUpcomingGame1Games UTEN extra.luckyBonus → ingen luckyBonus-nøkkel", async () => {
  const { pool, queries } = createStubPool({
    responses: [
      {
        match: (sql) => sql.includes("FROM ") && sql.includes("app_daily_schedules"),
        rows: [
          {
            id: "daily-1",
            name: "Plan A",
            hall_ids_json: {
              masterHallId: "hall-m",
              hallIds: ["hall-m"],
              groupHallIds: ["group-1"],
            },
            week_days: 0,
            start_date: "2026-05-01T00:00:00.000Z",
            end_date: "2026-05-10T23:59:59.000Z",
            start_time: "09:00",
            end_time: "23:00",
            status: "running",
            stop_game: false,
            other_data_json: { scheduleId: "sid-nolb" },
          },
        ],
      },
      {
        match: (sql) => sql.includes("FROM ") && sql.includes("app_schedules"),
        rows: [
          {
            id: "sid-nolb",
            schedule_type: "Manual",
            sub_games_json: [
              {
                name: "No LB",
                startTime: "19:00",
                endTime: "19:45",
                notificationStartTime: "5m",
                ticketTypesData: { ticketType: ["Small Yellow"] },
                jackpotData: {},
              },
            ],
          },
        ],
      },
      {
        match: (sql) => sql.includes("SELECT daily_schedule_id"),
        rows: [],
      },
    ],
  });

  const svc = Game1ScheduleTickService.forTesting(
    pool as unknown as import("pg").Pool
  );
  await svc.spawnUpcomingGame1Games(fixedNow);

  const inserts = queries.filter((q) => q.sql.includes("INSERT INTO"));
  const firstInsert = inserts[0]!;
  const ticketJson = JSON.parse(firstInsert.params[10] as string);
  assert.equal(
    ticketJson.luckyBonus,
    undefined,
    "uten extra.luckyBonus → ingen nøkkel satt (bakoverkompat)"
  );
});

test("spawnUpcomingGame1Games: idempotent — hopper over eksisterende rader", async () => {
  const { pool } = createStubPool({
    responses: [
      {
        match: (sql) => sql.includes("app_daily_schedules"),
        rows: [
          {
            id: "daily-1",
            name: "Plan A",
            hall_ids_json: {
              masterHallId: "hall-m",
              hallIds: ["hall-m"],
              groupHallIds: ["group-1"],
            },
            week_days: 0,
            start_date: "2026-05-01T00:00:00.000Z",
            end_date: null,
            start_time: "09:00",
            end_time: "23:00",
            status: "running",
            stop_game: false,
            other_data_json: { scheduleId: "sid-alpha" },
          },
        ],
      },
      {
        match: (sql) => sql.includes("app_schedules") && sql.includes("sub_games_json"),
        rows: [
          {
            id: "sid-alpha",
            schedule_type: "Manual",
            sub_games_json: [
              {
                name: "X",
                startTime: "19:00",
                endTime: "19:45",
                notificationStartTime: "5m",
              },
            ],
          },
        ],
      },
      {
        match: (sql) => sql.includes("SELECT daily_schedule_id"),
        rows: [
          { daily_schedule_id: "daily-1", scheduled_day: "2026-05-01", sub_game_index: 0 },
          { daily_schedule_id: "daily-1", scheduled_day: "2026-05-02", sub_game_index: 0 },
        ],
      },
    ],
  });

  const svc = Game1ScheduleTickService.forTesting(
    pool as unknown as import("pg").Pool
  );
  const result = await svc.spawnUpcomingGame1Games(fixedNow);
  assert.equal(result.spawned, 0, "alle dager allerede spawned");
  assert.equal(result.skipped, 2);
});

test("spawnUpcomingGame1Games: hopper over daily_schedules med stopGame=true via query (ikke returnert)", async () => {
  // Test at SQL query-en filtrerer på stop_game=false. Siden vår stub bare
  // returnerer en tom rad-liste når daily_schedules er filtrert ut, verifiserer
  // vi at ingen INSERT blir forsøkt.
  const { pool, queries } = createStubPool({
    responses: [
      { match: (sql) => sql.includes("app_daily_schedules"), rows: [] },
    ],
  });
  const svc = Game1ScheduleTickService.forTesting(
    pool as unknown as import("pg").Pool
  );
  const result = await svc.spawnUpcomingGame1Games(fixedNow);
  assert.equal(result.spawned, 0);

  // Verify that the daily_schedules query filters on status + stop_game.
  const dailyQuery = queries.find((q) => q.sql.includes("app_daily_schedules"));
  assert.ok(dailyQuery);
  assert.match(dailyQuery!.sql, /status\s*=\s*'running'/);
  assert.match(dailyQuery!.sql, /stop_game\s*=\s*false/);
});

test("spawnUpcomingGame1Games: skipper daily_schedules uten scheduleId i otherData", async () => {
  const { pool } = createStubPool({
    responses: [
      {
        match: (sql) => sql.includes("app_daily_schedules"),
        rows: [
          {
            id: "daily-nokid",
            name: "NoSchedule",
            hall_ids_json: {
              masterHallId: "hall-m",
              hallIds: ["hall-m"],
              groupHallIds: ["group-1"],
            },
            week_days: 0,
            start_date: "2026-05-01T00:00:00.000Z",
            end_date: null,
            start_time: "09:00",
            end_time: "23:00",
            status: "running",
            stop_game: false,
            other_data_json: {}, // ingen scheduleId
          },
        ],
      },
    ],
  });
  const svc = Game1ScheduleTickService.forTesting(
    pool as unknown as import("pg").Pool
  );
  const result = await svc.spawnUpcomingGame1Games(fixedNow);
  assert.equal(result.spawned, 0);
  assert.ok(result.skippedSchedules >= 1);
});

test("spawnUpcomingGame1Games: respekterer week_days bitmask", async () => {
  // fixedNow = Friday 2026-05-01. week_days = 1 (mon only) skal hoppe over fredag og lørdag.
  const { pool } = createStubPool({
    responses: [
      {
        match: (sql) => sql.includes("app_daily_schedules"),
        rows: [
          {
            id: "daily-mon",
            name: "MonOnly",
            hall_ids_json: {
              masterHallId: "hall-m",
              hallIds: ["hall-m"],
              groupHallIds: ["group-1"],
            },
            week_days: 1, // kun mandag (mon=1)
            start_date: "2026-05-01T00:00:00.000Z",
            end_date: null,
            start_time: "09:00",
            end_time: "23:00",
            status: "running",
            stop_game: false,
            other_data_json: { scheduleId: "sid-alpha" },
          },
        ],
      },
      {
        match: (sql) => sql.includes("app_schedules") && sql.includes("sub_games_json"),
        rows: [
          {
            id: "sid-alpha",
            schedule_type: "Manual",
            sub_games_json: [
              {
                name: "X",
                startTime: "19:00",
                endTime: "19:45",
                notificationStartTime: "5m",
              },
            ],
          },
        ],
      },
      { match: (sql) => sql.includes("SELECT daily_schedule_id"), rows: [] },
    ],
  });
  const svc = Game1ScheduleTickService.forTesting(
    pool as unknown as import("pg").Pool
  );
  const result = await svc.spawnUpcomingGame1Games(fixedNow);
  // Vinduet er fredag 2026-05-01 10:00 → lørdag 2026-05-02 10:00 — ingen mandag i vinduet.
  assert.equal(result.spawned, 0);
});

test("spawnUpcomingGame1Games: teller errors når subGame mangler startTime", async () => {
  const { pool } = createStubPool({
    responses: [
      {
        match: (sql) => sql.includes("app_daily_schedules"),
        rows: [
          {
            id: "daily-1",
            name: "P",
            hall_ids_json: {
              masterHallId: "hall-m",
              hallIds: ["hall-m"],
              groupHallIds: ["group-1"],
            },
            week_days: 0,
            start_date: "2026-05-01T00:00:00.000Z",
            end_date: null,
            start_time: "09:00",
            end_time: "23:00",
            status: "running",
            stop_game: false,
            other_data_json: { scheduleId: "sid-alpha" },
          },
        ],
      },
      {
        match: (sql) => sql.includes("app_schedules") && sql.includes("sub_games_json"),
        rows: [
          {
            id: "sid-alpha",
            schedule_type: "Manual",
            sub_games_json: [
              {
                name: "NoTimes",
                // mangler startTime + endTime
                notificationStartTime: "5m",
              },
            ],
          },
        ],
      },
      { match: (sql) => sql.includes("SELECT daily_schedule_id"), rows: [] },
    ],
  });
  const svc = Game1ScheduleTickService.forTesting(
    pool as unknown as import("pg").Pool
  );
  const result = await svc.spawnUpcomingGame1Games(fixedNow);
  assert.equal(result.spawned, 0);
  // 2 days in the window, each hitting the missing-startTime error.
  assert.ok(result.errors >= 1);
  assert.ok(Array.isArray(result.errorMessages));
  assert.match(result.errorMessages![0]!, /mangler startTime/);
});

// ── openPurchaseForImminentGames ──────────────────────────────────────────────

test("openPurchaseForImminentGames: sender korrekt UPDATE og returnerer row-count", async () => {
  const { pool, queries } = createStubPool({
    responses: [
      {
        match: (sql) => sql.includes("UPDATE") && sql.includes("purchase_open"),
        rows: [],
        rowCount: 3,
      },
    ],
  });
  const svc = Game1ScheduleTickService.forTesting(
    pool as unknown as import("pg").Pool
  );
  const count = await svc.openPurchaseForImminentGames(fixedNow);
  assert.equal(count, 3);
  assert.equal(queries.length, 1);
  assert.match(queries[0]!.sql, /SET status = 'purchase_open'/);
  assert.match(queries[0]!.sql, /WHERE status = 'scheduled'/);
});

// ── cancelEndOfDayUnstartedGames ──────────────────────────────────────────────

test("cancelEndOfDayUnstartedGames: marker rader cancelled med stop_reason", async () => {
  const { pool, queries } = createStubPool({
    responses: [
      {
        match: (sql) => sql.includes("UPDATE") && sql.includes("end_of_day_unreached"),
        rows: [],
        rowCount: 2,
      },
    ],
  });
  const svc = Game1ScheduleTickService.forTesting(
    pool as unknown as import("pg").Pool
  );
  const count = await svc.cancelEndOfDayUnstartedGames(fixedNow);
  assert.equal(count, 2);
  assert.equal(queries.length, 1);
  assert.match(queries[0]!.sql, /stop_reason = 'end_of_day_unreached'/);
  assert.match(
    queries[0]!.sql,
    /status IN \('scheduled', 'purchase_open', 'ready_to_start'\)/
  );
});

// ── transitionReadyToStartGames (PR 2) ────────────────────────────────────────

test("transitionReadyToStartGames: flipper purchase_open → ready_to_start når alle haller klare", async () => {
  const { pool, queries } = createStubPool({
    responses: [
      {
        match: (sql) =>
          sql.includes("SELECT id, participating_halls_json, master_hall_id") &&
          sql.includes("status = 'purchase_open'"),
        rows: [
          {
            id: "game-1",
            participating_halls_json: ["hall-1", "hall-2"],
            master_hall_id: "hall-1",
          },
        ],
      },
      {
        match: (sql) =>
          sql.includes("SELECT hall_id, is_ready, excluded_from_game"),
        rows: [
          { hall_id: "hall-1", is_ready: true, excluded_from_game: false },
          { hall_id: "hall-2", is_ready: true, excluded_from_game: false },
        ],
      },
      {
        match: (sql) =>
          sql.includes("SET status = 'ready_to_start'"),
        rows: [],
        rowCount: 1,
      },
    ],
  });
  const svc = Game1ScheduleTickService.forTesting(
    pool as unknown as import("pg").Pool
  );
  const count = await svc.transitionReadyToStartGames(fixedNow);
  assert.equal(count, 1);
  // Verify final UPDATE has status='purchase_open' guard for idempotens.
  const upd = queries.find((q) => q.sql.includes("SET status = 'ready_to_start'"));
  assert.ok(upd, "forventet UPDATE-query");
  assert.match(upd!.sql, /status = 'purchase_open'/);
});

test("transitionReadyToStartGames: hopper over når en hall mangler ready-rad", async () => {
  const { pool } = createStubPool({
    responses: [
      {
        match: (sql) =>
          sql.includes("SELECT id, participating_halls_json, master_hall_id"),
        rows: [
          {
            id: "game-1",
            participating_halls_json: ["hall-1", "hall-2"],
            master_hall_id: "hall-1",
          },
        ],
      },
      {
        match: (sql) =>
          sql.includes("SELECT hall_id, is_ready, excluded_from_game"),
        rows: [
          { hall_id: "hall-1", is_ready: true, excluded_from_game: false },
          // hall-2 mangler rad
        ],
      },
    ],
  });
  const svc = Game1ScheduleTickService.forTesting(
    pool as unknown as import("pg").Pool
  );
  const count = await svc.transitionReadyToStartGames(fixedNow);
  assert.equal(count, 0);
});

test("transitionReadyToStartGames: teller ikke excluded haller i 'allReady'", async () => {
  const { pool } = createStubPool({
    responses: [
      {
        match: (sql) =>
          sql.includes("SELECT id, participating_halls_json, master_hall_id"),
        rows: [
          {
            id: "game-1",
            participating_halls_json: ["hall-1", "hall-2"],
            master_hall_id: "hall-1",
          },
        ],
      },
      {
        match: (sql) =>
          sql.includes("SELECT hall_id, is_ready, excluded_from_game"),
        rows: [
          { hall_id: "hall-1", is_ready: true, excluded_from_game: false },
          { hall_id: "hall-2", is_ready: false, excluded_from_game: true },
        ],
      },
      {
        match: (sql) => sql.includes("SET status = 'ready_to_start'"),
        rows: [],
        rowCount: 1,
      },
    ],
  });
  const svc = Game1ScheduleTickService.forTesting(
    pool as unknown as import("pg").Pool
  );
  const count = await svc.transitionReadyToStartGames(fixedNow);
  assert.equal(count, 1);
});

test("transitionReadyToStartGames: håndterer JSONB-string (Pool returnerer string)", async () => {
  const { pool } = createStubPool({
    responses: [
      {
        match: (sql) =>
          sql.includes("SELECT id, participating_halls_json, master_hall_id"),
        rows: [
          {
            id: "game-1",
            participating_halls_json: JSON.stringify(["hall-1"]),
            master_hall_id: "hall-1",
          },
        ],
      },
      {
        match: (sql) =>
          sql.includes("SELECT hall_id, is_ready, excluded_from_game"),
        rows: [{ hall_id: "hall-1", is_ready: true, excluded_from_game: false }],
      },
      {
        match: (sql) => sql.includes("SET status = 'ready_to_start'"),
        rows: [],
        rowCount: 1,
      },
    ],
  });
  const svc = Game1ScheduleTickService.forTesting(
    pool as unknown as import("pg").Pool
  );
  const count = await svc.transitionReadyToStartGames(fixedNow);
  assert.equal(count, 1);
});

test("transitionReadyToStartGames: ingen kandidater → 0, ingen videre query", async () => {
  const { pool, queries } = createStubPool({
    responses: [
      {
        match: (sql) =>
          sql.includes("SELECT id, participating_halls_json, master_hall_id"),
        rows: [],
      },
    ],
  });
  const svc = Game1ScheduleTickService.forTesting(
    pool as unknown as import("pg").Pool
  );
  const count = await svc.transitionReadyToStartGames(fixedNow);
  assert.equal(count, 0);
  assert.equal(queries.length, 1);
});

// ── detectMasterTimeout (PR 3) ────────────────────────────────────────────────

test("detectMasterTimeout: ingen kandidater → { gameIds: [] }", async () => {
  const { pool } = createStubPool({
    responses: [
      {
        match: (sql) => sql.includes("SELECT id, master_hall_id, group_hall_id, updated_at"),
        rows: [],
      },
    ],
  });
  const svc = Game1ScheduleTickService.forTesting(
    pool as unknown as import("pg").Pool
  );
  const result = await svc.detectMasterTimeout(fixedNow);
  assert.deepEqual(result.gameIds, []);
});

test("detectMasterTimeout: kandidat uten tidligere audit → skriver rad + returnerer id", async () => {
  const { pool, queries } = createStubPool({
    responses: [
      {
        match: (sql) => sql.includes("SELECT id, master_hall_id, group_hall_id, updated_at"),
        rows: [
          {
            id: "g-timeout",
            master_hall_id: "hall-m",
            group_hall_id: "grp-1",
            updated_at: new Date(fixedNow - 20 * 60 * 1000).toISOString(),
          },
        ],
      },
      {
        match: (sql) => sql.includes("COUNT(*)") && sql.includes("timeout_detected"),
        rows: [{ count: "0" }],
      },
      {
        match: (sql) => sql.includes("hall_id, is_ready, excluded_from_game"),
        rows: [],
      },
      {
        match: (sql) => sql.includes("INSERT INTO") && sql.includes("master_audit"),
        rows: [],
      },
    ],
  });
  const svc = Game1ScheduleTickService.forTesting(
    pool as unknown as import("pg").Pool
  );
  const result = await svc.detectMasterTimeout(fixedNow);
  assert.deepEqual(result.gameIds, ["g-timeout"]);
  const auditInsert = queries.find(
    (q) => q.sql.includes("master_audit") && q.sql.includes("INSERT")
  );
  assert.ok(auditInsert);
  assert.equal(auditInsert!.params[1], "g-timeout");
});

test("detectMasterTimeout: idempotent — hopper over hvis audit allerede finnes", async () => {
  const { pool } = createStubPool({
    responses: [
      {
        match: (sql) => sql.includes("SELECT id, master_hall_id, group_hall_id, updated_at"),
        rows: [
          {
            id: "g-already",
            master_hall_id: "hall-m",
            group_hall_id: "grp-1",
            updated_at: new Date(fixedNow - 20 * 60 * 1000).toISOString(),
          },
        ],
      },
      {
        match: (sql) => sql.includes("COUNT(*)") && sql.includes("timeout_detected"),
        rows: [{ count: "1" }],
      },
    ],
  });
  const svc = Game1ScheduleTickService.forTesting(
    pool as unknown as import("pg").Pool
  );
  const result = await svc.detectMasterTimeout(fixedNow);
  assert.deepEqual(result.gameIds, []);
});
