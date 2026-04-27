/**
 * BIN-GAP#4 — enhetstester for TicketRegistrationService.
 *
 * Spec: docs/architecture/WIREFRAME_CATALOG.md § "15.2 Register Sold Tickets"
 *
 * Dekker:
 *   1. getInitialIds returnerer alle 6 typer med initial_id=1 + round=1 når
 *      ingen tidligere registrering finnes.
 *   2. Carry-forward: runde 2 får initial_id = forrige final_id + 1 og
 *      round_number = forrige + 1.
 *   3. recordFinalIds happy-path oppretter rad + beregner sold_count.
 *   4. recordFinalIds oppdatterer eksisterende rad (idempotent modal-lukke).
 *   5. recordFinalIds avviser final < initial → FINAL_LESS_THAN_INITIAL.
 *   6. recordFinalIds avviser ukjent ticket-type → INVALID_TICKET_TYPE.
 *   7. recordFinalIds avviser ukjent gameId → GAME_NOT_FOUND.
 *   8. recordFinalIds avviser game i status "running" → GAME_NOT_EDITABLE.
 *   9. Multiple typer i ett kall → alle oppdatert atomisk.
 *  10. getSummary returnerer alle ranges for et gitt spill.
 *  11. validateRange helper.
 *  12. RANGE_OVERLAP: forsøk å sette samme range som finnes i annet spill.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import {
  TicketRegistrationService,
  TICKET_TYPES,
  type TicketType,
} from "../TicketRegistrationService.js";
import { DomainError } from "../../game/BingoEngine.js";

interface MockRange {
  id: string;
  game_id: string;
  hall_id: string;
  ticket_type: TicketType;
  initial_id: number;
  final_id: number | null;
  sold_count: number;
  round_number: number;
  carried_from_game_id: string | null;
  recorded_by_user_id: string | null;
  recorded_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface MockGame {
  id: string;
  status: string;
}

interface MockStore {
  ranges: Map<string, MockRange>;
  games: Map<string, MockGame>;
  txActive: number;
  commitCount: number;
  rollbackCount: number;
}

function newStore(): MockStore {
  return {
    ranges: new Map(),
    games: new Map(),
    txActive: 0,
    commitCount: 0,
    rollbackCount: 0,
  };
}

function seedGame(store: MockStore, id: string, status = "purchase_open"): void {
  store.games.set(id, { id, status });
}

function seedRange(store: MockStore, r: Partial<MockRange> & {
  id: string;
  game_id: string;
  hall_id: string;
  ticket_type: TicketType;
  initial_id: number;
}): MockRange {
  const now = new Date();
  const full: MockRange = {
    final_id: r.final_id ?? null,
    sold_count: r.sold_count ?? 0,
    round_number: r.round_number ?? 1,
    carried_from_game_id: r.carried_from_game_id ?? null,
    recorded_by_user_id: r.recorded_by_user_id ?? null,
    recorded_at: r.recorded_at ?? null,
    created_at: r.created_at ?? now,
    updated_at: r.updated_at ?? now,
    ...r,
  };
  store.ranges.set(full.id, full);
  return full;
}

function makeMockPool(store: MockStore): Pool {
  const runQuery = async (sql: string, params: unknown[] = []) => {
    const s = sql.trim();

    if (s === "BEGIN") {
      store.txActive += 1;
      return { rows: [], rowCount: 0 };
    }
    if (s === "COMMIT") {
      store.txActive = Math.max(0, store.txActive - 1);
      store.commitCount += 1;
      return { rows: [], rowCount: 0 };
    }
    if (s === "ROLLBACK") {
      store.txActive = Math.max(0, store.txActive - 1);
      store.rollbackCount += 1;
      return { rows: [], rowCount: 0 };
    }

    // SELECT id, status FROM scheduled_games WHERE id = $1 [FOR UPDATE]
    if (
      sql.includes("app_game1_scheduled_games")
      && sql.includes("WHERE id = $1")
    ) {
      const [id] = params as [string];
      const g = store.games.get(id);
      const rows = g ? [{ id: g.id, status: g.status }] : [];
      return { rows, rowCount: rows.length };
    }

    // SELECT range by id [FOR UPDATE] — REQ-091 editRange
    if (
      sql.includes("FROM")
      && sql.includes("app_ticket_ranges_per_game")
      && sql.includes("WHERE id = $1")
      && sql.includes("FOR UPDATE")
    ) {
      const [id] = params as [string];
      const r = store.ranges.get(id);
      const rows = r ? [mapRow(r)] : [];
      return { rows, rowCount: rows.length };
    }

    // Overlap-sjekk for editRange: WHERE id <> $1 AND hall_id = $2 AND ticket_type = $3
    if (
      sql.includes("FROM")
      && sql.includes("app_ticket_ranges_per_game")
      && sql.includes("WHERE id <> $1")
    ) {
      const [excludeId, hallId, type, initialId, finalId] = params as [
        string,
        string,
        TicketType,
        number,
        number,
      ];
      const overlaps = [...store.ranges.values()].filter((r) =>
        r.id !== excludeId
        && r.hall_id === hallId
        && r.ticket_type === type
        && r.final_id != null
        && !(r.final_id < initialId || r.initial_id > finalId)
      );
      const r = overlaps[0];
      const rows = r ? [{ id: r.id, game_id: r.game_id }] : [];
      return { rows, rowCount: rows.length };
    }

    // SELECT range for (game_id, hall_id, ticket_type) [FOR UPDATE]
    // Sjekkes FØR (game_id, hall_id) for å unngå prefix-match
    if (
      sql.includes("FROM")
      && sql.includes("app_ticket_ranges_per_game")
      && sql.includes("WHERE game_id = $1 AND hall_id = $2 AND ticket_type = $3")
    ) {
      const [gameId, hallId, type] = params as [string, string, TicketType];
      const r = [...store.ranges.values()].find(
        (x) => x.game_id === gameId && x.hall_id === hallId && x.ticket_type === type,
      );
      const rows = r ? [mapRow(r)] : [];
      return { rows, rowCount: rows.length };
    }

    // SELECT all ranges for (game_id, hall_id) — uten ticket_type-filter
    if (
      sql.includes("FROM")
      && sql.includes("app_ticket_ranges_per_game")
      && sql.includes("WHERE game_id = $1 AND hall_id = $2")
    ) {
      const [gameId, hallId] = params as [string, string];
      const rows = [...store.ranges.values()]
        .filter((r) => r.game_id === gameId && r.hall_id === hallId)
        .map(mapRow);
      return { rows, rowCount: rows.length };
    }

    // Carry-forward lookup: WHERE hall_id = $1 AND ticket_type = $2 AND final_id IS NOT NULL
    if (
      sql.includes("FROM")
      && sql.includes("app_ticket_ranges_per_game")
      && sql.includes("WHERE hall_id = $1 AND ticket_type = $2 AND final_id IS NOT NULL")
    ) {
      const [hallId, type] = params as [string, TicketType];
      const candidates = [...store.ranges.values()]
        .filter(
          (r) => r.hall_id === hallId
            && r.ticket_type === type
            && r.final_id != null,
        )
        .sort((a, b) => b.round_number - a.round_number);
      const r = candidates[0];
      const rows = r ? [mapRow(r)] : [];
      return { rows, rowCount: rows.length };
    }

    // Overlap-sjekk: WHERE hall_id=$1 AND ticket_type=$2 AND NOT (game_id=$3)
    //                AND final_id IS NOT NULL AND NOT (final_id<$4 OR initial_id>$5)
    if (
      sql.includes("FROM")
      && sql.includes("app_ticket_ranges_per_game")
      && sql.includes("NOT (game_id = $3)")
    ) {
      const [hallId, type, gameId, initialId, finalId] = params as [
        string,
        TicketType,
        string,
        number,
        number,
      ];
      const overlaps = [...store.ranges.values()].filter((r) =>
        r.hall_id === hallId
        && r.ticket_type === type
        && r.game_id !== gameId
        && r.final_id != null
        && !(r.final_id < initialId || r.initial_id > finalId)
      );
      const r = overlaps[0];
      const rows = r ? [{ id: r.id, game_id: r.game_id }] : [];
      return { rows, rowCount: rows.length };
    }

    // SELECT all ranges for a game (summary)
    if (
      sql.includes("FROM")
      && sql.includes("app_ticket_ranges_per_game")
      && sql.includes("WHERE game_id = $1")
      && sql.includes("ORDER BY hall_id ASC")
    ) {
      const [gameId] = params as [string];
      const rows = [...store.ranges.values()]
        .filter((r) => r.game_id === gameId)
        .sort((a, b) => {
          if (a.hall_id !== b.hall_id) return a.hall_id < b.hall_id ? -1 : 1;
          return a.ticket_type < b.ticket_type ? -1 : 1;
        })
        .map(mapRow);
      return { rows, rowCount: rows.length };
    }

    // INSERT range
    if (
      sql.includes("INSERT INTO")
      && sql.includes("app_ticket_ranges_per_game")
    ) {
      const [id, gameId, hallId, type, initialId, finalId, soldCount, roundNumber, carriedFrom, userId] = params as [
        string,
        string,
        string,
        TicketType,
        number,
        number,
        number,
        number,
        string | null,
        string,
      ];
      const now = new Date();
      const row: MockRange = {
        id,
        game_id: gameId,
        hall_id: hallId,
        ticket_type: type,
        initial_id: initialId,
        final_id: finalId,
        sold_count: soldCount,
        round_number: roundNumber,
        carried_from_game_id: carriedFrom,
        recorded_by_user_id: userId,
        recorded_at: now,
        created_at: now,
        updated_at: now,
      };
      store.ranges.set(id, row);
      return { rows: [mapRow(row)], rowCount: 1 };
    }

    // UPDATE range — editRange (REQ-091): SET initial_id = $1, final_id = $2 ...
    if (
      sql.includes("UPDATE")
      && sql.includes("app_ticket_ranges_per_game")
      && sql.includes("SET initial_id")
    ) {
      const [initialId, finalId, soldCount, userId, id] = params as [
        number,
        number,
        number,
        string,
        string,
      ];
      const r = store.ranges.get(id);
      if (!r) return { rows: [], rowCount: 0 };
      r.initial_id = initialId;
      r.final_id = finalId;
      r.sold_count = soldCount;
      r.recorded_by_user_id = userId;
      r.recorded_at = new Date();
      r.updated_at = new Date();
      return { rows: [mapRow(r)], rowCount: 1 };
    }

    // UPDATE range — recordFinalIds: SET final_id = $1 ...
    if (
      sql.includes("UPDATE")
      && sql.includes("app_ticket_ranges_per_game")
      && sql.includes("SET final_id")
    ) {
      const [finalId, soldCount, userId, id] = params as [
        number,
        number,
        string,
        string,
      ];
      const r = store.ranges.get(id);
      if (!r) return { rows: [], rowCount: 0 };
      r.final_id = finalId;
      r.sold_count = soldCount;
      r.recorded_by_user_id = userId;
      r.recorded_at = new Date();
      r.updated_at = new Date();
      return { rows: [mapRow(r)], rowCount: 1 };
    }

    throw new Error(`Unhandled SQL in mock: ${s.slice(0, 160)}`);
  };

  const client: Partial<PoolClient> = {
    query: runQuery as unknown as PoolClient["query"],
    release: () => {},
  };
  const pool: Partial<Pool> = {
    query: runQuery as unknown as Pool["query"],
    connect: async () => client as PoolClient,
  };
  return pool as Pool;
}

function mapRow(r: MockRange): Record<string, unknown> {
  return {
    id: r.id,
    game_id: r.game_id,
    hall_id: r.hall_id,
    ticket_type: r.ticket_type,
    initial_id: r.initial_id,
    final_id: r.final_id,
    sold_count: r.sold_count,
    round_number: r.round_number,
    carried_from_game_id: r.carried_from_game_id,
    recorded_by_user_id: r.recorded_by_user_id,
    recorded_at: r.recorded_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("getInitialIds returnerer alle 11 typer med initial=1 + round=1 når ingen historikk (PR #639 11-color palette)", async () => {
  const store = newStore();
  seedGame(store, "game-1");
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  const res = await svc.getInitialIds({ gameId: "game-1", hallId: "hall-a" });

  assert.equal(res.gameId, "game-1");
  assert.equal(res.hallId, "hall-a");
  assert.equal(res.entries.length, TICKET_TYPES.length); // 11 etter PR #639
  for (const entry of res.entries) {
    assert.equal(entry.initialId, 1);
    assert.equal(entry.roundNumber, 1);
    assert.equal(entry.carriedFromGameId, null);
    assert.equal(entry.existingRange, null);
  }
  // Alle typer skal være representert
  const types = res.entries.map((e) => e.ticketType).sort();
  assert.deepEqual(types, [...TICKET_TYPES].sort());
});

test("getInitialIds carry-forward: runde 2 arver fra runde 1 final_id", async () => {
  const store = newStore();
  seedGame(store, "game-1");
  seedGame(store, "game-2");
  // Runde 1: final=50
  seedRange(store, {
    id: "r1",
    game_id: "game-1",
    hall_id: "hall-a",
    ticket_type: "small_yellow",
    initial_id: 1,
    final_id: 50,
    sold_count: 50,
    round_number: 1,
  });
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  const res = await svc.getInitialIds({ gameId: "game-2", hallId: "hall-a" });

  const sy = res.entries.find((e) => e.ticketType === "small_yellow")!;
  assert.equal(sy.initialId, 51, "carry-forward: 50 + 1 = 51");
  assert.equal(sy.roundNumber, 2);
  assert.equal(sy.carriedFromGameId, "game-1");

  // Andre typer: fortsatt round=1 uten carry-forward
  const sw = res.entries.find((e) => e.ticketType === "small_white")!;
  assert.equal(sw.initialId, 1);
  assert.equal(sw.roundNumber, 1);
  assert.equal(sw.carriedFromGameId, null);
});

test("getInitialIds returnerer eksisterende rad hvis agenten allerede registrerer", async () => {
  const store = newStore();
  seedGame(store, "game-1");
  seedRange(store, {
    id: "r1",
    game_id: "game-1",
    hall_id: "hall-a",
    ticket_type: "small_yellow",
    initial_id: 100,
    final_id: 150,
    sold_count: 51,
    round_number: 3,
    carried_from_game_id: "game-0",
  });
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  const res = await svc.getInitialIds({ gameId: "game-1", hallId: "hall-a" });

  const sy = res.entries.find((e) => e.ticketType === "small_yellow")!;
  assert.equal(sy.initialId, 100);
  assert.equal(sy.roundNumber, 3);
  assert.equal(sy.carriedFromGameId, "game-0");
  assert.notEqual(sy.existingRange, null);
  assert.equal(sy.existingRange!.finalId, 150);
});

test("getInitialIds GAME_NOT_FOUND når gameId ukjent", async () => {
  const store = newStore();
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  await assert.rejects(
    () => svc.getInitialIds({ gameId: "ghost", hallId: "hall-a" }),
    (err: unknown) => err instanceof DomainError && err.code === "GAME_NOT_FOUND",
  );
});

test("recordFinalIds happy-path: oppretter rad + beregner sold_count", async () => {
  const store = newStore();
  seedGame(store, "game-1", "purchase_open");
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  const res = await svc.recordFinalIds({
    gameId: "game-1",
    hallId: "hall-a",
    userId: "agent-1",
    perTypeFinalIds: { small_yellow: 10 },
  });

  assert.equal(res.ranges.length, 1);
  const sy = res.ranges[0]!;
  assert.equal(sy.ticketType, "small_yellow");
  assert.equal(sy.initialId, 1);
  assert.equal(sy.finalId, 10);
  assert.equal(sy.soldCount, 10, "10 - 1 + 1 = 10");
  assert.equal(sy.roundNumber, 1);
  assert.equal(res.totalSoldCount, 10);
  assert.equal(store.commitCount, 1);
});

test("recordFinalIds oppdaterer eksisterende rad (idempotent modal-lukke)", async () => {
  const store = newStore();
  seedGame(store, "game-1", "purchase_open");
  seedRange(store, {
    id: "r1",
    game_id: "game-1",
    hall_id: "hall-a",
    ticket_type: "small_yellow",
    initial_id: 1,
    final_id: 5,
    sold_count: 5,
    round_number: 1,
    recorded_by_user_id: "agent-1",
  });
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  // Agent scanner på nytt og oppdaterer final til 15
  const res = await svc.recordFinalIds({
    gameId: "game-1",
    hallId: "hall-a",
    userId: "agent-1",
    perTypeFinalIds: { small_yellow: 15 },
  });

  assert.equal(res.ranges[0]!.finalId, 15);
  assert.equal(res.ranges[0]!.soldCount, 15, "15 - 1 + 1 = 15");
  assert.equal(res.ranges[0]!.id, "r1", "samme rad oppdatert");
});

test("recordFinalIds FINAL_LESS_THAN_INITIAL rejects final < initial", async () => {
  const store = newStore();
  seedGame(store, "game-1", "purchase_open");
  // Carry-forward: forrige final=100 → ny initial=101
  seedRange(store, {
    id: "r-prev",
    game_id: "game-0",
    hall_id: "hall-a",
    ticket_type: "small_yellow",
    initial_id: 1,
    final_id: 100,
    sold_count: 100,
    round_number: 1,
  });
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  await assert.rejects(
    () => svc.recordFinalIds({
      gameId: "game-1",
      hallId: "hall-a",
      userId: "agent-1",
      perTypeFinalIds: { small_yellow: 50 }, // 50 < 101
    }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "FINAL_LESS_THAN_INITIAL",
  );
  assert.equal(store.rollbackCount, 1, "rollback ved valideringsfeil");
});

test("recordFinalIds INVALID_TICKET_TYPE avviser ukjent type", async () => {
  const store = newStore();
  seedGame(store, "game-1", "purchase_open");
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  await assert.rejects(
    () => svc.recordFinalIds({
      gameId: "game-1",
      hallId: "hall-a",
      userId: "agent-1",
      perTypeFinalIds: { bogus_type: 10 } as unknown as Record<
        TicketType,
        number
      >,
    }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INVALID_TICKET_TYPE",
  );
});

test("recordFinalIds GAME_NOT_FOUND når gameId ukjent", async () => {
  const store = newStore();
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  await assert.rejects(
    () => svc.recordFinalIds({
      gameId: "ghost",
      hallId: "hall-a",
      userId: "agent-1",
      perTypeFinalIds: { small_yellow: 10 },
    }),
    (err: unknown) => err instanceof DomainError && err.code === "GAME_NOT_FOUND",
  );
});

test("recordFinalIds GAME_NOT_EDITABLE når spillet kjører", async () => {
  const store = newStore();
  seedGame(store, "game-1", "running");
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  await assert.rejects(
    () => svc.recordFinalIds({
      gameId: "game-1",
      hallId: "hall-a",
      userId: "agent-1",
      perTypeFinalIds: { small_yellow: 10 },
    }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "GAME_NOT_EDITABLE",
  );
});

test("recordFinalIds atomisk: alle 3 typer i ett kall oppdateres sammen", async () => {
  const store = newStore();
  seedGame(store, "game-1", "purchase_open");
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  const res = await svc.recordFinalIds({
    gameId: "game-1",
    hallId: "hall-a",
    userId: "agent-1",
    perTypeFinalIds: {
      small_yellow: 10,
      small_white: 20,
      large_yellow: 5,
    },
  });

  assert.equal(res.ranges.length, 3);
  assert.equal(res.totalSoldCount, 10 + 20 + 5);
  // Alle i én transaksjon
  assert.equal(store.commitCount, 1);
  // DB har 3 rader
  assert.equal(store.ranges.size, 3);
});

test("recordFinalIds RANGE_OVERLAP med annen (game, hall, type)-runde", async () => {
  const store = newStore();
  seedGame(store, "game-1", "purchase_open");
  seedGame(store, "game-2", "purchase_open");
  seedGame(store, "game-3", "purchase_open");
  // Gammel historikk: carry-forward velger høyeste round_number=1 final=20
  seedRange(store, {
    id: "r-round1",
    game_id: "game-2",
    hall_id: "hall-a",
    ticket_type: "small_yellow",
    initial_id: 5,
    final_id: 20,
    sold_count: 16,
    round_number: 1,
  });
  // En annen game (f.eks. manuelt importert) har range [30, 100]
  // som IKKE er siste runde (round_number=0 — eldre) men som overlapper
  // hvis noen prøver å sette final=50 i ny runde med initial=21.
  seedRange(store, {
    id: "r-legacy",
    game_id: "game-3",
    hall_id: "hall-a",
    ticket_type: "small_yellow",
    initial_id: 30,
    final_id: 100,
    sold_count: 71,
    round_number: 0,
  });
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  // Carry-forward henter round=1 (final=20) → initial=21. Final=50 overlapper
  // med [30,100] i game-3.
  await assert.rejects(
    () => svc.recordFinalIds({
      gameId: "game-1",
      hallId: "hall-a",
      userId: "agent-1",
      perTypeFinalIds: { small_yellow: 50 },
    }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "RANGE_OVERLAP",
  );
});

test("getSummary returnerer alle ranges for et spill på tvers av haller", async () => {
  const store = newStore();
  seedGame(store, "game-1");
  seedRange(store, {
    id: "r-a-sy",
    game_id: "game-1",
    hall_id: "hall-a",
    ticket_type: "small_yellow",
    initial_id: 1,
    final_id: 10,
    sold_count: 10,
    round_number: 1,
  });
  seedRange(store, {
    id: "r-a-lw",
    game_id: "game-1",
    hall_id: "hall-a",
    ticket_type: "large_white",
    initial_id: 1,
    final_id: 5,
    sold_count: 5,
    round_number: 1,
  });
  seedRange(store, {
    id: "r-b-sy",
    game_id: "game-1",
    hall_id: "hall-b",
    ticket_type: "small_yellow",
    initial_id: 1,
    final_id: 20,
    sold_count: 20,
    round_number: 1,
  });
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  const res = await svc.getSummary({ gameId: "game-1" });

  assert.equal(res.ranges.length, 3);
  assert.equal(res.totalSoldCount, 10 + 5 + 20);
});

test("validateRange helper sjekker initial <= final og begge er heltall >= 0", () => {
  const svc = TicketRegistrationService.forTesting({} as Pool);
  assert.equal(svc.validateRange(0, 0), true);
  assert.equal(svc.validateRange(1, 100), true);
  assert.equal(svc.validateRange(100, 100), true);
  assert.equal(svc.validateRange(100, 99), false);
  assert.equal(svc.validateRange(-1, 5), false);
  assert.equal(svc.validateRange(1.5, 5), false);
});

test("recordFinalIds INVALID_INPUT når perTypeFinalIds er tom", async () => {
  const store = newStore();
  seedGame(store, "game-1", "purchase_open");
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  await assert.rejects(
    () => svc.recordFinalIds({
      gameId: "game-1",
      hallId: "hall-a",
      userId: "agent-1",
      perTypeFinalIds: {},
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
  );
});

// ── REQ-091: editRange ──────────────────────────────────────────────────────

test("editRange happy-path: oppdaterer initial_id og final_id, recomputed sold_count", async () => {
  const store = newStore();
  seedGame(store, "game-1", "purchase_open");
  seedRange(store, {
    id: "r1",
    game_id: "game-1",
    hall_id: "hall-a",
    ticket_type: "small_yellow",
    initial_id: 1,
    final_id: 10,
    sold_count: 10,
    round_number: 1,
  });
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  const res = await svc.editRange({
    rangeId: "r1",
    gameId: "game-1",
    hallId: "hall-a",
    initialId: 5,
    finalId: 25,
    userId: "agent-1",
  });

  assert.equal(res.before.initialId, 1);
  assert.equal(res.before.finalId, 10);
  assert.equal(res.before.soldCount, 10);
  assert.equal(res.after.initialId, 5);
  assert.equal(res.after.finalId, 25);
  assert.equal(res.after.soldCount, 21, "25 - 5 + 1 = 21");
  assert.equal(res.after.id, "r1", "samme rad oppdatert");
  // Round-number og carried_from skal IKKE endres
  assert.equal(res.after.roundNumber, res.before.roundNumber);
  assert.equal(store.commitCount, 1);
});

test("editRange RANGE_NOT_FOUND når rangeId ukjent", async () => {
  const store = newStore();
  seedGame(store, "game-1", "purchase_open");
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  await assert.rejects(
    () => svc.editRange({
      rangeId: "ghost",
      gameId: "game-1",
      hallId: "hall-a",
      initialId: 1,
      finalId: 10,
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "RANGE_NOT_FOUND",
  );
  assert.equal(store.rollbackCount, 1, "rollback ved valideringsfeil");
});

test("editRange GAME_NOT_EDITABLE når spillet kjører — kan ikke endre range mens spillet kjører", async () => {
  const store = newStore();
  seedGame(store, "game-1", "running");
  seedRange(store, {
    id: "r1",
    game_id: "game-1",
    hall_id: "hall-a",
    ticket_type: "small_yellow",
    initial_id: 1,
    final_id: 10,
    sold_count: 10,
    round_number: 1,
  });
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  await assert.rejects(
    () => svc.editRange({
      rangeId: "r1",
      gameId: "game-1",
      hallId: "hall-a",
      initialId: 5,
      finalId: 25,
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "GAME_NOT_EDITABLE",
  );

  // Verifier at raden IKKE ble endret
  const original = store.ranges.get("r1")!;
  assert.equal(original.initial_id, 1);
  assert.equal(original.final_id, 10);
  assert.equal(store.rollbackCount, 1);
});

test("editRange RANGE_OVERLAP: forhindrer overlap med annen range i samme (hall, type)", async () => {
  const store = newStore();
  seedGame(store, "game-1", "purchase_open");
  seedGame(store, "game-2", "purchase_open");
  seedRange(store, {
    id: "r1",
    game_id: "game-1",
    hall_id: "hall-a",
    ticket_type: "small_yellow",
    initial_id: 1,
    final_id: 10,
    sold_count: 10,
    round_number: 1,
  });
  // Annen agent har allerede registrert range [20, 50] i en annen runde
  seedRange(store, {
    id: "r-other",
    game_id: "game-2",
    hall_id: "hall-a",
    ticket_type: "small_yellow",
    initial_id: 20,
    final_id: 50,
    sold_count: 31,
    round_number: 2,
  });
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  // Forsøk å utvide r1 til [1, 30] som overlapper med r-other [20, 50]
  await assert.rejects(
    () => svc.editRange({
      rangeId: "r1",
      gameId: "game-1",
      hallId: "hall-a",
      initialId: 1,
      finalId: 30,
      userId: "agent-1",
    }),
    (err: unknown) => err instanceof DomainError && err.code === "RANGE_OVERLAP",
  );
});

test("editRange RANGE_HALL_MISMATCH: forhindrer cross-hall edit selv om rangeId-en er gyldig", async () => {
  const store = newStore();
  seedGame(store, "game-1", "purchase_open");
  seedRange(store, {
    id: "r1",
    game_id: "game-1",
    hall_id: "hall-a", // raden tilhører hall-a
    ticket_type: "small_yellow",
    initial_id: 1,
    final_id: 10,
    sold_count: 10,
    round_number: 1,
  });
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  // En agent fra hall-b prøver å redigere raden som tilhører hall-a
  await assert.rejects(
    () => svc.editRange({
      rangeId: "r1",
      gameId: "game-1",
      hallId: "hall-b", // feil hall
      initialId: 5,
      finalId: 20,
      userId: "agent-from-hall-b",
    }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "RANGE_HALL_MISMATCH",
  );
});

test("editRange FINAL_LESS_THAN_INITIAL: avviser final < initial (uten å starte transaksjon)", async () => {
  const store = newStore();
  seedGame(store, "game-1", "purchase_open");
  seedRange(store, {
    id: "r1",
    game_id: "game-1",
    hall_id: "hall-a",
    ticket_type: "small_yellow",
    initial_id: 1,
    final_id: 10,
    sold_count: 10,
    round_number: 1,
  });
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  await assert.rejects(
    () => svc.editRange({
      rangeId: "r1",
      gameId: "game-1",
      hallId: "hall-a",
      initialId: 50,
      finalId: 25, // 25 < 50
      userId: "agent-1",
    }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "FINAL_LESS_THAN_INITIAL",
  );
});

test("recordFinalIds carry-forward: runde 2 får riktig initial_id og round_number", async () => {
  const store = newStore();
  seedGame(store, "game-1", "purchase_open");
  // Simulerer runde 1 avsluttet: final=100
  seedRange(store, {
    id: "r-round1",
    game_id: "game-0",
    hall_id: "hall-a",
    ticket_type: "small_yellow",
    initial_id: 1,
    final_id: 100,
    sold_count: 100,
    round_number: 1,
  });
  const pool = makeMockPool(store);
  const svc = TicketRegistrationService.forTesting(pool);

  // Runde 2: scan final=150
  const res = await svc.recordFinalIds({
    gameId: "game-1",
    hallId: "hall-a",
    userId: "agent-1",
    perTypeFinalIds: { small_yellow: 150 },
  });

  const sy = res.ranges[0]!;
  assert.equal(sy.initialId, 101, "carry-forward: forrige final_id + 1");
  assert.equal(sy.finalId, 150);
  assert.equal(sy.soldCount, 50, "150 - 101 + 1 = 50");
  assert.equal(sy.roundNumber, 2);
  assert.equal(sy.carriedFromGameId, "game-0");
});
