/**
 * BIN-647 unit-tester for subgame drill-down aggregat.
 *
 * Dekker:
 *   - Revenue/profit-beregning per sub-game.
 *   - Unique players (wallet-basert, STAKE-only).
 *   - Empty window gir 0-rader men fortsatt én rad per child.
 *   - ORG_DISTRIBUTION ekskluderes (samme regel som BIN-628).
 *   - Cursor-paginering (offset-basert, stabil).
 *   - Sortering følger sub_game_sequence.
 *   - totals dekker ALLE sub-games, ikke bare side.
 *   - Ugyldig vindu kaster.
 *   - hall-scope holdes implisitt av entry-filteret fra input.
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { ComplianceLedgerEntry } from "../../game/ComplianceLedger.js";
import type { HallDefinition, ScheduleLogEntry, ScheduleSlot } from "../../platform/PlatformService.js";
import { buildSubgameDrillDown } from "./SubgameDrillDownReport.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

function hall(id: string, name: string): HallDefinition {
  return {
    id,
    slug: id,
    name,
    region: "NO",
    address: "",
    isActive: true,
    clientVariant: "unity",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function child(
  id: string,
  sequence: number,
  hallId: string,
  parentId = "parent-1",
  extras: Partial<ScheduleSlot> = {},
): ScheduleSlot {
  return {
    id,
    hallId,
    gameType: "standard",
    displayName: `SubGame ${sequence}`,
    dayOfWeek: null,
    startTime: "18:00",
    prizeDescription: "",
    maxTickets: 30,
    isActive: true,
    sortOrder: 0,
    variantConfig: { gameMode: "standard" },
    parentScheduleId: parentId,
    subGameSequence: sequence,
    subGameNumber: `CH_${sequence}_20260418_G2`,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...extras,
  };
}

function log(
  scheduleSlotId: string,
  gameSessionId: string,
  startedAt = "2026-04-18T18:00:00.000Z",
): ScheduleLogEntry {
  return {
    id: `log-${scheduleSlotId}-${gameSessionId}`,
    hallId: "hall-a",
    scheduleSlotId,
    gameSessionId,
    startedAt,
    endedAt: null,
    playerCount: null,
    totalPayout: null,
    notes: null,
    createdAt: startedAt,
  };
}

function entry(
  overrides: Partial<ComplianceLedgerEntry> &
    Pick<ComplianceLedgerEntry, "id" | "hallId" | "eventType" | "amount" | "createdAt" | "gameId">,
): ComplianceLedgerEntry {
  return {
    currency: "NOK",
    createdAtMs: Date.parse(overrides.createdAt),
    gameType: "MAIN_GAME",
    channel: "HALL",
    ...overrides,
  } as ComplianceLedgerEntry;
}

const HALLS: HallDefinition[] = [hall("hall-a", "Alpha Bingohall"), hall("hall-b", "Beta")];
const WINDOW_FROM = "2026-04-18T00:00:00.000Z";
const WINDOW_TO = "2026-04-19T00:00:00.000Z";

// ── Baseline ───────────────────────────────────────────────────────────────

test("buildSubgameDrillDown: aggregates revenue / winnings / net / players per sub-game", () => {
  const children = [child("sg-1", 1, "hall-a"), child("sg-2", 2, "hall-a")];
  const scheduleLogs = [
    log("sg-1", "game-session-1"),
    log("sg-2", "game-session-2"),
  ];
  const entries: ComplianceLedgerEntry[] = [
    // sg-1 → game-session-1
    entry({ id: "s1", hallId: "hall-a", gameId: "game-session-1", eventType: "STAKE", amount: 100, walletId: "w1", createdAt: "2026-04-18T18:05:00.000Z" }),
    entry({ id: "s2", hallId: "hall-a", gameId: "game-session-1", eventType: "STAKE", amount: 200, walletId: "w2", createdAt: "2026-04-18T18:10:00.000Z" }),
    entry({ id: "p1", hallId: "hall-a", gameId: "game-session-1", eventType: "PRIZE", amount: 50, walletId: "w1", createdAt: "2026-04-18T18:20:00.000Z" }),
    // sg-2 → game-session-2
    entry({ id: "s3", hallId: "hall-a", gameId: "game-session-2", eventType: "STAKE", amount: 400, walletId: "w3", createdAt: "2026-04-18T19:00:00.000Z" }),
    entry({ id: "ep1", hallId: "hall-a", gameId: "game-session-2", eventType: "EXTRA_PRIZE", amount: 80, walletId: "w3", createdAt: "2026-04-18T19:05:00.000Z" }),
  ];

  const result = buildSubgameDrillDown({
    parentId: "parent-1",
    children,
    scheduleLogs,
    entries,
    halls: HALLS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });

  assert.equal(result.items.length, 2);
  const sg1 = result.items.find((r) => r.subGameId === "sg-1")!;
  assert.equal(sg1.revenue, 300);
  assert.equal(sg1.totalWinnings, 50);
  assert.equal(sg1.netProfit, 250);
  assert.equal(sg1.ticketCount, 2);
  assert.equal(sg1.players, 2);
  assert.equal(sg1.hallName, "Alpha Bingohall");
  assert.equal(sg1.name, "SubGame 1");
  assert.equal(sg1.sequence, 1);
  assert.equal(sg1.profitPercentage, Number(((250 / 300) * 100).toFixed(2)));

  const sg2 = result.items.find((r) => r.subGameId === "sg-2")!;
  assert.equal(sg2.revenue, 400);
  assert.equal(sg2.totalWinnings, 80);
  assert.equal(sg2.netProfit, 320);
  assert.equal(sg2.players, 1);

  // totals covers all children
  assert.equal(result.totals.revenue, 700);
  assert.equal(result.totals.totalWinnings, 130);
  assert.equal(result.totals.netProfit, 570);
  assert.equal(result.totals.players, 3); // w1, w2, w3
  assert.equal(result.totals.ticketCount, 3);

  assert.equal(result.nextCursor, null);
});

test("buildSubgameDrillDown: empty window still returns a row per child (zeros)", () => {
  const children = [child("sg-1", 1, "hall-a"), child("sg-2", 2, "hall-a")];
  const result = buildSubgameDrillDown({
    parentId: "parent-1",
    children,
    scheduleLogs: [],
    entries: [],
    halls: HALLS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });
  assert.equal(result.items.length, 2);
  for (const item of result.items) {
    assert.equal(item.revenue, 0);
    assert.equal(item.totalWinnings, 0);
    assert.equal(item.netProfit, 0);
    assert.equal(item.players, 0);
    assert.equal(item.profitPercentage, 0);
    assert.equal(item.startDate, null);
  }
  assert.equal(result.totals.revenue, 0);
});

test("buildSubgameDrillDown: ORG_DISTRIBUTION ekskluderes — ikke spiller-spend", () => {
  const children = [child("sg-1", 1, "hall-a")];
  const scheduleLogs = [log("sg-1", "gs-1")];
  const entries: ComplianceLedgerEntry[] = [
    entry({ id: "s1", hallId: "hall-a", gameId: "gs-1", eventType: "STAKE", amount: 100, walletId: "w1", createdAt: "2026-04-18T18:00:00.000Z" }),
    entry({ id: "o1", hallId: "hall-a", gameId: "gs-1", eventType: "ORG_DISTRIBUTION" as "STAKE", amount: 9999, walletId: "w1", createdAt: "2026-04-18T18:05:00.000Z" }),
  ];

  const result = buildSubgameDrillDown({
    parentId: "parent-1",
    children,
    scheduleLogs,
    entries,
    halls: HALLS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });
  assert.equal(result.items[0]!.revenue, 100);
  assert.equal(result.items[0]!.totalWinnings, 0);
});

test("buildSubgameDrillDown: entries utenfor vinduet ignoreres", () => {
  const children = [child("sg-1", 1, "hall-a")];
  const scheduleLogs = [log("sg-1", "gs-1")];
  const entries: ComplianceLedgerEntry[] = [
    entry({ id: "before", hallId: "hall-a", gameId: "gs-1", eventType: "STAKE", amount: 999, walletId: "w1", createdAt: "2026-04-17T00:00:00.000Z" }),
    entry({ id: "inside", hallId: "hall-a", gameId: "gs-1", eventType: "STAKE", amount: 100, walletId: "w1", createdAt: "2026-04-18T12:00:00.000Z" }),
    entry({ id: "after", hallId: "hall-a", gameId: "gs-1", eventType: "STAKE", amount: 888, walletId: "w1", createdAt: "2026-04-20T00:00:00.000Z" }),
  ];
  const result = buildSubgameDrillDown({
    parentId: "parent-1",
    children,
    scheduleLogs,
    entries,
    halls: HALLS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });
  assert.equal(result.items[0]!.revenue, 100);
  assert.equal(result.items[0]!.ticketCount, 1);
});

test("buildSubgameDrillDown: cursor-paginering — stabil offset, nextCursor = null på siste side", () => {
  const children = Array.from({ length: 7 }, (_, i) => child(`sg-${i + 1}`, i + 1, "hall-a"));
  const page1 = buildSubgameDrillDown({
    parentId: "parent-1",
    children,
    scheduleLogs: [],
    entries: [],
    halls: HALLS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
    pageSize: 3,
  });
  assert.equal(page1.items.length, 3);
  assert.deepEqual(
    page1.items.map((r) => r.subGameId),
    ["sg-1", "sg-2", "sg-3"],
  );
  assert.ok(page1.nextCursor, "page 1 skal ha nextCursor");

  const page2 = buildSubgameDrillDown({
    parentId: "parent-1",
    children,
    scheduleLogs: [],
    entries: [],
    halls: HALLS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
    pageSize: 3,
    cursor: page1.nextCursor!,
  });
  assert.equal(page2.items.length, 3);
  assert.deepEqual(
    page2.items.map((r) => r.subGameId),
    ["sg-4", "sg-5", "sg-6"],
  );
  assert.ok(page2.nextCursor);

  const page3 = buildSubgameDrillDown({
    parentId: "parent-1",
    children,
    scheduleLogs: [],
    entries: [],
    halls: HALLS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
    pageSize: 3,
    cursor: page2.nextCursor!,
  });
  assert.equal(page3.items.length, 1);
  assert.equal(page3.items[0]!.subGameId, "sg-7");
  assert.equal(page3.nextCursor, null);
});

test("buildSubgameDrillDown: sortering følger sub_game_sequence", () => {
  const children = [
    child("sg-c", 3, "hall-a"),
    child("sg-a", 1, "hall-a"),
    child("sg-b", 2, "hall-a"),
  ];
  const result = buildSubgameDrillDown({
    parentId: "parent-1",
    children,
    scheduleLogs: [],
    entries: [],
    halls: HALLS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });
  assert.deepEqual(
    result.items.map((r) => r.subGameId),
    ["sg-a", "sg-b", "sg-c"],
  );
});

test("buildSubgameDrillDown: totals går over ALLE sub-games, ikke bare side", () => {
  const children = Array.from({ length: 4 }, (_, i) => child(`sg-${i + 1}`, i + 1, "hall-a"));
  const scheduleLogs = children.map((c) => log(c.id, `gs-${c.id}`));
  const entries: ComplianceLedgerEntry[] = children.map((c, i) =>
    entry({
      id: `s-${c.id}`,
      hallId: "hall-a",
      gameId: `gs-${c.id}`,
      eventType: "STAKE",
      amount: 100 * (i + 1),
      walletId: `w-${c.id}`,
      createdAt: "2026-04-18T18:00:00.000Z",
    }),
  );

  const page1 = buildSubgameDrillDown({
    parentId: "parent-1",
    children,
    scheduleLogs,
    entries,
    halls: HALLS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
    pageSize: 2,
  });
  assert.equal(page1.items.length, 2);
  // totals = 100 + 200 + 300 + 400 = 1000 uavhengig av pagination.
  assert.equal(page1.totals.revenue, 1000);
  assert.equal(page1.totals.players, 4);
});

test("buildSubgameDrillDown: players telles som distinkte wallet-IDs (STAKE-only)", () => {
  const children = [child("sg-1", 1, "hall-a")];
  const scheduleLogs = [log("sg-1", "gs-1")];
  const entries: ComplianceLedgerEntry[] = [
    entry({ id: "s1", hallId: "hall-a", gameId: "gs-1", eventType: "STAKE", amount: 100, walletId: "w1", createdAt: "2026-04-18T18:00:00.000Z" }),
    entry({ id: "s2", hallId: "hall-a", gameId: "gs-1", eventType: "STAKE", amount: 100, walletId: "w1", createdAt: "2026-04-18T18:10:00.000Z" }),
    entry({ id: "s3", hallId: "hall-a", gameId: "gs-1", eventType: "STAKE", amount: 100, walletId: "w2", createdAt: "2026-04-18T18:15:00.000Z" }),
    // Wallet w-p1 kun på PRIZE — skal IKKE telle som player.
    entry({ id: "p1", hallId: "hall-a", gameId: "gs-1", eventType: "PRIZE", amount: 50, walletId: "w-prize-only", createdAt: "2026-04-18T18:20:00.000Z" }),
  ];
  const result = buildSubgameDrillDown({
    parentId: "parent-1",
    children,
    scheduleLogs,
    entries,
    halls: HALLS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });
  assert.equal(result.items[0]!.players, 2);
});

test("buildSubgameDrillDown: startDate = earliest event for sub-game", () => {
  const children = [child("sg-1", 1, "hall-a")];
  const scheduleLogs = [log("sg-1", "gs-1")];
  const entries: ComplianceLedgerEntry[] = [
    entry({ id: "s1", hallId: "hall-a", gameId: "gs-1", eventType: "STAKE", amount: 100, walletId: "w1", createdAt: "2026-04-18T18:30:00.000Z" }),
    entry({ id: "s2", hallId: "hall-a", gameId: "gs-1", eventType: "STAKE", amount: 100, walletId: "w2", createdAt: "2026-04-18T18:10:00.000Z" }),
  ];
  const result = buildSubgameDrillDown({
    parentId: "parent-1",
    children,
    scheduleLogs,
    entries,
    halls: HALLS,
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });
  assert.equal(result.items[0]!.startDate, "2026-04-18T18:10:00.000Z");
});

test("buildSubgameDrillDown: ugyldig vindu kaster", () => {
  assert.throws(
    () =>
      buildSubgameDrillDown({
        parentId: "parent-1",
        children: [],
        scheduleLogs: [],
        entries: [],
        halls: HALLS,
        from: "ikke-en-dato",
        to: WINDOW_TO,
      }),
    /Ugyldig 'from'/,
  );
  assert.throws(
    () =>
      buildSubgameDrillDown({
        parentId: "parent-1",
        children: [],
        scheduleLogs: [],
        entries: [],
        halls: HALLS,
        from: WINDOW_TO,
        to: WINDOW_FROM,
      }),
    /'from' må være <= 'to'/,
  );
});

test("buildSubgameDrillDown: ukjent hall faller tilbake til hallId som hallName", () => {
  const children = [child("sg-1", 1, "unknown-hall")];
  const result = buildSubgameDrillDown({
    parentId: "parent-1",
    children,
    scheduleLogs: [],
    entries: [],
    halls: HALLS, // `unknown-hall` ikke i listen
    from: WINDOW_FROM,
    to: WINDOW_TO,
  });
  assert.equal(result.items[0]!.hallName, "unknown-hall");
});
