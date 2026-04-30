/**
 * K2-A CRIT-1 (utvidelse 2026-04-30): integrasjonstester som verifiserer
 * §11-distribusjons-effekt for Spill 1/2/3 vs SpinnGo via
 * `ledgerGameTypeForSlug` + `createOverskuddDistributionBatch`.
 *
 * Regulatorisk: per pengespillforskriften §11 + `docs/architecture/SPILLKATALOG.md`
 *   - Spill 1-3 (hovedspill, slug bingo/rocket/monsterbingo)
 *     → minimum 15% av netto til organisasjoner
 *   - SpinnGo (databingo, slug spillorama)
 *     → minimum 30% av netto til organisasjoner
 *
 * Bug pre-fix: alle interne spill skrev hardkodet `gameType: "DATABINGO"` →
 * Spill 1-3 fikk 30%-distribusjon i stedet for 15%. Audit-rapport flagget
 * Spill 2/3 spesifikt som demo-blokker (`docs/audit/WIREFRAME_PARITY_AUDIT_2026-04-30.md`).
 *
 * Disse testene seeder ledger-rader med gameType utledet via resolveren og
 * bekrefter at distribusjonen kalkulerer riktig minimum.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import {
  ComplianceLedger,
  type LedgerGameType,
  type LedgerChannel,
} from "./ComplianceLedger.js";
import { ledgerGameTypeForSlug } from "./ledgerGameTypeForSlug.js";
import { InMemoryWalletAdapter } from "../adapters/InMemoryWalletAdapter.js";

// ── Test fixtures ───────────────────────────────────────────────────────────

interface SeedRow {
  hallId: string;
  gameType: LedgerGameType;
  channel: LedgerChannel;
  eventType: "STAKE" | "PRIZE";
  amount: number;
}

const TEST_ALLOCATIONS = [
  { organizationId: "org-1", organizationAccountId: "wallet-org-1", sharePercent: 60 },
  { organizationId: "org-2", organizationAccountId: "wallet-org-2", sharePercent: 40 },
];

function makeLedgerWithSeed(rows: SeedRow[]): ComplianceLedger {
  const wallet = new InMemoryWalletAdapter();
  const ledger = new ComplianceLedger({ walletAdapter: wallet });
  // Type-trick: skriv rader direkte i internal state for å seede uten
  // å kjøre full BingoEngine-flyt. Tilsvarende mønster som
  // ComplianceLedger.test.ts:269.
  const internal = ledger as unknown as {
    complianceLedger: Array<{
      createdAtMs: number;
      createdAt: string;
      id: string;
      hallId: string;
      gameType: LedgerGameType;
      channel: LedgerChannel;
      eventType: string;
      amount: number;
      currency: "NOK";
    }>;
  };
  const dayMs = new Date(2026, 3, 30).getTime();
  for (const [i, row] of rows.entries()) {
    internal.complianceLedger.push({
      id: randomUUID(),
      createdAt: new Date(dayMs + i * 1000).toISOString(),
      createdAtMs: dayMs + i * 1000,
      hallId: row.hallId,
      gameType: row.gameType,
      channel: row.channel,
      eventType: row.eventType,
      amount: row.amount,
      currency: "NOK",
    });
  }
  return ledger;
}

// ── Tester: resolveren returnerer riktig type for hvert hovedspill ───────────

test("Spill 1 STAKE/PRIZE → ledger-gameType MAIN_GAME (via resolver)", () => {
  // Resolver-verdien er det som ville blitt skrevet i Game1TicketPurchaseService /
  // Game1PayoutService. Dette låser kontrakten på resolver-nivå.
  assert.equal(ledgerGameTypeForSlug("bingo"), "MAIN_GAME");
});

test("Spill 2 (rocket) STAKE/PRIZE → ledger-gameType MAIN_GAME (via resolver)", () => {
  // Resolver-verdien er det Game2Engine.processG2Winners nå skriver via
  // `ledgerGameTypeForSlug(room.gameSlug)`. Pre-fix returnerte den DATABINGO.
  assert.equal(ledgerGameTypeForSlug("rocket"), "MAIN_GAME");
  assert.equal(ledgerGameTypeForSlug("game_2"), "MAIN_GAME");
  assert.equal(ledgerGameTypeForSlug("tallspill"), "MAIN_GAME");
});

test("Spill 3 (monsterbingo) STAKE/PRIZE → ledger-gameType MAIN_GAME (via resolver)", () => {
  // Resolver-verdien er det Game3Engine.processG3Winners nå skriver via
  // `ledgerGameTypeForSlug(room.gameSlug)`. Pre-fix returnerte den DATABINGO.
  assert.equal(ledgerGameTypeForSlug("monsterbingo"), "MAIN_GAME");
  assert.equal(ledgerGameTypeForSlug("mønsterbingo"), "MAIN_GAME");
  assert.equal(ledgerGameTypeForSlug("game_3"), "MAIN_GAME");
});

test("SpinnGo (spillorama) STAKE → ledger-gameType DATABINGO (uendret)", () => {
  // SpinnGo er databingo per SPILLKATALOG; resolveren må fortsatt returnere
  // DATABINGO så §11-distribusjon kalkulerer 30% i stedet for 15%.
  assert.equal(ledgerGameTypeForSlug("spillorama"), "DATABINGO");
  assert.equal(ledgerGameTypeForSlug("game_5"), "DATABINGO");
});

// ── Tester: §11-distribusjons-effekt i overskudd-batch ──────────────────────

test("§11 overskudd: Spill 1 (MAIN_GAME) gir 15% til organisasjoner", async () => {
  // Spill 1-runde: net=1000, hovedspill → minimum=150 (15%).
  // Pre-fix: net*0.30 = 300 (over-distribusjon).
  const ledger = makeLedgerWithSeed([
    {
      hallId: "hall-spill1",
      gameType: ledgerGameTypeForSlug("bingo"),
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 1000,
    },
  ]);
  const batch = await ledger.createOverskuddDistributionBatch({
    date: "2026-04-30",
    allocations: TEST_ALLOCATIONS,
  });
  assert.equal(batch.requiredMinimum, 150, "Spill 1 = MAIN_GAME → 15% av 1000 = 150");
});

test("§11 overskudd: Spill 2 (MAIN_GAME) gir 15% — IKKE 30%", async () => {
  const ledger = makeLedgerWithSeed([
    {
      hallId: "hall-spill2",
      gameType: ledgerGameTypeForSlug("rocket"),
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 1000,
    },
  ]);
  const batch = await ledger.createOverskuddDistributionBatch({
    date: "2026-04-30",
    allocations: TEST_ALLOCATIONS,
  });
  assert.equal(batch.requiredMinimum, 150, "Spill 2 = MAIN_GAME → 15% av 1000 = 150");
  // Pre-fix bug: ville gitt 300 (30%-tall fra DATABINGO-feilklassifisering).
  assert.notEqual(
    batch.requiredMinimum,
    300,
    "Spill 2 må IKKE få 30%-distribusjon (regulatorisk feil i pre-fix)",
  );
});

test("§11 overskudd: Spill 3 (MAIN_GAME) gir 15% — IKKE 30%", async () => {
  const ledger = makeLedgerWithSeed([
    {
      hallId: "hall-spill3",
      gameType: ledgerGameTypeForSlug("monsterbingo"),
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 1000,
    },
  ]);
  const batch = await ledger.createOverskuddDistributionBatch({
    date: "2026-04-30",
    allocations: TEST_ALLOCATIONS,
  });
  assert.equal(batch.requiredMinimum, 150, "Spill 3 = MAIN_GAME → 15% av 1000 = 150");
  assert.notEqual(
    batch.requiredMinimum,
    300,
    "Spill 3 må IKKE få 30%-distribusjon (regulatorisk feil i pre-fix)",
  );
});

test("§11 overskudd: SpinnGo (DATABINGO) gir 30% (uendret)", async () => {
  const ledger = makeLedgerWithSeed([
    {
      hallId: "hall-spinngo",
      gameType: ledgerGameTypeForSlug("spillorama"),
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 1000,
    },
  ]);
  const batch = await ledger.createOverskuddDistributionBatch({
    date: "2026-04-30",
    allocations: TEST_ALLOCATIONS,
  });
  assert.equal(batch.requiredMinimum, 300, "SpinnGo = DATABINGO → 30% av 1000 = 300");
});

test("§11 overskudd: blandet runde (Spill 1 + SpinnGo) gir korrekt sum", async () => {
  // Spill 1: net=400, MAIN_GAME → 60 (15%).
  // SpinnGo: net=200, DATABINGO → 60 (30%).
  // Totalt minimum = 120.
  const ledger = makeLedgerWithSeed([
    {
      hallId: "hall-mix",
      gameType: ledgerGameTypeForSlug("bingo"),
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 400,
    },
    {
      hallId: "hall-mix",
      gameType: ledgerGameTypeForSlug("spillorama"),
      channel: "INTERNET",
      eventType: "STAKE",
      amount: 200,
    },
  ]);
  const batch = await ledger.createOverskuddDistributionBatch({
    date: "2026-04-30",
    allocations: TEST_ALLOCATIONS,
  });
  assert.equal(
    batch.requiredMinimum,
    120,
    "Blandet: 400×0.15 + 200×0.30 = 60 + 60 = 120",
  );
});
