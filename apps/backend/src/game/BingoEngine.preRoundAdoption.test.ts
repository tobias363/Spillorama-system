/**
 * BIN-690 — pre-round brett-adopsjon.
 *
 * Bug: Før runden starter rendret klienten `preRoundTickets` fra
 * `getOrCreateDisplayTickets` (random grid, cached per room+player).
 * Ved `game:start` kalte `engine.startGame` → `bingoAdapter.createTicket`
 * og genererte HELT NYE random grid. Resultat: brettet spilleren så før
 * runden hadde ikke samme tall som brettet de faktisk spilte med.
 *
 * Fix: `startGame` godtar nå `preRoundTicketsByPlayerId` — når cachen
 * passerer count-sjekken, adopteres cached brett (grid + color + id) som
 * de ekte bongene istedenfor å generere nye random grid.
 *
 * Tester kontrakten ved å bruke en `FixedTicketBingoAdapter` som ville
 * ha generert et fast `FIXED_GRID` for hver createTicket — og et totally
 * annet `CACHED_GRID` som pre-round. Etter startGame verifiserer vi at
 * brettene har CACHED_GRID (adopsjon), ikke FIXED_GRID (regenerering).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";

// ── Minimal stubs ──────────────────────────────────────────────────────────

const FIXED_GRID = [
  [1, 2, 3, 4, 5],
  [13, 14, 15, 16, 17],
  [25, 26, 0, 27, 28],
  [37, 38, 39, 40, 41],
  [49, 50, 51, 52, 53],
];

class FixedTicketBingoAdapter implements BingoSystemAdapter {
  async createTicket(_input: CreateTicketInput): Promise<Ticket> {
    return { grid: FIXED_GRID.map((row) => [...row]) };
  }
}

async function makeEngine(): Promise<{ engine: BingoEngine; roomCode: string; hostPlayerId: string }> {
  const engine = new BingoEngine(new FixedTicketBingoAdapter(), new InMemoryWalletAdapter());
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "hall-test", playerName: "Host", walletId: "w-host",
  });
  await engine.joinRoom({ roomCode, hallId: "hall-test", playerName: "Guest", walletId: "w-guest" });
  return { engine, roomCode, hostPlayerId: playerId };
}

// ── Tests ──────────────────────────────────────────────────────────────────

const CACHED_GRID = [
  [6, 17, 34, 47, 68],
  [10, 19, 35, 49, 69],
  [12, 25, 0, 50, 70],
  [13, 26, 38, 56, 71],
  [15, 29, 44, 58, 72],
];

test("BIN-690: startGame adopterer preRoundTicketsByPlayerId som de ekte brettene", async () => {
  const { engine, roomCode, hostPlayerId } = await makeEngine();

  const cachedTicket: Ticket = {
    grid: CACHED_GRID.map((row) => [...row]),
    id: "tkt-0",
    color: "Small Yellow",
    type: "small",
  };

  await engine.startGame({
    roomCode,
    actorPlayerId: hostPlayerId,
    entryFee: 10,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    armedPlayerIds: [hostPlayerId],
    armedPlayerTicketCounts: { [hostPlayerId]: 1 },
    preRoundTicketsByPlayerId: { [hostPlayerId]: [cachedTicket] },
  });

  const snapshot = engine.getRoomSnapshot(roomCode);
  const tickets = snapshot?.currentGame?.tickets[hostPlayerId] ?? [];
  assert.equal(tickets.length, 1, "host skal ha 1 brett");
  assert.deepEqual(tickets[0].grid, CACHED_GRID, "grid må være CACHED_GRID (adoptert), ikke FIXED_GRID (regenerert)");
  assert.equal(tickets[0].color, "Small Yellow", "color bevares");
  assert.equal(tickets[0].type, "small", "type bevares");
  assert.equal(tickets[0].id, "tkt-0", "id bevares stabilt fra pre-round");
});

test("BIN-690: uten preRoundTicketsByPlayerId faller tilbake til normal generering", async () => {
  const { engine, roomCode, hostPlayerId } = await makeEngine();

  await engine.startGame({
    roomCode,
    actorPlayerId: hostPlayerId,
    entryFee: 10,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    armedPlayerIds: [hostPlayerId],
    armedPlayerTicketCounts: { [hostPlayerId]: 1 },
  });

  const snapshot = engine.getRoomSnapshot(roomCode);
  const tickets = snapshot?.currentGame?.tickets[hostPlayerId] ?? [];
  assert.equal(tickets.length, 1);
  assert.deepEqual(tickets[0].grid, FIXED_GRID, "uten cache, createTicket genererer FIXED_GRID");
});

test("BIN-690: defensive fallback når count mismatcher (cache stale)", async () => {
  // Pre-round cache har 1 brett, men armed-count er 2 (arming endret seg
  // etter siste room:update — cachen er utdatert). Engine må IKKE adoptere
  // 1 og generere 1 til — da blir brettet brukeren så i pre-round blandet
  // med et helt annet brett. Fallback: full normal generering, alle brett
  // fra createTicket (kjent adferd).
  const { engine, roomCode, hostPlayerId } = await makeEngine();

  const cachedTicket: Ticket = {
    grid: CACHED_GRID.map((row) => [...row]),
    id: "tkt-0",
    color: "Small Yellow",
    type: "small",
  };

  await engine.startGame({
    roomCode,
    actorPlayerId: hostPlayerId,
    entryFee: 10,
    ticketsPerPlayer: 2,
    payoutPercent: 80,
    armedPlayerIds: [hostPlayerId],
    armedPlayerTicketCounts: { [hostPlayerId]: 2 },
    preRoundTicketsByPlayerId: { [hostPlayerId]: [cachedTicket] }, // kun 1, trenger 2
  });

  const snapshot = engine.getRoomSnapshot(roomCode);
  const tickets = snapshot?.currentGame?.tickets[hostPlayerId] ?? [];
  assert.equal(tickets.length, 2);
  // Begge brett er FIXED_GRID (fallback til createTicket), ikke 1 CACHED + 1 FIXED.
  assert.deepEqual(tickets[0].grid, FIXED_GRID);
  assert.deepEqual(tickets[1].grid, FIXED_GRID);
});

test("BIN-690: adopsjon kopierer brett-objektet (cache-mutasjon lekker ikke)", async () => {
  const { engine, roomCode, hostPlayerId } = await makeEngine();

  const cachedTicket: Ticket = {
    grid: CACHED_GRID.map((row) => [...row]),
    id: "tkt-0",
    color: "Small Yellow",
    type: "small",
  };
  const preRound = { [hostPlayerId]: [cachedTicket] };

  await engine.startGame({
    roomCode,
    actorPlayerId: hostPlayerId,
    entryFee: 10,
    ticketsPerPlayer: 1,
    payoutPercent: 80,
    armedPlayerIds: [hostPlayerId],
    armedPlayerTicketCounts: { [hostPlayerId]: 1 },
    preRoundTicketsByPlayerId: preRound,
  });

  const snapshot = engine.getRoomSnapshot(roomCode);
  const liveTicket = snapshot?.currentGame?.tickets[hostPlayerId][0];
  assert.notStrictEqual(liveTicket, cachedTicket, "live ticket er en kopi, ikke samme referanse som cached");
});
