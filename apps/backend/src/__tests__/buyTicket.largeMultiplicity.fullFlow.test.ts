/**
 * REGRESSION 2026-04-30 Bug B (full-flow variant) — Tobias' EXACT scenario
 * end-to-end gjennom server-arming + room:update + game:start.
 *
 * Tobias rapporterte:
 *   "Demo Hall: kjøper 5 Smalls + 1 Large Yellow → forventet 8 brett, ser 6"
 *
 * Hypotese: Bug B kan trigge hvis `BingoEngine.startGame` får en
 * `ticketsPerPlayer`-verdi (typisk 4 fra `runtimeBingoSettings.autoRoundTicketsPerPlayer`)
 * som er LAVERE enn `armedPlayerTicketCounts`-vekten (8). Da clamper
 * `playerTicketCountMap` til 4, og `cachedDisplayTickets.length === playerTicketCount`-
 * sjekken feiler (8 !== 4), så cachen IKKE adopteres. Per-type
 * generering kjører men den genererer fortsatt 8 brett (qty × ticketCount
 * uavhengig av playerTicketCount).
 *
 * Hvis dette virker, får vi 8 brett i live game state. Men hvis det er en
 * subtil bug i per-type-loopen som ALSO blir clampet, ville vi se 4 eller
 * færre.
 *
 * Denne testen verifiserer EXAKT scenarioet med ticketsPerPlayer=4 (prod-default
 * fra envConfig.ts:197) og spillet faktisk genererer 8 brett etter startGame.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { BingoEngine } from "../game/BingoEngine.js";
import { InMemoryWalletAdapter } from "../game/BingoEngine.test.js";
import { DEFAULT_NORSK_BINGO_CONFIG } from "../game/variantConfig.js";
import type {
  BingoSystemAdapter,
  CreateTicketInput,
} from "../adapters/BingoSystemAdapter.js";
import type { Ticket } from "../game/types.js";

class StubAdapter implements BingoSystemAdapter {
  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    return {
      id: `tkt-${input.ticketIndex}`,
      grid: [
        [input.ticketIndex * 10 + 1, 16, 31, 46, 61],
        [2, 17, 32, 47, 62],
        [3, 18, 0, 48, 63],
        [4, 19, 33, 49, 64],
        [5, 20, 34, 50, 65],
      ],
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
    };
  }
}

test("Bug B full-flow — Tobias' scenario: 5 Smalls + 1 Large Yellow med ticketsPerPlayer=4 (prod-default)", async () => {
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(new StubAdapter(), wallet, {
    minDrawIntervalMs: 0,
    minPlayersToStart: 1,
  });
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "demo-hall",
    playerName: "Tobias",
    walletId: "w-tobias",
    gameSlug: "bingo",
  });

  await wallet.ensureAccount("w-tobias");

  // Tobias' faktiske bestilling: 2× Small Orange + 1 Small White + 1 Small Purple
  // + 1 Small Red + 1 Large Yellow = 8 brett vekt-totalt.
  const selections = [
    { type: "small", qty: 2, name: "Small Orange" },
    { type: "small", qty: 1, name: "Small White" },
    { type: "small", qty: 1, name: "Small Purple" },
    { type: "small", qty: 1, name: "Small Red" },
    { type: "large", qty: 1, name: "Large Yellow" },
  ];
  const armedWeighted = 8; // 2*1 + 1*1 + 1*1 + 1*1 + 1*3

  await engine.startGame({
    roomCode,
    actorPlayerId: playerId!,
    entryFee: 10,
    // KRITISK: prod-default fra envConfig.ts:197 er 4 (AUTO_ROUND_TICKETS_PER_PLAYER).
    // Dette er den faktiske verdien som brukes i live gameplay når admin ikke
    // overstyrer `payload.ticketsPerPlayer` i game:start-eventet.
    ticketsPerPlayer: 4,
    payoutPercent: 80,
    gameType: "standard",
    variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
    armedPlayerIds: [playerId!],
    armedPlayerTicketCounts: { [playerId!]: armedWeighted },
    armedPlayerSelections: { [playerId!]: selections },
  });

  const snapshot = engine.getRoomSnapshot(roomCode);
  const tobiasTickets = snapshot.currentGame?.tickets[playerId!] ?? [];

  // KEY ASSERTION: 8 brett må genereres selv om ticketsPerPlayer=4 clamper
  // playerTicketCount til 4.
  assert.equal(
    tobiasTickets.length,
    8,
    `Bug B full-flow: 5 Smalls + 1 Large Yellow må gi 8 brett. ` +
      `Faktisk: ${tobiasTickets.length}. Forventet: 8 (med ticketsPerPlayer=4 prod-default).`,
  );

  // Verifiser farger
  const colorCounts: Record<string, number> = {};
  for (const t of tobiasTickets) {
    const c = t.color ?? "?";
    colorCounts[c] = (colorCounts[c] ?? 0) + 1;
  }
  assert.equal(colorCounts["Small Orange"], 2);
  assert.equal(colorCounts["Small White"], 1);
  assert.equal(colorCounts["Small Purple"], 1);
  assert.equal(colorCounts["Small Red"], 1);
  assert.equal(colorCounts["Large Yellow"], 3);
});

test("Bug B full-flow — wallet debit speiler full pris: 5 × 10 kr + 1 × 30 kr = 80 kr", async () => {
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(new StubAdapter(), wallet, {
    minDrawIntervalMs: 0,
    minPlayersToStart: 1,
  });
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "demo-hall",
    playerName: "Tobias",
    walletId: "w-tobias-2",
    gameSlug: "bingo",
  });

  await wallet.ensureAccount("w-tobias-2");
  const before = await wallet.getBalance("w-tobias-2");

  const selections = [
    { type: "small", qty: 2, name: "Small Orange" },
    { type: "small", qty: 1, name: "Small White" },
    { type: "small", qty: 1, name: "Small Purple" },
    { type: "small", qty: 1, name: "Small Red" },
    { type: "large", qty: 1, name: "Large Yellow" },
  ];

  await engine.startGame({
    roomCode,
    actorPlayerId: playerId!,
    entryFee: 10,
    ticketsPerPlayer: 4, // prod-default
    payoutPercent: 80,
    gameType: "standard",
    variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
    armedPlayerIds: [playerId!],
    armedPlayerTicketCounts: { [playerId!]: 8 },
    armedPlayerSelections: { [playerId!]: selections },
  });

  const after = await wallet.getBalance("w-tobias-2");
  const debited = before - after;
  assert.equal(
    debited,
    80,
    `Wallet debit må være 5 × 10 kr + 1 × 30 kr = 80 kr. Faktisk: ${debited} kr.`,
  );
});

test("Bug B full-flow — pre-round cache adoption matcher armedPlayerTicketCounts (post-fix)", async () => {
  // ETTER fix: med selections present, playerTicketCount tas fra armedPlayerTicketCounts
  // direkte (8) — IKKE clampes til ticketsPerPlayer (4). Dette gjør at cache-adoption-
  // sjekken `cachedDisplayTickets.length === playerTicketCount` matcher (8 === 8),
  // og spilleren får adoptert de eksakte brettene de så i pre-round.
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(new StubAdapter(), wallet, {
    minDrawIntervalMs: 0,
    minPlayersToStart: 1,
  });
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Eve",
    walletId: "w-eve",
    gameSlug: "bingo",
  });

  await wallet.ensureAccount("w-eve");

  // Mock pre-round cache med 8 tickets fra forrige room:update.
  const mockPreRound: Ticket[] = Array.from({ length: 8 }, (_, i) => ({
    id: `cached-${i}`,
    grid: [
      [i + 1, 16, 31, 46, 61],
      [2, 17, 32, 47, 62],
      [3, 18, 0, 48, 63],
      [4, 19, 33, 49, 64],
      [5, 20, 34, 50, 65],
    ],
    color: i < 5 ? "Small Yellow" : "Large Yellow",
    type: i < 5 ? "small" : "large",
  }));

  await engine.startGame({
    roomCode,
    actorPlayerId: playerId!,
    entryFee: 10,
    ticketsPerPlayer: 4, // PROD-DEFAULT — før fix ville dette clampe playerTicketCount til 4
    payoutPercent: 80,
    gameType: "standard",
    variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
    armedPlayerIds: [playerId!],
    armedPlayerTicketCounts: { [playerId!]: 8 },
    armedPlayerSelections: {
      [playerId!]: [
        { type: "small", qty: 5, name: "Small Yellow" },
        { type: "large", qty: 1, name: "Large Yellow" },
      ],
    },
    preRoundTicketsByPlayerId: { [playerId!]: mockPreRound },
  });

  const snapshot = engine.getRoomSnapshot(roomCode);
  const eveTickets = snapshot.currentGame?.tickets[playerId!] ?? [];

  assert.equal(
    eveTickets.length,
    8,
    `Etter fix: med armed selections, playerTicketCount IKKE clampes. ` +
      `Cache (8) === playerTicketCount (8) → cache adopteres → 8 brett. ` +
      `Faktisk: ${eveTickets.length}.`,
  );

  // Verifiser cache-adoption: brettene må ha de samme cached IDs (cached-0 til cached-7),
  // ikke nye fra per-type-gen. Dette beviser at fix-en faktisk lar pre-round-cache
  // bli adoptert i stedet for å falle gjennom til regenerering.
  const adoptedIds = eveTickets.map((t) => t.id).filter(Boolean) as string[];
  for (let i = 0; i < 8; i++) {
    assert.ok(
      adoptedIds.includes(`cached-${i}`),
      `Forventet at cached-${i} ble adoptert (ikke regenerert). Faktisk: ${adoptedIds.join(", ")}`,
    );
  }
});

test("Bug B full-flow — legacy flat-mode (uten selections) forblir clampet av ticketsPerPlayer", async () => {
  // Sikkerhetsnett: hvis admin/auto-round kjører i legacy flat-mode (ingen
  // armedPlayerSelections), `playerTicketCount` MÅ fortsatt clampes av
  // `ticketsPerPlayer` for å hindre at en player armer flere brett enn
  // hall tillater. Bug B-fix-en gjelder kun selections-driven path.
  const wallet = new InMemoryWalletAdapter();
  const engine = new BingoEngine(new StubAdapter(), wallet, {
    minDrawIntervalMs: 0,
    minPlayersToStart: 1,
  });
  const { roomCode, playerId } = await engine.createRoom({
    hallId: "hall-1",
    playerName: "Frank",
    walletId: "w-frank",
    gameSlug: "bingo",
  });

  await wallet.ensureAccount("w-frank");

  await engine.startGame({
    roomCode,
    actorPlayerId: playerId!,
    entryFee: 10,
    ticketsPerPlayer: 4,
    payoutPercent: 80,
    gameType: "standard",
    variantConfig: DEFAULT_NORSK_BINGO_CONFIG,
    armedPlayerIds: [playerId!],
    armedPlayerTicketCounts: { [playerId!]: 8 }, // Forsøker å arme 8
    // INGEN armedPlayerSelections → legacy flat-mode → clamp må fortsatt skje
  });

  const snapshot = engine.getRoomSnapshot(roomCode);
  const frankTickets = snapshot.currentGame?.tickets[playerId!] ?? [];

  // Legacy-mode med flat count → playerTicketCount clampes til 4 → 4 brett genereres.
  assert.equal(
    frankTickets.length,
    4,
    `Legacy flat-mode: 8 armed → clamp til ticketsPerPlayer=4 → 4 brett. ` +
      `Faktisk: ${frankTickets.length}.`,
  );
});
