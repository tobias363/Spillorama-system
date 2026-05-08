/**
 * Bølge 6 (2026-05-08): unit-tester for Game1ScheduledGameFinder.
 *
 * Audit-rapport: `docs/architecture/PLAN_SPILL_KOBLING_FUNDAMENT_AUDIT_2026-05-08.md`
 * §7 Bølge 6.
 *
 * Tester at:
 *   - Hver SCHEDULED_GAME_STATUSES-konstant trigger riktig WHERE-clause
 *     (parameterized status IN ($2, $3, ...)).
 *   - Empty result returns null.
 *   - Multiple matches: orderBy-flagget styrer hvilken rad som velges.
 *   - Tom statuses-array kaster INVALID_INPUT (Postgres ville produsert
 *     syntaks-feil på `IN ()`).
 *   - 42P01 (table missing) / 42703 (column missing) → null + debug-log
 *     i stedet for å kaste.
 *   - Schema-validering — ugyldige skjema-navn avvises.
 *
 * Tester bruker en stub-Pool som matcher `pg.Pool.query` sin minimal
 * signatur, så vi slipper å avhenge av en kjørende Postgres-instans.
 */

import test from "node:test";
import assert from "node:assert/strict";

import type { Pool } from "pg";

import {
  Game1ScheduledGameFinder,
  SCHEDULED_GAME_STATUSES,
  type ScheduledGameRow,
} from "../Game1ScheduledGameFinder.js";
import { DomainError } from "../../errors/DomainError.js";

interface CapturedQuery {
  text: string;
  params: unknown[];
}

interface StubPoolOptions {
  /** Optional rows to return. */
  rows?: ScheduledGameRow[];
  /** If set, throw with this `code` (e.g. "42P01"). */
  errorCode?: string;
  /** If set, throw with this `message` (no `code` — re-thrown by finder). */
  errorMessage?: string;
}

function makeStubPool(opts: StubPoolOptions = {}): {
  pool: Pool;
  capturedQueries: CapturedQuery[];
} {
  const capturedQueries: CapturedQuery[] = [];
  const pool = {
    async query(text: string, params: unknown[]): Promise<{ rows: ScheduledGameRow[] }> {
      capturedQueries.push({ text, params });
      if (opts.errorCode) {
        const err = new Error("simulated DB error") as Error & { code?: string };
        err.code = opts.errorCode;
        throw err;
      }
      if (opts.errorMessage) {
        throw new Error(opts.errorMessage);
      }
      return { rows: opts.rows ?? [] };
    },
  };
  return {
    pool: pool as unknown as Pool,
    capturedQueries,
  };
}

function makeRow(overrides: Partial<ScheduledGameRow> = {}): ScheduledGameRow {
  return {
    id: "g-1",
    status: "running",
    master_hall_id: "hall-A",
    group_hall_id: "goh-1",
    participating_halls_json: ["hall-A", "hall-B"],
    sub_game_name: "Bingo",
    custom_game_name: null,
    scheduled_start_time: "2026-05-08T10:00:00Z",
    scheduled_end_time: "2026-05-08T11:00:00Z",
    actual_start_time: null,
    actual_end_time: null,
    ...overrides,
  };
}

// ── SCHEDULED_GAME_STATUSES-konstanter trigger riktig WHERE-clause ──────

test("SCHEDULED_GAME_STATUSES.ACTIVE → 4 statuser i query-params", async () => {
  const { pool, capturedQueries } = makeStubPool({ rows: [] });
  const finder = new Game1ScheduledGameFinder({ pool });
  await finder.findFor({
    hallId: "hall-A",
    statuses: SCHEDULED_GAME_STATUSES.ACTIVE,
  });
  assert.equal(capturedQueries.length, 1);
  const { text, params } = capturedQueries[0]!;
  assert.match(text, /status IN \(\$2, \$3, \$4, \$5\)/);
  assert.deepEqual(params, [
    "hall-A",
    "purchase_open",
    "ready_to_start",
    "running",
    "paused",
  ]);
});

test("SCHEDULED_GAME_STATUSES.ACTIVE_OR_UPCOMING → 5 statuser i query-params", async () => {
  const { pool, capturedQueries } = makeStubPool({ rows: [] });
  const finder = new Game1ScheduledGameFinder({ pool });
  await finder.findFor({
    hallId: "hall-A",
    statuses: SCHEDULED_GAME_STATUSES.ACTIVE_OR_UPCOMING,
  });
  const { text, params } = capturedQueries[0]!;
  assert.match(text, /status IN \(\$2, \$3, \$4, \$5, \$6\)/);
  assert.deepEqual(params, [
    "hall-A",
    "scheduled",
    "purchase_open",
    "ready_to_start",
    "running",
    "paused",
  ]);
});

test("SCHEDULED_GAME_STATUSES.SCHEDULED_ONLY → kun 'scheduled' i query-params", async () => {
  const { pool, capturedQueries } = makeStubPool({ rows: [] });
  const finder = new Game1ScheduledGameFinder({ pool });
  await finder.findFor({
    hallId: "hall-A",
    statuses: SCHEDULED_GAME_STATUSES.SCHEDULED_ONLY,
  });
  const { text, params } = capturedQueries[0]!;
  assert.match(text, /status IN \(\$2\)/);
  assert.deepEqual(params, ["hall-A", "scheduled"]);
});

// ── Resultat-håndtering ────────────────────────────────────────────────

test("empty result → null", async () => {
  const { pool } = makeStubPool({ rows: [] });
  const finder = new Game1ScheduledGameFinder({ pool });
  const result = await finder.findFor({
    hallId: "hall-A",
    statuses: SCHEDULED_GAME_STATUSES.ACTIVE,
  });
  assert.equal(result, null);
});

test("single row → returner raden", async () => {
  const expected = makeRow({ id: "g-42", status: "paused" });
  const { pool } = makeStubPool({ rows: [expected] });
  const finder = new Game1ScheduledGameFinder({ pool });
  const result = await finder.findFor({
    hallId: "hall-A",
    statuses: SCHEDULED_GAME_STATUSES.ACTIVE,
  });
  assert.deepEqual(result, expected);
});

test("LIMIT 1 i SQL — finder forventer at DB returnerer maks 1 rad", async () => {
  const { pool, capturedQueries } = makeStubPool({ rows: [] });
  const finder = new Game1ScheduledGameFinder({ pool });
  await finder.findFor({
    hallId: "hall-A",
    statuses: SCHEDULED_GAME_STATUSES.ACTIVE,
  });
  assert.match(capturedQueries[0]!.text, /LIMIT 1/);
});

// ── orderBy-styring ────────────────────────────────────────────────────

test("orderBy default = 'first-by-scheduled-start' → ORDER BY scheduled_start_time ASC", async () => {
  const { pool, capturedQueries } = makeStubPool({ rows: [] });
  const finder = new Game1ScheduledGameFinder({ pool });
  await finder.findFor({
    hallId: "hall-A",
    statuses: SCHEDULED_GAME_STATUSES.ACTIVE,
  });
  assert.match(
    capturedQueries[0]!.text,
    /ORDER BY scheduled_start_time ASC/,
  );
});

test("orderBy 'most-recent' → ORDER BY created_at DESC", async () => {
  const { pool, capturedQueries } = makeStubPool({ rows: [] });
  const finder = new Game1ScheduledGameFinder({ pool });
  await finder.findFor({
    hallId: "hall-A",
    statuses: SCHEDULED_GAME_STATUSES.ACTIVE,
    orderBy: "most-recent",
  });
  assert.match(capturedQueries[0]!.text, /ORDER BY created_at DESC/);
});

// ── Edge cases — tom statuses-array ────────────────────────────────────

test("tom statuses-array → INVALID_INPUT (Postgres syntaks-feil på IN ())", async () => {
  const { pool } = makeStubPool({ rows: [] });
  const finder = new Game1ScheduledGameFinder({ pool });
  await assert.rejects(
    () =>
      finder.findFor({
        hallId: "hall-A",
        statuses: [],
      }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "INVALID_INPUT");
      return true;
    },
  );
});

test("tom hallId → INVALID_INPUT", async () => {
  const { pool } = makeStubPool({ rows: [] });
  const finder = new Game1ScheduledGameFinder({ pool });
  await assert.rejects(
    () =>
      finder.findFor({
        hallId: "",
        statuses: SCHEDULED_GAME_STATUSES.ACTIVE,
      }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "INVALID_INPUT");
      return true;
    },
  );
});

// ── 42P01/42703 — soft-fail for dev-DB uten migrations ────────────────

test("42P01 (table missing) → null + ingen kast", async () => {
  const { pool } = makeStubPool({ errorCode: "42P01" });
  const finder = new Game1ScheduledGameFinder({ pool });
  const result = await finder.findFor({
    hallId: "hall-A",
    statuses: SCHEDULED_GAME_STATUSES.ACTIVE,
  });
  assert.equal(result, null);
});

test("42703 (column missing) → null + ingen kast", async () => {
  const { pool } = makeStubPool({ errorCode: "42703" });
  const finder = new Game1ScheduledGameFinder({ pool });
  const result = await finder.findFor({
    hallId: "hall-A",
    statuses: SCHEDULED_GAME_STATUSES.ACTIVE,
  });
  assert.equal(result, null);
});

test("annen DB-feil → propageres (skal ikke svelges)", async () => {
  const { pool } = makeStubPool({ errorMessage: "connection refused" });
  const finder = new Game1ScheduledGameFinder({ pool });
  await assert.rejects(
    () =>
      finder.findFor({
        hallId: "hall-A",
        statuses: SCHEDULED_GAME_STATUSES.ACTIVE,
      }),
    /connection refused/,
  );
});

// ── Schema-validering ─────────────────────────────────────────────────

test("ugyldig schema-navn → INVALID_CONFIG", () => {
  const { pool } = makeStubPool();
  assert.throws(
    () => new Game1ScheduledGameFinder({ pool, schema: "drop; --" }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "INVALID_CONFIG");
      return true;
    },
  );
});

test("default schema 'public' godtas", () => {
  const { pool } = makeStubPool();
  // Skal ikke kaste.
  const finder = new Game1ScheduledGameFinder({ pool });
  assert.ok(finder);
});

test("custom valid schema (alphanum + underscore) godtas", () => {
  const { pool } = makeStubPool();
  const finder = new Game1ScheduledGameFinder({
    pool,
    schema: "custom_schema_2",
  });
  assert.ok(finder);
});

// ── Hall-match-kriteriet ───────────────────────────────────────────────

test("WHERE matcher master_hall_id ELLER participating_halls_json", async () => {
  const { pool, capturedQueries } = makeStubPool({ rows: [] });
  const finder = new Game1ScheduledGameFinder({ pool });
  await finder.findFor({
    hallId: "hall-X",
    statuses: SCHEDULED_GAME_STATUSES.ACTIVE,
  });
  const { text } = capturedQueries[0]!;
  assert.match(text, /master_hall_id = \$1/);
  assert.match(text, /participating_halls_json::jsonb @> to_jsonb\(\$1::text\)/);
});

// ── Backwards-compat: SCHEDULED_GAME_STATUSES-konstanter er readonly ──

test("SCHEDULED_GAME_STATUSES-konstanter er readonly arrays", () => {
  // TypeScript fanger mutasjons-forsøk i `readonly`-declaration. Dette
  // testen verifiserer kun at konstantene er korrekte verdier som matcher
  // legacy-finder-funksjonene før Bølge 6.
  assert.deepEqual(
    [...SCHEDULED_GAME_STATUSES.ACTIVE],
    ["purchase_open", "ready_to_start", "running", "paused"],
  );
  assert.deepEqual(
    [...SCHEDULED_GAME_STATUSES.ACTIVE_OR_UPCOMING],
    ["scheduled", "purchase_open", "ready_to_start", "running", "paused"],
  );
  assert.deepEqual(
    [...SCHEDULED_GAME_STATUSES.SCHEDULED_ONLY],
    ["scheduled"],
  );
});
