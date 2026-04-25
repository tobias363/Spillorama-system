/**
 * GAME1_SCHEDULE PR 4a: unit-tester for Game1TicketPurchaseService.
 *
 * Testene bruker en stub-pool som matcher mot SQL-fragment (samme mønster
 * som Game1HallReadyService.test.ts) kombinert med InMemoryWalletAdapter
 * + InMemoryAuditLogStore. Dekker:
 *
 *   - purchase() med digital_wallet → DB-rad + wallet-debit + audit.
 *   - purchase() med idempotency-hit → alreadyExisted=true, ingen ny debit.
 *   - purchase() når game.status ≠ 'purchase_open' → PURCHASE_CLOSED_FOR_GAME.
 *   - purchase() når hall ikke deltar → PURCHASE_CLOSED_FOR_HALL.
 *   - purchase() med ukjent farge → INVALID_TICKET_SPEC.
 *   - purchase() med feil pris → INVALID_TICKET_SPEC.
 *   - purchase() med insufficient wallet → INSUFFICIENT_FUNDS.
 *   - purchase() med cash_agent uten agentUserId → MISSING_AGENT.
 *   - refundPurchase() digital_wallet → wallet-credit + refund-felter.
 *   - refundPurchase() idempotent (allerede refundert) → no-op.
 *   - refundPurchase() på completed game → CANNOT_REFUND_COMPLETED_GAME.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "./BingoEngine.js";
import { Game1TicketPurchaseService } from "./Game1TicketPurchaseService.js";
import type { WalletAdapter } from "../adapters/WalletAdapter.js";
import { InMemoryWalletAdapter } from "../adapters/InMemoryWalletAdapter.js";
import {
  AuditLogService,
  InMemoryAuditLogStore,
} from "../compliance/AuditLogService.js";
import type { Game1HallReadyService } from "./Game1HallReadyService.js";
import type { PlatformService } from "../platform/PlatformService.js";

// ── Stub pool (matcher Game1HallReadyService.test.ts-pattern) ────────────────

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

interface StubResponse {
  match: (sql: string) => boolean;
  /** Function so each call can dynamically pick the next row state. */
  rows: unknown[] | (() => unknown[]);
  rowCount?: number;
  /** If `once`, remove from queue after first match; otherwise reuseable. */
  once?: boolean;
  /** Can throw to simulate 23505-duplicate. */
  throwErr?: { code: string; message: string };
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
            if (r.throwErr) {
              const err = Object.assign(new Error(r.throwErr.message), {
                code: r.throwErr.code,
              });
              if (r.once !== false) queue.splice(i, 1);
              throw err;
            }
            const rows = typeof r.rows === "function" ? r.rows() : r.rows;
            if (r.once !== false) queue.splice(i, 1);
            return { rows, rowCount: r.rowCount ?? rows.length };
          }
        }
        return { rows: [], rowCount: 0 };
      },
    },
    queries,
  };
}

// ── Fixture helpers ──────────────────────────────────────────────────────────

function scheduledGameRow(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: "g1",
    status: "purchase_open",
    ticket_config_json: {
      ticketTypesData: [
        { color: "yellow", size: "small", pricePerTicket: 2000 },
        { color: "yellow", size: "large", pricePerTicket: 5000 },
        { color: "purple", size: "small", pricePerTicket: 3000 },
      ],
    },
    participating_halls_json: ["hall-a", "hall-b"],
    master_hall_id: "hall-a",
    ...overrides,
  };
}

interface FakePlatformOpts {
  balance?: number;
  walletId?: string;
}

function makeFakePlatform(opts: FakePlatformOpts = {}): PlatformService {
  return {
    async getUserById(userId: string) {
      return {
        id: userId,
        walletId: opts.walletId ?? `wallet-${userId}`,
        email: `${userId}@test.no`,
        displayName: userId,
      } as unknown as Awaited<ReturnType<PlatformService["getUserById"]>>;
    },
  } as unknown as PlatformService;
}

function makeFakeHallReady(
  shouldThrow?: DomainError
): Game1HallReadyService {
  return {
    async assertPurchaseOpenForHall() {
      if (shouldThrow) throw shouldThrow;
    },
  } as unknown as Game1HallReadyService;
}

async function seedWallet(
  wallet: WalletAdapter,
  userId: string,
  balance: number
): Promise<void> {
  await wallet.createAccount({
    accountId: `wallet-${userId}`,
    initialBalance: balance,
    allowExisting: true,
  });
}

function makeService(opts: {
  poolResponses: StubResponse[];
  balance?: number;
  hallReadyThrows?: DomainError;
}): {
  service: Game1TicketPurchaseService;
  wallet: WalletAdapter;
  audit: InMemoryAuditLogStore;
  queries: RecordedQuery[];
} {
  const { pool, queries } = createStubPool(opts.poolResponses);
  const wallet = new InMemoryWalletAdapter();
  const auditStore = new InMemoryAuditLogStore();
  const audit = new AuditLogService(auditStore);
  const hallReady = makeFakeHallReady(opts.hallReadyThrows);
  const platform = makeFakePlatform();
  const service = new Game1TicketPurchaseService({
    pool: pool as never,
    walletAdapter: wallet,
    platformService: platform,
    hallReadyService: hallReady,
    auditLogService: audit,
  });
  return { service, wallet, audit: auditStore, queries };
}

// ── purchase() tests ─────────────────────────────────────────────────────────

test("purchase() digital_wallet happy-path: INSERT + wallet.debit + audit", async () => {
  const { service, wallet, audit, queries } = makeService({
    poolResponses: [
      // findByIdempotencyKey — ingen eksisterende rad.
      {
        match: (s) =>
          s.includes("FROM") &&
          s.includes("app_game1_ticket_purchases") &&
          s.includes("idempotency_key"),
        rows: [],
      },
      // loadScheduledGame.
      {
        match: (s) => s.includes("FROM") && s.includes("app_game1_scheduled_games"),
        rows: [scheduledGameRow()],
      },
      // INSERT returnerer rad.
      {
        match: (s) =>
          s.includes("INSERT INTO") &&
          s.includes("app_game1_ticket_purchases"),
        rows: [
          {
            id: "g1p-xyz",
            scheduled_game_id: "g1",
            buyer_user_id: "p1",
            hall_id: "hall-a",
            ticket_spec_json: [
              {
                color: "yellow",
                size: "small",
                count: 2,
                priceCentsEach: 2000,
              },
            ],
            total_amount_cents: 4000,
            payment_method: "digital_wallet",
            agent_user_id: null,
            idempotency_key: "idem-1",
            purchased_at: "2026-04-21T12:00:00.000Z",
            refunded_at: null,
            refund_reason: null,
            refunded_by_user_id: null,
            refund_transaction_id: null,
          },
        ],
      },
    ],
  });

  await seedWallet(wallet, "p1", 1000); // 1000 NOK = plenty

  const result = await service.purchase({
    scheduledGameId: "g1",
    buyerUserId: "p1",
    hallId: "hall-a",
    ticketSpec: [
      { color: "yellow", size: "small", count: 2, priceCentsEach: 2000 },
    ],
    paymentMethod: "digital_wallet",
    idempotencyKey: "idem-1",
  });

  assert.equal(result.totalAmountCents, 4000);
  assert.equal(result.alreadyExisted, false);
  // wallet-debit skjedde (4000 cents = 40 NOK).
  const balance = await wallet.getBalance("wallet-p1");
  assert.equal(balance, 1000 - 40);
  // audit-rad skrevet. `resourceId` er servicens genererte purchaseId
  // (randomUUID), ikke mockens row.id — vi assert kun på action.
  // give fire-and-forget audit write a tick to finish.
  await new Promise((r) => setTimeout(r, 5));
  const events = await audit.list();
  assert.ok(
    events.some((e) => e.action === "game1_purchase.create"),
    "audit-rad for game1_purchase.create skal finnes"
  );
  // INSERT-query kjørt.
  assert.ok(
    queries.some((q) =>
      q.sql.includes("INSERT INTO") &&
      q.sql.includes("app_game1_ticket_purchases")
    )
  );
});

test("purchase() idempotency-hit: eksisterende rad → alreadyExisted=true, ingen ny debit", async () => {
  const { service, wallet } = makeService({
    poolResponses: [
      {
        match: (s) =>
          s.includes("FROM") &&
          s.includes("app_game1_ticket_purchases") &&
          s.includes("idempotency_key"),
        rows: [
          {
            id: "g1p-existing",
            scheduled_game_id: "g1",
            buyer_user_id: "p1",
            hall_id: "hall-a",
            ticket_spec_json: [],
            total_amount_cents: 4000,
            payment_method: "digital_wallet",
            agent_user_id: null,
            idempotency_key: "idem-dupe",
            purchased_at: "2026-04-21T11:00:00.000Z",
            refunded_at: null,
            refund_reason: null,
            refunded_by_user_id: null,
            refund_transaction_id: null,
          },
        ],
      },
    ],
  });

  await seedWallet(wallet, "p1", 1000);
  const balanceBefore = await wallet.getBalance("wallet-p1");

  const result = await service.purchase({
    scheduledGameId: "g1",
    buyerUserId: "p1",
    hallId: "hall-a",
    ticketSpec: [
      { color: "yellow", size: "small", count: 2, priceCentsEach: 2000 },
    ],
    paymentMethod: "digital_wallet",
    idempotencyKey: "idem-dupe",
  });

  assert.equal(result.alreadyExisted, true);
  assert.equal(result.purchaseId, "g1p-existing");
  // Ingen ny wallet-debit.
  const balanceAfter = await wallet.getBalance("wallet-p1");
  assert.equal(balanceAfter, balanceBefore);
});

test("purchase() avviser når game.status ≠ 'purchase_open' → PURCHASE_CLOSED_FOR_GAME", async () => {
  const { service } = makeService({
    poolResponses: [
      {
        match: (s) =>
          s.includes("FROM") && s.includes("idempotency_key"),
        rows: [],
      },
      {
        match: (s) =>
          s.includes("FROM") && s.includes("app_game1_scheduled_games"),
        rows: [scheduledGameRow({ status: "scheduled" })],
      },
    ],
  });
  await assert.rejects(
    service.purchase({
      scheduledGameId: "g1",
      buyerUserId: "p1",
      hallId: "hall-a",
      ticketSpec: [
        { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
      ],
      paymentMethod: "digital_wallet",
      idempotencyKey: "idem-2",
    }),
    (err) =>
      err instanceof DomainError &&
      err.code === "PURCHASE_CLOSED_FOR_GAME"
  );
});

test("purchase() avviser når game.status='running' → PURCHASE_CLOSED_FOR_GAME", async () => {
  const { service } = makeService({
    poolResponses: [
      { match: (s) => s.includes("idempotency_key"), rows: [] },
      {
        match: (s) => s.includes("app_game1_scheduled_games"),
        rows: [scheduledGameRow({ status: "running" })],
      },
    ],
  });
  await assert.rejects(
    service.purchase({
      scheduledGameId: "g1",
      buyerUserId: "p1",
      hallId: "hall-a",
      ticketSpec: [
        { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
      ],
      paymentMethod: "digital_wallet",
      idempotencyKey: "idem-3",
    }),
    (err) =>
      err instanceof DomainError &&
      err.code === "PURCHASE_CLOSED_FOR_GAME"
  );
});

test("purchase() avviser når hall ikke deltar → PURCHASE_CLOSED_FOR_HALL", async () => {
  const { service } = makeService({
    poolResponses: [
      { match: (s) => s.includes("idempotency_key"), rows: [] },
      {
        match: (s) => s.includes("app_game1_scheduled_games"),
        rows: [
          scheduledGameRow({
            participating_halls_json: ["hall-b"],
            master_hall_id: "hall-b",
          }),
        ],
      },
    ],
  });
  await assert.rejects(
    service.purchase({
      scheduledGameId: "g1",
      buyerUserId: "p1",
      hallId: "hall-a",
      ticketSpec: [
        { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
      ],
      paymentMethod: "digital_wallet",
      idempotencyKey: "idem-4",
    }),
    (err) =>
      err instanceof DomainError &&
      err.code === "PURCHASE_CLOSED_FOR_HALL"
  );
});

test("purchase() avviser når hallReady kaster PURCHASE_CLOSED_FOR_HALL", async () => {
  const { pool } = createStubPool([
    { match: (s) => s.includes("idempotency_key"), rows: [] },
    {
      match: (s) => s.includes("app_game1_scheduled_games"),
      rows: [scheduledGameRow()],
    },
  ]);
  const wallet = new InMemoryWalletAdapter();
  const platform = makeFakePlatform();
  const audit = new AuditLogService(new InMemoryAuditLogStore());
  const hallReady = makeFakeHallReady(
    new DomainError("PURCHASE_CLOSED_FOR_HALL", "stengt")
  );
  const service = new Game1TicketPurchaseService({
    pool: pool as never,
    walletAdapter: wallet,
    platformService: platform,
    hallReadyService: hallReady,
    auditLogService: audit,
  });
  await assert.rejects(
    service.purchase({
      scheduledGameId: "g1",
      buyerUserId: "p1",
      hallId: "hall-a",
      ticketSpec: [
        { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
      ],
      paymentMethod: "digital_wallet",
      idempotencyKey: "idem-hr",
    }),
    (err) =>
      err instanceof DomainError &&
      err.code === "PURCHASE_CLOSED_FOR_HALL"
  );
});

test("purchase() avviser ukjent farge → INVALID_TICKET_SPEC", async () => {
  const { service } = makeService({
    poolResponses: [
      { match: (s) => s.includes("idempotency_key"), rows: [] },
      {
        match: (s) => s.includes("app_game1_scheduled_games"),
        rows: [scheduledGameRow()],
      },
    ],
  });
  await assert.rejects(
    service.purchase({
      scheduledGameId: "g1",
      buyerUserId: "p1",
      hallId: "hall-a",
      ticketSpec: [
        { color: "rainbow", size: "small", count: 1, priceCentsEach: 2000 },
      ],
      paymentMethod: "digital_wallet",
      idempotencyKey: "idem-color",
    }),
    (err) =>
      err instanceof DomainError && err.code === "INVALID_TICKET_SPEC"
  );
});

test("purchase() avviser feil pris → INVALID_TICKET_SPEC", async () => {
  const { service } = makeService({
    poolResponses: [
      { match: (s) => s.includes("idempotency_key"), rows: [] },
      {
        match: (s) => s.includes("app_game1_scheduled_games"),
        rows: [scheduledGameRow()],
      },
    ],
  });
  await assert.rejects(
    service.purchase({
      scheduledGameId: "g1",
      buyerUserId: "p1",
      hallId: "hall-a",
      ticketSpec: [
        // correct color+size, but priceCentsEach=999 (expected 2000)
        { color: "yellow", size: "small", count: 1, priceCentsEach: 999 },
      ],
      paymentMethod: "digital_wallet",
      idempotencyKey: "idem-price",
    }),
    (err) =>
      err instanceof DomainError && err.code === "INVALID_TICKET_SPEC"
  );
});

test("purchase() avviser insufficient wallet → INSUFFICIENT_FUNDS", async () => {
  const { service, wallet } = makeService({
    poolResponses: [
      { match: (s) => s.includes("idempotency_key"), rows: [] },
      {
        match: (s) => s.includes("app_game1_scheduled_games"),
        rows: [scheduledGameRow()],
      },
    ],
  });
  await seedWallet(wallet, "p1", 10); // 10 NOK — mindre enn 40

  await assert.rejects(
    service.purchase({
      scheduledGameId: "g1",
      buyerUserId: "p1",
      hallId: "hall-a",
      ticketSpec: [
        { color: "yellow", size: "small", count: 2, priceCentsEach: 2000 },
      ],
      paymentMethod: "digital_wallet",
      idempotencyKey: "idem-poor",
    }),
    (err) =>
      err instanceof DomainError && err.code === "INSUFFICIENT_FUNDS"
  );
});

test("purchase() cash_agent uten agentUserId → MISSING_AGENT", async () => {
  const { service } = makeService({
    poolResponses: [
      { match: (s) => s.includes("idempotency_key"), rows: [] },
      {
        match: (s) => s.includes("app_game1_scheduled_games"),
        rows: [scheduledGameRow()],
      },
    ],
  });
  await assert.rejects(
    service.purchase({
      scheduledGameId: "g1",
      buyerUserId: "p1",
      hallId: "hall-a",
      ticketSpec: [
        { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
      ],
      paymentMethod: "cash_agent",
      idempotencyKey: "idem-no-agent",
    }),
    (err) =>
      err instanceof DomainError && err.code === "MISSING_AGENT"
  );
});

test("purchase() cash_agent happy-path: ingen wallet-flyt, men INSERT + audit", async () => {
  const { service, wallet, audit } = makeService({
    poolResponses: [
      { match: (s) => s.includes("idempotency_key"), rows: [] },
      {
        match: (s) => s.includes("app_game1_scheduled_games"),
        rows: [scheduledGameRow()],
      },
      {
        match: (s) => s.includes("INSERT INTO") && s.includes("app_game1_ticket_purchases"),
        rows: [
          {
            id: "g1p-cash",
            scheduled_game_id: "g1",
            buyer_user_id: "p1",
            hall_id: "hall-a",
            ticket_spec_json: [],
            total_amount_cents: 2000,
            payment_method: "cash_agent",
            agent_user_id: "a1",
            idempotency_key: "idem-cash",
            purchased_at: "2026-04-21T12:00:00.000Z",
            refunded_at: null,
            refund_reason: null,
            refunded_by_user_id: null,
            refund_transaction_id: null,
          },
        ],
      },
    ],
  });
  await seedWallet(wallet, "p1", 100);
  const before = await wallet.getBalance("wallet-p1");
  const result = await service.purchase({
    scheduledGameId: "g1",
    buyerUserId: "p1",
    hallId: "hall-a",
    ticketSpec: [
      { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
    ],
    paymentMethod: "cash_agent",
    agentUserId: "a1",
    idempotencyKey: "idem-cash",
  });
  assert.equal(result.alreadyExisted, false);
  const after = await wallet.getBalance("wallet-p1");
  assert.equal(after, before, "ingen wallet-debit for cash_agent");
  await new Promise((r) => setTimeout(r, 5));
  const events = await audit.list();
  assert.ok(
    events.some((e) => e.action === "game1_purchase.create" && e.actorType === "AGENT")
  );
});

test("purchase() UNIQUE-race: INSERT kaster 23505, retry finner eksisterende rad → alreadyExisted=true", async () => {
  const existingRow = {
    id: "g1p-race-hit",
    scheduled_game_id: "g1",
    buyer_user_id: "p1",
    hall_id: "hall-a",
    ticket_spec_json: [],
    total_amount_cents: 4000,
    payment_method: "digital_wallet",
    agent_user_id: null,
    idempotency_key: "idem-race",
    purchased_at: "2026-04-21T12:00:00.000Z",
    refunded_at: null,
    refund_reason: null,
    refunded_by_user_id: null,
    refund_transaction_id: null,
  };
  let firstLookup = true;
  const { service, wallet } = makeService({
    poolResponses: [
      // Første findByIdempotencyKey: ingen rad.
      {
        match: (s) =>
          s.includes("FROM") &&
          s.includes("app_game1_ticket_purchases") &&
          s.includes("idempotency_key"),
        rows: () => {
          if (firstLookup) {
            firstLookup = false;
            return [];
          }
          return [existingRow];
        },
        once: false, // reusable
      },
      {
        match: (s) => s.includes("app_game1_scheduled_games"),
        rows: [scheduledGameRow()],
      },
      {
        match: (s) =>
          s.includes("INSERT INTO") &&
          s.includes("app_game1_ticket_purchases"),
        rows: [],
        throwErr: { code: "23505", message: "duplicate" },
      },
    ],
  });
  await seedWallet(wallet, "p1", 1000);
  const result = await service.purchase({
    scheduledGameId: "g1",
    buyerUserId: "p1",
    hallId: "hall-a",
    ticketSpec: [
      { color: "yellow", size: "small", count: 2, priceCentsEach: 2000 },
    ],
    paymentMethod: "digital_wallet",
    idempotencyKey: "idem-race",
  });
  assert.equal(result.alreadyExisted, true);
  assert.equal(result.purchaseId, "g1p-race-hit");
});

// ── Regression: wallet-debit-race compensation (Spill 1 review #499 issue 2) ─

test("purchase() INSERT feiler med FK-violation → wallet kompenseres tilbake til balanseFør", async () => {
  // Bug: wallet debiteres FØR INSERT. Hvis INSERT feiler med ikke-23505
  // (her: FK-violation 23503) er wallet debitert uten audit-trail. Fix
  // skal kompensere via wallet.credit med deterministisk idempotency-key.
  const { service, wallet, audit } = makeService({
    poolResponses: [
      // findByIdempotencyKey — ingen eksisterende rad.
      {
        match: (s) =>
          s.includes("FROM") &&
          s.includes("app_game1_ticket_purchases") &&
          s.includes("idempotency_key"),
        rows: [],
      },
      // loadScheduledGame.
      {
        match: (s) =>
          s.includes("FROM") && s.includes("app_game1_scheduled_games"),
        rows: [scheduledGameRow()],
      },
      // INSERT kaster 23503 FK-violation.
      {
        match: (s) =>
          s.includes("INSERT INTO") &&
          s.includes("app_game1_ticket_purchases"),
        rows: [],
        throwErr: { code: "23503", message: "foreign key violation" },
      },
    ],
  });

  await seedWallet(wallet, "p1", 1000); // 1000 NOK
  const balanceBefore = await wallet.getBalance("wallet-p1");

  await assert.rejects(
    service.purchase({
      scheduledGameId: "g1",
      buyerUserId: "p1",
      hallId: "hall-a",
      ticketSpec: [
        { color: "yellow", size: "small", count: 2, priceCentsEach: 2000 },
      ],
      paymentMethod: "digital_wallet",
      idempotencyKey: "idem-fk-violation",
    }),
    (err) => {
      // Original-feil skal boble opp (ikke maskeres av kompensasjonsflyt).
      const code = (err as { code?: string }).code;
      return code === "23503";
    }
  );

  // KRITISK: wallet skal ende på balanseFør — kompensasjon skal ha rullet
  // tilbake debit på 40 NOK.
  const balanceAfter = await wallet.getBalance("wallet-p1");
  assert.equal(
    balanceAfter,
    balanceBefore,
    "wallet skal være på balanseFør etter kompensasjon"
  );

  // Audit-trail skal inneholde compensate-event.
  await new Promise((r) => setTimeout(r, 5));
  const events = await audit.list();
  const compEvent = events.find(
    (e) => e.action === "game1_purchase.compensate"
  );
  assert.ok(
    compEvent,
    "audit-rad for game1_purchase.compensate skal finnes"
  );
  // Detail-felt skal inkludere insertErrorCode for sporbarhet.
  const details = compEvent?.details as Record<string, unknown>;
  assert.equal(details?.insertErrorCode, "23503");
  assert.equal(details?.reason, "INSERT_FAILED_AFTER_DEBIT");
});

test("purchase() INSERT feiler med transient connection-død → wallet kompenseres", async () => {
  // Connection-død (typisk: ECONNRESET / connection terminated) har INGEN
  // pg-feilkode. Vi simulerer det med en plain Error uten code-felt.
  const { service, wallet, audit } = makeService({
    poolResponses: [
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
        rows: [scheduledGameRow()],
      },
      // INSERT kaster connection-død (uten kode).
      {
        match: (s) =>
          s.includes("INSERT INTO") &&
          s.includes("app_game1_ticket_purchases"),
        rows: [],
        throwErr: { code: "", message: "Connection terminated unexpectedly" },
      },
    ],
  });

  await seedWallet(wallet, "p1", 500);
  const balanceBefore = await wallet.getBalance("wallet-p1");

  await assert.rejects(
    service.purchase({
      scheduledGameId: "g1",
      buyerUserId: "p1",
      hallId: "hall-a",
      ticketSpec: [
        { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
      ],
      paymentMethod: "digital_wallet",
      idempotencyKey: "idem-conn-died",
    }),
    (err) => err instanceof Error && /Connection terminated/.test(err.message)
  );

  // Wallet skal være tilbake på balanseFør.
  const balanceAfter = await wallet.getBalance("wallet-p1");
  assert.equal(balanceAfter, balanceBefore);

  // Audit skal logge compensate-event.
  await new Promise((r) => setTimeout(r, 5));
  const events = await audit.list();
  assert.ok(
    events.some((e) => e.action === "game1_purchase.compensate"),
    "audit-rad for game1_purchase.compensate skal finnes"
  );
});

test("purchase() kompensasjon er idempotent — retry dobbel-kompenserer ikke wallet", async () => {
  // Hvis spilleren retry'er etter feilet kjøp, skal wallet-adapterens dedup
  // på `game1-purchase:<key>:compensate` forhindre dobbel-credit.
  // Vi tester dette ved å kjøre purchase to ganger med samme key — begge
  // feiler INSERT, men wallet skal kun krediteres én gang totalt.

  let insertCallCount = 0;
  const { service, wallet } = makeService({
    poolResponses: [
      // findByIdempotencyKey — alltid tom (forenkling: race-vinneren
      // har INGEN rad — INSERT feiler kun fordi databasen er rar).
      {
        match: (s) =>
          s.includes("FROM") &&
          s.includes("app_game1_ticket_purchases") &&
          s.includes("idempotency_key"),
        rows: [],
        once: false,
      },
      {
        match: (s) =>
          s.includes("FROM") && s.includes("app_game1_scheduled_games"),
        rows: [scheduledGameRow()],
        once: false,
      },
      // INSERT kaster FK-violation begge ganger.
      {
        match: (s) =>
          s.includes("INSERT INTO") &&
          s.includes("app_game1_ticket_purchases"),
        rows: () => {
          insertCallCount += 1;
          return [];
        },
        throwErr: { code: "23503", message: "foreign key violation" },
        once: false,
      },
    ],
  });

  await seedWallet(wallet, "p1", 1000);
  const balanceBefore = await wallet.getBalance("wallet-p1");

  // Første forsøk: debit + INSERT-feil + compensate-credit.
  await assert.rejects(
    service.purchase({
      scheduledGameId: "g1",
      buyerUserId: "p1",
      hallId: "hall-a",
      ticketSpec: [
        { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
      ],
      paymentMethod: "digital_wallet",
      idempotencyKey: "idem-retry",
    })
  );

  // Andre forsøk med SAMME idempotency-key.
  // - wallet.debit: idempotency-key matcher første debit → returnerer
  //   eksisterende tx (ingen ny debit, balanse uendret).
  // - INSERT: feiler igjen.
  // - wallet.credit-compensate: idempotency-key matcher første credit →
  //   returnerer eksisterende tx (ingen ny credit, balanse uendret).
  await assert.rejects(
    service.purchase({
      scheduledGameId: "g1",
      buyerUserId: "p1",
      hallId: "hall-a",
      ticketSpec: [
        { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
      ],
      paymentMethod: "digital_wallet",
      idempotencyKey: "idem-retry",
    })
  );

  // Etter to forsøk skal wallet være på balanseFør (debit + compensate-credit
  // = 0 netto effekt på begge runder).
  const balanceAfter = await wallet.getBalance("wallet-p1");
  assert.equal(
    balanceAfter,
    balanceBefore,
    "wallet skal være uendret etter to retries med kompensasjon"
  );
});

test("purchase() kompensasjon hopper over for cash_agent (ingen wallet-flyt å rulle tilbake)", async () => {
  // For agent-betaling skjer ingen wallet-debit, så hvis INSERT feiler er
  // det ingenting å kompensere. Sikre at vi ikke prøver å credit'e en
  // wallet som aldri ble debitert.
  const { service, wallet, audit } = makeService({
    poolResponses: [
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
        rows: [scheduledGameRow()],
      },
      {
        match: (s) =>
          s.includes("INSERT INTO") &&
          s.includes("app_game1_ticket_purchases"),
        rows: [],
        throwErr: { code: "23503", message: "foreign key violation" },
      },
    ],
  });

  await seedWallet(wallet, "p1", 1000);
  const balanceBefore = await wallet.getBalance("wallet-p1");

  await assert.rejects(
    service.purchase({
      scheduledGameId: "g1",
      buyerUserId: "p1",
      hallId: "hall-a",
      ticketSpec: [
        { color: "yellow", size: "small", count: 1, priceCentsEach: 2000 },
      ],
      paymentMethod: "cash_agent",
      agentUserId: "a1",
      idempotencyKey: "idem-cash-fk",
    })
  );

  // Wallet er uendret (ble aldri debitert i utgangspunktet).
  const balanceAfter = await wallet.getBalance("wallet-p1");
  assert.equal(balanceAfter, balanceBefore);

  // INGEN compensate-event skal logges (ingen wallet-flyt = ingenting å rulle).
  await new Promise((r) => setTimeout(r, 5));
  const events = await audit.list();
  assert.ok(
    !events.some((e) => e.action === "game1_purchase.compensate"),
    "compensate-event skal ikke logges når det ikke var wallet-debit"
  );
});

// ── refundPurchase() tests ───────────────────────────────────────────────────

test("refundPurchase() digital_wallet: wallet.credit + refund-felter settes", async () => {
  let refundedAt: string | null = null;
  const { service, wallet, audit } = makeService({
    poolResponses: [
      // getPurchaseById
      {
        match: (s) =>
          s.includes("FROM") &&
          s.includes("app_game1_ticket_purchases") &&
          s.includes("WHERE id = $1"),
        rows: () => [
          {
            id: "g1p-r1",
            scheduled_game_id: "g1",
            buyer_user_id: "p1",
            hall_id: "hall-a",
            ticket_spec_json: [],
            total_amount_cents: 4000,
            payment_method: "digital_wallet",
            agent_user_id: null,
            idempotency_key: "idem-r1",
            purchased_at: "2026-04-21T10:00:00.000Z",
            refunded_at: refundedAt,
            refund_reason: null,
            refunded_by_user_id: null,
            refund_transaction_id: null,
          },
        ],
        once: false,
      },
      // loadScheduledGame
      {
        match: (s) => s.includes("app_game1_scheduled_games"),
        rows: [scheduledGameRow({ status: "ready_to_start" })],
      },
      // UPDATE refunded_at
      {
        match: (s) =>
          s.includes("UPDATE") &&
          s.includes("app_game1_ticket_purchases") &&
          s.includes("refunded_at"),
        rows: [],
      },
    ],
  });
  await seedWallet(wallet, "p1", 0);
  const before = await wallet.getBalance("wallet-p1");
  await service.refundPurchase({
    purchaseId: "g1p-r1",
    reason: "support-refund",
    refundedByUserId: "admin-1",
    refundedByActorType: "ADMIN",
  });
  // Etter refund: wallet kreditert med 40 NOK (4000 cents).
  const after = await wallet.getBalance("wallet-p1");
  assert.equal(after - before, 40);
  // PR-W2 wallet-split: refund skal lande på deposit-siden (ikke winnings).
  // Sjekk at HELE beløpet er på deposit og INGENTING på winnings.
  const balances = await wallet.getBothBalances("wallet-p1");
  assert.equal(balances.deposit - (before /* seeded */), 40, "refund treffer deposit-siden");
  assert.equal(balances.winnings, 0, "refund må ALDRI lande på winnings");
  await new Promise((r) => setTimeout(r, 5));
  const events = await audit.list();
  assert.ok(
    events.some((e) => e.action === "game1_purchase.refund")
  );
});

test("refundPurchase() idempotent: allerede refundert → no-op", async () => {
  const { service, wallet } = makeService({
    poolResponses: [
      {
        match: (s) =>
          s.includes("FROM") &&
          s.includes("app_game1_ticket_purchases") &&
          s.includes("WHERE id = $1"),
        rows: [
          {
            id: "g1p-r2",
            scheduled_game_id: "g1",
            buyer_user_id: "p1",
            hall_id: "hall-a",
            ticket_spec_json: [],
            total_amount_cents: 4000,
            payment_method: "digital_wallet",
            agent_user_id: null,
            idempotency_key: "idem-r2",
            purchased_at: "2026-04-21T10:00:00.000Z",
            refunded_at: "2026-04-21T11:00:00.000Z", // allerede refundert
            refund_reason: "før",
            refunded_by_user_id: "admin-1",
            refund_transaction_id: "wtx-999",
          },
        ],
      },
    ],
  });
  await seedWallet(wallet, "p1", 0);
  const before = await wallet.getBalance("wallet-p1");
  await service.refundPurchase({
    purchaseId: "g1p-r2",
    reason: "retry",
    refundedByUserId: "admin-1",
  });
  const after = await wallet.getBalance("wallet-p1");
  assert.equal(after, before, "ingen ny wallet-flyt ved idempotent refund");
});

test("refundPurchase() på completed game → CANNOT_REFUND_COMPLETED_GAME", async () => {
  const { service, wallet } = makeService({
    poolResponses: [
      {
        match: (s) =>
          s.includes("FROM") &&
          s.includes("app_game1_ticket_purchases") &&
          s.includes("WHERE id = $1"),
        rows: [
          {
            id: "g1p-r3",
            scheduled_game_id: "g1",
            buyer_user_id: "p1",
            hall_id: "hall-a",
            ticket_spec_json: [],
            total_amount_cents: 4000,
            payment_method: "digital_wallet",
            agent_user_id: null,
            idempotency_key: "idem-r3",
            purchased_at: "2026-04-21T10:00:00.000Z",
            refunded_at: null,
            refund_reason: null,
            refunded_by_user_id: null,
            refund_transaction_id: null,
          },
        ],
      },
      {
        match: (s) => s.includes("app_game1_scheduled_games"),
        rows: [scheduledGameRow({ status: "completed" })],
      },
    ],
  });
  await seedWallet(wallet, "p1", 0);
  await assert.rejects(
    service.refundPurchase({
      purchaseId: "g1p-r3",
      reason: "for sent",
      refundedByUserId: "admin-1",
    }),
    (err) =>
      err instanceof DomainError &&
      err.code === "CANNOT_REFUND_COMPLETED_GAME"
  );
});

test("refundPurchase() PURCHASE_NOT_FOUND når id er ukjent", async () => {
  const { service } = makeService({ poolResponses: [] });
  await assert.rejects(
    service.refundPurchase({
      purchaseId: "ghost",
      reason: "x",
      refundedByUserId: "admin-1",
    }),
    (err) =>
      err instanceof DomainError && err.code === "PURCHASE_NOT_FOUND"
  );
});

// ── listPurchasesForGame / listPurchasesForBuyer ────────────────────────────

test("listPurchasesForGame returnerer purchases for scheduled_game_id", async () => {
  const { service } = makeService({
    poolResponses: [
      {
        match: (s) =>
          s.includes("FROM") &&
          s.includes("app_game1_ticket_purchases") &&
          s.includes("scheduled_game_id = $1") &&
          !s.includes("buyer_user_id"),
        rows: [
          {
            id: "g1p-a",
            scheduled_game_id: "g1",
            buyer_user_id: "p1",
            hall_id: "hall-a",
            ticket_spec_json: [],
            total_amount_cents: 2000,
            payment_method: "digital_wallet",
            agent_user_id: null,
            idempotency_key: "k1",
            purchased_at: "2026-04-21T10:00:00.000Z",
            refunded_at: null,
            refund_reason: null,
            refunded_by_user_id: null,
            refund_transaction_id: null,
          },
        ],
      },
    ],
  });
  const rows = await service.listPurchasesForGame("g1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.id, "g1p-a");
});
