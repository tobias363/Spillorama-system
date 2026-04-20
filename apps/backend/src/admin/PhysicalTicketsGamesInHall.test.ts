/**
 * BIN-638: unit-tests for PhysicalTicketsGamesInHallService.
 *
 * Stub-Pool returnerer forhåndsdefinerte aggregat-rader for å validere:
 *   - Mapping (snake_case → camelCase, alias-kolonner)
 *   - `status` fra boolean is_active + `null`-håndtering
 *   - Totals-summering på tvers av rader
 *   - Filter-propagering (hallId / from / to / limit) til SQL-params
 *   - Input-validering (ugyldig ISO, from > to, manglende hallId)
 *   - LEFT JOIN mot hall_game_schedules bevart i SQL
 *
 * Full ende-til-ende SQL-kjøring dekkes av integrasjonstester mot Postgres i
 * eget miljø; her fokuserer vi på service-logikken rundt SQL-laget.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import {
  PhysicalTicketsGamesInHallService,
  type GamesInHallFilter,
} from "./PhysicalTicketsGamesInHall.js";
import { DomainError } from "../game/BingoEngine.js";

interface QueryCall {
  sql: string;
  params: unknown[];
}

type StubRow = {
  assigned_game_id: string | null;
  display_name: string | null;
  is_active: boolean | null;
  sold: string | number;
  pending: string | number;
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
      throw new Error("UNEXPECTED_CONNECT — games-in-hall bruker kun pool.query");
    },
  } as unknown as Pool;
  return { pool, calls };
}

function makeService(rows: StubRow[] = []): {
  svc: PhysicalTicketsGamesInHallService;
  calls: QueryCall[];
} {
  const { pool, calls } = makeStubPool(rows);
  const svc = PhysicalTicketsGamesInHallService.forTesting(pool, "public");
  return { svc, calls };
}

function fixedNow(): Date {
  return new Date("2026-04-20T12:00:00.000Z");
}

// ── Row-mapping ────────────────────────────────────────────────────────────

test("BIN-638: mapper SQL-rader til camelCase aggregate-rader", async () => {
  const { svc } = makeService([
    {
      assigned_game_id: "game-1",
      display_name: "Kveldsgame",
      is_active: true,
      sold: "5",
      pending: "4",
      cashed_out: "1",
      total_revenue_cents: "25000",
    },
    {
      assigned_game_id: null,
      display_name: null,
      is_active: null,
      sold: 3,
      pending: 0,
      cashed_out: 3,
      total_revenue_cents: 15000,
    },
  ]);
  const result = await svc.gamesInHall({ hallId: "hall-a", now: fixedNow() });
  assert.equal(result.generatedAt, "2026-04-20T12:00:00.000Z");
  assert.equal(result.hallId, "hall-a");
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[0], {
    gameId: "game-1",
    name: "Kveldsgame",
    status: "ACTIVE",
    sold: 5,
    pendingCashoutCount: 4,
    ticketsInPlay: 4,
    cashedOut: 1,
    totalRevenueCents: 25000,
  });
  assert.deepEqual(result.rows[1], {
    gameId: null,
    name: null,
    status: null,
    sold: 3,
    pendingCashoutCount: 0,
    ticketsInPlay: 0,
    cashedOut: 3,
    totalRevenueCents: 15000,
  });
});

test("BIN-638: is_active=false → status='INACTIVE'", async () => {
  const { svc } = makeService([
    {
      assigned_game_id: "g",
      display_name: "Old game",
      is_active: false,
      sold: 1,
      pending: 1,
      cashed_out: 0,
      total_revenue_cents: 5000,
    },
  ]);
  const result = await svc.gamesInHall({ hallId: "h", now: fixedNow() });
  assert.equal(result.rows[0]!.status, "INACTIVE");
  assert.equal(result.rows[0]!.name, "Old game");
});

test("BIN-638: pendingCashoutCount === ticketsInPlay (alias)", async () => {
  const { svc } = makeService([
    {
      assigned_game_id: "g",
      display_name: "x",
      is_active: true,
      sold: 7,
      pending: 5,
      cashed_out: 2,
      total_revenue_cents: 0,
    },
  ]);
  const result = await svc.gamesInHall({ hallId: "h", now: fixedNow() });
  assert.equal(result.rows[0]!.pendingCashoutCount, result.rows[0]!.ticketsInPlay);
  assert.equal(result.rows[0]!.pendingCashoutCount, 5);
});

test("BIN-638: totals summeres korrekt over rader", async () => {
  const { svc } = makeService([
    {
      assigned_game_id: "g1",
      display_name: "G1",
      is_active: true,
      sold: 6,
      pending: 5,
      cashed_out: 1,
      total_revenue_cents: 10_000,
    },
    {
      assigned_game_id: "g2",
      display_name: "G2",
      is_active: true,
      sold: 5,
      pending: 3,
      cashed_out: 2,
      total_revenue_cents: 6_000,
    },
    {
      assigned_game_id: "g3",
      display_name: null,
      is_active: null,
      sold: 2,
      pending: 2,
      cashed_out: 0,
      total_revenue_cents: 4_000,
    },
  ]);
  const result = await svc.gamesInHall({ hallId: "h", now: fixedNow() });
  assert.equal(result.totals.sold, 13);
  assert.equal(result.totals.pendingCashoutCount, 10);
  assert.equal(result.totals.ticketsInPlay, 10);
  assert.equal(result.totals.cashedOut, 3);
  assert.equal(result.totals.totalRevenueCents, 20_000);
  assert.equal(result.totals.rowCount, 3);
});

test("BIN-638: tomt resultat gir tomme rader + nullede totals", async () => {
  const { svc } = makeService([]);
  const result = await svc.gamesInHall({ hallId: "h", now: fixedNow() });
  assert.equal(result.rows.length, 0);
  assert.deepEqual(result.totals, {
    sold: 0,
    pendingCashoutCount: 0,
    ticketsInPlay: 0,
    cashedOut: 0,
    totalRevenueCents: 0,
    rowCount: 0,
  });
});

test("BIN-638: null total_revenue_cents mappes til 0 (defense-in-depth)", async () => {
  const { svc } = makeService([
    {
      assigned_game_id: "g",
      display_name: "x",
      is_active: true,
      sold: 1,
      pending: 1,
      cashed_out: 0,
      total_revenue_cents: null,
    },
  ]);
  const result = await svc.gamesInHall({ hallId: "h", now: fixedNow() });
  assert.equal(result.rows[0]!.totalRevenueCents, 0);
});

// ── Filter-propagering ────────────────────────────────────────────────────

test("BIN-638: hallId sendes alltid som $1-param", async () => {
  const { svc, calls } = makeService([]);
  await svc.gamesInHall({ hallId: "hall-xyz", now: fixedNow() });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.params[0], "hall-xyz");
  assert.match(calls[0]!.sql, /t\.hall_id = \$1/);
});

test("BIN-638: from/to filter går som timestamptz-params", async () => {
  const { svc, calls } = makeService([]);
  await svc.gamesInHall({
    hallId: "h",
    from: "2026-04-01T00:00:00Z",
    to: "2026-04-20T23:59:59Z",
    now: fixedNow(),
  });
  assert.match(calls[0]!.sql, /t\.sold_at >= \$\d+::timestamptz/);
  assert.match(calls[0]!.sql, /t\.sold_at <= \$\d+::timestamptz/);
});

test("BIN-638: uten from/to sender kun hallId + limit", async () => {
  const { svc, calls } = makeService([]);
  await svc.gamesInHall({ hallId: "h", now: fixedNow() });
  // hallId + limit
  assert.equal(calls[0]!.params.length, 2);
  assert.doesNotMatch(calls[0]!.sql, /t\.sold_at/);
});

test("BIN-638: GROUP BY assigned_game_id + display_name + is_active", async () => {
  const { svc, calls } = makeService([]);
  await svc.gamesInHall({ hallId: "h", now: fixedNow() });
  assert.match(calls[0]!.sql, /GROUP BY t\.assigned_game_id, s\.display_name, s\.is_active/);
});

test("BIN-638: LEFT JOIN hall_game_schedules bevart i SQL", async () => {
  const { svc, calls } = makeService([]);
  await svc.gamesInHall({ hallId: "h", now: fixedNow() });
  assert.match(calls[0]!.sql, /LEFT JOIN "public"\."hall_game_schedules" s/);
  assert.match(calls[0]!.sql, /s\.id = t\.assigned_game_id/);
});

test("BIN-638: limit clampes til [1, 5000]", async () => {
  const tooSmall = await tryLimit(-5);
  const tooBig = await tryLimit(99999);
  const ok = await tryLimit(250);
  assert.equal(tooSmall, 1, "negative clampes til minst 1");
  assert.equal(tooBig, 5_000, "over 5k clampes til 5k");
  assert.equal(ok, 250, "normal-verdi passeres gjennom");
});

async function tryLimit(limit: number): Promise<number> {
  const { svc, calls } = makeService([]);
  await svc.gamesInHall({ hallId: "h", limit, now: fixedNow() });
  return Number(calls[0]!.params[calls[0]!.params.length - 1]);
}

// ── Validering ────────────────────────────────────────────────────────────

test("BIN-638: manglende hallId → DomainError INVALID_INPUT", async () => {
  const { svc } = makeService([]);
  await assert.rejects(
    () => svc.gamesInHall({ hallId: "", now: fixedNow() }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("BIN-638: blank hallId-streng → DomainError", async () => {
  const { svc } = makeService([]);
  await assert.rejects(
    () => svc.gamesInHall({ hallId: "   ", now: fixedNow() }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("BIN-638: ugyldig 'from' → DomainError INVALID_INPUT", async () => {
  const { svc } = makeService([]);
  await assert.rejects(
    () =>
      svc.gamesInHall({
        hallId: "h",
        from: "not-a-date",
        now: fixedNow(),
      } as GamesInHallFilter),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("BIN-638: ugyldig 'to' → DomainError INVALID_INPUT", async () => {
  const { svc } = makeService([]);
  await assert.rejects(
    () => svc.gamesInHall({ hallId: "h", to: "ugyldig", now: fixedNow() }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("BIN-638: from > to → DomainError", async () => {
  const { svc } = makeService([]);
  await assert.rejects(
    () =>
      svc.gamesInHall({
        hallId: "h",
        from: "2026-04-20T00:00:00Z",
        to: "2026-04-01T00:00:00Z",
        now: fixedNow(),
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

test("BIN-638: result.from / result.to normaliseres til ISO", async () => {
  const { svc } = makeService([]);
  const result = await svc.gamesInHall({
    hallId: "h",
    from: "2026-04-01T00:00:00+02:00",
    to: "2026-04-20T23:59:59Z",
    now: fixedNow(),
  });
  assert.equal(result.from, "2026-03-31T22:00:00.000Z");
  assert.equal(result.to, "2026-04-20T23:59:59.000Z");
});

test("BIN-638: ugyldig schema-navn → DomainError ved construction", () => {
  assert.throws(
    () =>
      new PhysicalTicketsGamesInHallService({
        connectionString: "postgres://localhost",
        schema: "drop; table--",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG",
  );
});

test("BIN-638: tom connectionString → DomainError ved construction", () => {
  assert.throws(
    () => new PhysicalTicketsGamesInHallService({ connectionString: "   " }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG",
  );
});

test("BIN-638: hallId trimmes før bruk", async () => {
  const { svc, calls } = makeService([]);
  const result = await svc.gamesInHall({ hallId: "  hall-trim  ", now: fixedNow() });
  assert.equal(result.hallId, "hall-trim");
  assert.equal(calls[0]!.params[0], "hall-trim");
});
