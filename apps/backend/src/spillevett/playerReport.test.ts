import assert from "node:assert/strict";
import test from "node:test";
import type { ComplianceLedgerEntry } from "../game/BingoEngine.js";
import { buildPlayerReport, resolvePlayerReportRange } from "./playerReport.js";

function createEntry(input: Partial<ComplianceLedgerEntry> & Pick<ComplianceLedgerEntry, "id" | "createdAt" | "createdAtMs" | "hallId" | "gameType" | "channel" | "eventType" | "amount">): ComplianceLedgerEntry {
  return {
    currency: "NOK",
    ...input
  };
}

test("buildPlayerReport groups stakes and prizes by hall and play", () => {
  const range = resolvePlayerReportRange("last7", new Date("2026-04-11T12:00:00+02:00"));
  const entries: ComplianceLedgerEntry[] = [
    createEntry({
      id: "stake-1",
      createdAt: "2026-04-10T10:00:00.000Z",
      createdAtMs: Date.parse("2026-04-10T10:00:00.000Z"),
      hallId: "hall-default",
      gameType: "DATABINGO",
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 10,
      walletId: "wallet-1",
      roomCode: "ROOM-1"
    }),
    createEntry({
      id: "prize-1",
      createdAt: "2026-04-10T10:05:00.000Z",
      createdAtMs: Date.parse("2026-04-10T10:05:00.000Z"),
      hallId: "hall-default",
      gameType: "DATABINGO",
      channel: "INTERNET",
      eventType: "EXTRA_PRIZE",
      amount: 4,
      walletId: "wallet-1",
      roomCode: "ROOM-1"
    }),
    createEntry({
      id: "stake-2",
      createdAt: "2026-04-11T09:00:00.000Z",
      createdAtMs: Date.parse("2026-04-11T09:00:00.000Z"),
      hallId: "hall-east",
      gameType: "MAIN_GAME",
      channel: "HALL",
      eventType: "STAKE",
      amount: 7,
      walletId: "wallet-1",
      roomCode: "ROOM-2"
    }),
    createEntry({
      id: "prize-2",
      createdAt: "2026-04-11T09:02:00.000Z",
      createdAtMs: Date.parse("2026-04-11T09:02:00.000Z"),
      hallId: "hall-east",
      gameType: "MAIN_GAME",
      channel: "HALL",
      eventType: "PRIZE",
      amount: 3,
      walletId: "wallet-1",
      roomCode: "ROOM-2"
    })
  ];

  const report = buildPlayerReport({
    entries,
    halls: [
      {
        id: "hall-default",
        slug: "default",
        name: "Oslo Sentrum",
        region: "NO",
        address: "",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      {
        id: "hall-east",
        slug: "east",
        name: "Oslo Øst",
        region: "NO",
        address: "",
        isActive: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    range
  });

  assert.equal(report.summary.stakeTotal, 17);
  assert.equal(report.summary.prizeTotal, 7);
  assert.equal(report.summary.netResult, -10);
  assert.equal(report.summary.totalPlays, 2);
  assert.equal(report.breakdown.length, 2);
  assert.equal(report.plays[0]?.hallName, "Oslo Øst");
  assert.equal(report.plays[0]?.netResult, -4);
  assert.equal(report.plays[1]?.hallName, "Oslo Sentrum");
  assert.equal(report.plays[1]?.netResult, -6);
  assert.equal(report.events[0]?.id, "prize-2");
});
