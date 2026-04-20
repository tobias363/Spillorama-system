/**
 * BIN-639: unit-tester for PhysicalTicketService.rewardAll.
 *
 * Fokuserte pool-mock-tester for bulk reward-flow med to-lags idempotens
 * (is_winning_distributed-flagg + BIN-640 cashouts UNIQUE-constraint).
 */

import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { PhysicalTicketService } from "../PhysicalTicketService.js";

interface TicketRow {
  id: string;
  batch_id: string;
  unique_id: string;
  hall_id: string;
  status: "UNSOLD" | "SOLD" | "VOIDED";
  price_cents: number | null;
  assigned_game_id: string | null;
  sold_at: Date | null;
  sold_by: string | null;
  buyer_user_id: string | null;
  voided_at: Date | null;
  voided_by: string | null;
  voided_reason: string | null;
  created_at: Date;
  updated_at: Date;
  numbers_json: number[] | null;
  pattern_won: string | null;
  won_amount_cents: number | null;
  evaluated_at: Date | null;
  is_winning_distributed: boolean;
  winning_distributed_at: Date | null;
}

interface CashoutRow {
  id: string;
  ticket_unique_id: string;
  hall_id: string;
  game_id: string | null;
  payout_cents: number;
  paid_by: string;
  paid_at: Date;
  notes: string | null;
  other_data: Record<string, unknown>;
}

interface Store {
  tickets: Map<string, TicketRow>;
  cashouts: Map<string, CashoutRow>;
}

function newStore(): Store {
  return { tickets: new Map(), cashouts: new Map() };
}

function makeTicket(overrides: Partial<TicketRow> & { unique_id: string }): TicketRow {
  const now = new Date();
  return {
    id: overrides.id ?? `t-${overrides.unique_id}`,
    batch_id: overrides.batch_id ?? "batch-1",
    unique_id: overrides.unique_id,
    hall_id: overrides.hall_id ?? "hall-a",
    status: overrides.status ?? "SOLD",
    price_cents: overrides.price_cents ?? 5000,
    assigned_game_id: overrides.assigned_game_id ?? "game-42",
    sold_at: overrides.sold_at ?? now,
    sold_by: overrides.sold_by ?? "agent-1",
    buyer_user_id: overrides.buyer_user_id ?? null,
    voided_at: overrides.voided_at ?? null,
    voided_by: overrides.voided_by ?? null,
    voided_reason: overrides.voided_reason ?? null,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
    numbers_json: "numbers_json" in overrides ? overrides.numbers_json! : null,
    pattern_won: "pattern_won" in overrides ? overrides.pattern_won! : null,
    won_amount_cents: "won_amount_cents" in overrides ? overrides.won_amount_cents! : null,
    evaluated_at: "evaluated_at" in overrides ? overrides.evaluated_at! : null,
    is_winning_distributed: overrides.is_winning_distributed ?? false,
    winning_distributed_at:
      "winning_distributed_at" in overrides ? overrides.winning_distributed_at! : null,
  };
}

function runQuery(store: Store, sql: string, params: unknown[] = []): { rows: unknown[]; rowCount: number } {
  const t = sql.trim();
  if (t.startsWith("BEGIN") || t.startsWith("COMMIT") || t.startsWith("ROLLBACK") || t.startsWith("CREATE")) {
    return { rows: [], rowCount: 0 };
  }

  const isTickets = sql.includes("app_physical_tickets") && !sql.includes("app_physical_ticket_batches") && !sql.includes("app_physical_ticket_cashouts");
  const isCashouts = sql.includes("app_physical_ticket_cashouts");

  // SELECT ... FROM tickets WHERE unique_id = $1 FOR UPDATE
  if (t.startsWith("SELECT") && isTickets && sql.includes("WHERE unique_id = $1 FOR UPDATE")) {
    const [uniqueId] = params as [string];
    const hit = [...store.tickets.values()].find((x) => x.unique_id === uniqueId);
    return hit ? { rows: [hit], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // UPDATE tickets SET won_amount_cents + is_winning_distributed
  if (
    t.startsWith("UPDATE") &&
    isTickets &&
    sql.includes("SET won_amount_cents")
  ) {
    const [uniqueId, amountCents] = params as [string, number];
    const hit = [...store.tickets.values()].find((x) => x.unique_id === uniqueId);
    if (!hit) return { rows: [], rowCount: 0 };
    hit.won_amount_cents = amountCents;
    hit.is_winning_distributed = true;
    hit.winning_distributed_at = new Date();
    hit.updated_at = new Date();
    return { rows: [], rowCount: 1 };
  }

  // SELECT id FROM cashouts WHERE ticket_unique_id = $1
  if (t.startsWith("SELECT") && isCashouts && sql.includes("WHERE ticket_unique_id = $1 LIMIT 1")) {
    const [uniqueId] = params as [string];
    const hit = store.cashouts.get(uniqueId);
    return hit ? { rows: [{ id: hit.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
  }

  // INSERT INTO cashouts
  if (t.startsWith("INSERT") && isCashouts) {
    const [id, ticketUniqueId, hallId, gameId, payoutCents, paidBy, notes, otherDataJson] =
      params as [string, string, string, string | null, number, string, string | null, string];
    if (store.cashouts.has(ticketUniqueId)) {
      const err = new Error("duplicate key value violates unique constraint ticket_unique_id") as Error & { code?: string };
      err.code = "23505";
      throw err;
    }
    const row: CashoutRow = {
      id,
      ticket_unique_id: ticketUniqueId,
      hall_id: hallId,
      game_id: gameId,
      payout_cents: payoutCents,
      paid_by: paidBy,
      paid_at: new Date(),
      notes,
      other_data: JSON.parse(otherDataJson) as Record<string, unknown>,
    };
    store.cashouts.set(ticketUniqueId, row);
    return { rows: [], rowCount: 1 };
  }

  throw new Error(`unhandled SQL: ${t.slice(0, 200)}`);
}

function makePool(store: Store): Pool {
  const pool = {
    async connect() {
      return {
        async query(sql: string, params?: unknown[]) {
          return runQuery(store, sql, params ?? []);
        },
        release() {},
      };
    },
    async query(sql: string, params?: unknown[]) {
      return runQuery(store, sql, params ?? []);
    },
  };
  return pool as unknown as Pool;
}

const EVAL_TIME = new Date("2026-04-20T10:00:00Z");

// ── Tests ────────────────────────────────────────────────────────────────

test("BIN-639: rewardAll — happy path, rewards flere vinner-tickets", async () => {
  const store = newStore();
  // To stemplet vinner-tickets + én tapt + én ikke-stemplet
  store.tickets.set("t-100", makeTicket({
    unique_id: "100", pattern_won: "row_1", evaluated_at: EVAL_TIME,
  }));
  store.tickets.set("t-101", makeTicket({
    unique_id: "101", pattern_won: "full_house", evaluated_at: EVAL_TIME,
  }));

  const svc = PhysicalTicketService.forTesting(makePool(store));
  const result = await svc.rewardAll({
    gameId: "game-42",
    actorId: "admin-1",
    rewards: [
      { uniqueId: "100", amountCents: 5000 },
      { uniqueId: "101", amountCents: 50000 },
    ],
  });

  assert.equal(result.rewardedCount, 2);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.totalPayoutCents, 55000);
  assert.equal(result.details.length, 2);
  assert.equal(result.details[0]!.status, "rewarded");
  assert.equal(result.details[0]!.amountCents, 5000);
  assert.equal(result.details[0]!.hallId, "hall-a");
  assert.ok(result.details[0]!.cashoutId);
  assert.equal(result.details[1]!.status, "rewarded");
  assert.equal(result.details[1]!.amountCents, 50000);

  // Verify tickets updated
  assert.equal(store.tickets.get("t-100")!.is_winning_distributed, true);
  assert.equal(store.tickets.get("t-100")!.won_amount_cents, 5000);
  assert.ok(store.tickets.get("t-100")!.winning_distributed_at);
  // Verify cashouts created
  assert.equal(store.cashouts.size, 2);
  assert.equal(store.cashouts.get("100")!.payout_cents, 5000);
  assert.equal(store.cashouts.get("101")!.payout_cents, 50000);
});

test("BIN-639: rewardAll — idempotens: 2x call = 1x reward, 2. gang skipped", async () => {
  const store = newStore();
  store.tickets.set("t-100", makeTicket({
    unique_id: "100", pattern_won: "row_1", evaluated_at: EVAL_TIME,
  }));

  const svc = PhysicalTicketService.forTesting(makePool(store));
  const first = await svc.rewardAll({
    gameId: "game-42",
    actorId: "admin-1",
    rewards: [{ uniqueId: "100", amountCents: 5000 }],
  });
  assert.equal(first.rewardedCount, 1);
  assert.equal(first.details[0]!.status, "rewarded");

  const second = await svc.rewardAll({
    gameId: "game-42",
    actorId: "admin-1",
    rewards: [{ uniqueId: "100", amountCents: 5000 }],
  });
  assert.equal(second.rewardedCount, 0);
  assert.equal(second.skippedCount, 1);
  assert.equal(second.details[0]!.status, "skipped_already_distributed");

  // Ingen dupliserte cashouts
  assert.equal(store.cashouts.size, 1);
});

test("BIN-639: rewardAll — skipper ikke-stemplet ticket (evaluated_at IS NULL)", async () => {
  const store = newStore();
  store.tickets.set("t-100", makeTicket({
    unique_id: "100", pattern_won: null, evaluated_at: null,
  }));

  const svc = PhysicalTicketService.forTesting(makePool(store));
  const result = await svc.rewardAll({
    gameId: "game-42",
    actorId: "admin-1",
    rewards: [{ uniqueId: "100", amountCents: 5000 }],
  });
  assert.equal(result.rewardedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.details[0]!.status, "skipped_not_stamped");
  assert.equal(store.cashouts.size, 0);
  assert.equal(store.tickets.get("t-100")!.is_winning_distributed, false);
});

test("BIN-639: rewardAll — skipper tapende stemplet ticket (pattern_won IS NULL)", async () => {
  const store = newStore();
  store.tickets.set("t-100", makeTicket({
    unique_id: "100", pattern_won: null, evaluated_at: EVAL_TIME,
  }));

  const svc = PhysicalTicketService.forTesting(makePool(store));
  const result = await svc.rewardAll({
    gameId: "game-42",
    actorId: "admin-1",
    rewards: [{ uniqueId: "100", amountCents: 5000 }],
  });
  assert.equal(result.rewardedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.details[0]!.status, "skipped_not_won");
  assert.equal(store.cashouts.size, 0);
});

test("BIN-639: rewardAll — skipper ticket med wrong gameId", async () => {
  const store = newStore();
  store.tickets.set("t-100", makeTicket({
    unique_id: "100",
    assigned_game_id: "game-99",
    pattern_won: "row_1",
    evaluated_at: EVAL_TIME,
  }));

  const svc = PhysicalTicketService.forTesting(makePool(store));
  const result = await svc.rewardAll({
    gameId: "game-42",
    actorId: "admin-1",
    rewards: [{ uniqueId: "100", amountCents: 5000 }],
  });
  assert.equal(result.rewardedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.details[0]!.status, "skipped_wrong_game");
  assert.equal(store.cashouts.size, 0);
});

test("BIN-639: rewardAll — ticket-not-found returnerer detail, ikke throw", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const result = await svc.rewardAll({
    gameId: "game-42",
    actorId: "admin-1",
    rewards: [{ uniqueId: "ghost", amountCents: 5000 }],
  });
  assert.equal(result.rewardedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.details[0]!.status, "ticket_not_found");
});

test("BIN-639: rewardAll — blander vellykkede og skippede i samme call", async () => {
  const store = newStore();
  store.tickets.set("t-100", makeTicket({
    unique_id: "100", pattern_won: "row_1", evaluated_at: EVAL_TIME,
  }));
  store.tickets.set("t-101", makeTicket({
    unique_id: "101", pattern_won: null, evaluated_at: null,  // ikke-stemplet
  }));
  store.tickets.set("t-102", makeTicket({
    unique_id: "102", pattern_won: "full_house", evaluated_at: EVAL_TIME,
  }));

  const svc = PhysicalTicketService.forTesting(makePool(store));
  const result = await svc.rewardAll({
    gameId: "game-42",
    actorId: "admin-1",
    rewards: [
      { uniqueId: "100", amountCents: 5000 },
      { uniqueId: "101", amountCents: 5000 },
      { uniqueId: "102", amountCents: 50000 },
      { uniqueId: "ghost", amountCents: 100 },
    ],
  });
  assert.equal(result.rewardedCount, 2);
  assert.equal(result.skippedCount, 2);
  assert.equal(result.totalPayoutCents, 55000);
  assert.equal(result.details[0]!.status, "rewarded");
  assert.equal(result.details[1]!.status, "skipped_not_stamped");
  assert.equal(result.details[2]!.status, "rewarded");
  assert.equal(result.details[3]!.status, "ticket_not_found");
});

test("BIN-639: rewardAll — skipper hvis cashout allerede eksisterer (BIN-640 cross-race)", async () => {
  const store = newStore();
  store.tickets.set("t-100", makeTicket({
    unique_id: "100", pattern_won: "row_1", evaluated_at: EVAL_TIME,
    // ikke distribuert-flag satt — men cashout finnes (fra BIN-640 single-cashout)
  }));
  store.cashouts.set("100", {
    id: "ptcash-existing", ticket_unique_id: "100", hall_id: "hall-a", game_id: "game-42",
    payout_cents: 5000, paid_by: "op-1", paid_at: new Date(), notes: null, other_data: {},
  });

  const svc = PhysicalTicketService.forTesting(makePool(store));
  const result = await svc.rewardAll({
    gameId: "game-42",
    actorId: "admin-1",
    rewards: [{ uniqueId: "100", amountCents: 5000 }],
  });
  assert.equal(result.rewardedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.details[0]!.status, "skipped_already_distributed");
  // Ticket ikke mutert
  assert.equal(store.tickets.get("t-100")!.is_winning_distributed, false);
  // Cashouts uendret
  assert.equal(store.cashouts.size, 1);
});

test("BIN-639: rewardAll — invalid amountCents returnerer invalid_amount-detail", async () => {
  const store = newStore();
  store.tickets.set("t-100", makeTicket({
    unique_id: "100", pattern_won: "row_1", evaluated_at: EVAL_TIME,
  }));
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const result = await svc.rewardAll({
    gameId: "game-42",
    actorId: "admin-1",
    rewards: [
      { uniqueId: "100", amountCents: -5 },
    ],
  });
  assert.equal(result.rewardedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(result.details[0]!.status, "invalid_amount");
  // Ingen mutasjon
  assert.equal(store.cashouts.size, 0);
});

test("BIN-639: rewardAll — tom rewards-array returnerer 0 rewarded", async () => {
  const store = newStore();
  const svc = PhysicalTicketService.forTesting(makePool(store));
  const result = await svc.rewardAll({
    gameId: "game-42",
    actorId: "admin-1",
    rewards: [],
  });
  assert.equal(result.rewardedCount, 0);
  assert.equal(result.skippedCount, 0);
  assert.equal(result.totalPayoutCents, 0);
  assert.equal(result.details.length, 0);
});
