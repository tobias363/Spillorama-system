import assert from "node:assert/strict";
import test from "node:test";
import { generatePlayerReportPdf } from "./reportExport.js";

test("generatePlayerReportPdf returns a PDF buffer", async () => {
  const pdf = await generatePlayerReportPdf({
    playerName: "Codex Test",
    playerEmail: "codex@example.com",
    report: {
      generatedAt: "2026-04-11T20:00:00.000Z",
      range: {
        period: "last7",
        from: "2026-04-05T00:00:00.000Z",
        to: "2026-04-11T20:00:00.000Z",
        label: "05.04.2026–11.04.2026",
        offset: 0
      },
      summary: {
        stakeTotal: 17,
        prizeTotal: 7,
        netResult: -10,
        totalEvents: 4,
        totalPlays: 2
      },
      breakdown: [
        {
          hallId: "hall-default",
          hallName: "Oslo Sentrum",
          gameType: "DATABINGO",
          channel: "INTERNET",
          stakeTotal: 10,
          prizeTotal: 4,
          netResult: -6,
          totalEvents: 2,
          totalPlays: 1,
          lastActivityAt: "2026-04-10T10:05:00.000Z"
        }
      ],
      plays: [
        {
          playId: "hall-default::ROOM-1",
          hallId: "hall-default",
          hallName: "Oslo Sentrum",
          gameType: "DATABINGO",
          channel: "INTERNET",
          roomCode: "ROOM-1",
          startedAt: "2026-04-10T10:00:00.000Z",
          lastActivityAt: "2026-04-10T10:05:00.000Z",
          stakeTotal: 10,
          prizeTotal: 4,
          netResult: -6,
          totalEvents: 2
        }
      ],
      events: [
        {
          id: "event-1",
          createdAt: "2026-04-10T10:05:00.000Z",
          hallId: "hall-default",
          hallName: "Oslo Sentrum",
          gameType: "DATABINGO",
          channel: "INTERNET",
          eventType: "EXTRA_PRIZE",
          amount: 4,
          roomCode: "ROOM-1"
        }
      ],
      dailyBreakdown: [],
      gameBreakdown: [],
      dailyGameBreakdown: [],
      hallBreakdown: []
    }
  });

  assert.ok(pdf.byteLength > 200);
  assert.equal(pdf.subarray(0, 4).toString("utf8"), "%PDF");
});
