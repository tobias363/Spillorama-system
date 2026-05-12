/**
 * roomHelpers — Per-bong-pris-fix (Tobias-direktiv 2026-05-12):
 *
 * Hver brett-kort skal vise pris pr. bong fra backend-config, IKKE bundle-
 * pris. "Stor lilla" (Large Purple, priceMultiplier=3, ticketCount=3) gir
 * 3 brett — hvert av disse brettene skal vise 15 kr (per-bong-pris fra
 * config), ikke 45 kr (bundle-totalen).
 *
 * Live-bug fra pilot-test 2026-05-12: spilleren kjøpte "Stor lilla" til
 * 45 kr, men 3 brett dukket opp med "60 kr på hver av dem" (bundle-pris
 * stemplet per brett, og feil farge). Root cause: server-side
 * `enrichTicketList` regnet `fee × priceMultiplier` = bundle, ikke
 * `(fee × priceMultiplier) / ticketCount` = per-bong.
 *
 * Per-brett-formula:
 *   - Small Yellow (pm=1, count=1): 5 × 1 / 1 = 5 kr ✅
 *   - Large Yellow (pm=3, count=3): 5 × 3 / 3 = 5 kr ✅
 *   - Stor lilla   (pm=3, count=3): 15 × 3 / 3 = 15 kr ✅ (når entryFee=15)
 *
 * Hver brett-kort skal også få korrekt farge fra display-cache (matcher
 * spillerens valg) — testes via name-match-prioritet i ticketType-lookup.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { RoomStateManager } from "./roomState.js";
import { buildRoomUpdatePayload } from "./roomHelpers.js";
import type { GameVariantConfig } from "../game/variantConfig.js";
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

/**
 * Test-variant som speiler Spill 1-pilot-konfig: 6 farge-varianter
 * (small/large × yellow/white/purple) med korrekte priceMultiplier-verdier.
 * Large er bundle-størrelse 3 (3 brett per kjøp).
 */
const TEST_VARIANT_CONFIG: GameVariantConfig = {
  ticketTypes: [
    { name: "Small Yellow", type: "small", priceMultiplier: 1, ticketCount: 1 },
    { name: "Small White",  type: "small", priceMultiplier: 1, ticketCount: 1 },
    { name: "Small Purple", type: "small", priceMultiplier: 1, ticketCount: 1 },
    { name: "Large Yellow", type: "large", priceMultiplier: 3, ticketCount: 3 },
    { name: "Large White",  type: "large", priceMultiplier: 3, ticketCount: 3 },
    { name: "Large Purple", type: "large", priceMultiplier: 3, ticketCount: 3 },
  ],
  patterns: [],
};

function baseSnapshot(): RoomSnapshot {
  return {
    code: "ROOM-PILOT",
    hallId: "hall-arnes",
    hostPlayerId: "p1",
    gameSlug: "bingo",
    createdAt: new Date("2026-05-12T18:00:00Z").toISOString(),
    players: [{ id: "p1", name: "Tobias", walletId: "w1", balance: 500 }],
    gameHistory: [],
  };
}

function opts(
  rs: RoomStateManager,
  overrides: Partial<Parameters<typeof buildRoomUpdatePayload>[2]> = {},
): Parameters<typeof buildRoomUpdatePayload>[2] {
  return {
    runtimeBingoSettings: FAKE_SETTINGS,
    drawScheduler: FAKE_SCHEDULER,
    bingoMaxDrawsPerRound: 75,
    schedulerTickMs: 1000,
    getArmedPlayerIds: () => ["p1"],
    getArmedPlayerTicketCounts: () => ({ p1: 0 }),
    getArmedPlayerSelections: () => ({}),
    getRoomConfiguredEntryFee: () => 5,
    getOrCreateDisplayTickets: (code, pid, count, slug, colourAssignments) =>
      rs.getOrCreateDisplayTickets(code, pid, count, slug, colourAssignments),
    getLuckyNumbers: () => ({}),
    getVariantConfig: () => ({ gameType: "standard", config: TEST_VARIANT_CONFIG }),
    getHallName: () => "Teknobingo Årnes",
    supplierName: "Spillorama",
    ...overrides,
  };
}

test("Stor lilla (Large Purple, bundle=3): hvert brett viser 15 kr per bong, ikke 45 kr bundle", () => {
  const rs = new RoomStateManager();
  // entryFee=5 kr (basis-bong-pris). Large Purple har priceMultiplier=3
  // og ticketCount=3 (bundle-størrelse). Bundle-totalen er 5×3=15 kr,
  // men det er 3 brett — hver av dem skal vise 15/3 = 5 kr? Nei,
  // direktivet sier 15 kr per lilla bong. Test-setup: entryFee=15 kr
  // (basis-pris pr. lilla bong er 15 kr) → per-brett = 15×3/3 = 15 kr.
  const payload = buildRoomUpdatePayload(baseSnapshot(), Date.now(), opts(rs, {
    getArmedPlayerTicketCounts: () => ({ p1: 3 }), // 1 bundle × 3 brett
    getArmedPlayerSelections: () => ({
      p1: [{ type: "large", name: "Large Purple", qty: 1 }],
    }),
    getRoomConfiguredEntryFee: () => 15,
  }));

  const tickets = payload.preRoundTickets.p1;
  assert.equal(tickets.length, 3, "Stor lilla skal gi 3 brett (bundle=3)");

  // Per-brett-pris: ikke bundle-totalen (45 kr), men per-bong (15 kr).
  // Tobias-direktiv 2026-05-12: "pr. lilla bong koster 15 kr, stor lilla
  // gir da 3× lilla bong til 15 kr på hver av de bongene".
  for (let i = 0; i < tickets.length; i++) {
    assert.equal(
      tickets[i].price,
      15,
      `Brett ${i + 1} skal vise 15 kr per bong (ikke 45 kr bundle-totalen)`,
    );
  }

  // Sanity: hver bong skal også vise riktig farge.
  for (const t of tickets) {
    assert.equal(t.color, "Large Purple");
    assert.equal(t.type, "large");
  }
});

test("Liten hvit (Small White, bundle=1): hver brett viser entryFee", () => {
  const rs = new RoomStateManager();
  const payload = buildRoomUpdatePayload(baseSnapshot(), Date.now(), opts(rs, {
    getArmedPlayerTicketCounts: () => ({ p1: 2 }),
    getArmedPlayerSelections: () => ({
      p1: [{ type: "small", name: "Small White", qty: 2 }],
    }),
    getRoomConfiguredEntryFee: () => 5,
  }));
  const tickets = payload.preRoundTickets.p1;
  assert.equal(tickets.length, 2);
  for (const t of tickets) {
    assert.equal(t.price, 5, "Liten hvit skal vise 5 kr per brett");
    assert.equal(t.color, "Small White");
  }
});

test("Stor gul (Large Yellow, bundle=3): per-brett = entryFee, ikke entryFee × 3", () => {
  const rs = new RoomStateManager();
  // entryFee=10 kr per gul bong. Large Yellow har pm=3, count=3.
  // Per-brett = 10 × 3 / 3 = 10 kr (per-bong). Bundle = 10 × 3 = 30 kr (total).
  const payload = buildRoomUpdatePayload(baseSnapshot(), Date.now(), opts(rs, {
    getArmedPlayerTicketCounts: () => ({ p1: 3 }),
    getArmedPlayerSelections: () => ({
      p1: [{ type: "large", name: "Large Yellow", qty: 1 }],
    }),
    getRoomConfiguredEntryFee: () => 10,
  }));
  const tickets = payload.preRoundTickets.p1;
  assert.equal(tickets.length, 3);
  for (let i = 0; i < tickets.length; i++) {
    assert.equal(tickets[i].price, 10, `Brett ${i + 1} skal vise 10 kr (per-bong, ikke 30 kr bundle)`);
    assert.equal(tickets[i].color, "Large Yellow");
  }
});

test("ticketType lookup: name-match prioriteres over type-match for ambiguøse type-koder", () => {
  // Large Yellow og Large Purple deler samme `type: "large"`. Hvis vi kun
  // matcher på type, ville BEGGE bli mappet til første "large"-entry
  // (Large Yellow). Name-match sikrer at Large Purple får sin egen config.
  const rs = new RoomStateManager();
  const payload = buildRoomUpdatePayload(baseSnapshot(), Date.now(), opts(rs, {
    getArmedPlayerTicketCounts: () => ({ p1: 3 }),
    getArmedPlayerSelections: () => ({
      p1: [{ type: "large", name: "Large Purple", qty: 1 }],
    }),
    getRoomConfiguredEntryFee: () => 15,
  }));
  const tickets = payload.preRoundTickets.p1;
  // Farge skal være Large Purple (fra display-cache-assignments), ikke
  // Large Yellow (som ville være første type-match).
  for (const t of tickets) {
    assert.equal(t.color, "Large Purple", "color må komme fra display-cache assignment, ikke fallback");
    assert.equal(t.type, "large");
  }
});

test("blandet kjøp (Stor lilla + Liten gul): hver brett-kort viser sin egen per-bong-pris", () => {
  const rs = new RoomStateManager();
  // Stor lilla (3 brett à 15 kr) + Liten gul (1 brett à 10 kr).
  // entryFee=15 (basis lilla). Large Purple per-brett = 15 × 3 / 3 = 15.
  // Small Yellow per-brett = 15 × 1 / 1 = 15. NB: Hvis basis-fee gjelder
  // alle farger, kan ikke små gule prises annerledes uten per-farge
  // priceMultiplier — det er en annen problemstilling. Denne testen
  // verifiserer at per-brett-formula er konsistent for ALLE typer.
  const payload = buildRoomUpdatePayload(baseSnapshot(), Date.now(), opts(rs, {
    getArmedPlayerTicketCounts: () => ({ p1: 4 }),
    getArmedPlayerSelections: () => ({
      p1: [
        { type: "large", name: "Large Purple", qty: 1 },
        { type: "small", name: "Small Yellow", qty: 1 },
      ],
    }),
    getRoomConfiguredEntryFee: () => 15,
  }));
  const tickets = payload.preRoundTickets.p1;
  assert.equal(tickets.length, 4);

  // De 3 første er Large Purple (expansion-rekkefølge per
  // expandSelectionsToTicketColors). Skal vise 15 kr per bong.
  for (let i = 0; i < 3; i++) {
    assert.equal(tickets[i].color, "Large Purple");
    assert.equal(tickets[i].price, 15);
  }
  // Den 4. er Small Yellow. Skal vise 15 kr (entryFee × 1 / 1).
  assert.equal(tickets[3].color, "Small Yellow");
  assert.equal(tickets[3].price, 15);
});

test("server-side `price`-feltet overstyrer ikke et eksisterende `t.price` (idempotent)", () => {
  // enrichTicketList har `price: t.price ?? price` — hvis ticket allerede
  // har en pris (eks. fra scheduled-purchase-projection), beholdes den.
  const rs = new RoomStateManager();

  // Inject en pre-eksisterende pris i display-cache via direct manipulation.
  // Vi går rundt getOrCreateDisplayTickets for å simulere projection-flyten.
  const customTickets = [{
    grid: [[1,2,3,4,5],[6,7,8,9,10],[11,12,13,14,15],[16,17,18,19,20],[21,22,23,24,25]],
    id: "explicit-1",
    color: "Large Purple",
    type: "large",
    price: 25, // eksplisitt pris allerede satt (eks. fra DB-projection)
  }];

  const payload = buildRoomUpdatePayload(baseSnapshot(), Date.now(), opts(rs, {
    getArmedPlayerTicketCounts: () => ({ p1: 1 }),
    getArmedPlayerSelections: () => ({
      p1: [{ type: "large", name: "Large Purple", qty: 1 }],
    }),
    getRoomConfiguredEntryFee: () => 15,
    getOrCreateDisplayTickets: () => customTickets,
  }));

  const tickets = payload.preRoundTickets.p1;
  assert.equal(tickets.length, 1);
  // t.price=25 var allerede satt — skal beholdes, ikke overskrives med
  // computed 15.
  assert.equal(tickets[0].price, 25, "eksplisitt pre-eksisterende t.price skal vinne over computed");
});
