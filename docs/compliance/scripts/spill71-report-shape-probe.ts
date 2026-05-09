/**
 * §71 daily-report shape-probe.
 *
 * Skrives som dokumentasjon av faktisk output-shape per
 * `apps/backend/src/game/ComplianceLedgerAggregation.ts:43-156` slik at
 * verifisering kan kjøres uten levende DB.
 *
 * Kjør:
 *   cd apps/backend && npx tsx ../../docs/compliance/scripts/spill71-report-shape-probe.ts
 *
 * Outputter:
 *   1. Et eksempel-DailyComplianceReport med alle felter populert
 *   2. CSV-eksport av samme rapport (per `exportDailyReportCsv`)
 *   3. §11 minimum-distribusjon-kalkyle (15% MAIN_GAME / 30% DATABINGO)
 *
 * Se /docs/compliance/SPILL71_DAILY_REPORT_VERIFICATION_2026-Q3.md for
 * regulatorisk-kontekst og gap-analyse.
 */

import {
  generateDailyReport,
  exportDailyReportCsv,
} from "../../../apps/backend/src/game/ComplianceLedgerAggregation.js";
import { previewOverskuddDistribution } from "../../../apps/backend/src/game/ComplianceLedgerOverskudd.js";
import type {
  ComplianceLedgerEntry,
} from "../../../apps/backend/src/game/ComplianceLedgerTypes.js";

const HALL_TEKNOBINGO = "b18b7928-3469-4b71-a34d-3f81a1b09a88";
const HALL_BODO = "afebd2a2-52d7-4340-b5db-64453894cd8e";
const TODAY = new Date("2026-05-09T19:30:00Z").getTime();

const entries: ComplianceLedgerEntry[] = [
  // Spill 1 (MAIN_GAME, hall) — 5 spillere kjøper Hvit/Gul/Lilla bonger
  {
    id: "ev-1",
    createdAt: new Date(TODAY).toISOString(),
    createdAtMs: TODAY,
    hallId: HALL_TEKNOBINGO,
    gameType: "MAIN_GAME",
    channel: "HALL",
    eventType: "STAKE",
    amount: 50, // 10 bonger × 5 kr
    currency: "NOK",
    gameId: "scheduled-1",
    playerId: "player-1",
    walletId: "wallet-1",
  },
  {
    id: "ev-2",
    createdAt: new Date(TODAY + 1000).toISOString(),
    createdAtMs: TODAY + 1000,
    hallId: HALL_TEKNOBINGO,
    gameType: "MAIN_GAME",
    channel: "HALL",
    eventType: "STAKE",
    amount: 30, // 3 bonger × 10 kr
    currency: "NOK",
    gameId: "scheduled-1",
    playerId: "player-2",
    walletId: "wallet-2",
  },
  {
    id: "ev-3",
    createdAt: new Date(TODAY + 60_000).toISOString(),
    createdAtMs: TODAY + 60_000,
    hallId: HALL_TEKNOBINGO,
    gameType: "MAIN_GAME",
    channel: "HALL",
    eventType: "PRIZE",
    amount: 1000, // Fullt Hus payout
    currency: "NOK",
    gameId: "scheduled-1",
    playerId: "player-1",
    walletId: "wallet-1",
    claimId: "claim-1",
  },

  // Spill 1 internett-kanal — samme dato
  {
    id: "ev-4",
    createdAt: new Date(TODAY + 120_000).toISOString(),
    createdAtMs: TODAY + 120_000,
    hallId: HALL_TEKNOBINGO,
    gameType: "MAIN_GAME",
    channel: "INTERNET",
    eventType: "STAKE",
    amount: 75, // 5 bonger × 15 kr
    currency: "NOK",
    gameId: "scheduled-1",
    playerId: "player-3",
    walletId: "wallet-3",
  },

  // SpinnGo (DATABINGO) — Bodø
  {
    id: "ev-5",
    createdAt: new Date(TODAY + 180_000).toISOString(),
    createdAtMs: TODAY + 180_000,
    hallId: HALL_BODO,
    gameType: "DATABINGO",
    channel: "INTERNET",
    eventType: "STAKE",
    amount: 100,
    currency: "NOK",
    gameId: "spinngo-session-1",
    playerId: "player-4",
    walletId: "wallet-4",
  },
  {
    id: "ev-6",
    createdAt: new Date(TODAY + 240_000).toISOString(),
    createdAtMs: TODAY + 240_000,
    hallId: HALL_BODO,
    gameType: "DATABINGO",
    channel: "INTERNET",
    eventType: "PRIZE",
    amount: 25,
    currency: "NOK",
    gameId: "spinngo-session-1",
    playerId: "player-4",
    walletId: "wallet-4",
    claimId: "claim-spinngo-1",
  },

  // HOUSE_RETAINED — split-rounding-rest fra multi-winner
  {
    id: "ev-7",
    createdAt: new Date(TODAY + 300_000).toISOString(),
    createdAtMs: TODAY + 300_000,
    hallId: HALL_TEKNOBINGO,
    gameType: "MAIN_GAME",
    channel: "HALL",
    eventType: "HOUSE_RETAINED",
    amount: 0.05, // 5 øre split-rest
    currency: "NOK",
    gameId: "scheduled-1",
    metadata: { phase: "row_3", winnerCount: 7 },
  },
];

console.log("=".repeat(80));
console.log("§71 DAILY-REPORT SHAPE-PROBE");
console.log("=".repeat(80));
console.log("Date:", "2026-05-09");
console.log("Entries:", entries.length);
console.log();

const report = generateDailyReport(entries, {
  date: "2026-05-09",
});

console.log("─── DailyComplianceReport (JSON-output for /api/admin/reports/daily) ───");
console.log(JSON.stringify(report, null, 2));
console.log();

console.log("─── CSV-eksport (Content-Type: text/csv) ───");
const csv = exportDailyReportCsv(report);
console.log(csv);
console.log();

console.log("─── §11 minimum-distribusjon-preview (Hovedspill 15%, Databingo 30%) ───");
const overskuddPreview = previewOverskuddDistribution(report, {
  date: "2026-05-09",
  allocations: [
    {
      organizationId: "org-1",
      organizationAccountId: "wallet-org-1",
      sharePercent: 50,
    },
    {
      organizationId: "org-2",
      organizationAccountId: "wallet-org-2",
      sharePercent: 50,
    },
  ],
});
console.log(JSON.stringify(overskuddPreview, null, 2));
console.log();

console.log("─── Verifisering — §11-prosent per gameType ───");
for (const row of report.rows) {
  const expectedPercent = row.gameType === "DATABINGO" ? 30 : 15;
  const expectedMinimum = Math.max(0, row.net) * (expectedPercent / 100);
  console.log(
    `  hall=${row.hallId.slice(0, 8)}.. gameType=${row.gameType} channel=${row.channel} ` +
      `net=${row.net} expected_§11_amount=${expectedMinimum.toFixed(2)} (${expectedPercent}%)`,
  );
}
