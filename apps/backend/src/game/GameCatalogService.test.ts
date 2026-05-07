/**
 * Fase 1 (2026-05-07): unit-tester for GameCatalogService validering.
 *
 * Tester at service-laget avviser ugyldig input før det når Postgres.
 * Object.create-pattern (samme som GameTypeService.test.ts og
 * PatternService.test.ts).
 *
 * Integrasjonstester (mot real Postgres) kommer i Fase 3 sammen med
 * routes-laget.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { GameCatalogService } from "./GameCatalogService.js";
import { DomainError } from "../errors/DomainError.js";
import type {
  CreateGameCatalogInput,
  PrizesCents,
} from "./gameCatalog.types.js";

// ── helpers ──────────────────────────────────────────────────────────────

interface CapturedQuery {
  sql: string;
  params: unknown[] | undefined;
}

/**
 * Bygger en service med en pool som THROWER ved query-kall — slik at
 * validering må stoppe før vi treffer DB-en. Brukes for de tester der
 * vi forventer DomainError før noe SQL kjører.
 */
function makeValidatingService(): GameCatalogService {
  const svc = Object.create(
    GameCatalogService.prototype,
  ) as GameCatalogService;
  const stubPool = {
    query: async () => {
      throw new Error(
        "UNEXPECTED_POOL_CALL — validering skulle ha stoppet her",
      );
    },
    connect: async () => {
      throw new Error("UNEXPECTED_POOL_CALL — validering skulle ha stoppet her");
    },
  };
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { auditLogService: null }).auditLogService = null;
  return svc;
}

/**
 * Service med en pool som fanger query-kall og returnerer "neste rad
 * funnet" for SELECT, og no-op for INSERT/UPDATE. Brukes for tester
 * som verifiserer at gyldig input passerer validering og treffer pool.
 */
function makeCapturingService(
  options: { existingRow?: Record<string, unknown> | null } = {},
): { service: GameCatalogService; queries: CapturedQuery[] } {
  const queries: CapturedQuery[] = [];
  const existing = options.existingRow ?? null;
  const stubPool = {
    async query(textOrConfig: unknown, params?: unknown[]): Promise<unknown> {
      const sql =
        typeof textOrConfig === "string"
          ? textOrConfig
          : (textOrConfig as { text: string }).text;
      queries.push({ sql, params });
      // SELECT (id-basert): returner existingRow hvis satt, ellers row vi
      // nettopp INSERTet (matcher createdId-mønsteret).
      if (/^\s*SELECT/i.test(sql)) {
        if (existing) return { rows: [existing] };
        // Ingen rad — service-en vil kaste GAME_CATALOG_NOT_FOUND.
        return { rows: [] };
      }
      // INSERT/UPDATE returnerer "1 row affected" — vi simulerer.
      return { rowCount: 1, rows: [] };
    },
  };
  const svc = Object.create(
    GameCatalogService.prototype,
  ) as GameCatalogService;
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
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

function validPrizes(): PrizesCents {
  return {
    rad1: 10000,
    rad2: 10000,
    rad3: 10000,
    rad4: 10000,
    bingo: { gul: 200000, hvit: 50000 },
  };
}

function validCreateInput(
  overrides: Partial<CreateGameCatalogInput> = {},
): CreateGameCatalogInput {
  return {
    slug: "jackpot-1",
    displayName: "Jackpot 1",
    prizesCents: validPrizes(),
    createdByUserId: "u-1",
    ...overrides,
  };
}

// ── create-validering ────────────────────────────────────────────────────

test("Fase 1: create() avviser tom slug", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty slug",
    () => svc.create(validCreateInput({ slug: "" })),
    "INVALID_INPUT",
  );
});

test("Fase 1: create() avviser slug med ugyldig tegn (uppercase)", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "uppercase slug",
    () => svc.create(validCreateInput({ slug: "Jackpot1" })),
    "INVALID_INPUT",
  );
});

test("Fase 1: create() avviser slug med space", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "space in slug",
    () => svc.create(validCreateInput({ slug: "jackpot 1" })),
    "INVALID_INPUT",
  );
});

test("Fase 1: create() avviser tom displayName", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty displayName",
    () => svc.create(validCreateInput({ displayName: "" })),
    "INVALID_INPUT",
  );
});

test("Fase 1: create() avviser tom createdByUserId", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty createdByUserId",
    () => svc.create(validCreateInput({ createdByUserId: "" })),
    "INVALID_INPUT",
  );
});

test("Fase 1: create() avviser ticketColors med ukjent farge (rosa)", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "unknown color",
    () =>
      svc.create(
        validCreateInput({
          ticketColors: ["gul", "rosa"] as unknown as ("gul" | "hvit")[],
        }),
      ),
    "INVALID_INPUT",
  );
});

test("Fase 1: create() avviser ticketColors som tom liste", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty ticketColors",
    () => svc.create(validCreateInput({ ticketColors: [] })),
    "INVALID_INPUT",
  );
});

test("Fase 1: create() avviser ticketPricesCents med key utenfor ticketColors", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "price key not in colors",
    () =>
      svc.create(
        validCreateInput({
          ticketColors: ["gul", "hvit"],
          ticketPricesCents: { gul: 1000, hvit: 500, lilla: 2000 },
        }),
      ),
    "INVALID_INPUT",
  );
});

test("Fase 1: create() avviser ticketPricesCents med 0 eller negativ pris", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "zero price",
    () =>
      svc.create(
        validCreateInput({
          ticketColors: ["gul", "hvit"],
          ticketPricesCents: { gul: 0, hvit: 500 },
        }),
      ),
    "INVALID_INPUT",
  );
});

test("Fase 1: create() avviser ticketPricesCents som mangler farge", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "missing price for color",
    () =>
      svc.create(
        validCreateInput({
          ticketColors: ["gul", "hvit", "lilla"],
          ticketPricesCents: { gul: 1000, hvit: 500 },
          prizesCents: {
            rad1: 10000,
            rad2: 10000,
            rad3: 10000,
            rad4: 10000,
            bingo: { gul: 200000, hvit: 50000, lilla: 500000 },
          },
        }),
      ),
    "INVALID_INPUT",
  );
});

test("Fase 1: create() avviser negativ rad-premie", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negative rad-prize",
    () =>
      svc.create(
        validCreateInput({
          prizesCents: {
            rad1: -1,
            rad2: 0,
            rad3: 0,
            rad4: 0,
            bingo: { gul: 100, hvit: 50 },
          },
        }),
      ),
    "INVALID_INPUT",
  );
});

test("Fase 1: create() avviser bingo-premie 0", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "zero bingo prize",
    () =>
      svc.create(
        validCreateInput({
          prizesCents: {
            rad1: 100,
            rad2: 100,
            rad3: 100,
            rad4: 100,
            bingo: { gul: 0, hvit: 50 },
          },
        }),
      ),
    "INVALID_INPUT",
  );
});

test("Fase 1: create() avviser bingo-key utenfor ticketColors", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bingo key not in colors",
    () =>
      svc.create(
        validCreateInput({
          ticketColors: ["gul", "hvit"],
          ticketPricesCents: { gul: 1000, hvit: 500 },
          prizesCents: {
            rad1: 100,
            rad2: 100,
            rad3: 100,
            rad4: 100,
            bingo: { gul: 100, hvit: 50, lilla: 200 },
          },
        }),
      ),
    "INVALID_INPUT",
  );
});

test("Fase 1: create() avviser bonusGameSlug utenfor whitelist", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad bonusGameSlug",
    () =>
      svc.create(
        validCreateInput({ bonusGameSlug: "candy_crush" as unknown as null }),
      ),
    "INVALID_INPUT",
  );
});

test("Fase 1: create() avviser bonusGameEnabled=true uten bonusGameSlug", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "enabled without slug",
    () =>
      svc.create(
        validCreateInput({
          bonusGameEnabled: true,
          bonusGameSlug: null,
        }),
      ),
    "INVALID_INPUT",
  );
});

test("Fase 1: create() avviser rules som array", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "rules array",
    () =>
      svc.create(
        validCreateInput({
          rules: ["a", "b"] as unknown as Record<string, unknown>,
        }),
      ),
    "INVALID_INPUT",
  );
});

test("Fase 1: create() avviser sortOrder negativ", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negative sortOrder",
    () => svc.create(validCreateInput({ sortOrder: -1 })),
    "INVALID_INPUT",
  );
});

test("Fase 1: create() aksepterer 3-color happy path (gul/hvit/lilla)", async () => {
  const { service, queries } = makeCapturingService({
    existingRow: makeMinimalRow(),
  });
  await service.create(
    validCreateInput({
      ticketColors: ["gul", "hvit", "lilla"],
      ticketPricesCents: { gul: 1000, hvit: 500, lilla: 2000 },
      prizesCents: {
        rad1: 10000,
        rad2: 10000,
        rad3: 10000,
        rad4: 10000,
        bingo: { gul: 200000, hvit: 50000, lilla: 500000 },
      },
    }),
  );
  // Expect at least INSERT + SELECT for getById.
  assert.ok(
    queries.some((q) => /INSERT INTO/i.test(q.sql)),
    "skulle ha kjørt INSERT",
  );
  assert.ok(
    queries.some((q) => /^\s*SELECT/i.test(q.sql)),
    "skulle ha kjørt SELECT for å hente created-row",
  );
});

test("Fase 1: create() requiresJackpotSetup kan toggles uavhengig", async () => {
  const { service } = makeCapturingService({
    existingRow: makeMinimalRow(),
  });
  // Ingen DomainError forventet — flag-en er bare boolean.
  await service.create(
    validCreateInput({ requiresJackpotSetup: true }),
  );
});

test("Fase 1: create() bonus_game_enabled+slug whitelist OK", async () => {
  const { service } = makeCapturingService({
    existingRow: makeMinimalRow(),
  });
  await service.create(
    validCreateInput({
      bonusGameSlug: "wheel_of_fortune",
      bonusGameEnabled: true,
    }),
  );
});

// ── update-validering ────────────────────────────────────────────────────

test("Fase 1: update() avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty id",
    () => svc.update("", { displayName: "Ny" }),
    "INVALID_INPUT",
  );
});

test("Fase 1: update() avviser når ingen endringer er oppgitt", async () => {
  const svc = makeValidatingService();
  // Stub out getById så vi simulerer at row finnes.
  (svc as unknown as { getById: () => Promise<unknown> }).getById = async () =>
    minimalEntry();
  await expectDomainError(
    "no changes",
    () => svc.update("gc-1", {}),
    "INVALID_INPUT",
  );
});

test("Fase 1: update() returnerer GAME_CATALOG_NOT_FOUND for ukjent id", async () => {
  const { service } = makeCapturingService({ existingRow: null });
  await expectDomainError(
    "unknown id",
    () => service.update("gc-1", { displayName: "Ny" }),
    "GAME_CATALOG_NOT_FOUND",
  );
});

test("Fase 1: update() ticketColors-utvidelse uten priser-update kastes", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { getById: () => Promise<unknown> }).getById = async () =>
    minimalEntry({
      ticketColors: ["gul", "hvit"],
      ticketPricesCents: { gul: 1000, hvit: 500 },
    });
  await expectDomainError(
    "expanded colors without prices",
    () => svc.update("gc-1", { ticketColors: ["gul", "hvit", "lilla"] }),
    "INVALID_INPUT",
  );
});

test("Fase 1: update() bonusGameEnabled=true uten slug og uten eksisterende slug → INVALID_INPUT", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { getById: () => Promise<unknown> }).getById = async () =>
    minimalEntry({ bonusGameSlug: null });
  await expectDomainError(
    "enable without slug",
    () => svc.update("gc-1", { bonusGameEnabled: true }),
    "INVALID_INPUT",
  );
});

test("Fase 1: update() avviser ikke-boolean isActive", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { getById: () => Promise<unknown> }).getById = async () =>
    minimalEntry();
  await expectDomainError(
    "non-boolean isActive",
    () =>
      svc.update("gc-1", {
        isActive: "true" as unknown as boolean,
      }),
    "INVALID_INPUT",
  );
});

// ── deactivate ───────────────────────────────────────────────────────────

test("Fase 1: deactivate() avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty id for deactivate",
    () => svc.deactivate(""),
    "INVALID_INPUT",
  );
});

test("Fase 1: deactivate() er idempotent — allerede inactive er no-op (ikke kaster)", async () => {
  const { service } = makeCapturingService({
    existingRow: makeMinimalRow({ is_active: false }),
  });
  await service.deactivate("gc-1");
  // Ingen exception forventet — service-en returnerer void uten å kjøre UPDATE.
});

test("Fase 1: deactivate() ukjent id → GAME_CATALOG_NOT_FOUND", async () => {
  const { service } = makeCapturingService({ existingRow: null });
  await expectDomainError(
    "unknown deactivate",
    () => service.deactivate("gc-1"),
    "GAME_CATALOG_NOT_FOUND",
  );
});

// ── list/getBySlug ───────────────────────────────────────────────────────

test("Fase 1: getBySlug() avviser tom slug", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty slug for getBySlug",
    () => svc.getBySlug(""),
    "INVALID_INPUT",
  );
});

test("Fase 1: getById() avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty id for getById",
    () => svc.getById(""),
    "INVALID_INPUT",
  );
});

test("Fase 1: list() med isActive=true legger til WHERE-clause", async () => {
  const { service, queries } = makeCapturingService({});
  await service.list({ isActive: true });
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /WHERE is_active = \$1/);
  assert.deepEqual(queries[0].params?.[0], true);
});

// ── forTesting ───────────────────────────────────────────────────────────

test("Fase 1: forTesting() lager instans uten å åpne pool", () => {
  const fakePool = {
    query: async () => ({ rows: [] }),
  } as unknown as import("pg").Pool;
  const svc = GameCatalogService.forTesting(fakePool, "public");
  assert.ok(svc instanceof GameCatalogService);
});

test("Fase 1: forTesting() avviser ugyldig schema-navn", () => {
  const fakePool = {
    query: async () => ({ rows: [] }),
  } as unknown as import("pg").Pool;
  assert.throws(
    () => GameCatalogService.forTesting(fakePool, "drop table;"),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_CONFIG",
  );
});

// ── helpers for "row-mock" ──────────────────────────────────────────────

function makeMinimalRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "gc-1",
    slug: "jackpot-1",
    display_name: "Jackpot 1",
    description: null,
    rules_json: {},
    ticket_colors_json: ["gul", "hvit"],
    ticket_prices_cents_json: { gul: 1000, hvit: 500 },
    prizes_cents_json: {
      rad1: 10000,
      rad2: 10000,
      rad3: 10000,
      rad4: 10000,
      bingo: { gul: 200000, hvit: 50000 },
    },
    bonus_game_slug: null,
    bonus_game_enabled: false,
    requires_jackpot_setup: false,
    is_active: true,
    sort_order: 0,
    created_at: new Date("2026-05-07T12:00:00Z"),
    updated_at: new Date("2026-05-07T12:00:00Z"),
    created_by_user_id: "u-1",
    ...overrides,
  };
}

function minimalEntry(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "gc-1",
    slug: "jackpot-1",
    displayName: "Jackpot 1",
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
