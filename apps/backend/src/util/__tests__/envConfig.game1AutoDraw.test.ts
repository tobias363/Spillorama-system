/**
 * F13 (E2E pilot-blokker, 2026-05-09): GAME1_AUTO_DRAW_ENABLED default-test.
 *
 * Bakgrunn: E2E-verifikasjonen 2026-Q3 avdekket at flagget defaultet til
 * `false`, slik at running-spill stod stille uten trekk når operatører
 * glemte å sette miljøvariabelen. Auto-draw er kjernen av Spill 1 — det
 * må være på by default. Denne testen låser kontrakten og fanger regress
 * hvis defaulten endres tilbake.
 *
 * Hvis du noen gang trenger å snu defaulten igjen (eks. for ny
 * test-konfig som krever manuell driving), oppdater både `envConfig.ts`,
 * runbook (`docs/operations/RENDER_ENV_VAR_RUNBOOK.md`), og denne testen
 * i samme PR.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { loadBingoRuntimeConfig } from "../envConfig.js";

function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => T
): T {
  const previous: Record<string, string | undefined> = {};
  for (const k of Object.keys(overrides)) previous[k] = process.env[k];
  try {
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("F13: GAME1_AUTO_DRAW_ENABLED default er TRUE (auto-draw er kjernen av Spill 1)", () => {
  withEnv({ GAME1_AUTO_DRAW_ENABLED: undefined }, () => {
    const cfg = loadBingoRuntimeConfig();
    assert.equal(
      cfg.jobGame1AutoDrawEnabled,
      true,
      "Default må være true så running-spill trekker baller uten manuell driving. " +
        "Hvis du fjerner denne assertionen, oppdater også " +
        "docs/operations/RENDER_ENV_VAR_RUNBOOK.md."
    );
  });
});

test("F13: GAME1_AUTO_DRAW_ENABLED=false honoreres for manuell QA-driving", () => {
  withEnv({ GAME1_AUTO_DRAW_ENABLED: "false" }, () => {
    const cfg = loadBingoRuntimeConfig();
    assert.equal(
      cfg.jobGame1AutoDrawEnabled,
      false,
      "Eksplisitt 'false' må fortsatt skru av flagget for QA-/dev-bruk."
    );
  });
});

test("F13: GAME1_AUTO_DRAW_ENABLED=true honoreres (idempotent eksplisitt-sett)", () => {
  withEnv({ GAME1_AUTO_DRAW_ENABLED: "true" }, () => {
    const cfg = loadBingoRuntimeConfig();
    assert.equal(cfg.jobGame1AutoDrawEnabled, true);
  });
});
