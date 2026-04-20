/**
 * BIN-624: unit-tester for SavedGameService validering.
 *
 * Integrasjonstestene (routes/__tests__/adminSavedGames.test.ts) stubber
 * ut service. Denne filen verifiserer at service-laget avviser ugyldig
 * input før det når Postgres. Object.create-pattern (samme som
 * SubGameService.test.ts) slik at vi ikke trenger DB.
 *
 * Tester også loadToGame() sin forretningslogikk (inactive/deleted avvises)
 * ved å stubbe pool.query med in-memory rader.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SavedGameService } from "./SavedGameService.js";
import { DomainError } from "../game/BingoEngine.js";

function makeValidatingService(): SavedGameService {
  const svc = Object.create(SavedGameService.prototype) as SavedGameService;
  const stubPool = {
    query: async () => {
      throw new Error(
        "UNEXPECTED_POOL_CALL — validering skulle ha stoppet her"
      );
    },
    connect: async () => {
      throw new Error(
        "UNEXPECTED_POOL_CALL — validering skulle ha stoppet her"
      );
    },
  };
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { initPromise: Promise<void> }).initPromise =
    Promise.resolve();
  return svc;
}

/**
 * Svc med en mock-pool som returnerer gitte rader fra SELECT id = $1.
 * Brukes til å teste loadToGame()-logikken.
 */
function makeRowBackedService(row: {
  id: string;
  game_type_id: string;
  name: string;
  is_admin_save: boolean;
  config_json: Record<string, unknown>;
  status: "active" | "inactive";
  created_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}): SavedGameService {
  const svc = Object.create(SavedGameService.prototype) as SavedGameService;
  const stubPool = {
    query: async (_sql: string, params?: unknown[]) => {
      // Bare lese-spørringer (SELECT) er forventet her.
      if (params && params[0] === row.id) {
        return { rows: [row] };
      }
      return { rows: [] };
    },
    connect: async () => {
      throw new Error("UNEXPECTED_CONNECT");
    },
  };
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { initPromise: Promise<void> }).initPromise =
    Promise.resolve();
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

test("BIN-624 service: create() avviser tom gameTypeId", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty gameTypeId",
    () => svc.create({ gameTypeId: "", name: "Min mal", createdBy: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-624 service: create() avviser tom name", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty name",
    () => svc.create({ gameTypeId: "game_1", name: "", createdBy: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-624 service: create() avviser name > 200 tegn", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "too long name",
    () =>
      svc.create({
        gameTypeId: "game_1",
        name: "x".repeat(201),
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-624 service: create() avviser tom createdBy", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty createdBy",
    () => svc.create({ gameTypeId: "game_1", name: "Min mal", createdBy: "" }),
    "INVALID_INPUT"
  );
});

test("BIN-624 service: create() avviser ugyldig status", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad status",
    () =>
      svc.create({
        gameTypeId: "game_1",
        name: "Min mal",
        createdBy: "u-1",
        status: "running" as "active",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-624 service: create() avviser config som array", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "array config",
    () =>
      svc.create({
        gameTypeId: "game_1",
        name: "Min mal",
        createdBy: "u-1",
        config: [] as unknown as Record<string, unknown>,
      }),
    "INVALID_INPUT"
  );
});

test("BIN-624 service: create() avviser config som primitiv", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "string config",
    () =>
      svc.create({
        gameTypeId: "game_1",
        name: "Min mal",
        createdBy: "u-1",
        config: "not-an-object" as unknown as Record<string, unknown>,
      }),
    "INVALID_INPUT"
  );
});

// ── update-validering ───────────────────────────────────────────────────────

test("BIN-624 service: update() avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty id",
    () => svc.update("", { name: "ny" }),
    "INVALID_INPUT"
  );
});

test("BIN-624 service: list() avviser ugyldig status-filter", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad status filter",
    () => svc.list({ status: "bogus" as "active" }),
    "INVALID_INPUT"
  );
});

// ── loadToGame() forretningslogikk ─────────────────────────────────────────

test("BIN-624 service: loadToGame() returnerer dyp kopi av config", async () => {
  const config = { ticketPrice: 10, halls: ["h-1"] };
  const svc = makeRowBackedService({
    id: "sg-1",
    game_type_id: "game_1",
    name: "Min mal",
    is_admin_save: true,
    config_json: config,
    status: "active",
    created_by: "admin-1",
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
    deleted_at: null,
  });
  const payload = await svc.loadToGame("sg-1");
  assert.equal(payload.savedGameId, "sg-1");
  assert.equal(payload.gameTypeId, "game_1");
  assert.equal(payload.name, "Min mal");
  assert.deepEqual(payload.config, { ticketPrice: 10, halls: ["h-1"] });
  // Mutér retur-kopi; original config må ikke endres.
  (payload.config as { ticketPrice: number }).ticketPrice = 999;
  (payload.config.halls as string[]).push("h-2");
  assert.equal(config.ticketPrice, 10, "original config mutated");
  assert.deepEqual(config.halls, ["h-1"], "original halls mutated");
});

test("BIN-624 service: loadToGame() avviser slettet SavedGame", async () => {
  const svc = makeRowBackedService({
    id: "sg-1",
    game_type_id: "game_1",
    name: "Min mal",
    is_admin_save: true,
    config_json: {},
    status: "inactive",
    created_by: null,
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
    deleted_at: "2026-04-20T01:00:00Z",
  });
  await expectDomainError(
    "deleted saved game",
    () => svc.loadToGame("sg-1"),
    "SAVED_GAME_DELETED"
  );
});

test("BIN-624 service: loadToGame() avviser inaktiv SavedGame", async () => {
  const svc = makeRowBackedService({
    id: "sg-1",
    game_type_id: "game_1",
    name: "Min mal",
    is_admin_save: true,
    config_json: {},
    status: "inactive",
    created_by: null,
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
    deleted_at: null,
  });
  await expectDomainError(
    "inactive saved game",
    () => svc.loadToGame("sg-1"),
    "SAVED_GAME_INACTIVE"
  );
});

test("BIN-624 service: loadToGame() avviser ukjent id", async () => {
  const svc = makeRowBackedService({
    id: "sg-1",
    game_type_id: "game_1",
    name: "Min mal",
    is_admin_save: true,
    config_json: {},
    status: "active",
    created_by: null,
    created_at: "2026-04-20T00:00:00Z",
    updated_at: "2026-04-20T00:00:00Z",
    deleted_at: null,
  });
  await expectDomainError(
    "not found",
    () => svc.loadToGame("sg-999"),
    "SAVED_GAME_NOT_FOUND"
  );
});
