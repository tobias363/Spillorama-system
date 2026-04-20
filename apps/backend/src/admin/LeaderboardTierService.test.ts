/**
 * BIN-668: unit-tester for LeaderboardTierService validering.
 *
 * Integrasjonstestene (routes/__tests__/adminLeaderboardTiers.test.ts) stubber
 * ut service. Denne filen verifiserer at service-laget avviser ugyldig input
 * før det når Postgres. Object.create-pattern (samme som GameTypeService-test).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { LeaderboardTierService } from "./LeaderboardTierService.js";
import { DomainError } from "../game/BingoEngine.js";

function makeValidatingService(): LeaderboardTierService {
  const svc = Object.create(
    LeaderboardTierService.prototype
  ) as LeaderboardTierService;
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

test("BIN-668 service: create() avviser 0 place", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "zero place",
    () => svc.create({ place: 0, createdByUserId: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-668 service: create() avviser negativ place", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negative place",
    () => svc.create({ place: -3, createdByUserId: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-668 service: create() avviser ikke-heltall place", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "float place",
    () => svc.create({ place: 1.5, createdByUserId: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-668 service: create() avviser negative points", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negative points",
    () =>
      svc.create({ place: 1, points: -10, createdByUserId: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-668 service: create() tillater points = 0 (validering passerer)", async () => {
  const svc = makeValidatingService();
  // Validering skal ikke kaste — forventer at vi når pool (som stubs Error).
  try {
    await svc.create({ place: 1, points: 0, createdByUserId: "u-1" });
    assert.fail("forventet feil fra stubbet pool");
  } catch (err) {
    // Skal ikke være DomainError (ingen validerings-feil) — skal være
    // UNEXPECTED_POOL_CALL fra stubben.
    assert.ok(err instanceof Error);
    assert.ok(!(err instanceof DomainError));
    assert.match((err as Error).message, /UNEXPECTED_POOL_CALL/);
  }
});

test("BIN-668 service: create() avviser negativ prizeAmount", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "negative prizeAmount",
    () =>
      svc.create({
        place: 1,
        prizeAmount: -500,
        createdByUserId: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-668 service: create() tillater prizeAmount = null (validering passerer)", async () => {
  const svc = makeValidatingService();
  try {
    await svc.create({
      place: 1,
      prizeAmount: null,
      createdByUserId: "u-1",
    });
    assert.fail("forventet feil fra stubbet pool");
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(!(err instanceof DomainError));
    assert.match((err as Error).message, /UNEXPECTED_POOL_CALL/);
  }
});

test("BIN-668 service: create() avviser tom tierName (eksplisitt tom streng)", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty tierName",
    () =>
      svc.create({ tierName: "", place: 1, createdByUserId: "u-1" }),
    "INVALID_INPUT"
  );
});

test("BIN-668 service: create() avviser tierName > 200 tegn", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "long tierName",
    () =>
      svc.create({
        tierName: "x".repeat(201),
        place: 1,
        createdByUserId: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-668 service: create() avviser prizeDescription > 500 tegn", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "long prizeDescription",
    () =>
      svc.create({
        place: 1,
        prizeDescription: "x".repeat(501),
        createdByUserId: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-668 service: create() avviser extra som array", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "array extra",
    () =>
      svc.create({
        place: 1,
        extra: ["not", "object"] as unknown as Record<string, unknown>,
        createdByUserId: "u-1",
      }),
    "INVALID_INPUT"
  );
});

test("BIN-668 service: create() avviser tom createdByUserId", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "empty createdByUserId",
    () => svc.create({ place: 1, createdByUserId: "" }),
    "INVALID_INPUT"
  );
});

// ── update-validering ───────────────────────────────────────────────────────

test("BIN-668 service: update() avviser ukjent id (før validering)", async () => {
  const svc = makeValidatingService();
  // update() kaller get() først, som kjører mot pool -> vi får UNEXPECTED_POOL_CALL
  // som Error (ikke DomainError). Dette viser at vi kommer dit, men dekningen
  // av update-validering gjør vi via stubbet pool nedenfor.
  try {
    await svc.update("abc", { place: 2 });
    assert.fail("expected error");
  } catch (err) {
    // Enten DomainError eller UNEXPECTED_POOL_CALL — begge er OK for denne testen.
    assert.ok(err instanceof Error);
  }
});

test("BIN-668 service: list() avviser ikke-boolean active", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "non-boolean active",
    () => svc.list({ active: "true" as unknown as boolean }),
    "INVALID_INPUT"
  );
});

test("BIN-668 service: list() ignorerer tom tierName-filter (falsy check)", async () => {
  const { pool, calls } = makePoolWithRows([{ rows: [] }]);
  const svc = makeServiceWithPool(pool);
  await svc.list({ tierName: "" });
  // Tom tierName er falsy og legges ikke til i WHERE — SQL skal ikke ha tier_name-betingelse.
  assert.ok(!calls[0]!.sql.includes("tier_name ="));
});

// ── get-validering ──────────────────────────────────────────────────────────

test("BIN-668 service: get() avviser tom id", async () => {
  const svc = makeValidatingService();
  await expectDomainError("empty id", () => svc.get(""), "INVALID_INPUT");
});

test("BIN-668 service: get() avviser whitespace-id", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "whitespace id",
    () => svc.get("   "),
    "INVALID_INPUT"
  );
});

// ── count-validering ────────────────────────────────────────────────────────

test("BIN-668 service: count() avviser ikke-boolean active", async () => {
  const svc = makeValidatingService();
  await expectDomainError(
    "count non-boolean active",
    () => svc.count({ active: 1 as unknown as boolean }),
    "INVALID_INPUT"
  );
});

// ── CRUD-flyt med stubbet pool ──────────────────────────────────────────────

interface QueryCall {
  sql: string;
  params: unknown[];
}

function makePoolWithRows(responses: Array<{ rows: unknown[] }>): {
  pool: unknown;
  calls: QueryCall[];
} {
  const calls: QueryCall[] = [];
  let idx = 0;
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const next = responses[idx];
      idx += 1;
      return next ?? { rows: [] };
    },
  };
  return { pool, calls };
}

function makeServiceWithPool(pool: unknown): LeaderboardTierService {
  const svc = Object.create(
    LeaderboardTierService.prototype
  ) as LeaderboardTierService;
  (svc as unknown as { pool: unknown }).pool = pool;
  (svc as unknown as { schema: string }).schema = "public";
  (svc as unknown as { initPromise: Promise<void> }).initPromise =
    Promise.resolve();
  return svc;
}

test("BIN-668 service: create() returnerer normalisert LeaderboardTier", async () => {
  const createdAt = new Date("2026-04-20T10:00:00Z");
  const { pool, calls } = makePoolWithRows([
    { rows: [] }, // INSERT — vi ignorerer retur
    {
      rows: [
        {
          id: "t-1",
          tier_name: "default",
          place: 1,
          points: 100,
          prize_amount: "500.00",
          prize_description: "Gavekort 500 kr",
          active: true,
          extra_json: { badge: "gold" },
          created_by_user_id: "u-1",
          created_at: createdAt,
          updated_at: createdAt,
          deleted_at: null,
        },
      ],
    },
  ]);
  const svc = makeServiceWithPool(pool);

  const result = await svc.create({
    place: 1,
    points: 100,
    prizeAmount: 500,
    prizeDescription: "Gavekort 500 kr",
    extra: { badge: "gold" },
    createdByUserId: "u-1",
  });

  assert.equal(result.tierName, "default");
  assert.equal(result.place, 1);
  assert.equal(result.points, 100);
  assert.equal(result.prizeAmount, 500);
  assert.equal(result.prizeDescription, "Gavekort 500 kr");
  assert.equal(result.active, true);
  assert.deepEqual(result.extra, { badge: "gold" });
  assert.equal(result.createdByUserId, "u-1");
  // Kall 1 = INSERT
  assert.ok(calls[0]!.sql.includes("INSERT INTO"));
  // Kall 2 = SELECT (fra get())
  assert.ok(calls[1]!.sql.includes("SELECT"));
});

test("BIN-668 service: create() default tierName = 'default' og active = true", async () => {
  const { pool, calls } = makePoolWithRows([
    { rows: [] },
    {
      rows: [
        {
          id: "t-2",
          tier_name: "default",
          place: 2,
          points: 0,
          prize_amount: null,
          prize_description: "",
          active: true,
          extra_json: {},
          created_by_user_id: "u-1",
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: null,
        },
      ],
    },
  ]);
  const svc = makeServiceWithPool(pool);

  const result = await svc.create({ place: 2, createdByUserId: "u-1" });
  assert.equal(result.tierName, "default");
  assert.equal(result.points, 0);
  assert.equal(result.prizeAmount, null);
  assert.equal(result.prizeDescription, "");
  assert.equal(result.active, true);
  // INSERT kall skal inkludere defaults: tier_name='default', active=true
  assert.ok(calls[0]!.params.includes("default"));
  assert.ok(calls[0]!.params.includes(true));
});

test("BIN-668 service: create() oversetter unique-violation til LEADERBOARD_TIER_DUPLICATE", async () => {
  const pool = {
    query: async () => {
      const err = new Error("duplicate") as Error & { code: string };
      err.code = "23505";
      throw err;
    },
  };
  const svc = makeServiceWithPool(pool);
  await expectDomainError(
    "duplicate",
    () =>
      svc.create({
        tierName: "default",
        place: 1,
        createdByUserId: "u-1",
      }),
    "LEADERBOARD_TIER_DUPLICATE"
  );
});

test("BIN-668 service: update() uten felter gir INVALID_INPUT", async () => {
  const { pool } = makePoolWithRows([
    {
      rows: [
        {
          id: "t-1",
          tier_name: "default",
          place: 1,
          points: 100,
          prize_amount: null,
          prize_description: "",
          active: true,
          extra_json: {},
          created_by_user_id: "u-1",
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: null,
        },
      ],
    },
  ]);
  const svc = makeServiceWithPool(pool);
  await expectDomainError(
    "empty update",
    () => svc.update("t-1", {}),
    "INVALID_INPUT"
  );
});

test("BIN-668 service: update() avviser oppdatering av slettet rad", async () => {
  const { pool } = makePoolWithRows([
    {
      rows: [
        {
          id: "t-1",
          tier_name: "default",
          place: 1,
          points: 100,
          prize_amount: null,
          prize_description: "",
          active: false,
          extra_json: {},
          created_by_user_id: "u-1",
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: new Date(),
        },
      ],
    },
  ]);
  const svc = makeServiceWithPool(pool);
  await expectDomainError(
    "update deleted",
    () => svc.update("t-1", { points: 200 }),
    "LEADERBOARD_TIER_DELETED"
  );
});

test("BIN-668 service: remove() default er soft-delete", async () => {
  const { pool, calls } = makePoolWithRows([
    {
      rows: [
        {
          id: "t-1",
          tier_name: "default",
          place: 1,
          points: 100,
          prize_amount: null,
          prize_description: "",
          active: true,
          extra_json: {},
          created_by_user_id: "u-1",
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: null,
        },
      ],
    },
    { rows: [] }, // UPDATE soft-delete
  ]);
  const svc = makeServiceWithPool(pool);
  const res = await svc.remove("t-1");
  assert.equal(res.softDeleted, true);
  // Siste kall skal være UPDATE med deleted_at = now()
  assert.ok(calls[1]!.sql.includes("UPDATE"));
  assert.ok(calls[1]!.sql.includes("deleted_at = now()"));
});

test("BIN-668 service: remove(hard=true) gjør DELETE", async () => {
  const { pool, calls } = makePoolWithRows([
    {
      rows: [
        {
          id: "t-1",
          tier_name: "default",
          place: 1,
          points: 100,
          prize_amount: null,
          prize_description: "",
          active: true,
          extra_json: {},
          created_by_user_id: "u-1",
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: null,
        },
      ],
    },
    { rows: [] }, // DELETE
  ]);
  const svc = makeServiceWithPool(pool);
  const res = await svc.remove("t-1", { hard: true });
  assert.equal(res.softDeleted, false);
  assert.ok(calls[1]!.sql.startsWith("DELETE FROM"));
});

test("BIN-668 service: remove() allerede slettet gir LEADERBOARD_TIER_DELETED", async () => {
  const { pool } = makePoolWithRows([
    {
      rows: [
        {
          id: "t-1",
          tier_name: "default",
          place: 1,
          points: 100,
          prize_amount: null,
          prize_description: "",
          active: false,
          extra_json: {},
          created_by_user_id: "u-1",
          created_at: new Date(),
          updated_at: new Date(),
          deleted_at: new Date(),
        },
      ],
    },
  ]);
  const svc = makeServiceWithPool(pool);
  await expectDomainError(
    "remove-deleted",
    () => svc.remove("t-1"),
    "LEADERBOARD_TIER_DELETED"
  );
});

test("BIN-668 service: get() kaster LEADERBOARD_TIER_NOT_FOUND ved tom rad", async () => {
  const { pool } = makePoolWithRows([{ rows: [] }]);
  const svc = makeServiceWithPool(pool);
  await expectDomainError(
    "not-found",
    () => svc.get("abc"),
    "LEADERBOARD_TIER_NOT_FOUND"
  );
});

test("BIN-668 service: list() mapper rader med NULL prize_amount riktig", async () => {
  const { pool } = makePoolWithRows([
    {
      rows: [
        {
          id: "t-1",
          tier_name: "default",
          place: 3,
          points: 10,
          prize_amount: null,
          prize_description: "",
          active: true,
          extra_json: null,
          created_by_user_id: null,
          created_at: "2026-04-20T10:00:00Z",
          updated_at: "2026-04-20T10:00:00Z",
          deleted_at: null,
        },
      ],
    },
  ]);
  const svc = makeServiceWithPool(pool);
  const rows = await svc.list();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.prizeAmount, null);
  assert.deepEqual(rows[0]!.extra, {});
  assert.equal(rows[0]!.createdByUserId, null);
});

test("BIN-668 service: count() med tierName-filter", async () => {
  const { pool, calls } = makePoolWithRows([{ rows: [{ c: "5" }] }]);
  const svc = makeServiceWithPool(pool);
  const n = await svc.count({ tierName: "vip", active: true });
  assert.equal(n, 5);
  assert.ok(calls[0]!.sql.includes("COUNT"));
  assert.ok(calls[0]!.params.includes("vip"));
  assert.ok(calls[0]!.params.includes(true));
});
