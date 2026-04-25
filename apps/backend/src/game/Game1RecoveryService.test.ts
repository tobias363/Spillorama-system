/**
 * GAME1_SCHEDULE PR 5: unit-tester for Game1RecoveryService.
 *
 * Testene bruker en stub-pool som matcher mot SQL-fragment og returnerer
 * preset rader. Mønsteret følger Game1MasterControlService.test.ts så
 * det er lett å lese begge sammen.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./BingoEngine.js";
import { Game1RecoveryService } from "./Game1RecoveryService.js";

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

function scheduledRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "g1",
    status: "running",
    master_hall_id: "hall-master",
    group_hall_id: "grp-1",
    scheduled_end_time: new Date("2026-04-20T18:00:00Z"),
    ...overrides,
  };
}

// ── Konstruksjon ────────────────────────────────────────────────────────────

test("PR5 recovery: konstruksjon feiler på ugyldig schema", () => {
  const { pool } = createStubPool();
  assert.throws(
    () =>
      new Game1RecoveryService({
        pool: pool as never,
        schema: "drop-table;",
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG",
  );
});

test("PR5 recovery: konstruksjon feiler på ugyldig maxRunningWindowMs", () => {
  const { pool } = createStubPool();
  assert.throws(
    () =>
      new Game1RecoveryService({
        pool: pool as never,
        maxRunningWindowMs: 0,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG",
  );
});

// ── Tom tabell ──────────────────────────────────────────────────────────────

test("PR5 recovery: tom tabell → inspected=0, cancelled=0, preserved=0", async () => {
  const { pool } = createStubPool([
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_scheduled_games\""),
      rows: [],
    },
  ]);
  const service = Game1RecoveryService.forTesting(pool as never);
  const result = await service.runRecoveryPass(Date.parse("2026-04-21T12:00:00Z"));
  assert.deepEqual(result, {
    inspected: 0,
    cancelled: 0,
    preserved: 0,
    failures: [],
    cancelledGameIds: [],
    preservedGameIds: [],
  });
});

// ── Overdue cancel ─────────────────────────────────────────────────────────

test("PR5 recovery: running-rad > 2h over scheduled_end_time auto-kanselleres", async () => {
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  // scheduled_end_time=2026-04-20T18:00Z → 18 timer tilbake i tid, langt over 2h-vinduet.
  const overdueRow = scheduledRow({
    id: "g-overdue",
    status: "running",
    scheduled_end_time: new Date("2026-04-20T18:00:00Z"),
  });
  const { pool, queries } = createStubPool([
    {
      match: (sql) =>
        sql.includes("SELECT id, status, master_hall_id, group_hall_id, scheduled_end_time"),
      rows: [overdueRow],
    },
    { match: (sql) => sql.trim() === "BEGIN", rows: [] },
    {
      match: (sql) => sql.includes("UPDATE \"public\".\"app_game1_scheduled_games\""),
      rows: [{ id: "g-overdue", status: "cancelled" }],
    },
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_hall_ready_status\""),
      rows: [
        { hall_id: "hall-1", is_ready: true, excluded_from_game: false },
        { hall_id: "hall-2", is_ready: false, excluded_from_game: false },
      ],
    },
    {
      match: (sql) => sql.includes("INSERT INTO \"public\".\"app_game1_master_audit\""),
      rows: [],
    },
    { match: (sql) => sql.trim() === "COMMIT", rows: [] },
  ]);
  const service = Game1RecoveryService.forTesting(pool as never);
  const result = await service.runRecoveryPass(nowMs);
  assert.equal(result.inspected, 1);
  assert.equal(result.cancelled, 1);
  assert.equal(result.preserved, 0);
  assert.deepEqual(result.cancelledGameIds, ["g-overdue"]);
  assert.equal(result.failures.length, 0);

  // Verifiser at UPDATE ble kjørt med crash_recovery_cancelled-stop-reason
  const updateQuery = queries.find((q) =>
    q.sql.includes("SET status          = 'cancelled'"),
  );
  assert.ok(updateQuery, "UPDATE må være sendt");

  // Verifiser at INSERT INTO master_audit fikk action='stop' + metadata
  const auditQuery = queries.find((q) =>
    q.sql.includes("INSERT INTO \"public\".\"app_game1_master_audit\""),
  );
  assert.ok(auditQuery, "audit INSERT må være sendt");
  const metadataParam = auditQuery!.params[5] as string;
  const metadata = JSON.parse(metadataParam);
  assert.equal(metadata.reason, "crash_recovery_cancelled");
  assert.equal(metadata.priorStatus, "running");
  assert.equal(typeof metadata.autoCancelledAt, "string");
  assert.equal(metadata.autoCancelledAtMs, nowMs);

  // Verifiser at snapshot parametere
  const snapshotParam = auditQuery!.params[4] as string;
  const snapshot = JSON.parse(snapshotParam);
  assert.equal(snapshot["hall-1"].isReady, true);
  assert.equal(snapshot["hall-2"].isReady, false);
});

// ── Overdue paused ─────────────────────────────────────────────────────────

test("PR5 recovery: paused-rad > 2h over scheduled_end_time kanselleres også", async () => {
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  const overdueRow = scheduledRow({
    id: "g-paused",
    status: "paused",
    scheduled_end_time: new Date("2026-04-21T09:00:00Z"), // 3h før now
  });
  const { pool } = createStubPool([
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_scheduled_games\""),
      rows: [overdueRow],
    },
    { match: (sql) => sql.trim() === "BEGIN", rows: [] },
    {
      match: (sql) => sql.includes("UPDATE \"public\".\"app_game1_scheduled_games\""),
      rows: [{ id: "g-paused", status: "cancelled" }],
    },
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_hall_ready_status\""),
      rows: [],
    },
    {
      match: (sql) => sql.includes("INSERT INTO \"public\".\"app_game1_master_audit\""),
      rows: [],
    },
    { match: (sql) => sql.trim() === "COMMIT", rows: [] },
  ]);
  const service = Game1RecoveryService.forTesting(pool as never);
  const result = await service.runRecoveryPass(nowMs);
  assert.equal(result.cancelled, 1);
  assert.deepEqual(result.cancelledGameIds, ["g-paused"]);
});

// ── Innenfor vinduet (preserved) ────────────────────────────────────────────

test("PR5 recovery: running-rad innenfor 2h-vinduet rørs ikke", async () => {
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  // scheduled_end_time akkurat 1h siden → innenfor 2h-vinduet
  const recentRow = scheduledRow({
    id: "g-recent",
    status: "running",
    scheduled_end_time: new Date("2026-04-21T11:00:00Z"),
  });
  const { pool, queries } = createStubPool([
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_scheduled_games\""),
      rows: [recentRow],
    },
  ]);
  const service = Game1RecoveryService.forTesting(pool as never);
  const result = await service.runRecoveryPass(nowMs);
  assert.equal(result.inspected, 1);
  assert.equal(result.cancelled, 0);
  assert.equal(result.preserved, 1);
  assert.deepEqual(result.preservedGameIds, ["g-recent"]);

  // Ingen UPDATE skal ha blitt sendt
  assert.ok(
    !queries.some((q) => q.sql.includes("SET status          = 'cancelled'")),
    "UPDATE må ikke sendes for rad innenfor vinduet",
  );
});

test("PR5 recovery: paused-rad innenfor vinduet rørs ikke", async () => {
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  const pausedRow = scheduledRow({
    id: "g-paused-ok",
    status: "paused",
    scheduled_end_time: new Date("2026-04-21T13:00:00Z"), // 1h i framtiden
  });
  const { pool } = createStubPool([
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_scheduled_games\""),
      rows: [pausedRow],
    },
  ]);
  const service = Game1RecoveryService.forTesting(pool as never);
  const result = await service.runRecoveryPass(nowMs);
  assert.equal(result.preserved, 1);
  assert.deepEqual(result.preservedGameIds, ["g-paused-ok"]);
});

// ── Blandet sett ────────────────────────────────────────────────────────────

test("PR5 recovery: blandet sett — overdue cancel + recent preserve i samme pass", async () => {
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  const overdue = scheduledRow({
    id: "g-overdue",
    status: "running",
    scheduled_end_time: new Date("2026-04-20T01:00:00Z"),
  });
  const recent = scheduledRow({
    id: "g-recent",
    status: "running",
    scheduled_end_time: new Date("2026-04-21T11:30:00Z"),
  });
  // Responsene må dekke full recovery-cycle for overdue + simpel SELECT for recent.
  const { pool } = createStubPool([
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_scheduled_games\""),
      rows: [overdue, recent],
    },
    { match: (sql) => sql.trim() === "BEGIN", rows: [] },
    {
      match: (sql) => sql.includes("UPDATE \"public\".\"app_game1_scheduled_games\""),
      rows: [{ id: "g-overdue", status: "cancelled" }],
    },
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_hall_ready_status\""),
      rows: [],
    },
    {
      match: (sql) => sql.includes("INSERT INTO \"public\".\"app_game1_master_audit\""),
      rows: [],
    },
    { match: (sql) => sql.trim() === "COMMIT", rows: [] },
  ]);
  const service = Game1RecoveryService.forTesting(pool as never);
  const result = await service.runRecoveryPass(nowMs);
  assert.equal(result.inspected, 2);
  assert.equal(result.cancelled, 1);
  assert.equal(result.preserved, 1);
  assert.deepEqual(result.cancelledGameIds, ["g-overdue"]);
  assert.deepEqual(result.preservedGameIds, ["g-recent"]);
});

// ── Feil i en rad stopper ikke resten ──────────────────────────────────────

test("PR5 recovery: feil i én rad stopper ikke resten", async () => {
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  const bad = scheduledRow({
    id: "g-bad",
    status: "running",
    scheduled_end_time: new Date("2026-04-20T01:00:00Z"),
  });
  const good = scheduledRow({
    id: "g-good",
    status: "paused",
    scheduled_end_time: new Date("2026-04-20T02:00:00Z"),
  });

  // Konstruér en pool der første overdue-UPDATE kaster, men den andre lykkes.
  const queries: RecordedQuery[] = [];
  let updateCallCount = 0;
  const poolLike = {
    connect: async () => ({
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        if (sql.trim() === "BEGIN") return { rows: [], rowCount: 0 };
        if (sql.includes("UPDATE \"public\".\"app_game1_scheduled_games\"")) {
          updateCallCount += 1;
          if (updateCallCount === 1) {
            throw new Error("simulated DB error on first UPDATE");
          }
          return {
            rows: [{ id: params[0], status: "cancelled" }],
            rowCount: 1,
          };
        }
        if (sql.includes("FROM \"public\".\"app_game1_hall_ready_status\"")) {
          return { rows: [], rowCount: 0 };
        }
        if (sql.includes("INSERT INTO \"public\".\"app_game1_master_audit\"")) {
          return { rows: [], rowCount: 1 };
        }
        if (sql.trim() === "COMMIT" || sql.trim() === "ROLLBACK") {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => undefined,
    }),
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (sql.includes("FROM \"public\".\"app_game1_scheduled_games\"")) {
        return { rows: [bad, good], rowCount: 2 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const service = Game1RecoveryService.forTesting(poolLike as never);
  const result = await service.runRecoveryPass(nowMs);

  assert.equal(result.inspected, 2);
  assert.equal(result.cancelled, 1, "good-rad skal kanselleres selv om bad feiler");
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]!.gameId, "g-bad");
  assert.deepEqual(result.cancelledGameIds, ["g-good"]);
});

// ── Race: en annen prosess har flyttet raden mellom SELECT og UPDATE ───────

test("PR5 recovery: UPDATE returnerer 0 rader → rollback, ingen feil", async () => {
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  const raced = scheduledRow({
    id: "g-raced",
    status: "running",
    scheduled_end_time: new Date("2026-04-20T01:00:00Z"),
  });
  const { pool } = createStubPool([
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_scheduled_games\""),
      rows: [raced],
    },
    { match: (sql) => sql.trim() === "BEGIN", rows: [] },
    {
      match: (sql) => sql.includes("UPDATE \"public\".\"app_game1_scheduled_games\""),
      rows: [], // 0 rader returnert — race
    },
    { match: (sql) => sql.trim() === "ROLLBACK", rows: [] },
  ]);
  const service = Game1RecoveryService.forTesting(pool as never);
  const result = await service.runRecoveryPass(nowMs);
  assert.equal(result.cancelled, 0, "raced rad skal ikke telles som cancelled");
  assert.equal(result.failures.length, 0, "ingen feil ved race");
});

// ── Audit-funn 2026-04-25: dato-parsing + custom window ────────────────────

test("PR5 recovery: scheduled_end_time som ISO-string parsed korrekt", async () => {
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  // Simuler at pg returnerer dato som string (ikke Date) — vanlig
  // for noen pg-konfigurasjoner.
  const overdueRow = scheduledRow({
    id: "g-string-date",
    status: "running",
    scheduled_end_time: "2026-04-20T01:00:00.000Z",
  });
  const { pool } = createStubPool([
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_scheduled_games\""),
      rows: [overdueRow],
    },
    { match: (sql) => sql.trim() === "BEGIN", rows: [] },
    {
      match: (sql) => sql.includes("UPDATE \"public\".\"app_game1_scheduled_games\""),
      rows: [{ id: "g-string-date", status: "cancelled" }],
    },
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_hall_ready_status\""),
      rows: [],
    },
    {
      match: (sql) => sql.includes("INSERT INTO \"public\".\"app_game1_master_audit\""),
      rows: [],
    },
    { match: (sql) => sql.trim() === "COMMIT", rows: [] },
  ]);
  const service = Game1RecoveryService.forTesting(pool as never);
  const result = await service.runRecoveryPass(nowMs);
  assert.equal(result.cancelled, 1, "ISO-string dato parsed og kansellert");
  assert.deepEqual(result.cancelledGameIds, ["g-string-date"]);
});

test("PR5 recovery: ugyldig dato-string → preserved (NaN-finite-guard)", async () => {
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  // Hvis Date.parse gir NaN (f.eks. korrupt dato i DB), service skal ikke
  // kansellere — fail-closed.
  const corruptRow = scheduledRow({
    id: "g-corrupt",
    status: "running",
    scheduled_end_time: "ikke-en-dato",
  });
  const { pool } = createStubPool([
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_scheduled_games\""),
      rows: [corruptRow],
    },
  ]);
  const service = Game1RecoveryService.forTesting(pool as never);
  const result = await service.runRecoveryPass(nowMs);
  assert.equal(result.cancelled, 0, "korrupt dato skal IKKE kansellere");
  assert.equal(result.preserved, 1, "korrupt dato → preserved (operatør må undersøke)");
});

test("PR5 recovery: custom maxRunningWindowMs respekteres", async () => {
  // Service tar maxRunningWindowMs i konstruksjon (default 2t).
  // Locker at custom window-verdier brukes korrekt.
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  // Game ble ferdig 30 min siden — innenfor default 2t-vindu.
  const recentRow = scheduledRow({
    id: "g-recent",
    status: "running",
    scheduled_end_time: new Date("2026-04-21T11:30:00Z"),
  });

  // Test 1: med default 2h window → preserved.
  {
    const { pool } = createStubPool([
      {
        match: (sql) => sql.includes("FROM \"public\".\"app_game1_scheduled_games\""),
        rows: [recentRow],
      },
    ]);
    const service = Game1RecoveryService.forTesting(pool as never);
    const result = await service.runRecoveryPass(nowMs);
    assert.equal(result.preserved, 1, "default 2h: rad innenfor vindu preserved");
  }

  // Test 2: med custom 10-min window → 30 min siden er overdue.
  {
    const { pool } = createStubPool([
      {
        match: (sql) => sql.includes("FROM \"public\".\"app_game1_scheduled_games\""),
        rows: [recentRow],
      },
      { match: (sql) => sql.trim() === "BEGIN", rows: [] },
      {
        match: (sql) => sql.includes("UPDATE \"public\".\"app_game1_scheduled_games\""),
        rows: [{ id: "g-recent", status: "cancelled" }],
      },
      {
        match: (sql) => sql.includes("FROM \"public\".\"app_game1_hall_ready_status\""),
        rows: [],
      },
      {
        match: (sql) => sql.includes("INSERT INTO \"public\".\"app_game1_master_audit\""),
        rows: [],
      },
      { match: (sql) => sql.trim() === "COMMIT", rows: [] },
    ]);
    const service = Game1RecoveryService.forTesting(pool as never, {
      maxRunningWindowMs: 10 * 60 * 1000, // 10 min
    });
    const result = await service.runRecoveryPass(nowMs);
    assert.equal(result.cancelled, 1, "custom 10-min: rad overdue → kansellert");
  }
});

test("PR5 recovery: konstruksjon avviser negativ maxRunningWindowMs", () => {
  const { pool } = createStubPool();
  for (const bad of [-1, -1000, NaN]) {
    assert.throws(
      () =>
        new Game1RecoveryService({
          pool: pool as never,
          maxRunningWindowMs: bad,
        }),
      (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG",
      `maxRunningWindowMs=${bad} skal avvises`,
    );
  }
});

test("PR5 recovery: konstruksjon avviser Infinity maxRunningWindowMs", () => {
  // Number.isFinite-guard fanger Infinity (ellers ville cutoff bli
  // -Infinity og INGENTING bli kansellert).
  const { pool } = createStubPool();
  assert.throws(
    () =>
      new Game1RecoveryService({
        pool: pool as never,
        maxRunningWindowMs: Infinity,
      }),
    (err: unknown) => err instanceof DomainError && err.code === "INVALID_CONFIG",
  );
});

test("PR5 recovery: maxRunningWindowMs flooret til heltall (3.7 → 3)", () => {
  // Service har Math.floor i konstruktør — ms-verdier skal være heltall.
  const { pool } = createStubPool();
  // Skal ikke kaste — verdier > 0 godtas, floor til heltall.
  assert.doesNotThrow(
    () =>
      new Game1RecoveryService({
        pool: pool as never,
        maxRunningWindowMs: 3.7,
      }),
  );
});

test("PR5 recovery: tom hall-ready-snapshot → tom audit-metadata (defaults)", async () => {
  // Game har ingen hall-ready-rader (helt nytt spill) — snapshotReadyRows
  // returnerer tomt object.
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  const overdueRow = scheduledRow({
    id: "g-no-halls",
    status: "running",
    scheduled_end_time: new Date("2026-04-20T01:00:00Z"),
  });
  const { pool, queries } = createStubPool([
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_scheduled_games\""),
      rows: [overdueRow],
    },
    { match: (sql) => sql.trim() === "BEGIN", rows: [] },
    {
      match: (sql) => sql.includes("UPDATE \"public\".\"app_game1_scheduled_games\""),
      rows: [{ id: "g-no-halls", status: "cancelled" }],
    },
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_hall_ready_status\""),
      rows: [],
    },
    {
      match: (sql) => sql.includes("INSERT INTO \"public\".\"app_game1_master_audit\""),
      rows: [],
    },
    { match: (sql) => sql.trim() === "COMMIT", rows: [] },
  ]);
  const service = Game1RecoveryService.forTesting(pool as never);
  await service.runRecoveryPass(nowMs);

  const auditQuery = queries.find((q) =>
    q.sql.includes("INSERT INTO \"public\".\"app_game1_master_audit\""),
  );
  assert.ok(auditQuery);
  // Snapshot-param skal være tom JSONB-object.
  const snapshot = JSON.parse(auditQuery!.params[4] as string);
  assert.deepEqual(snapshot, {}, "tom hall-snapshot → {}");
});

test("PR5 recovery: 0 inspected, 0 failures returnerer tomt resultat-objekt", async () => {
  // Bekreft at serviceren ikke krasjer på fall-trough-stier (alle queries
  // returnerer tom).
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  const { pool } = createStubPool([]);
  const service = Game1RecoveryService.forTesting(pool as never);
  const result = await service.runRecoveryPass(nowMs);
  assert.deepEqual(result, {
    inspected: 0,
    cancelled: 0,
    preserved: 0,
    failures: [],
    cancelledGameIds: [],
    preservedGameIds: [],
  });
});

test("PR5 recovery: master_hall_id + group_hall_id propageres til audit-INSERT", async () => {
  const nowMs = Date.parse("2026-04-21T12:00:00Z");
  const overdueRow = scheduledRow({
    id: "g-multihall",
    status: "running",
    master_hall_id: "hall-master-12",
    group_hall_id: "grp-bingo-east",
    scheduled_end_time: new Date("2026-04-20T01:00:00Z"),
  });
  const { pool, queries } = createStubPool([
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_scheduled_games\""),
      rows: [overdueRow],
    },
    { match: (sql) => sql.trim() === "BEGIN", rows: [] },
    {
      match: (sql) => sql.includes("UPDATE \"public\".\"app_game1_scheduled_games\""),
      rows: [{ id: "g-multihall", status: "cancelled" }],
    },
    {
      match: (sql) => sql.includes("FROM \"public\".\"app_game1_hall_ready_status\""),
      rows: [],
    },
    {
      match: (sql) => sql.includes("INSERT INTO \"public\".\"app_game1_master_audit\""),
      rows: [],
    },
    { match: (sql) => sql.trim() === "COMMIT", rows: [] },
  ]);
  const service = Game1RecoveryService.forTesting(pool as never);
  await service.runRecoveryPass(nowMs);

  const auditQuery = queries.find((q) =>
    q.sql.includes("INSERT INTO \"public\".\"app_game1_master_audit\""),
  );
  assert.ok(auditQuery);
  // Params shape per writeAudit: [auditId, gameId, actorHallId, groupHallId, snapshot, metadata]
  assert.equal(auditQuery!.params[1], "g-multihall");
  assert.equal(auditQuery!.params[2], "hall-master-12", "actor_hall_id = master");
  assert.equal(auditQuery!.params[3], "grp-bingo-east", "group_hall_id = group");
});
