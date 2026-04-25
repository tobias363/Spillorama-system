/**
 * MASTER_PLAN §2.3 — integrasjons-tester for jackpot-confirm i
 * Game1MasterControlService.startGame.
 *
 * Dekker:
 *   - startGame uten jackpot-service satt → no-op (legacy path, ingen endring)
 *   - startGame med jackpot-service + jackpotConfirmed=undefined → kaster
 *     JACKPOT_CONFIRM_REQUIRED med details.jackpotAmountCents
 *   - startGame med jackpotConfirmed=true → passerer, returnerer jackpotAmountCents
 *   - jackpot-preflight soft-fails (ikke DomainError) går gjennom
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./BingoEngine.js";
import {
  Game1MasterControlService,
  type MasterActor,
} from "./Game1MasterControlService.js";
import type { Game1JackpotStateService } from "./Game1JackpotStateService.js";

interface StubResponse {
  match: (sql: string) => boolean;
  rows: unknown[];
  rowCount?: number;
}

function createStubPool(responses: StubResponse[] = []): {
  pool: unknown;
  queries: Array<{ sql: string; params: unknown[] }>;
} {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
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
      connect: async () => ({ query, release: () => undefined }),
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

const masterActor: MasterActor = {
  userId: "user-master",
  hallId: "hall-master",
  role: "AGENT",
};

function happyPathResponses(status = "ready_to_start"): StubResponse[] {
  return [
    // Preflight group-hall lookup (non-transactional).
    {
      match: (s) => s.includes("SELECT group_hall_id FROM"),
      rows: [{ group_hall_id: "grp-1" }],
    },
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow({ status })],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        { hall_id: "hall-master", is_ready: true, excluded_from_game: false, digital_tickets_sold: 5, physical_tickets_sold: 0, start_ticket_id: null, final_scan_ticket_id: null },
        { hall_id: "hall-2", is_ready: true, excluded_from_game: false, digital_tickets_sold: 5, physical_tickets_sold: 0, start_ticket_id: null, final_scan_ticket_id: null },
      ],
    },
    {
      match: (s) => s.includes("SET status") && s.includes("'running'"),
      rows: [gameRow({ status: "running" })],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"),
      rows: [],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ];
}

function makeJackpotService(currentCents = 2_400_000): Game1JackpotStateService {
  return {
    getStateForGroup: async (hallGroupId: string) => ({
      hallGroupId,
      currentAmountCents: currentCents,
      lastAccumulationDate: "2026-04-24",
      maxCapCents: 3_000_000,
      dailyIncrementCents: 400_000,
      drawThresholds: [50, 55, 56, 57],
      updatedAt: "2026-04-24T00:15:00.000Z",
    }),
  } as unknown as Game1JackpotStateService;
}

// ── Legacy path: ingen jackpot-service ────────────────────────────────────

test("startGame uten jackpot-service → legacy no-op (ingen JACKPOT_CONFIRM_REQUIRED)", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow()],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        { hall_id: "hall-master", is_ready: true, excluded_from_game: false, digital_tickets_sold: 5, physical_tickets_sold: 0, start_ticket_id: null, final_scan_ticket_id: null },
        { hall_id: "hall-2", is_ready: true, excluded_from_game: false, digital_tickets_sold: 5, physical_tickets_sold: 0, start_ticket_id: null, final_scan_ticket_id: null },
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
  assert.equal(result.jackpotAmountCents, undefined, "ingen jackpot-amount uten service");
});

// ── Confirm required ──────────────────────────────────────────────────────

test("startGame med jackpot-service + uten confirmed → JACKPOT_CONFIRM_REQUIRED", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes("SELECT group_hall_id FROM"),
      rows: [{ group_hall_id: "grp-1" }],
    },
  ]);
  const svc = Game1MasterControlService.forTesting(pool as never);
  svc.setJackpotStateService(makeJackpotService(2_456_000));

  await assert.rejects(
    svc.startGame({ gameId: "g1", actor: masterActor }),
    (err: unknown) => {
      if (!(err instanceof DomainError)) return false;
      if (err.code !== "JACKPOT_CONFIRM_REQUIRED") return false;
      const details = err.details ?? {};
      assert.equal(details.jackpotAmountCents, 2_456_000, "amount i details");
      assert.equal(details.maxCapCents, 3_000_000);
      assert.deepEqual(details.drawThresholds, [50, 55, 56, 57]);
      assert.equal(details.hallGroupId, "grp-1");
      return true;
    }
  );
});

// ── Confirmed → passes ────────────────────────────────────────────────────

test("startGame med jackpotConfirmed=true → passerer + returnerer jackpotAmountCents", async () => {
  const { pool } = createStubPool(happyPathResponses());
  const svc = Game1MasterControlService.forTesting(pool as never);
  svc.setJackpotStateService(makeJackpotService(1_800_000));

  const result = await svc.startGame({
    gameId: "g1",
    actor: masterActor,
    jackpotConfirmed: true,
  });
  assert.equal(result.status, "running");
  assert.equal(result.jackpotAmountCents, 1_800_000, "amount bæres ut i result");
});

// ── No group_hall_id → skip preflight ─────────────────────────────────────

test("startGame uten group_hall_id → hopper over jackpot-preflight", async () => {
  const { pool } = createStubPool([
    // Preflight returnerer ingen rad (spill finnes ikke ennå / feil state).
    {
      match: (s) => s.includes("SELECT group_hall_id FROM"),
      rows: [],
    },
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE"),
      rows: [gameRow()],
    },
    {
      match: (s) => s.includes("hall_id, is_ready, excluded_from_game"),
      rows: [
        { hall_id: "hall-master", is_ready: true, excluded_from_game: false, digital_tickets_sold: 5, physical_tickets_sold: 0, start_ticket_id: null, final_scan_ticket_id: null },
        { hall_id: "hall-2", is_ready: true, excluded_from_game: false, digital_tickets_sold: 5, physical_tickets_sold: 0, start_ticket_id: null, final_scan_ticket_id: null },
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
  svc.setJackpotStateService(makeJackpotService(999_999));
  // Ingen jackpotConfirmed — men fordi group_hall_id mangler, skal preflight
  // hoppe over og start fortsette normalt.
  const result = await svc.startGame({ gameId: "g1", actor: masterActor });
  assert.equal(result.status, "running");
  assert.equal(result.jackpotAmountCents, undefined);
});

// ── Soft-fail i jackpot-service → start fortsetter ────────────────────────

test("jackpot-service kaster ikke-DomainError → soft-fail, startGame fortsetter", async () => {
  const { pool } = createStubPool(happyPathResponses());
  const svc = Game1MasterControlService.forTesting(pool as never);
  const failingService: Game1JackpotStateService = {
    getStateForGroup: async () => {
      throw new Error("pool connection refused");
    },
  } as unknown as Game1JackpotStateService;
  svc.setJackpotStateService(failingService);

  const result = await svc.startGame({ gameId: "g1", actor: masterActor });
  assert.equal(result.status, "running", "soft-fail skal ikke blokkere start");
});
