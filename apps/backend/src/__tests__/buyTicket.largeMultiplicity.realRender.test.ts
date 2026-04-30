/**
 * REGRESSION 2026-04-30 Bug B (real-render variant) — Large ticket multiplicity
 * gjennom hele wire-payload-pipelinen, ikke bare `BingoEngine.startGame`.
 *
 * Tobias rapporterte (live-verifisert 2026-04-30):
 *   "Demo Hall: kjøper 5 Smalls + 1 Large Yellow → ser KUN 6 brett (skal være 8)"
 *
 * Forrige tester (`buyTicket.largeMultiplicity.test.ts`) verifiserte kun at
 * `BingoEngine.startGame` opprettet 3 ticket-records ved Large Yellow-kjøp.
 * Men buy-popup-bug-en ligger PRE-round — dvs. `preRoundTickets` som leveres
 * via `buildRoomUpdatePayload` for den åpne `WAITING/ENDED`-staten.
 *
 * Wire-flowen er:
 *   1. Klient sender `bet:arm` med `selections=[{type:"large", qty:1, name:"Large Yellow"}]`
 *   2. roomEvents.ts beregner `acceptedWeighted = 1 × 3 = 3` (weight from ticketCount)
 *   3. `armPlayer(roomCode, playerId, 3, [{...Large Yellow}])` lagrer arm-state
 *   4. `buildRoomUpdatePayload` itererer armede spillere:
 *        - `armedCount = 3` (vekt-basert)
 *        - `expandSelectionsToTicketColors([{Large Yellow,qty:1}], variantConfig, "bingo")` → 3 entries
 *        - `getOrCreateDisplayTickets(roomCode, playerId, 3, "bingo", [LY,LY,LY])` → cache med 3 tickets
 *        - `preRoundTickets[playerId] = 3 ticket-records`
 *   5. Klient mottar `payload.preRoundTickets[myPlayerId] = [LY, LY, LY]`
 *   6. PlayScreen rendrer 3 grids
 *
 * Denne testen verifiserer steg 4 — at `buildRoomUpdatePayload` faktisk
 * leverer 3 ticket-records for én Large Yellow + at fargene er korrekte.
 *
 * Coverage:
 *   1) 1 Large Yellow alene → 3 brett, alle "Large Yellow"
 *   2) 5 Smalls + 1 Large Yellow → 8 brett (5 + 3)
 *   3) 1 Large Yellow + 1 Large White → 6 brett (3 + 3, fargene sortert per selection)
 *   4) Default bingo-config (slik Demo Hall faktisk bruker uten admin-overrides)
 */

import test from "node:test";
import assert from "node:assert/strict";
import type { RoomSnapshot, Ticket } from "../game/types.js";
import {
  DEFAULT_NORSK_BINGO_CONFIG,
  expandSelectionsToTicketColors,
} from "../game/variantConfig.js";
import type { DrawScheduler } from "../draw-engine/DrawScheduler.js";
import type { BingoSchedulerSettings } from "../util/bingoSettings.js";
import { buildRoomUpdatePayload } from "../util/roomHelpers.js";
import { RoomStateManager } from "../util/roomState.js";

const FAKE_SETTINGS: BingoSchedulerSettings = {
  autoRoundStartEnabled: false,
  autoRoundStartIntervalMs: 60_000,
  autoRoundMinPlayers: 2,
  autoRoundEntryFee: 10,
  autoRoundTicketsPerPlayer: 30,
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
    hallId: "hall-demo",
    hostPlayerId: "p1",
    gameSlug: "bingo",
    createdAt: new Date("2026-04-30T08:00:00Z").toISOString(),
    players: [{ id: "p1", name: "Tobias", walletId: "w1", balance: 500 }],
    gameHistory: [],
  };
}

/**
 * Build opts for `buildRoomUpdatePayload` using the actual `RoomStateManager`
 * (so the displayTicketCache + ticket-generation matches production paths,
 * not test stubs that always return [].
 *
 * Caller arms the player via `roomState.armPlayer` BEFORE invoking
 * buildRoomUpdatePayload — exactly mimicking the prod sequence.
 */
function buildOpts(
  roomState: RoomStateManager,
  selections: Array<{ type: string; qty: number; name: string }>,
  armedCount: number,
): Parameters<typeof buildRoomUpdatePayload>[2] {
  return {
    runtimeBingoSettings: FAKE_SETTINGS,
    drawScheduler: FAKE_SCHEDULER,
    bingoMaxDrawsPerRound: 60,
    schedulerTickMs: 1000,
    getArmedPlayerIds: () => ["p1"],
    getArmedPlayerTicketCounts: () => ({ p1: armedCount }),
    getArmedPlayerSelections: () => ({ p1: selections }),
    getRoomConfiguredEntryFee: () => 10,
    getOrCreateDisplayTickets: (code, id, count, gameSlug, colorAssignments) =>
      roomState.getOrCreateDisplayTickets(code, id, count, gameSlug, colorAssignments),
    getLuckyNumbers: () => ({}),
    getVariantConfig: () => ({ gameType: "bingo", config: DEFAULT_NORSK_BINGO_CONFIG }),
    getHallName: () => "Demo Hall",
    supplierName: "Spillorama",
  };
}

test("Bug B real-render — 1 Large Yellow gir 3 preRoundTickets via buildRoomUpdatePayload", () => {
  const roomState = new RoomStateManager();
  const selections = [{ type: "large", qty: 1, name: "Large Yellow" }];
  // Simuler det som roomEvents.ts:942 gjør: armPlayer med vekt-basert count.
  roomState.armPlayer("ROOM1", "p1", 3, selections);

  const payload = buildRoomUpdatePayload(
    baseSnapshot(),
    Date.now(),
    buildOpts(roomState, selections, 3),
  );

  // KEY ASSERTION: preRoundTickets["p1"] skal ha 3 entries.
  const myPreRound = payload.preRoundTickets["p1"];
  assert.ok(myPreRound, "preRoundTickets['p1'] må være definert");
  assert.equal(
    myPreRound.length,
    3,
    `Bug B real-render: 1 Large Yellow må generere 3 preRoundTickets. Faktisk: ${myPreRound.length}.`,
  );

  // Alle 3 må ha color="Large Yellow", type="large".
  for (const t of myPreRound) {
    assert.equal(t.color, "Large Yellow");
    assert.equal(t.type, "large");
  }
});

test("Bug B real-render — 5 Smalls + 1 Large Yellow gir 8 preRoundTickets (Tobias' actual scenario)", () => {
  const roomState = new RoomStateManager();
  // Tobias' faktiske screenshot-scenario:
  //   2× Small Orange + 1 Small White + 1 Small Purple + 1 Small Red + 1 Large Yellow
  //   = 5 + 3 = 8 brett (men screenshot viser kun 6 — bug)
  const selections = [
    { type: "small", qty: 2, name: "Small Orange" },
    { type: "small", qty: 1, name: "Small White" },
    { type: "small", qty: 1, name: "Small Purple" },
    { type: "small", qty: 1, name: "Small Red" },
    { type: "large", qty: 1, name: "Large Yellow" },
  ];
  // armedCount = 2*1 + 1*1 + 1*1 + 1*1 + 1*3 = 8
  roomState.armPlayer("ROOM1", "p1", 8, selections);

  const payload = buildRoomUpdatePayload(
    baseSnapshot(),
    Date.now(),
    buildOpts(roomState, selections, 8),
  );

  const myPreRound = payload.preRoundTickets["p1"];
  assert.ok(myPreRound, "preRoundTickets['p1'] må være definert");
  assert.equal(
    myPreRound.length,
    8,
    `Bug B real-render: 5 Smalls + 1 Large Yellow må gi 8 brett. Faktisk: ${myPreRound.length}. ` +
      `Screenshot viser 6 (bug B).`,
  );

  // Tell antall per farge — skal matche Tobias' selection.
  const colorCounts: Record<string, number> = {};
  for (const t of myPreRound) {
    const c = t.color ?? "?";
    colorCounts[c] = (colorCounts[c] ?? 0) + 1;
  }
  assert.equal(colorCounts["Small Orange"], 2, "2 × Small Orange");
  assert.equal(colorCounts["Small White"], 1, "1 × Small White");
  assert.equal(colorCounts["Small Purple"], 1, "1 × Small Purple");
  assert.equal(colorCounts["Small Red"], 1, "1 × Small Red");
  assert.equal(colorCounts["Large Yellow"], 3, "3 × Large Yellow (1 bundle × 3 brett)");
});

test("Bug B real-render — 1 Large Yellow + 1 Large White gir 6 brett (3 + 3)", () => {
  const roomState = new RoomStateManager();
  const selections = [
    { type: "large", qty: 1, name: "Large Yellow" },
    { type: "large", qty: 1, name: "Large White" },
  ];
  roomState.armPlayer("ROOM1", "p1", 6, selections);

  const payload = buildRoomUpdatePayload(
    baseSnapshot(),
    Date.now(),
    buildOpts(roomState, selections, 6),
  );

  const myPreRound = payload.preRoundTickets["p1"];
  assert.equal(myPreRound!.length, 6, "1 Large Yellow + 1 Large White = 6 brett");

  const yellowCount = myPreRound!.filter((t) => t.color === "Large Yellow").length;
  const whiteCount = myPreRound!.filter((t) => t.color === "Large White").length;
  assert.equal(yellowCount, 3);
  assert.equal(whiteCount, 3);
});

test("Bug B real-render — 2 Large Yellow gir 6 brett (2 bundles × 3)", () => {
  const roomState = new RoomStateManager();
  const selections = [{ type: "large", qty: 2, name: "Large Yellow" }];
  roomState.armPlayer("ROOM1", "p1", 6, selections);

  const payload = buildRoomUpdatePayload(
    baseSnapshot(),
    Date.now(),
    buildOpts(roomState, selections, 6),
  );

  const myPreRound = payload.preRoundTickets["p1"];
  assert.equal(myPreRound!.length, 6, "qty=2 × ticketCount=3 = 6 brett");
  for (const t of myPreRound!) assert.equal(t.color, "Large Yellow");
});

test("Bug B real-render — sanity: expandSelectionsToTicketColors selv leverer 3 entries for Large Yellow", () => {
  // Disse asserts'ene er fraskilt fra buildRoomUpdatePayload — de bekrefter
  // at den underliggende expand-funksjonen er korrekt før vi ser på pipelinen.
  const out = expandSelectionsToTicketColors(
    [{ type: "large", qty: 1, name: "Large Yellow" }],
    DEFAULT_NORSK_BINGO_CONFIG,
    "bingo",
  );
  assert.equal(out.length, 3);
  for (const x of out) {
    assert.equal(x.color, "Large Yellow");
    assert.equal(x.type, "large");
  }
});

test("Bug B real-render — DEFAULT_NORSK_BINGO_CONFIG har Large Yellow med ticketCount=3", () => {
  // Kanonisk config-sjekk — hvis denne skifter til ticketCount=1 har vi bug-røtter
  // direkte i defaults.
  const ly = DEFAULT_NORSK_BINGO_CONFIG.ticketTypes.find((t) => t.name === "Large Yellow");
  assert.ok(ly, "Large Yellow må eksistere i DEFAULT_NORSK_BINGO_CONFIG");
  assert.equal(ly!.ticketCount, 3, "ticketCount må være 3 for Large Yellow (3 brett per kjøp)");
  assert.equal(ly!.priceMultiplier, 3, "priceMultiplier må være 3 (30 kr ved entryFee=10)");

  const lw = DEFAULT_NORSK_BINGO_CONFIG.ticketTypes.find((t) => t.name === "Large White");
  assert.ok(lw, "Large White må eksistere");
  assert.equal(lw!.ticketCount, 3);
  assert.equal(lw!.priceMultiplier, 3);
});
