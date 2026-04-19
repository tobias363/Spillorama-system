/**
 * BIN-620: unit-tester for GameTypeService validering.
 *
 * Integrasjonstestene (routes/__tests__/adminGameTypes.test.ts) stubber ut
 * service. Denne filen verifiserer at service-laget avviser ugyldig input
 * før det når Postgres. Object.create-pattern for å unngå faktisk oppkopling.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { GameTypeService } from "./GameTypeService.js";
import { DomainError } from "../game/BingoEngine.js";

function makeValidatingService(): GameTypeService {
  const svc = Object.create(GameTypeService.prototype) as GameTypeService;
  const stubPool = {
    query: async () => {
      throw new Error("UNEXPECTED_POOL_CALL — validering skulle ha stoppet her");
    },
    connect: async () => {
      throw new Error("UNEXPECTED_POOL_CALL — validering skulle ha stoppet her");
    },
  };
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { initPromise: Promise<void> }).initPromise = Promise.resolve();
  (svc as unknown as { referenceChecker: null }).referenceChecker = null;
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

test("BIN-620 service: create() avviser tom typeSlug", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty typeSlug",
    () => svc.create({ typeSlug: "", name: "Game 1", createdBy: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-620 service: create() avviser tom name", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty name",
    () => svc.create({ typeSlug: "game_1", name: "", createdBy: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-620 service: create() avviser name > 200 tegn", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "too long name",
    () =>
      svc.create({
        typeSlug: "game_1",
        name: "x".repeat(201),
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-620 service: create() avviser tom createdBy", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty createdBy",
    () => svc.create({ typeSlug: "game_1", name: "Game 1", createdBy: "" }),
    "INVALID_INPUT"
  );
});

test("BIN-620 service: create() avviser ugyldig status", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad status",
    () =>
      svc.create({
        typeSlug: "game_1",
        name: "Game 1",
        status: "running" as "active",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-620 service: create() avviser 0 gridRows", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "zero gridRows",
    () =>
      svc.create({
        typeSlug: "game_1",
        name: "Game 1",
        gridRows: 0,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-620 service: create() avviser negative gridColumns", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negative gridColumns",
    () =>
      svc.create({
        typeSlug: "game_1",
        name: "Game 1",
        gridColumns: -1,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-620 service: create() avviser rangeMax < rangeMin", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "range-inversion",
    () =>
      svc.create({
        typeSlug: "game_1",
        name: "Game 1",
        rangeMin: 50,
        rangeMax: 10,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-620 service: create() avviser 0 totalNoTickets", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "zero totalNoTickets",
    () =>
      svc.create({
        typeSlug: "game_1",
        name: "Game 1",
        totalNoTickets: 0,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-620 service: create() avviser luckyNumbers som ikke-array", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "non-array luckyNumbers",
    () =>
      svc.create({
        typeSlug: "game_1",
        name: "Game 1",
        luckyNumbers: "5,10" as unknown as number[],
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-620 service: create() avviser luckyNumbers med non-integer", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "float in luckyNumbers",
    () =>
      svc.create({
        typeSlug: "game_1",
        name: "Game 1",
        luckyNumbers: [5, 10.5],
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-620 service: create() avviser extra som array", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "array extra",
    () =>
      svc.create({
        typeSlug: "game_1",
        name: "Game 1",
        extra: ["not", "valid"] as unknown as Record<string, unknown>,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-620 service: create() aksepterer gyldig minimal input (skal treffe pool)", async () => {
  const svc = makeValidatingService();
  let reachedPool = false;
  try {
    await svc.create({
      typeSlug: "game_1",
      name: "Game 1",
      createdBy: "u-1",
    });
  } catch (err) {
    if (err instanceof DomainError) {
      assert.fail(`minimal input skulle ikke avvises: ${err.message}`);
    }
    reachedPool = (err as Error).message.includes("UNEXPECTED_POOL_CALL");
  }
  assert.ok(reachedPool, "minimal input skulle ha passert validering");
});

test("BIN-620 service: create() aksepterer full input", async () => {
  const svc = makeValidatingService();
  let reachedPool = false;
  try {
    await svc.create({
      typeSlug: "bingo",
      name: "Bingo 75",
      photo: "bingo.png",
      pattern: true,
      gridRows: 5,
      gridColumns: 5,
      rangeMin: 1,
      rangeMax: 75,
      totalNoTickets: 1000,
      userMaxTickets: 50,
      luckyNumbers: [7, 13, 21],
      status: "active",
      extra: { legacy: true },
      createdBy: "u-1",
    });
  } catch (err) {
    if (err instanceof DomainError) {
      assert.fail(`full input skulle ikke avvises: ${err.message}`);
    }
    reachedPool = (err as Error).message.includes("UNEXPECTED_POOL_CALL");
  }
  assert.ok(reachedPool, "full input skulle ha passert validering");
});

test("BIN-620 service: create() dedupliserer luckyNumbers", async () => {
  const svc = makeValidatingService();
  let reachedPool = false;
  try {
    await svc.create({
      typeSlug: "game_1",
      name: "Game 1",
      luckyNumbers: [5, 5, 10, 10, 15],
      createdBy: "u-1",
    });
  } catch (err) {
    reachedPool = (err as Error).message.includes("UNEXPECTED_POOL_CALL");
  }
  assert.ok(reachedPool, "dedup skulle ikke feile på validering");
});

// ── update-validering ───────────────────────────────────────────────────────

test("BIN-620 service: update() avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty id",
    () => svc.update("", { name: "Ny" }),
    "INVALID_INPUT"
  );
});

test("BIN-620 service: update() avviser når ingen endringer er oppgitt", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "gt-1",
    typeSlug: "game_1",
    deletedAt: null,
    rangeMin: null,
    rangeMax: null,
  });
  await expectDomainError(
    "no changes",
    () => svc.update("gt-1", {}),
    "INVALID_INPUT"
  );
});

test("BIN-620 service: update() avviser slettet GameType", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "gt-1",
    typeSlug: "game_1",
    deletedAt: "2026-04-01T00:00:00Z",
    rangeMin: null,
    rangeMax: null,
  });
  await expectDomainError(
    "deleted GameType",
    () => svc.update("gt-1", { name: "Ny" }),
    "GAME_TYPE_DELETED"
  );
});

test("BIN-620 service: update() avviser rangeMin > rangeMax (cross-field)", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "gt-1",
    typeSlug: "game_1",
    deletedAt: null,
    rangeMin: 10,
    rangeMax: 50,
  });
  await expectDomainError(
    "range-inversion on update",
    () => svc.update("gt-1", { rangeMin: 100 }),
    "INVALID_INPUT"
  );
});

test("BIN-620 service: update() avviser pattern som ikke-boolean", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "gt-1",
    typeSlug: "game_1",
    deletedAt: null,
    rangeMin: null,
    rangeMax: null,
  });
  await expectDomainError(
    "non-boolean pattern",
    () => svc.update("gt-1", { pattern: "true" as unknown as boolean }),
    "INVALID_INPUT"
  );
});

// ── remove-validering ───────────────────────────────────────────────────────

test("BIN-620 service: remove() avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty id for remove",
    () => svc.remove(""),
    "INVALID_INPUT"
  );
});

test("BIN-620 service: remove() avviser allerede slettet GameType", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "gt-1",
    typeSlug: "game_1",
    deletedAt: "2026-04-01T00:00:00Z",
  });
  await expectDomainError(
    "already deleted",
    () => svc.remove("gt-1"),
    "GAME_TYPE_DELETED"
  );
});

test("BIN-620 service: remove(hard=true) blokkeres hvis referenceChecker returnerer true", async () => {
  const svc = Object.create(GameTypeService.prototype) as GameTypeService;
  const stubPool = {
    query: async () => ({ rows: [] }),
    connect: async () => {
      throw new Error("UNEXPECTED_POOL_CALL");
    },
  };
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { initPromise: Promise<void> }).initPromise = Promise.resolve();
  (svc as unknown as {
    referenceChecker: (id: string) => Promise<boolean>;
  }).referenceChecker = async () => true;
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "gt-1",
    typeSlug: "game_1",
    deletedAt: null,
  });

  await expectDomainError(
    "hard delete blocked",
    () => svc.remove("gt-1", { hard: true }),
    "GAME_TYPE_IN_USE"
  );
});

// ── constructor-validering ──────────────────────────────────────────────────

test("BIN-620 service: constructor avviser blank connection string", () => {
  assert.throws(
    () => new GameTypeService({ connectionString: "  " }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
});

test("BIN-620 service: constructor avviser ugyldig schema-navn", () => {
  assert.throws(
    () =>
      new GameTypeService({
        connectionString: "postgres://x",
        schema: "drop-table; --",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
});

// ── forTesting-hook ────────────────────────────────────────────────────────

test("BIN-620 service: forTesting() lager instans uten å åpne pool", () => {
  const fakePool = {
    query: async () => ({ rows: [] }),
  } as unknown as import("pg").Pool;
  const svc = GameTypeService.forTesting(fakePool, "public");
  assert.ok(svc instanceof GameTypeService);
});

test("BIN-620 service: forTesting() avviser ugyldig schema-navn", () => {
  const fakePool = {
    query: async () => ({ rows: [] }),
  } as unknown as import("pg").Pool;
  assert.throws(
    () => GameTypeService.forTesting(fakePool, "drop table;"),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
});

// ── get() validering ────────────────────────────────────────────────────────

test("BIN-620 service: get() avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty id for get",
    () => svc.get(""),
    "INVALID_INPUT"
  );
});

test("BIN-620 service: getBySlug() avviser tom slug", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty slug",
    () => svc.getBySlug(""),
    "INVALID_INPUT"
  );
});
