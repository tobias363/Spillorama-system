/**
 * roomHelpers — round-state-isolation (Tobias 2026-04-25, BIN-CRITICAL).
 *
 * Verifies that `playerStakes` and `playerPendingStakes` correctly separate
 * active-round risk from next-round commitment. The four bugs Tobias
 * reported all stem from these two getting mixed:
 *
 *   1. Pre-purchased tickets visible during active round       → frontend fix
 *   2. Innsats includes pre-round stake                        → THIS test
 *   3. Saldo not updated on bet:arm                            → unchanged
 *   4. Innsats jumps at round-transition                       → THIS test
 *
 * Architecture:
 *   - `playerStakes[id]`        = ACTIVE-ROUND stake. RUNNING + gameTickets
 *                                 → cost. Spectator (RUNNING + no game-tix)
 *                                 → omitted (treated as 0). Between rounds
 *                                 + armed → projected next-round cost.
 *   - `playerPendingStakes[id]` = NEXT-ROUND commitment. Only populated when
 *                                 a game is RUNNING and the player has armed
 *                                 pre-round tickets that will start in the
 *                                 NEXT round. Empty between rounds (the arm
 *                                 IS the active stake at that point).
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
  autoRoundEntryFee: 20,
  autoRoundTicketsPerPlayer: 4,
  payoutPercent: 80,
  autoDrawEnabled: false,
  autoDrawIntervalMs: 3000,
};

const FAKE_SCHEDULER = {
  normalizeNextAutoStartAt: () => null,
} as unknown as DrawScheduler;

const ENTRY_FEE = 20;

function baseSnapshot(): RoomSnapshot {
  return {
    code: "ROOM1",
    hallId: "hall-oslo",
    hostPlayerId: "p1",
    gameSlug: "bingo",
    createdAt: new Date("2026-04-25T10:00:00Z").toISOString(),
    players: [
      { id: "p1", name: "Tobias", walletId: "w1", balance: 1000 },
    ],
    gameHistory: [],
  };
}

function makeTicket(id: string, type = "small", color = "Small Yellow"): Ticket {
  return {
    grid: [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15]],
    id,
    type,
    color,
  };
}

function runningGameSnapshot(playerTickets: Record<string, Ticket[]>): GameSnapshot {
  return {
    id: "g1",
    status: "RUNNING",
    entryFee: ENTRY_FEE,
    ticketsPerPlayer: 4,
    prizePool: 100,
    remainingPrizePool: 100,
    payoutPercent: 80,
    maxPayoutBudget: 80,
    remainingPayoutBudget: 80,
    drawBag: [],
    drawnNumbers: [1, 2, 3, 4, 5, 6, 7, 8],
    remainingNumbers: 67,
    claims: [],
    tickets: playerTickets,
    marks: Object.fromEntries(Object.entries(playerTickets).map(([k, v]) => [k, v.map(() => [])])),
    startedAt: new Date("2026-04-25T10:00:00Z").toISOString(),
  };
}

function variantConfig(): GameVariantConfig {
  return {
    ticketTypes: [
      { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
      { name: "Large Yellow", type: "large", priceMultiplier: 3, ticketCount: 3 },
    ],
    patterns: [],
  };
}

function buildOpts(overrides: Partial<Parameters<typeof buildRoomUpdatePayload>[2]> = {}): Parameters<typeof buildRoomUpdatePayload>[2] {
  return {
    runtimeBingoSettings: FAKE_SETTINGS,
    drawScheduler: FAKE_SCHEDULER,
    bingoMaxDrawsPerRound: 75,
    schedulerTickMs: 1000,
    getArmedPlayerIds: () => [],
    getArmedPlayerTicketCounts: () => ({}),
    getArmedPlayerSelections: () => ({}),
    getRoomConfiguredEntryFee: () => ENTRY_FEE,
    getOrCreateDisplayTickets: (_code, _pid, count, _slug) =>
      Array.from({ length: count }, (_, i) => makeTicket(`pre-${i}`)),
    getLuckyNumbers: () => ({}),
    getVariantConfig: () => ({ gameType: "standard", config: variantConfig() }),
    ...overrides,
  };
}

// ── Bug 2: Innsats must NOT include pre-round during RUNNING ─────────────────

test("Bug 2: RUNNING + spectator + armed for next round → playerStakes is empty (no entry)", () => {
  // Tobias's exact scenario: aktiv runde 8/75 baller, han er ikke deltaker
  // (gameTickets[p1] = []), men har armed 30 small for neste runde.
  // Innsats-feltet skal vise INGENTING / 0, ikke 600 kr.
  const snap: RoomSnapshot = {
    ...baseSnapshot(),
    currentGame: runningGameSnapshot({}), // p1 NOT in tickets (spectator)
  };
  const opts = buildOpts({
    getArmedPlayerIds: () => ["p1"],
    getArmedPlayerTicketCounts: () => ({ p1: 30 }),
    getArmedPlayerSelections: () => ({
      p1: [{ type: "small", qty: 30, name: "Small Yellow" }],
    }),
  });

  const payload = buildRoomUpdatePayload(snap, Date.now(), opts);

  assert.equal(payload.playerStakes.p1, undefined, "spectator må ikke ha aktiv-runde-innsats");
  assert.equal(payload.playerPendingStakes.p1, 600, "pre-round 30 × 20 kr = 600 kr i pending");
});

test("Bug 2: RUNNING + active participant (4 brett) + ALSO armed for next (50 brett) → stake = 80, pending = 1000", () => {
  // Mid-round additive arm: spilleren har 4 live-brett OG har armet 50 for
  // neste runde. Innsats skal kun reflektere de 4 live (4 × 20 = 80).
  // De 50 ekstra havner i playerPendingStakes (50 × 20 = 1000).
  const live = [makeTicket("t1"), makeTicket("t2"), makeTicket("t3"), makeTicket("t4")];
  const snap: RoomSnapshot = {
    ...baseSnapshot(),
    currentGame: runningGameSnapshot({ p1: live }),
  };
  const opts = buildOpts({
    getArmedPlayerIds: () => ["p1"],
    getArmedPlayerTicketCounts: () => ({ p1: 50 }),
    getArmedPlayerSelections: () => ({
      p1: [{ type: "small", qty: 50, name: "Small Yellow" }],
    }),
  });

  const payload = buildRoomUpdatePayload(snap, Date.now(), opts);

  assert.equal(payload.playerStakes.p1, 80, "innsats = 4 live × 20 kr = 80 kr");
  assert.equal(payload.playerPendingStakes.p1, 1000, "forhåndskjøp = 50 × 20 kr = 1000 kr");
});

test("Bug 2: RUNNING + active participant (no extra arm) → playerPendingStakes is empty", () => {
  const live = [makeTicket("t1"), makeTicket("t2")];
  const snap: RoomSnapshot = {
    ...baseSnapshot(),
    currentGame: runningGameSnapshot({ p1: live }),
  };
  const opts = buildOpts(); // no armed

  const payload = buildRoomUpdatePayload(snap, Date.now(), opts);

  assert.equal(payload.playerStakes.p1, 40, "2 × 20 kr = 40 kr");
  assert.equal(payload.playerPendingStakes.p1, undefined, "ingen pre-round arm → ingen pending");
});

// ── Bug 4: round-transition smoothness ───────────────────────────────────────

test("Bug 4: between rounds + armed → playerStakes shows projected cost, pending empty", () => {
  // WAITING/no game: pre-round arm IS the active stake. Ingen splitt — alt
  // går i playerStakes så bruker ser hva som vil bli debitert ved start.
  const snap: RoomSnapshot = baseSnapshot(); // no currentGame
  const opts = buildOpts({
    getArmedPlayerIds: () => ["p1"],
    getArmedPlayerTicketCounts: () => ({ p1: 4 }),
    getArmedPlayerSelections: () => ({
      p1: [{ type: "small", qty: 4, name: "Small Yellow" }],
    }),
  });

  const payload = buildRoomUpdatePayload(snap, Date.now(), opts);

  assert.equal(payload.playerStakes.p1, 80, "4 × 20 kr = 80 kr (mellom runder = aktiv-stake)");
  assert.equal(payload.playerPendingStakes.p1, undefined, "ingen pending mellom runder");
});

test("Bug 4: round transition simulert — ENDED→none→running→armed mid-round", () => {
  // Step 1: ingen runde, armed for neste → stake = 80, pending = empty.
  const beforeStart: RoomSnapshot = baseSnapshot();
  const armedOpts = buildOpts({
    getArmedPlayerIds: () => ["p1"],
    getArmedPlayerTicketCounts: () => ({ p1: 4 }),
    getArmedPlayerSelections: () => ({ p1: [{ type: "small", qty: 4, name: "Small Yellow" }] }),
  });
  const before = buildRoomUpdatePayload(beforeStart, Date.now(), armedOpts);
  assert.equal(before.playerStakes.p1, 80);
  assert.equal(before.playerPendingStakes.p1, undefined);

  // Step 2: runden starter → 4 brett blir live, arm cleares (i prod gjør
  // disarmAllPlayers + clearDisplayTicketCache dette). stake = 80, pending = empty.
  const afterStart: RoomSnapshot = {
    ...baseSnapshot(),
    currentGame: runningGameSnapshot({
      p1: [makeTicket("t1"), makeTicket("t2"), makeTicket("t3"), makeTicket("t4")],
    }),
  };
  const noArmOpts = buildOpts(); // armed cleared
  const afterStartPayload = buildRoomUpdatePayload(afterStart, Date.now(), noArmOpts);
  assert.equal(afterStartPayload.playerStakes.p1, 80, "stake bevares = 80 kr (samme 4 brett, nå live)");
  assert.equal(afterStartPayload.playerPendingStakes.p1, undefined);

  // Step 3: spiller armer 50 ekstra mid-round for runde N+2 → stake stays 80,
  // pending = 1000. Innsats hopper IKKE til 1080.
  const midRoundOpts = buildOpts({
    getArmedPlayerIds: () => ["p1"],
    getArmedPlayerTicketCounts: () => ({ p1: 50 }),
    getArmedPlayerSelections: () => ({ p1: [{ type: "small", qty: 50, name: "Small Yellow" }] }),
  });
  const midRoundPayload = buildRoomUpdatePayload(afterStart, Date.now(), midRoundOpts);
  assert.equal(midRoundPayload.playerStakes.p1, 80, "Innsats UENDRET (kun aktiv-runde teller)");
  assert.equal(midRoundPayload.playerPendingStakes.p1, 1000, "forhåndskjøp = 50 × 20 = 1000 kr");
});

// ── Multiplier-aware tests ───────────────────────────────────────────────────

test("RUNNING + Large brett (multiplier=3) i pre-round → pending bruker priceMultiplier", () => {
  const live = [makeTicket("t1")];
  const snap: RoomSnapshot = {
    ...baseSnapshot(),
    currentGame: runningGameSnapshot({ p1: live }),
  };
  const opts = buildOpts({
    getArmedPlayerIds: () => ["p1"],
    getArmedPlayerTicketCounts: () => ({ p1: 3 }), // 1 Large bundle = 3 weighted
    getArmedPlayerSelections: () => ({
      p1: [{ type: "large", qty: 1, name: "Large Yellow" }],
    }),
  });

  const payload = buildRoomUpdatePayload(snap, Date.now(), opts);

  assert.equal(payload.playerStakes.p1, 20, "1 live small × 20 = 20 kr");
  assert.equal(payload.playerPendingStakes.p1, 60, "1 large bundle = 1 × 20 × 3 = 60 kr");
});

// ── Edge: entryFee = 0 (free play) ──────────────────────────────────────────

test("RUNNING + entryFee=0 → ingen stake-entry (free play)", () => {
  const snap: RoomSnapshot = {
    ...baseSnapshot(),
    currentGame: { ...runningGameSnapshot({ p1: [makeTicket("t1")] }), entryFee: 0 },
  };
  const opts = buildOpts({ getRoomConfiguredEntryFee: () => 0 });

  const payload = buildRoomUpdatePayload(snap, Date.now(), opts);

  assert.equal(payload.playerStakes.p1, undefined, "fee=0 → ingen entry");
  assert.equal(payload.playerPendingStakes.p1, undefined);
});
