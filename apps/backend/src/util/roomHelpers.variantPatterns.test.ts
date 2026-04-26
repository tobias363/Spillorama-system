/**
 * roomHelpers — pre-game premie-rad fix (2026-04-26).
 *
 * `currentGame.patterns` only exists when a round is active. Without it,
 * the client's CenterTopPanel falls back to placeholder pills with
 * `prize1: 0`. Surface the variant config's patterns on `gameVariant`
 * so the client can render real prize amounts before the round starts.
 *
 * Exercises:
 *   1. variant config patterns flow into `gameVariant.patterns` over the wire.
 *   2. Empty patterns array → field is `undefined` (no over-eager push).
 *   3. PatternConfig fields (prize1, winningType, prizePercent) survive
 *      the patternConfigToDefinitions conversion and reach the client.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { RoomSnapshot } from "../game/types.js";
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
    createdAt: new Date("2026-04-26T08:00:00Z").toISOString(),
    players: [{ id: "p1", name: "Ada", walletId: "w1", balance: 500 }],
    gameHistory: [],
  };
}

function fixedPrizeVariant(): GameVariantConfig {
  // Norsk-bingo-style 5-fase config med eksplisitte prize1-beløp.
  return {
    ticketTypes: [
      { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
    ],
    patterns: [
      { name: "1 Rad", claimType: "LINE", prizePercent: 0, design: 1, winningType: "fixed", prize1: 100 },
      { name: "2 Rader", claimType: "LINE", prizePercent: 0, design: 2, winningType: "fixed", prize1: 200 },
      { name: "Full House", claimType: "BINGO", prizePercent: 0, design: 5, winningType: "fixed", prize1: 1000 },
    ],
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
    getVariantConfig: () => ({ gameType: "bingo", config: fixedPrizeVariant() }),
    getHallName: () => "Oslo Sentrum",
    supplierName: "Spillorama",
    ...overrides,
  };
}

test("pre-game premie-rad fix: gameVariant.patterns populated from variant config", () => {
  const snap = baseSnapshot(); // No currentGame — pre-game state.
  const payload = buildRoomUpdatePayload(snap, Date.now(), buildOpts());

  assert.ok(payload.gameVariant, "gameVariant must exist");
  const patterns = payload.gameVariant!.patterns;
  assert.ok(Array.isArray(patterns), "gameVariant.patterns must be an array");
  assert.equal(patterns!.length, 3, "all 3 variant patterns serialised");

  // Verify prize fields survived patternConfigToDefinitions conversion.
  assert.equal(patterns![0].name, "1 Rad");
  assert.equal(patterns![0].winningType, "fixed");
  assert.equal(patterns![0].prize1, 100);
  assert.equal(patterns![0].claimType, "LINE");

  assert.equal(patterns![2].name, "Full House");
  assert.equal(patterns![2].prize1, 1000);
  assert.equal(patterns![2].claimType, "BINGO");
});

test("pre-game premie-rad fix: empty variant patterns → field is undefined (back-compat)", () => {
  const snap = baseSnapshot();
  const payload = buildRoomUpdatePayload(snap, Date.now(), buildOpts({
    getVariantConfig: () => ({
      gameType: "bingo",
      config: { ticketTypes: [], patterns: [] },
    }),
  }));

  assert.ok(payload.gameVariant, "gameVariant must exist");
  assert.equal(
    payload.gameVariant!.patterns,
    undefined,
    "empty patterns array must serialise as undefined (clients fall back to placeholders)",
  );
});

test("pre-game premie-rad fix: percent-mode patterns preserve prizePercent", () => {
  const snap = baseSnapshot();
  const percentVariant: GameVariantConfig = {
    ticketTypes: [
      { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
    ],
    patterns: [
      { name: "1 Rad", claimType: "LINE", prizePercent: 30, design: 1 },
      { name: "Full House", claimType: "BINGO", prizePercent: 70, design: 5 },
    ],
  };
  const payload = buildRoomUpdatePayload(snap, Date.now(), buildOpts({
    getVariantConfig: () => ({ gameType: "bingo", config: percentVariant }),
  }));

  const patterns = payload.gameVariant!.patterns!;
  assert.equal(patterns.length, 2);
  assert.equal(patterns[0].prizePercent, 30);
  assert.equal(patterns[0].winningType, undefined, "percent-mode has no winningType field");
  assert.equal(patterns[1].prizePercent, 70);
});
