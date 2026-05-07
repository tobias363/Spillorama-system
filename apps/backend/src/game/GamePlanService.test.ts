/**
 * Fase 1 (2026-05-07): unit-tester for GamePlanService validering.
 *
 * Tester at service-laget avviser ugyldig input før det når Postgres
 * (Object.create-pattern). Inkluderer setItems-flyten der vi bekrefter
 * at duplikater i sekvens er TILLATT (Tobias 2026-05-07: Spill 2 og 14
 * i bildet er begge "Innsatsen").
 */

import assert from "node:assert/strict";
import test from "node:test";

import { GamePlanService } from "./GamePlanService.js";
import { GameCatalogService } from "./GameCatalogService.js";
import { DomainError } from "../errors/DomainError.js";
import type {
  CreateGamePlanInput,
  GamePlanWithItems,
  Weekday,
} from "./gamePlan.types.js";
import type { GameCatalogEntry } from "./gameCatalog.types.js";

// ── helpers ──────────────────────────────────────────────────────────────

interface CapturedQuery {
  sql: string;
  params: unknown[] | undefined;
}

function makeStubCatalogService(
  options: {
    entries?: Map<string, GameCatalogEntry>;
  } = {},
): GameCatalogService {
  const map = options.entries ?? new Map<string, GameCatalogEntry>();
  const svc = Object.create(
    GameCatalogService.prototype,
  ) as GameCatalogService;
  (svc as unknown as { pool: unknown }).pool = {
    query: async () => ({ rows: [] }),
  };
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { auditLogService: null }).auditLogService = null;
  // Override getById til å bruke vår map.
  (svc as unknown as {
    getById: (id: string) => Promise<GameCatalogEntry | null>;
  }).getById = async (id: string) => map.get(id) ?? null;
  return svc;
}

function makeValidatingService(
  catalogService = makeStubCatalogService(),
): GamePlanService {
  const svc = Object.create(GamePlanService.prototype) as GamePlanService;
  const stubPool = {
    query: async () => {
      throw new Error(
        "UNEXPECTED_POOL_CALL — validering skulle ha stoppet her",
      );
    },
    connect: async () => {
      throw new Error(
        "UNEXPECTED_POOL_CALL — validering skulle ha stoppet her",
      );
    },
  };
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as {
    catalogService: GameCatalogService;
  }).catalogService = catalogService;
  (svc as unknown as { auditLogService: null }).auditLogService = null;
  return svc;
}

function makeCapturingService(
  options: {
    existingPlanRow?: Record<string, unknown> | null;
    existingItems?: Record<string, unknown>[];
    catalogService?: GameCatalogService;
    txQueries?: CapturedQuery[];
  } = {},
): { service: GamePlanService; queries: CapturedQuery[] } {
  const queries: CapturedQuery[] = [];
  const planRow = options.existingPlanRow ?? null;
  const items = options.existingItems ?? [];
  const catalog = options.catalogService ?? makeStubCatalogService();
  const stubPool = {
    async query(textOrConfig: unknown, params?: unknown[]): Promise<unknown> {
      const sql =
        typeof textOrConfig === "string"
          ? textOrConfig
          : (textOrConfig as { text: string }).text;
      queries.push({ sql, params });
      if (/FROM\s+"public"\."app_game_plan"\s/i.test(sql) || /FROM\s+"public"\."app_game_plan"$/i.test(sql)) {
        if (/^\s*SELECT/i.test(sql)) {
          if (planRow) return { rows: [planRow] };
          return { rows: [] };
        }
      }
      if (/FROM\s+"public"\."app_game_plan_item"/i.test(sql)) {
        if (/^\s*SELECT/i.test(sql)) return { rows: items };
        return { rowCount: items.length, rows: [] };
      }
      if (/^\s*SELECT/i.test(sql)) {
        // Default SELECT: returner planRow hvis satt, ellers tom.
        if (planRow) return { rows: [planRow] };
        return { rows: [] };
      }
      return { rowCount: 1, rows: [] };
    },
    async connect() {
      // Returnerer en mock-client som også fanger queries.
      return {
        query: async (sql: string, params?: unknown[]) => {
          queries.push({ sql, params });
          return { rowCount: 1, rows: [] };
        },
        release: () => {
          /* noop */
        },
      };
    },
  };
  const svc = Object.create(GamePlanService.prototype) as GamePlanService;
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as {
    catalogService: GameCatalogService;
  }).catalogService = catalog;
  (svc as unknown as { auditLogService: null }).auditLogService = null;
  return { service: svc, queries };
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

function validInput(
  overrides: Partial<CreateGamePlanInput> = {},
): CreateGamePlanInput {
  return {
    name: "Spilleplan mandag-fredag",
    hallId: "hall-1",
    weekdays: ["mon", "tue", "wed", "thu", "fri"],
    startTime: "11:00",
    endTime: "21:00",
    createdByUserId: "u-1",
    ...overrides,
  };
}

function makeCatalogEntry(
  overrides: Partial<GameCatalogEntry> = {},
): GameCatalogEntry {
  return {
    id: "gc-1",
    slug: "jackpot-1",
    displayName: "Jackpot",
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

function planEntryWithItems(
  overrides: Partial<GamePlanWithItems> = {},
): GamePlanWithItems {
  return {
    id: "gp-1",
    name: "Spilleplan mandag-fredag",
    description: null,
    hallId: "hall-1",
    groupOfHallsId: null,
    weekdays: ["mon", "tue", "wed", "thu", "fri"],
    startTime: "11:00",
    endTime: "21:00",
    isActive: true,
    createdAt: "2026-05-07T12:00:00Z",
    updatedAt: "2026-05-07T12:00:00Z",
    createdByUserId: "u-1",
    items: [],
    ...overrides,
  };
}

// ── create-validering ────────────────────────────────────────────────────

test("Fase 1 plan: create() avviser tom name", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty name",
    () => svc.create(validInput({ name: "" })),
    "INVALID_INPUT",
  );
});

test("Fase 1 plan: create() avviser begge hallId og groupOfHallsId satt", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "both hall and group",
    () =>
      svc.create(
        validInput({
          hallId: "hall-1",
          groupOfHallsId: "group-1",
        }),
      ),
    "INVALID_INPUT",
  );
});

test("Fase 1 plan: create() avviser ingen hallId eller groupOfHallsId", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "no hall, no group",
    () =>
      svc.create(
        validInput({ hallId: null, groupOfHallsId: null }),
      ),
    "INVALID_INPUT",
  );
});

test("Fase 1 plan: create() aksepterer hallId-only (XOR happy)", async () => {
  const { service } = makeCapturingService({
    existingPlanRow: makeMinimalPlanRow(),
  });
  await service.create(
    validInput({ hallId: "hall-1", groupOfHallsId: null }),
  );
  // Ingen exception → suksess.
});

test("Fase 1 plan: create() aksepterer groupOfHallsId-only (XOR happy)", async () => {
  const { service } = makeCapturingService({
    existingPlanRow: makeMinimalPlanRow({ group_of_halls_id: "group-1" }),
  });
  await service.create(
    validInput({
      hallId: null,
      groupOfHallsId: "group-1",
    }),
  );
});

test("Fase 1 plan: create() avviser tom weekdays", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty weekdays",
    () => svc.create(validInput({ weekdays: [] })),
    "INVALID_INPUT",
  );
});

test("Fase 1 plan: create() avviser ugyldig weekday", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad weekday",
    () =>
      svc.create(
        validInput({
          weekdays: ["mon", "fakeday"] as unknown as Weekday[],
        }),
      ),
    "INVALID_INPUT",
  );
});

test("Fase 1 plan: create() avviser ugyldig startTime-format", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad startTime",
    () => svc.create(validInput({ startTime: "9:00" })),
    "INVALID_INPUT",
  );
});

test("Fase 1 plan: create() avviser endTime <= startTime", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "endTime not after startTime",
    () =>
      svc.create(
        validInput({ startTime: "21:00", endTime: "11:00" }),
      ),
    "INVALID_INPUT",
  );
});

test("Fase 1 plan: create() avviser tom createdByUserId", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty createdByUserId",
    () => svc.create(validInput({ createdByUserId: "" })),
    "INVALID_INPUT",
  );
});

// ── update-validering ────────────────────────────────────────────────────

test("Fase 1 plan: update() avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty id",
    () => svc.update("", { name: "Ny" }),
    "INVALID_INPUT",
  );
});

test("Fase 1 plan: update() ukjent id → GAME_PLAN_NOT_FOUND", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { getById: () => Promise<unknown> }).getById = async () =>
    null;
  await expectDomainError(
    "unknown id",
    () => svc.update("gp-1", { name: "Ny" }),
    "GAME_PLAN_NOT_FOUND",
  );
});

test("Fase 1 plan: update() avviser ingen endringer", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { getById: () => Promise<unknown> }).getById = async () =>
    planEntryWithItems();
  await expectDomainError(
    "no changes",
    () => svc.update("gp-1", {}),
    "INVALID_INPUT",
  );
});

test("Fase 1 plan: update() XOR brytes ved kun å sette hallId hvis groupOfHallsId allerede er satt", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { getById: () => Promise<unknown> }).getById = async () =>
    planEntryWithItems({
      hallId: null,
      groupOfHallsId: "group-1",
    });
  // Sette hallId mens groupOfHallsId fortsatt er satt fra eksisterende → XOR-brudd.
  await expectDomainError(
    "set hallId without clearing group",
    () => svc.update("gp-1", { hallId: "hall-2" }),
    "INVALID_INPUT",
  );
});

test("Fase 1 plan: update() endTime <= startTime cross-field check", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { getById: () => Promise<unknown> }).getById = async () =>
    planEntryWithItems({ startTime: "11:00", endTime: "21:00" });
  await expectDomainError(
    "endTime cross-field",
    () => svc.update("gp-1", { endTime: "10:00" }),
    "INVALID_INPUT",
  );
});

// ── deactivate ───────────────────────────────────────────────────────────

test("Fase 1 plan: deactivate() ukjent id → GAME_PLAN_NOT_FOUND", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { getById: () => Promise<unknown> }).getById = async () =>
    null;
  await expectDomainError(
    "unknown id deactivate",
    () => svc.deactivate("gp-1"),
    "GAME_PLAN_NOT_FOUND",
  );
});

// ── setItems ─────────────────────────────────────────────────────────────

test("Fase 1 plan: setItems() avviser tom planId", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty planId",
    () => svc.setItems("", []),
    "INVALID_INPUT",
  );
});

test("Fase 1 plan: setItems() avviser ikke-array items", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "non-array items",
    () => svc.setItems("gp-1", "wat" as unknown as []),
    "INVALID_INPUT",
  );
});

test("Fase 1 plan: setItems() avviser items > MAX_ITEMS_PER_PLAN (100)", async () => {
  const svc = makeValidatingService();
  const items = Array.from({ length: 101 }, () => ({
    gameCatalogId: "gc-1",
  }));
  await expectDomainError(
    "too many items",
    () => svc.setItems("gp-1", items),
    "INVALID_INPUT",
  );
});

test("Fase 1 plan: setItems() avviser ukjent planId", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { getById: () => Promise<unknown> }).getById = async () =>
    null;
  await expectDomainError(
    "unknown plan",
    () => svc.setItems("gp-1", [{ gameCatalogId: "gc-1" }]),
    "GAME_PLAN_NOT_FOUND",
  );
});

test("Fase 1 plan: setItems() avviser ukjent gameCatalogId", async () => {
  const catalogMap = new Map<string, GameCatalogEntry>();
  // Tom map → catalogService.getById() returnerer null.
  const catalogSvc = makeStubCatalogService({ entries: catalogMap });
  const svc = makeValidatingService(catalogSvc);
  (svc as unknown as { getById: () => Promise<unknown> }).getById = async () =>
    planEntryWithItems();
  await expectDomainError(
    "unknown catalog id",
    () => svc.setItems("gp-1", [{ gameCatalogId: "missing" }]),
    "GAME_CATALOG_NOT_FOUND",
  );
});

test("Fase 1 plan: setItems() avviser inactive catalog-entry", async () => {
  const catalogMap = new Map<string, GameCatalogEntry>();
  catalogMap.set("gc-1", makeCatalogEntry({ isActive: false }));
  const catalogSvc = makeStubCatalogService({ entries: catalogMap });
  const svc = makeValidatingService(catalogSvc);
  (svc as unknown as { getById: () => Promise<unknown> }).getById = async () =>
    planEntryWithItems();
  await expectDomainError(
    "inactive catalog",
    () => svc.setItems("gp-1", [{ gameCatalogId: "gc-1" }]),
    "GAME_CATALOG_INACTIVE",
  );
});

test("Fase 1 plan: setItems() ALLOWS duplicates (Spill 2 og 14 begge Innsatsen)", async () => {
  const catalogMap = new Map<string, GameCatalogEntry>();
  catalogMap.set("gc-innsatsen", makeCatalogEntry({ id: "gc-innsatsen" }));
  catalogMap.set("gc-jackpot", makeCatalogEntry({ id: "gc-jackpot" }));
  const catalogSvc = makeStubCatalogService({ entries: catalogMap });
  const { service, queries } = makeCapturingService({
    existingPlanRow: makeMinimalPlanRow(),
    catalogService: catalogSvc,
  });
  // Stub getById til å returnere plan + items konsistent med det vi
  // simulerer i poolen.
  (service as unknown as { getById: () => Promise<unknown> }).getById = async () =>
    planEntryWithItems();
  await service.setItems("gp-1", [
    { gameCatalogId: "gc-innsatsen" }, // posisjon 1
    { gameCatalogId: "gc-jackpot" }, // posisjon 2
    { gameCatalogId: "gc-innsatsen" }, // posisjon 3 — SAMME som 1
    { gameCatalogId: "gc-innsatsen" }, // posisjon 4 — SAMME igjen
  ]);
  // Verifiser at vi kjørte INSERT 4 ganger (én per item, samme catalog_id i flere).
  const inserts = queries.filter((q) =>
    /INSERT INTO\s+"public"\."app_game_plan_item"/i.test(q.sql),
  );
  assert.equal(inserts.length, 4, "skulle ha 4 INSERT-ene (duplikater er OK)");
});

test("Fase 1 plan: setItems() kjører DELETE før INSERTs (atomisk replace)", async () => {
  const catalogMap = new Map<string, GameCatalogEntry>();
  catalogMap.set("gc-1", makeCatalogEntry());
  const catalogSvc = makeStubCatalogService({ entries: catalogMap });
  const { service, queries } = makeCapturingService({
    existingPlanRow: makeMinimalPlanRow(),
    catalogService: catalogSvc,
  });
  (service as unknown as { getById: () => Promise<unknown> }).getById = async () =>
    planEntryWithItems();
  await service.setItems("gp-1", [{ gameCatalogId: "gc-1" }]);
  const beginIdx = queries.findIndex((q) => /^BEGIN/i.test(q.sql.trim()));
  const deleteIdx = queries.findIndex((q) =>
    /DELETE FROM\s+"public"\."app_game_plan_item"/i.test(q.sql),
  );
  const insertIdx = queries.findIndex((q) =>
    /INSERT INTO\s+"public"\."app_game_plan_item"/i.test(q.sql),
  );
  const commitIdx = queries.findIndex((q) => /^COMMIT/i.test(q.sql.trim()));
  assert.ok(beginIdx >= 0, "BEGIN må kjøre");
  assert.ok(deleteIdx > beginIdx, "DELETE må komme etter BEGIN");
  assert.ok(insertIdx > deleteIdx, "INSERT må komme etter DELETE");
  assert.ok(commitIdx > insertIdx, "COMMIT må komme etter INSERTs");
});

// ── list ─────────────────────────────────────────────────────────────────

test("Fase 1 plan: list() med hallId-filter legger til WHERE", async () => {
  const { service, queries } = makeCapturingService({});
  await service.list({ hallId: "hall-1" });
  assert.match(queries[0].sql, /WHERE hall_id = \$1/);
  assert.deepEqual(queries[0].params?.[0], "hall-1");
});

test("Fase 1 plan: list() med isActive=true legger til WHERE", async () => {
  const { service, queries } = makeCapturingService({});
  await service.list({ isActive: true });
  assert.match(queries[0].sql, /WHERE is_active = \$1/);
});

// ── forTesting ───────────────────────────────────────────────────────────

test("Fase 1 plan: forTesting() lager instans uten å åpne pool", () => {
  const fakePool = {
    query: async () => ({ rows: [] }),
  } as unknown as import("pg").Pool;
  const catalogSvc = makeStubCatalogService();
  const svc = GamePlanService.forTesting({
    pool: fakePool,
    catalogService: catalogSvc,
  });
  assert.ok(svc instanceof GamePlanService);
});

// ── helpers ──────────────────────────────────────────────────────────────

function makeMinimalPlanRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "gp-1",
    name: "Spilleplan mandag-fredag",
    description: null,
    hall_id: "hall-1",
    group_of_halls_id: null,
    weekdays_json: ["mon", "tue", "wed", "thu", "fri"],
    start_time: "11:00:00",
    end_time: "21:00:00",
    is_active: true,
    created_at: new Date("2026-05-07T12:00:00Z"),
    updated_at: new Date("2026-05-07T12:00:00Z"),
    created_by_user_id: "u-1",
    ...overrides,
  };
}
