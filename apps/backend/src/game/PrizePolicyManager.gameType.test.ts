/**
 * Tests for PrizePolicyManager — gameType broadening (audit §9.1, 2026-05-06)
 * + cap-fjerning for hovedspill (Tobias 2026-05-08).
 *
 * **Oppdatert 2026-05-08:** Single-prize cap (2500 kr) gjelder nå KUN
 * databingo (`gameType = DATABINGO`, slug `spillorama`). Hovedspill
 * (Spill 1, 2, 3 — slugs `bingo`, `rocket`, `monsterbingo`) har INGEN
 * cap. `applySinglePrizeCap` short-circuiter for MAIN_GAME og returnerer
 * input uendret. Tidligere antakelse "MAIN_GAME har samme cap som
 * DATABINGO" var feil og er korrigert per
 * docs/architecture/SPILL_REGLER_OG_PAYOUT.md §4.
 *
 * Verifies that:
 *   - Default constructor registrerer både MAIN_GAME- og DATABINGO-policy.
 *     MAIN_GAME-policy beholdes for sporbarhet (policy.id returneres) men
 *     capen er funksjonelt deaktivert (short-circuit i applySinglePrizeCap).
 *   - DATABINGO bucket capper på 2500 kr som vanlig.
 *   - MAIN_GAME bucket aldri capper, uansett policy-konfig.
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

  // Spill 2/3 (MAIN_GAME) — beløp under cap, uendret resultat.
  const mainGameResult = manager.applySinglePrizeCap({
    hallId: "any-hall",
    gameType: "MAIN_GAME",
    amount: 1000,
  });
  assert.equal(mainGameResult.cappedAmount, 1000, "MAIN_GAME 1000 → uendret");
  assert.equal(mainGameResult.wasCapped, false);
  // Policy returneres for audit-sporbarhet (policy.id logges).
  assert.equal(
    mainGameResult.policy.singlePrizeCap,
    2500,
    "MAIN_GAME default-policy beholdes for sporbarhet, men capen aktiveres ikke",
  );

  // SpinnGo (DATABINGO) — samme behavior under cap.
  const databingoResult = manager.applySinglePrizeCap({
    hallId: "any-hall",
    gameType: "DATABINGO",
    amount: 1000,
  });
  assert.equal(databingoResult.cappedAmount, 1000);
  assert.equal(databingoResult.policy.singlePrizeCap, 2500, "DATABINGO default-cap = 2500");
});

test("PrizePolicyManager: MAIN_GAME-cap aktiveres IKKE selv ved beløp > 2500 (cap-fjerning 2026-05-08)", () => {
  // Pre-2026-05-08: capen kicker inn ved 5000 → cappet til 2500.
  // Etter Tobias-avklaring: MAIN_GAME har ingen cap, returneres fullt.
  const manager = new PrizePolicyManager({});
  const result = manager.applySinglePrizeCap({
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    amount: 5000,
  });
  assert.equal(result.cappedAmount, 5000, "5000 → uendret (hovedspill har ingen cap)");
  assert.equal(result.wasCapped, false);
});

test("PrizePolicyManager: DATABINGO-cap kicker inn ved beløp > 2500", () => {
  // SpinnGo (databingo) skal fortsatt cappes på 2500 kr per §11.
  const manager = new PrizePolicyManager({});
  const result = manager.applySinglePrizeCap({
    hallId: "hall-1",
    gameType: "DATABINGO",
    amount: 5000,
  });
  assert.equal(result.cappedAmount, 2500, "5000 → cappet til 2500 (§11-grensen)");
  assert.equal(result.wasCapped, true);
});

test("PrizePolicyManager: MAIN_GAME-policy-konfig kan IKKE reintrodusere cap (cap-fjerning er bestemt på engine-nivå)", async () => {
  // Selv om policy-tabellen sier MAIN_GAME-cap = 1000, skal
  // applySinglePrizeCap fortsatt returnere full payout — capen er
  // funksjonelt deaktivert for MAIN_GAME ved engine-short-circuit.
  const manager = new PrizePolicyManager({});

  await manager.upsertPrizePolicy({
    gameType: "MAIN_GAME",
    effectiveFrom: new Date().toISOString(),
    singlePrizeCap: 1000,
    dailyExtraPrizeCap: 5000,
  });

  const mainGameResult = manager.applySinglePrizeCap({
    hallId: "hall-1",
    gameType: "MAIN_GAME",
    amount: 2000,
  });
  assert.equal(mainGameResult.cappedAmount, 2000, "MAIN_GAME aldri capped uansett policy");
  assert.equal(mainGameResult.wasCapped, false);

  // DATABINGO uendret → fortsatt 2500-cap (default).
  const databingoResult = manager.applySinglePrizeCap({
    hallId: "hall-1",
    gameType: "DATABINGO",
    amount: 2000,
  });
  assert.equal(databingoResult.cappedAmount, 2000, "DATABINGO uendret 2500-cap");
  assert.equal(databingoResult.wasCapped, false);
});

test("PrizePolicyManager: DATABINGO hall-spesifikk policy overstyrer wildcard", async () => {
  const manager = new PrizePolicyManager({});

  // Hall-spesifikk DATABINGO-cap.
  await manager.upsertPrizePolicy({
    gameType: "DATABINGO",
    hallId: "hall-special",
    effectiveFrom: new Date().toISOString(),
    singlePrizeCap: 1500,
    dailyExtraPrizeCap: 8000,
  });

  // Hall-special: 1500-cap.
  const specialResult = manager.applySinglePrizeCap({
    hallId: "hall-special",
    gameType: "DATABINGO",
    amount: 2500,
  });
  assert.equal(specialResult.cappedAmount, 1500);
  assert.equal(specialResult.policy.hallId, "hall-special");

  // Andre haller: faller til wildcard (2500-cap).
  const wildcardResult = manager.applySinglePrizeCap({
    hallId: "hall-other",
    gameType: "DATABINGO",
    amount: 2500,
  });
  assert.equal(wildcardResult.cappedAmount, 2500);
});
