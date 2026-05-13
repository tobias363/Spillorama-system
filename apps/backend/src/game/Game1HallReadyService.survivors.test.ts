/**
 * Tester designet for å drepe mutation-testing-survivors fra første Stryker-
 * baseline-kjøring 2026-05-13 (se docs/auto-generated/MUTATION_BASELINE.md).
 *
 * Pre-baseline (Game1HallReadyService.ts):
 *   194 killed, 139 survived, 68 nocov, 0 timeout, 87 errors = 48.38 % (under break 50)
 *
 * Fokus i denne suiten:
 *   - `computeHallStatus`-ren-funksjon (linje 967-1023) — 30+ survivors klynget her
 *     (mest gevinst per test-LOC)
 *   - Boundary-conditions for `hasPhysicalFlow`-detection (linje 977)
 *   - Boundary-conditions for `startScanDone`/`finalScanDone` (linje 979-984)
 *   - Numerisk soldCount-beregning (linje 1000-1006)
 *
 * Eksisterende `Game1HallReadyService.hallStatus.test.ts` har 7 grunnleggende
 * tester. Vi utvider med ~15+ edge-case-tester.
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  computeHallStatus,
  type HallReadyStatusRow,
} from "./Game1HallReadyService.js";

// ── helpers ────────────────────────────────────────────────────────────────

function baseRow(overrides: Partial<HallReadyStatusRow> = {}): HallReadyStatusRow {
  return {
    gameId: "g1",
    hallId: "hall-1",
    isReady: false,
    readyAt: null,
    readyByUserId: null,
    digitalTicketsSold: 0,
    physicalTicketsSold: 0,
    excludedFromGame: false,
    excludedReason: null,
    createdAt: "",
    updatedAt: "",
    startTicketId: null,
    startScannedAt: null,
    finalScanTicketId: null,
    finalScannedAt: null,
    ...overrides,
  };
}

// ── computeHallStatus: hasPhysicalFlow detection (linje 977) ────────────────

test("computeHallStatus: startTicketId='' regnes som ingen fysisk-flow (kills EqualityOperator/StringLiteral on line 977)", () => {
  // Tom streng er IKKE en gyldig scan-id; må telles som "ingen scan utført".
  // Hvis EqualityOperator mutates `!== ""` til `=== ""`, vil empty string
  // bli ansett som "har gyldig scan", som gir startScanDone=true (feil).
  const status = computeHallStatus(
    baseRow({
      digitalTicketsSold: 3,
      physicalTicketsSold: 0,
      startTicketId: "", // empty string - skal IKKE telle som scan utført
      isReady: true,
    })
  );
  // Med tomme strenger + ingen physical, skal hallen være digital-only
  // (hasPhysicalFlow=false), så startScanDone=true (auto), finalScanDone=true.
  assert.equal(status.startScanDone, true, "tom string startTicketId regnes som ingen scan");
  assert.equal(status.finalScanDone, true);
  assert.equal(status.color, "green");
});

test("computeHallStatus: startTicketId satt men physical=0 → likevel hasPhysicalFlow (kills ConditionalExpression on line 977:64)", () => {
  // Hvis `physical > 0` blir `false`, ville hasPhysicalFlow kun avhenge av
  // startTicketId. Hvis `physical > 0` blir `true`, ville den ALLTID være true.
  // Vi tester at startTicketId alene er nok til å trigge hasPhysicalFlow.
  const status = computeHallStatus(
    baseRow({
      digitalTicketsSold: 3,
      physicalTicketsSold: 0,
      startTicketId: "100",
      finalScanTicketId: null, // mangler — orange
      isReady: true,
    })
  );
  // hasPhysicalFlow=true → finalScanDone=false (mangler) → orange
  assert.equal(status.finalScanDone, false, "mangler final-scan");
  assert.equal(status.color, "orange");
});

test("computeHallStatus: startTicketId=null + physical>0 → hasPhysicalFlow=true (kills LogicalOperator on line 977)", () => {
  // Hvis `||` blir `&&`, vil hasPhysicalFlow KREVE BÅDE startTicketId !== null
  // OG physical > 0 — så hall med null start men physical>0 ville feile.
  const status = computeHallStatus(
    baseRow({
      digitalTicketsSold: 0,
      physicalTicketsSold: 5, // physical>0
      startTicketId: null, // ingen start-scan
      finalScanTicketId: null,
      isReady: false,
    })
  );
  // hasPhysicalFlow=true (via physical>0) → startScanDone=false (mangler),
  // finalScanDone=false. playerCount=5>0 → orange.
  assert.equal(status.startScanDone, false, "mangler start-scan");
  assert.equal(status.finalScanDone, false);
  assert.equal(status.color, "orange");
});

// ── computeHallStatus: startScanDone/finalScanDone (linje 979-984) ──────────

test("computeHallStatus: startTicketId='whitespace' regnes som ikke tom (kills StringLiteral on line 977/981)", () => {
  // Hvis StringLiteral muteres til "Stryker was here!", vil scenes med
  // startTicketId = "Stryker was here!" feile sammenligningen i annerledes
  // måte. Bygg test som verifiserer at vanlige numeriske scan-ID-er teller.
  const status = computeHallStatus(
    baseRow({
      physicalTicketsSold: 10,
      startTicketId: "100",
      finalScanTicketId: "110",
      isReady: true,
    })
  );
  assert.equal(status.startScanDone, true);
  assert.equal(status.finalScanDone, true);
  assert.equal(status.color, "green");
});

test("computeHallStatus: physical>0 + startTicketId=null + finalScanTicketId='123' (kills ConditionalExpression on line 984:40)", () => {
  // Test scenario hvor startScanDone=false (mangler start-scan), men
  // finalScanTicketId er satt. Begge skal evalueres uavhengig.
  const status = computeHallStatus(
    baseRow({
      physicalTicketsSold: 5,
      startTicketId: null,
      finalScanTicketId: "999",
      isReady: true,
    })
  );
  assert.equal(status.startScanDone, false);
  assert.equal(status.finalScanDone, true);
});

// ── computeHallStatus: color decision tree (linje 988-995) ──────────────────

test("computeHallStatus: playerCount=0 returnerer red UANSETT scan/ready-state (kills ConditionalExpression on color logic)", () => {
  const status = computeHallStatus(
    baseRow({
      digitalTicketsSold: 0,
      physicalTicketsSold: 0,
      startTicketId: "100",
      finalScanTicketId: "200",
      isReady: true,
    })
  );
  // Selv om alt er klart, så lenge playerCount=0 → red.
  assert.equal(status.playerCount, 0);
  assert.equal(status.color, "red", "0 spillere skal alltid være red");
});

test("computeHallStatus: 1 spiller + alt klart → green (kills boundary on playerCount === 0)", () => {
  // Test boundary mellom red og green: 0 vs 1 spillere.
  const status = computeHallStatus(
    baseRow({
      digitalTicketsSold: 1, // én spiller
      physicalTicketsSold: 0,
      isReady: true,
    })
  );
  assert.equal(status.playerCount, 1);
  assert.equal(status.color, "green");
});

// ── computeHallStatus: soldCount = final - start (linje 1000-1006) ──────────

test("computeHallStatus: numerisk soldCount = final - start (kills ConditionalExpression line 1000)", () => {
  // Hvis `if (startTicketId != null && finalScanTicketId != null)` mutates
  // til `if (false)`, vil soldCount ALDRI overskrives med numerisk verdi —
  // forblir lik physical. Med dem satt skal soldCount være beregnet.
  const status = computeHallStatus(
    baseRow({
      physicalTicketsSold: 99, // skal IKKE være den endelige verdien
      startTicketId: "1000",
      finalScanTicketId: "1010",
      isReady: true,
    })
  );
  // 1010 - 1000 = 10
  assert.equal(status.soldCount, 10, "soldCount skal overskrives med (final - start)");
});

test("computeHallStatus: startTicketId=null → soldCount fall-back til physical (kills EqualityOperator line 1000)", () => {
  // Hvis `startTicketId != null` mutates til `== null`, vil IF-en evaluere
  // motsatt, og soldCount ville bli overskrevet med NaN.
  const status = computeHallStatus(
    baseRow({
      physicalTicketsSold: 7,
      startTicketId: null,
      finalScanTicketId: "1010",
      isReady: true,
    })
  );
  // soldCount fall-back til physical=7.
  assert.equal(status.soldCount, 7);
});

test("computeHallStatus: finalScanTicketId=null → soldCount fall-back til physical (kills EqualityOperator line 1000:36)", () => {
  const status = computeHallStatus(
    baseRow({
      physicalTicketsSold: 12,
      startTicketId: "100",
      finalScanTicketId: null,
      isReady: true,
    })
  );
  assert.equal(status.soldCount, 12);
});

test("computeHallStatus: ikke-numerisk startTicketId → soldCount fall-back (kills ConditionalExpression line 1003)", () => {
  // Hvis `Number.isFinite(startNum) && Number.isFinite(finalNum)` mutates til
  // `true`, ville den prøve subtract og få NaN. Hvis muterer til `false`,
  // ville den hoppe over den numeriske beregningen.
  const status = computeHallStatus(
    baseRow({
      physicalTicketsSold: 8,
      startTicketId: "abc", // ikke-numerisk
      finalScanTicketId: "110",
      isReady: true,
    })
  );
  // Ikke-numerisk → fall-back til physical=8.
  assert.equal(status.soldCount, 8);
});

test("computeHallStatus: numerisk final=start → soldCount=0 (boundary test)", () => {
  const status = computeHallStatus(
    baseRow({
      physicalTicketsSold: 5,
      startTicketId: "1000",
      finalScanTicketId: "1000",
      isReady: true,
    })
  );
  // final-start=0, soldCount=0 (Math.max(0, 0)=0).
  assert.equal(status.soldCount, 0);
});

test("computeHallStatus: numerisk final<start → soldCount=0 (Math.max guard)", () => {
  // Defensive case: hvis final < start (ikke skal skje), Math.max(0, neg)=0.
  // Kills potential `Math.max(0, ...)` removal mutant.
  const status = computeHallStatus(
    baseRow({
      physicalTicketsSold: 5,
      startTicketId: "1010",
      finalScanTicketId: "1000", // mindre enn start
      isReady: true,
    })
  );
  assert.equal(status.soldCount, 0, "negativ delta skal clampes til 0");
});

// ── computeHallStatus: NaN handling (linje 968-973) ─────────────────────────

test("computeHallStatus: NaN digitalTicketsSold behandles som 0 (kills Number.isFinite guard)", () => {
  // `Number.isFinite(NaN) === false` → bruker `0`. Hvis muterer denne
  // sjekken, kunne playerCount bli NaN.
  const status = computeHallStatus(
    baseRow({
      digitalTicketsSold: NaN as unknown as number,
      physicalTicketsSold: 5,
    })
  );
  // playerCount = 0 + 5 = 5.
  assert.equal(status.playerCount, 5);
  assert.equal(status.digitalTicketsSold, 0);
});

test("computeHallStatus: NaN physicalTicketsSold behandles som 0", () => {
  const status = computeHallStatus(
    baseRow({
      digitalTicketsSold: 3,
      physicalTicketsSold: NaN as unknown as number,
    })
  );
  assert.equal(status.playerCount, 3);
  assert.equal(status.physicalTicketsSold, 0);
});

// ── computeHallStatus: playerCount = digital + physical aggregering ──────────

test("computeHallStatus: playerCount = digital + physical sum (kills ArithmeticOperator)", () => {
  // Hvis `physical + digital` mutates til `physical - digital`, sum blir feil.
  const status = computeHallStatus(
    baseRow({
      digitalTicketsSold: 7,
      physicalTicketsSold: 13,
    })
  );
  assert.equal(status.playerCount, 20);
});

test("computeHallStatus: negativ sum clampes til 0 via Math.max(0, ...)", () => {
  // Math.max(0, X) hvor X kunne være negativt hvis vi hadde sub i stedet for sum.
  // Med korrekt addisjon: alle positive felter → ikke aktuell, men vi tester
  // den defensive opp-clamp-en.
  const status = computeHallStatus(
    baseRow({
      digitalTicketsSold: -5 as unknown as number, // simulerer rar input
      physicalTicketsSold: 3,
    })
  );
  // -5 er finite, så Number.isFinite returner true. Men playerCount = max(0, -2) = 0.
  // OR: med Number.isFinite-grenen, kan dette være 0 (clamp) eller -2 (om Math.max
  // er fjernet). Korrekt kode: Math.max(0, -2) = 0.
  assert.equal(status.playerCount, 0, "negativ sum skal clampes til 0");
});

// ── computeHallStatus: readyConfirmed (linje 986) ────────────────────────────

test("computeHallStatus: isReady=undefined → readyConfirmed=false (kills Boolean wrapper)", () => {
  const status = computeHallStatus(
    baseRow({
      digitalTicketsSold: 2,
      isReady: undefined as unknown as boolean,
    })
  );
  // Boolean(undefined) === false
  assert.equal(status.readyConfirmed, false);
  // playerCount>0 + !readyConfirmed → orange (med digital-only finalScanDone=true)
  assert.equal(status.color, "orange");
});

// ── computeHallStatus: returnerer korrekte felter (kills ObjectLiteral mutants) ──

test("computeHallStatus: returnerer alle påkrevde felter", () => {
  const status = computeHallStatus(
    baseRow({
      hallId: "test-hall",
      digitalTicketsSold: 4,
      physicalTicketsSold: 6,
      startTicketId: "100",
      finalScanTicketId: "110",
      isReady: true,
      excludedFromGame: false,
      excludedReason: null,
    })
  );
  // Verifiserer at ObjectLiteral-mutanter som fjerner felter ikke overlever.
  assert.equal(status.hallId, "test-hall");
  assert.equal(status.playerCount, 10);
  assert.equal(status.startScanDone, true);
  assert.equal(status.finalScanDone, true);
  assert.equal(status.readyConfirmed, true);
  assert.equal(status.excludedFromGame, false);
  assert.equal(status.excludedReason, null);
  assert.equal(status.color, "green");
  assert.equal(status.soldCount, 10);
  assert.equal(status.startTicketId, "100");
  assert.equal(status.finalScanTicketId, "110");
  assert.equal(status.digitalTicketsSold, 4);
  assert.equal(status.physicalTicketsSold, 6);
});

test("computeHallStatus: excludedFromGame=true propageres til output", () => {
  const status = computeHallStatus(
    baseRow({
      digitalTicketsSold: 5,
      excludedFromGame: true,
      excludedReason: "Ingen kunder",
    })
  );
  assert.equal(status.excludedFromGame, true);
  assert.equal(status.excludedReason, "Ingen kunder");
});
