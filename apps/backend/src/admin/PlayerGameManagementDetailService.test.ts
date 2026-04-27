/**
 * GAP #4: tester for PlayerGameManagementDetailService.
 *
 * Dekker:
 *   - Tom liste → tom rows + nuller i totals.
 *   - STAKE+PRIZE per gameType → riktige sum og winRate.
 *   - EXTRA_PRIZE teller som winnings (manuell payout / jackpot).
 *   - Per-gameType-bucket (DATABINGO + MAIN_GAME blandet).
 *   - gameType-filter — kun valgt type returneres.
 *   - fromDate/toDate-filter — kutt på dato-vindu.
 *   - lastPlayed = max(createdAt) per bucket.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { buildPlayerGameManagementDetail } from "./PlayerGameManagementDetailService.js";
import type {
  ComplianceLedgerEntry,
  LedgerEventType,
  LedgerGameType,
} from "../game/ComplianceLedgerTypes.js";

function makeEntry(
  id: string,
  gameType: LedgerGameType,
  eventType: LedgerEventType,
  amount: number,
  createdAt: string,
  walletId = "w-1"
): ComplianceLedgerEntry {
  return {
    id,
    createdAt,
    createdAtMs: Date.parse(createdAt),
    hallId: "hall-a",
    gameType,
    channel: "INTERNET",
    eventType,
    amount,
    currency: "NOK",
    walletId,
  };
}

test("GAP #4: tom liste gir tom rows og nuller i totals", () => {
  const result = buildPlayerGameManagementDetail({
    walletId: "w-1",
    entries: [],
  });
  assert.equal(result.walletId, "w-1");
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.totals, {
    totalTickets: 0,
    totalStake: 0,
    totalWinnings: 0,
    winRate: 0,
    stakeCount: 0,
    prizeCount: 0,
    extraPrizeCount: 0,
  });
});

test("GAP #4: STAKE + PRIZE for ett spill → win-rate korrekt", () => {
  const entries: ComplianceLedgerEntry[] = [
    makeEntry("s1", "DATABINGO", "STAKE", 50, "2026-04-20T10:00:00Z"),
    makeEntry("s2", "DATABINGO", "STAKE", 50, "2026-04-20T10:05:00Z"),
    makeEntry("p1", "DATABINGO", "PRIZE", 25, "2026-04-20T10:10:00Z"),
  ];
  const result = buildPlayerGameManagementDetail({
    walletId: "w-1",
    entries,
  });
  assert.equal(result.rows.length, 1);
  const row = result.rows[0]!;
  assert.equal(row.gameType, "DATABINGO");
  assert.equal(row.totalTickets, 2);
  assert.equal(row.stakeCount, 2);
  assert.equal(row.totalStake, 100);
  assert.equal(row.totalWinnings, 25);
  assert.equal(row.winRate, 0.25);
  assert.equal(row.prizeCount, 1);
  assert.equal(row.extraPrizeCount, 0);
  assert.equal(row.lastPlayed, "2026-04-20T10:10:00Z");
});

test("GAP #4: EXTRA_PRIZE teller som winnings", () => {
  const entries: ComplianceLedgerEntry[] = [
    makeEntry("s1", "DATABINGO", "STAKE", 100, "2026-04-20T10:00:00Z"),
    makeEntry("p1", "DATABINGO", "PRIZE", 30, "2026-04-20T10:10:00Z"),
    makeEntry("ep1", "DATABINGO", "EXTRA_PRIZE", 50, "2026-04-20T10:20:00Z"),
  ];
  const result = buildPlayerGameManagementDetail({
    walletId: "w-1",
    entries,
  });
  const row = result.rows[0]!;
  assert.equal(row.totalWinnings, 80, "PRIZE + EXTRA_PRIZE = 30 + 50");
  assert.equal(row.extraPrizeCount, 1);
  assert.equal(row.prizeCount, 1);
  assert.equal(row.winRate, 0.8);
  assert.equal(result.totals.extraPrizeCount, 1);
});

test("GAP #4: per-gameType-bucket — DATABINGO + MAIN_GAME blandet", () => {
  const entries: ComplianceLedgerEntry[] = [
    makeEntry("s1", "DATABINGO", "STAKE", 60, "2026-04-20T10:00:00Z"),
    makeEntry("p1", "DATABINGO", "PRIZE", 20, "2026-04-20T10:05:00Z"),
    makeEntry("s2", "MAIN_GAME", "STAKE", 40, "2026-04-20T11:00:00Z"),
    makeEntry("p2", "MAIN_GAME", "PRIZE", 100, "2026-04-20T11:10:00Z"),
  ];
  const result = buildPlayerGameManagementDetail({
    walletId: "w-1",
    entries,
  });
  assert.equal(result.rows.length, 2);
  // Sortert alfabetisk: DATABINGO før MAIN_GAME.
  assert.equal(result.rows[0]!.gameType, "DATABINGO");
  assert.equal(result.rows[1]!.gameType, "MAIN_GAME");
  assert.equal(result.rows[0]!.totalStake, 60);
  assert.equal(result.rows[0]!.totalWinnings, 20);
  assert.equal(result.rows[1]!.totalStake, 40);
  assert.equal(result.rows[1]!.totalWinnings, 100);

  // Totals = sum across buckets.
  assert.equal(result.totals.totalStake, 100);
  assert.equal(result.totals.totalWinnings, 120);
  assert.equal(result.totals.totalTickets, 2);
});

test("GAP #4: gameType-filter — kun valgt type returneres", () => {
  const entries: ComplianceLedgerEntry[] = [
    makeEntry("s1", "DATABINGO", "STAKE", 60, "2026-04-20T10:00:00Z"),
    makeEntry("s2", "MAIN_GAME", "STAKE", 40, "2026-04-20T11:00:00Z"),
  ];
  const result = buildPlayerGameManagementDetail({
    walletId: "w-1",
    entries,
    gameType: "DATABINGO",
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0]!.gameType, "DATABINGO");
  assert.equal(result.totals.totalStake, 60);
});

test("GAP #4: fromDate/toDate-filter kutter på vindu", () => {
  const entries: ComplianceLedgerEntry[] = [
    makeEntry("s1", "DATABINGO", "STAKE", 100, "2026-04-19T10:00:00Z"), // før vindu
    makeEntry("s2", "DATABINGO", "STAKE", 50, "2026-04-20T10:00:00Z"), // i vindu
    makeEntry("p1", "DATABINGO", "PRIZE", 25, "2026-04-20T11:00:00Z"), // i vindu
    makeEntry("s3", "DATABINGO", "STAKE", 200, "2026-04-21T10:00:00Z"), // etter vindu
  ];
  const result = buildPlayerGameManagementDetail({
    walletId: "w-1",
    entries,
    fromDate: "2026-04-20T00:00:00Z",
    toDate: "2026-04-20T23:59:59Z",
  });
  assert.equal(result.rows.length, 1);
  const row = result.rows[0]!;
  assert.equal(row.totalStake, 50);
  assert.equal(row.totalWinnings, 25);
  assert.equal(row.totalTickets, 1);
});

test("GAP #4: lastPlayed = max(createdAt) per bucket", () => {
  const entries: ComplianceLedgerEntry[] = [
    makeEntry("s1", "DATABINGO", "STAKE", 100, "2026-04-15T10:00:00Z"),
    makeEntry("s2", "DATABINGO", "STAKE", 100, "2026-04-22T10:00:00Z"),
    makeEntry("s3", "DATABINGO", "STAKE", 100, "2026-04-18T10:00:00Z"),
  ];
  const result = buildPlayerGameManagementDetail({
    walletId: "w-1",
    entries,
  });
  assert.equal(result.rows[0]!.lastPlayed, "2026-04-22T10:00:00Z");
});

test("GAP #4: stake = 0 → winRate = 0 (ikke division-by-zero)", () => {
  const entries: ComplianceLedgerEntry[] = [
    // Bare EXTRA_PRIZE, ingen stake (f.eks. manual winning på fysisk billett
    // som ikke ble registrert som digital STAKE).
    makeEntry("ep1", "DATABINGO", "EXTRA_PRIZE", 100, "2026-04-20T10:00:00Z"),
  ];
  const result = buildPlayerGameManagementDetail({
    walletId: "w-1",
    entries,
  });
  const row = result.rows[0]!;
  assert.equal(row.totalStake, 0);
  assert.equal(row.totalWinnings, 100);
  assert.equal(row.winRate, 0);
  assert.equal(row.totalTickets, 0); // ingen STAKE = 0 tickets
  assert.equal(result.totals.winRate, 0);
});

test("GAP #4: ugyldig fromDate/toDate ignoreres (ikke kast)", () => {
  const entries: ComplianceLedgerEntry[] = [
    makeEntry("s1", "DATABINGO", "STAKE", 50, "2026-04-20T10:00:00Z"),
  ];
  const result = buildPlayerGameManagementDetail({
    walletId: "w-1",
    entries,
    fromDate: "ikke-en-dato",
    toDate: "heller-ikke",
  });
  // Når dato er ugyldig (null) → ingen filtering.
  assert.equal(result.rows.length, 1);
  assert.equal(result.totals.totalStake, 50);
});
