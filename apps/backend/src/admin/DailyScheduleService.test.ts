/**
 * BIN-626: unit-tester for DailyScheduleService validering.
 *
 * Integrasjonstestene (routes/__tests__/adminDailySchedules.test.ts) stubber
 * ut service. Denne filen verifiserer at selve service-laget avviser ugyldig
 * input før det når Postgres, og at validerings-meldinger er konsistente.
 * Samme Object.create-pattern som GameManagementService.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DailyScheduleService } from "./DailyScheduleService.js";
import { DomainError } from "../game/BingoEngine.js";

function makeValidatingService(): DailyScheduleService {
  const svc = Object.create(DailyScheduleService.prototype) as DailyScheduleService;
  const stubPool = {
    query: async () => {
      throw new Error("UNEXPECTED_POOL_CALL — validering skulle ha stoppet her");
    },
  };
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { initPromise: Promise<void> }).initPromise = Promise.resolve();
  return svc;
}

async function expectDomainError(
  label: string,
  fn: () => Promise<unknown>,
  expectedCode?: string
): Promise<void> {
  try {
    await fn();
    assert.fail(`${label}: forventet DomainError men fikk success`);
  } catch (err) {
    if (!(err instanceof DomainError)) {
      throw err;
    }
    if (expectedCode) {
      assert.equal(err.code, expectedCode, `${label}: feil DomainError-kode`);
    }
  }
}

// ── create-validering ───────────────────────────────────────────────────────

test("BIN-626 service: create() avviser tom name", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty name",
    () =>
      svc.create({
        name: "   ",
        startDate: "2026-05-01T10:00:00Z",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: create() avviser >200-tegn name", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "long name",
    () =>
      svc.create({
        name: "a".repeat(201),
        startDate: "2026-05-01T10:00:00Z",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: create() avviser ugyldig startDate", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad startDate",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "not-a-date",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: create() avviser tom startDate", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty startDate",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: create() avviser endDate før startDate", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "end before start",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-10T10:00:00Z",
        endDate: "2026-05-01T10:00:00Z",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: create() avviser weekDays > 127", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "weekDays 200",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        weekDays: 200,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: create() avviser negativ weekDays", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negative weekDays",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        weekDays: -1,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: create() avviser ugyldig day", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad day",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        day: "someday" as unknown as "monday",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: create() avviser ugyldig status", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad status",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        status: "closed" as unknown as "active",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: create() avviser ugyldig startTime-format", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad startTime",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        startTime: "9:00",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: create() avviser startTime med ugyldige tall (25:99)", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "overflow startTime",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        startTime: "25:99",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: create() aksepterer tom startTime/endTime (passerer validering)", async () => {
  const svc = makeValidatingService();
  // Validering skal passere — pool-kall kaster etterpå med UNEXPECTED_POOL_CALL.
  try {
    await svc.create({
      name: "Plan A",
      startDate: "2026-05-01T10:00:00Z",
      startTime: "",
      endTime: "",
      createdBy: "u-1",
    });
    assert.fail("forventet pool-feil");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(
      !(err instanceof DomainError),
      `validering skulle passere, fikk DomainError: ${(err as DomainError).code}`
    );
    assert.match((err as Error).message, /UNEXPECTED_POOL_CALL/);
  }
});

test("BIN-626 service: create() avviser createdBy tom", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty createdBy",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        createdBy: "",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: create() avviser subgames som ikke-array", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "subgames obj",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        subgames: { not: "array" } as unknown as never,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: create() avviser subgame-element som ikke-object", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "subgames[0] string",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        subgames: ["bad"] as unknown as never,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: create() avviser negativ ticketPrice i subgame", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negative ticketPrice",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        subgames: [{ ticketPrice: -1 }],
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: create() avviser negativ prizePool i subgame", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negative prizePool",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        subgames: [{ prizePool: -500 }],
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: create() avviser hallIds som array", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "hallIds array",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        hallIds: [] as unknown as never,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: create() avviser otherData som array", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "otherData array",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        otherData: [] as unknown as never,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

// ── update-validering ───────────────────────────────────────────────────────

test("BIN-626 service: update() uten felter kaster INVALID_INPUT", async () => {
  // update() kaller først .get(id) som treffer pool — stub det ut:
  const svc = makeValidatingService();
  // Monkey-patch: mock get() til å returnere en ikke-slettet rad så vi
  // kan teste update-validering direkte.
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "ds-1",
    name: "x",
    gameManagementId: null,
    hallId: null,
    hallIds: {},
    weekDays: 0,
    day: null,
    startDate: "2026-05-01T10:00:00Z",
    endDate: null,
    startTime: "",
    endTime: "",
    status: "active" as const,
    stopGame: false,
    specialGame: false,
    isSavedGame: false,
    isAdminSavedGame: false,
    innsatsenSales: 0,
    subgames: [],
    otherData: {},
    createdBy: null,
    createdAt: "2026-04-15T10:00:00Z",
    updatedAt: "2026-04-15T10:00:00Z",
    deletedAt: null,
  });
  await expectDomainError(
    "empty update",
    () => svc.update("ds-1", {}),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: update() på slettet rad kaster DAILY_SCHEDULE_DELETED", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "ds-1",
    name: "x",
    gameManagementId: null,
    hallId: null,
    hallIds: {},
    weekDays: 0,
    day: null,
    startDate: "2026-05-01T10:00:00Z",
    endDate: null,
    startTime: "",
    endTime: "",
    status: "inactive" as const,
    stopGame: false,
    specialGame: false,
    isSavedGame: false,
    isAdminSavedGame: false,
    innsatsenSales: 0,
    subgames: [],
    otherData: {},
    createdBy: null,
    createdAt: "2026-04-15T10:00:00Z",
    updatedAt: "2026-04-15T10:00:00Z",
    deletedAt: "2026-04-15T12:00:00Z",
  });
  await expectDomainError(
    "deleted update",
    () => svc.update("ds-1", { name: "new" }),
    "DAILY_SCHEDULE_DELETED"
  );
});

test("BIN-626 service: update() avviser weekDays > 127", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "ds-1",
    name: "x",
    gameManagementId: null,
    hallId: null,
    hallIds: {},
    weekDays: 0,
    day: null,
    startDate: "2026-05-01T10:00:00Z",
    endDate: null,
    startTime: "",
    endTime: "",
    status: "active" as const,
    stopGame: false,
    specialGame: false,
    isSavedGame: false,
    isAdminSavedGame: false,
    innsatsenSales: 0,
    subgames: [],
    otherData: {},
    createdBy: null,
    createdAt: "2026-04-15T10:00:00Z",
    updatedAt: "2026-04-15T10:00:00Z",
    deletedAt: null,
  });
  await expectDomainError(
    "weekDays 128",
    () => svc.update("ds-1", { weekDays: 128 }),
    "INVALID_INPUT"
  );
});

// ── get() validering ────────────────────────────────────────────────────────

test("BIN-626 service: get() avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError("empty id", () => svc.get("   "), "INVALID_INPUT");
});

// ── list-filter-validering ─────────────────────────────────────────────────

test("BIN-626 service: list() avviser ugyldig status-filter", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad status filter",
    () => svc.list({ status: "closed" as unknown as "active" }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: list() avviser weekDays-filter > 127", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad weekDays filter",
    () => svc.list({ weekDaysMask: 200 }),
    "INVALID_INPUT"
  );
});

test("BIN-626 service: list() avviser ugyldig fromDate", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad fromDate",
    () => svc.list({ fromDate: "not-a-date" }),
    "INVALID_INPUT"
  );
});

// ── createSpecial / remove edge-cases ──────────────────────────────────────

test("BIN-626 service: createSpecial() passerer validering (pool-kall kastes etterpå)", async () => {
  const svc = makeValidatingService();
  try {
    await svc.createSpecial({
      name: "Juleplan",
      startDate: "2026-12-24T10:00:00Z",
      createdBy: "u-1",
    });
    assert.fail("forventet pool-feil");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(
      !(err instanceof DomainError),
      `validering skulle passere, fikk DomainError: ${(err as DomainError).code}`
    );
    assert.match((err as Error).message, /UNEXPECTED_POOL_CALL/);
  }
});

// ── scheduleIdsByDay-validering (SUBGAME-PARITY P0) ─────────────────────────

test("scheduleIdsByDay: gyldig 7-dagers schedule passerer create-validering", async () => {
  const svc = makeValidatingService();
  // Validering skal passere — pool-kall kaster etterpå med UNEXPECTED_POOL_CALL.
  try {
    await svc.create({
      name: "Plan A",
      startDate: "2026-05-01T10:00:00Z",
      otherData: {
        scheduleIdsByDay: {
          monday: ["sched-1", "sched-2"],
          tuesday: ["sched-3"],
          wednesday: [],
          thursday: ["sched-4"],
          friday: ["sched-5"],
          saturday: ["sched-6"],
          sunday: ["sched-7"],
        },
      },
      createdBy: "u-1",
    });
    assert.fail("forventet pool-feil");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(
      !(err instanceof DomainError),
      `validering skulle passere, fikk DomainError: ${(err as DomainError).code} - ${(err as DomainError).message}`,
    );
    assert.match((err as Error).message, /UNEXPECTED_POOL_CALL/);
  }
});

test("scheduleIdsByDay: tom otherData (felt mangler) passerer create-validering", async () => {
  const svc = makeValidatingService();
  try {
    await svc.create({
      name: "Plan A",
      startDate: "2026-05-01T10:00:00Z",
      otherData: {},
      createdBy: "u-1",
    });
    assert.fail("forventet pool-feil");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(
      !(err instanceof DomainError),
      `validering skulle passere, fikk DomainError: ${(err as DomainError).code}`,
    );
    assert.match((err as Error).message, /UNEXPECTED_POOL_CALL/);
  }
});

test("scheduleIdsByDay: kun delvis ukedag-mapping (alle felt valgfri) passerer", async () => {
  const svc = makeValidatingService();
  try {
    await svc.create({
      name: "Plan A",
      startDate: "2026-05-01T10:00:00Z",
      otherData: {
        scheduleIdsByDay: {
          monday: ["sched-1"],
        },
      },
      createdBy: "u-1",
    });
    assert.fail("forventet pool-feil");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(
      !(err instanceof DomainError),
      `validering skulle passere, fikk DomainError: ${(err as DomainError).code}`,
    );
  }
});

test("scheduleIdsByDay: null verdi tillates (fjerner binding)", async () => {
  const svc = makeValidatingService();
  try {
    await svc.create({
      name: "Plan A",
      startDate: "2026-05-01T10:00:00Z",
      otherData: { scheduleIdsByDay: null },
      createdBy: "u-1",
    });
    assert.fail("forventet pool-feil");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(
      !(err instanceof DomainError),
      `validering skulle passere, fikk DomainError: ${(err as DomainError).code}`,
    );
  }
});

test("scheduleIdsByDay: ugyldig dag-key (holiday) → INVALID_INPUT", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "unknown day key",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        otherData: {
          scheduleIdsByDay: {
            holiday: ["sched-1"],
          },
        },
        createdBy: "u-1",
      }),
    "INVALID_INPUT",
  );
});

test("scheduleIdsByDay: typo i dag-navn (mondey) → INVALID_INPUT", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "typo day key",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        otherData: {
          scheduleIdsByDay: {
            mondey: ["sched-1"],
          },
        },
        createdBy: "u-1",
      }),
    "INVALID_INPUT",
  );
});

test("scheduleIdsByDay: duplikate IDer i samme ukedag → INVALID_INPUT", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "dup ids",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        otherData: {
          scheduleIdsByDay: {
            monday: ["sched-1", "sched-2", "sched-1"],
          },
        },
        createdBy: "u-1",
      }),
    "INVALID_INPUT",
  );
});

test("scheduleIdsByDay: tom string-ID → INVALID_INPUT", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty id",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        otherData: {
          scheduleIdsByDay: {
            monday: [""],
          },
        },
        createdBy: "u-1",
      }),
    "INVALID_INPUT",
  );
});

test("scheduleIdsByDay: ID som ikke er string → INVALID_INPUT", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "non-string id",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        otherData: {
          scheduleIdsByDay: {
            monday: [123 as unknown as string],
          },
        },
        createdBy: "u-1",
      }),
    "INVALID_INPUT",
  );
});

test("scheduleIdsByDay: array i stedet for object → INVALID_INPUT", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "array root",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        otherData: {
          scheduleIdsByDay: ["sched-1"] as unknown as never,
        },
        createdBy: "u-1",
      }),
    "INVALID_INPUT",
  );
});

test("scheduleIdsByDay: dag-verdi er ikke array (string) → INVALID_INPUT", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "non-array day value",
    () =>
      svc.create({
        name: "Plan A",
        startDate: "2026-05-01T10:00:00Z",
        otherData: {
          scheduleIdsByDay: {
            monday: "sched-1" as unknown as string[],
          },
        },
        createdBy: "u-1",
      }),
    "INVALID_INPUT",
  );
});

test("scheduleIdsByDay: update() avviser duplikate IDer", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "ds-1",
    name: "x",
    gameManagementId: null,
    hallId: null,
    hallIds: {},
    weekDays: 0,
    day: null,
    startDate: "2026-05-01T10:00:00Z",
    endDate: null,
    startTime: "",
    endTime: "",
    status: "active" as const,
    stopGame: false,
    specialGame: false,
    isSavedGame: false,
    isAdminSavedGame: false,
    innsatsenSales: 0,
    subgames: [],
    otherData: {},
    createdBy: null,
    createdAt: "2026-04-15T10:00:00Z",
    updatedAt: "2026-04-15T10:00:00Z",
    deletedAt: null,
  });
  await expectDomainError(
    "update with dup ids",
    () =>
      svc.update("ds-1", {
        otherData: {
          scheduleIdsByDay: {
            tuesday: ["s-1", "s-1"],
          },
        },
      }),
    "INVALID_INPUT",
  );
});

test("scheduleIdsByDay: update() avviser ugyldig dag-key", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "ds-1",
    name: "x",
    gameManagementId: null,
    hallId: null,
    hallIds: {},
    weekDays: 0,
    day: null,
    startDate: "2026-05-01T10:00:00Z",
    endDate: null,
    startTime: "",
    endTime: "",
    status: "active" as const,
    stopGame: false,
    specialGame: false,
    isSavedGame: false,
    isAdminSavedGame: false,
    innsatsenSales: 0,
    subgames: [],
    otherData: {},
    createdBy: null,
    createdAt: "2026-04-15T10:00:00Z",
    updatedAt: "2026-04-15T10:00:00Z",
    deletedAt: null,
  });
  await expectDomainError(
    "update with bad day",
    () =>
      svc.update("ds-1", {
        otherData: {
          scheduleIdsByDay: {
            funday: ["s-1"],
          },
        },
      }),
    "INVALID_INPUT",
  );
});

test("BIN-626 service: remove() på slettet rad kaster DAILY_SCHEDULE_DELETED", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "ds-1",
    name: "x",
    gameManagementId: null,
    hallId: null,
    hallIds: {},
    weekDays: 0,
    day: null,
    startDate: "2026-05-01T10:00:00Z",
    endDate: null,
    startTime: "",
    endTime: "",
    status: "inactive" as const,
    stopGame: false,
    specialGame: false,
    isSavedGame: false,
    isAdminSavedGame: false,
    innsatsenSales: 0,
    subgames: [],
    otherData: {},
    createdBy: null,
    createdAt: "2026-04-15T10:00:00Z",
    updatedAt: "2026-04-15T10:00:00Z",
    deletedAt: "2026-04-15T12:00:00Z",
  });
  await expectDomainError(
    "remove on deleted",
    () => svc.remove("ds-1"),
    "DAILY_SCHEDULE_DELETED"
  );
});
