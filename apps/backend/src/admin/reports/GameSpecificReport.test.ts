/**
 * GAP #28: unit-tester for buildGameSpecificReport.
 *
 * Dekker:
 *   - Slug-mapping: bingo, rocket, monsterbingo, spillorama.
 *   - Slug-extraction: metadata.gameSlug + GAME1_*-fallback.
 *   - Tom hall / ingen sessions ⇒ null-aggregater (ikke krasj).
 *   - Window-filter: utenfor [from, to] ekskluderes.
 *   - Hall-filter respekteres.
 *   - Channel-breakdown: HALL vs INTERNET.
 *   - Per-hall rader sortert på hallName.
 *   - Spilltype-spesifikke felter:
 *     - bingo: subGameKindBreakdown + lucky/jackpot/minigame.
 *     - rocket: rocketStackingRounds + blindBuy + lucky.
 *     - monsterbingo: patternsEvaluated + ballFifoEvents.
 *     - spillorama: roulette + freeSpinJackpot + swapTicket.
 *   - Category: Hovedspill for 1-3, Databingo for spillorama.
 *   - CSV-export: header + per-hall + totals + channel + game-specific.
 *   - Ugyldig vindu kaster.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { ComplianceLedgerEntry } from "../../game/ComplianceLedger.js";
import type { HallDefinition } from "../../platform/PlatformService.js";
import {
  buildGameSpecificReport,
  exportGameSpecificReportCsv,
  SUPPORTED_GAME_SPECIFIC_SLUGS,
} from "./GameSpecificReport.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function hall(id: string, name: string): HallDefinition {
  return {
    id,
    slug: id,
    name,
    region: "NO",
    address: "",
    isActive: true,
    clientVariant: "web",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function entry(opts: {
  id: string;
  hallId: string;
  gameId?: string;
  playerId?: string;
  type: "STAKE" | "PRIZE" | "EXTRA_PRIZE";
  amount: number;
  channel?: "HALL" | "INTERNET";
  gameType?: "MAIN_GAME" | "DATABINGO";
  createdAt?: string;
  metadata?: Record<string, unknown>;
}): ComplianceLedgerEntry {
  const createdAt = opts.createdAt ?? "2026-04-18T18:00:00.000Z";
  return {
    id: opts.id,
    createdAt,
    createdAtMs: Date.parse(createdAt),
    hallId: opts.hallId,
    gameType: opts.gameType ?? "MAIN_GAME",
    channel: opts.channel ?? "HALL",
    eventType: opts.type,
    amount: opts.amount,
    currency: "NOK",
    gameId: opts.gameId,
    playerId: opts.playerId,
    metadata: opts.metadata,
  };
}

const FROM = "2026-04-18T00:00:00.000Z";
const TO = "2026-04-18T23:59:59.999Z";

const halls = [hall("hall-a", "Alpha"), hall("hall-b", "Beta")];

// ── Slug-mapping + filter ──────────────────────────────────────────────────

test("GAP-28: bingo-slug aggregerer entries med metadata.gameSlug='bingo'", () => {
  const entries = [
    entry({
      id: "e1", hallId: "hall-a", gameId: "g1", playerId: "p1",
      type: "STAKE", amount: 50, metadata: { gameSlug: "bingo" },
    }),
    entry({
      id: "e2", hallId: "hall-a", gameId: "g1", playerId: "p1",
      type: "PRIZE", amount: 30, metadata: { gameSlug: "bingo" },
    }),
    // Ekskluderes — annen slug
    entry({
      id: "e3", hallId: "hall-a", gameId: "g2", playerId: "p2",
      type: "STAKE", amount: 100, metadata: { gameSlug: "rocket" },
    }),
  ];
  const r = buildGameSpecificReport({ slug: "bingo", entries, halls, from: FROM, to: TO });
  assert.equal(r.totals.totalStakes, 50);
  assert.equal(r.totals.totalPrizes, 30);
  assert.equal(r.totals.net, 20);
  assert.equal(r.totals.rounds, 1);
  assert.equal(r.totals.distinctPlayers, 1);
  assert.equal(r.category, "Hovedspill");
});

test("GAP-28: GAME1_*-reason fallback for bingo-slug uten gameSlug", () => {
  const entries = [
    entry({
      id: "e1", hallId: "hall-a", gameId: "g1", playerId: "p1",
      type: "STAKE", amount: 50, metadata: { reason: "GAME1_PURCHASE" },
    }),
    entry({
      id: "e2", hallId: "hall-a", gameId: "g1", playerId: "p1",
      type: "PRIZE", amount: 20, metadata: { reason: "GAME1_PHASE_PAYOUT", phase: 1 },
    }),
  ];
  const r = buildGameSpecificReport({ slug: "bingo", entries, halls, from: FROM, to: TO });
  assert.equal(r.totals.totalStakes, 50);
  assert.equal(r.totals.totalPrizes, 20);
});

test("GAP-28: entries uten slug-tag hopper over (verken gameSlug eller GAME1_-reason)", () => {
  const entries = [
    entry({
      id: "e1", hallId: "hall-a", gameId: "g1", type: "STAKE", amount: 50,
      metadata: { reason: "BINGO_BUYIN" /* ingen gameSlug */ },
    }),
  ];
  const r = buildGameSpecificReport({ slug: "bingo", entries, halls, from: FROM, to: TO });
  assert.equal(r.totals.totalStakes, 0);
  assert.equal(r.totals.rounds, 0);
});

// ── Window + hall-filter ────────────────────────────────────────────────────

test("GAP-28: entries utenfor vindu ekskluderes", () => {
  const entries = [
    entry({
      id: "e1", hallId: "hall-a", gameId: "g1", playerId: "p1",
      type: "STAKE", amount: 50,
      createdAt: "2026-04-19T18:00:00.000Z", // dagen etter
      metadata: { gameSlug: "bingo" },
    }),
  ];
  const r = buildGameSpecificReport({ slug: "bingo", entries, halls, from: FROM, to: TO });
  assert.equal(r.totals.totalStakes, 0);
});

test("GAP-28: hall-filter respekteres", () => {
  const entries = [
    entry({
      id: "e1", hallId: "hall-a", gameId: "g1", playerId: "p1",
      type: "STAKE", amount: 50, metadata: { gameSlug: "bingo" },
    }),
    entry({
      id: "e2", hallId: "hall-b", gameId: "g2", playerId: "p2",
      type: "STAKE", amount: 100, metadata: { gameSlug: "bingo" },
    }),
  ];
  const r = buildGameSpecificReport({
    slug: "bingo", entries, halls, from: FROM, to: TO, hallId: "hall-a",
  });
  assert.equal(r.totals.totalStakes, 50);
  assert.equal(r.filters.hallId, "hall-a");
  assert.equal(r.rows.length, 1);
});

test("GAP-28: tom hall ⇒ null-aggregater (ikke krasj)", () => {
  const r = buildGameSpecificReport({
    slug: "bingo", entries: [], halls: [hall("hall-empty", "Empty")],
    from: FROM, to: TO, hallId: "hall-empty",
  });
  assert.equal(r.totals.totalStakes, 0);
  assert.equal(r.totals.rounds, 0);
  assert.equal(r.rows.length, 0);
  assert.equal(r.channelBreakdown.hallChannel.totalStakes, 0);
});

test("GAP-28: ingen sessions ⇒ alle KPI-er null", () => {
  const r = buildGameSpecificReport({
    slug: "rocket", entries: [], halls, from: FROM, to: TO,
  });
  assert.equal(r.totals.payoutPct, 0);
  assert.equal(r.totals.distinctPlayers, 0);
  assert.equal(r.gameSpecific.slug, "rocket");
});

// ── Channel breakdown ──────────────────────────────────────────────────────

test("GAP-28: channel breakdown skiller HALL og INTERNET", () => {
  const entries = [
    entry({
      id: "e1", hallId: "hall-a", gameId: "g1", playerId: "p1",
      type: "STAKE", amount: 50, channel: "HALL",
      metadata: { gameSlug: "bingo" },
    }),
    entry({
      id: "e2", hallId: "hall-a", gameId: "g2", playerId: "p2",
      type: "STAKE", amount: 80, channel: "INTERNET",
      metadata: { gameSlug: "bingo" },
    }),
    entry({
      id: "e3", hallId: "hall-a", gameId: "g2", playerId: "p2",
      type: "PRIZE", amount: 10, channel: "INTERNET",
      metadata: { gameSlug: "bingo" },
    }),
  ];
  const r = buildGameSpecificReport({ slug: "bingo", entries, halls, from: FROM, to: TO });
  assert.equal(r.channelBreakdown.hallChannel.totalStakes, 50);
  assert.equal(r.channelBreakdown.hallChannel.totalPrizes, 0);
  assert.equal(r.channelBreakdown.internetChannel.totalStakes, 80);
  assert.equal(r.channelBreakdown.internetChannel.totalPrizes, 10);
  assert.equal(r.channelBreakdown.internetChannel.payoutPct, 12.5);
});

// ── Per-hall rader ─────────────────────────────────────────────────────────

test("GAP-28: per-hall rader sortert på hallName", () => {
  const entries = [
    entry({
      id: "e1", hallId: "hall-b", gameId: "g1", playerId: "p1",
      type: "STAKE", amount: 50, metadata: { gameSlug: "bingo" },
    }),
    entry({
      id: "e2", hallId: "hall-a", gameId: "g2", playerId: "p2",
      type: "STAKE", amount: 80, metadata: { gameSlug: "bingo" },
    }),
  ];
  const r = buildGameSpecificReport({ slug: "bingo", entries, halls, from: FROM, to: TO });
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].hallName, "Alpha");
  assert.equal(r.rows[1].hallName, "Beta");
});

// ── Spilltype-spesifikke felter ─────────────────────────────────────────────

test("GAP-28 bingo: subGameKindBreakdown + lucky + jackpot + minigame", () => {
  const entries = [
    entry({
      id: "e1", hallId: "hall-a", gameId: "g1", playerId: "p1", type: "STAKE",
      amount: 30, metadata: { gameSlug: "bingo", subGameKind: "wheel" },
    }),
    entry({
      id: "e2", hallId: "hall-a", gameId: "g1", playerId: "p2", type: "STAKE",
      amount: 30, metadata: { gameSlug: "bingo", subGameKind: "chest" },
    }),
    entry({
      id: "e3", hallId: "hall-a", gameId: "g1", playerId: "p1", type: "PRIZE",
      amount: 100, metadata: { gameSlug: "bingo", isLuckyNumber: true },
    }),
    entry({
      id: "e4", hallId: "hall-a", gameId: "g1", playerId: "p2", type: "EXTRA_PRIZE",
      amount: 200, metadata: { gameSlug: "bingo", reason: "GAME1_JACKPOT" },
    }),
    entry({
      id: "e5", hallId: "hall-a", gameId: "g1", playerId: "p1", type: "PRIZE",
      amount: 50, metadata: { gameSlug: "bingo", reason: "GAME1_PHASE_PAYOUT", phaseName: "Wheel" },
    }),
  ];
  const r = buildGameSpecificReport({ slug: "bingo", entries, halls, from: FROM, to: TO });
  assert.equal(r.gameSpecific.slug, "bingo");
  if (r.gameSpecific.slug !== "bingo") throw new Error("expected bingo");
  const s = r.gameSpecific.specifics;
  assert.equal(s.subGameKindBreakdown.wheel, 1);
  assert.equal(s.subGameKindBreakdown.chest, 1);
  assert.equal(s.luckyNumberPayouts.count, 1);
  assert.equal(s.luckyNumberPayouts.total, 100);
  assert.equal(s.jackpotPayouts.count, 1);
  assert.equal(s.jackpotPayouts.total, 200);
  assert.equal(s.miniGamePayouts.count, 1);
  assert.equal(s.miniGamePayouts.total, 50);
});

test("GAP-28 rocket: rocketStackingRounds + blindBuy + lucky", () => {
  const entries = [
    entry({
      id: "e1", hallId: "hall-a", gameId: "g1", playerId: "p1", type: "STAKE",
      amount: 30, metadata: { gameSlug: "rocket", rocketStacking: true },
    }),
    entry({
      id: "e2", hallId: "hall-a", gameId: "g1", playerId: "p2", type: "STAKE",
      amount: 30, metadata: { gameSlug: "rocket", rocketStacking: true, blindBuy: true },
    }),
    entry({
      id: "e3", hallId: "hall-a", gameId: "g2", playerId: "p1", type: "STAKE",
      amount: 30, metadata: { gameSlug: "rocket", blindBuy: true },
    }),
    entry({
      id: "e4", hallId: "hall-a", gameId: "g2", playerId: "p1", type: "PRIZE",
      amount: 100, metadata: { gameSlug: "rocket", isLuckyNumber: true },
    }),
  ];
  const r = buildGameSpecificReport({ slug: "rocket", entries, halls, from: FROM, to: TO });
  if (r.gameSpecific.slug !== "rocket") throw new Error("expected rocket");
  const s = r.gameSpecific.specifics;
  assert.equal(s.rocketStackingRounds, 1); // distinct gameIds (g1)
  assert.equal(s.blindTicketBuys.count, 2);
  assert.equal(s.blindTicketBuys.total, 60);
  assert.equal(s.luckyNumberPayouts.count, 1);
});

test("GAP-28 monsterbingo: pattern + ballFifo", () => {
  const entries = [
    entry({
      id: "e1", hallId: "hall-a", gameId: "g1", playerId: "p1", type: "STAKE",
      amount: 30, metadata: { gameSlug: "monsterbingo", ballFifoEvent: true },
    }),
    entry({
      id: "e2", hallId: "hall-a", gameId: "g1", playerId: "p1", type: "PRIZE",
      amount: 100, metadata: { gameSlug: "monsterbingo", patternEvaluated: "diagonal" },
    }),
    entry({
      id: "e3", hallId: "hall-a", gameId: "g2", playerId: "p2", type: "PRIZE",
      amount: 50, metadata: { gameSlug: "monsterbingo", patternEvaluated: "fullhouse" },
    }),
  ];
  const r = buildGameSpecificReport({ slug: "monsterbingo", entries, halls, from: FROM, to: TO });
  if (r.gameSpecific.slug !== "monsterbingo") throw new Error("expected monsterbingo");
  const s = r.gameSpecific.specifics;
  assert.equal(s.patternsEvaluated, 2);
  assert.equal(s.ballFifoEvents, 1);
  assert.equal(s.patternBreakdown.diagonal, 1);
  assert.equal(s.patternBreakdown.fullhouse, 1);
});

test("GAP-28 spillorama (databingo): roulette + freeSpinJackpot + swapTicket", () => {
  const entries = [
    entry({
      id: "e1", hallId: "hall-a", gameId: "g1", playerId: "p1", type: "STAKE",
      amount: 30, gameType: "DATABINGO", channel: "INTERNET",
      metadata: { gameSlug: "spillorama" },
    }),
    entry({
      id: "e2", hallId: "hall-a", gameId: "g1", playerId: "p1", type: "STAKE",
      amount: 5, gameType: "DATABINGO", channel: "INTERNET",
      metadata: { gameSlug: "spillorama", swapTicket: true },
    }),
    entry({
      id: "e3", hallId: "hall-a", gameId: "g1", playerId: "p1", type: "PRIZE",
      amount: 200, gameType: "DATABINGO", channel: "INTERNET",
      metadata: { gameSlug: "spillorama", rouletteOutcome: true },
    }),
    entry({
      id: "e4", hallId: "hall-a", gameId: "g2", playerId: "p2", type: "EXTRA_PRIZE",
      amount: 1000, gameType: "DATABINGO", channel: "INTERNET",
      metadata: { gameSlug: "spillorama", freeSpinJackpot: true },
    }),
  ];
  const r = buildGameSpecificReport({ slug: "spillorama", entries, halls, from: FROM, to: TO });
  assert.equal(r.category, "Databingo");
  if (r.gameSpecific.slug !== "spillorama") throw new Error("expected spillorama");
  const s = r.gameSpecific.specifics;
  assert.equal(s.rouletteOutcomes.count, 1);
  assert.equal(s.rouletteOutcomes.total, 200);
  assert.equal(s.freeSpinJackpotPayouts.count, 1);
  assert.equal(s.freeSpinJackpotPayouts.total, 1000);
  assert.equal(s.swapTicketUses, 1);
});

// ── CSV-export ──────────────────────────────────────────────────────────────

test("GAP-28 csv: header + per-hall + totals + channel + game-specific", () => {
  const entries = [
    entry({
      id: "e1", hallId: "hall-a", gameId: "g1", playerId: "p1", type: "STAKE",
      amount: 50, metadata: { gameSlug: "bingo", subGameKind: "wheel" },
    }),
    entry({
      id: "e2", hallId: "hall-a", gameId: "g1", playerId: "p1", type: "PRIZE",
      amount: 20, metadata: { gameSlug: "bingo" },
    }),
  ];
  const r = buildGameSpecificReport({ slug: "bingo", entries, halls, from: FROM, to: TO });
  const csv = exportGameSpecificReportCsv(r);
  assert.match(csv, /section,hall_id,hall_name/);
  assert.match(csv, /per_hall,hall-a,Alpha/);
  assert.match(csv, /totals,ALL,ALL/);
  assert.match(csv, /channel,HALL/);
  assert.match(csv, /channel,INTERNET/);
  assert.match(csv, /game_specific,subgame_kind_wheel,1/);
});

test("GAP-28 csv: hall-name med komma escapes riktig", () => {
  const hallsWithComma = [hall("hall-x", "Drammen, Hovedhall")];
  const entries = [
    entry({
      id: "e1", hallId: "hall-x", gameId: "g1", playerId: "p1", type: "STAKE",
      amount: 50, metadata: { gameSlug: "bingo" },
    }),
  ];
  const r = buildGameSpecificReport({
    slug: "bingo", entries, halls: hallsWithComma, from: FROM, to: TO,
  });
  const csv = exportGameSpecificReportCsv(r);
  // Hall-navnet skal være quote-escaped i CSV.
  assert.match(csv, /"Drammen, Hovedhall"/);
});

// ── Validation ──────────────────────────────────────────────────────────────

test("GAP-28: ugyldig vindu kaster", () => {
  assert.throws(() =>
    buildGameSpecificReport({
      slug: "bingo", entries: [], halls,
      from: "2026-04-20T00:00:00.000Z", to: "2026-04-18T00:00:00.000Z",
    }),
  );
});

test("GAP-28: alle slugs er Hovedspill bortsett fra spillorama", () => {
  for (const slug of SUPPORTED_GAME_SPECIFIC_SLUGS) {
    const r = buildGameSpecificReport({ slug, entries: [], halls, from: FROM, to: TO });
    if (slug === "spillorama") {
      assert.equal(r.category, "Databingo");
    } else {
      assert.equal(r.category, "Hovedspill");
    }
  }
});
