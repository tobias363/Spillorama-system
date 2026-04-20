/**
 * BIN-693 — startGame fallback color-lookup.
 *
 * Bug observed on staging: player armed 6 different small-colour brett
 * (Yellow, White, Purple, Red, Green, Orange — 1 each). Pre-round
 * displayed them correctly (BIN-688). But when the round started, ALL 6
 * brett rendered as "Small Yellow".
 *
 * Root cause: In `startGame`, the per-selection ticket-generation loop
 * resolved `ticketTypes` with `.find(t => t.type === sel.type)` only.
 * Every `small` selection matched the FIRST small entry in the variant
 * config (typically Small Yellow). `sel.name` (the BIN-688 colour
 * distinguisher) was ignored. All 6 brett got `color = "Small Yellow"`.
 *
 * Fix: Prefer `sel.name` when present, fall back to `sel.type` —
 * mirroring `expandSelectionsToTicketColors` so pre-round and live-round
 * resolve colours identically.
 *
 * NB: This path is hit when BIN-690 adoption is NOT active (either
 * because the display-cache has a count mismatch, or because BIN-690
 * hasn't been deployed yet — as is the case on staging at the moment
 * Tobias observed the bug). BIN-690 is the primary fix; BIN-693 is
 * defence-in-depth so the fallback path also returns correct colours.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "./BingoEngine.js";
import { InMemoryWalletAdapter } from "./BingoEngine.test.js";
import type { BingoSystemAdapter, CreateTicketInput } from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "./types.js";
import type { GameVariantConfig } from "./variantConfig.js";

const FIXED_GRID = [
  [1, 2, 3, 4, 5],
  [13, 14, 15, 16, 17],
  [25, 26, 0, 27, 28],
  [37, 38, 39, 40, 41],
  [49, 50, 51, 52, 53],
];

/**
 * Captures each createTicket call so the test can assert what colour+type
 * the engine asked for. Returns a fixed grid so the engine is happy.
 */
class CapturingAdapter implements BingoSystemAdapter {
  readonly calls: Array<{ color?: string; type?: string }> = [];
  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    this.calls.push({ color: input.color, type: input.type });
    return {
      grid: FIXED_GRID.map((row) => [...row]),
      color: input.color,
      type: input.type,
    };
  }
}

const DEFAULT_STANDARD: GameVariantConfig = {
  ticketTypes: [
    { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
    { name: "Small White",  type: "small", priceMultiplier: 1, ticketCount: 1 },
    { name: "Small Purple", type: "small", priceMultiplier: 1, ticketCount: 1 },
    { name: "Small Red",    type: "small", priceMultiplier: 1, ticketCount: 1 },
    { name: "Small Green",  type: "small", priceMultiplier: 1, ticketCount: 1 },
    { name: "Small Orange", type: "small", priceMultiplier: 1, ticketCount: 1 },
    { name: "Large White",  type: "large", priceMultiplier: 3, ticketCount: 3 },
  ],
  patterns: [{ name: "Full House", claimType: "BINGO", prizePercent: 100, design: 0 }],
};

async function makeEngine(adapter: BingoSystemAdapter = new CapturingAdapter()) {
  const engine = new BingoEngine(adapter, new InMemoryWalletAdapter());
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "hall-test", playerName: "Host", walletId: "w-host",
  });
  await engine.joinRoom({ roomCode, hallId: "hall-test", playerName: "Guest", walletId: "w-guest" });
  return { engine, roomCode, hostPlayerId: playerId, adapter };
}

test("BIN-693: each small selection gets its OWN name-matched colour (6-colour staging case)", async () => {
  const adapter = new CapturingAdapter();
  const { engine, roomCode, hostPlayerId } = await makeEngine(adapter);

  await engine.startGame({
    roomCode,
    actorPlayerId: hostPlayerId,
    entryFee: 10,
    ticketsPerPlayer: 6,
    payoutPercent: 80,
    armedPlayerIds: [hostPlayerId],
    armedPlayerTicketCounts: { [hostPlayerId]: 6 },
    armedPlayerSelections: {
      [hostPlayerId]: [
        { type: "small", name: "Small Yellow", qty: 1 },
        { type: "small", name: "Small White", qty: 1 },
        { type: "small", name: "Small Purple", qty: 1 },
        { type: "small", name: "Small Red", qty: 1 },
        { type: "small", name: "Small Green", qty: 1 },
        { type: "small", name: "Small Orange", qty: 1 },
      ],
    },
    gameType: "standard",
    variantConfig: DEFAULT_STANDARD,
  });

  const hostCalls = adapter.calls;
  assert.equal(hostCalls.length, 6, "6 brett generert");
  assert.deepEqual(
    hostCalls.map((c) => c.color),
    ["Small Yellow", "Small White", "Small Purple", "Small Red", "Small Green", "Small Orange"],
    "each selection resolves to its own name — NOT all Small Yellow",
  );
});

test("BIN-693: legacy client without `name` still resolves via type fallback (backward compat)", async () => {
  const adapter = new CapturingAdapter();
  const { engine, roomCode, hostPlayerId } = await makeEngine(adapter);

  await engine.startGame({
    roomCode,
    actorPlayerId: hostPlayerId,
    entryFee: 10,
    ticketsPerPlayer: 2,
    payoutPercent: 80,
    armedPlayerIds: [hostPlayerId],
    armedPlayerTicketCounts: { [hostPlayerId]: 2 },
    armedPlayerSelections: {
      // No `name` field — legacy Unity-fallback client path.
      [hostPlayerId]: [{ type: "small", qty: 2 }],
    },
    gameType: "standard",
    variantConfig: DEFAULT_STANDARD,
  });

  const colors = adapter.calls.map((c) => c.color);
  // Without name, all small selections land on the FIRST config entry —
  // acceptable degraded behaviour, better than a crash.
  assert.equal(colors.length, 2);
  assert.equal(colors[0], "Small Yellow");
  assert.equal(colors[1], "Small Yellow");
});

test("BIN-693: Large bundle (name-matched) expands to 3 brett of the same Large colour", async () => {
  const adapter = new CapturingAdapter();
  const { engine, roomCode, hostPlayerId } = await makeEngine(adapter);

  await engine.startGame({
    roomCode,
    actorPlayerId: hostPlayerId,
    entryFee: 10,
    ticketsPerPlayer: 3,
    payoutPercent: 80,
    armedPlayerIds: [hostPlayerId],
    armedPlayerTicketCounts: { [hostPlayerId]: 3 },
    armedPlayerSelections: {
      [hostPlayerId]: [{ type: "large", name: "Large White", qty: 1 }],
    },
    gameType: "standard",
    variantConfig: DEFAULT_STANDARD,
  });

  const colors = adapter.calls.map((c) => c.color);
  assert.equal(colors.length, 3, "Large bundle = 3 brett");
  for (const c of colors) {
    assert.equal(c, "Large White");
  }
});

test("BIN-693: mixed selection keeps each brett's own colour through createTicket", async () => {
  const adapter = new CapturingAdapter();
  const { engine, roomCode, hostPlayerId } = await makeEngine(adapter);

  await engine.startGame({
    roomCode,
    actorPlayerId: hostPlayerId,
    entryFee: 10,
    ticketsPerPlayer: 4,
    payoutPercent: 80,
    armedPlayerIds: [hostPlayerId],
    armedPlayerTicketCounts: { [hostPlayerId]: 4 },
    armedPlayerSelections: {
      [hostPlayerId]: [
        { type: "small", name: "Small Purple", qty: 1 },
        { type: "large", name: "Large White", qty: 1 }, // 3 brett
      ],
    },
    gameType: "standard",
    variantConfig: DEFAULT_STANDARD,
  });

  const colors = adapter.calls.map((c) => c.color);
  assert.equal(colors.length, 4);
  assert.equal(colors[0], "Small Purple", "first brett stays Small Purple");
  assert.equal(colors[1], "Large White", "Large bundle brett 1");
  assert.equal(colors[2], "Large White", "Large bundle brett 2");
  assert.equal(colors[3], "Large White", "Large bundle brett 3");
});
