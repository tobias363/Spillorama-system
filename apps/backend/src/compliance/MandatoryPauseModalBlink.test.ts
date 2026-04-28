/**
 * Blink-elimination runde 7 (2026-04-27)
 *
 * Verifiserer at apps/backend/public/web/spillvett.js + spillvett.css ikke
 * inneholder de paint-property/timing-hazards som tidligere ga blink på
 * Obligatorisk spillepause-popupen.
 *
 * Test-strategien er identisk med runde 5/6 fra game-client (assert på
 * filinnhold) — public/web er vanlig JS som leveres rått til browser, så
 * vi har ingen runtime-DOM å assert mot uten å sette opp jsdom.
 *
 * Se docs/engineering/SPILL1_BLINK_ELIMINATION_RUNDE_7_2026-04-27.md.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "../../../..");
const spillvettJsPath = path.join(
  repoRoot,
  "apps/backend/public/web/spillvett.js",
);
const spillvettCssPath = path.join(
  repoRoot,
  "apps/backend/public/web/spillvett.css",
);

const spillvettJs = readFileSync(spillvettJsPath, "utf8");
const spillvettCss = readFileSync(spillvettCssPath, "utf8");

// ── Hazard #BLINK-MP-1 + #BLINK-MP-2: textContent memoization ───────────────

test("blink runde 7: renderMandatoryPauseModal har memoize-state-variabler for textContent-writes", () => {
  // Cache-felt for siste skrevne tekstverdi — tillater å hoppe over write
  // når verdi er uendret.
  assert.match(spillvettJs, /_pauseLastCountdownText/);
  assert.match(spillvettJs, /_pauseLastLossText/);
  assert.match(spillvettJs, /_pauseLastPlaytimeText/);
  assert.match(spillvettJs, /_pauseLastGamecountText/);
});

test("blink runde 7: _setIfChanged-helper finnes og tester ulikhet før textContent-write", () => {
  // Hjelper som bare skriver til DOM når ny verdi != cached forrige verdi.
  assert.match(spillvettJs, /function _setIfChanged\(/);
  assert.match(
    spillvettJs,
    /if \(lastValue === nextText\) return lastValue;[\s\S]*?el\.textContent = nextText;/,
  );
});

test("blink runde 7: countdown bruker _setIfChanged (ingen rå tickCountdown-write)", () => {
  // Tidligere skrev countdown rått til textContent hver tick. Nå skal alle
  // 4 modal-text-writes (countdown + 3 stats) gå via _setIfChanged.
  // Telling: vi skal se 4 _setIfChanged-call sites i mandatoryPause-blokken.
  const blockMatch = spillvettJs.match(
    /\/\/ ── Obligatorisk pause modal[\s\S]+?\n  function render\(\) \{/,
  );
  assert.ok(blockMatch, "fant ikke mandatory-pause-blokken i spillvett.js");
  const block = blockMatch[0];
  const callCount = (block.match(/_setIfChanged\(/g) ?? []).length;
  // 5 forventet: 1 helper-definisjon + 1 i tickCountdown + 3 stats
  // (loss/playtime/gamecount). Asserter >=4 for å gi rom for refaktor.
  assert.ok(
    callCount >= 4,
    `forventet >=4 _setIfChanged-call sites, fant ${callCount}`,
  );
});

// ── Hazard #BLINK-MP-3: setInterval restart-on-render ───────────────────────

test("blink runde 7: setInterval restart kun når blockedUntil endrer seg", () => {
  // Tidligere ble intervallet `clearInterval` + `setInterval` kjørt på hver
  // render() — dvs. ~12 ganger ved socket-events osv. Det ga timing-jitter.
  // Nå er restart gated bak `blockedUntilEpoch !== _pauseLastBlockedUntilEpoch`.
  assert.match(
    spillvettJs,
    /if \(blockedUntilEpoch !== _pauseLastBlockedUntilEpoch\)/,
  );
});

test("blink runde 7: countdown-tick-frekvens er 1000ms (ikke 500ms)", () => {
  // Vi viser kun MM:SS, så 500ms-tick er bortkastet — halver DOM-frekvens.
  // Sjekk at det ikke finnes setInterval(...500) i mandatory-pause-blokken,
  // men setInterval(tickCountdown, 1000) finnes.
  const blockMatch = spillvettJs.match(
    /\/\/ ── Obligatorisk pause modal[\s\S]+?\n  function render\(\) \{/,
  );
  assert.ok(blockMatch, "fant ikke mandatory-pause-blokken");
  const block = blockMatch[0];
  assert.doesNotMatch(
    block,
    /setInterval\([^,]+,\s*500\)/,
    "mandatory-pause-blokken har fortsatt setInterval(...500)",
  );
  assert.match(
    block,
    /setInterval\(tickCountdown,\s*1000\)/,
    "forventet setInterval(tickCountdown, 1000)",
  );
});

// ── Hazard #BLINK-MP-4: backdrop-filter dropped fra modal-overlay ───────────

test("blink runde 7: .mandatory-pause-modal har IKKE backdrop-filter", () => {
  // backdrop-filter: blur(8px) over hele backdrop var en av de dyreste
  // paint-operasjonene mulig. Erstatter med solid alpha for billig GPU-paint.
  const modalBlockMatch = spillvettCss.match(
    /\.mandatory-pause-modal \{[\s\S]+?\n\}/,
  );
  assert.ok(modalBlockMatch, "fant ikke .mandatory-pause-modal i CSS");
  const block = modalBlockMatch[0];
  assert.doesNotMatch(
    block,
    /backdrop-filter:/,
    ".mandatory-pause-modal har fortsatt backdrop-filter",
  );
  // Erstatningen: mørkere alpha (0.92) for å bevare visuelt fokus.
  assert.match(block, /background:\s*rgba\(0,\s*0,\s*0,\s*0\.9\d?\)/);
});

// ── Sanity: cleanup når modal lukkes ────────────────────────────────────────

test("blink runde 7: cleanup-greinen resetter alle memoize-state-felt", () => {
  // Når isOnMandatoryPause blir false, må vi resette cached values så vi
  // ikke skipper en write neste gang modalen åpnes med samme verdier som
  // forrige gang.
  const cleanupMatch = spillvettJs.match(
    /if \(!isOnMandatoryPause\) \{[\s\S]+?return;\s*\}/,
  );
  assert.ok(cleanupMatch, "fant ikke cleanup-grenen");
  const cleanup = cleanupMatch[0];
  assert.match(cleanup, /_pauseLastBlockedUntilEpoch = 0;/);
  assert.match(cleanup, /_pauseLastCountdownText = null;/);
  assert.match(cleanup, /_pauseLastLossText = null;/);
  assert.match(cleanup, /_pauseLastPlaytimeText = null;/);
  assert.match(cleanup, /_pauseLastGamecountText = null;/);
});
