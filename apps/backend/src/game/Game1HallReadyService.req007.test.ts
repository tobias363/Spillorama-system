/**
 * REQ-007 (2026-04-26): unit-tester for ready-state-machine-utvidelser.
 *
 * Tester de nye metodene introdusert for å håndtere:
 *   1) Auto-revert til NOT_READY ved ny runde (`resetReadyForNextRound`)
 *   2) Force-revert ved agent-disconnect (`forceUnmarkReady`)
 *   3) Heartbeat-sweep av stale ready-rader (`sweepStaleReadyRows`)
 *
 * State-machine-transisjoner som dekkes:
 *   - NOT_READY → READY        (markReady, eksisterende test)
 *   - READY → NOT_READY        (unmarkReady, eksisterende test)
 *   - READY → NOT_READY        (forceUnmarkReady, ny)
 *   - READY → NOT_READY (sweep) (sweepStaleReadyRows, ny)
 *   - * → NOT_READY (reset)    (resetReadyForNextRound, ny)
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./BingoEngine.js";
import { Game1HallReadyService } from "./Game1HallReadyService.js";

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface StubResponse {
  match: (sql: string) => boolean;
  rows: unknown[];
  rowCount?: number;
}

function createStubPool(responses: StubResponse[] = []): {
  pool: {
    query: (
      sql: string,
      params?: unknown[]
    ) => Promise<{ rows: unknown[]; rowCount: number }>;
  };
  queries: RecordedQuery[];
} {
  const queue = responses.slice();
  const queries: RecordedQuery[] = [];
  return {
    pool: {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        for (let i = 0; i < queue.length; i++) {
          const r = queue[i]!;
          if (r.match(sql)) {
            queue.splice(i, 1);
            return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
          }
        }
        return { rows: [], rowCount: 0 };
      },
    },
    queries,
  };
}

function hallReadyRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    game_id: "g1",
    hall_id: "hall-2",
    is_ready: false,
    ready_at: null,
    ready_by_user_id: null,
    digital_tickets_sold: 0,
    physical_tickets_sold: 0,
    excluded_from_game: false,
    excluded_reason: null,
    created_at: "2026-04-26T09:00:00.000Z",
    updated_at: "2026-04-26T09:30:00.000Z",
    start_ticket_id: null,
    start_scanned_at: null,
    final_scan_ticket_id: null,
    final_scanned_at: null,
    ...overrides,
  };
}

// ── forceUnmarkReady ────────────────────────────────────────────────────────

test("forceUnmarkReady — happy path: flipper is_ready=true → false og returnerer rad", async () => {
  const { pool, queries } = createStubPool([
    {
      match: (s) =>
        s.includes('UPDATE "public"."app_game1_hall_ready_status"') &&
        s.includes("is_ready = true"),
      rows: [hallReadyRow({ is_ready: false, ready_at: null })],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const result = await svc.forceUnmarkReady({
    gameId: "g1",
    hallId: "hall-2",
    actorUserId: "admin-1",
    reason: "agent_disconnect",
  });
  assert.ok(result, "forventet rad returnert");
  assert.equal(result!.isReady, false);
  assert.equal(result!.readyAt, null);
  // Verifiserer at WHERE-klausulen krever is_ready=true (idempotent guard).
  const updateQuery = queries.find((q) => q.sql.includes("UPDATE"));
  assert.ok(updateQuery, "forventet UPDATE-query");
  assert.ok(
    updateQuery!.sql.includes("is_ready = true"),
    "WHERE-klausul må kreve is_ready=true (idempotent)"
  );
});

test("forceUnmarkReady — idempotent: returnerer null hvis raden allerede er false", async () => {
  // Ingen rader returneres fra UPDATE → service returnerer null.
  const { pool } = createStubPool([
    {
      match: (s) => s.includes("UPDATE"),
      rows: [],
      rowCount: 0,
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const result = await svc.forceUnmarkReady({
    gameId: "g1",
    hallId: "hall-2",
    actorUserId: "SYSTEM",
    reason: "heartbeat_stale",
  });
  assert.equal(result, null);
});

test("forceUnmarkReady — krever reason (kaster INVALID_INPUT på tom streng)", async () => {
  const { pool } = createStubPool();
  const svc = Game1HallReadyService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.forceUnmarkReady({
        gameId: "g1",
        hallId: "hall-2",
        actorUserId: "admin-1",
        reason: "   ",
      }),
    (err) =>
      err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

// ── sweepStaleReadyRows ─────────────────────────────────────────────────────

test("sweepStaleReadyRows — flipper kun stale ready-rader, fresh forblir", async () => {
  // Stub returnerer to rader som ble flippet (stale).
  const { pool, queries } = createStubPool([
    {
      match: (s) =>
        s.includes('UPDATE "public"."app_game1_hall_ready_status"') &&
        s.includes("FROM \"public\".\"app_game1_scheduled_games\""),
      rows: [
        { game_id: "g1", hall_id: "hall-2" },
        { game_id: "g1", hall_id: "hall-3" },
      ],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const nowMs = Date.parse("2026-04-26T12:00:00.000Z");
  const result = await svc.sweepStaleReadyRows(nowMs, 60_000);
  assert.equal(result.reverted, 2);
  assert.deepEqual(result.revertedRows, [
    { gameId: "g1", hallId: "hall-2" },
    { gameId: "g1", hallId: "hall-3" },
  ]);
  // Verifiserer at SQL begrenser til status='purchase_open' og bruker
  // cutoff = now - threshold som parameter.
  const sweep = queries.find((q) => q.sql.includes("UPDATE"));
  assert.ok(sweep, "forventet sweep UPDATE");
  assert.ok(
    sweep!.sql.includes("g.status = 'purchase_open'"),
    "sweep skal kun gjelde purchase_open-spill"
  );
  assert.ok(
    sweep!.sql.includes("r.is_ready = true"),
    "sweep skal kun flippe rader som er ready=true"
  );
  // Cutoff-param: 60 sek tilbake fra now.
  const cutoffParam = sweep!.params[0] as string;
  const cutoffMs = Date.parse(cutoffParam);
  assert.equal(
    cutoffMs,
    nowMs - 60_000,
    "cutoff-param skal være now - threshold"
  );
});

test("sweepStaleReadyRows — default threshold 60s når ikke angitt", async () => {
  const { pool, queries } = createStubPool([
    {
      match: (s) => s.includes("UPDATE"),
      rows: [],
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const nowMs = Date.parse("2026-04-26T12:00:00.000Z");
  const result = await svc.sweepStaleReadyRows(nowMs);
  assert.equal(result.reverted, 0);
  const sweep = queries.find((q) => q.sql.includes("UPDATE"))!;
  const cutoffMs = Date.parse(sweep.params[0] as string);
  assert.equal(
    cutoffMs,
    nowMs - 60_000,
    "default threshold skal være 60_000 ms"
  );
});

test("sweepStaleReadyRows — empty result når ingen stale rader", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes("UPDATE"),
      rows: [],
      rowCount: 0,
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const result = await svc.sweepStaleReadyRows(Date.now());
  assert.equal(result.reverted, 0);
  assert.deepEqual(result.revertedRows, []);
});

// ── resetReadyForNextRound ──────────────────────────────────────────────────

test("resetReadyForNextRound — nullstiller alle ready+scan-felter for game", async () => {
  const { pool, queries } = createStubPool([
    {
      match: (s) => s.includes('UPDATE "public"."app_game1_hall_ready_status"'),
      rows: [],
      rowCount: 3, // 3 haller ble nullstilt
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const reverted = await svc.resetReadyForNextRound("g1");
  assert.equal(reverted, 3);
  // Verifiserer at SQL nullstiller alle relevante felt.
  const reset = queries.find((q) => q.sql.includes("UPDATE"));
  assert.ok(reset, "forventet UPDATE-query");
  assert.ok(reset!.sql.includes("is_ready             = false"));
  assert.ok(reset!.sql.includes("ready_at             = NULL"));
  assert.ok(reset!.sql.includes("ready_by_user_id     = NULL"));
  assert.ok(reset!.sql.includes("start_ticket_id      = NULL"));
  assert.ok(reset!.sql.includes("final_scan_ticket_id = NULL"));
  assert.deepEqual(reset!.params, ["g1"]);
});

test("resetReadyForNextRound — idempotent (returnerer 0 hvis ingen rader)", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes("UPDATE"),
      rows: [],
      rowCount: 0,
    },
  ]);
  const svc = Game1HallReadyService.forTesting(pool as never);
  const reverted = await svc.resetReadyForNextRound("nonexistent-game");
  assert.equal(reverted, 0);
});
