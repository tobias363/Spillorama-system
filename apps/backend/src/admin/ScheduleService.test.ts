/**
 * BIN-625: unit-tester for ScheduleService validering + DB-interaksjoner.
 *
 * Validation-testene bruker Object.create-pattern (forTesting) og
 * throwing-pool så vi får garantert at validering skjer før DB-tur.
 *
 * DB-interaksjons-testene stub'er et Pool-objekt og verifiserer at:
 *   - list/get/create/update/remove skriver forventet SQL + params
 *   - soft-delete vs hard-delete-semantikk
 *   - scheduleNumber unique-konflikt mappes til SCHEDULE_NUMBER_CONFLICT
 */

import assert from "node:assert/strict";
import test from "node:test";
import { ScheduleService } from "./ScheduleService.js";
import { DomainError } from "../game/BingoEngine.js";

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;

interface StubPool {
  query: QueryFn;
  connect: () => Promise<unknown>;
}

function throwingPool(): StubPool {
  return {
    query: async () => {
      throw new Error("UNEXPECTED_POOL_CALL — validering skulle ha stoppet her");
    },
    connect: async () => {
      throw new Error("UNEXPECTED_POOL_CALL — validering skulle ha stoppet her");
    },
  };
}

function makeService(pool: StubPool): ScheduleService {
  return ScheduleService.forTesting(
    pool as unknown as Parameters<typeof ScheduleService.forTesting>[0]
  );
}

async function expectDomainError(
  label: string,
  fn: () => Promise<unknown>,
  expectedCode: string
): Promise<void> {
  try {
    await fn();
    assert.fail(`${label}: forventet DomainError(${expectedCode}) men fikk success`);
  } catch (err) {
    if (!(err instanceof DomainError)) {
      throw err;
    }
    assert.equal(err.code, expectedCode, `${label}: feil DomainError-kode`);
  }
}

function mockRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: overrides.id ?? "sch-1",
    schedule_name: overrides.schedule_name ?? "Test Schedule",
    schedule_number: overrides.schedule_number ?? "SID_20260420_100000_abc",
    schedule_type: overrides.schedule_type ?? "Manual",
    lucky_number_prize: overrides.lucky_number_prize ?? 0,
    status: overrides.status ?? "active",
    is_admin_schedule:
      overrides.is_admin_schedule === undefined ? true : overrides.is_admin_schedule,
    manual_start_time: overrides.manual_start_time ?? "",
    manual_end_time: overrides.manual_end_time ?? "",
    sub_games_json: overrides.sub_games_json ?? [],
    created_by: overrides.created_by ?? "admin-1",
    created_at: overrides.created_at ?? "2026-04-20T10:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-04-20T10:00:00.000Z",
    deleted_at: overrides.deleted_at ?? null,
  };
}

// ── Validering (pre-pool) ─────────────────────────────────────────────────

test("BIN-625 service: create() avviser tom scheduleName", async () => {
  const svc = makeService(throwingPool());
  await expectDomainError(
    "empty name",
    () => svc.create({ scheduleName: "", createdBy: "u1" }),
    "INVALID_INPUT"
  );
});

test("BIN-625 service: create() avviser for lang scheduleName", async () => {
  const svc = makeService(throwingPool());
  await expectDomainError(
    "long name",
    () => svc.create({ scheduleName: "x".repeat(201), createdBy: "u1" }),
    "INVALID_INPUT"
  );
});

test("BIN-625 service: create() avviser ugyldig scheduleType", async () => {
  const svc = makeService(throwingPool());
  await expectDomainError(
    "bad type",
    () =>
      svc.create({
        scheduleName: "x",
        scheduleType: "Robot" as unknown as "Auto",
        createdBy: "u1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-625 service: create() avviser tom createdBy", async () => {
  const svc = makeService(throwingPool());
  await expectDomainError(
    "empty createdBy",
    () => svc.create({ scheduleName: "x", createdBy: "" }),
    "INVALID_INPUT"
  );
});

test("BIN-625 service: create() avviser ugyldig manualStartTime", async () => {
  const svc = makeService(throwingPool());
  await expectDomainError(
    "bad HH:MM",
    () =>
      svc.create({
        scheduleName: "x",
        manualStartTime: "25:99",
        createdBy: "u1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-625 service: create() avviser negativ luckyNumberPrize", async () => {
  const svc = makeService(throwingPool());
  await expectDomainError(
    "negative prize",
    () =>
      svc.create({
        scheduleName: "x",
        luckyNumberPrize: -5,
        createdBy: "u1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-625 service: create() avviser subGames som ikke-array", async () => {
  const svc = makeService(throwingPool());
  await expectDomainError(
    "subGames not array",
    () =>
      svc.create({
        scheduleName: "x",
        subGames: { nope: true } as unknown as never,
        createdBy: "u1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-625 service: update() avviser tom endring", async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  const pool: StubPool = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (/SELECT/.test(sql)) {
        return { rows: [mockRow()] };
      }
      throw new Error("unexpected sql");
    },
    connect: async () => ({}),
  };
  const svc = makeService(pool);
  await expectDomainError("empty update", () => svc.update("sch-1", {}), "INVALID_INPUT");
});

test("BIN-625 service: update() avviser tom id", async () => {
  const svc = makeService(throwingPool());
  await expectDomainError(
    "empty id",
    () => svc.update("", { scheduleName: "x" }),
    "INVALID_INPUT"
  );
});

test("BIN-625 service: get() avviser tom id", async () => {
  const svc = makeService(throwingPool());
  await expectDomainError("empty id", () => svc.get(""), "INVALID_INPUT");
});

// ── DB-interaksjon ────────────────────────────────────────────────────────

test("BIN-625 service: list() bygger søk-filter (ILIKE)", async () => {
  const captured: Array<{ sql: string; params?: unknown[] }> = [];
  const pool: StubPool = {
    query: async (sql, params) => {
      captured.push({ sql, params });
      return { rows: [] };
    },
    connect: async () => ({}),
  };
  const svc = makeService(pool);
  await svc.list({ search: "elvis", scheduleType: "Auto" });
  assert.equal(captured.length, 1);
  assert.match(captured[0]!.sql, /ILIKE/);
  assert.match(captured[0]!.sql, /schedule_type = \$\d+/);
  const params = captured[0]!.params as unknown[];
  assert.ok(params.includes("%elvis%"), "search pattern bør inneholde %elvis%");
  assert.ok(params.includes("Auto"), "scheduleType bør være i params");
});

test("BIN-625 service: list() createdBy + includeAdminForOwner (default)", async () => {
  const captured: Array<{ sql: string; params?: unknown[] }> = [];
  const pool: StubPool = {
    query: async (sql, params) => {
      captured.push({ sql, params });
      return { rows: [] };
    },
    connect: async () => ({}),
  };
  const svc = makeService(pool);
  await svc.list({ createdBy: "agent-1" });
  assert.match(
    captured[0]!.sql,
    /\(created_by = \$\d+ OR is_admin_schedule = true\)/
  );
});

test("BIN-625 service: get() kaster SCHEDULE_NOT_FOUND", async () => {
  const pool: StubPool = {
    query: async () => ({ rows: [] }),
    connect: async () => ({}),
  };
  const svc = makeService(pool);
  await expectDomainError(
    "missing",
    () => svc.get("sch-missing"),
    "SCHEDULE_NOT_FOUND"
  );
});

test("BIN-625 service: create() insert + auto-avledet manualStart/End for Auto", async () => {
  const captured: Array<{ sql: string; params?: unknown[] }> = [];
  const pool: StubPool = {
    query: async (sql, params) => {
      captured.push({ sql, params });
      if (/INSERT/.test(sql)) {
        return {
          rows: [
            mockRow({
              schedule_type: "Auto",
              manual_start_time: "10:00",
              manual_end_time: "11:30",
            }),
          ],
        };
      }
      return { rows: [] };
    },
    connect: async () => ({}),
  };
  const svc = makeService(pool);
  const row = await svc.create({
    scheduleName: "Auto mal",
    scheduleType: "Auto",
    subGames: [
      { name: "Elvis", startTime: "10:00", endTime: "10:30" },
      { name: "Jackpot", startTime: "10:35", endTime: "11:30" },
    ],
    createdBy: "admin-1",
  });
  assert.equal(row.scheduleType, "Auto");
  assert.equal(row.manualStartTime, "10:00");
  assert.equal(row.manualEndTime, "11:30");
  const insert = captured.find((c) => /INSERT/.test(c.sql));
  assert.ok(insert, "INSERT kall mangler");
  // param-positions: id, name, number, type, luckyPrize, status, isAdmin,
  // manualStart, manualEnd, subGamesJson, createdBy
  const params = insert!.params as unknown[];
  assert.equal(params[3], "Auto");
  assert.equal(params[7], "10:00");
  assert.equal(params[8], "11:30");
});

test("BIN-625 service: create() SCHEDULE_NUMBER_CONFLICT på 23505", async () => {
  const pool: StubPool = {
    query: async (sql) => {
      if (/INSERT/.test(sql)) {
        const err = new Error("duplicate") as Error & { code?: string };
        err.code = "23505";
        throw err;
      }
      return { rows: [] };
    },
    connect: async () => ({}),
  };
  const svc = makeService(pool);
  await expectDomainError(
    "unique",
    () =>
      svc.create({
        scheduleName: "dup",
        scheduleNumber: "SID_duplicate",
        createdBy: "u1",
      }),
    "SCHEDULE_NUMBER_CONFLICT"
  );
});

test("BIN-625 service: update() bygger SET-klausul kun for oppgitte felt", async () => {
  const captured: Array<{ sql: string; params?: unknown[] }> = [];
  const pool: StubPool = {
    query: async (sql, params) => {
      captured.push({ sql, params });
      if (/SELECT/.test(sql)) return { rows: [mockRow()] };
      if (/UPDATE/.test(sql)) {
        return {
          rows: [
            mockRow({
              schedule_name: "Renamed",
              lucky_number_prize: 500,
            }),
          ],
        };
      }
      return { rows: [] };
    },
    connect: async () => ({}),
  };
  const svc = makeService(pool);
  const row = await svc.update("sch-1", {
    scheduleName: "Renamed",
    luckyNumberPrize: 500,
  });
  assert.equal(row.scheduleName, "Renamed");
  assert.equal(row.luckyNumberPrize, 500);
  const updateCall = captured.find((c) => /UPDATE/.test(c.sql));
  assert.ok(updateCall);
  assert.match(updateCall!.sql, /schedule_name =/);
  assert.match(updateCall!.sql, /lucky_number_prize =/);
  assert.match(updateCall!.sql, /updated_at = now\(\)/);
  // Felter som IKKE ble gitt skal ikke være med:
  assert.doesNotMatch(updateCall!.sql, /manual_start_time =/);
});

test("BIN-625 service: remove() soft-delete default", async () => {
  const captured: Array<{ sql: string; params?: unknown[] }> = [];
  const pool: StubPool = {
    query: async (sql, params) => {
      captured.push({ sql, params });
      if (/SELECT/.test(sql)) return { rows: [mockRow()] };
      return { rows: [] };
    },
    connect: async () => ({}),
  };
  const svc = makeService(pool);
  const result = await svc.remove("sch-1");
  assert.equal(result.softDeleted, true);
  const update = captured.find((c) => /UPDATE/.test(c.sql));
  assert.ok(update, "UPDATE skulle ha kjørt");
  assert.match(update!.sql, /deleted_at = now\(\)/);
  assert.match(update!.sql, /status = 'inactive'/);
});

test("BIN-625 service: remove({hard:true}) blokkerer aktiv mal", async () => {
  const pool: StubPool = {
    query: async (sql) => {
      if (/SELECT/.test(sql)) return { rows: [mockRow({ status: "active" })] };
      return { rows: [] };
    },
    connect: async () => ({}),
  };
  const svc = makeService(pool);
  await expectDomainError(
    "hard on active",
    () => svc.remove("sch-1", { hard: true }),
    "SCHEDULE_HARD_DELETE_BLOCKED"
  );
});

test("BIN-625 service: remove({hard:true}) kjører DELETE på inaktiv mal", async () => {
  const captured: Array<{ sql: string; params?: unknown[] }> = [];
  const pool: StubPool = {
    query: async (sql, params) => {
      captured.push({ sql, params });
      if (/SELECT/.test(sql)) return { rows: [mockRow({ status: "inactive" })] };
      return { rows: [] };
    },
    connect: async () => ({}),
  };
  const svc = makeService(pool);
  const result = await svc.remove("sch-1", { hard: true });
  assert.equal(result.softDeleted, false);
  const del = captured.find((c) => /^DELETE/.test(c.sql));
  assert.ok(del, "DELETE skulle ha kjørt");
});

test("BIN-625 service: remove() avviser allerede slettet rad", async () => {
  const pool: StubPool = {
    query: async (sql) => {
      if (/SELECT/.test(sql))
        return {
          rows: [mockRow({ deleted_at: "2026-04-20T10:00:00.000Z" })],
        };
      return { rows: [] };
    },
    connect: async () => ({}),
  };
  const svc = makeService(pool);
  await expectDomainError(
    "already deleted",
    () => svc.remove("sch-1"),
    "SCHEDULE_DELETED"
  );
});

test("BIN-625 service: update() avviser allerede slettet rad", async () => {
  const pool: StubPool = {
    query: async (sql) => {
      if (/SELECT/.test(sql))
        return {
          rows: [mockRow({ deleted_at: "2026-04-20T10:00:00.000Z" })],
        };
      return { rows: [] };
    },
    connect: async () => ({}),
  };
  const svc = makeService(pool);
  await expectDomainError(
    "update deleted",
    () => svc.update("sch-1", { scheduleName: "x" }),
    "SCHEDULE_DELETED"
  );
});

// ── feat/schedule-8-colors-mystery: 9-color + Mystery validation ──────────

test("feat/8-colors: create() avviser ukjent subGameType", async () => {
  const svc = makeService(throwingPool());
  await expectDomainError(
    "bad subGameType",
    () =>
      svc.create({
        scheduleName: "bad",
        subGames: [{ name: "x", subGameType: "BONUS" as unknown as "STANDARD" }],
        createdBy: "u1",
      }),
    "INVALID_INPUT"
  );
});

test("feat/8-colors: create() avviser rowPrizesByColor med negativ verdi", async () => {
  const svc = makeService(throwingPool());
  await expectDomainError(
    "negative rowPrize",
    () =>
      svc.create({
        scheduleName: "bad rowPrize",
        subGames: [
          {
            name: "x",
            extra: {
              rowPrizesByColor: {
                SMALL_YELLOW: { ticketPrice: 30, row1: -5 },
              },
            },
          },
        ],
        createdBy: "u1",
      }),
    "INVALID_INPUT"
  );
});

test("feat/8-colors: create() avviser Mystery-konfig uten priceOptions", async () => {
  const svc = makeService(throwingPool());
  await expectDomainError(
    "missing priceOptions",
    () =>
      svc.create({
        scheduleName: "bad mystery",
        subGames: [
          {
            name: "mystery-slot",
            subGameType: "MYSTERY",
            extra: { mysteryConfig: { yellowDoubles: true } as unknown as Record<string, unknown> },
          },
        ],
        createdBy: "u1",
      }),
    "INVALID_INPUT"
  );
});

test("feat/8-colors: create() avviser Mystery priceOptions > 10", async () => {
  const svc = makeService(throwingPool());
  await expectDomainError(
    "too many priceOptions",
    () =>
      svc.create({
        scheduleName: "bad mystery",
        subGames: [
          {
            name: "mystery-slot",
            subGameType: "MYSTERY",
            extra: {
              mysteryConfig: {
                priceOptions: [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100],
              },
            },
          },
        ],
        createdBy: "u1",
      }),
    "INVALID_INPUT"
  );
});

test("feat/8-colors: create() godkjenner full 9-color + Mystery payload", async () => {
  const captured: Array<{ sql: string; params?: unknown[] }> = [];
  const pool: StubPool = {
    query: async (sql, params) => {
      captured.push({ sql, params });
      if (/INSERT/.test(sql)) {
        // params[9] er JSON-stringen vi sendte inn via JSON.stringify(subGames).
        // Mock-repoet speiler den tilbake som sub_games_json (JSONB-echo).
        const raw = (params as unknown[])[9];
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        return {
          rows: [
            mockRow({
              sub_games_json: parsed,
            }),
          ],
        };
      }
      return { rows: [] };
    },
    connect: async () => ({}),
  };
  const svc = makeService(pool);
  const row = await svc.create({
    scheduleName: "Full 8-color",
    subGames: [
      {
        name: "Standard med farger",
        subGameType: "STANDARD",
        extra: {
          rowPrizesByColor: {
            SMALL_YELLOW: { ticketPrice: 30, row1: 20, row2: 50, fullHouse: 200 },
            LARGE_YELLOW: { ticketPrice: 80, fullHouse: 600 },
            SMALL_WHITE: { ticketPrice: 30, row1: 15 },
            LARGE_WHITE: { ticketPrice: 80 },
            SMALL_PURPLE: { ticketPrice: 30 },
            LARGE_PURPLE: { ticketPrice: 80 },
            RED: { ticketPrice: 50, fullHouse: 400 },
            GREEN: { ticketPrice: 50 },
            BLUE: { ticketPrice: 50 },
          },
        },
      },
      {
        name: "Mystery Slot",
        subGameType: "MYSTERY",
        extra: {
          mysteryConfig: {
            priceOptions: [1000, 1500, 2000, 2500, 3000, 4000],
            yellowDoubles: true,
          },
        },
      },
    ],
    createdBy: "admin-1",
  });
  const stored = row.subGames;
  assert.equal(stored.length, 2);
  assert.equal(stored[0]!.subGameType, "STANDARD");
  assert.equal(stored[1]!.subGameType, "MYSTERY");
  const mystery = stored[1]!.extra?.mysteryConfig as {
    priceOptions: number[];
    yellowDoubles: boolean;
  };
  assert.deepEqual(mystery.priceOptions, [1000, 1500, 2000, 2500, 3000, 4000]);
  assert.equal(mystery.yellowDoubles, true);
});

test("BIN-625 service: map() parser subGames defensivt", async () => {
  const pool: StubPool = {
    query: async () => ({
      rows: [
        mockRow({
          sub_games_json: [
            {
              name: "Elvis",
              startTime: "10:00",
              endTime: "10:30",
              minseconds: 3,
              ticketTypesData: { foo: "bar" },
              jackpotData: null, // should be ignored
              unknown: "skipped",
            },
            "not-an-object", // skipped
            { extra: { customKey: 1 } },
          ],
        }),
      ],
    }),
    connect: async () => ({}),
  };
  const svc = makeService(pool);
  const row = await svc.get("sch-1");
  assert.equal(row.subGames.length, 2);
  assert.equal(row.subGames[0]!.name, "Elvis");
  assert.equal(row.subGames[0]!.minseconds, 3);
  assert.deepEqual(row.subGames[0]!.ticketTypesData, { foo: "bar" });
  assert.equal(row.subGames[0]!.jackpotData, undefined);
  assert.deepEqual(row.subGames[1]!.extra, { customKey: 1 });
});
