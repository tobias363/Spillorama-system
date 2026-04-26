/**
 * CRIT-7 (SPILL1_CASINO_GRADE_REVIEW_2026-04-26):
 *
 * Compensating rollback når `drawEngine.startGame` feiler etter at
 * `Game1MasterControlService.startGame` har committet
 * `scheduled_games.status='running'`. Uten rollbacken er DB-state stuck
 * — auto-draw-tick hopper over (krever game_state-rad), og master kan
 * ikke pause/resume (engine kaster fordi state mangler).
 *
 * Dekning:
 *   1. Engine.startGame lykkes → INGEN rollback, INGEN ekstra audit.
 *   2. Engine.startGame feiler → kompenserende UPDATE reverter status til
 *      'ready_to_start' (eller 'purchase_open') og audit-event
 *      `start_engine_failed_rollback` skrives.
 *   3. Original engine-feil propageres uendret til caller.
 *   4. Rollback er idempotent — andre transaksjoner kan kjøre i
 *      mellomtiden (FOR UPDATE-lock + status-guard).
 *   5. Hvis rollback selv feiler, logges det men original engine-feil
 *      kastes fortsatt (ingen swallow).
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
  /** Hvis satt, kaster ved match. Brukes for å simulere DB-feil. */
  throws?: Error;
  /** Hvis true, returneres responsen flere ganger (default: én gang). */
  reusable?: boolean;
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

/**
 * Felles helper: setup en pool med happy-path-responses for master-tx,
 * pluss en run-once "FOR UPDATE running"-respons til rollback-tx.
 */
function makePoolForStartTx(
  startStatus = "ready_to_start"
): ReturnType<typeof createStubPool> {
  return createStubPool([
    // Master-tx start.
    { match: (s) => s.startsWith("BEGIN"), rows: [], reusable: true },
    {
      // Master-tx loadGameForUpdate: SELECT id, status, master_hall_id, ...
      match: (s) =>
        s.includes("FOR UPDATE") &&
        s.includes("scheduled_games") &&
        s.includes("master_hall_id"),
      rows: [gameRow({ status: startStatus })],
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
          actual_start_time: "2026-04-26T10:00:00.000Z",
        }),
      ],
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
}

/**
 * Stub drawEngine som lykkes — bekrefter at suksess-path ikke trigger
 * rollback.
 */
class StubSuccessDrawEngine {
  startGameCalls: Array<{ gameId: string; actorId: string }> = [];
  async startGame(gameId: string, actorUserId: string): Promise<void> {
    this.startGameCalls.push({ gameId, actorId: actorUserId });
  }
}

/**
 * Stub drawEngine som feiler — bekrefter at compensating rollback kjøres.
 */
class StubFailingDrawEngine {
  async startGame(_gameId: string, _actorUserId: string): Promise<void> {
    throw new DomainError("ENGINE_BOOM", "Simulert engine-feil for CRIT-7-test");
  }
}

// ── 1: happy path — engine lykkes, ingen rollback ──────────────────────────

test("CRIT-7: drawEngine.startGame lykkes → INGEN compensating rollback", async () => {
  const { pool, queries } = makePoolForStartTx();
  const svc = Game1MasterControlService.forTesting(pool as never);
  const engine = new StubSuccessDrawEngine();
  svc.setDrawEngine(engine as never);

  const result = await svc.startGame({ gameId: "g1", actor: masterActor });

  assert.equal(result.status, "running", "master-resultat skal være running");
  assert.equal(engine.startGameCalls.length, 1, "engine.startGame kalt én gang");

  // Ingen rollback-relaterte queries skal være utført.
  const hasRollbackUpdate = queries.some(
    (q) =>
      q.sql.includes("UPDATE") &&
      q.sql.includes("actual_start_time   = NULL")
  );
  assert.equal(hasRollbackUpdate, false, "ingen rollback-UPDATE skal kjøres");

  const hasRollbackAudit = queries.some(
    (q) => q.params[2] === "start_engine_failed_rollback"
  );
  assert.equal(
    hasRollbackAudit,
    false,
    "ingen `start_engine_failed_rollback`-audit"
  );
});

// ── 2: engine feiler → rollback + audit ────────────────────────────────────

test("CRIT-7: drawEngine.startGame feiler → status reverteres + audit skrives", async () => {
  const { pool, queries } = makePoolForStartTx("ready_to_start");
  const svc = Game1MasterControlService.forTesting(pool as never);
  svc.setDrawEngine(new StubFailingDrawEngine() as never);

  await assert.rejects(
    svc.startGame({ gameId: "g1", actor: masterActor }),
    (err: unknown) => {
      // CRIT-7-krav: original engine-feil propageres uendret.
      assert.ok(err instanceof DomainError, "feilen skal være DomainError");
      assert.equal((err as DomainError).code, "ENGINE_BOOM");
      return true;
    }
  );

  // Rollback-UPDATE skal være utført.
  const rollbackUpdate = queries.find(
    (q) =>
      q.sql.includes("UPDATE") &&
      q.sql.includes("actual_start_time   = NULL")
  );
  assert.ok(rollbackUpdate, "compensating rollback-UPDATE skal være utført");
  // Param 1 = gameId, param 2 = preStatus.
  assert.equal(rollbackUpdate!.params[0], "g1");
  assert.equal(
    rollbackUpdate!.params[1],
    "ready_to_start",
    "rollback skal revertere til pre-status"
  );

  // Rollback-audit skal være skrevet.
  const rollbackAudit = queries.find(
    (q) => q.params[2] === "start_engine_failed_rollback"
  );
  assert.ok(rollbackAudit, "rollback-audit skal være skrevet");
  // metadata-paramen er JSON-stringified — sjekk at den inneholder pre-status.
  const metadataJson = rollbackAudit!.params[7] as string;
  assert.ok(
    metadataJson.includes("ready_to_start"),
    "audit-metadata skal inkludere revertedToStatus"
  );
  assert.ok(
    metadataJson.includes("ENGINE_BOOM"),
    "audit-metadata skal inkludere engineErrorCode"
  );
});

// ── 3: pre-status purchase_open reverteres korrekt ─────────────────────────

test("CRIT-7: pre-status 'purchase_open' rulles tilbake til purchase_open", async () => {
  const { pool, queries } = makePoolForStartTx("purchase_open");
  const svc = Game1MasterControlService.forTesting(pool as never);
  svc.setDrawEngine(new StubFailingDrawEngine() as never);

  await assert.rejects(svc.startGame({ gameId: "g1", actor: masterActor }));

  const rollbackUpdate = queries.find(
    (q) =>
      q.sql.includes("UPDATE") &&
      q.sql.includes("actual_start_time   = NULL")
  );
  assert.ok(rollbackUpdate);
  assert.equal(
    rollbackUpdate!.params[1],
    "purchase_open",
    "rollback skal revertere til purchase_open (faktisk pre-status)"
  );
});

// ── 4: status er allerede ikke 'running' når rollback prøver — skip ────────

test("CRIT-7: rollback skipper UPDATE hvis status ikke lenger er 'running'", async () => {
  // Sett opp pool der "FOR UPDATE running"-sjekken returnerer et annet status.
  // Dette simulerer at en annen tx (auto-draw-tick som faktisk lyktes, eller
  // master-pause via separat path) har endret status før rollback fikk lås.
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [], reusable: true },
    {
      // Master-tx loadGameForUpdate.
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
      rows: [gameRow({ status: "running" })],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"),
      rows: [],
      reusable: true,
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [], reusable: true },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [], reusable: true },
    // Rollback-tx: status er nå 'paused' (annen path har endret den).
    {
      match: (s) =>
        s.includes("SELECT status FROM") &&
        s.includes("scheduled_games") &&
        s.includes("FOR UPDATE"),
      rows: [{ status: "paused" }],
    },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  svc.setDrawEngine(new StubFailingDrawEngine() as never);

  await assert.rejects(svc.startGame({ gameId: "g1", actor: masterActor }));

  // Rollback-UPDATE skal IKKE være utført — status-guard hindret det.
  const rollbackUpdate = queries.find(
    (q) =>
      q.sql.includes("UPDATE") &&
      q.sql.includes("actual_start_time   = NULL")
  );
  assert.equal(
    rollbackUpdate,
    undefined,
    "rollback-UPDATE skal SKIPPES når status ikke er 'running'"
  );
});

// ── 5: ingen drawEngine — happy path uten rollback-handling ────────────────

test("CRIT-7: ingen drawEngine injisert → ingen engine-kall, ingen rollback", async () => {
  const { pool, queries } = makePoolForStartTx();
  const svc = Game1MasterControlService.forTesting(pool as never);
  // Ikke setDrawEngine — drawEngine er null.

  const result = await svc.startGame({ gameId: "g1", actor: masterActor });
  assert.equal(result.status, "running");

  // Ingen rollback skal være kjørt (kort-circuit på `if (this.drawEngine)`).
  const rollbackUpdate = queries.find(
    (q) =>
      q.sql.includes("UPDATE") &&
      q.sql.includes("actual_start_time   = NULL")
  );
  assert.equal(rollbackUpdate, undefined);
});
