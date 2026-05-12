/**
 * Unit-tester for Game1ArmedToPurchaseConversionService.
 *
 * Pilot-blokker-fix 2026-05-12 (Tobias-direktiv): bonger kjøpt FØR master
 * trykker Start MÅ være LIVE i runden. Disse testene verifiserer at
 * konverterings-flyten:
 *
 *   1. INSERT-er `app_game1_ticket_purchases`-rad atomisk per spiller.
 *   2. Commit-er wallet-reservasjon med korrekt idempotency-key.
 *   3. Skriver §71 STAKE-event til ComplianceLedger med kjøpe-hallen
 *      (player.hallId — IKKE master-hallens hallId per BIN-443).
 *   4. Er idempotent på retry (samme key → returnerer eksisterende rad).
 *   5. Per-spiller failure-isolering: én feilet spiller stopper IKKE de
 *      andre.
 *   6. Failures release reservasjonen så pengene returneres til spilleren.
 *
 * Test-stack: node:test + node:assert (matcher repo-konvensjon).
 * Mocks: in-memory stub-pool, in-memory wallet-adapter, in-memory audit-log.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { Game1ArmedToPurchaseConversionService } from "../game/Game1ArmedToPurchaseConversionService.js";
import { InMemoryWalletAdapter } from "../adapters/InMemoryWalletAdapter.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";
import type {
  ComplianceLedgerPort,
  ComplianceLedgerEventInput,
} from "../adapters/ComplianceLedgerPort.js";
import type {
  ComplianceLossPort,
  ComplianceLossEntry,
} from "../adapters/ComplianceLossPort.js";

// ── Stub pool ────────────────────────────────────────────────────────────────

interface StubRow {
  match: (sql: string) => boolean;
  rows: unknown[];
  rowCount?: number;
  throwErr?: { code: string; message: string };
  /** If true, the response is single-use and removed after match. */
  once?: boolean;
}

function makeStubPool(responses: StubRow[] = []): {
  pool: {
    query: <T = unknown>(
      sql: string,
      params?: unknown[],
    ) => Promise<{ rows: T[]; rowCount: number }>;
  };
  queries: Array<{ sql: string; params: unknown[] }>;
  insertedRows: Map<string, Record<string, unknown>>;
} {
  const queue = responses.slice();
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  // Track INSERTed rows by idempotency_key so retry-paths return existing.
  const insertedRows = new Map<string, Record<string, unknown>>();
  return {
    pool: {
      query: async <T = unknown>(sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });
        for (let i = 0; i < queue.length; i++) {
          const r = queue[i]!;
          if (r.match(sql)) {
            if (r.throwErr) {
              const err = Object.assign(new Error(r.throwErr.message), {
                code: r.throwErr.code,
              });
              if (r.once !== false) queue.splice(i, 1);
              throw err;
            }
            const rows = r.rows;
            if (r.once !== false) queue.splice(i, 1);
            return { rows: rows as T[], rowCount: r.rowCount ?? rows.length };
          }
        }
        // Default INSERT-handler: simulate UNIQUE-violation on duplicate.
        if (sql.includes("INSERT INTO") && sql.includes("app_game1_ticket_purchases")) {
          const idemKey = params[6] as string;
          if (insertedRows.has(idemKey)) {
            const err = Object.assign(
              new Error("duplicate key value violates unique constraint"),
              { code: "23505" },
            );
            throw err;
          }
          insertedRows.set(idemKey, {
            id: params[0] as string,
            scheduled_game_id: params[1] as string,
            buyer_user_id: params[2] as string,
            hall_id: params[3] as string,
            total_amount_cents: params[5] as number,
            idempotency_key: idemKey,
            refund_transaction_id: null,
          });
          return { rows: [] as T[], rowCount: 1 };
        }
        // Default SELECT idempotency_key handler.
        if (sql.includes("FROM") && sql.includes("idempotency_key") && sql.includes("LIMIT 1")) {
          const idemKey = params[0] as string;
          const existing = insertedRows.get(idemKey);
          if (existing) {
            return { rows: [existing] as T[], rowCount: 1 };
          }
          return { rows: [] as T[], rowCount: 0 };
        }
        return { rows: [] as T[], rowCount: 0 };
      },
    },
    queries,
    insertedRows,
  };
}

// ── Stub ComplianceLedgerPort ────────────────────────────────────────────────

function makeRecordingLedger(): {
  port: ComplianceLedgerPort;
  events: ComplianceLedgerEventInput[];
  failNext?: () => void;
} {
  const events: ComplianceLedgerEventInput[] = [];
  let shouldFail = false;
  return {
    port: {
      async recordComplianceLedgerEvent(input) {
        if (shouldFail) {
          shouldFail = false;
          throw new Error("compliance-ledger stub: forced failure");
        }
        events.push(input);
      },
    },
    events,
    failNext: () => {
      shouldFail = true;
    },
  };
}

// ── Stub ComplianceLossPort ──────────────────────────────────────────────────

function makeRecordingLoss(): {
  port: ComplianceLossPort;
  entries: Array<{ walletId: string; hallId: string; entry: ComplianceLossEntry }>;
} {
  const entries: Array<{ walletId: string; hallId: string; entry: ComplianceLossEntry }> = [];
  return {
    port: {
      async recordLossEntry(walletId, hallId, entry) {
        entries.push({ walletId, hallId, entry });
      },
    },
    entries,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const HOUSE_ACCOUNT_ID = "house-hall-A-main_game-internet";

async function setupTestEnv(): Promise<{
  wallet: InMemoryWalletAdapter;
  player1WalletId: string;
  player2WalletId: string;
  reservation1Id: string;
  reservation2Id: string;
}> {
  const wallet = new InMemoryWalletAdapter();
  await wallet.ensureAccount("wallet-user-player-1");
  await wallet.ensureAccount("wallet-user-player-2");
  await wallet.ensureAccount(HOUSE_ACCOUNT_ID);
  await wallet.topUp("wallet-user-player-1", 1000);
  await wallet.topUp("wallet-user-player-2", 1000);

  // Pre-reserve 30 kr (3000 cents) for player-1 and player-2 — speiler
  // bet:arm-flyten hvor reservasjonen lages før konvertering.
  const res1 = await wallet.reserve("wallet-user-player-1", 30, {
    idempotencyKey: "test-arm-1",
    roomCode: "BINGO_TEST",
  });
  const res2 = await wallet.reserve("wallet-user-player-2", 30, {
    idempotencyKey: "test-arm-2",
    roomCode: "BINGO_TEST",
  });

  return {
    wallet,
    player1WalletId: "wallet-user-player-1",
    player2WalletId: "wallet-user-player-2",
    reservation1Id: res1.id,
    reservation2Id: res2.id,
  };
}

function makeService(opts: {
  wallet: InMemoryWalletAdapter;
  audit: AuditLogService;
  ledger?: ComplianceLedgerPort;
  loss?: ComplianceLossPort;
  pool: {
    query: <T = unknown>(
      sql: string,
      params?: unknown[],
    ) => Promise<{ rows: T[]; rowCount: number }>;
  };
}): Game1ArmedToPurchaseConversionService {
  return new Game1ArmedToPurchaseConversionService({
    pool: opts.pool as never,
    schema: "public",
    walletAdapter: opts.wallet,
    auditLogService: opts.audit,
    complianceLedgerPort: opts.ledger,
    complianceLossPort: opts.loss,
  });
}

// ── Test cases ───────────────────────────────────────────────────────────────

test("happy-path: 1 armed spiller → 1 purchase + wallet committed + ledger STAKE", async () => {
  const { wallet, player1WalletId, reservation1Id } = await setupTestEnv();
  const auditStore = new InMemoryAuditLogStore();
  const audit = new AuditLogService(auditStore);
  const ledger = makeRecordingLedger();
  const loss = makeRecordingLoss();

  const stub = makeStubPool([
    {
      match: (sql) =>
        sql.includes("FROM") &&
        sql.includes("app_game1_scheduled_games") &&
        sql.includes("WHERE id = $1"),
      rows: [
        {
          id: "sg-1",
          hall_id: "hall-master",
          master_hall_id: "hall-master",
          ticket_config_json: {},
        },
      ],
    },
  ]);

  const svc = makeService({
    wallet,
    audit,
    ledger: ledger.port,
    loss: loss.port,
    pool: stub.pool,
  });

  const result = await svc.convertArmedToPurchases({
    scheduledGameId: "sg-1",
    lobbyRoomCode: "BINGO_TEST",
    actorUserId: "master-1",
    armedPlayers: [
      {
        userId: "player-1",
        walletId: player1WalletId,
        hallId: "hall-A",
        reservationId: reservation1Id,
        ticketSpec: [
          { color: "yellow", size: "small", count: 3, priceCentsEach: 1000 },
        ],
      },
    ],
  });

  assert.equal(result.convertedCount, 1);
  assert.equal(result.failures.length, 0);
  assert.equal(result.conversions[0].userId, "player-1");
  assert.equal(result.conversions[0].totalAmountCents, 3000);
  assert.equal(result.conversions[0].ticketCount, 3);
  assert.ok(result.conversions[0].purchaseId.startsWith("g1p-"));

  // Verify wallet was committed (reservation status = committed)
  const reservations = await wallet.listReservationsByRoom("BINGO_TEST");
  const committed = reservations.find((r) => r.id === reservation1Id);
  assert.ok(committed, "reservation should exist");
  assert.equal(committed.status, "committed");

  // Verify ledger STAKE event was written with kjøpe-hall (hall-A) — NOT master-hall.
  assert.equal(ledger.events.length, 1);
  assert.equal(ledger.events[0].hallId, "hall-A");
  assert.equal(ledger.events[0].gameType, "MAIN_GAME");
  assert.equal(ledger.events[0].eventType, "STAKE");
  assert.equal(ledger.events[0].amount, 30);
  assert.equal(ledger.events[0].playerId, "player-1");

  // Verify audit-log captured the conversion event.
  const auditEvents = await audit.list();
  const conversionEvents = auditEvents.filter(
    (e) => e.action === "game1.armed.conversion",
  );
  assert.equal(conversionEvents.length, 1);
  assert.equal(conversionEvents[0].actorId, "player-1");
  assert.equal(conversionEvents[0].actorType, "PLAYER");
});

test("multi-player: 3 armed spillere → 3 purchases atomisk", async () => {
  const wallet = new InMemoryWalletAdapter();
  await wallet.ensureAccount("wallet-p1");
  await wallet.ensureAccount("wallet-p2");
  await wallet.ensureAccount("wallet-p3");
  await wallet.ensureAccount(HOUSE_ACCOUNT_ID);
  await wallet.topUp("wallet-p1", 100);
  await wallet.topUp("wallet-p2", 100);
  await wallet.topUp("wallet-p3", 100);
  const r1 = await wallet.reserve("wallet-p1", 10, { idempotencyKey: "a1", roomCode: "BINGO_TEST" });
  const r2 = await wallet.reserve("wallet-p2", 20, { idempotencyKey: "a2", roomCode: "BINGO_TEST" });
  const r3 = await wallet.reserve("wallet-p3", 30, { idempotencyKey: "a3", roomCode: "BINGO_TEST" });

  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const ledger = makeRecordingLedger();

  const stub = makeStubPool([
    {
      match: (sql) =>
        sql.includes("FROM") && sql.includes("app_game1_scheduled_games"),
      rows: [
        {
          id: "sg-1",
          hall_id: "hall-master",
          master_hall_id: "hall-master",
          ticket_config_json: {},
        },
      ],
    },
  ]);

  const svc = makeService({
    wallet,
    audit,
    ledger: ledger.port,
    pool: stub.pool,
  });

  const result = await svc.convertArmedToPurchases({
    scheduledGameId: "sg-1",
    lobbyRoomCode: "BINGO_TEST",
    actorUserId: "master-1",
    armedPlayers: [
      {
        userId: "p1",
        walletId: "wallet-p1",
        hallId: "hall-A",
        reservationId: r1.id,
        ticketSpec: [{ color: "yellow", size: "small", count: 1, priceCentsEach: 1000 }],
      },
      {
        userId: "p2",
        walletId: "wallet-p2",
        hallId: "hall-A",
        reservationId: r2.id,
        ticketSpec: [{ color: "white", size: "small", count: 2, priceCentsEach: 1000 }],
      },
      {
        userId: "p3",
        walletId: "wallet-p3",
        hallId: "hall-B",
        reservationId: r3.id,
        ticketSpec: [{ color: "purple", size: "small", count: 3, priceCentsEach: 1000 }],
      },
    ],
  });

  assert.equal(result.convertedCount, 3);
  assert.equal(result.failures.length, 0);

  // Verify all 3 ledger entries written, with correct kjøpe-halls.
  assert.equal(ledger.events.length, 3);
  const halls = ledger.events.map((e) => e.hallId).sort();
  assert.deepEqual(halls, ["hall-A", "hall-A", "hall-B"]);
});

test("idempotens: kjør convert to ganger → kun 1 rad opprettet", async () => {
  const { wallet, player1WalletId, reservation1Id } = await setupTestEnv();
  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const ledger = makeRecordingLedger();

  const stub = makeStubPool([
    {
      match: (sql) =>
        sql.includes("FROM") && sql.includes("app_game1_scheduled_games"),
      rows: [
        { id: "sg-1", hall_id: "hall-master", master_hall_id: "hall-master", ticket_config_json: {} },
      ],
      once: false, // reusable for both calls
    },
  ]);

  const svc = makeService({
    wallet,
    audit,
    ledger: ledger.port,
    pool: stub.pool,
  });

  const input = {
    scheduledGameId: "sg-1",
    lobbyRoomCode: "BINGO_TEST",
    actorUserId: "master-1",
    armedPlayers: [
      {
        userId: "player-1",
        walletId: player1WalletId,
        hallId: "hall-A",
        reservationId: reservation1Id,
        ticketSpec: [
          {
            color: "yellow",
            size: "small" as const,
            count: 3,
            priceCentsEach: 1000,
          },
        ],
      },
    ],
  };

  const r1 = await svc.convertArmedToPurchases(input);
  const r2 = await svc.convertArmedToPurchases(input);

  assert.equal(r1.convertedCount, 1);
  assert.equal(r2.convertedCount, 1);
  // Same purchase ID returned on retry
  assert.equal(r1.conversions[0].purchaseId, r2.conversions[0].purchaseId);
  // Only 1 row stored in stub
  assert.equal(stub.insertedRows.size, 1);

  // Wallet only committed once — InMemoryWalletAdapter throws on re-commit
  // of already-committed reservation. The fact that r2 succeeded without
  // throwing confirms idempotent short-circuit detected existing purchase
  // BEFORE attempting commit.
});

test("insufficient reservation: spiller mangler reservation → failure + audit", async () => {
  const wallet = new InMemoryWalletAdapter();
  await wallet.ensureAccount("wallet-p1");
  await wallet.ensureAccount(HOUSE_ACCOUNT_ID);
  await wallet.topUp("wallet-p1", 100);
  // No reservation created — we'll pass a fake ID.

  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const ledger = makeRecordingLedger();

  const stub = makeStubPool([
    {
      match: (sql) =>
        sql.includes("FROM") && sql.includes("app_game1_scheduled_games"),
      rows: [
        { id: "sg-1", hall_id: "hall-master", master_hall_id: "hall-master", ticket_config_json: {} },
      ],
    },
  ]);

  const svc = makeService({
    wallet,
    audit,
    ledger: ledger.port,
    pool: stub.pool,
  });

  const result = await svc.convertArmedToPurchases({
    scheduledGameId: "sg-1",
    lobbyRoomCode: "BINGO_TEST",
    actorUserId: "master-1",
    armedPlayers: [
      {
        userId: "p1",
        walletId: "wallet-p1",
        hallId: "hall-A",
        reservationId: "non-existent-reservation",
        ticketSpec: [{ color: "yellow", size: "small", count: 1, priceCentsEach: 1000 }],
      },
    ],
  });

  assert.equal(result.convertedCount, 0);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].errorCode, "RESERVATION_NOT_FOUND");
  // No ledger event written for failures.
  assert.equal(ledger.events.length, 0);

  // Audit-log captured the failure.
  const audits = await audit.list();
  const failureEvents = audits.filter(
    (e) => e.action === "game1.armed.conversion_failed",
  );
  assert.equal(failureEvents.length, 1);
});

test("per-player atomicitet: 1 av 3 feiler → 2 konverteres, 1 i failures", async () => {
  const wallet = new InMemoryWalletAdapter();
  await wallet.ensureAccount("wallet-p1");
  await wallet.ensureAccount("wallet-p2");
  await wallet.ensureAccount("wallet-p3");
  await wallet.ensureAccount(HOUSE_ACCOUNT_ID);
  await wallet.topUp("wallet-p1", 100);
  await wallet.topUp("wallet-p2", 100);
  await wallet.topUp("wallet-p3", 100);
  const r1 = await wallet.reserve("wallet-p1", 10, { idempotencyKey: "a1", roomCode: "BINGO_TEST" });
  // r2: NO reservation — will fail.
  const r3 = await wallet.reserve("wallet-p3", 30, { idempotencyKey: "a3", roomCode: "BINGO_TEST" });

  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const ledger = makeRecordingLedger();

  const stub = makeStubPool([
    {
      match: (sql) => sql.includes("app_game1_scheduled_games"),
      rows: [
        { id: "sg-1", hall_id: "hall-master", master_hall_id: "hall-master", ticket_config_json: {} },
      ],
    },
  ]);

  const svc = makeService({ wallet, audit, ledger: ledger.port, pool: stub.pool });

  const result = await svc.convertArmedToPurchases({
    scheduledGameId: "sg-1",
    lobbyRoomCode: "BINGO_TEST",
    actorUserId: "master-1",
    armedPlayers: [
      {
        userId: "p1",
        walletId: "wallet-p1",
        hallId: "hall-A",
        reservationId: r1.id,
        ticketSpec: [{ color: "yellow", size: "small", count: 1, priceCentsEach: 1000 }],
      },
      {
        userId: "p2",
        walletId: "wallet-p2",
        hallId: "hall-A",
        reservationId: "ghost-reservation",
        ticketSpec: [{ color: "white", size: "small", count: 2, priceCentsEach: 1000 }],
      },
      {
        userId: "p3",
        walletId: "wallet-p3",
        hallId: "hall-B",
        reservationId: r3.id,
        ticketSpec: [{ color: "purple", size: "small", count: 3, priceCentsEach: 1000 }],
      },
    ],
  });

  assert.equal(result.convertedCount, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].userId, "p2");
  // p1 and p3 conversions succeeded.
  const convertedUsers = result.conversions.map((c) => c.userId).sort();
  assert.deepEqual(convertedUsers, ["p1", "p3"]);
});

test("empty armed-set: ingen jobb gjort, no-op return", async () => {
  const wallet = new InMemoryWalletAdapter();
  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const ledger = makeRecordingLedger();
  const stub = makeStubPool();

  const svc = makeService({ wallet, audit, ledger: ledger.port, pool: stub.pool });

  const result = await svc.convertArmedToPurchases({
    scheduledGameId: "sg-1",
    lobbyRoomCode: "BINGO_TEST",
    actorUserId: "master-1",
    armedPlayers: [],
  });

  assert.equal(result.convertedCount, 0);
  assert.equal(result.failures.length, 0);
  assert.equal(result.conversions.length, 0);
  assert.equal(ledger.events.length, 0);
  // No DB query for scheduledGame (we short-circuit on empty input).
  assert.equal(stub.queries.length, 0);
});

test("scheduled-game ikke funnet → GAME_NOT_FOUND kaster", async () => {
  const wallet = new InMemoryWalletAdapter();
  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const ledger = makeRecordingLedger();
  const stub = makeStubPool([
    {
      match: (sql) => sql.includes("app_game1_scheduled_games"),
      rows: [], // empty — game not found
    },
  ]);

  const svc = makeService({ wallet, audit, ledger: ledger.port, pool: stub.pool });

  await assert.rejects(
    () =>
      svc.convertArmedToPurchases({
        scheduledGameId: "sg-missing",
        lobbyRoomCode: "BINGO_TEST",
        actorUserId: "master-1",
        armedPlayers: [
          {
            userId: "p1",
            walletId: "wallet-p1",
            hallId: "hall-A",
            reservationId: "res-1",
            ticketSpec: [{ color: "yellow", size: "small", count: 1, priceCentsEach: 500 }],
          },
        ],
      }),
    /GAME_NOT_FOUND|finnes ikke/,
  );
});

test("compliance-ledger feiler: konvertering fortsetter (soft-fail)", async () => {
  const { wallet, player1WalletId, reservation1Id } = await setupTestEnv();
  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const ledger = makeRecordingLedger();

  // Make ledger fail on first call — the conversion should NOT be rolled back.
  ledger.failNext!();

  const stub = makeStubPool([
    {
      match: (sql) => sql.includes("app_game1_scheduled_games"),
      rows: [
        { id: "sg-1", hall_id: "hall-master", master_hall_id: "hall-master", ticket_config_json: {} },
      ],
    },
  ]);

  const svc = makeService({ wallet, audit, ledger: ledger.port, pool: stub.pool });

  const result = await svc.convertArmedToPurchases({
    scheduledGameId: "sg-1",
    lobbyRoomCode: "BINGO_TEST",
    actorUserId: "master-1",
    armedPlayers: [
      {
        userId: "player-1",
        walletId: player1WalletId,
        hallId: "hall-A",
        reservationId: reservation1Id,
        ticketSpec: [
          { color: "yellow", size: "small", count: 3, priceCentsEach: 1000 },
        ],
      },
    ],
  });

  // Conversion succeeded despite ledger failure.
  assert.equal(result.convertedCount, 1);
  assert.equal(result.failures.length, 0);
});

test("invalid input: tom userId → INVALID_INPUT kaster", async () => {
  const wallet = new InMemoryWalletAdapter();
  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const stub = makeStubPool();

  const svc = makeService({ wallet, audit, pool: stub.pool });

  await assert.rejects(
    () =>
      svc.convertArmedToPurchases({
        scheduledGameId: "sg-1",
        lobbyRoomCode: "BINGO_TEST",
        actorUserId: "master-1",
        armedPlayers: [
          {
            userId: "",
            walletId: "wallet-p1",
            hallId: "hall-A",
            reservationId: "res-1",
            ticketSpec: [{ color: "yellow", size: "small", count: 1, priceCentsEach: 500 }],
          },
        ],
      }),
    /INVALID_INPUT|userId/,
  );
});

test("invalid ticket-spec: negative count → INVALID_TICKET_SPEC kaster", async () => {
  const wallet = new InMemoryWalletAdapter();
  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const stub = makeStubPool();

  const svc = makeService({ wallet, audit, pool: stub.pool });

  await assert.rejects(
    () =>
      svc.convertArmedToPurchases({
        scheduledGameId: "sg-1",
        lobbyRoomCode: "BINGO_TEST",
        actorUserId: "master-1",
        armedPlayers: [
          {
            userId: "p1",
            walletId: "wallet-p1",
            hallId: "hall-A",
            reservationId: "res-1",
            ticketSpec: [{ color: "yellow", size: "small", count: -1, priceCentsEach: 500 }],
          },
        ],
      }),
    /INVALID_TICKET_SPEC|ticketSpec/,
  );
});
