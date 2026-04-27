/**
 * Tests for buildPlayerReport — Spillvett-rapport for spillere.
 *
 * Lotteritilsynet-rapporter må vise nøyaktig forbruk per spiller. Hvis en
 * STAKE-event mangler eller en PRIZE-event blir telt to ganger, så viser
 * spilleren feil tall i sin spillregnskap. Disse testene dekker:
 *
 *   - Empty input (zero entries / empty halls) → empty report shape
 *   - Hall-filter (kun en hall, vs. alle haller)
 *   - Daily breakdown med tom-dag-fyll i range (ingen entries den dagen)
 *   - hallBreakdown vs gameBreakdown vs dailyGameBreakdown — riktige aggregat
 *   - EXTRA_PRIZE inkluderes i won (ikke STAKE)
 *   - Plays grupperes per (hallId, gameType, channel, roomCode|gameId|id)
 *   - Plays sortert etter lastActivityAt DESC
 *   - Events kuttes til 100 (siste-N)
 *   - Plays kuttes til 100
 *   - Floating-point sum bruker roundCurrency (Number.EPSILON)
 *   - Hallnavn fallback til hallId hvis hall ikke finnes
 *   - Hall-filter på trim-input ("  hall  " → "hall")
 *   - ORG_DISTRIBUTION-events (ikke STAKE/PRIZE/EXTRA_PRIZE) telles i totalEvents men ikke i tall
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { ComplianceLedgerEntry } from "../../game/ComplianceLedgerTypes.js";
import type { HallDefinition } from "../../platform/PlatformService.js";
import { buildPlayerReport, resolvePlayerReportRange } from "../playerReport.js";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeHall(id: string, name: string): HallDefinition {
  return {
    id,
    slug: id,
    name,
    region: "NO",
    address: "",
    isActive: true,
    clientVariant: "web",
    tvToken: `tv-${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function entry(input: Partial<ComplianceLedgerEntry> & {
  id: string;
  createdAt: string;
  hallId: string;
  eventType: ComplianceLedgerEntry["eventType"];
  amount: number;
}): ComplianceLedgerEntry {
  return {
    currency: "NOK",
    gameType: "DATABINGO",
    channel: "INTERNET",
    createdAtMs: Date.parse(input.createdAt),
    ...input,
  };
}

const hallOslo = makeHall("hall-oslo", "Oslo Sentrum");
const hallBergen = makeHall("hall-bergen", "Bergen Sør");

// ── Empty / shape ────────────────────────────────────────────────────────────

test("buildPlayerReport: empty entries returns zeros + empty arrays", () => {
  const range = resolvePlayerReportRange("today", new Date("2026-04-15T12:00:00+02:00"));
  const report = buildPlayerReport({ entries: [], halls: [hallOslo], range });
  assert.equal(report.summary.stakeTotal, 0);
  assert.equal(report.summary.prizeTotal, 0);
  assert.equal(report.summary.netResult, 0);
  assert.equal(report.summary.totalEvents, 0);
  assert.equal(report.summary.totalPlays, 0);
  assert.deepEqual(report.breakdown, []);
  assert.deepEqual(report.plays, []);
  assert.deepEqual(report.events, []);
  assert.deepEqual(report.gameBreakdown, []);
  assert.deepEqual(report.hallBreakdown, []);
  assert.deepEqual(report.dailyGameBreakdown, []);
});

test("buildPlayerReport: empty entries still fills dailyBreakdown for full range", () => {
  // last7 forces 7 days of 0-rows
  const range = resolvePlayerReportRange("last7", new Date(2026, 3, 15, 12, 0, 0));
  const report = buildPlayerReport({ entries: [], halls: [], range });
  assert.equal(report.dailyBreakdown.length, 7);
  for (const d of report.dailyBreakdown) {
    assert.equal(d.wagered, 0);
    assert.equal(d.won, 0);
    assert.equal(d.net, 0);
  }
});

test("buildPlayerReport: hallId is undefined when not provided", () => {
  const range = resolvePlayerReportRange("today", new Date());
  const report = buildPlayerReport({ entries: [], halls: [hallOslo], range });
  assert.equal(report.hallId, undefined);
  assert.equal(report.hallName, undefined);
});

// ── Hall filtering ──────────────────────────────────────────────────────────

test("buildPlayerReport: hallId-filter excludes other halls", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-15T12:00:00+02:00"));
  const entries = [
    entry({
      id: "e-1",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 100,
    }),
    entry({
      id: "e-2",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-bergen",
      eventType: "STAKE",
      amount: 999,
    }),
  ];
  const report = buildPlayerReport({
    entries,
    halls: [hallOslo, hallBergen],
    range,
    hallId: "hall-oslo",
  });
  assert.equal(report.summary.stakeTotal, 100);
  assert.equal(report.summary.totalEvents, 1);
  assert.equal(report.hallId, "hall-oslo");
  assert.equal(report.hallName, "Oslo Sentrum");
});

test("buildPlayerReport: hallId trims whitespace ('  hall-oslo  ')", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-15T12:00:00+02:00"));
  const entries = [
    entry({
      id: "e-1",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 100,
    }),
  ];
  const report = buildPlayerReport({
    entries,
    halls: [hallOslo],
    range,
    hallId: "  hall-oslo  ",
  });
  assert.equal(report.hallId, "hall-oslo");
  assert.equal(report.summary.stakeTotal, 100);
});

test("buildPlayerReport: hallId='' (empty after trim) is treated as no filter", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-15T12:00:00+02:00"));
  const entries = [
    entry({
      id: "e-1",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 50,
    }),
    entry({
      id: "e-2",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-bergen",
      eventType: "STAKE",
      amount: 75,
    }),
  ];
  const report = buildPlayerReport({
    entries,
    halls: [hallOslo, hallBergen],
    range,
    hallId: "   ",
  });
  assert.equal(report.hallId, undefined);
  assert.equal(report.summary.stakeTotal, 125);
});

// ── EXTRA_PRIZE inclusion ────────────────────────────────────────────────────

test("buildPlayerReport: EXTRA_PRIZE counts in won (not in wagered)", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-15T12:00:00+02:00"));
  const entries = [
    entry({
      id: "e-1",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 100,
    }),
    entry({
      id: "e-2",
      createdAt: "2026-04-10T10:01:00.000Z",
      hallId: "hall-oslo",
      eventType: "PRIZE",
      amount: 30,
    }),
    entry({
      id: "e-3",
      createdAt: "2026-04-10T10:02:00.000Z",
      hallId: "hall-oslo",
      eventType: "EXTRA_PRIZE",
      amount: 20,
    }),
  ];
  const report = buildPlayerReport({ entries, halls: [hallOslo], range });
  assert.equal(report.summary.stakeTotal, 100);
  assert.equal(report.summary.prizeTotal, 50); // 30 + 20
  assert.equal(report.summary.netResult, -50); // toNetResult: prize - stake = 50 - 100 = -50
});

test("buildPlayerReport: ORG_DISTRIBUTION counts in totalEvents but not stake/prize", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-15T12:00:00+02:00"));
  const entries = [
    entry({
      id: "e-1",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 100,
    }),
    entry({
      id: "e-2",
      createdAt: "2026-04-10T10:01:00.000Z",
      hallId: "hall-oslo",
      eventType: "ORG_DISTRIBUTION",
      amount: 50,
    }),
  ];
  const report = buildPlayerReport({ entries, halls: [hallOslo], range });
  assert.equal(report.summary.totalEvents, 2);
  assert.equal(report.summary.stakeTotal, 100);
  assert.equal(report.summary.prizeTotal, 0); // ORG_DISTRIBUTION ignored in tally
});

// ── Hall name fallback ──────────────────────────────────────────────────────

test("buildPlayerReport: hallName falls back to hallId when hall not in list", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-15T12:00:00+02:00"));
  const entries = [
    entry({
      id: "e-1",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "ghost-hall",
      eventType: "STAKE",
      amount: 50,
    }),
  ];
  const report = buildPlayerReport({ entries, halls: [hallOslo], range });
  // hallBreakdown should still have entry, falling back to hallId as name
  assert.equal(report.hallBreakdown[0]?.hallName, "ghost-hall");
});

// ── Plays grouping ──────────────────────────────────────────────────────────

test("buildPlayerReport: plays group by (hall, gameType, channel, roomCode)", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-15T12:00:00+02:00"));
  const entries = [
    entry({
      id: "e-1",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 10,
      roomCode: "ROOM-1",
    }),
    entry({
      id: "e-2",
      createdAt: "2026-04-10T10:05:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 10,
      roomCode: "ROOM-1",
    }),
    entry({
      id: "e-3",
      createdAt: "2026-04-10T11:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 5,
      roomCode: "ROOM-2",
    }),
  ];
  const report = buildPlayerReport({ entries, halls: [hallOslo], range });
  assert.equal(report.summary.totalPlays, 2); // ROOM-1 + ROOM-2
  const room1 = report.plays.find((p) => p.roomCode === "ROOM-1")!;
  assert.equal(room1.stakeTotal, 20); // sum of 2 stakes
  assert.equal(room1.totalEvents, 2);
});

test("buildPlayerReport: plays use entry.id as discriminator when roomCode + gameId mangler", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-15T12:00:00+02:00"));
  const entries = [
    entry({
      id: "evt-A",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 10,
    }),
    entry({
      id: "evt-B",
      createdAt: "2026-04-10T10:05:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 20,
    }),
  ];
  const report = buildPlayerReport({ entries, halls: [hallOslo], range });
  // Without roomCode/gameId, each event becomes its own play
  assert.equal(report.summary.totalPlays, 2);
});

test("buildPlayerReport: plays sorted by lastActivityAt DESC", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-15T12:00:00+02:00"));
  const entries = [
    entry({
      id: "e-1",
      createdAt: "2026-04-08T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 10,
      roomCode: "OLD",
    }),
    entry({
      id: "e-2",
      createdAt: "2026-04-12T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 20,
      roomCode: "NEW",
    }),
  ];
  const report = buildPlayerReport({ entries, halls: [hallOslo], range });
  assert.equal(report.plays[0]?.roomCode, "NEW");
  assert.equal(report.plays[1]?.roomCode, "OLD");
});

test("buildPlayerReport: plays.startedAt = MIN, plays.lastActivityAt = MAX of entries", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-15T12:00:00+02:00"));
  const entries = [
    entry({
      id: "e-1",
      createdAt: "2026-04-10T10:30:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 10,
      roomCode: "ROOM-1",
    }),
    entry({
      id: "e-2",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 5,
      roomCode: "ROOM-1",
    }),
    entry({
      id: "e-3",
      createdAt: "2026-04-10T11:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "PRIZE",
      amount: 20,
      roomCode: "ROOM-1",
    }),
  ];
  const report = buildPlayerReport({ entries, halls: [hallOslo], range });
  const room1 = report.plays.find((p) => p.roomCode === "ROOM-1")!;
  assert.equal(room1.startedAt, "2026-04-10T10:00:00.000Z");
  assert.equal(room1.lastActivityAt, "2026-04-10T11:00:00.000Z");
});

// ── Breakdown sorting ────────────────────────────────────────────────────────

test("buildPlayerReport: breakdown sorted by hallName, gameType, channel", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-15T12:00:00+02:00"));
  const entries = [
    entry({
      id: "e-1",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 10,
      gameType: "MAIN_GAME",
      channel: "HALL",
    }),
    entry({
      id: "e-2",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-bergen",
      eventType: "STAKE",
      amount: 20,
      gameType: "DATABINGO",
      channel: "INTERNET",
    }),
    entry({
      id: "e-3",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 30,
      gameType: "DATABINGO",
      channel: "INTERNET",
    }),
  ];
  const report = buildPlayerReport({
    entries,
    halls: [hallOslo, hallBergen],
    range,
  });
  // Bergen Sør (B) sorts before Oslo Sentrum (O)
  assert.equal(report.breakdown[0]?.hallName, "Bergen Sør");
  // Within Oslo Sentrum: DATABINGO before MAIN_GAME alphabetically
  const osloRows = report.breakdown.filter((b) => b.hallName === "Oslo Sentrum");
  assert.equal(osloRows[0]?.gameType, "DATABINGO");
  assert.equal(osloRows[1]?.gameType, "MAIN_GAME");
});

// ── Daily breakdown gap-fill ─────────────────────────────────────────────────

test("buildPlayerReport: dailyBreakdown fills 0-rows for days without entries", () => {
  const range = resolvePlayerReportRange("last7", new Date(2026, 3, 15, 12, 0, 0));
  const entries = [
    entry({
      id: "e-1",
      createdAt: "2026-04-12T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 50,
    }),
  ];
  const report = buildPlayerReport({ entries, halls: [hallOslo], range });
  // Last7 → 7 days; only 1 day has events
  assert.equal(report.dailyBreakdown.length, 7);
  const apr12 = report.dailyBreakdown.find((d) => d.date === "2026-04-12")!;
  assert.equal(apr12.wagered, 50);
  const apr11 = report.dailyBreakdown.find((d) => d.date === "2026-04-11")!;
  assert.equal(apr11.wagered, 0);
});

// ── Daily-game breakdown ─────────────────────────────────────────────────────

test("buildPlayerReport: dailyGameBreakdown groups per (date, gameType, hall)", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-15T12:00:00+02:00"));
  const entries = [
    entry({
      id: "e-1",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 10,
      gameType: "DATABINGO",
    }),
    entry({
      id: "e-2",
      createdAt: "2026-04-10T11:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 5,
      gameType: "MAIN_GAME",
    }),
    entry({
      id: "e-3",
      createdAt: "2026-04-11T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 20,
      gameType: "DATABINGO",
    }),
  ];
  const report = buildPlayerReport({ entries, halls: [hallOslo], range });
  // 3 unique (date, gameType, hall) combos
  assert.equal(report.dailyGameBreakdown.length, 3);
  const apr10db = report.dailyGameBreakdown.find(
    (d) => d.date === "2026-04-10" && d.gameType === "DATABINGO",
  )!;
  assert.equal(apr10db.wagered, 10);
});

test("buildPlayerReport: dailyGameBreakdown sorted ascending by date", () => {
  const range = resolvePlayerReportRange("last30", new Date("2026-04-30T12:00:00+02:00"));
  const entries = [
    entry({
      id: "e-1",
      createdAt: "2026-04-20T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 10,
    }),
    entry({
      id: "e-2",
      createdAt: "2026-04-05T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 10,
    }),
  ];
  const report = buildPlayerReport({ entries, halls: [hallOslo], range });
  assert.equal(report.dailyGameBreakdown[0]?.date, "2026-04-05");
  assert.equal(report.dailyGameBreakdown[1]?.date, "2026-04-20");
});

// ── Hall breakdown ───────────────────────────────────────────────────────────

test("buildPlayerReport: hallBreakdown counts plays per hall (only STAKE events)", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-15T12:00:00+02:00"));
  const entries = [
    entry({
      id: "e-1",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 100,
    }),
    entry({
      id: "e-2",
      createdAt: "2026-04-10T10:01:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 50,
    }),
    entry({
      id: "e-3",
      createdAt: "2026-04-10T10:02:00.000Z",
      hallId: "hall-oslo",
      eventType: "PRIZE",
      amount: 30,
    }),
  ];
  const report = buildPlayerReport({ entries, halls: [hallOslo], range });
  const oslo = report.hallBreakdown.find((h) => h.hallId === "hall-oslo")!;
  assert.equal(oslo.wagered, 150);
  assert.equal(oslo.won, 30);
  assert.equal(oslo.net, -120);
  assert.equal(oslo.plays, 2); // 2 STAKE events
});

// ── Floating-point sums (Number.EPSILON rounding) ──────────────────────────

test("buildPlayerReport: roundCurrency handles floating-point sums correctly", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-15T12:00:00+02:00"));
  const entries = [
    entry({
      id: "e-1",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 0.1,
    }),
    entry({
      id: "e-2",
      createdAt: "2026-04-10T10:01:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 0.2,
    }),
  ];
  const report = buildPlayerReport({ entries, halls: [hallOslo], range });
  // 0.1 + 0.2 = 0.30000000000000004 in JS floating-point — must be rounded to 0.3
  assert.equal(report.summary.stakeTotal, 0.3);
});

// ── Cap on plays + events ────────────────────────────────────────────────────

test("buildPlayerReport: events list capped at 100", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-15T12:00:00+02:00"));
  const entries: ComplianceLedgerEntry[] = [];
  for (let i = 0; i < 150; i++) {
    entries.push(
      entry({
        id: `e-${i}`,
        createdAt: `2026-04-${10 + Math.floor(i / 30)}T10:${String(i % 60).padStart(2, "0")}:00.000Z`,
        hallId: "hall-oslo",
        eventType: "STAKE",
        amount: 1,
        roomCode: `R-${i % 5}`,
      }),
    );
  }
  const report = buildPlayerReport({ entries, halls: [hallOslo], range });
  assert.equal(report.events.length, 100);
  // totalEvents stays at 150 — capping is for events array only
  assert.equal(report.summary.totalEvents, 150);
});

test("buildPlayerReport: plays list capped at 100", () => {
  const range = resolvePlayerReportRange("last30", new Date("2026-04-30T12:00:00+02:00"));
  const entries: ComplianceLedgerEntry[] = [];
  for (let i = 0; i < 120; i++) {
    entries.push(
      entry({
        id: `e-${i}`,
        createdAt: `2026-04-15T${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`,
        hallId: "hall-oslo",
        eventType: "STAKE",
        amount: 1,
        roomCode: `R-${i}`, // unique → 120 distinct plays
      }),
    );
  }
  const report = buildPlayerReport({ entries, halls: [hallOslo], range });
  assert.equal(report.plays.length, 100);
  // totalPlays in summary keeps full count
  assert.equal(report.summary.totalPlays, 120);
});

// ── Game breakdown ───────────────────────────────────────────────────────────

test("buildPlayerReport: gameBreakdown groups per (gameType, hallId)", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-15T12:00:00+02:00"));
  const entries = [
    entry({
      id: "e-1",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 10,
      gameType: "DATABINGO",
    }),
    entry({
      id: "e-2",
      createdAt: "2026-04-10T11:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 20,
      gameType: "MAIN_GAME",
    }),
    entry({
      id: "e-3",
      createdAt: "2026-04-10T12:00:00.000Z",
      hallId: "hall-bergen",
      eventType: "STAKE",
      amount: 5,
      gameType: "DATABINGO",
    }),
  ];
  const report = buildPlayerReport({
    entries,
    halls: [hallOslo, hallBergen],
    range,
  });
  // 3 distinct (gameType, hallId) combos
  assert.equal(report.gameBreakdown.length, 3);
  const osloDb = report.gameBreakdown.find(
    (g) => g.gameType === "DATABINGO" && g.hallId === "hall-oslo",
  )!;
  assert.equal(osloDb.wagered, 10);
  assert.equal(osloDb.plays, 1);
});

// ── Channels ────────────────────────────────────────────────────────────────

test("buildPlayerReport: HALL and INTERNET channels are kept separate in breakdown", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-15T12:00:00+02:00"));
  const entries = [
    entry({
      id: "e-1",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 10,
      gameType: "DATABINGO",
      channel: "INTERNET",
    }),
    entry({
      id: "e-2",
      createdAt: "2026-04-10T11:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 50,
      gameType: "DATABINGO",
      channel: "HALL",
    }),
  ];
  const report = buildPlayerReport({ entries, halls: [hallOslo], range });
  // 2 separate breakdown rows (channel differs)
  assert.equal(report.breakdown.length, 2);
  const internet = report.breakdown.find((b) => b.channel === "INTERNET")!;
  const hall = report.breakdown.find((b) => b.channel === "HALL")!;
  assert.equal(internet.stakeTotal, 10);
  assert.equal(hall.stakeTotal, 50);
});

// ── Net result regression ───────────────────────────────────────────────────

test("buildPlayerReport: netResult uses prize - stake (matches PR #350 fix)", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-15T12:00:00+02:00"));
  const entries = [
    entry({
      id: "e-1",
      createdAt: "2026-04-10T10:00:00.000Z",
      hallId: "hall-oslo",
      eventType: "STAKE",
      amount: 100,
    }),
    entry({
      id: "e-2",
      createdAt: "2026-04-10T10:05:00.000Z",
      hallId: "hall-oslo",
      eventType: "PRIZE",
      amount: 500, // big win
    }),
  ];
  const report = buildPlayerReport({ entries, halls: [hallOslo], range });
  // netResult = prize - stake = 500 - 100 = +400 (positive when winning, no cap)
  assert.equal(report.summary.netResult, 400);
});
