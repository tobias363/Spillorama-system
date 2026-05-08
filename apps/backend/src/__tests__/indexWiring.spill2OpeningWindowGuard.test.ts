/**
 * BIN-823 source-level wiring-test for `canSpawnRound`-guarden.
 *
 * Tobias 2026-05-08:
 *   "Veldig viktig at det ikke er mulig å kunne spille spillene etter
 *    stengetid. Er strenge regler på det fra Lotteritilsynet."
 *
 * Wire-up i index.ts har vært glemt før — først ble `canSpawnRound`
 * lagt til kun for Spill 3 (PR #1006), så ble Spill 2 utelatt selv om
 * `Spill2Config.openingTime*` allerede var i scope. Denne testen er
 * en source-level regression-guard så det ikke skjer igjen.
 *
 * Pattern: vi inspiserer kildekoden direkte (ikke runtime-mounting)
 * fordi full mounting krever DB + Redis + masse env. Source-level sjekk
 * er forskjells-spennende (~20ms å lese filen) og fanger akkurat den
 * regresjonen vi vil hindre.
 *
 * Speiler `indexWiring.adminOps.test.ts`-mønsteret.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = join(__dirname, "..", "index.ts");
const indexSrc = readFileSync(indexPath, "utf8");

test("index.ts importerer createPerpetualRoundOpeningWindowGuard (BIN-823 regression)", () => {
  assert.match(
    indexSrc,
    /import\s*\{\s*createPerpetualRoundOpeningWindowGuard\s*\}\s*from\s*["']\.\/game\/PerpetualRoundOpeningWindowGuard\.js["']/,
    "createPerpetualRoundOpeningWindowGuard må importeres fra ./game/PerpetualRoundOpeningWindowGuard.js. " +
      "Hvis denne mangler er Lotteritilsynets stengetid-krav brutt — guard-en kjører ikke.",
  );
});

test("index.ts wirer guarden til PerpetualRoundService.canSpawnRound (BIN-823 regression)", () => {
  // canSpawnRound: createPerpetualRoundOpeningWindowGuard({...}) — eller på flere linjer
  // Dette regex-en tillater whitespace + linjeskift mellom property og factory-kall.
  assert.match(
    indexSrc,
    /canSpawnRound:\s*createPerpetualRoundOpeningWindowGuard\s*\(/,
    "PerpetualRoundService skal ta imot guard-callbacken fra factory-en. " +
      "Hvis noen rull-er tilbake til inline-callback må de huske både Spill 2 og Spill 3.",
  );
});

test("index.ts overfører BÅDE spill2ConfigService og spill3ConfigService til guarden", () => {
  // Vi sjekker at begge service-navnene står i samme call-uttrykk (uten
  // å låse oss til eksakt formatering).
  const guardCallMatch = indexSrc.match(
    /createPerpetualRoundOpeningWindowGuard\s*\(\s*\{([\s\S]*?)\}\s*\)/,
  );
  assert.ok(
    guardCallMatch,
    "createPerpetualRoundOpeningWindowGuard skal kalles med et options-objekt.",
  );
  const optionsBody = guardCallMatch![1]!;
  assert.match(
    optionsBody,
    /spill2ConfigService/,
    "Guard-en MÅ få spill2ConfigService — hvis ikke kjører ROCKET utenfor stengetid (BIN-823).",
  );
  assert.match(
    optionsBody,
    /spill3ConfigService/,
    "Guard-en MÅ få spill3ConfigService — hvis ikke kjører MONSTERBINGO utenfor stengetid.",
  );
});

test("index.ts har ikke etterlatt død inline-canSpawnRound-callback for Spill 3 (refactor-hygiene)", () => {
  // Når vi flytter logikken til factory skal den gamle inline-versjonen
  // være borte. Hvis denne re-introduseres ved en feil får vi to guards
  // som kan komme i konflikt.
  const inlineSpill3Hits = indexSrc.match(
    /isSpill3\s*=\s*\n?\s*gameSlug\s*===\s*"monsterbingo"/g,
  );
  assert.equal(
    inlineSpill3Hits,
    null,
    "Inline isSpill3-check skal ikke finnes i index.ts — den hører hjemme i guarden.",
  );
});
