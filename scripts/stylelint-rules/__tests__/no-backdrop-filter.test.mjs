/**
 * Tests for no-blink-hazards stylelint-plugin.
 *
 * Bruker node:test (built-in runner, ingen avhengigheter). Kjør med:
 *   node --test scripts/stylelint-rules/__tests__/
 *
 * Dekker alle 4 regler + CSS-in-JS-scanneren.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(__filename, "../../../..");

function lintCss(css, configOverride = null) {
  const dir = mkdtempSync(join(tmpdir(), "stylelint-test-"));
  const cssPath = join(dir, "input.css");
  writeFileSync(cssPath, css);

  let configArgs = ["--config", join(REPO_ROOT, ".stylelintrc.json")];
  if (configOverride) {
    const cfgPath = join(dir, "override.json");
    writeFileSync(cfgPath, JSON.stringify(configOverride));
    configArgs = ["--config", cfgPath];
  }

  const result = spawnSync(
    "node",
    [
      join(REPO_ROOT, "node_modules/stylelint/bin/stylelint.mjs"),
      cssPath,
      "--formatter", "json",
      ...configArgs,
    ],
    { encoding: "utf8", cwd: REPO_ROOT },
  );

  // stylelint writes --formatter json to stdout when clean, but directs it
  // to stderr via the logger when errored=true. Try both to stay robust.
  let parsed = [];
  const raw = (result.stdout && result.stdout.trim()) || (result.stderr && result.stderr.trim()) || "[]";
  try { parsed = JSON.parse(raw); } catch { /* ignore */ }

  rmSync(dir, { recursive: true, force: true });

  const warnings = parsed[0]?.warnings || [];
  return { warnings, exitCode: result.status, raw };
}

// ---------------------------------------------------------------------------
// Rule 1: no-backdrop-filter-without-allowlist
// ---------------------------------------------------------------------------

describe("plugin/no-backdrop-filter-without-allowlist", () => {
  it("failer på `.prize-pill { backdrop-filter: blur(6px) }`", () => {
    const { warnings } = lintCss(".prize-pill { backdrop-filter: blur(6px); }");
    const r1 = warnings.filter((w) => w.rule === "plugin/no-backdrop-filter-without-allowlist");
    assert.equal(r1.length, 1, `forventet 1 varsel, fikk ${r1.length}`);
    assert.match(r1[0].text, /\.prize-pill/);
    assert.match(r1[0].text, /ARCHITECTURE\.md/);
  });

  it("passerer på `.popup-backdrop { backdrop-filter: blur(6px) }`", () => {
    const { warnings } = lintCss(".popup-backdrop { backdrop-filter: blur(6px); }");
    const r1 = warnings.filter((w) => w.rule === "plugin/no-backdrop-filter-without-allowlist");
    assert.equal(r1.length, 0);
  });

  it("passerer på `.modal .popup-backdrop` (descendant)", () => {
    const { warnings } = lintCss(".modal .popup-backdrop { backdrop-filter: blur(6px); }");
    const r1 = warnings.filter((w) => w.rule === "plugin/no-backdrop-filter-without-allowlist");
    assert.equal(r1.length, 0);
  });

  it("passerer på `.g1-overlay-root > div[data-backdrop]`", () => {
    const { warnings } = lintCss(
      ".g1-overlay-root > div[data-backdrop] { backdrop-filter: blur(8px); }",
    );
    const r1 = warnings.filter((w) => w.rule === "plugin/no-backdrop-filter-without-allowlist");
    assert.equal(r1.length, 0);
  });

  it("ignorerer `backdrop-filter: none`", () => {
    const { warnings } = lintCss(".prize-pill { backdrop-filter: none; }");
    const r1 = warnings.filter((w) => w.rule === "plugin/no-backdrop-filter-without-allowlist");
    assert.equal(r1.length, 0);
  });

  it("fanger -webkit-backdrop-filter også", () => {
    const { warnings } = lintCss(".prize-pill { -webkit-backdrop-filter: blur(4px); }");
    const r1 = warnings.filter((w) => w.rule === "plugin/no-backdrop-filter-without-allowlist");
    assert.equal(r1.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Rule 2: no-transition-all
// ---------------------------------------------------------------------------

describe("plugin/no-transition-all", () => {
  it("failer på `transition: all 0.3s`", () => {
    const { warnings } = lintCss(".foo { transition: all 0.3s ease; }");
    const r2 = warnings.filter((w) => w.rule === "plugin/no-transition-all");
    assert.equal(r2.length, 1);
    assert.match(r2[0].text, /flimmer/);
  });

  it("failer på `transition-property: all`", () => {
    const { warnings } = lintCss(".foo { transition-property: all; }");
    const r2 = warnings.filter((w) => w.rule === "plugin/no-transition-all");
    assert.equal(r2.length, 1);
  });

  it("passerer på spesifikke properties", () => {
    const { warnings } = lintCss(
      ".foo { transition: opacity 0.3s, transform 0.3s; }",
    );
    const r2 = warnings.filter((w) => w.rule === "plugin/no-transition-all");
    assert.equal(r2.length, 0);
  });

  it("fanger all i multi-transition shorthand", () => {
    const { warnings } = lintCss(
      ".foo { transition: opacity 0.3s, all 0.5s; }",
    );
    const r2 = warnings.filter((w) => w.rule === "plugin/no-transition-all");
    assert.equal(r2.length, 1);
  });
});

// ---------------------------------------------------------------------------
// Rule 3: animation-iteration-whitelist
// ---------------------------------------------------------------------------

describe("plugin/animation-iteration-whitelist", () => {
  it("passerer på `animation: pattern-sweep 1s infinite` (pattern-sweep allowed)", () => {
    const { warnings } = lintCss(".foo { animation: pattern-sweep 1s linear infinite; }");
    const r3 = warnings.filter((w) => w.rule === "plugin/animation-iteration-whitelist");
    assert.equal(r3.length, 0);
  });

  it("failer på `animation: pulse-forbidden 1s infinite` (ikke i whitelist)", () => {
    const { warnings } = lintCss(".foo { animation: pulse-forbidden 1s ease infinite; }");
    const r3 = warnings.filter((w) => w.rule === "plugin/animation-iteration-whitelist");
    assert.equal(r3.length, 1);
    assert.match(r3[0].text, /pulse-forbidden/);
  });

  it("failer når animation-name ikke er i whitelist (longhand)", () => {
    const { warnings } = lintCss(
      ".foo { animation-name: something-bad; animation-iteration-count: infinite; }",
    );
    const r3 = warnings.filter((w) => w.rule === "plugin/animation-iteration-whitelist");
    assert.equal(r3.length, 1);
  });

  it("passerer på begrenset iteration-count (ikke infinite)", () => {
    const { warnings } = lintCss(".foo { animation: anything 1s 3; }");
    const r3 = warnings.filter((w) => w.rule === "plugin/animation-iteration-whitelist");
    assert.equal(r3.length, 0);
  });

  it("passerer på `animation-iteration-count: 2`", () => {
    const { warnings } = lintCss(
      ".foo { animation-name: something; animation-iteration-count: 2; }",
    );
    const r3 = warnings.filter((w) => w.rule === "plugin/animation-iteration-whitelist");
    assert.equal(r3.length, 0);
  });
});

// ---------------------------------------------------------------------------
// Rule 4: will-change-whitelist
// ---------------------------------------------------------------------------

describe("plugin/will-change-whitelist", () => {
  it("passerer på `will-change: transform`", () => {
    const { warnings } = lintCss(".foo { will-change: transform; }");
    const r4 = warnings.filter((w) => w.rule === "plugin/will-change-whitelist");
    assert.equal(r4.length, 0);
  });

  it("passerer på `will-change: opacity, transform`", () => {
    const { warnings } = lintCss(".foo { will-change: opacity, transform; }");
    const r4 = warnings.filter((w) => w.rule === "plugin/will-change-whitelist");
    assert.equal(r4.length, 0);
  });

  it("failer på `will-change: left`", () => {
    const { warnings } = lintCss(".foo { will-change: left; }");
    const r4 = warnings.filter((w) => w.rule === "plugin/will-change-whitelist");
    assert.equal(r4.length, 1);
    assert.match(r4[0].text, /left/);
  });

  it("failer på `will-change: scroll-position`", () => {
    const { warnings } = lintCss(".foo { will-change: scroll-position; }");
    const r4 = warnings.filter((w) => w.rule === "plugin/will-change-whitelist");
    assert.equal(r4.length, 1);
  });

  it("passerer på `will-change: auto` (reserved)", () => {
    const { warnings } = lintCss(".foo { will-change: auto; }");
    const r4 = warnings.filter((w) => w.rule === "plugin/will-change-whitelist");
    assert.equal(r4.length, 0);
  });
});

// ---------------------------------------------------------------------------
// CSS-in-JS scanner (lint-no-backdrop-js)
// ---------------------------------------------------------------------------

describe("lint-no-backdrop-js (CSS-in-JS scanner)", () => {
  // Kan ikke kjøre scriptet direkte på tmp-dir siden stien er hardkodet.
  // Isteden: lager en test-fil i worktreet, kjører scriptet, sletter filen.

  function runScanner() {
    const result = spawnSync(
      "node",
      [join(REPO_ROOT, "scripts/stylelint-rules/lint-no-backdrop-js.mjs")],
      { encoding: "utf8", cwd: REPO_ROOT },
    );
    return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
  }

  it("exit 0 på ren main (ingen uautoriserte backdropFilter)", () => {
    const r = runScanner();
    assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
  });

  it("exit 1 når uautorisert backdropFilter introduseres", () => {
    const badFile = join(REPO_ROOT, "packages/game-client/src/__test_bad_backdrop.ts");
    writeFileSync(
      badFile,
      'export const s = { backdropFilter: "blur(6px)" };\n',
    );
    try {
      const r = runScanner();
      assert.equal(r.exitCode, 1);
      assert.match(r.stderr, /__test_bad_backdrop\.ts/);
    } finally {
      rmSync(badFile, { force: true });
    }
  });

  it("exit 0 når unntak-kommentar er satt", () => {
    const okFile = join(REPO_ROOT, "packages/game-client/src/__test_ok_backdrop.ts");
    writeFileSync(
      okFile,
      '// lint-no-backdrop-js: Short-lived popup, Pixi masked.\n' +
        'export const s = { backdropFilter: "blur(6px)" };\n',
    );
    try {
      const r = runScanner();
      assert.equal(r.exitCode, 0);
    } finally {
      rmSync(okFile, { force: true });
    }
  });
});
