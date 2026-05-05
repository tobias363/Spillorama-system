/**
 * Tests for PrizePolicyManager — gameType broadening (audit §9.1, 2026-05-06).
 *
 * Verifies that:
 *   - Default constructor registrerer både MAIN_GAME- og DATABINGO-policy med
 *     identisk cap (2500) — Spill 2/3 (MAIN_GAME) skal ikke hete
 *     PRIZE_POLICY_MISSING når prize-cap kalles med MAIN_GAME-key.
 *   - applySinglePrizeCap fungerer med både gameType-verdiene.
 *   - Cap-verdiene er identiske per i dag (regulatorisk: §11 = 2500 for begge).
 *
 * Pre-fix bug: typen var `"DATABINGO"`-only, så Game2Engine/Game3Engine
 * måtte hardkode `gameType: "DATABINGO"` i prize-cap-kall — inkonsistent
 * med ledger-events (PR #769) som korrekt skrev MAIN_GAME for Spill 2/3.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { PrizePolicyManager } from "./PrizePolicyManager.js";

test("PrizePolicyManager: default-policy registreres for både MAIN_GAME og DATABINGO", () => {
  const manager = new PrizePolicyManager({});

  // Spill 2/3 (MAIN_GAME) — 2500-cap skal være registrert ut av boksen.
  const mainGameResult = manager.applySinglePrizeCap({
    hallId: "any-hall",
    gameType: "MAIN_GAME",
    amount: 1000,
  });
  assert.equal(mainGameResult.cappedAmount, 1000, "MAIN_GAME 1000 < cap → ikke capped");
  assert.equal(mainGameResult.wasCapped, false);
  assert.equal(mainGameResult.policy.singlePrizeCap, 2500, "MAIN_GAME default-cap = 2500");

  // SpinnGo (DATABINGO) — samme behavior.
  const databingoResult = manager.applySinglePrizeCap({
    hallId: "any-hall",
    gameType: "DATABINGO",
    amount: 1000,
  });
  assert.equal(databingoResult.cappedAmount, 1000);
  assert.equal(databingoResult.policy.singlePrizeCap, 2500, "DATABINGO default-cap = 2500");
});

test("PrizePolicyManager: MAIN_GAME-cap kicker inn ved beløp > 2500", () => {
  const manager = new PrizePolicyManager({});
  const result = manager.applySinglePrizeCap({
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    amount: 5000,
  });
  assert.equal(result.cappedAmount, 2500, "5000 → cappet til 2500 (§11-grensen)");
  assert.equal(result.wasCapped, true);
});

test("PrizePolicyManager: separate buckets — MAIN_GAME-policy oppdatert påvirker IKKE DATABINGO", async () => {
  // Per pengespillforskriften §11 er capen identisk i dag, men typen
  // tillater at de differensieres senere. Denne testen låser at
  // policy-bucket-ene er separate.
  const manager = new PrizePolicyManager({});

  // Sett MAIN_GAME-cap til 1000 (hypotetisk).
  await manager.upsertPrizePolicy({
    gameType: "MAIN_GAME",
    effectiveFrom: new Date().toISOString(),
    singlePrizeCap: 1000,
    dailyExtraPrizeCap: 5000,
  });

  // MAIN_GAME-cap har endret seg
  const mainGameResult = manager.applySinglePrizeCap({
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    amount: 2000,
  });
  assert.equal(mainGameResult.cappedAmount, 1000, "MAIN_GAME nå 1000-cap");
  assert.equal(mainGameResult.wasCapped, true);

  // DATABINGO uendret.
  const databingoResult = manager.applySinglePrizeCap({
    hallId: "hall-1",
    gameType: "DATABINGO",
    amount: 2000,
  });
  assert.equal(databingoResult.cappedAmount, 2000, "DATABINGO uendret 2500-cap");
  assert.equal(databingoResult.wasCapped, false);
});

test("PrizePolicyManager: hall-spesifikk MAIN_GAME-policy overstyrer wildcard", async () => {
  const manager = new PrizePolicyManager({});

  // Hall-spesifikk MAIN_GAME-cap.
  await manager.upsertPrizePolicy({
    gameType: "MAIN_GAME",
    hallId: "hall-special",
    effectiveFrom: new Date().toISOString(),
    singlePrizeCap: 1500,
    dailyExtraPrizeCap: 8000,
  });

  // Hall-special: 1500-cap.
  const specialResult = manager.applySinglePrizeCap({
    hallId: "hall-special",
    gameType: "MAIN_GAME",
    amount: 2500,
  });
  assert.equal(specialResult.cappedAmount, 1500);
  assert.equal(specialResult.policy.hallId, "hall-special");

  // Andre haller: faller til wildcard (2500-cap).
  const wildcardResult = manager.applySinglePrizeCap({
    hallId: "hall-other",
    gameType: "MAIN_GAME",
    amount: 2500,
  });
  assert.equal(wildcardResult.cappedAmount, 2500);
});
