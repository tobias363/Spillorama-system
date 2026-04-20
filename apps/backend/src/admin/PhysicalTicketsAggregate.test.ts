/**
 * BIN-648: unit-tests for PhysicalTicketsAggregateService.
 *
 * Testene bruker stub-Pool som returnerer forhåndsdefinerte aggregat-rader
 * for å validere:
 *   - Mapping (snake_case row → camelCase API)
 *   - Totals-summering på tvers av rader
 *   - Filter-propagering (hallId / from / to / limit) til SQL-params
 *   - Input-validering (ugyldig ISO, from > to, hall/schema-navn)
 *
 * Full ende-til-ende SQL-kjøring dekkes av integrasjonstester mot Postgres
 * i eget miljø; her fokuserer vi på service-logikken rundt SQL-laget.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import {
  PhysicalTicketsAggregateService,
  type PhysicalTicketsAggregateFilter,
} from "./PhysicalTicketsAggregate.js";
import { DomainError } from "../game/BingoEngine.js";

interface QueryCall {
  sql: string;
  params: unknown[];
}

type StubRow = {
  assigned_game_id: string | null;
  hall_id: string;
  sold: string | number;
  cashed_out: string | number;
  total_revenue_cents: string | number | null;
};

function makeStubPool(rows: StubRow[] = []): { pool: Pool; calls: QueryCall[] } {
  const calls: QueryCall[] = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows };
    },
    connect: async () => {
      throw new Error("UNEXPECTED_CONNECT — aggregate bruker kun pool.query");
    },
  } as unknown as Pool;
  return { pool, calls };
}

function makeService(rows: StubRow[] = []): { svc: PhysicalTicketsAggregateService; calls: QueryCall[] } {
  const { pool, calls } = makeStubPool(rows);
  const svc = PhysicalTicketsAggregateService.forTesting(pool, "public");
  return { svc, calls };
}

function fixedNow(): Date {
  return new Date("2026-04-20T12:00:00.000Z");
}

// ── Row-mapping ────────────────────────────────────────────────────────────

test("BIN-648: mapper SQL-rader til camelCase aggregate-rader", async () => {
  const { svc } = makeService([
    {
      assigned_game_id: "game-1",
      hall_id: "hall-a",
      sold: "4",
      cashed_out: "1",
      total_revenue_cents: "25000",
    },
    {
      assigned_game_id: null,
      hall_id: "hall-b",
      sold: 0,
      cashed_out: 3,
      total_revenue_cents: 15000,
    },
  ]);
  const result = await svc.aggregate({ now: fixedNow() });
  assert.equal(result.generatedAt, "2026-04-20T12:00:00.000Z");
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], {
    gameId: "game-1",
    hallId: "hall-a",
    sold: 4,
    pending: 4,
    cashedOut: 1,
    totalRevenueCents: 25000,
  });
  assert.deepEqual(result.rows[1], {
    gameId: null,
    hallId: "hall-b",
    sold: 0,
    pending: 0,
    cashedOut: 3,
    totalRevenueCents: 15000,
  });
});

test("BIN-648: pending === sold (alias)", async () => {
  const { svc } = makeService([
    { assigned_game_id: "g", hall_id: "h", sold: 7, cashed_out: 2, total_revenue_cents: 0 },
  ]);
  const result = await svc.aggregate({ now: fixedNow() });
  assert.equal(result.rows[0]!.pending, result.rows[0]!.sold);
});

test("BIN-648: totals summeres korrekt over rader", async () => {
  const { svc } = makeService([
    { assigned_game_id: "g1", hall_id: "h-a", sold: 5, cashed_out: 1, total_revenue_cents: 10_000 },
    { assigned_game_id: "g2", hall_id: "h-a", sold: 3, cashed_out: 2, total_revenue_cents: 6_000 },
    { assigned_game_id: "g1", hall_id: "h-b", sold: 2, cashed_out: 0, total_revenue_cents: 4_000 },
  ]);
  const result = await svc.aggregate({ now: fixedNow() });
  assert.equal(result.totals.sold, 10);
  assert.equal(result.totals.pending, 10);
  assert.equal(result.totals.cashedOut, 3);
  assert.equal(result.totals.totalRevenueCents, 20_000);
  assert.equal(result.totals.rowCount, 3);
});

test("BIN-648: tomt resultat gir tomme rader + nullede totals", async () => {
  const { svc } = makeService([]);
  const result = await svc.aggregate({ now: fixedNow() });
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.totals, {
    sold: 0,
    pending: 0,
    cashedOut: 0,
    totalRevenueCents: 0,
    rowCount: 0,
  });
});

test("BIN-648: null total_revenue_cents mappes til 0 (defense-in-depth)", async () => {
  const { svc } = makeService([
    { assigned_game_id: "g", hall_id: "h", sold: 1, cashed_out: 0, total_revenue_cents: null },
  ]);
  const result = await svc.aggregate({ now: fixedNow() });
  assert.equal(result.rows[0]!.totalRevenueCents, 0);
});

// ── Filter-propagering ────────────────────────────────────────────────────

test("BIN-648: hallId-filter sendes som SQL-param", async () => {
  const { svc, calls } = makeService([]);
  await svc.aggregate({ hallId: "hall-a", now: fixedNow() });
  assert.equal(calls.length, 1);
  assert.ok(calls[0]!.params.includes("hall-a"), "hallId må bli SQL-param");
  assert.match(calls[0]!.sql, /t\.hall_id = \$1/);
});

test("BIN-648: from/to filter går som timestamptz-params", async () => {
  const { svc, calls } = makeService([]);
  await svc.aggregate({
    from: "2026-04-01T00:00:00Z",
    to: "2026-04-20T23:59:59Z",
    now: fixedNow(),
  });
  assert.match(calls[0]!.sql, /t\.sold_at >= \$\d+::timestamptz/);
  assert.match(calls[0]!.sql, /t\.sold_at <= \$\d+::timestamptz/);
});

test("BIN-648: uten filter sender kun status + limit", async () => {
  const { svc, calls } = makeService([]);
  await svc.aggregate({ now: fixedNow() });
  assert.equal(calls[0]!.params.length, 1, "bare limit som param");
  assert.match(calls[0]!.sql, /t\.status = 'SOLD'/);
});

test("BIN-648: GROUP BY assigned_game_id + hall_id i SQL", async () => {
  const { svc, calls } = makeService([]);
  await svc.aggregate({ now: fixedNow() });
  assert.match(calls[0]!.sql, /GROUP BY t\.assigned_game_id, t\.hall_id/);
});

test("BIN-648: limit clampes til [1, 10000]", async () => {
  const tooSmall = await tryLimit(-5);
  const tooBig = await tryLimit(99999);
  const ok = await tryLimit(250);
  assert.equal(tooSmall, 1, "negative clampes til minst 1");
  assert.equal(tooBig, 10_000, "over 10k clampes til 10k");
  assert.equal(ok, 250, "normal-verdi passeres gjennom");
});

async function tryLimit(limit: number): Promise<number> {
  const { svc, calls } = makeService([]);
  await svc.aggregate({ limit, now: fixedNow() });
  return Number(calls[0]!.params[calls[0]!.params.length - 1]);
}

// ── Validering ────────────────────────────────────────────────────────────

test("BIN-648: ugyldig 'from' → DomainError INVALID_INPUT", async () => {
  const { svc } = makeService([]);
  await assert.rejects(
    () => svc.aggregate({ from: "not-a-date", now: fixedNow() } as PhysicalTicketsAggregateFilter),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("BIN-648: ugyldig 'to' → DomainError INVALID_INPUT", async () => {
  const { svc } = makeService([]);
  await assert.rejects(
    () => svc.aggregate({ to: "ugyldig", now: fixedNow() }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("BIN-648: from > to → DomainError", async () => {
  const { svc } = makeService([]);
  await assert.rejects(
    () =>
      svc.aggregate({
        from: "2026-04-20T00:00:00Z",
        to: "2026-04-01T00:00:00Z",
        now: fixedNow(),
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("BIN-648: tom hallId-streng tolkes som 'ingen filter'", async () => {
  const { svc, calls } = makeService([]);
  await svc.aggregate({ hallId: "   ", now: fixedNow() });
  // kun limit som param (ingen hallId-binding)
  assert.equal(calls[0]!.params.length, 1);
  assert.doesNotMatch(calls[0]!.sql, /t\.hall_id = \$/);
});

test("BIN-648: result.from / result.to normaliseres til ISO", async () => {
  const { svc } = makeService([]);
  const result = await svc.aggregate({
    from: "2026-04-01T00:00:00+02:00",
    to: "2026-04-20T23:59:59Z",
    now: fixedNow(),
  });
  // +02:00 normaliseres til Z-ISO
  assert.equal(result.from, "2026-03-31T22:00:00.000Z");
  assert.equal(result.to, "2026-04-20T23:59:59.000Z");
});

test("BIN-648: ugyldig schema-navn → DomainError ved construction", () => {
  assert.throws(
    () =>
      new PhysicalTicketsAggregateService({
        connectionString: "postgres://localhost",
        schema: "drop; table--",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG",
  );
});

test("BIN-648: tom connectionString → DomainError ved construction", () => {
  assert.throws(
    () => new PhysicalTicketsAggregateService({ connectionString: "   " }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG",
  );
});
