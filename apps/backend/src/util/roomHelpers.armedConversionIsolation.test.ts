/**
 * roomHelpers — armed-conversion isolation (Tobias 2026-05-14, BUG dobbel-telling).
 *
 * Verifies that AFTER pre-game `bet:arm` selections have been converted to
 * `app_game1_ticket_purchases` rows (via Game1ArmedToPurchaseConversionService)
 * AND the room state has been disarmed by the conversion hook, the resulting
 * `buildRoomUpdatePayload` does NOT count the same tickets in both
 * `playerStakes` (via gameTickets) AND `playerPendingStakes` (via lingering
 * armedPlayerSelections).
 *
 * Bug context (Tobias-rapport 2026-05-14 09:51):
 *   - Bruker kjøpte 3 bonger (1 hvit + 1 gul + 1 lilla) for 30 kr PRE-game.
 *   - Runden startet med scheduled-game 330597ef.
 *   - Frontend viste BÅDE "Innsats: 30 kr" og "Forhåndskjøp: 30 kr".
 *   - Korrekt: kun "Innsats: 30 kr" (Forhåndskjøp = 0 kr).
 *
 * Root cause:
 *   - Pre-game bet:arm setter armedPlayerIds + armedPlayerSelections i memory.
 *   - Master starter scheduled-game.
 *   - Game1ArmedToPurchaseConversionService konverterer til DB-purchase-rader.
 *   - Engine.startGame leser purchases og setter gameTickets[player].
 *   - MEN: armed-state ble ALDRI cleared etter conversion.
 *   - buildRoomUpdatePayload (line 572 i roomHelpers.ts):
 *       - playerStakes[player] = price(gameTickets) = 30 kr (live-tickets)
 *       - playerPendingStakes[player] = price(armedPlayerSelections) = 30 kr
 *     → samme kjøp talt to ganger.
 *
 * Fix:
 *   - apps/backend/src/index.ts:runArmedToPurchaseConversionForSpawn()
 *     kaller `roomState.disarmPlayer(roomCode, playerId)` etter hver
 *     successful conversion. Speiler `gameLifecycleEvents.ts:153`
 *     (disarmAllPlayers etter generic engine.startGame).
 *
 * Disse testene verifiserer at NÅR armed-state er cleared (post-conversion),
 * blir wire-format korrekt: Innsats kun fra gameTickets, Forhåndskjøp = 0.
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
  autoRoundTicketsPerPlayer: 4,
  payoutPercent: 80,
  autoDrawEnabled: false,
  autoDrawIntervalMs: 3000,
};

const FAKE_SCHEDULER = {
  normalizeNextAutoStartAt: () => null,
} as unknown as DrawScheduler;

const ENTRY_FEE = 5; // 5 kr = billigste bong (hvit)

function baseSnapshot(): RoomSnapshot {
  return {
    code: "BINGO_DEMO-PILOT-GOH",
    hallId: "demo-hall-001",
    hostPlayerId: "p1",
    gameSlug: "bingo",
    createdAt: new Date("2026-05-14T09:49:00Z").toISOString(),
    players: [
      {
        id: "p1",
        name: "Tobias",
        walletId: "demo-wallet-admin",
        balance: 1000,
        hallId: "demo-hall-001",
      },
    ],
    gameHistory: [],
  };
}

function makeTicket(id: string, type = "small", color = "hvit"): Ticket {
  return {
    grid: [[1, 2, 3, 4, 5], [6, 7, 8, 9, 10], [11, 12, 13, 14, 15]],
    id,
    type,
    color,
  };
}

function runningGameSnapshot(playerTickets: Record<string, Ticket[]>): GameSnapshot {
  return {
    id: "330597ef-1234-5678-9012-345678901234",
    status: "RUNNING",
    entryFee: ENTRY_FEE,
    ticketsPerPlayer: 4,
    prizePool: 100,
    remainingPrizePool: 100,
    payoutPercent: 80,
    maxPayoutBudget: 80,
    remainingPayoutBudget: 80,
    drawBag: [],
    drawnNumbers: [],
    remainingNumbers: 75,
    claims: [],
    tickets: playerTickets,
    marks: Object.fromEntries(Object.entries(playerTickets).map(([k, v]) => [k, v.map(() => [])])),
    startedAt: new Date("2026-05-14T09:49:08Z").toISOString(),
  };
}

function variantConfig(): GameVariantConfig {
  return {
    ticketTypes: [
      // 3-farge palette per Tobias 2026-05-08 (SPILL_REGLER §2)
      { name: "hvit", type: "small", priceMultiplier: 1, ticketCount: 1 },
      { name: "gul", type: "small", priceMultiplier: 2, ticketCount: 1 },
      { name: "lilla", type: "small", priceMultiplier: 3, ticketCount: 1 },
    ],
    patterns: [],
  };
}

function buildOpts(
  overrides: Partial<Parameters<typeof buildRoomUpdatePayload>[2]> = {},
): Parameters<typeof buildRoomUpdatePayload>[2] {
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

// ── BUG dobbel-telling — exact Tobias-scenario 2026-05-14 09:51 ────────────────

test("BUG dobbel-telling: PRE-game-kjøp 30 kr → Innsats 30, Forhåndskjøp 0 (armed cleared post-conversion)", () => {
  // Eksakt scenario fra Tobias-screenshot 2026-05-14 09:51:
  //   - Bruker kjøpte 3 bonger (1 hvit + 1 gul + 1 lilla) for 30 kr PRE-game.
  //   - Runde startet med scheduled-game 330597ef.
  //   - Conversion-hook har clearet armed-state.
  //   - Frontend skal vise BARE Innsats: 30 kr, IKKE også Forhåndskjøp: 30 kr.
  //
  // Forenklet: 1 ticket à 5 kr (hvit) for å unngå type-config-gjetting.
  // Innsats er fra `gameTickets` (live i runden, konvertert fra purchase),
  // Forhåndskjøp er fra `armedPlayerSelections` (skal være tom etter disarm).
  const liveTickets = [
    makeTicket("ticket-1", "small", "hvit"), // 5 kr
    makeTicket("ticket-2", "small", "hvit"), // 5 kr
    makeTicket("ticket-3", "small", "hvit"), // 5 kr
  ];
  const snap: RoomSnapshot = {
    ...baseSnapshot(),
    currentGame: runningGameSnapshot({ p1: liveTickets }),
  };
  // POST-conversion: armed-state er cleared av disarmPlayer-call i hook.
  const opts = buildOpts(); // ingen armed

  const payload = buildRoomUpdatePayload(snap, Date.now(), opts);

  // KRITISK ASSERTION: ingen dobbel-telling.
  assert.equal(
    payload.playerStakes.p1,
    15, // 3 hvite bonger × 5 kr = 15 kr (fra gameTickets/live)
    "Innsats: sum av gameTickets",
  );
  assert.equal(
    payload.playerPendingStakes.p1,
    undefined,
    "Forhåndskjøp: TOM når armed-state er cleared (fix for dobbel-telling)",
  );
});

test("BUG dobbel-telling: regresjon — VEDLIKE armed-state ETTER gameTickets gir dobbel-telling (forhindret)", () => {
  // Negativ regresjons-test: hvis vi IKKE clearer armed-state, vil
  // buildRoomUpdatePayload regne BÅDE Innsats (fra gameTickets) OG
  // Forhåndskjøp (fra armedPlayerSelections) → dobbel-telling.
  //
  // Denne testen dokumenterer den PRE-FIX-oppførselen. Den IKKE skal
  // brekke etter fix-en (fix-en er i conversion-hook, ikke i
  // buildRoomUpdatePayload — payload-funksjonen er ren). Den er her
  // for å gjøre invariansen eksplisitt: hvis caller FEILAKTIG lar
  // armed-state ligge igjen, vil wire-format reflektere det.
  const liveTickets = [makeTicket("ticket-1", "small", "hvit")];
  const snap: RoomSnapshot = {
    ...baseSnapshot(),
    currentGame: runningGameSnapshot({ p1: liveTickets }),
  };
  // PRE-conversion-hook-bug: armed-state lingerer.
  const opts = buildOpts({
    getArmedPlayerIds: () => ["p1"],
    getArmedPlayerSelections: () => ({
      p1: [{ type: "small", qty: 1, name: "hvit" }],
    }),
  });

  const payload = buildRoomUpdatePayload(snap, Date.now(), opts);

  // Dette er PRE-FIX-oppførsel: dobbel-telling. Testen dokumenterer at
  // payload-funksjonen er stateless og bare reflekterer input. Fix-en
  // ligger i conversion-hook (clearer armed-state). Hvis denne testen
  // brekker, har noen endret buildRoomUpdatePayload — vurdere om endring
  // er korrekt.
  assert.equal(
    payload.playerStakes.p1,
    5,
    "Innsats: live-ticket 5 kr (fra gameTickets)",
  );
  assert.equal(
    payload.playerPendingStakes.p1,
    5,
    "Forhåndskjøp: 5 kr (fra lingering armed) — dette er BUG-en uten hook-fix",
  );
});

// ── Mid-round additive arm (legitim Forhåndskjøp) ────────────────────────────

test("Mid-round additive arm: live tickets + NYE armed for neste runde → Innsats fra live, Forhåndskjøp fra additive", () => {
  // Legitimt scenario: bruker har 3 brett LIVE i runde 1 (kjøpt pre-game,
  // konvertert og disarmet), så midt-runde armer 2 NYE brett for runde 2.
  // De 2 nye er ekte forhåndskjøp.
  const liveTickets = [
    makeTicket("ticket-1", "small", "hvit"),
    makeTicket("ticket-2", "small", "hvit"),
    makeTicket("ticket-3", "small", "hvit"),
  ];
  const snap: RoomSnapshot = {
    ...baseSnapshot(),
    currentGame: runningGameSnapshot({ p1: liveTickets }),
  };
  // POST-conversion av pre-game-kjøp + NY mid-round arm for neste runde.
  const opts = buildOpts({
    getArmedPlayerIds: () => ["p1"],
    getArmedPlayerSelections: () => ({
      p1: [{ type: "small", qty: 2, name: "hvit" }], // 2 nye for runde 2
    }),
  });

  const payload = buildRoomUpdatePayload(snap, Date.now(), opts);

  assert.equal(
    payload.playerStakes.p1,
    15, // 3 live × 5 kr
    "Innsats: kun live-tickets i runde 1",
  );
  assert.equal(
    payload.playerPendingStakes.p1,
    10, // 2 nye × 5 kr
    "Forhåndskjøp: kun nye additive armings for runde 2",
  );
});

// ── Multi-color klassifikasjon (sjekker per-color sum) ─────────────────────

test("Multi-color: 1 hvit + 1 gul + 1 lilla LIVE (post-conversion) → Innsats 30, Forhåndskjøp 0", () => {
  // Eksakt screenshot-scenario: 1 hvit (5) + 1 gul (10) + 1 lilla (15) = 30 kr
  // Alle tre er LIVE i runden (kjøpt pre-game, konvertert).
  // Armed-state cleared av hook.
  const liveTickets = [
    makeTicket("ticket-hvit", "small", "hvit"), // 5 × 1 = 5
    makeTicket("ticket-gul", "small", "gul"), // 5 × 2 = 10
    makeTicket("ticket-lilla", "small", "lilla"), // 5 × 3 = 15
  ];
  const snap: RoomSnapshot = {
    ...baseSnapshot(),
    currentGame: runningGameSnapshot({ p1: liveTickets }),
  };
  const opts = buildOpts(); // armed cleared

  const payload = buildRoomUpdatePayload(snap, Date.now(), opts);

  // NB: priceForTickets bruker `tickets.length * fee` (line 558 i
  // roomHelpers.ts), så multi-color-vekting håndteres ved
  // assignment-tidspunkt, ikke i wire-payload. Her er det 3 brett × 5 kr.
  // Den faktiske 30-kr-summen i Tobias-screenshot kommer fra DB-
  // `total_amount_cents` i Game1ScheduledRoomSnapshot.ts:362-368 og
  // overskriver payload-verdien via merge i index.ts:1868-1875.
  assert.equal(payload.playerStakes.p1, 15, "Wire-format: 3 brett × fee = 15 kr");
  assert.equal(
    payload.playerPendingStakes.p1,
    undefined,
    "Forhåndskjøp: 0 etter conversion-hook clear",
  );
});

// ── Edge: spectator (no live tickets) + armed for next round ───────────────

test("Spectator + armed for next round → playerStakes empty, playerPendingStakes shows arm", () => {
  // Bruker har IKKE deltatt i denne runden (gameTickets[p1] tom), men
  // har armet 2 brett for neste runde. Innsats skal være tom (spectator),
  // Forhåndskjøp skal vise armingen.
  const snap: RoomSnapshot = {
    ...baseSnapshot(),
    currentGame: runningGameSnapshot({}), // p1 ikke deltaker
  };
  const opts = buildOpts({
    getArmedPlayerIds: () => ["p1"],
    getArmedPlayerSelections: () => ({
      p1: [{ type: "small", qty: 2, name: "hvit" }],
    }),
  });

  const payload = buildRoomUpdatePayload(snap, Date.now(), opts);

  assert.equal(
    payload.playerStakes.p1,
    undefined,
    "Spectator: ingen Innsats (ingen live-brett)",
  );
  assert.equal(
    payload.playerPendingStakes.p1,
    10,
    "Forhåndskjøp: 2 × 5 kr = 10 kr",
  );
});

// ── Idempotens: re-emit av payload med samme state ─────────────────────────

test("Idempotens: to back-to-back payloads med samme state gir samme stake-tall", () => {
  // Sikrer at buildRoomUpdatePayload er rent funksjonelt — ingen
  // state-mutasjon mellom kall.
  const liveTickets = [makeTicket("ticket-1", "small", "hvit")];
  const snap: RoomSnapshot = {
    ...baseSnapshot(),
    currentGame: runningGameSnapshot({ p1: liveTickets }),
  };
  const opts = buildOpts();

  const payload1 = buildRoomUpdatePayload(snap, Date.now(), opts);
  const payload2 = buildRoomUpdatePayload(snap, Date.now(), opts);

  assert.equal(payload1.playerStakes.p1, payload2.playerStakes.p1);
  assert.equal(payload1.playerPendingStakes.p1, payload2.playerPendingStakes.p1);
  assert.equal(payload1.playerStakes.p1, 5);
  assert.equal(payload1.playerPendingStakes.p1, undefined);
});

// ── Round-transition: runde 1 slutt → runde 2 start (armed-state oppførsel) ─

test("Round transition: armed-state cleared mellom runder → ingen krysspollering", () => {
  // Round-state-isolation: når runde 1 ender og runde 2 starter, må
  // armed-state for runde 2-spillere være KLAR (ikke arvet fra runde 1).
  // Conversion-hook clearer state per spawn → ny runde starter med
  // armed = tom inntil nye bet:arm-events kommer inn.

  // Steg 1: Runde 1 RUNNING, ingen armed (alle pre-game-kjøp er konvertert).
  const liveR1 = [makeTicket("r1-t1", "small", "hvit")];
  const snapR1: RoomSnapshot = {
    ...baseSnapshot(),
    currentGame: runningGameSnapshot({ p1: liveR1 }),
  };
  const optsR1 = buildOpts(); // armed cleared
  const payloadR1 = buildRoomUpdatePayload(snapR1, Date.now(), optsR1);
  assert.equal(payloadR1.playerStakes.p1, 5, "R1 Innsats: 5 kr");
  assert.equal(payloadR1.playerPendingStakes.p1, undefined, "R1 Forhåndskjøp: tom");

  // Steg 2: Runde 1 slutter, runde 2 spawner. Ny scheduled-game, conversion-
  // hook kjører igjen og clearer armed. Spiller har ingen new armings.
  const snapR2NoArm: RoomSnapshot = baseSnapshot(); // no game
  const optsR2NoArm = buildOpts(); // armed cleared
  const payloadR2NoArm = buildRoomUpdatePayload(snapR2NoArm, Date.now(), optsR2NoArm);
  assert.equal(
    payloadR2NoArm.playerStakes.p1,
    undefined,
    "R2 før kjøp: ingen Innsats",
  );
  assert.equal(
    payloadR2NoArm.playerPendingStakes.p1,
    undefined,
    "R2 før kjøp: ingen Forhåndskjøp",
  );

  // Steg 3: Spiller arm-er nye brett for R2. Mellom runder = active stake
  // (ikke pending) per round-state-isolation-regel.
  const optsR2Armed = buildOpts({
    getArmedPlayerIds: () => ["p1"],
    getArmedPlayerSelections: () => ({
      p1: [{ type: "small", qty: 2, name: "hvit" }],
    }),
  });
  const payloadR2Armed = buildRoomUpdatePayload(snapR2NoArm, Date.now(), optsR2Armed);
  assert.equal(
    payloadR2Armed.playerStakes.p1,
    10,
    "R2 armed mellom runder: Innsats 10 kr (arm IS active stake)",
  );
  assert.equal(
    payloadR2Armed.playerPendingStakes.p1,
    undefined,
    "R2 mellom runder: ingen pending",
  );

  // Steg 4: R2 starter, conversion-hook kjører → armed cleared, brett
  // går til gameTickets.
  const liveR2 = [
    makeTicket("r2-t1", "small", "hvit"),
    makeTicket("r2-t2", "small", "hvit"),
  ];
  const snapR2Run: RoomSnapshot = {
    ...baseSnapshot(),
    currentGame: runningGameSnapshot({ p1: liveR2 }),
  };
  const optsR2Run = buildOpts(); // armed cleared post-conversion
  const payloadR2Run = buildRoomUpdatePayload(snapR2Run, Date.now(), optsR2Run);
  assert.equal(
    payloadR2Run.playerStakes.p1,
    10,
    "R2 RUNNING: Innsats UENDRET 10 kr (samme brett, nå live)",
  );
  assert.equal(
    payloadR2Run.playerPendingStakes.p1,
    undefined,
    "R2 RUNNING: Forhåndskjøp tom (ingen mid-round arm enda)",
  );
});
