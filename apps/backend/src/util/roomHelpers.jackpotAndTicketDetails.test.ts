/**
 * roomHelpers — F3 jackpot propagation + G15 ticket-detail enrichment.
 *
 * Unity refs:
 *   - F3: Game1GamePlayPanel.SocketFlow.cs:518-520 (jackpot label)
 *   - G15: BingoTicket.cs:374-399 (ticket-detail fields on flip)
 *
 * Exercised paths:
 *   1. variantConfig.jackpot flows into gameVariant.jackpot on the payload.
 *   2. getHallName + supplierName enrich both in-game and pre-round tickets.
 *   3. When getHallName returns null, the payload falls back to the hallId.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { GameSnapshot, RoomSnapshot, Ticket } from "../game/types.js";
import type { GameVariantConfig } from "../game/variantConfig.js";
import type { DrawScheduler } from "../draw-engine/DrawScheduler.js";
import type { BingoSchedulerSettings } from "./bingoSettings.js";
import { buildRoomUpdatePayload } from "./roomHelpers.js";

const FAKE_SETTINGS: BingoSchedulerSettings = {
  autoRoundStartEnabled: false,
  autoRoundStartIntervalMs: 60_000,
  autoRoundMinPlayers: 2,
  autoRoundEntryFee: 10,
  autoRoundTicketsPerPlayer: 2,
  payoutPercent: 80,
  autoDrawEnabled: false,
  autoDrawIntervalMs: 3000,
};

const FAKE_SCHEDULER = {
  normalizeNextAutoStartAt: () => null,
} as unknown as DrawScheduler;

function baseSnapshot(): RoomSnapshot {
  return {
    code: "ROOM1",
    hallId: "hall-oslo",
    hostPlayerId: "p1",
    gameSlug: "bingo",
    createdAt: new Date("2026-04-18T14:00:00Z").toISOString(),
    players: [
      { id: "p1", name: "Ada", walletId: "w1", balance: 500 },
    ],
    gameHistory: [],
  };
}

function gameSnapshot(): GameSnapshot {
  return {
    id: "g1",
    status: "RUNNING",
    entryFee: 10,
    ticketsPerPlayer: 2,
    prizePool: 100,
    remainingPrizePool: 100,
    payoutPercent: 80,
    maxPayoutBudget: 80,
    remainingPayoutBudget: 80,
    drawBag: [],
    drawnNumbers: [],
    remainingNumbers: 60,
    claims: [],
    tickets: {
      p1: [
        { grid: [[1,2,3,4,5],[6,7,8,9,10],[11,12,13,14,15]], id: "t1", type: "small", color: "Small Yellow" },
      ],
    },
    marks: { p1: [[]] },
    startedAt: new Date("2026-04-18T14:00:00Z").toISOString(),
  };
}

function variantConfig(): GameVariantConfig {
  return {
    ticketTypes: [
      { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
    ],
    patterns: [],
    jackpot: { drawThreshold: 56, prize: 12500, isDisplay: true },
  };
}

function buildOpts(overrides: Partial<Parameters<typeof buildRoomUpdatePayload>[2]> = {}): Parameters<typeof buildRoomUpdatePayload>[2] {
  return {
    runtimeBingoSettings: FAKE_SETTINGS,
    drawScheduler: FAKE_SCHEDULER,
    bingoMaxDrawsPerRound: 60,
    schedulerTickMs: 1000,
    getArmedPlayerIds: () => [],
    getArmedPlayerTicketCounts: () => ({}),
    getArmedPlayerSelections: () => ({}),
    getRoomConfiguredEntryFee: () => 10,
    getOrCreateDisplayTickets: () => [],
    getLuckyNumbers: () => ({}),
    getVariantConfig: () => ({ gameType: "standard", config: variantConfig() }),
    getHallName: (hallId: string) => (hallId === "hall-oslo" ? "Oslo Sentrum" : null),
    supplierName: "Spillorama",
    ...overrides,
  };
}

test("F3: buildRoomUpdatePayload includes gameVariant.jackpot when configured", () => {
  const snap: RoomSnapshot = { ...baseSnapshot(), currentGame: gameSnapshot() };
  const payload = buildRoomUpdatePayload(snap, Date.now(), buildOpts());
  assert.deepEqual(payload.gameVariant?.jackpot, {
    drawThreshold: 56,
    prize: 12500,
    isDisplay: true,
  });
});

test("F3: gameVariant.jackpot is undefined when the variant has no jackpot", () => {
  const cfg = variantConfig();
  delete cfg.jackpot;
  const snap: RoomSnapshot = { ...baseSnapshot(), currentGame: gameSnapshot() };
  const payload = buildRoomUpdatePayload(snap, Date.now(), buildOpts({
    getVariantConfig: () => ({ gameType: "standard", config: cfg }),
  }));
  assert.equal(payload.gameVariant?.jackpot, undefined);
});

test("G15: in-game tickets get ticketNumber, hallName, supplierName, price, boughtAt", () => {
  const snap: RoomSnapshot = { ...baseSnapshot(), currentGame: gameSnapshot() };
  const nowMs = Date.parse("2026-04-18T14:32:00Z");
  const payload = buildRoomUpdatePayload(snap, nowMs, buildOpts());
  const t: Ticket = payload.currentGame!.tickets.p1[0];
  assert.equal(t.ticketNumber, "t1", "ticketNumber falls back to id when not pre-set");
  assert.equal(t.hallName, "Oslo Sentrum");
  assert.equal(t.supplierName, "Spillorama");
  assert.equal(t.price, 10);
  assert.equal(t.boughtAt, new Date(nowMs).toISOString());
});

test("G15: falls back to hallId when getHallName returns null", () => {
  const snap: RoomSnapshot = { ...baseSnapshot(), currentGame: gameSnapshot() };
  const payload = buildRoomUpdatePayload(snap, Date.now(), buildOpts({
    getHallName: () => null,
  }));
  const t: Ticket = payload.currentGame!.tickets.p1[0];
  assert.equal(t.hallName, "hall-oslo");
});

test("G15: pre-round display tickets are enriched too", () => {
  const snap = baseSnapshot();
  // BIN-686: pre-round tickets now only generate for ARMED players.
  // Arm p1 with 1 ticket so the preRound entry exists and we can verify
  // enrichment (hallName, supplierName, price, boughtAt).
  const payload = buildRoomUpdatePayload(snap, Date.now(), buildOpts({
    getArmedPlayerTicketCounts: () => ({ p1: 1 }),
    getOrCreateDisplayTickets: () => [
      { grid: [[1,2,3,4,5],[6,7,8,9,10],[11,12,13,14,15]], id: "tkt-0", type: "small" },
    ],
  }));
  const t: Ticket = payload.preRoundTickets.p1[0];
  assert.equal(t.hallName, "Oslo Sentrum");
  assert.equal(t.supplierName, "Spillorama");
  assert.equal(typeof t.price, "number");
  assert.equal(typeof t.boughtAt, "string");
});

test("G15: does not overwrite ticket fields that are already populated", () => {
  const snap: RoomSnapshot = { ...baseSnapshot(), currentGame: gameSnapshot() };
  snap.currentGame!.tickets.p1[0].ticketNumber = "PRE-42";
  snap.currentGame!.tickets.p1[0].hallName = "Custom Hall";
  const payload = buildRoomUpdatePayload(snap, Date.now(), buildOpts());
  const t: Ticket = payload.currentGame!.tickets.p1[0];
  assert.equal(t.ticketNumber, "PRE-42");
  assert.equal(t.hallName, "Custom Hall");
});

// ── BIN-686 Bug 1: unarmed players get NO pre-round tickets ────────────

test("BIN-686 Bug 1: unarmed player gets NO preRoundTickets entry", () => {
  const snap = baseSnapshot();  // p1 is in players, but we won't arm them
  let displayTicketsCalls = 0;
  const payload = buildRoomUpdatePayload(snap, Date.now(), buildOpts({
    // Explicitly: p1 is not armed — returns empty object
    getArmedPlayerTicketCounts: () => ({}),
    getOrCreateDisplayTickets: () => {
      displayTicketsCalls += 1;
      return [{ grid: [[1,2,3,4,5],[6,7,8,9,10],[11,12,13,14,15]], id: "tkt-0", type: "small" }];
    },
  }));
  // Zero display-ticket generation for unarmed players — the auto-preview
  // behavior that misled users ("Kjøpt: 4" without buying) is gone.
  assert.equal(displayTicketsCalls, 0, "getOrCreateDisplayTickets must NOT be called for unarmed players");
  // No preRoundTickets entry for p1.
  assert.equal(payload.preRoundTickets.p1, undefined);
});

test("BIN-686 Bug 1: armed player gets preRoundTickets with their chosen count", () => {
  const snap = baseSnapshot();
  let receivedCount: number | null = null;
  const payload = buildRoomUpdatePayload(snap, Date.now(), buildOpts({
    getArmedPlayerTicketCounts: () => ({ p1: 3 }),
    getOrCreateDisplayTickets: (_code, _id, count) => {
      receivedCount = count;
      return Array.from({ length: count }, (_, i) => ({
        grid: [[1,2,3,4,5],[6,7,8,9,10],[11,12,13,14,15]],
        id: `tkt-${i}`,
        type: "small",
      }));
    },
  }));
  assert.equal(receivedCount, 3, "armed count (3) flows through to getOrCreateDisplayTickets");
  assert.ok(payload.preRoundTickets.p1, "armed player has preRoundTickets entry");
  assert.equal(payload.preRoundTickets.p1.length, 3);
});

test("BIN-686 Bug 1: armed count <= 0 is treated as unarmed", () => {
  const snap = baseSnapshot();
  const payload = buildRoomUpdatePayload(snap, Date.now(), buildOpts({
    // Pathological: armed but with 0 count (defensive — never should happen
    // via proper arming, but guard against it).
    getArmedPlayerTicketCounts: () => ({ p1: 0 }),
    getOrCreateDisplayTickets: () => [{ grid: [[1,2,3,4,5]], id: "oops", type: "small" }],
  }));
  assert.equal(payload.preRoundTickets.p1, undefined, "armed=0 behaves as unarmed");
});
