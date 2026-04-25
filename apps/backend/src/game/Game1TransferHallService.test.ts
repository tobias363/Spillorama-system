/**
 * Task 1.6: unit-tester for Game1TransferHallService.
 *
 * Stub-pool-mønster matcher Game1MasterControlService.test.ts — match SQL-
 * fragmenter + returnér preset rader.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./BingoEngine.js";
import { Game1TransferHallService } from "./Game1TransferHallService.js";

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface StubResponse {
  match: (sql: string) => boolean;
  rows: unknown[];
  rowCount?: number;
  /** Hvor mange ganger svaret kan returneres før det fjernes (default 1). */
  repeat?: number;
}

interface StubClient {
  query: (
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: unknown[]; rowCount: number }>;
  release: () => void;
}

function createStubPool(responses: StubResponse[] = []): {
  pool: {
    connect: () => Promise<StubClient>;
    query: (
      sql: string,
      params?: unknown[]
    ) => Promise<{ rows: unknown[]; rowCount: number }>;
  };
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const activeResponses = responses.map((r) => ({ ...r, repeat: r.repeat ?? 1 }));

  const query = async (sql: string, params: unknown[] = []) => {
    queries.push({ sql, params });
    for (let i = 0; i < activeResponses.length; i++) {
      const r = activeResponses[i]!;
      if (r.match(sql)) {
        r.repeat -= 1;
        if (r.repeat <= 0) activeResponses.splice(i, 1);
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
    status: "running",
    master_hall_id: "hall-a",
    group_hall_id: "grp-1",
    participating_halls_json: ["hall-a", "hall-b", "hall-c"],
    ...overrides,
  };
}

function requestRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "req-1",
    game_id: "g1",
    from_hall_id: "hall-a",
    to_hall_id: "hall-b",
    initiated_by_user_id: "user-a",
    initiated_at: "2026-04-24T10:00:00.000Z",
    valid_till: new Date(Date.now() + 60_000).toISOString(),
    status: "pending",
    responded_by_user_id: null,
    responded_at: null,
    reject_reason: null,
    ...overrides,
  };
}

// ── requestTransfer ─────────────────────────────────────────────────────────

test("requestTransfer happy path opprettet request + audit", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow()],
    },
    {
      match: (s) => s.includes("SELECT excluded_from_game"),
      rows: [],
    },
    {
      // Cancel tidligere pending — ingen rader.
      match: (s) => s.includes("UPDATE") && s.includes("transfer_requests") && s.includes("status      = 'expired'"),
      rows: [],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("transfer_requests"),
      rows: [requestRow()],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"),
      rows: [],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);

  const svc = Game1TransferHallService.forTesting(pool as never);
  const result = await svc.requestTransfer({
    gameId: "g1",
    fromHallId: "hall-a",
    toHallId: "hall-b",
    initiatedByUserId: "user-a",
  });

  assert.equal(result.status, "pending");
  assert.equal(result.fromHallId, "hall-a");
  assert.equal(result.toHallId, "hall-b");
  const auditInsert = queries.find(
    (q) => q.sql.includes("INSERT INTO") && q.sql.includes("master_audit")
  );
  assert.ok(auditInsert);
  assert.equal(auditInsert!.params[2], "transfer_request");
});

test("requestTransfer avvises når fromHallId != master_hall_id", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow({ master_hall_id: "hall-a" })],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);

  const svc = Game1TransferHallService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.requestTransfer({
        gameId: "g1",
        fromHallId: "hall-b",
        toHallId: "hall-c",
        initiatedByUserId: "user-b",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "NOT_CURRENT_MASTER"
  );
});

test("requestTransfer avvises når toHallId == fromHallId (self-transfer)", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow()],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1TransferHallService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.requestTransfer({
        gameId: "g1",
        fromHallId: "hall-a",
        toHallId: "hall-a",
        initiatedByUserId: "user-a",
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "TARGET_IS_CURRENT_MASTER"
  );
});

test("requestTransfer avvises når toHallId ikke er i participating_halls_json", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow({ participating_halls_json: ["hall-a", "hall-b"] })],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1TransferHallService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.requestTransfer({
        gameId: "g1",
        fromHallId: "hall-a",
        toHallId: "hall-z",
        initiatedByUserId: "user-a",
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "TARGET_HALL_NOT_PARTICIPATING"
  );
});

test("requestTransfer avvises når toHallId er ekskludert fra spillet", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow()],
    },
    {
      match: (s) => s.includes("excluded_from_game") && s.includes("hall_id ="),
      rows: [{ excluded_from_game: true }],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1TransferHallService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.requestTransfer({
        gameId: "g1",
        fromHallId: "hall-a",
        toHallId: "hall-b",
        initiatedByUserId: "user-a",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "TARGET_HALL_EXCLUDED"
  );
});

test("requestTransfer avvises når spill er cancelled", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow({ status: "cancelled" })],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1TransferHallService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.requestTransfer({
        gameId: "g1",
        fromHallId: "hall-a",
        toHallId: "hall-b",
        initiatedByUserId: "user-a",
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "GAME_NOT_TRANSFERABLE"
  );
});

test("requestTransfer kansellerer tidligere pending-request (second request invaliderer første)", async () => {
  // Dette er sekvensielt: (a) prior UPDATE returnerer 1 rad, (b) audit-INSERT
  // for prior (action=transfer_expired), (c) INSERT ny transfer_request, (d)
  // audit-INSERT for ny (action=transfer_request).
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow()],
    },
    {
      match: (s) => s.includes("SELECT excluded_from_game"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("UPDATE") &&
        s.includes("transfer_requests") &&
        s.includes("status      = 'expired'"),
      rows: [requestRow({ id: "prior-req", to_hall_id: "hall-c" })],
    },
    {
      // Første audit-INSERT (prior expired).
      match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"),
      rows: [],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("transfer_requests"),
      rows: [requestRow({ id: "new-req" })],
    },
    {
      // Andre audit-INSERT (ny request).
      match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"),
      rows: [],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1TransferHallService.forTesting(pool as never);
  const result = await svc.requestTransfer({
    gameId: "g1",
    fromHallId: "hall-a",
    toHallId: "hall-b",
    initiatedByUserId: "user-a",
  });
  assert.equal(result.id, "new-req");
  const priorAudit = queries.find(
    (q) =>
      q.sql.includes("INSERT INTO") &&
      q.sql.includes("master_audit") &&
      q.params[2] === "transfer_expired"
  );
  assert.ok(priorAudit, "forrige request må ha fått transfer_expired-audit");
});

// ── approveTransfer ─────────────────────────────────────────────────────────

test("approveTransfer happy path oppdaterer master_hall_id + audit", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("transfer_requests"),
      rows: [requestRow()],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow()],
    },
    {
      match: (s) =>
        s.includes("UPDATE") &&
        s.includes("scheduled_games") &&
        s.includes("master_hall_id ="),
      rows: [],
      rowCount: 1,
    },
    {
      match: (s) =>
        s.includes("UPDATE") &&
        s.includes("transfer_requests") &&
        s.includes("status                = 'approved'"),
      rows: [requestRow({ status: "approved", responded_by_user_id: "user-b" })],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"),
      rows: [],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);

  const svc = Game1TransferHallService.forTesting(pool as never);
  const result = await svc.approveTransfer({
    requestId: "req-1",
    respondedByUserId: "user-b",
    respondedByHallId: "hall-b",
  });
  assert.equal(result.newMasterHallId, "hall-b");
  assert.equal(result.previousMasterHallId, "hall-a");
  assert.equal(result.request.status, "approved");
  const masterUpdate = queries.find(
    (q) =>
      q.sql.includes("UPDATE") &&
      q.sql.includes("scheduled_games") &&
      q.sql.includes("master_hall_id =")
  );
  assert.ok(masterUpdate);
  assert.equal(masterUpdate!.params[1], "hall-b");
});

test("approveTransfer avvises hvis valid_till har passert (TTL)", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("transfer_requests"),
      rows: [requestRow({ valid_till: new Date(Date.now() - 1000).toISOString() })],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1TransferHallService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.approveTransfer({
        requestId: "req-1",
        respondedByUserId: "user-b",
        respondedByHallId: "hall-b",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "TRANSFER_EXPIRED"
  );
});

test("approveTransfer avvises hvis respondedByHallId != to_hall_id", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("transfer_requests"),
      rows: [requestRow()],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1TransferHallService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.approveTransfer({
        requestId: "req-1",
        respondedByUserId: "user-c",
        respondedByHallId: "hall-c",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "UNAUTHORIZED"
  );
});

test("approveTransfer idempotent — dobbel approve returnerer ALREADY_APPROVED", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("transfer_requests"),
      rows: [requestRow({ status: "approved" })],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1TransferHallService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.approveTransfer({
        requestId: "req-1",
        respondedByUserId: "user-b",
        respondedByHallId: "hall-b",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "ALREADY_APPROVED"
  );
});

test("approveTransfer feiler når request ikke finnes", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("transfer_requests"),
      rows: [],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1TransferHallService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.approveTransfer({
        requestId: "missing",
        respondedByUserId: "user-b",
        respondedByHallId: "hall-b",
      }),
    (err: unknown) =>
      err instanceof DomainError && err.code === "TRANSFER_REQUEST_NOT_FOUND"
  );
});

// ── rejectTransfer ──────────────────────────────────────────────────────────

test("rejectTransfer happy path markerer rejected + audit", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("transfer_requests"),
      rows: [requestRow()],
    },
    {
      match: (s) =>
        s.includes("UPDATE") &&
        s.includes("transfer_requests") &&
        s.includes("status                = 'rejected'"),
      rows: [
        requestRow({
          status: "rejected",
          responded_by_user_id: "user-b",
          reject_reason: "opptatt",
        }),
      ],
    },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("scheduled_games"),
      rows: [gameRow()],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"),
      rows: [],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);

  const svc = Game1TransferHallService.forTesting(pool as never);
  const result = await svc.rejectTransfer({
    requestId: "req-1",
    respondedByUserId: "user-b",
    respondedByHallId: "hall-b",
    reason: "opptatt",
  });
  assert.equal(result.status, "rejected");
  assert.equal(result.rejectReason, "opptatt");
  const audit = queries.find(
    (q) =>
      q.sql.includes("INSERT INTO") &&
      q.sql.includes("master_audit") &&
      q.params[2] === "transfer_rejected"
  );
  assert.ok(audit);
});

test("rejectTransfer avvises hvis ikke fra target-hall", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("FOR UPDATE") && s.includes("transfer_requests"),
      rows: [requestRow()],
    },
    { match: (s) => s.startsWith("ROLLBACK"), rows: [] },
  ]);
  const svc = Game1TransferHallService.forTesting(pool as never);
  await assert.rejects(
    () =>
      svc.rejectTransfer({
        requestId: "req-1",
        respondedByUserId: "user-x",
        respondedByHallId: "hall-x",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "UNAUTHORIZED"
  );
});

// ── expireStaleTasks ────────────────────────────────────────────────────────

test("expireStaleTasks UPDATEr pending+utløpte → expired og skriver audit", async () => {
  const { pool, queries } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) =>
        s.includes("UPDATE") &&
        s.includes("transfer_requests") &&
        s.includes("status       = 'expired'") &&
        s.includes("WHERE status = 'pending' AND valid_till < now()"),
      rows: [
        requestRow({
          id: "exp-1",
          status: "expired",
          valid_till: "2026-04-24T09:00:00.000Z",
        }),
      ],
    },
    {
      match: (s) => s.includes("SELECT") && s.includes("scheduled_games") && s.includes("WHERE id ="),
      rows: [gameRow()],
    },
    {
      match: (s) => s.includes("INSERT INTO") && s.includes("master_audit"),
      rows: [],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1TransferHallService.forTesting(pool as never);
  const result = await svc.expireStaleTasks();
  assert.equal(result.length, 1);
  assert.equal(result[0]!.status, "expired");
  const audit = queries.find(
    (q) =>
      q.sql.includes("INSERT INTO") &&
      q.sql.includes("master_audit") &&
      q.params[2] === "transfer_expired"
  );
  assert.ok(audit);
  assert.equal(audit!.params[3], "SYSTEM");
});

test("expireStaleTasks uten utløpte returnerer tom liste", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.startsWith("BEGIN"), rows: [] },
    {
      match: (s) => s.includes("UPDATE") && s.includes("transfer_requests"),
      rows: [],
    },
    { match: (s) => s.startsWith("COMMIT"), rows: [] },
  ]);
  const svc = Game1TransferHallService.forTesting(pool as never);
  const result = await svc.expireStaleTasks();
  assert.equal(result.length, 0);
});

// ── getActiveRequestForGame ─────────────────────────────────────────────────

test("getActiveRequestForGame returnerer pending request", async () => {
  const { pool } = createStubPool([
    {
      match: (s) =>
        s.includes("SELECT") &&
        s.includes("transfer_requests") &&
        s.includes("WHERE game_id = $1 AND status = 'pending'"),
      rows: [requestRow()],
    },
  ]);
  const svc = Game1TransferHallService.forTesting(pool as never);
  const result = await svc.getActiveRequestForGame("g1");
  assert.ok(result);
  assert.equal(result!.status, "pending");
});

test("getActiveRequestForGame behandler utløpt-men-fortsatt-pending som null (pre-tick-race)", async () => {
  const { pool } = createStubPool([
    {
      match: (s) =>
        s.includes("SELECT") &&
        s.includes("transfer_requests") &&
        s.includes("WHERE game_id = $1 AND status = 'pending'"),
      rows: [
        requestRow({
          valid_till: new Date(Date.now() - 1000).toISOString(),
        }),
      ],
    },
  ]);
  const svc = Game1TransferHallService.forTesting(pool as never);
  const result = await svc.getActiveRequestForGame("g1");
  assert.equal(result, null);
});

test("getActiveRequestForGame returnerer null hvis ingen pending", async () => {
  const { pool } = createStubPool([
    {
      match: (s) => s.includes("SELECT") && s.includes("transfer_requests"),
      rows: [],
    },
  ]);
  const svc = Game1TransferHallService.forTesting(pool as never);
  const result = await svc.getActiveRequestForGame("g1");
  assert.equal(result, null);
});
