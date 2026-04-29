/**
 * Tobias 2026-04-29 (post-orphan-fix UX) — unit tests for
 * `ComplianceManager.calculateMaxAffordableTickets`.
 *
 * Bug-kontekst (FORHANDSKJOP_BUG_ROOT_CAUSE_2026-04-29.md): tidligere ble
 * forhåndskjøp akseptert i bet:arm uten loss-limit-sjekk, og BingoEngine
 * filtrerte stille spilleren ut på game-start. PR #723 frigjorde
 * orphan-reservasjonen, men brukeren hadde allerede sett bonger og fikk
 * deretter "Kjøp bonger"-popup uten forklaring. Nå sjekker bet:arm
 * server-siden hvor mange brett som matcher remaining tap-budsjett, og
 * avviser delvis (eller helt) bestillingen FØR brukeren ser bonger.
 *
 * Disse 8 testene dekker:
 *   1. Tom bestilling → accepted=0, ingen rejection
 *   2. Full-buy under daglig grense → accepted=N, rejection=null
 *   3. Daglig grense traff midt i bestillingen → DAILY_LIMIT
 *   4. Månedlig grense traff midt i bestillingen → MONTHLY_LIMIT
 *   5. Daily-først order: hvis BÅDE traff, daglig rapporteres
 *   6. Allerede på grensen før kjøp → accepted=0
 *   7. Free-play (price ≤ 0) bypass-er limit (mirrors wouldExceedLossLimit)
 *   8. existingReservedAmount pre-trekkes fra remaining
 *
 * Pengespillforskriften §22: regulatorisk default 900 kr daglig, 4400 kr
 * månedlig. Hall-scope-d. Tester bruker variant-grenser for å gjøre
 * iterasjons-grenser tydelige.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { ComplianceManager } from "./ComplianceManager.js";

function makeManager(opts: {
  regulatoryDaily?: number;
  regulatoryMonthly?: number;
} = {}): ComplianceManager {
  return new ComplianceManager({
    regulatoryLossLimits: {
      daily: opts.regulatoryDaily ?? 900,
      monthly: opts.regulatoryMonthly ?? 4400,
    },
    playSessionLimitMs: 60 * 60 * 1000,
    pauseDurationMs: 5 * 60 * 1000,
    selfExclusionMinMs: 365 * 24 * 60 * 60 * 1000,
  });
}

const WALLET = "wallet-test-1";
const HALL = "hall-test-1";
const NOW = Date.UTC(2026, 3, 29, 12, 0, 0); // 2026-04-29 12:00 UTC

// ── 1. Tom bestilling ────────────────────────────────────────────────────

test("calculateMaxAffordableTickets: tom bestilling returnerer accepted=0, ingen rejection", () => {
  const mgr = makeManager();
  const result = mgr.calculateMaxAffordableTickets(WALLET, HALL, [], NOW);
  assert.equal(result.accepted, 0);
  assert.equal(result.rejected, 0);
  assert.equal(result.rejectionReason, null);
  assert.equal(result.state.dailyUsed, 0);
  assert.equal(result.state.dailyLimit, 900);
  assert.equal(result.state.dailyRemaining, 900);
});

// ── 2. Full-buy under grenser ────────────────────────────────────────────

test("calculateMaxAffordableTickets: full-buy 3x10kr passer godt under 900kr daglig grense", () => {
  const mgr = makeManager();
  const result = mgr.calculateMaxAffordableTickets(WALLET, HALL, [10, 10, 10], NOW);
  assert.equal(result.accepted, 3);
  assert.equal(result.rejected, 0);
  assert.equal(result.rejectionReason, null);
  assert.equal(result.state.dailyRemaining, 900);
});

// ── 3. Daglig grense rammet midt i bestilling ────────────────────────────

test("calculateMaxAffordableTickets: 3 brett a 10 kr når player har brukt 890 kr → 1 av 3 (DAILY)", async () => {
  const mgr = makeManager();
  // Pre-bruk 890 kr på dagen — kun 10 kr remaining.
  await mgr.recordLossEntry(WALLET, HALL, {
    type: "BUYIN",
    amount: 890,
    createdAtMs: NOW - 60 * 1000,
  });
  const result = mgr.calculateMaxAffordableTickets(WALLET, HALL, [10, 10, 10], NOW);
  assert.equal(result.accepted, 1, "first 10 kr fits exactly into 10 kr remaining");
  assert.equal(result.rejected, 2);
  assert.equal(result.rejectionReason, "DAILY_LIMIT");
  assert.equal(result.state.dailyUsed, 890);
  assert.equal(result.state.dailyLimit, 900);
  assert.equal(result.state.dailyRemaining, 10);
});

// ── 4. Månedlig grense rammet ────────────────────────────────────────────

test("calculateMaxAffordableTickets: månedlig grense rammet midt i bestilling → MONTHLY_LIMIT", async () => {
  const mgr = makeManager();
  // Pre-bruk 4385 kr i måneden (i dag, så også daglig — men daglig grense
  // er 900 så daglig ville rammet først). Så for å teste MONTHLY isolert:
  // bruk 100 kr i dag, og 4290 kr tidligere i samme måned.
  await mgr.recordLossEntry(WALLET, HALL, {
    type: "BUYIN",
    amount: 4290,
    createdAtMs: NOW - 7 * 24 * 60 * 60 * 1000, // 7 dager før (samme måned)
  });
  await mgr.recordLossEntry(WALLET, HALL, {
    type: "BUYIN",
    amount: 100,
    createdAtMs: NOW - 60 * 1000,
  });
  // Total monthly used = 4390. Remaining = 4400 - 4390 = 10 kr.
  // Daily used = 100. Daily remaining = 800 kr. Så daily holder.
  const result = mgr.calculateMaxAffordableTickets(WALLET, HALL, [10, 10, 10], NOW);
  assert.equal(result.accepted, 1, "first 10 kr fits exactly into 10 kr monthly remaining");
  assert.equal(result.rejected, 2);
  assert.equal(result.rejectionReason, "MONTHLY_LIMIT");
});

// ── 5. Daily-først order når begge rammet ────────────────────────────────

test("calculateMaxAffordableTickets: hvis daglig grense rammer først av daglig+månedlig → DAILY_LIMIT", async () => {
  const mgr = makeManager({ regulatoryDaily: 100, regulatoryMonthly: 200 });
  // Bruk 90 kr i dag (daglig remaining = 10, månedlig remaining = 110).
  await mgr.recordLossEntry(WALLET, HALL, {
    type: "BUYIN",
    amount: 90,
    createdAtMs: NOW - 60 * 1000,
  });
  // Bestilling: 3 brett a 50 kr. Første 50 kr overstiger daglig 10 →
  // DAILY_LIMIT (selv om månedlig også ville rammet senere).
  const result = mgr.calculateMaxAffordableTickets(WALLET, HALL, [50, 50, 50], NOW);
  assert.equal(result.accepted, 0);
  assert.equal(result.rejectionReason, "DAILY_LIMIT");
});

// ── 6. Allerede på grensen ────────────────────────────────────────────────

test("calculateMaxAffordableTickets: allerede på daglig grense → accepted=0, første brett trigges DAILY", async () => {
  const mgr = makeManager();
  await mgr.recordLossEntry(WALLET, HALL, {
    type: "BUYIN",
    amount: 900,
    createdAtMs: NOW - 60 * 1000,
  });
  const result = mgr.calculateMaxAffordableTickets(WALLET, HALL, [1, 1, 1], NOW);
  assert.equal(result.accepted, 0);
  assert.equal(result.rejected, 3);
  assert.equal(result.rejectionReason, "DAILY_LIMIT");
  assert.equal(result.state.dailyRemaining, 0);
});

// ── 7. Free-play bypass ──────────────────────────────────────────────────

test("calculateMaxAffordableTickets: gratis brett (price=0) bypass-er limit", async () => {
  const mgr = makeManager();
  await mgr.recordLossEntry(WALLET, HALL, {
    type: "BUYIN",
    amount: 900,
    createdAtMs: NOW - 60 * 1000,
  });
  // Selv på grensen, gratis brett aksepteres ubetinget.
  const result = mgr.calculateMaxAffordableTickets(WALLET, HALL, [0, 0, 0], NOW);
  assert.equal(result.accepted, 3);
  assert.equal(result.rejected, 0);
  assert.equal(result.rejectionReason, null);
});

test("calculateMaxAffordableTickets: blandet 0 + 50 kr — gratis bypass, betalt rammer DAILY", async () => {
  const mgr = makeManager();
  await mgr.recordLossEntry(WALLET, HALL, {
    type: "BUYIN",
    amount: 870,
    createdAtMs: NOW - 60 * 1000,
  });
  // Remaining = 30 kr. Bestilling: 0, 50, 0. Etter 0 → 30 kr remaining.
  // 50 kr > 30 → DAILY. Sluttene 0 ikke evaluert.
  const result = mgr.calculateMaxAffordableTickets(WALLET, HALL, [0, 50, 0], NOW);
  assert.equal(result.accepted, 1);
  assert.equal(result.rejectionReason, "DAILY_LIMIT");
});

// ── 8. existingReservedAmount pre-trekk ──────────────────────────────────

test("calculateMaxAffordableTickets: existingReservedAmount pre-trekkes så increase-flyten ikke over-aksepterer", async () => {
  const mgr = makeManager();
  // Daglig 900 kr, ingen pre-bruk. Player har allerede 600 kr armed
  // (existingReservedAmount=600). Remaining etter pre-trekk = 300 kr.
  // Ny bestilling: 3 brett a 200 kr. Første passer (200 ≤ 300), andre
  // ikke (200 > 100 etter første ble trukket).
  const result = mgr.calculateMaxAffordableTickets(
    WALLET,
    HALL,
    [200, 200, 200],
    NOW,
    600,
  );
  assert.equal(result.accepted, 1);
  assert.equal(result.rejectionReason, "DAILY_LIMIT");
  // State er pre-trekk-fri (rapporterer absolute used + limit, ikke
  // running budget) så klient kan vise totale tall riktig.
  assert.equal(result.state.dailyUsed, 0);
  assert.equal(result.state.dailyRemaining, 900);
});

test("calculateMaxAffordableTickets: existingReservedAmount=0 default — ingen pre-trekk", () => {
  const mgr = makeManager();
  const result = mgr.calculateMaxAffordableTickets(WALLET, HALL, [100, 100], NOW);
  assert.equal(result.accepted, 2);
  assert.equal(result.rejectionReason, null);
});

test("calculateMaxAffordableTickets: negativ existingReservedAmount clampes til 0", () => {
  const mgr = makeManager();
  const result = mgr.calculateMaxAffordableTickets(
    WALLET,
    HALL,
    [100, 100],
    NOW,
    -500,
  );
  assert.equal(result.accepted, 2, "clamping prevents negative-induced over-budget");
});
