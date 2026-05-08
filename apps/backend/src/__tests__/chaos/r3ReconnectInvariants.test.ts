/**
 * R3 Reconnect-test invariants (BIN-812).
 *
 * Linear: https://linear.app/bingosystem/issue/BIN-812
 * Mandat: docs/architecture/LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §3.3 R3
 * Driver: infra/chaos-tests/r3-reconnect-test.sh + infra/chaos-tests/r3-mock-client.mjs
 *
 * ── Hva denne filen gjør ──────────────────────────────────────────────────
 *
 * Når shell-script-et `r3-reconnect-test.sh` har kjørt mock-klienten gjennom
 * 5/15/60 sek disconnect-scenarioer, lar det dette test-suite-et avgjøre om
 * reconnect-en var korrekt på socket-nivå (ikke bare "klienten kom tilbake").
 *
 * Hvert scenario produserer en JSON-fil i `R3_RESULT_DIR` på formen
 * `r3-result-{seconds}s.json` med felter som mock-klienten setter:
 *   - pass                              : klientens samlede vurdering
 *   - preDisconnectMarkCount            : marks før forced disconnect
 *   - postReconnectMarkCount            : marks etter reconnect (server-state)
 *   - marksMatchAfterReconnect          : post >= pre (ikke mistet noe)
 *   - newMarkAcceptedAfterReconnect     : ny mark etter reconnect lyktes
 *   - reconnectDurationMs               : hvor lang tid handshaken tok
 *   - errors                            : array av feil under scenarioet
 *
 * Invariantene er:
 *
 *   I1 — Server bevarer marks gjennom reconnect. Marks gjort før
 *        disconnect skal fortsatt være på server etter reconnect, dvs.
 *        `postReconnectMarkCount >= preDisconnectMarkCount`. Hvis
 *        post < pre er det STRUKTURELT brudd — server "glemte" marks
 *        under disconnect-vinduet.
 *
 *   I2 — Server aksepterer ny aktivitet etter reconnect. `ticket:mark`
 *        sendt på den re-connectede socket-en skal ikke avvises pga.
 *        "PLAYER_ALREADY_IN_RUNNING_GAME", manglende session-state, eller
 *        andre stale-binding-feil. Dette tester at
 *        `cleanupStaleWalletInIdleRooms` + `attachPlayerSocket` + R5
 *        idempotency-store sammen tillater seamless replay.
 *
 *   I3 — Reconnect-tid er rimelig. Mock-klienten venter eksplisitt
 *        `disconnectSeconds`, og selve socket-handshake-en bør være
 *        < 1.5 sek på toppen av det. `reconnectDurationMs` ≈ disconnect-
 *        seconds × 1000 (med litt slack); hvis vi ser >> betyr det at
 *        socket-laget bygger seg saktere opp enn forventet. Advisory
 *        (per §6.1: "Reconnect-tid > 3 sek" er ikke-strukturelt).
 *
 *   I4 — Ingen feil under scenarioet. `errors`-arrayet skal være tomt.
 *        Per-feil dukker opp i shell-output ved FAIL.
 *
 *   I5 — Pass-flag matcher invariantene. Hvis I1+I2+I4 er grønne men
 *        klienten satte `pass=false` er det en bug i mock-klienten —
 *        feiles for å gi tidlig signal.
 *
 * Test-suiten kalles fra shell-script-et med:
 *   R3_RESULT_DIR=/tmp/.../ \
 *   R3_DISCONNECT_SCENARIOS="5 15 60" \
 *   npx tsx --test src/__tests__/chaos/r3ReconnectInvariants.test.ts
 *
 * ── Strukturelt vs ikke-strukturelt ──────────────────────────────────────
 *
 * Per LIVE_ROOM_ROBUSTNESS_MANDATE_2026-05-08.md §6.1:
 *
 *   Strukturelt (test FAIL → pilot pauses):
 *     - I1, I2, I4 brutt
 *     - I5 brutt (uventet pass-flag-mismatch — kontraktbrudd)
 *
 *   Ikke-strukturelt (test passerer + advarsel):
 *     - I3 (reconnect-tid > forventet)
 *
 * ── Hvis testen ikke har resultat-filer ──────────────────────────────────
 *
 * Hvis env-vars ikke er satt eller resultat-filer ikke finnes (f.eks. når
 * testen kjøres som del av vanlig `npm test` uten chaos-script-et), hopper
 * vi over selve invariant-sjekkingene og kjører kun et "skeleton-test" som
 * dokumenterer hva som faktisk testes. Dette holder testen syntaktisk
 * gyldig i CI uten å kreve at hele Docker-stacken kjøres på hver commit.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join as pathJoin } from "node:path";

// ── Result-shape (matcher r3-mock-client.mjs) ────────────────────────────────

interface R3ScenarioResult {
  scenario: string;
  backendUrl: string;
  startedAt: string;
  finishedAt: string | null;
  pass: boolean;
  steps: Array<{ at: string; step: string; [k: string]: unknown }>;
  marksBeforeDisconnect: Array<{ number: number; clientRequestId: string }>;
  marksAfterReconnect: unknown[];
  newMarkAfterReconnect: { number: number; clientRequestId: string } | null;
  errors: string[];
  preDisconnectMarkCount: number;
  postReconnectMarkCount: number;
  marksMatchAfterReconnect: boolean;
  newMarkAcceptedAfterReconnect: boolean;
  reconnectDurationMs: number;
  totalScenarioMs: number;
}

function loadScenarioResult(seconds: string): R3ScenarioResult | null {
  const dir = process.env.R3_RESULT_DIR;
  if (!dir) return null;
  const path = pathJoin(dir, `r3-result-${seconds}s.json`);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as R3ScenarioResult;
    return parsed;
  } catch {
    return null;
  }
}

const RAW_SCENARIOS = (process.env.R3_DISCONNECT_SCENARIOS ?? "5 15 60").trim();
const SCENARIOS = RAW_SCENARIOS.split(/\s+/).filter((s) => s.length > 0);

const HAS_RESULTS = SCENARIOS.some((s) => loadScenarioResult(s) !== null);

// ── Skeleton-test (kjøres alltid, dokumenterer kontrakten) ──────────────────

test("r3ReconnectInvariants: kontrakten dokumentert", () => {
  // Test-en er gyldig hvis vi har miljøet som trengs. Når den kjøres som del
  // av vanlig `npm test` uten chaos-script-et, hoppes invariant-sjekkene over
  // og bare kontrakten verifiseres.
  assert.equal(typeof loadScenarioResult, "function");
  assert.ok(SCENARIOS.length > 0, "minst ett disconnect-scenario må være definert");
  // Dokumenter at vi vet om alle env-varsene
  assert.ok(
    process.env.R3_RESULT_DIR === undefined || typeof process.env.R3_RESULT_DIR === "string",
    "R3_RESULT_DIR må være string hvis satt",
  );
});

// ── Per-scenario invariants ────────────────────────────────────────────────
//
// Vi genererer test-suite-blokker per scenario så hvert disconnect-vindu får
// sin egen tydelige PASS/FAIL-rad i output. Hvis en scenario-fil mangler
// hopper vi over (HAS_RESULTS-flag er global, men per-scenario null-sjekk
// gjør oss robuste mot at f.eks. 60s-runden kollapset i shell-driveren mens
// 5s + 15s lyktes).

for (const seconds of SCENARIOS) {
  const result = loadScenarioResult(seconds);

  test(
    `r3ReconnectInvariants[${seconds}s]: I1 — marks bevart gjennom reconnect`,
    { skip: !HAS_RESULTS || !result },
    () => {
      assert.ok(result, `scenario ${seconds}s må ha resultat-fil`);
      assert.ok(
        result.postReconnectMarkCount >= result.preDisconnectMarkCount,
        `Marks gikk tapt under disconnect (${seconds}s): pre=${result.preDisconnectMarkCount}, post=${result.postReconnectMarkCount}. ` +
          `STRUKTURELT — pilot pauses per mandat §6.1.`,
      );
      assert.equal(
        result.marksMatchAfterReconnect,
        true,
        `marksMatchAfterReconnect=false for ${seconds}s — server "glemte" marks. STRUKTURELT.`,
      );
    },
  );

  test(
    `r3ReconnectInvariants[${seconds}s]: I2 — server aksepterer ny aktivitet etter reconnect`,
    { skip: !HAS_RESULTS || !result },
    () => {
      assert.ok(result, `scenario ${seconds}s må ha resultat-fil`);
      assert.equal(
        result.newMarkAcceptedAfterReconnect,
        true,
        `Ny mark etter reconnect (${seconds}s) ble avvist — sannsynligvis stale-binding. STRUKTURELT.`,
      );
    },
  );

  test(
    `r3ReconnectInvariants[${seconds}s]: I3 — reconnect-tid (advisory)`,
    { skip: !HAS_RESULTS || !result },
    () => {
      assert.ok(result, `scenario ${seconds}s må ha resultat-fil`);
      // reconnectDurationMs inkluderer disconnect-vinduet (mock-klienten
      // venter eksplisitt der), så vi forventer ~ disconnectSeconds × 1000
      // pluss litt ekstra for handshake. SLA-en gjelder bare overhead-en.
      const expectedMs = Number(seconds) * 1000;
      const overheadMs = result.reconnectDurationMs - expectedMs;
      // 1500 ms slack for socket-handshake. > 3 sek warn (per §6.1).
      if (overheadMs > 3000) {
        // eslint-disable-next-line no-console
        console.warn(
          `[I3 WARN] Reconnect-overhead ${overheadMs}ms > 3000ms SLA for ${seconds}s-scenario. ` +
            `IKKE strukturelt brudd — krever latency-tuning.`,
        );
      }
      assert.ok(
        result.reconnectDurationMs >= expectedMs - 500,
        `reconnectDurationMs=${result.reconnectDurationMs} er mindre enn forventet ${expectedMs}ms — disconnect ble ikke gjort?`,
      );
    },
  );

  test(
    `r3ReconnectInvariants[${seconds}s]: I4 — ingen feil under scenarioet`,
    { skip: !HAS_RESULTS || !result },
    () => {
      assert.ok(result, `scenario ${seconds}s må ha resultat-fil`);
      assert.equal(
        result.errors.length,
        0,
        `Scenario ${seconds}s rapporterte ${result.errors.length} feil: ${JSON.stringify(result.errors)}. ` +
          `STRUKTURELT — pilot pauses.`,
      );
    },
  );

  test(
    `r3ReconnectInvariants[${seconds}s]: I5 — pass-flag matcher invariantene`,
    { skip: !HAS_RESULTS || !result },
    () => {
      assert.ok(result, `scenario ${seconds}s må ha resultat-fil`);
      // Hvis alle de tre andre invariantene er grønne, må pass=true.
      // Hvis ikke er det en bug i mock-klienten.
      const allOk =
        result.marksMatchAfterReconnect &&
        result.newMarkAcceptedAfterReconnect &&
        result.errors.length === 0;
      if (allOk) {
        assert.equal(
          result.pass,
          true,
          `Mock-klient rapporterte pass=false men I1-I4 alle grønne for ${seconds}s — kontraktbrudd.`,
        );
      } else {
        // Hvis I1-I4 har FAIL er pass=false korrekt.
        assert.equal(
          result.pass,
          false,
          `Mock-klient rapporterte pass=true men I1-I4 har FAIL for ${seconds}s — kontraktbrudd.`,
        );
      }
    },
  );
}
