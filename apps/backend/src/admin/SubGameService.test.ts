/**
 * BIN-621: unit-tester for SubGameService validering.
 *
 * Integrasjonstestene (routes/__tests__/adminSubGames.test.ts) stubber ut
 * service. Denne filen verifiserer at service-laget avviser ugyldig input
 * før det når Postgres. Object.create-pattern (samme som GameTypeService.test.ts)
 * for å unngå faktisk oppkopling.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { SubGameService } from "./SubGameService.js";
import { DomainError } from "../game/BingoEngine.js";

function makeValidatingService(): SubGameService {
  const svc = Object.create(SubGameService.prototype) as SubGameService;
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

test("BIN-621 service: create() avviser tom gameTypeId", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty gameTypeId",
    () => svc.create({ gameTypeId: "", name: "Pattern 1", createdBy: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: create() avviser tom name", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty name",
    () => svc.create({ gameTypeId: "game_1", name: "", createdBy: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: create() avviser name > 200 tegn", async () => {
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

test("BIN-621 service: create() avviser tom createdBy", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty createdBy",
    () => svc.create({ gameTypeId: "game_1", name: "Pattern 1", createdBy: "" }),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: create() avviser ugyldig status", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad status",
    () =>
      svc.create({
        gameTypeId: "game_1",
        name: "Pattern 1",
        status: "running" as "active",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: create() avviser tom gameName hvis satt", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty gameName",
    () =>
      svc.create({
        gameTypeId: "game_1",
        name: "Pattern 1",
        gameName: "",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: create() avviser tom subGameNumber hvis satt", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty subGameNumber",
    () =>
      svc.create({
        gameTypeId: "game_1",
        name: "Pattern 1",
        subGameNumber: "",
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: create() avviser patternRows som ikke-array", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "non-array patternRows",
    () =>
      svc.create({
        gameTypeId: "game_1",
        name: "Pattern 1",
        patternRows: "pat-1" as unknown as [],
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: create() avviser patternRows-elem uten patternId", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "missing patternId",
    () =>
      svc.create({
        gameTypeId: "game_1",
        name: "Pattern 1",
        patternRows: [{ patternId: "", name: "X" }],
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: create() avviser patternRows-elem uten name", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "missing name in patternRows",
    () =>
      svc.create({
        gameTypeId: "game_1",
        name: "Pattern 1",
        patternRows: [{ patternId: "pat-1", name: "" }],
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: create() avviser patternRows-elem som primitive", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "string in patternRows",
    () =>
      svc.create({
        gameTypeId: "game_1",
        name: "Pattern 1",
        patternRows: ["pat-1"] as unknown as [],
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: create() avviser ticketColors som ikke-array", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "non-array ticketColors",
    () =>
      svc.create({
        gameTypeId: "game_1",
        name: "Pattern 1",
        ticketColors: "Red,Blue" as unknown as string[],
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: create() avviser tomme ticketColors-strings", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty string in ticketColors",
    () =>
      svc.create({
        gameTypeId: "game_1",
        name: "Pattern 1",
        ticketColors: ["Red", ""],
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: create() avviser non-string ticketColors-elem", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "non-string ticketColors element",
    () =>
      svc.create({
        gameTypeId: "game_1",
        name: "Pattern 1",
        ticketColors: [42 as unknown as string],
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: create() avviser extra som array", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "array extra",
    () =>
      svc.create({
        gameTypeId: "game_1",
        name: "Pattern 1",
        extra: ["not", "valid"] as unknown as Record<string, unknown>,
        createdBy: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: create() aksepterer gyldig minimal input (skal treffe pool)", async () => {
  const svc = makeValidatingService();
  let reachedPool = false;
  try {
    await svc.create({
      gameTypeId: "game_1",
      name: "Pattern 1",
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

test("BIN-621 service: create() aksepterer full input", async () => {
  const svc = makeValidatingService();
  let reachedPool = false;
  try {
    await svc.create({
      gameTypeId: "game_1",
      gameName: "Game1",
      name: "4-in-a-row",
      subGameNumber: "SG_20260419_120000",
      patternRows: [
        { patternId: "p-1", name: "Top row" },
        { patternId: "p-2", name: "Diagonal" },
      ],
      ticketColors: ["Red", "Blue", "Green"],
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

test("BIN-621 service: create() dedupliserer patternRows på patternId", async () => {
  const svc = makeValidatingService();
  let reachedPool = false;
  try {
    await svc.create({
      gameTypeId: "game_1",
      name: "Pattern 1",
      patternRows: [
        { patternId: "p-1", name: "Top row" },
        { patternId: "p-1", name: "Top row duplicate" },
        { patternId: "p-2", name: "Diagonal" },
      ],
      createdBy: "u-1",
    });
  } catch (err) {
    reachedPool = (err as Error).message.includes("UNEXPECTED_POOL_CALL");
  }
  assert.ok(reachedPool, "dedup skulle ikke feile på validering");
});

test("BIN-621 service: create() dedupliserer ticketColors case-insensitive", async () => {
  const svc = makeValidatingService();
  let reachedPool = false;
  try {
    await svc.create({
      gameTypeId: "game_1",
      name: "Pattern 1",
      ticketColors: ["Red", "red", "Blue", "BLUE"],
      createdBy: "u-1",
    });
  } catch (err) {
    reachedPool = (err as Error).message.includes("UNEXPECTED_POOL_CALL");
  }
  assert.ok(reachedPool, "case-insensitive dedup skulle ikke feile");
});

// ── update-validering ───────────────────────────────────────────────────────

test("BIN-621 service: update() avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty id",
    () => svc.update("", { name: "Ny" }),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: update() avviser når ingen endringer er oppgitt", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "sg-1",
    gameTypeId: "game_1",
    deletedAt: null,
  });
  await expectDomainError(
    "no changes",
    () => svc.update("sg-1", {}),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: update() avviser slettet SubGame", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "sg-1",
    gameTypeId: "game_1",
    deletedAt: "2026-04-01T00:00:00Z",
  });
  await expectDomainError(
    "deleted SubGame",
    () => svc.update("sg-1", { name: "Ny" }),
    "SUB_GAME_DELETED"
  );
});

test("BIN-621 service: update() avviser ugyldig status-verdi", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "sg-1",
    gameTypeId: "game_1",
    deletedAt: null,
  });
  await expectDomainError(
    "bad status in update",
    () => svc.update("sg-1", { status: "running" as "active" }),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: update() avviser tom gameName", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "sg-1",
    gameTypeId: "game_1",
    deletedAt: null,
  });
  await expectDomainError(
    "empty gameName in update",
    () => svc.update("sg-1", { gameName: "   " }),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: update() avviser tomme patternRows-felter", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "sg-1",
    gameTypeId: "game_1",
    deletedAt: null,
  });
  await expectDomainError(
    "empty patternId in update",
    () =>
      svc.update("sg-1", {
        patternRows: [{ patternId: "", name: "X" }],
      }),
    "INVALID_INPUT"
  );
});

// ── remove-validering ───────────────────────────────────────────────────────

test("BIN-621 service: remove() avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty id for remove",
    () => svc.remove(""),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: remove() avviser allerede slettet SubGame", async () => {
  const svc = makeValidatingService();
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "sg-1",
    gameTypeId: "game_1",
    subGameNumber: "SG_20260101_000000",
    deletedAt: "2026-04-01T00:00:00Z",
  });
  await expectDomainError(
    "already deleted",
    () => svc.remove("sg-1"),
    "SUB_GAME_DELETED"
  );
});

test("BIN-621 service: remove(hard=true) blokkeres hvis referenceChecker returnerer true", async () => {
  const svc = Object.create(SubGameService.prototype) as SubGameService;
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
    id: "sg-1",
    gameTypeId: "game_1",
    subGameNumber: "SG_20260101_000000",
    deletedAt: null,
  });

  await expectDomainError(
    "hard delete blocked",
    () => svc.remove("sg-1", { hard: true }),
    "SUB_GAME_IN_USE"
  );
});

test("BIN-621 service: remove(hard=true) tillatt hvis referenceChecker returnerer false", async () => {
  const svc = Object.create(SubGameService.prototype) as SubGameService;
  const queries: string[] = [];
  const stubPool = {
    query: async (sql: string) => {
      queries.push(sql);
      return { rows: [] };
    },
    connect: async () => {
      throw new Error("UNEXPECTED_POOL_CALL");
    },
  };
  (svc as unknown as { pool: unknown }).pool = stubPool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { initPromise: Promise<void> }).initPromise = Promise.resolve();
  (svc as unknown as {
    referenceChecker: (id: string) => Promise<boolean>;
  }).referenceChecker = async () => false;
  (svc as unknown as { get: (id: string) => Promise<unknown> }).get = async () => ({
    id: "sg-1",
    gameTypeId: "game_1",
    subGameNumber: "SG_20260101_000000",
    deletedAt: null,
  });

  const res = await svc.remove("sg-1", { hard: true });
  assert.equal(res.softDeleted, false);
  assert.ok(queries.some((q) => q.includes("DELETE FROM")), "DELETE skal ha blitt kjørt");
});

// ── constructor-validering ──────────────────────────────────────────────────

test("BIN-621 service: constructor avviser blank connection string", () => {
  assert.throws(
    () => new SubGameService({ connectionString: "  " }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
});

test("BIN-621 service: constructor avviser ugyldig schema-navn", () => {
  assert.throws(
    () =>
      new SubGameService({
        connectionString: "postgres://x",
        schema: "drop-table; --",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
});

// ── forTesting-hook ────────────────────────────────────────────────────────

test("BIN-621 service: forTesting() lager instans uten å åpne pool", () => {
  const fakePool = {
    query: async () => ({ rows: [] }),
  } as unknown as import("pg").Pool;
  const svc = SubGameService.forTesting(fakePool, "public");
  assert.ok(svc instanceof SubGameService);
});

test("BIN-621 service: forTesting() avviser ugyldig schema-navn", () => {
  const fakePool = {
    query: async () => ({ rows: [] }),
  } as unknown as import("pg").Pool;
  assert.throws(
    () => SubGameService.forTesting(fakePool, "drop table;"),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG"
  );
});

// ── get() validering ────────────────────────────────────────────────────────

test("BIN-621 service: get() avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty id for get",
    () => svc.get(""),
    "INVALID_INPUT"
  );
});

// ── list-filter-validering ──────────────────────────────────────────────────

test("BIN-621 service: list() avviser tom gameTypeId i filter", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty gameTypeId filter",
    () => svc.list({ gameTypeId: "   " }),
    "INVALID_INPUT"
  );
});

test("BIN-621 service: list() avviser ugyldig status i filter", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "bad status filter",
    () => svc.list({ status: "running" as "active" }),
    "INVALID_INPUT"
  );
});
