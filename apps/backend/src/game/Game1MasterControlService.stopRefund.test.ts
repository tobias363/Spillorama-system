/**
 * GAME1_SCHEDULE PR 4d.4: tester for stopGame → refundAllForGame-integrasjon.
 *
 * Verifiserer:
 *   - stopGame kaller ticketPurchaseService.refundAllForGame med riktig
 *     reason-prefix ("master_stop:") + actorUserId + actorType (ADMIN
 *     vs HALL_OPERATOR basert på actor.role).
 *   - MasterActionResult.refundSummary reflekterer resultatet.
 *   - Legacy-mode (ticketPurchaseService ikke injisert) → refundSummary
 *     undefined, ingen kall, ingen crash.
 *   - Refund-partial-failure → warn loggres, stopGame fortsatt success.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  Game1MasterControlService,
  type MasterActor,
} from "./Game1MasterControlService.js";
import type {
  Game1TicketPurchaseService,
  Game1RefundAllForGameInput,
  Game1RefundAllForGameResult,
} from "./Game1TicketPurchaseService.js";

// ── Stub pool (samme mønster som Game1MasterControlService.test.ts) ─────────

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface StubResponse {
  match: (sql: string) => boolean;
  rows: unknown[] | (() => unknown[]);
  rowCount?: number;
  once?: boolean;
}

function createStubPool(responses: StubResponse[] = []): {
  pool: {
    connect: () => Promise<{
      query: (
        sql: string,
        params?: unknown[]
      ) => Promise<{ rows: unknown[]; rowCount: number }>;
      release: () => void;
    }>;
    query: (
      sql: string,
      params?: unknown[]
    ) => Promise<{ rows: unknown[]; rowCount: number }>;
  };
  queries: RecordedQuery[];
} {
  const queue = responses.slice();
  const queries: RecordedQuery[] = [];
  const runQuery = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    for (let i = 0; i < queue.length; i++) {
      const r = queue[i]!;
      if (r.match(sql)) {
        const rows = typeof r.rows === "function" ? r.rows() : r.rows;
        if (r.once !== false) queue.splice(i, 1);
        return { rows, rowCount: r.rowCount ?? rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  };
  return {
    pool: {
      connect: async () => ({ query: runQuery, release: () => undefined }),
      query: runQuery,
    },
    queries,
  };
}

// ── Fake ticketPurchaseService ──────────────────────────────────────────────

interface RefundCall {
  input: Game1RefundAllForGameInput;
}

function makeFakeTicketPurchase(
  refundResult: Game1RefundAllForGameResult
): {
  service: Game1TicketPurchaseService;
  calls: RefundCall[];
} {
  const calls: RefundCall[] = [];
  const service = {
    async refundAllForGame(
      input: Game1RefundAllForGameInput
    ): Promise<Game1RefundAllForGameResult> {
      calls.push({ input });
      return refundResult;
    },
  } as unknown as Game1TicketPurchaseService;
  return { service, calls };
}

// ── Fixture-helpers ─────────────────────────────────────────────────────────

function gameRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "sg-1",
    status: "running",
    master_hall_id: "hall-master",
    group_hall_id: "group-1",
    participating_halls_json: ["hall-master", "hall-a"],
    actual_start_time: "2026-04-21T10:00:00Z",
    actual_end_time: null,
    ...overrides,
  };
}

function adminActor(): MasterActor {
  return {
    userId: "user-admin",
    role: "ADMIN",
    hallId: "hall-master",
  };
}

function hallopActor(): MasterActor {
  return {
    userId: "user-hallop",
    role: "HALL_OPERATOR",
    hallId: "hall-master",
  };
}

function stopStubs(scheduledGameId = "sg-1"): StubResponse[] {
  return [
    { match: (sql) => /^BEGIN/i.test(sql), rows: [] },
    {
      match: (sql) => /FROM.+app_game1_scheduled_games[\s\S]+FOR UPDATE/i.test(sql),
      rows: [gameRow({ id: scheduledGameId })],
    },
    {
      match: (sql) =>
        /UPDATE.+app_game1_scheduled_games[\s\S]+status\s*=\s*'cancelled'/i.test(sql),
      rows: [gameRow({ id: scheduledGameId, status: "cancelled", actual_end_time: "2026-04-21T10:30:00Z" })],
      rowCount: 1,
    },
    {
      match: (sql) => /FROM.+app_game1_hall_ready_status/i.test(sql),
      rows: [],
    },
    {
      match: (sql) => /INSERT INTO.+app_game1_master_audit/i.test(sql),
      rows: [],
      rowCount: 1,
    },
    { match: (sql) => /^COMMIT/i.test(sql), rows: [] },
  ];
}

// ── Tester ──────────────────────────────────────────────────────────────────

test("4d.4: stopGame kaller refundAllForGame med master_stop:-reason-prefix", async () => {
  const refundResult: Game1RefundAllForGameResult = {
    scheduledGameId: "sg-1",
    totalConsidered: 3,
    succeeded: ["p1", "p2", "p3"],
    skippedAlreadyRefunded: [],
    failed: [],
  };
  const { service: ticketPurchase, calls } = makeFakeTicketPurchase(refundResult);
  const { pool } = createStubPool(stopStubs());

  const svc = new Game1MasterControlService({
    pool: pool as never,
    ticketPurchaseService: ticketPurchase,
  });

  const result = await svc.stopGame({
    gameId: "sg-1",
    reason: "pilot-nedetid",
    actor: adminActor(),
  });

  assert.equal(calls.length, 1, "refundAllForGame skal ha blitt kalt én gang");
  assert.equal(calls[0]!.input.scheduledGameId, "sg-1");
  assert.match(
    calls[0]!.input.reason,
    /^master_stop:\s*pilot-nedetid/,
    "reason-prefix 'master_stop:' etterfulgt av operatør-reason"
  );
  assert.equal(calls[0]!.input.refundedByUserId, "user-admin");
  assert.equal(calls[0]!.input.refundedByActorType, "ADMIN");

  assert.ok(result.refundSummary, "refundSummary satt på result");
  assert.equal(result.refundSummary!.succeeded.length, 3);
  assert.equal(result.refundSummary!.failed.length, 0);
  assert.equal(result.status, "cancelled");
});

test("4d.4: HALL_OPERATOR-actor → refundedByActorType='HALL_OPERATOR'", async () => {
  const refundResult: Game1RefundAllForGameResult = {
    scheduledGameId: "sg-1",
    totalConsidered: 0,
    succeeded: [],
    skippedAlreadyRefunded: [],
    failed: [],
  };
  const { service: ticketPurchase, calls } = makeFakeTicketPurchase(refundResult);
  const { pool } = createStubPool(stopStubs());

  const svc = new Game1MasterControlService({
    pool: pool as never,
    ticketPurchaseService: ticketPurchase,
  });

  await svc.stopGame({
    gameId: "sg-1",
    reason: "teknisk-feil",
    actor: hallopActor(),
  });

  assert.equal(calls[0]!.input.refundedByActorType, "HALL_OPERATOR");
});

test("4d.4: partial refund-failure → stopGame fortsatt success, refundSummary reflekterer feil", async () => {
  const refundResult: Game1RefundAllForGameResult = {
    scheduledGameId: "sg-1",
    totalConsidered: 3,
    succeeded: ["p1", "p3"],
    skippedAlreadyRefunded: [],
    failed: [
      {
        purchaseId: "p2",
        errorCode: "REFUND_FAILED",
        errorMessage: "wallet-timeout",
      },
    ],
  };
  const { service: ticketPurchase, calls } = makeFakeTicketPurchase(refundResult);
  const { pool } = createStubPool(stopStubs());

  const svc = new Game1MasterControlService({
    pool: pool as never,
    ticketPurchaseService: ticketPurchase,
  });

  const result = await svc.stopGame({
    gameId: "sg-1",
    reason: "krasj",
    actor: adminActor(),
  });

  assert.equal(calls.length, 1);
  assert.equal(result.status, "cancelled", "stop er fullført DB-mot tross feilet refund");
  assert.equal(result.refundSummary!.failed.length, 1);
  assert.equal(result.refundSummary!.failed[0]!.purchaseId, "p2");
  assert.equal(result.refundSummary!.succeeded.length, 2);
});

test("4d.4: idempotent-hit (allerede refundert) telles som skippedAlreadyRefunded", async () => {
  const refundResult: Game1RefundAllForGameResult = {
    scheduledGameId: "sg-1",
    totalConsidered: 2,
    succeeded: [],
    skippedAlreadyRefunded: ["p1", "p2"],
    failed: [],
  };
  const { service: ticketPurchase } = makeFakeTicketPurchase(refundResult);
  const { pool } = createStubPool(stopStubs());

  const svc = new Game1MasterControlService({
    pool: pool as never,
    ticketPurchaseService: ticketPurchase,
  });

  const result = await svc.stopGame({
    gameId: "sg-1",
    reason: "retry",
    actor: adminActor(),
  });

  assert.equal(result.refundSummary!.skippedAlreadyRefunded.length, 2);
  assert.equal(result.refundSummary!.failed.length, 0);
  assert.equal(result.refundSummary!.succeeded.length, 0);
});

test("4d.4: legacy-modus (ingen ticketPurchaseService) → refundSummary udefinert, ingen crash", async () => {
  const { pool } = createStubPool(stopStubs());

  const svc = new Game1MasterControlService({
    pool: pool as never,
    // Ingen ticketPurchaseService — tester eksisterende testsuite går ikke via
    // refund-path (bakoverkompat).
  });

  const result = await svc.stopGame({
    gameId: "sg-1",
    reason: "legacy-test",
    actor: adminActor(),
  });

  assert.equal(result.status, "cancelled");
  assert.equal(
    result.refundSummary,
    undefined,
    "ingen refundSummary når service ikke er injisert"
  );
});

test("4d.4: setTicketPurchaseService late-binding fungerer", async () => {
  const refundResult: Game1RefundAllForGameResult = {
    scheduledGameId: "sg-1",
    totalConsidered: 1,
    succeeded: ["p1"],
    skippedAlreadyRefunded: [],
    failed: [],
  };
  const { service: ticketPurchase, calls } = makeFakeTicketPurchase(refundResult);
  const { pool } = createStubPool(stopStubs());

  const svc = new Game1MasterControlService({ pool: pool as never });
  svc.setTicketPurchaseService(ticketPurchase);

  await svc.stopGame({
    gameId: "sg-1",
    reason: "late-bind-test",
    actor: adminActor(),
  });

  assert.equal(calls.length, 1, "refundAllForGame kalt via late-bindet service");
});
