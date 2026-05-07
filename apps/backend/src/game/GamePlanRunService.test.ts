/**
 * Fase 1 (2026-05-07): unit-tester for GamePlanRunService.
 *
 * Tester runtime-state-handling: getOrCreateForToday, start, advanceToNext
 * (inkl. jackpot-blokkering), setJackpotOverride, pause/resume/finish.
 *
 * Object.create-pattern + stub-pool — ingen Postgres-oppkopling.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { GamePlanRunService } from "./GamePlanRunService.js";
import { GamePlanService } from "./GamePlanService.js";
import { GameCatalogService } from "./GameCatalogService.js";
import { DomainError } from "../errors/DomainError.js";
import type {
  GamePlanRun,
  GamePlanWithItems,
} from "./gamePlan.types.js";
import type { GameCatalogEntry } from "./gameCatalog.types.js";

// ── helpers ──────────────────────────────────────────────────────────────

interface CapturedQuery {
  sql: string;
  params: unknown[] | undefined;
}

function todayStr(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function makeCatalogEntry(
  overrides: Partial<GameCatalogEntry> = {},
): GameCatalogEntry {
  return {
    id: "gc-1",
    slug: "innsatsen",
    displayName: "Innsatsen",
    description: null,
    rules: {},
    ticketColors: ["gul", "hvit"],
    ticketPricesCents: { gul: 1000, hvit: 500 },
    prizesCents: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 200000, hvit: 50000 },
    },
    bonusGameSlug: null,
    bonusGameEnabled: false,
    requiresJackpotSetup: false,
    isActive: true,
    sortOrder: 0,
    createdAt: "2026-05-07T12:00:00Z",
    updatedAt: "2026-05-07T12:00:00Z",
    createdByUserId: "u-1",
    ...overrides,
  };
}

function makePlanWithItems(
  items: { gameCatalogId: string; catalogEntry: GameCatalogEntry }[],
): GamePlanWithItems {
  return {
    id: "gp-1",
    name: "Spilleplan",
    description: null,
    hallId: "hall-1",
    groupOfHallsId: null,
    weekdays: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
    startTime: "11:00",
    endTime: "21:00",
    isActive: true,
    createdAt: "2026-05-07T12:00:00Z",
    updatedAt: "2026-05-07T12:00:00Z",
    createdByUserId: "u-1",
    items: items.map((it, idx) => ({
      id: `item-${idx + 1}`,
      planId: "gp-1",
      position: idx + 1,
      gameCatalogId: it.gameCatalogId,
      notes: null,
      createdAt: "2026-05-07T12:00:00Z",
      catalogEntry: it.catalogEntry,
    })),
  };
}

function stubCatalogService(
  entries: Map<string, GameCatalogEntry>,
): GameCatalogService {
  const svc = Object.create(
    GameCatalogService.prototype,
  ) as GameCatalogService;
  (svc as unknown as { pool: unknown }).pool = {
    query: async () => ({ rows: [] }),
  };
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { auditLogService: null }).auditLogService = null;
  (svc as unknown as {
    getById: (id: string) => Promise<GameCatalogEntry | null>;
  }).getById = async (id) => entries.get(id) ?? null;
  return svc;
}

function stubPlanService(plan: GamePlanWithItems | null): GamePlanService {
  const svc = Object.create(GamePlanService.prototype) as GamePlanService;
  (svc as unknown as { pool: unknown }).pool = {
    query: async () => ({ rows: [] }),
  };
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { auditLogService: null }).auditLogService = null;
  (svc as unknown as {
    catalogService: GameCatalogService;
  }).catalogService = stubCatalogService(new Map());
  (svc as unknown as {
    getById: (id: string) => Promise<GamePlanWithItems | null>;
  }).getById = async (id) => {
    if (!plan) return null;
    return plan.id === id ? plan : null;
  };
  (svc as unknown as {
    list: () => Promise<unknown>;
  }).list = async () => (plan ? [plan] : []);
  return svc;
}

interface RunServiceOptions {
  /** Den raden findForDay/requireById skal returnere — eller null. */
  runRow?: Record<string, unknown> | null;
  /** Plan som planService.getById skal returnere. */
  plan?: GamePlanWithItems | null;
  /** UNIQUE-violation simulering ved INSERT. */
  insertThrowsUnique?: boolean;
  /** Returner null på findForDay før INSERT, men en row etter. */
  raceCondition?: Record<string, unknown>;
}

function makeRunService(
  options: RunServiceOptions = {},
): {
  service: GamePlanRunService;
  queries: CapturedQuery[];
  setRunRow: (row: Record<string, unknown> | null) => void;
} {
  const queries: CapturedQuery[] = [];
  let runRow = options.runRow ?? null;
  const plan = options.plan ?? null;
  let insertCount = 0;
  const stubPool = {
    async query(textOrConfig: unknown, params?: unknown[]): Promise<unknown> {
      const sql =
        typeof textOrConfig === "string"
          ? textOrConfig
          : (textOrConfig as { text: string }).text;
      queries.push({ sql, params });
      if (/INSERT INTO\s+"public"\."app_game_plan_run"/i.test(sql)) {
        insertCount += 1;
        if (options.insertThrowsUnique) {
          // Simulerer pg unique-violation (code 23505).
          const e = new Error("duplicate key");
          (e as unknown as { code: string }).code = "23505";
          throw e;
        }
        // Etter INSERT skal findForDay finne raden.
        if (options.raceCondition) {
          runRow = options.raceCondition;
        } else {
          // Vi simulerer at INSERT lyktes — neste findForDay finner raden.
          if (params && Array.isArray(params)) {
            runRow = makeRunRow({
              id: params[0] as string,
              plan_id: params[1] as string,
              hall_id: params[2] as string,
              business_date: params[3] as string,
              status: "idle",
            });
          }
        }
        return { rowCount: 1, rows: [] };
      }
      if (/UPDATE\s+"public"\."app_game_plan_run"/i.test(sql)) {
        // Oppdater runRow-mock basert på SET-clause for status, position, etc.
        if (runRow) {
          if (/status\s*=\s*'finished'/i.test(sql)) {
            runRow = { ...runRow, status: "finished" };
          } else if (/status\s*=\s*'running'/i.test(sql)) {
            runRow = { ...runRow, status: "running" };
            if (/started_at\s*=\s*COALESCE/i.test(sql)) {
              runRow.started_at = runRow.started_at ?? new Date();
            }
            if (/current_position\s*=\s*1/i.test(sql)) {
              runRow.current_position = 1;
            }
            if (params && params[1] !== undefined) {
              // start sets master_user_id som parameter $2.
              if (/master_user_id\s*=\s*\$2/i.test(sql)) {
                runRow.master_user_id = params[1];
              }
            }
          } else if (/status\s*=\s*'paused'/i.test(sql)) {
            runRow = { ...runRow, status: "paused" };
          } else if (/status\s*=\s*\$2/i.test(sql)) {
            // changeStatus med parameterisert target
            runRow = { ...runRow, status: params?.[1] ?? runRow.status };
          }
          if (
            /current_position\s*=\s*\$2/i.test(sql) &&
            params &&
            params[1] !== undefined
          ) {
            runRow.current_position = params[1];
          }
          if (/jackpot_overrides_json\s*=\s*\$2/i.test(sql)) {
            runRow.jackpot_overrides_json = params?.[1];
          }
          if (/finished_at\s*=\s*now\(\)/i.test(sql)) {
            runRow.finished_at = new Date();
          }
        }
        return { rowCount: 1, rows: [] };
      }
      if (/^\s*SELECT/i.test(sql)) {
        if (runRow) return { rows: [runRow] };
        return { rows: [] };
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const catalog = stubCatalogService(new Map());
  const planSvc = stubPlanService(plan);
  const svc = Object.create(
    GamePlanRunService.prototype,
  ) as GamePlanRunService;
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { planService: GamePlanService }).planService = planSvc;
  (svc as unknown as {
    catalogService: GameCatalogService;
  }).catalogService = catalog;
  (svc as unknown as { auditLogService: null }).auditLogService = null;

  void insertCount; // unused outside

  return {
    service: svc,
    queries,
    setRunRow: (row) => {
      runRow = row;
    },
  };
}

function makeRunRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "run-1",
    plan_id: "gp-1",
    hall_id: "hall-1",
    business_date: todayStr(),
    current_position: 1,
    status: "idle",
    jackpot_overrides_json: {},
    started_at: null,
    finished_at: null,
    master_user_id: null,
    created_at: new Date("2026-05-07T12:00:00Z"),
    updated_at: new Date("2026-05-07T12:00:00Z"),
    ...overrides,
  };
}

async function expectDomainError(
  label: string,
  fn: () => Promise<unknown>,
  expectedCode?: string,
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

// ── businessDate-validering ──────────────────────────────────────────────

test("Fase 1 run: getOrCreateForToday avviser historisk dato", async () => {
  const { service } = makeRunService();
  await expectDomainError(
    "past date",
    () => service.getOrCreateForToday("hall-1", "2020-01-01"),
    "INVALID_INPUT",
  );
});

test("Fase 1 run: getOrCreateForToday avviser ugyldig dato-streng", async () => {
  const { service } = makeRunService();
  await expectDomainError(
    "bad date string",
    () => service.getOrCreateForToday("hall-1", "ikke-en-dato"),
    "INVALID_INPUT",
  );
});

// ── getOrCreateForToday ──────────────────────────────────────────────────

test("Fase 1 run: getOrCreateForToday returnerer eksisterende run", async () => {
  const existingRow = makeRunRow({ status: "running" });
  const { service } = makeRunService({ runRow: existingRow });
  const run = await service.getOrCreateForToday("hall-1", todayStr());
  assert.equal(run.status, "running");
  assert.equal(run.id, "run-1");
});

test("Fase 1 run: getOrCreateForToday oppretter idle-run hvis ingen finnes", async () => {
  const plan = makePlanWithItems([
    { gameCatalogId: "gc-1", catalogEntry: makeCatalogEntry() },
  ]);
  const { service, queries } = makeRunService({ runRow: null, plan });
  const run = await service.getOrCreateForToday("hall-1", todayStr());
  assert.equal(run.status, "idle");
  assert.ok(
    queries.some((q) =>
      /INSERT INTO\s+"public"\."app_game_plan_run"/i.test(q.sql),
    ),
    "INSERT skulle vært kjørt",
  );
});

test("Fase 1 run: getOrCreateForToday kaster NO_MATCHING_PLAN hvis ingen plan dekker ukedag", async () => {
  const { service } = makeRunService({ runRow: null, plan: null });
  await expectDomainError(
    "no plan matches",
    () => service.getOrCreateForToday("hall-1", todayStr()),
    "NO_MATCHING_PLAN",
  );
});

// ── start ───────────────────────────────────────────────────────────────

test("Fase 1 run: start avviser når status != idle", async () => {
  const { service } = makeRunService({
    runRow: makeRunRow({ status: "running" }),
  });
  await expectDomainError(
    "start from non-idle",
    () => service.start("hall-1", todayStr(), "u-master"),
    "GAME_PLAN_RUN_INVALID_TRANSITION",
  );
});

test("Fase 1 run: start avviser tom masterUserId", async () => {
  const { service } = makeRunService({ runRow: makeRunRow() });
  await expectDomainError(
    "empty masterUserId",
    () => service.start("hall-1", todayStr(), ""),
    "INVALID_INPUT",
  );
});

test("Fase 1 run: start setter status=running og started_at", async () => {
  const { service, queries } = makeRunService({
    runRow: makeRunRow({ status: "idle" }),
  });
  const run = await service.start("hall-1", todayStr(), "u-master");
  assert.equal(run.status, "running");
  assert.ok(
    queries.some((q) => /UPDATE\s+"public"\."app_game_plan_run"/i.test(q.sql)),
  );
});

test("Fase 1 run: start kaster GAME_PLAN_RUN_NOT_FOUND for manglende run", async () => {
  const { service } = makeRunService({ runRow: null });
  await expectDomainError(
    "missing run",
    () => service.start("hall-1", todayStr(), "u-master"),
    "GAME_PLAN_RUN_NOT_FOUND",
  );
});

// ── advanceToNext ────────────────────────────────────────────────────────

test("Fase 1 run: advanceToNext fra position 1 → 2", async () => {
  const item1Catalog = makeCatalogEntry({
    id: "gc-1",
    slug: "innsatsen",
    requiresJackpotSetup: false,
  });
  const item2Catalog = makeCatalogEntry({
    id: "gc-2",
    slug: "trafikklys",
    requiresJackpotSetup: false,
  });
  const plan = makePlanWithItems([
    { gameCatalogId: "gc-1", catalogEntry: item1Catalog },
    { gameCatalogId: "gc-2", catalogEntry: item2Catalog },
  ]);
  const { service } = makeRunService({
    runRow: makeRunRow({ status: "running", current_position: 1 }),
    plan,
  });
  const result = await service.advanceToNext(
    "hall-1",
    todayStr(),
    "u-master",
  );
  assert.equal(result.run.currentPosition, 2);
  assert.equal(result.jackpotSetupRequired, false);
  assert.equal(result.nextGame?.id, "gc-2");
});

test("Fase 1 run: advanceToNext fra siste posisjon → finished", async () => {
  const item1Catalog = makeCatalogEntry({
    id: "gc-1",
    requiresJackpotSetup: false,
  });
  const plan = makePlanWithItems([
    { gameCatalogId: "gc-1", catalogEntry: item1Catalog },
  ]);
  const { service } = makeRunService({
    runRow: makeRunRow({ status: "running", current_position: 1 }),
    plan,
  });
  const result = await service.advanceToNext(
    "hall-1",
    todayStr(),
    "u-master",
  );
  assert.equal(result.run.status, "finished");
  assert.equal(result.nextGame, null);
  assert.equal(result.jackpotSetupRequired, false);
});

test("Fase 1 run: advanceToNext returnerer jackpotSetupRequired=true uten å oppdatere run", async () => {
  const jackpotEntry = makeCatalogEntry({
    id: "gc-jackpot",
    slug: "jackpot-1",
    requiresJackpotSetup: true,
  });
  const innsatsen = makeCatalogEntry({
    id: "gc-1",
    requiresJackpotSetup: false,
  });
  const plan = makePlanWithItems([
    { gameCatalogId: "gc-1", catalogEntry: innsatsen },
    { gameCatalogId: "gc-jackpot", catalogEntry: jackpotEntry },
  ]);
  const { service, queries } = makeRunService({
    runRow: makeRunRow({
      status: "running",
      current_position: 1,
      jackpot_overrides_json: {},
    }),
    plan,
  });
  const result = await service.advanceToNext(
    "hall-1",
    todayStr(),
    "u-master",
  );
  assert.equal(result.jackpotSetupRequired, true);
  assert.equal(result.run.currentPosition, 1, "posisjon skal IKKE oppdateres");
  assert.equal(result.nextGame?.id, "gc-jackpot");
  // Ingen UPDATE skal kjøres for å flytte position.
  const positionUpdate = queries.find(
    (q) =>
      /UPDATE\s+"public"\."app_game_plan_run"/i.test(q.sql) &&
      /current_position/i.test(q.sql),
  );
  assert.equal(
    positionUpdate,
    undefined,
    "ingen position-UPDATE skal kjøres ved jackpotSetupRequired",
  );
});

test("Fase 1 run: advanceToNext gjennomfører flytting når jackpot-override allerede er satt", async () => {
  const jackpotEntry = makeCatalogEntry({
    id: "gc-jackpot",
    slug: "jackpot-1",
    requiresJackpotSetup: true,
  });
  const innsatsen = makeCatalogEntry({
    id: "gc-1",
    requiresJackpotSetup: false,
  });
  const plan = makePlanWithItems([
    { gameCatalogId: "gc-1", catalogEntry: innsatsen },
    { gameCatalogId: "gc-jackpot", catalogEntry: jackpotEntry },
  ]);
  const { service } = makeRunService({
    runRow: makeRunRow({
      status: "running",
      current_position: 1,
      // Override allerede satt for posisjon 2 — advanceToNext skal flytte uhindret.
      jackpot_overrides_json: {
        "2": { draw: 56, prizesCents: { gul: 500000, hvit: 250000 } },
      },
    }),
    plan,
  });
  const result = await service.advanceToNext(
    "hall-1",
    todayStr(),
    "u-master",
  );
  assert.equal(result.jackpotSetupRequired, false);
  assert.equal(result.run.currentPosition, 2);
});

test("Fase 1 run: advanceToNext avviser fra status=idle", async () => {
  const innsatsen = makeCatalogEntry({ id: "gc-1" });
  const plan = makePlanWithItems([
    { gameCatalogId: "gc-1", catalogEntry: innsatsen },
  ]);
  const { service } = makeRunService({
    runRow: makeRunRow({ status: "idle" }),
    plan,
  });
  await expectDomainError(
    "advance from idle",
    () => service.advanceToNext("hall-1", todayStr(), "u-master"),
    "GAME_PLAN_RUN_INVALID_TRANSITION",
  );
});

// ── setJackpotOverride ───────────────────────────────────────────────────

test("Fase 1 run: setJackpotOverride avviser draw utenfor 1..90", async () => {
  const jackpotEntry = makeCatalogEntry({
    id: "gc-jackpot",
    requiresJackpotSetup: true,
  });
  const plan = makePlanWithItems([
    { gameCatalogId: "gc-jackpot", catalogEntry: jackpotEntry },
  ]);
  const { service } = makeRunService({
    runRow: makeRunRow({ status: "running" }),
    plan,
  });
  await expectDomainError(
    "draw too high",
    () =>
      service.setJackpotOverride(
        "hall-1",
        todayStr(),
        1,
        { draw: 100, prizesCents: { gul: 1000 } },
        "u-master",
      ),
    "INVALID_INPUT",
  );
});

test("Fase 1 run: setJackpotOverride avviser prizesCents-key utenfor catalog-game.ticketColors", async () => {
  const jackpotEntry = makeCatalogEntry({
    id: "gc-jackpot",
    ticketColors: ["gul", "hvit"], // ingen lilla
    requiresJackpotSetup: true,
  });
  const plan = makePlanWithItems([
    { gameCatalogId: "gc-jackpot", catalogEntry: jackpotEntry },
  ]);
  const { service } = makeRunService({
    runRow: makeRunRow({ status: "running" }),
    plan,
  });
  await expectDomainError(
    "color mismatch",
    () =>
      service.setJackpotOverride(
        "hall-1",
        todayStr(),
        1,
        { draw: 56, prizesCents: { gul: 1000, lilla: 500 } },
        "u-master",
      ),
    "INVALID_INPUT",
  );
});

test("Fase 1 run: setJackpotOverride lagrer override i jackpot_overrides_json", async () => {
  const jackpotEntry = makeCatalogEntry({
    id: "gc-jackpot",
    ticketColors: ["gul", "hvit"],
    requiresJackpotSetup: true,
  });
  const plan = makePlanWithItems([
    { gameCatalogId: "gc-jackpot", catalogEntry: jackpotEntry },
  ]);
  const { service, queries } = makeRunService({
    runRow: makeRunRow({ status: "running" }),
    plan,
  });
  await service.setJackpotOverride(
    "hall-1",
    todayStr(),
    1,
    { draw: 56, prizesCents: { gul: 600000, hvit: 300000 } },
    "u-master",
  );
  const update = queries.find(
    (q) =>
      /UPDATE\s+"public"\."app_game_plan_run"/i.test(q.sql) &&
      /jackpot_overrides_json/i.test(q.sql),
  );
  assert.ok(update, "UPDATE jackpot_overrides_json skulle kjøres");
  // Inspisér payload — JSON skal inneholde "1": {draw:56, prizesCents:...}
  const jsonPayload = update?.params?.[1];
  assert.ok(
    typeof jsonPayload === "string" && jsonPayload.includes('"draw":56'),
    `jackpot-override-payload ser feil ut: ${String(jsonPayload)}`,
  );
});

test("Fase 1 run: setJackpotOverride avviser hvis posisjon ikke krever setup", async () => {
  const innsatsen = makeCatalogEntry({
    id: "gc-1",
    requiresJackpotSetup: false,
  });
  const plan = makePlanWithItems([
    { gameCatalogId: "gc-1", catalogEntry: innsatsen },
  ]);
  const { service } = makeRunService({
    runRow: makeRunRow({ status: "running" }),
    plan,
  });
  await expectDomainError(
    "no jackpot at position",
    () =>
      service.setJackpotOverride(
        "hall-1",
        todayStr(),
        1,
        { draw: 56, prizesCents: { gul: 1000 } },
        "u-master",
      ),
    "INVALID_INPUT",
  );
});

test("Fase 1 run: setJackpotOverride avviser status=finished", async () => {
  const jackpotEntry = makeCatalogEntry({
    id: "gc-jackpot",
    requiresJackpotSetup: true,
  });
  const plan = makePlanWithItems([
    { gameCatalogId: "gc-jackpot", catalogEntry: jackpotEntry },
  ]);
  const { service } = makeRunService({
    runRow: makeRunRow({ status: "finished" }),
    plan,
  });
  await expectDomainError(
    "finished run",
    () =>
      service.setJackpotOverride(
        "hall-1",
        todayStr(),
        1,
        { draw: 56, prizesCents: { gul: 1000 } },
        "u-master",
      ),
    "GAME_PLAN_RUN_INVALID_TRANSITION",
  );
});

// ── pause/resume/finish ──────────────────────────────────────────────────

test("Fase 1 run: pause fra running → paused", async () => {
  const { service } = makeRunService({
    runRow: makeRunRow({ status: "running" }),
  });
  const run = await service.pause("hall-1", todayStr(), "u-master");
  assert.equal(run.status, "paused");
});

test("Fase 1 run: resume fra paused → running", async () => {
  const { service } = makeRunService({
    runRow: makeRunRow({ status: "paused" }),
  });
  const run = await service.resume("hall-1", todayStr(), "u-master");
  assert.equal(run.status, "running");
});

test("Fase 1 run: pause fra idle avvises", async () => {
  const { service } = makeRunService({
    runRow: makeRunRow({ status: "idle" }),
  });
  await expectDomainError(
    "pause from idle",
    () => service.pause("hall-1", todayStr(), "u-master"),
    "GAME_PLAN_RUN_INVALID_TRANSITION",
  );
});

test("Fase 1 run: finish kan kalles fra alle ikke-finished states", async () => {
  for (const status of ["idle", "running", "paused"] as const) {
    const { service } = makeRunService({
      runRow: makeRunRow({ status }),
    });
    const run = await service.finish("hall-1", todayStr(), "u-master");
    assert.equal(
      run.status,
      "finished",
      `finish fra ${status} skal sette status=finished`,
    );
  }
});

test("Fase 1 run: finish fra finished avvises (idempotency: finished er sluttet, ikke en ny transition)", async () => {
  const { service } = makeRunService({
    runRow: makeRunRow({ status: "finished" }),
  });
  await expectDomainError(
    "finish from finished",
    () => service.finish("hall-1", todayStr(), "u-master"),
    "GAME_PLAN_RUN_INVALID_TRANSITION",
  );
});

// ── findForDay ───────────────────────────────────────────────────────────

test("Fase 1 run: findForDay returnerer null hvis ingen rad", async () => {
  const { service } = makeRunService({ runRow: null });
  const run = await service.findForDay("hall-1", todayStr());
  assert.equal(run, null);
});

test("Fase 1 run: findForDay returnerer eksisterende rad", async () => {
  const { service } = makeRunService({
    runRow: makeRunRow({ status: "running" }),
  });
  const run = await service.findForDay("hall-1", todayStr());
  assert.ok(run);
  assert.equal(run?.status, "running");
});

// ── forTesting ───────────────────────────────────────────────────────────

test("Fase 1 run: forTesting() lager instans uten å åpne pool", () => {
  const fakePool = {
    query: async () => ({ rows: [] }),
  } as unknown as import("pg").Pool;
  const planSvc = stubPlanService(null);
  const catalogSvc = stubCatalogService(new Map());
  const svc = GamePlanRunService.forTesting({
    pool: fakePool,
    planService: planSvc,
    catalogService: catalogSvc,
  });
  assert.ok(svc instanceof GamePlanRunService);
});
