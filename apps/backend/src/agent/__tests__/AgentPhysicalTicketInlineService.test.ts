/**
 * REQ-101 — enhetstester for AgentPhysicalTicketInlineService.
 *
 * Spec: docs/architecture/WIREFRAME_BACKEND_REQUIREMENTS_2026-04-25.md REQ-101
 *
 * Dekker:
 *   1. Happy-path INSERT: ny rad med initial+final+color → soldCount korrekt.
 *   2. Idempotent re-call: samme range → no-op + idempotent=true.
 *   3. UPDATE: re-call med endret final → UPDATE-rad, sold_count oppdatert.
 *   4. INVALID_TICKET_COLOR: ukjent color avvises.
 *   5. FINAL_LESS_THAN_INITIAL: final < initial avvises.
 *   6. RANGE_OVERLAP: overlapp mot annen game's range avvises.
 *   7. GAME_NOT_FOUND: ukjent gameId avvises.
 *   8. GAME_NOT_EDITABLE: spill i status running avvises.
 *   9. INVALID_INPUT: tom subGameId/hallId/userId avvises.
 *   10. Multiple tickets-types i samme spill+hall — separate rader.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolClient } from "pg";
import {
  AgentPhysicalTicketInlineService,
} from "../AgentPhysicalTicketInlineService.js";
import { DomainError } from "../../game/BingoEngine.js";
import type { TicketType } from "../TicketRegistrationService.js";

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
}

function newStore(): MockStore {
  return { ranges: new Map(), games: new Map() };
}

function seedGame(store: MockStore, id: string, status = "purchase_open"): void {
  store.games.set(id, { id, status });
}

function seedRange(
  store: MockStore,
  r: Partial<MockRange> & {
    id: string;
    game_id: string;
    hall_id: string;
    ticket_type: TicketType;
    initial_id: number;
  },
): MockRange {
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

function makeMockPool(store: MockStore): Pool {
  const runQuery = async (sql: string, params: unknown[] = []) => {
    const s = sql.trim();

    if (s === "BEGIN" || s === "COMMIT" || s === "ROLLBACK") {
      return { rows: [], rowCount: 0 };
    }

    if (
      sql.includes("app_game1_scheduled_games")
      && sql.includes("WHERE id = $1")
    ) {
      const [id] = params as [string];
      const g = store.games.get(id);
      const rows = g ? [{ id: g.id, status: g.status }] : [];
      return { rows, rowCount: rows.length };
    }

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
      const overlaps = [...store.ranges.values()].filter(
        (r) =>
          r.hall_id === hallId
          && r.ticket_type === type
          && r.game_id !== gameId
          && r.final_id != null
          && !(r.final_id < initialId || r.initial_id > finalId),
      );
      const r = overlaps[0];
      const rows = r ? [{ id: r.id, game_id: r.game_id }] : [];
      return { rows, rowCount: rows.length };
    }

    if (
      sql.includes("INSERT INTO")
      && sql.includes("app_ticket_ranges_per_game")
    ) {
      const [
        id,
        gameId,
        hallId,
        type,
        initialId,
        finalId,
        soldCount,
        userId,
      ] = params as [
        string,
        string,
        string,
        TicketType,
        number,
        number,
        number,
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
        round_number: 1,
        carried_from_game_id: null,
        recorded_by_user_id: userId,
        recorded_at: now,
        created_at: now,
        updated_at: now,
      };
      store.ranges.set(id, row);
      return { rows: [mapRow(row)], rowCount: 1 };
    }

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

    throw new Error(`Unhandled SQL: ${s.slice(0, 160)}`);
  };

  const client: Partial<PoolClient> = {
    query: runQuery as unknown as PoolClient["query"],
    release: () => undefined,
  };
  const pool: Partial<Pool> = {
    query: runQuery as unknown as Pool["query"],
    connect: async () => client as PoolClient,
  };
  return pool as Pool;
}

// ── Tests ────────────────────────────────────────────────────────────────

test("REQ-101: happy-path INSERT — ny range opprettes med korrekt soldCount", async () => {
  const store = newStore();
  seedGame(store, "g-1", "purchase_open");
  const pool = makeMockPool(store);
  const svc = AgentPhysicalTicketInlineService.forTesting(pool);

  const res = await svc.inlineRegister({
    subGameId: "g-1",
    hallId: "hall-a",
    initialId: 1,
    finalId: 10,
    color: "small_yellow",
    userId: "agent-1",
  });

  assert.equal(res.created, true);
  assert.equal(res.idempotent, false);
  assert.equal(res.soldCount, 10, "10 - 1 + 1 = 10");
  assert.equal(res.range.initialId, 1);
  assert.equal(res.range.finalId, 10);
  assert.equal(res.range.ticketType, "small_yellow");
  assert.equal(res.range.recordedByUserId, "agent-1");
});

test("REQ-101: idempotent re-call — samme range gir idempotent=true uten endring", async () => {
  const store = newStore();
  seedGame(store, "g-1", "purchase_open");
  seedRange(store, {
    id: "r1",
    game_id: "g-1",
    hall_id: "hall-a",
    ticket_type: "small_yellow",
    initial_id: 1,
    final_id: 10,
    sold_count: 10,
    round_number: 1,
  });
  const pool = makeMockPool(store);
  const svc = AgentPhysicalTicketInlineService.forTesting(pool);

  const res = await svc.inlineRegister({
    subGameId: "g-1",
    hallId: "hall-a",
    initialId: 1,
    finalId: 10,
    color: "small_yellow",
    userId: "agent-1",
  });

  assert.equal(res.created, false);
  assert.equal(res.idempotent, true);
  assert.equal(res.range.id, "r1", "samme rad returneres");
  assert.equal(res.soldCount, 10);
});

test("REQ-101: UPDATE — re-call med endret final → soldCount oppdatert", async () => {
  const store = newStore();
  seedGame(store, "g-1", "purchase_open");
  seedRange(store, {
    id: "r1",
    game_id: "g-1",
    hall_id: "hall-a",
    ticket_type: "small_yellow",
    initial_id: 1,
    final_id: 10,
    sold_count: 10,
    round_number: 1,
  });
  const pool = makeMockPool(store);
  const svc = AgentPhysicalTicketInlineService.forTesting(pool);

  const res = await svc.inlineRegister({
    subGameId: "g-1",
    hallId: "hall-a",
    initialId: 1,
    finalId: 20,
    color: "small_yellow",
    userId: "agent-2",
  });

  assert.equal(res.created, false, "raden eksisterte før");
  assert.equal(res.idempotent, false, "endring registrert, ikke no-op");
  assert.equal(res.soldCount, 20, "20 - 1 + 1 = 20");
  assert.equal(res.range.finalId, 20);
});

test("REQ-101: INVALID_TICKET_COLOR — avviser ukjent color", async () => {
  const store = newStore();
  seedGame(store, "g-1");
  const pool = makeMockPool(store);
  const svc = AgentPhysicalTicketInlineService.forTesting(pool);

  await assert.rejects(
    () =>
      svc.inlineRegister({
        subGameId: "g-1",
        hallId: "hall-a",
        initialId: 1,
        finalId: 10,
        color: "neon_pink",
        userId: "agent-1",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_TICKET_COLOR",
  );
});

test("REQ-101: FINAL_LESS_THAN_INITIAL — avviser final < initial", async () => {
  const store = newStore();
  seedGame(store, "g-1");
  const pool = makeMockPool(store);
  const svc = AgentPhysicalTicketInlineService.forTesting(pool);

  await assert.rejects(
    () =>
      svc.inlineRegister({
        subGameId: "g-1",
        hallId: "hall-a",
        initialId: 100,
        finalId: 50,
        color: "small_yellow",
        userId: "agent-1",
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "FINAL_LESS_THAN_INITIAL",
  );
});

test("REQ-101: RANGE_OVERLAP — avviser overlapp mot annen games range", async () => {
  const store = newStore();
  seedGame(store, "g-1", "purchase_open");
  seedGame(store, "g-2", "purchase_open");
  // g-1 har allerede 1-50 small_yellow registrert
  seedRange(store, {
    id: "r1",
    game_id: "g-1",
    hall_id: "hall-a",
    ticket_type: "small_yellow",
    initial_id: 1,
    final_id: 50,
    sold_count: 50,
  });
  const pool = makeMockPool(store);
  const svc = AgentPhysicalTicketInlineService.forTesting(pool);

  // g-2 prøver å registrere 40-60 — overlapper med g-1's 1-50
  await assert.rejects(
    () =>
      svc.inlineRegister({
        subGameId: "g-2",
        hallId: "hall-a",
        initialId: 40,
        finalId: 60,
        color: "small_yellow",
        userId: "agent-1",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "RANGE_OVERLAP",
  );
});

test("REQ-101: GAME_NOT_FOUND — avviser ukjent gameId", async () => {
  const store = newStore();
  const pool = makeMockPool(store);
  const svc = AgentPhysicalTicketInlineService.forTesting(pool);

  await assert.rejects(
    () =>
      svc.inlineRegister({
        subGameId: "ghost",
        hallId: "hall-a",
        initialId: 1,
        finalId: 10,
        color: "small_yellow",
        userId: "agent-1",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "GAME_NOT_FOUND",
  );
});

test("REQ-101: GAME_NOT_EDITABLE — avviser spill i running-status", async () => {
  const store = newStore();
  seedGame(store, "g-1", "running");
  const pool = makeMockPool(store);
  const svc = AgentPhysicalTicketInlineService.forTesting(pool);

  await assert.rejects(
    () =>
      svc.inlineRegister({
        subGameId: "g-1",
        hallId: "hall-a",
        initialId: 1,
        finalId: 10,
        color: "small_yellow",
        userId: "agent-1",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "GAME_NOT_EDITABLE",
  );
});

test("REQ-101: INVALID_INPUT — avviser tom subGameId/hallId/userId", async () => {
  const store = newStore();
  seedGame(store, "g-1");
  const pool = makeMockPool(store);
  const svc = AgentPhysicalTicketInlineService.forTesting(pool);

  for (const empty of ["subGameId", "hallId", "userId"]) {
    const args = {
      subGameId: "g-1",
      hallId: "hall-a",
      initialId: 1,
      finalId: 10,
      color: "small_yellow",
      userId: "agent-1",
    } as const;
    await assert.rejects(
      () => svc.inlineRegister({ ...args, [empty]: "" }),
      (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT",
      `${empty} tom skal kaste INVALID_INPUT`,
    );
  }
});

test("REQ-101: multiple farger i samme spill+hall — separate rader", async () => {
  const store = newStore();
  seedGame(store, "g-1", "purchase_open");
  const pool = makeMockPool(store);
  const svc = AgentPhysicalTicketInlineService.forTesting(pool);

  await svc.inlineRegister({
    subGameId: "g-1",
    hallId: "hall-a",
    initialId: 1,
    finalId: 10,
    color: "small_yellow",
    userId: "agent-1",
  });
  await svc.inlineRegister({
    subGameId: "g-1",
    hallId: "hall-a",
    initialId: 101,
    finalId: 120,
    color: "small_white",
    userId: "agent-1",
  });

  const ranges = [...store.ranges.values()].filter(
    (r) => r.game_id === "g-1" && r.hall_id === "hall-a",
  );
  assert.equal(ranges.length, 2, "to typer = to rader");
  const types = ranges.map((r) => r.ticket_type).sort();
  assert.deepEqual(types, ["small_white", "small_yellow"]);
});

test("REQ-101: tillater ikke-overlappende ranges i samme (hall, color) på tvers av spill", async () => {
  const store = newStore();
  seedGame(store, "g-1", "purchase_open");
  seedGame(store, "g-2", "purchase_open");
  // g-1 har 1-50, g-2 vil ha 51-100 — ikke overlapp
  seedRange(store, {
    id: "r1",
    game_id: "g-1",
    hall_id: "hall-a",
    ticket_type: "small_yellow",
    initial_id: 1,
    final_id: 50,
    sold_count: 50,
  });
  const pool = makeMockPool(store);
  const svc = AgentPhysicalTicketInlineService.forTesting(pool);

  const res = await svc.inlineRegister({
    subGameId: "g-2",
    hallId: "hall-a",
    initialId: 51,
    finalId: 100,
    color: "small_yellow",
    userId: "agent-1",
  });

  assert.equal(res.created, true);
  assert.equal(res.soldCount, 50);
});
