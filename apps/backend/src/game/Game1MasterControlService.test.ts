/**
 * GAME1_SCHEDULE PR 3: unit-tester for Game1MasterControlService.
 *
 * Testene bruker en stub-pool som matcher mot SQL-fragment og returnerer
 * preset rader. Matcher testmønsteret i Game1HallReadyService.test.ts.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./BingoEngine.js";
import {
  Game1MasterControlService,
  type MasterActor,
} from "./Game1MasterControlService.js";

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface StubResponse {
  match: (sql: string) => boolean;
  rows: unknown[];
  rowCount?: number;
}

interface StubClient {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
  release: () => void;
}

function createStubPool(responses: StubResponse[] = []): {
  pool: {
    connect: () => Promise<StubClient>;
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
  };
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const activeResponses = responses.slice();

  const query = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    for (let i = 0; i < activeResponses.length; i++) {
      const r = activeResponses[i]!;
      if (r.match(sql)) {
        activeResponses.splice(i, 1);
        return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  };

  return {
    pool: {
      connect: async (): Promise<StubClient> => ({
        query,
        release: () => undefined,
      }),
      query,
    },
    queries,
  };
}

function gameRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "g1",
    status: "ready_to_start",
    master_hall_id: "hall-master",
    group_hall_id: "grp-1",
    participating_halls_json: ["hall-master", "hall-2", "hall-3"],
    actual_start_time: null,
    actual_end_time: null,
    ...overrides,
  };
}

function readyRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    hall_id: "hall-2",
    is_ready: true,
    excluded_from_game: false,
    // TASK HS: default ticket-counts slik at haller ikke tilfeldig er røde
    // (0 spillere). Tester som vil ha rød hall setter disse eksplisitt.
    digital_tickets_sold: 5,
    physical_tickets_sold: 0,
    start_ticket_id: null,
    final_scan_ticket_id: null,
    ...overrides,
  };
}

const masterActor: MasterActor = {
  userId: "user-master",
  hallId: "hall-master",
  role: "AGENT",
};

const adminActor: MasterActor = {
  userId: "user-admin",
  hallId: "ADMIN_CONSOLE",
  role: "ADMIN",
};

// ── startGame ───────────────────────────────────────────────────────────────

test("startGame happy path fra ready_to_start", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow({ status: "ready_to_start" })],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        readyRow({ hall_id: "hall-master", is_ready: true }),
        readyRow({ hall_id: "hall-2", is_ready: true }),
        readyRow({ hall_id: "hall-3", is_ready: true }),
      ],
    },
    {
      match: (s) => s.includes("SET status") && s.includes("'running'"),
      rows: [
        gameRow({
          status: "running",
          actual_start_time: "2026-04-21T10:00:00.000Z",
        }),
      ],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"), rows: [] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.startGame({ gameId: "g1", actor: masterActor });
  assert.equal(result.status, "running");
  assert.equal(result.gameId, "g1");
  assert.ok(result.auditId);
  assert.ok(queries.some((q) => q.sql.startsWith("BEGIN")));
  assert.ok(queries.some((q) => q.sql.startsWith("COMMIT")));
  const auditQuery = queries.find((q) => q.sql.includes("master_audit") && q.sql.includes("INSERT"));
  assert.ok(auditQuery);
  assert.equal(auditQuery!.params[2], "start");
});

test("startGame happy path fra purchase_open + allReady", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow({ status: "purchase_open" })],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        readyRow({ hall_id: "hall-master", is_ready: true }),
        readyRow({ hall_id: "hall-2", is_ready: true }),
        readyRow({ hall_id: "hall-3", is_ready: true }),
      ],
    },
    {
      match: (s) => s.includes("SET status") && s.includes("'running'"),
      rows: [gameRow({ status: "running" })],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"), rows: [] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.startGame({ gameId: "g1", actor: masterActor });
  assert.equal(result.status, "running");
});

test("startGame avviser hvis status er scheduled", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "scheduled" })],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.startGame({ gameId: "g1", actor: masterActor }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "GAME_NOT_STARTABLE"
  );
});

test("startGame fra purchase_open avviser hvis ikke alle haller klare", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "purchase_open" })],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        readyRow({ hall_id: "hall-master", is_ready: true }),
        readyRow({ hall_id: "hall-2", is_ready: false }),
      ],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.startGame({ gameId: "g1", actor: masterActor }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "HALLS_NOT_READY"
  );
});

test("startGame avviser hvis excluded halls ikke er bekreftet", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "ready_to_start" })],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        readyRow({ hall_id: "hall-master", is_ready: true }),
        readyRow({ hall_id: "hall-2", is_ready: true }),
        readyRow({ hall_id: "hall-3", is_ready: false, excluded_from_game: true }),
      ],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.startGame({ gameId: "g1", actor: masterActor }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "EXCLUDED_HALLS_NOT_CONFIRMED"
  );
});

test("startGame aksepterer når excluded halls er bekreftet", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "ready_to_start" })],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        readyRow({ hall_id: "hall-master", is_ready: true }),
        readyRow({ hall_id: "hall-2", is_ready: true }),
        readyRow({ hall_id: "hall-3", is_ready: false, excluded_from_game: true }),
      ],
    },
    {
      match: (s) => s.includes("SET status") && s.includes("'running'"),
      rows: [gameRow({ status: "running" })],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"), rows: [] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.startGame({
    gameId: "g1",
    actor: masterActor,
    confirmExcludedHalls: ["hall-3"],
  });
  assert.equal(result.status, "running");
});

test("startGame avviser non-master actor (AGENT annen hall)", async () => {
  const wrongActor: MasterActor = {
    userId: "user-other",
    hallId: "hall-2",
    role: "AGENT",
  };
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "ready_to_start" })],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.startGame({ gameId: "g1", actor: wrongActor }),
    (err: unknown) => err instanceof DomainError && err.code === "FORBIDDEN"
  );
});

test("startGame aksepterer ADMIN-actor uansett hall", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "ready_to_start" })],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        readyRow({ hall_id: "hall-master", is_ready: true }),
        readyRow({ hall_id: "hall-2", is_ready: true }),
        readyRow({ hall_id: "hall-3", is_ready: true }),
      ],
    },
    {
      match: (s) => s.includes("SET status") && s.includes("'running'"),
      rows: [gameRow({ status: "running" })],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"), rows: [] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.startGame({ gameId: "g1", actor: adminActor });
  assert.equal(result.status, "running");
});

test("startGame avviser SUPPORT-rollen", async () => {
  const supportActor: MasterActor = {
    userId: "user-sup",
    hallId: "hall-master",
    role: "SUPPORT",
  };
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow()],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.startGame({ gameId: "g1", actor: supportActor }),
    (err: unknown) => err instanceof DomainError && err.code === "FORBIDDEN"
  );
});

test("startGame avviser hvis game ikke finnes", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    { match: (s) => s.includes("FOR UPDATE"), rows: [] },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.startGame({ gameId: "g1", actor: masterActor }),
    (err: unknown) => err instanceof DomainError && err.code === "GAME_NOT_FOUND"
  );
});

// ── excludeHall ─────────────────────────────────────────────────────────────

test("excludeHall happy path i purchase_open", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "purchase_open" })],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("hall_ready_status"),
      rows: [],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [readyRow({ hall_id: "hall-2", excluded_from_game: true })],
    },
    {
      match: (s) => s.includes("SELECT status FROM"),
      rows: [{ status: "purchase_open" }],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"), rows: [] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.excludeHall({
    gameId: "g1",
    hallId: "hall-2",
    reason: "Tekniske problemer med terminalen",
    actor: masterActor,
  });
  assert.equal(result.status, "purchase_open");
  const auditQuery = queries.find(
    (q) => q.sql.includes("master_audit") && q.sql.includes("INSERT")
  );
  assert.equal(auditQuery!.params[2], "exclude_hall");
});

test("excludeHall ruller ready_to_start tilbake til purchase_open", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "ready_to_start" })],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("hall_ready_status"),
      rows: [],
    },
    {
      match: (s) => s.includes("SET status") && s.includes("'purchase_open'"),
      rows: [],
      rowCount: 1,
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [],
    },
    {
      match: (s) => s.includes("SELECT status FROM"),
      rows: [{ status: "purchase_open" }],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"), rows: [] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.excludeHall({
    gameId: "g1",
    hallId: "hall-2",
    reason: "Tekniske problemer med terminalen",
    actor: masterActor,
  });
  assert.equal(result.status, "purchase_open");
  const rollback = queries.find(
    (q) =>
      q.sql.includes("SET status") &&
      q.sql.includes("'purchase_open'") &&
      q.sql.includes("ready_to_start")
  );
  assert.ok(rollback);
});

test("excludeHall avviser master-hall", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "purchase_open" })],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.excludeHall({
      gameId: "g1",
      hallId: "hall-master",
      reason: "test",
      actor: masterActor,
    }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "CANNOT_EXCLUDE_MASTER_HALL"
  );
});

test("excludeHall avviser tom reason", async () => {
  const { pool } = createStubPool([]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.excludeHall({
      gameId: "g1",
      hallId: "hall-2",
      reason: "   ",
      actor: masterActor,
    }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

test("excludeHall avviser hall som ikke deltar", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "purchase_open" })],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.excludeHall({
      gameId: "g1",
      hallId: "hall-unknown",
      reason: "test",
      actor: masterActor,
    }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "HALL_NOT_PARTICIPATING"
  );
});

test("excludeHall avviser fra running-status", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "running" })],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.excludeHall({
      gameId: "g1",
      hallId: "hall-2",
      reason: "test",
      actor: masterActor,
    }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "EXCLUDE_NOT_ALLOWED"
  );
});

// ── includeHall ─────────────────────────────────────────────────────────────

test("includeHall happy path", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "purchase_open" })],
    },
    {
      match: (s) =>
        s.includes("UPDATE") &&
        s.includes("hall_ready_status") &&
        s.includes("excluded_from_game = false"),
      rows: [],
      rowCount: 1,
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"), rows: [] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.includeHall({
    gameId: "g1",
    hallId: "hall-2",
    actor: masterActor,
  });
  assert.equal(result.status, "purchase_open");
  const auditQuery = queries.find(
    (q) => q.sql.includes("master_audit") && q.sql.includes("INSERT")
  );
  assert.equal(auditQuery!.params[2], "include_hall");
});

test("includeHall avviser utenfor purchase_open", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "ready_to_start" })],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.includeHall({ gameId: "g1", hallId: "hall-2", actor: masterActor }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "INCLUDE_NOT_ALLOWED"
  );
});

test("includeHall avviser hvis hall ikke er ekskludert", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "purchase_open" })],
    },
    {
      match: (s) =>
        s.includes("UPDATE") &&
        s.includes("hall_ready_status") &&
        s.includes("excluded_from_game = false"),
      rows: [],
      rowCount: 0,
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.includeHall({ gameId: "g1", hallId: "hall-2", actor: masterActor }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "HALL_NOT_EXCLUDED"
  );
});

// ── pauseGame / resumeGame ──────────────────────────────────────────────────

test("pauseGame happy path", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "running" })],
    },
    {
      match: (s) => s.includes("SET status") && s.includes("'paused'"),
      rows: [gameRow({ status: "paused" })],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"), rows: [] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.pauseGame({
    gameId: "g1",
    reason: "kaffe-pause",
    actor: masterActor,
  });
  assert.equal(result.status, "paused");
  const auditQuery = queries.find(
    (q) => q.sql.includes("master_audit") && q.sql.includes("INSERT")
  );
  assert.equal(auditQuery!.params[2], "pause");
});

test("pauseGame avviser hvis game ikke kjører", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "purchase_open" })],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.pauseGame({ gameId: "g1", actor: masterActor }),
    (err: unknown) => err instanceof DomainError && err.code === "GAME_NOT_RUNNING"
  );
});

test("resumeGame happy path", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "paused" })],
    },
    {
      match: (s) => s.includes("SET status") && s.includes("'running'"),
      rows: [gameRow({ status: "running" })],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"), rows: [] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.resumeGame({ gameId: "g1", actor: masterActor });
  assert.equal(result.status, "running");
  const auditQuery = queries.find(
    (q) => q.sql.includes("master_audit") && q.sql.includes("INSERT")
  );
  assert.equal(auditQuery!.params[2], "resume");
});

test("resumeGame avviser non-paused", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "running" })],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.resumeGame({ gameId: "g1", actor: masterActor }),
    (err: unknown) => err instanceof DomainError && err.code === "GAME_NOT_PAUSED"
  );
});

// ── Task 1.1: resumeGame håndterer auto-pause-sidestate ────────────────────

test("Task 1.1: resumeGame støtter auto-pause (status='running' + game_state.paused=true)", async () => {
  // Scenario: drawNext satte paused=true etter phase-won. status er fortsatt
  // 'running', men game_state.paused=true. Resume må flippe paused-feltet og
  // beholde status='running'.
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    // loadGameForUpdate — status='running'
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow({ status: "running" })],
    },
    // SELECT FOR UPDATE fra game_state — paused=true + paused_at_phase=1
    {
      match: (s) =>
        s.includes("FOR UPDATE") && s.includes("app_game1_game_state"),
      rows: [
        {
          paused: true,
          paused_at_phase: 1,
          current_phase: 2,
        },
      ],
    },
    // UPDATE game_state SET paused=false + paused_at_phase=NULL
    {
      match: (s) =>
        s.includes("UPDATE") &&
        s.includes("app_game1_game_state") &&
        s.includes("paused"),
      rows: [],
    },
    // SELECT scheduled_games for audit-rad (etter UPDATE av game_state)
    {
      match: (s) =>
        s.includes("SELECT id, status") && !s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "running" })],
    },
    // loadReadySnapshot
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [],
    },
    // writeAudit
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"),
      rows: [],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.resumeGame({ gameId: "g1", actor: masterActor });
  // Status forblir 'running' (auto-pause endrer ikke status)
  assert.equal(result.status, "running");

  // Verifiser at UPDATE game_state ble kalt med paused=false + NULL phase.
  const gameStateUpdate = queries.find(
    (q) =>
      q.sql.includes("UPDATE") &&
      q.sql.includes("app_game1_game_state") &&
      q.sql.includes("paused")
  );
  assert.ok(gameStateUpdate, "UPDATE game_state må skje ved auto-pause-resume");
  // Ikke UPDATE scheduled_games.status (status='running' allerede).
  const scheduledStatusUpdate = queries.find(
    (q) =>
      q.sql.includes("UPDATE") &&
      q.sql.includes("scheduled_games") &&
      q.sql.includes("SET status")
  );
  assert.equal(
    scheduledStatusUpdate,
    undefined,
    "status='running' → ingen UPDATE av scheduled_games.status ved auto-pause-resume"
  );

  // Audit-rad skrives med resumeType='auto' i metadata.
  const auditQuery = queries.find(
    (q) => q.sql.includes("INSERT") && q.sql.includes("master_audit")
  );
  assert.ok(auditQuery);
  const metadata = JSON.parse(String(auditQuery!.params[7]));
  assert.equal(metadata.resumeType, "auto");
  assert.equal(metadata.phase, 2);
});

test("Task 1.1: resumeGame manuell pause fortsatt fungerer (backward compat)", async () => {
  // Skal fortsatt håndtere legacy-flyten: status='paused' + ingen auto-pause
  // sidestate.
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow({ status: "paused" })],
    },
    // SELECT FOR UPDATE fra game_state — paused=false (manuell pause er
    // status-basert, ikke engine-basert)
    {
      match: (s) =>
        s.includes("FOR UPDATE") && s.includes("app_game1_game_state"),
      rows: [
        {
          paused: false,
          paused_at_phase: null,
          current_phase: 1,
        },
      ],
    },
    // UPDATE scheduled_games SET status='running'
    {
      match: (s) =>
        s.includes("UPDATE") &&
        s.includes("scheduled_games") &&
        s.includes("'running'"),
      rows: [gameRow({ status: "running" })],
    },
    // UPDATE game_state (defensiv nullstilling)
    {
      match: (s) =>
        s.includes("UPDATE") &&
        s.includes("app_game1_game_state") &&
        s.includes("paused"),
      rows: [],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"),
      rows: [],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.resumeGame({ gameId: "g1", actor: masterActor });
  assert.equal(result.status, "running");

  // Verifiser at UPDATE scheduled_games.status='running' ble kalt.
  const statusUpdate = queries.find(
    (q) =>
      q.sql.includes("UPDATE") &&
      q.sql.includes("scheduled_games") &&
      q.sql.includes("SET status")
  );
  assert.ok(statusUpdate, "manuell resume må flippe status til 'running'");

  // resumeType='manual' i audit.
  const auditQuery = queries.find(
    (q) => q.sql.includes("INSERT") && q.sql.includes("master_audit")
  );
  const metadata = JSON.parse(String(auditQuery!.params[7]));
  assert.equal(metadata.resumeType, "manual");
});

test("Task 1.1: resumeGame avviser når verken status='paused' eller game_state.paused=true", async () => {
  // Edge case: running game uten noen pause-sidestate → skal fortsatt kaste
  // GAME_NOT_PAUSED (legacy-kontrakt beholdt).
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow({ status: "running" })],
    },
    {
      match: (s) =>
        s.includes("FOR UPDATE") && s.includes("app_game1_game_state"),
      rows: [
        {
          paused: false,
          paused_at_phase: null,
          current_phase: 1,
        },
      ],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.resumeGame({ gameId: "g1", actor: masterActor }),
    (err: unknown) => err instanceof DomainError && err.code === "GAME_NOT_PAUSED"
  );
});

// ── stopGame ────────────────────────────────────────────────────────────────

test("stopGame happy path fra running", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "running" })],
    },
    {
      match: (s) => s.includes("SET status") && s.includes("'cancelled'"),
      rows: [
        gameRow({
          status: "cancelled",
          actual_end_time: "2026-04-21T10:30:00.000Z",
        }),
      ],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"), rows: [] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.stopGame({
    gameId: "g1",
    reason: "Manuell stopp pga strøm-brudd",
    actor: masterActor,
  });
  assert.equal(result.status, "cancelled");
  assert.ok(result.actualEndTime);
  const auditQuery = queries.find(
    (q) => q.sql.includes("master_audit") && q.sql.includes("INSERT")
  );
  assert.equal(auditQuery!.params[2], "stop");
});

test("stopGame aksepterer fra paused", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "paused" })],
    },
    {
      match: (s) => s.includes("SET status") && s.includes("'cancelled'"),
      rows: [gameRow({ status: "cancelled" })],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"), rows: [] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.stopGame({
    gameId: "g1",
    reason: "test",
    actor: masterActor,
  });
  assert.equal(result.status, "cancelled");
});

test("stopGame avviser fra completed", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "completed" })],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.stopGame({ gameId: "g1", reason: "test", actor: masterActor }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "GAME_NOT_STOPPABLE"
  );
});

test("stopGame avviser tom reason", async () => {
  const { pool } = createStubPool([]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.stopGame({ gameId: "g1", reason: "   ", actor: masterActor }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_INPUT"
  );
});

// ── recordTimeoutDetected ───────────────────────────────────────────────────

test("recordTimeoutDetected skriver audit-rad første gang", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "ready_to_start" })],
    },
    {
      match: (s) => s.includes("COUNT(*)") && s.includes("timeout_detected"),
      rows: [{ count: "0" }],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [],
    },
    { match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"), rows: [] },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.recordTimeoutDetected({ gameId: "g1" });
  assert.ok(result.auditId);
  const auditQuery = queries.find(
    (q) => q.sql.includes("master_audit") && q.sql.includes("INSERT")
  );
  assert.equal(auditQuery!.params[2], "timeout_detected");
});

test("recordTimeoutDetected er idempotent — skriver ikke dobbelt", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow({ status: "ready_to_start" })],
    },
    {
      match: (s) => s.includes("COUNT(*)") && s.includes("timeout_detected"),
      rows: [{ count: "1" }],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const result = await svc.recordTimeoutDetected({ gameId: "g1" });
  assert.equal(result.auditId, null);
});

// ── getGameDetail ───────────────────────────────────────────────────────────

test("getGameDetail returnerer spill + halls + audit", async () => {
  const { pool } = createStubPool([
    {
      match: (s) =>
        s.includes("id, status, scheduled_start_time") &&
        s.includes("scheduled_games"),
      rows: [
        {
          id: "g1",
          status: "ready_to_start",
          scheduled_start_time: "2026-04-21T10:00:00.000Z",
          scheduled_end_time: "2026-04-21T11:00:00.000Z",
          actual_start_time: null,
          actual_end_time: null,
          master_hall_id: "hall-master",
          group_hall_id: "grp-1",
          participating_halls_json: ["hall-master", "hall-2"],
          sub_game_name: "Jackpot",
          custom_game_name: null,
          started_by_user_id: null,
          stopped_by_user_id: null,
          stop_reason: null,
        },
      ],
    },
    {
      match: (s) =>
        s.includes("hall_id, is_ready, ready_at") &&
        s.includes("hall_ready_status"),
      rows: [
        {
          hall_id: "hall-master",
          is_ready: true,
          ready_at: "2026-04-21T09:55:00.000Z",
          ready_by_user_id: "u-m",
          digital_tickets_sold: 10,
          physical_tickets_sold: 5,
          excluded_from_game: false,
          excluded_reason: null,
        },
        {
          hall_id: "hall-2",
          is_ready: true,
          ready_at: "2026-04-21T09:58:00.000Z",
          ready_by_user_id: "u-2",
          digital_tickets_sold: 7,
          physical_tickets_sold: 3,
          excluded_from_game: false,
          excluded_reason: null,
        },
      ],
    },
    {
      match: (s) => s.includes("action") && s.includes("master_audit"),
      rows: [
        {
          id: "a1",
          action: "start",
          actor_user_id: "u-m",
          actor_hall_id: "hall-master",
          metadata_json: { reason: null },
          created_at: "2026-04-21T10:00:00.000Z",
        },
      ],
    },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const detail = await svc.getGameDetail("g1");
  assert.equal(detail.game.id, "g1");
  assert.equal(detail.game.status, "ready_to_start");
  assert.equal(detail.halls.length, 2);
  assert.equal(detail.halls[0]!.hallId, "hall-master");
  assert.equal(detail.auditRecent.length, 1);
  assert.equal(detail.auditRecent[0]!.action, "start");
});

test("getGameDetail fyller ut defaults for halls uten ready-rad", async () => {
  const { pool } = createStubPool([
    {
      match: (s) =>
        s.includes("id, status, scheduled_start_time") &&
        s.includes("scheduled_games"),
      rows: [
        {
          id: "g1",
          status: "purchase_open",
          scheduled_start_time: "2026-04-21T10:00:00.000Z",
          scheduled_end_time: "2026-04-21T11:00:00.000Z",
          actual_start_time: null,
          actual_end_time: null,
          master_hall_id: "hall-master",
          group_hall_id: "grp-1",
          participating_halls_json: ["hall-master", "hall-2", "hall-3"],
          sub_game_name: "Jackpot",
          custom_game_name: null,
          started_by_user_id: null,
          stopped_by_user_id: null,
          stop_reason: null,
        },
      ],
    },
    {
      match: (s) => s.includes("hall_ready_status"),
      rows: [],
    },
    { match: (s) => s.includes("master_audit"), rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  const detail = await svc.getGameDetail("g1");
  assert.equal(detail.halls.length, 3);
  for (const h of detail.halls) {
    assert.equal(h.isReady, false);
    assert.equal(h.excludedFromGame, false);
  }
});

test("getGameDetail kaster GAME_NOT_FOUND", async () => {
  const { pool } = createStubPool([
    { match: (_s) => true, rows: [] },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  await assert.rejects(
    svc.getGameDetail("g1"),
    (err: unknown) => err instanceof DomainError && err.code === "GAME_NOT_FOUND"
  );
});
