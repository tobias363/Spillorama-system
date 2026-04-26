/**
 * K1 compliance-fix: ComplianceLedger STAKE-tester for Game1TicketPurchaseService.
 *
 * Verifiserer at `purchase()` kaller `complianceLedgerPort.recordComplianceLedgerEvent`
 * med KJØPE-HALLEN (input.hallId), IKKE master-hallen. Dette er en
 * regulatorisk fix for §71 pengespillforskriften — per-hall-rapport må
 * bindes til hallen hvor ticketen faktisk ble solgt, uavhengig av hvem
 * som er master i multi-hall-runden.
 *
 * Test-matrise:
 *   1) Single-hall (master = kjøpe-hall): entry får hallId = hall-a (bakoverkompat).
 *   2) Multi-hall, kjøp i hall-b mens master er hall-a: entry får hallId = hall-b.
 *   3) Multi-hall, kjøp i hall-c: entry får hallId = hall-c.
 *   4) digital_wallet → channel = INTERNET.
 *   5) cash_agent → channel = HALL.
 *   6) card_agent → channel = HALL.
 *   7) Port kaster → purchase lykkes (soft-fail).
 *   8) Konstruktør uten port → default Noop (ingen feil).
 *   9) Idempotency-hit → ingen ny entry.
 *
 * Relatert til `insertPurchaseRow` (lagret hall_id = input.hallId) slik at
 * ledger + purchase-row er koherente: begge peker til kjøpe-hallen.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Game1TicketPurchaseService } from "./Game1TicketPurchaseService.js";
import { InMemoryWalletAdapter } from "../adapters/InMemoryWalletAdapter.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";
import type { Game1HallReadyService } from "./Game1HallReadyService.js";
import type { PlatformService } from "../platform/PlatformService.js";
import type {
  ComplianceLedgerEventInput,
  ComplianceLedgerPort,
} from "../adapters/ComplianceLedgerPort.js";

// ── Recording port ───────────────────────────────────────────────────────────

interface RecordedLedgerCall {
  input: ComplianceLedgerEventInput;
}

function makeRecordingPort(opts?: { throwOnStake?: boolean }): {
  port: ComplianceLedgerPort;
  calls: RecordedLedgerCall[];
} {
  const calls: RecordedLedgerCall[] = [];
  const port: ComplianceLedgerPort = {
    async recordComplianceLedgerEvent(input) {
      if (opts?.throwOnStake && input.eventType === "STAKE") {
        throw new Error("simulated ledger failure for STAKE");
      }
      calls.push({ input });
    },
  };
  return { port, calls };
}

// ── Stub-pool + fixtures ─────────────────────────────────────────────────────

interface StubResponse {
  match: (sql: string) => boolean;
  rows: unknown[];
  once?: boolean;
}

function createStubPool(responses: StubResponse[] = []): {
  pool: {
    query: (
      sql: string,
      params?: unknown[]
    ) => Promise<{ rows: unknown[]; rowCount: number }>;
  };
} {
  const queue = responses.slice();
  return {
    pool: {
      query: async (sql: string, _params: unknown[] = []) => {
        for (let i = 0; i < queue.length; i++) {
          const r = queue[i]!;
          if (r.match(sql)) {
            const rows = r.rows;
            if (r.once !== false) queue.splice(i, 1);
            return { rows, rowCount: rows.length };
          }
        }
        return { rows: [], rowCount: 0 };
      },
    },
  };
}

/**
 * Scheduled-game fixture med valgfri master + participating halls. Default:
 * master = hall-a, participating = [hall-a, hall-b, hall-c] — slik at vi
 * kan teste kjøp i hvilken som helst av de tre hallene.
 */
function scheduledGameRow(
  overrides: Record<string, unknown> = {}
): unknown {
  return {
    id: "g1",
    status: "purchase_open",
    ticket_config_json: {
      ticketTypesData: [
        { color: "yellow", size: "small", pricePerTicket: 2000 },
      ],
    },
    participating_halls_json: ["hall-a", "hall-b", "hall-c"],
    master_hall_id: "hall-a",
    ...overrides,
  };
}

function insertedRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "g1p-inserted",
    scheduled_game_id: "g1",
    buyer_user_id: "p1",
    hall_id: "hall-a",
    ticket_spec_json: [
      { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
    ],
    total_amount_cents: 2000,
    payment_method: "digital_wallet",
    agent_user_id: null,
    idempotency_key: "idem",
    purchased_at: "2026-04-23T12:00:00.000Z",
    refunded_at: null,
    refund_reason: null,
    refunded_by_user_id: null,
    refund_transaction_id: null,
    ...overrides,
  };
}

function makeFakePlatform(walletId: string): PlatformService {
  return {
    async getUserById(userId: string) {
      return {
        id: userId,
        walletId,
        email: `${userId}@test.no`,
        displayName: userId,
      } as unknown as Awaited<ReturnType<PlatformService["getUserById"]>>;
    },
  } as unknown as PlatformService;
}

function makeFakeHallReady(): Game1HallReadyService {
  return {
    async assertPurchaseOpenForHall() {
      /* no-op */
    },
  } as unknown as Game1HallReadyService;
}

function defaultPoolResponses(
  insertRow: unknown = insertedRow(),
  scheduledRow: unknown = scheduledGameRow()
): StubResponse[] {
  return [
    {
      match: (s) =>
        s.includes("FROM") &&
        s.includes("app_game1_ticket_purchases") &&
        s.includes("idempotency_key"),
      rows: [],
    },
    {
      match: (s) =>
        s.includes("FROM") && s.includes("app_game1_scheduled_games"),
      rows: [scheduledRow],
    },
    {
      match: (s) =>
        s.includes("INSERT INTO") &&
        s.includes("app_game1_ticket_purchases"),
      rows: [insertRow],
    },
  ];
}

// ── Tests ────────────────────────────────────────────────────────────────────

test("K1: single-hall (master = kjøpe-hall) → STAKE-entry bundet til hall-a", async () => {
  const { pool } = createStubPool(
    defaultPoolResponses(insertedRow({ hall_id: "hall-a" }))
  );
  const wallet = new InMemoryWalletAdapter();
  await wallet.createAccount({ accountId: "wallet-p1", initialBalance: 1000 });
  const { port, calls } = makeRecordingPort();
  const service = new Game1TicketPurchaseService({
    pool: pool as never,
    walletAdapter: wallet,
    platformService: makeFakePlatform("wallet-p1"),
    hallReadyService: makeFakeHallReady(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    complianceLedgerPort: port,
  });

  await service.purchase({
    scheduledGameId: "g1",
    buyerUserId: "p1",
    hallId: "hall-a",
    ticketSpec: [
      { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
    ],
    paymentMethod: "digital_wallet",
    idempotencyKey: "idem-a",
  });

  assert.equal(calls.length, 1, "én STAKE-entry logget");
  assert.equal(calls[0]!.input.hallId, "hall-a");
  assert.equal(calls[0]!.input.eventType, "STAKE");
  // K2-A CRIT-1: Spill 1 er hovedspill → MAIN_GAME (15%), ikke DATABINGO (30%).
  assert.equal(calls[0]!.input.gameType, "MAIN_GAME");
  assert.equal(calls[0]!.input.channel, "INTERNET");
  assert.equal(calls[0]!.input.amount, 20); // 2000 øre = 20 NOK
  assert.equal(calls[0]!.input.playerId, "p1");
  assert.equal(calls[0]!.input.walletId, "wallet-p1");
});

test("K1 REGULATORISK: multi-hall, kjøp i hall-b (master = hall-a) → STAKE bundet til hall-b (ikke hall-a)", async () => {
  // Dette er bug-en som task fikser: tidligere ville compliance-entry
  // gå mot master-hallen (hall-a) uavhengig av hvor kjøpet skjedde.
  // Korrekt oppførsel er at entry skal bindes til kjøpe-hallen (hall-b).
  const { pool } = createStubPool(
    defaultPoolResponses(
      insertedRow({ hall_id: "hall-b", id: "g1p-hall-b" }),
      scheduledGameRow({
        participating_halls_json: ["hall-a", "hall-b"],
        master_hall_id: "hall-a",
      })
    )
  );
  const wallet = new InMemoryWalletAdapter();
  await wallet.createAccount({ accountId: "wallet-p1", initialBalance: 1000 });
  const { port, calls } = makeRecordingPort();
  const service = new Game1TicketPurchaseService({
    pool: pool as never,
    walletAdapter: wallet,
    platformService: makeFakePlatform("wallet-p1"),
    hallReadyService: makeFakeHallReady(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    complianceLedgerPort: port,
  });

  await service.purchase({
    scheduledGameId: "g1",
    buyerUserId: "p1",
    hallId: "hall-b", // ← kjøpe-hallen
    ticketSpec: [
      { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
    ],
    paymentMethod: "digital_wallet",
    idempotencyKey: "idem-b",
  });

  assert.equal(calls.length, 1);
  // Regulatorisk assertion: hallId må være hall-b (kjøpe-hallen),
  // ikke hall-a (master).
  assert.equal(
    calls[0]!.input.hallId,
    "hall-b",
    "compliance-entry MÅ bindes til kjøpe-hallen, ikke master-hallen"
  );
  assert.notEqual(calls[0]!.input.hallId, "hall-a", "ikke master-hall");
});

test("K1 REGULATORISK: multi-hall, kjøp i hall-c → STAKE bundet til hall-c", async () => {
  // Tredje hall, for å bekrefte at fiksen er robust på tvers av N haller.
  const { pool } = createStubPool(
    defaultPoolResponses(
      insertedRow({ hall_id: "hall-c", id: "g1p-hall-c" }),
      scheduledGameRow() // default: participating=a,b,c, master=a
    )
  );
  const wallet = new InMemoryWalletAdapter();
  await wallet.createAccount({ accountId: "wallet-p1", initialBalance: 1000 });
  const { port, calls } = makeRecordingPort();
  const service = new Game1TicketPurchaseService({
    pool: pool as never,
    walletAdapter: wallet,
    platformService: makeFakePlatform("wallet-p1"),
    hallReadyService: makeFakeHallReady(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    complianceLedgerPort: port,
  });

  await service.purchase({
    scheduledGameId: "g1",
    buyerUserId: "p1",
    hallId: "hall-c",
    ticketSpec: [
      { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
    ],
    paymentMethod: "digital_wallet",
    idempotencyKey: "idem-c",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.input.hallId, "hall-c");
});

test("K1: digital_wallet → channel INTERNET", async () => {
  const { pool } = createStubPool(
    defaultPoolResponses(insertedRow({ hall_id: "hall-a" }))
  );
  const wallet = new InMemoryWalletAdapter();
  await wallet.createAccount({ accountId: "wallet-p1", initialBalance: 1000 });
  const { port, calls } = makeRecordingPort();
  const service = new Game1TicketPurchaseService({
    pool: pool as never,
    walletAdapter: wallet,
    platformService: makeFakePlatform("wallet-p1"),
    hallReadyService: makeFakeHallReady(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    complianceLedgerPort: port,
  });

  await service.purchase({
    scheduledGameId: "g1",
    buyerUserId: "p1",
    hallId: "hall-a",
    ticketSpec: [
      { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
    ],
    paymentMethod: "digital_wallet",
    idempotencyKey: "idem-dw",
  });

  assert.equal(calls[0]!.input.channel, "INTERNET");
});

test("K1: cash_agent → channel HALL", async () => {
  const { pool } = createStubPool(
    defaultPoolResponses(
      insertedRow({
        hall_id: "hall-a",
        payment_method: "cash_agent",
        agent_user_id: "agent-1",
      })
    )
  );
  const { port, calls } = makeRecordingPort();
  const service = new Game1TicketPurchaseService({
    pool: pool as never,
    walletAdapter: new InMemoryWalletAdapter(),
    platformService: makeFakePlatform("wallet-p1"),
    hallReadyService: makeFakeHallReady(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    complianceLedgerPort: port,
  });

  await service.purchase({
    scheduledGameId: "g1",
    buyerUserId: "p1",
    hallId: "hall-a",
    ticketSpec: [
      { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
    ],
    paymentMethod: "cash_agent",
    agentUserId: "agent-1",
    idempotencyKey: "idem-cash",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.input.channel, "HALL");
  assert.equal(calls[0]!.input.eventType, "STAKE");
});

test("K1: card_agent → channel HALL", async () => {
  const { pool } = createStubPool(
    defaultPoolResponses(
      insertedRow({
        hall_id: "hall-b",
        payment_method: "card_agent",
        agent_user_id: "agent-2",
      })
    )
  );
  const { port, calls } = makeRecordingPort();
  const service = new Game1TicketPurchaseService({
    pool: pool as never,
    walletAdapter: new InMemoryWalletAdapter(),
    platformService: makeFakePlatform("wallet-p1"),
    hallReadyService: makeFakeHallReady(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    complianceLedgerPort: port,
  });

  await service.purchase({
    scheduledGameId: "g1",
    buyerUserId: "p1",
    hallId: "hall-b",
    ticketSpec: [
      { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
    ],
    paymentMethod: "card_agent",
    agentUserId: "agent-2",
    idempotencyKey: "idem-card",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.input.hallId, "hall-b");
  assert.equal(calls[0]!.input.channel, "HALL");
});

test("K1: ledger-port kaster → purchase lykkes likevel (soft-fail)", async () => {
  const { pool } = createStubPool(
    defaultPoolResponses(insertedRow({ hall_id: "hall-a" }))
  );
  const wallet = new InMemoryWalletAdapter();
  await wallet.createAccount({ accountId: "wallet-p1", initialBalance: 1000 });
  const { port } = makeRecordingPort({ throwOnStake: true });
  const service = new Game1TicketPurchaseService({
    pool: pool as never,
    walletAdapter: wallet,
    platformService: makeFakePlatform("wallet-p1"),
    hallReadyService: makeFakeHallReady(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    complianceLedgerPort: port,
  });

  // Skal IKKE kaste — purchase er allerede committed.
  const result = await service.purchase({
    scheduledGameId: "g1",
    buyerUserId: "p1",
    hallId: "hall-a",
    ticketSpec: [
      { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
    ],
    paymentMethod: "digital_wallet",
    idempotencyKey: "idem-softfail",
  });

  assert.equal(result.alreadyExisted, false);
  assert.ok(result.purchaseId);
});

test("K1: default NoopComplianceLedgerPort → purchase fungerer uten port", async () => {
  const { pool } = createStubPool(
    defaultPoolResponses(insertedRow({ hall_id: "hall-a" }))
  );
  const wallet = new InMemoryWalletAdapter();
  await wallet.createAccount({ accountId: "wallet-p1", initialBalance: 1000 });
  const service = new Game1TicketPurchaseService({
    pool: pool as never,
    walletAdapter: wallet,
    platformService: makeFakePlatform("wallet-p1"),
    hallReadyService: makeFakeHallReady(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    // ← ingen complianceLedgerPort
  });

  const result = await service.purchase({
    scheduledGameId: "g1",
    buyerUserId: "p1",
    hallId: "hall-a",
    ticketSpec: [
      { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
    ],
    paymentMethod: "digital_wallet",
    idempotencyKey: "idem-noop",
  });

  assert.ok(result.purchaseId);
});

test("K1: idempotency-hit (retry) → ingen ny STAKE-entry", async () => {
  const existing = insertedRow({
    hall_id: "hall-b",
    idempotency_key: "idem-retry",
  });
  const { pool } = createStubPool([
    {
      match: (s) =>
        s.includes("FROM") &&
        s.includes("app_game1_ticket_purchases") &&
        s.includes("idempotency_key"),
      rows: [existing],
    },
  ]);
  const { port, calls } = makeRecordingPort();
  const service = new Game1TicketPurchaseService({
    pool: pool as never,
    walletAdapter: new InMemoryWalletAdapter(),
    platformService: makeFakePlatform("wallet-p1"),
    hallReadyService: makeFakeHallReady(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    complianceLedgerPort: port,
  });

  const result = await service.purchase({
    scheduledGameId: "g1",
    buyerUserId: "p1",
    hallId: "hall-b",
    ticketSpec: [
      { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
    ],
    paymentMethod: "digital_wallet",
    idempotencyKey: "idem-retry",
  });

  assert.equal(result.alreadyExisted, true);
  assert.equal(calls.length, 0, "STAKE skal IKKE kalles ved idempotency-hit");
});

test("K1: STAKE-entry inneholder purchaseId + ticketCount i metadata", async () => {
  const { pool } = createStubPool(
    defaultPoolResponses(
      insertedRow({ hall_id: "hall-a", id: "g1p-meta-test" })
    )
  );
  const wallet = new InMemoryWalletAdapter();
  await wallet.createAccount({ accountId: "wallet-p1", initialBalance: 1000 });
  const { port, calls } = makeRecordingPort();
  const service = new Game1TicketPurchaseService({
    pool: pool as never,
    walletAdapter: wallet,
    platformService: makeFakePlatform("wallet-p1"),
    hallReadyService: makeFakeHallReady(),
    auditLogService: new AuditLogService(new InMemoryAuditLogStore()),
    complianceLedgerPort: port,
  });

  await service.purchase({
    scheduledGameId: "g1",
    buyerUserId: "p1",
    hallId: "hall-a",
    ticketSpec: [
      { color: "yellow", size: "small", count: 3, priceCentsEach: 2000 },
    ],
    paymentMethod: "digital_wallet",
    idempotencyKey: "idem-meta",
  });

  assert.equal(calls.length, 1);
  const meta = calls[0]!.input.metadata ?? {};
  assert.equal(meta.reason, "GAME1_PURCHASE");
  assert.equal(meta.paymentMethod, "digital_wallet");
  assert.equal(meta.ticketCount, 3);
  assert.ok(typeof meta.purchaseId === "string");
  assert.equal(calls[0]!.input.gameId, "g1");
});
