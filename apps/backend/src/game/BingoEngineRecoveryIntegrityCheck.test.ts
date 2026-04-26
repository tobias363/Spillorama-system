/**
 * HIGH-4 (Casino Review): tester for post-recovery integritetssjekk.
 *
 * Verifiserer at `runRecoveryIntegrityCheck`:
 *   1. Detekterer drift når in-memory `drawnNumbers` != PG-checkpoint.
 *   2. Detekterer drift når ticket-spiller-sett er forskjellig.
 *   3. Detekterer drift når status er forskjellig.
 *   4. Returnerer `ok` for konsistent state.
 *   5. Skipper rom uten currentGame eller uten checkpoint.
 *   6. Inkrementerer Prometheus-counteren `wallet_room_drift_total`.
 *
 * Stress-test mot full Render-restart med 50 spillere er dokumentert
 * som **manuell prod-test** — ikke automatiserbart i unit-test fordi
 * det krever ekte Redis + Postgres + Render-deploy-cycle. Se
 * `docs/operations/HIGH4_RECOVERY_INTEGRITY_TEST_PLAN.md` (TBD) for
 * runbook.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { runRecoveryIntegrityCheck } from "./BingoEngineRecoveryIntegrityCheck.js";
import { metrics } from "../util/metrics.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { RoomStateStore } from "../store/RoomStateStore.js";
import type { GameSnapshot, GameState, RoomState, Ticket } from "./types.js";

// ── Test-doubles ──────────────────────────────────────────────────────

class FakeStore implements RoomStateStore {
  private readonly rooms = new Map<string, RoomState>();
  get(code: string): RoomState | undefined { return this.rooms.get(code); }
  set(code: string, room: RoomState): void { this.rooms.set(code, room); }
  delete(code: string): void { this.rooms.delete(code); }
  has(code: string): boolean { return this.rooms.has(code); }
  keys(): IterableIterator<string> { return this.rooms.keys(); }
  values(): IterableIterator<RoomState> { return this.rooms.values(); }
  get size(): number { return this.rooms.size; }
  async persist(): Promise<void> { /* no-op */ }
  async loadAll(): Promise<number> { return 0; }
  async shutdown(): Promise<void> { /* no-op */ }
}

class FakeAdapter implements BingoSystemAdapter {
  public checkpoints = new Map<string, { snapshot: unknown; players: unknown }>();
  public failNextLookup = false;

  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: [[1, 2, 3, 4, 5], [13, 14, 15, 16, 17], [25, 26, 0, 27, 28], [37, 38, 39, 40, 41], [49, 50, 51, 52, 53]] };
  }

  async getLatestCheckpointData(gameId: string): Promise<{ snapshot: unknown; players: unknown } | null> {
    if (this.failNextLookup) {
      this.failNextLookup = false;
      throw new Error("simulert DB-feil");
    }
    return this.checkpoints.get(gameId) ?? null;
  }
}

// ── Test-fixtures ─────────────────────────────────────────────────────

function makeRoom(opts: {
  code: string;
  gameId: string;
  drawnNumbers: number[];
  ticketPlayerIds: string[];
  status?: "RUNNING" | "ENDED" | "WAITING";
}): RoomState {
  const tickets = new Map<string, Ticket[]>();
  for (const pid of opts.ticketPlayerIds) {
    tickets.set(pid, [{ grid: [[1]] }]);
  }
  const game: GameState = {
    id: opts.gameId,
    status: opts.status ?? "RUNNING",
    entryFee: 10,
    ticketsPerPlayer: 1,
    prizePool: 100,
    remainingPrizePool: 100,
    payoutPercent: 80,
    maxPayoutBudget: 80,
    remainingPayoutBudget: 80,
    drawBag: [],
    drawnNumbers: [...opts.drawnNumbers],
    tickets,
    marks: new Map(),
    claims: [],
    startedAt: new Date().toISOString(),
  };
  return {
    code: opts.code,
    hallId: "hall-1",
    hostPlayerId: opts.ticketPlayerIds[0] ?? "host",
    gameSlug: "bingo",
    players: new Map(),
    currentGame: game,
    gameHistory: [],
    createdAt: new Date().toISOString(),
  };
}

function makeSnapshot(opts: {
  gameId: string;
  drawnNumbers: number[];
  ticketPlayerIds: string[];
  status?: "RUNNING" | "ENDED" | "WAITING";
}): GameSnapshot {
  const tickets: Record<string, Ticket[]> = {};
  for (const pid of opts.ticketPlayerIds) {
    tickets[pid] = [{ grid: [[1]] }];
  }
  return {
    id: opts.gameId,
    status: opts.status ?? "RUNNING",
    entryFee: 10,
    ticketsPerPlayer: 1,
    prizePool: 100,
    remainingPrizePool: 100,
    payoutPercent: 80,
    maxPayoutBudget: 80,
    remainingPayoutBudget: 80,
    drawBag: [],
    drawnNumbers: [...opts.drawnNumbers],
    remainingNumbers: 0,
    tickets,
    marks: {},
    claims: [],
    startedAt: new Date().toISOString(),
  };
}

// ── Tester ─────────────────────────────────────────────────────────────

test("HIGH-4: konsistent state — ok=1, drift=0", async () => {
  const store = new FakeStore();
  const adapter = new FakeAdapter();

  store.set("ROOM1", makeRoom({
    code: "ROOM1",
    gameId: "g1",
    drawnNumbers: [1, 2, 3],
    ticketPlayerIds: ["p1", "p2"],
  }));
  adapter.checkpoints.set("g1", {
    snapshot: makeSnapshot({
      gameId: "g1",
      drawnNumbers: [1, 2, 3],
      ticketPlayerIds: ["p1", "p2"],
    }),
    players: [],
  });

  const result = await runRecoveryIntegrityCheck({ roomStateStore: store, bingoAdapter: adapter });
  assert.equal(result.inspected, 1);
  assert.equal(result.ok, 1);
  assert.equal(result.drift, 0);
  assert.equal(result.driftRooms.length, 0);
});

test("HIGH-4: drawnNumbers-mismatch detekteres", async () => {
  const store = new FakeStore();
  const adapter = new FakeAdapter();
  const before = await metrics.walletRoomDriftTotal.get();
  const baseline = before.values
    .filter((v) => v.labels.room === "ROOM2" && v.labels.field === "drawnNumbers")
    .reduce((s, v) => s + v.value, 0);

  store.set("ROOM2", makeRoom({
    code: "ROOM2",
    gameId: "g2",
    drawnNumbers: [1, 2, 3, 4],   // RAM = 4 trekk
    ticketPlayerIds: ["p1"],
  }));
  adapter.checkpoints.set("g2", {
    snapshot: makeSnapshot({
      gameId: "g2",
      drawnNumbers: [1, 2, 3],     // PG = 3 trekk → drift
      ticketPlayerIds: ["p1"],
    }),
    players: [],
  });

  const result = await runRecoveryIntegrityCheck({ roomStateStore: store, bingoAdapter: adapter });
  assert.equal(result.drift, 1);
  assert.equal(result.driftRooms.length, 1);
  assert.equal(result.driftRooms[0].roomCode, "ROOM2");
  assert.ok(result.driftRooms[0].fields.includes("drawnNumbers"));

  // Counter inkrementert
  const after = await metrics.walletRoomDriftTotal.get();
  const total = after.values
    .filter((v) => v.labels.room === "ROOM2" && v.labels.field === "drawnNumbers")
    .reduce((s, v) => s + v.value, 0);
  assert.equal(total, baseline + 1);
});

test("HIGH-4: ticket-spiller-sett-mismatch detekteres", async () => {
  const store = new FakeStore();
  const adapter = new FakeAdapter();

  store.set("ROOM3", makeRoom({
    code: "ROOM3",
    gameId: "g3",
    drawnNumbers: [1, 2],
    ticketPlayerIds: ["alice", "bob"],
  }));
  adapter.checkpoints.set("g3", {
    snapshot: makeSnapshot({
      gameId: "g3",
      drawnNumbers: [1, 2],
      ticketPlayerIds: ["alice", "bob", "charlie"],   // PG har en ekstra spiller
    }),
    players: [],
  });

  const result = await runRecoveryIntegrityCheck({ roomStateStore: store, bingoAdapter: adapter });
  assert.equal(result.drift, 1);
  assert.ok(result.driftRooms[0].fields.includes("tickets.players"));
});

test("HIGH-4: status-mismatch detekteres", async () => {
  const store = new FakeStore();
  const adapter = new FakeAdapter();

  store.set("ROOM4", makeRoom({
    code: "ROOM4",
    gameId: "g4",
    drawnNumbers: [1, 2],
    ticketPlayerIds: ["p1"],
    status: "RUNNING",
  }));
  adapter.checkpoints.set("g4", {
    snapshot: makeSnapshot({
      gameId: "g4",
      drawnNumbers: [1, 2],
      ticketPlayerIds: ["p1"],
      status: "ENDED",
    }),
    players: [],
  });

  const result = await runRecoveryIntegrityCheck({ roomStateStore: store, bingoAdapter: adapter });
  assert.equal(result.drift, 1);
  assert.ok(result.driftRooms[0].fields.includes("status"));
});

test("HIGH-4: rom uten currentGame skippes", async () => {
  const store = new FakeStore();
  const adapter = new FakeAdapter();

  const room = makeRoom({
    code: "ROOM5",
    gameId: "g5",
    drawnNumbers: [],
    ticketPlayerIds: [],
  });
  delete room.currentGame;
  store.set("ROOM5", room);

  const result = await runRecoveryIntegrityCheck({ roomStateStore: store, bingoAdapter: adapter });
  assert.equal(result.inspected, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.drift, 0);
});

test("HIGH-4: rom uten checkpoint skippes (running men ingen DRAW skrevet enda)", async () => {
  const store = new FakeStore();
  const adapter = new FakeAdapter();

  store.set("ROOM6", makeRoom({
    code: "ROOM6",
    gameId: "g6",
    drawnNumbers: [],
    ticketPlayerIds: ["p1"],
  }));
  // Ingen checkpoint i adapter for "g6".

  const result = await runRecoveryIntegrityCheck({ roomStateStore: store, bingoAdapter: adapter });
  assert.equal(result.inspected, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.drift, 0);
});

test("HIGH-4: DB-feil ved checkpoint-lookup → failures+1, throw aldri", async () => {
  const store = new FakeStore();
  const adapter = new FakeAdapter();

  store.set("ROOM7", makeRoom({
    code: "ROOM7",
    gameId: "g7",
    drawnNumbers: [1, 2],
    ticketPlayerIds: ["p1"],
  }));
  adapter.failNextLookup = true;

  const result = await runRecoveryIntegrityCheck({ roomStateStore: store, bingoAdapter: adapter });
  assert.equal(result.inspected, 1);
  assert.equal(result.failures, 1);
  assert.equal(result.drift, 0);
});

test("HIGH-4: adapter uten getLatestCheckpointData (ikke-PG) returnerer no-op result", async () => {
  const store = new FakeStore();
  const adapter: BingoSystemAdapter = {
    async createTicket() { return { grid: [[1]] }; },
  };
  store.set("ROOM8", makeRoom({
    code: "ROOM8",
    gameId: "g8",
    drawnNumbers: [1],
    ticketPlayerIds: ["p1"],
  }));

  const result = await runRecoveryIntegrityCheck({ roomStateStore: store, bingoAdapter: adapter });
  assert.equal(result.inspected, 0);
  assert.equal(result.drift, 0);
});

test("HIGH-4: simulert restart med inkonsistent state — drift detektert i alle 3 felt", async () => {
  // Stress-test light: ett rom med drift i ALLE tre sjekkpunkter.
  const store = new FakeStore();
  const adapter = new FakeAdapter();

  store.set("ROOMX", makeRoom({
    code: "ROOMX",
    gameId: "gx",
    drawnNumbers: [1, 2, 3, 4, 5],            // RAM
    ticketPlayerIds: ["a", "b"],              // RAM
    status: "RUNNING",                          // RAM
  }));
  adapter.checkpoints.set("gx", {
    snapshot: makeSnapshot({
      gameId: "gx",
      drawnNumbers: [1, 2],                    // PG: kortere
      ticketPlayerIds: ["a", "b", "c"],       // PG: ekstra spiller
      status: "ENDED",                         // PG: avsluttet
    }),
    players: [],
  });

  const result = await runRecoveryIntegrityCheck({ roomStateStore: store, bingoAdapter: adapter });
  assert.equal(result.drift, 1);
  const fields = result.driftRooms[0].fields;
  assert.ok(fields.includes("drawnNumbers"));
  assert.ok(fields.includes("tickets.players"));
  assert.ok(fields.includes("status"));
});
