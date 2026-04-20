/**
 * roomHelpers — BIN-688 E2E: armed selections flow into preRoundTickets
 * colours so the brett shown in "Neste spill"-panelet matches exactly
 * what the player picked.
 *
 * Covers:
 *   1. name-based armed selections → preRoundTickets get matching colours.
 *   2. type-only armed selections (legacy client) → tickets still get a
 *      colour (sequential fallback), never undefined with colour-aware
 *      variant config.
 *   3. No selections → tickets render without colour (backward compat).
 *   4. Bundle selection (Large White qty=1, ticketCount=3) fills all 3 brett.
 *   5. Mixed bundle + small: count + colour mapping both correct.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { RoomStateManager } from "./roomState.js";
import { buildRoomUpdatePayload } from "./roomHelpers.js";
import { DEFAULT_STANDARD_CONFIG } from "../game/variantConfig.js";
import type { RoomSnapshot } from "../game/types.js";
import type { DrawScheduler } from "../draw-engine/DrawScheduler.js";
import type { BingoSchedulerSettings } from "./bingoSettings.js";

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
    createdAt: new Date("2026-04-20T10:00:00Z").toISOString(),
    players: [{ id: "p1", name: "Ada", walletId: "w1", balance: 500 }],
    gameHistory: [],
  };
}

/** Build opts wired to a real RoomStateManager so cache + colour logic runs. */
function opts(rs: RoomStateManager, overrides: Parameters<typeof buildRoomUpdatePayload>[2] extends infer T ? Partial<T> : never = {}): Parameters<typeof buildRoomUpdatePayload>[2] {
  return {
    runtimeBingoSettings: FAKE_SETTINGS,
    drawScheduler: FAKE_SCHEDULER,
    bingoMaxDrawsPerRound: 60,
    schedulerTickMs: 1000,
    getArmedPlayerIds: () => ["p1"],
    getArmedPlayerTicketCounts: () => ({ p1: 3 }),
    getArmedPlayerSelections: () => ({}),
    getRoomConfiguredEntryFee: () => 10,
    getOrCreateDisplayTickets: (code, pid, count, slug, colourAssignments) =>
      rs.getOrCreateDisplayTickets(code, pid, count, slug, colourAssignments),
    getLuckyNumbers: () => ({}),
    getVariantConfig: () => ({ gameType: "standard", config: DEFAULT_STANDARD_CONFIG }),
    getHallName: () => "Oslo Sentrum",
    supplierName: "Spillorama",
    ...overrides,
  };
}

test("name-based selections: preRoundTickets carry matching colours", () => {
  const rs = new RoomStateManager();
  const payload = buildRoomUpdatePayload(baseSnapshot(), Date.now(), opts(rs, {
    getArmedPlayerTicketCounts: () => ({ p1: 3 }),
    getArmedPlayerSelections: () => ({
      p1: [
        { type: "small", name: "Small Yellow", qty: 1 },
        { type: "small", name: "Small White", qty: 1 },
        { type: "small", name: "Small Purple", qty: 1 },
      ],
    }),
  }));
  const tickets = payload.preRoundTickets.p1;
  assert.equal(tickets.length, 3);
  assert.equal(tickets[0].color, "Small Yellow");
  assert.equal(tickets[1].color, "Small White");
  assert.equal(tickets[2].color, "Small Purple");
});

test("legacy client (type only, no name): first matching config colour used per selection", () => {
  const rs = new RoomStateManager();
  const payload = buildRoomUpdatePayload(baseSnapshot(), Date.now(), opts(rs, {
    getArmedPlayerTicketCounts: () => ({ p1: 2 }),
    getArmedPlayerSelections: () => ({
      p1: [{ type: "small", qty: 2 }],
    }),
  }));
  const tickets = payload.preRoundTickets.p1;
  assert.equal(tickets.length, 2);
  // Expand falls back to first config entry for each slot in the same
  // selection — both slots get "Small Yellow" (not sequential cycling).
  // That's an acceptable compromise: legacy clients don't distinguish
  // colours within a single type anyway.
  assert.equal(tickets[0].color, "Small Yellow");
  assert.equal(tickets[1].color, "Small Yellow");
});

test("no selections (undefined getter): tickets render without colour (backward compat)", () => {
  const rs = new RoomStateManager();
  const payload = buildRoomUpdatePayload(baseSnapshot(), Date.now(), opts(rs, {
    getArmedPlayerTicketCounts: () => ({ p1: 2 }),
    getArmedPlayerSelections: undefined,
  }));
  const tickets = payload.preRoundTickets.p1;
  assert.equal(tickets.length, 2);
  for (const t of tickets) assert.equal(t.color, undefined);
});

test("bundle selection: 1× Large White expands to 3 brett, all Large White", () => {
  const rs = new RoomStateManager();
  const payload = buildRoomUpdatePayload(baseSnapshot(), Date.now(), opts(rs, {
    getArmedPlayerTicketCounts: () => ({ p1: 3 }),
    getArmedPlayerSelections: () => ({
      p1: [{ type: "large", name: "Large White", qty: 1 }],
    }),
  }));
  const tickets = payload.preRoundTickets.p1;
  assert.equal(tickets.length, 3);
  for (const t of tickets) {
    assert.equal(t.color, "Large White");
    assert.equal(t.type, "large");
  }
});

test("mixed bundle + small: count and colour mapping both correct", () => {
  const rs = new RoomStateManager();
  const payload = buildRoomUpdatePayload(baseSnapshot(), Date.now(), opts(rs, {
    // 1× Small Yellow + 1× Large White = 1 + 3 = 4 brett.
    getArmedPlayerTicketCounts: () => ({ p1: 4 }),
    getArmedPlayerSelections: () => ({
      p1: [
        { type: "small", name: "Small Yellow", qty: 1 },
        { type: "large", name: "Large White", qty: 1 },
      ],
    }),
  }));
  const tickets = payload.preRoundTickets.p1;
  assert.equal(tickets.length, 4);
  assert.equal(tickets[0].color, "Small Yellow");
  assert.equal(tickets[0].type, "small");
  for (let i = 1; i < 4; i++) {
    assert.equal(tickets[i].color, "Large White");
    assert.equal(tickets[i].type, "large");
  }
});

test("re-arm with different colours triggers cache regeneration", () => {
  const rs = new RoomStateManager();
  // First round of polling: Small Yellow × 2.
  const first = buildRoomUpdatePayload(baseSnapshot(), Date.now(), opts(rs, {
    getArmedPlayerTicketCounts: () => ({ p1: 2 }),
    getArmedPlayerSelections: () => ({
      p1: [{ type: "small", name: "Small Yellow", qty: 2 }],
    }),
  }));
  assert.equal(first.preRoundTickets.p1[0].color, "Small Yellow");
  assert.equal(first.preRoundTickets.p1[1].color, "Small Yellow");

  // Player re-arms: 1× Small Yellow + 1× Small Red (still count=2).
  const second = buildRoomUpdatePayload(baseSnapshot(), Date.now(), opts(rs, {
    getArmedPlayerTicketCounts: () => ({ p1: 2 }),
    getArmedPlayerSelections: () => ({
      p1: [
        { type: "small", name: "Small Yellow", qty: 1 },
        { type: "small", name: "Small Red", qty: 1 },
      ],
    }),
  }));
  assert.equal(second.preRoundTickets.p1[0].color, "Small Yellow");
  assert.equal(second.preRoundTickets.p1[1].color, "Small Red");
});
