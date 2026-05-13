/**
 * Tobias-direktiv 2026-05-13 (pilot-bugs #1-3 + #6 + #7):
 *
 * Post-engine-start hook for Game1MasterControlService. Hook binder per-
 * rom entryFee + variantConfig fra scheduled-game-raden's
 * `ticket_config_json` slik at klienten ikke faller til default-fallback
 * (30 kr / 60 kr) når plan-driven Spill 1 starter.
 *
 * Dekning:
 *   1. Engine.startGame lykkes → onEngineStarted hook kalles med
 *      scheduledGameId + actorUserId.
 *   2. Hook kalles KUN i suksess-path, IKKE under rollback.
 *   3. Hook-feil er soft-fail — påvirker IKKE caller-resultat eller
 *      engine-state.
 *   4. Når ingen drawEngine er injisert, kalles ikke hook (legacy-mode).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../errors/DomainError.js";
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
  reusable?: boolean;
  throws?: Error;
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
        if (!r.reusable) {
          activeResponses.splice(i, 1);
        }
        if (r.throws) throw r.throws;
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
    participating_halls_json: ["hall-master", "hall-2"],
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

function makeHappyPool(): ReturnType<typeof createStubPool> {
  return createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [], reusable: true },
    {
      match: (s) =>
        s.includes("FOR UPDATE") &&
        s.includes("scheduled_games") &&
        s.includes("master_hall_id"),
      rows: [gameRow({ status: "ready_to_start" })],
      reusable: true,
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        readyRow({ hall_id: "hall-master", is_ready: true }),
        readyRow({ hall_id: "hall-2", is_ready: true }),
      ],
    },
    {
      match: (s) =>
        s.includes("UPDATE") &&
        s.includes("'running'") &&
        s.includes("RETURNING"),
      rows: [
        gameRow({
          status: "running",
          actual_start_time: "2026-05-13T10:00:00.000Z",
        }),
      ],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"),
      rows: [],
      reusable: true,
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [], reusable: true },
  ]);
}

class StubSuccessDrawEngine {
  startGameCalls: Array<{ gameId: string; actorId: string }> = [];
  async startGame(gameId: string, actorUserId: string): Promise<void> {
    this.startGameCalls.push({ gameId, actorId: actorUserId });
  }
}

class StubFailingDrawEngine {
  async startGame(_gameId: string, _actorUserId: string): Promise<void> {
    throw new DomainError("ENGINE_BOOM", "Simulert engine-feil");
  }
}

// ── Hook kalles i suksess-path ──────────────────────────────────────────────

test("onEngineStarted hook kalles med scheduledGameId + actorUserId etter engine.startGame", async () => {
  const { pool } = makeHappyPool();
  const svc = Game1MasterControlService.forTesting(pool as never);
  svc.setDrawEngine(new StubSuccessDrawEngine() as never);

  const calls: Array<{ scheduledGameId: string; actorUserId: string }> = [];
  svc.setOnEngineStarted(async (input) => {
    calls.push(input);
  });

  const result = await svc.startGame({ gameId: "g1", actor: masterActor });

  assert.equal(result.status, "running");
  assert.equal(calls.length, 1, "hook skal være kalt akkurat én gang");
  assert.equal(calls[0].scheduledGameId, "g1");
  assert.equal(calls[0].actorUserId, "user-master");
});

// ── Hook kalles IKKE når engine feiler ──────────────────────────────────────

test("onEngineStarted hook kalles IKKE når drawEngine.startGame feiler", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [], reusable: true },
    {
      match: (s) =>
        s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow({ status: "ready_to_start" })],
      reusable: true,
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [readyRow({ hall_id: "hall-master", is_ready: true })],
    },
    {
      match: (s) => s.includes("UPDATE") && s.includes("'running'"),
      rows: [gameRow({ status: "running" })],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"),
      rows: [],
      reusable: true,
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [], reusable: true },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [], reusable: true },
    // Rollback-tx: FOR UPDATE i status='running'.
    {
      match: (s) =>
        s.includes("SELECT status FROM") &&
        s.includes("scheduled_games") &&
        s.includes("FOR UPDATE"),
      rows: [{ status: "running" }],
    },
    // Rollback-tx UPDATE.
    {
      match: (s) =>
        s.includes("UPDATE") &&
        s.includes("actual_start_time   = NULL"),
      rows: [],
    },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  svc.setDrawEngine(new StubFailingDrawEngine() as never);

  const calls: Array<{ scheduledGameId: string; actorUserId: string }> = [];
  svc.setOnEngineStarted(async (input) => {
    calls.push(input);
  });

  await assert.rejects(
    svc.startGame({ gameId: "g1", actor: masterActor }),
    (err: unknown) => {
      assert.ok(err instanceof DomainError);
      assert.equal((err as DomainError).code, "ENGINE_BOOM");
      return true;
    }
  );

  assert.equal(calls.length, 0, "hook skal IKKE kalles ved engine-feil");
});

// ── Hook-feil er soft-fail ──────────────────────────────────────────────────

test("onEngineStarted hook som kaster gjør IKKE master-start til feil", async () => {
  const { pool } = makeHappyPool();
  const svc = Game1MasterControlService.forTesting(pool as never);
  svc.setDrawEngine(new StubSuccessDrawEngine() as never);

  svc.setOnEngineStarted(async () => {
    throw new Error("Simulert hook-feil");
  });

  // Master-start skal returnere normalt selv om hooken kaster.
  const result = await svc.startGame({ gameId: "g1", actor: masterActor });
  assert.equal(result.status, "running");
});

// ── Ingen hook → ingen no-op-kall ──────────────────────────────────────────

test("onEngineStarted hook ikke satt → master-start kjører uten hook-kall (legacy-mode)", async () => {
  const { pool } = makeHappyPool();
  const svc = Game1MasterControlService.forTesting(pool as never);
  svc.setDrawEngine(new StubSuccessDrawEngine() as never);

  // Ikke sett hook — verifiser at master-start fungerer som før.
  const result = await svc.startGame({ gameId: "g1", actor: masterActor });
  assert.equal(result.status, "running");
});

// ── setOnEngineStarted(null) clearer eksisterende hook ─────────────────────

test("setOnEngineStarted(undefined) clearer eksisterende hook", async () => {
  const { pool } = makeHappyPool();
  const svc = Game1MasterControlService.forTesting(pool as never);
  svc.setDrawEngine(new StubSuccessDrawEngine() as never);

  let called = 0;
  svc.setOnEngineStarted(async () => {
    called++;
  });
  // Clear it.
  svc.setOnEngineStarted(undefined);

  await svc.startGame({ gameId: "g1", actor: masterActor });
  assert.equal(called, 0, "hook skal IKKE kalles etter clear");
});
