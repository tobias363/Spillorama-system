/**
 * Tests for scripts/check-fragility-comprehension.mjs
 *
 * Bruker node:test (built-in runner). Kjøres med:
 *   node --test scripts/__tests__/check-fragility-comprehension.test.mjs
 *
 * Dekker:
 *   1. parseFragilityFiles — parser F-NN-entries + filstier korrekt
 *   2. findRequiredFids — matcher staged filer mot FRAGILITY-entries
 *   3. extractContextReadFids — finner [context-read: F-NN]-tagger
 *   4. extractBypassReason — finner [bypass-fragility-check: ...]
 *   5. validateStagedAgainstFragility — full e2e (pass / fail / bypass)
 *   6. Bash 3.2-kompatibilitet via integration-test mot wrapper-scriptet
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseFragilityFiles,
  findRequiredFids,
  extractContextReadFids,
  extractBypassReason,
  validateStagedAgainstFragility,
} from "../check-fragility-comprehension.mjs";

// ────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────

const SAMPLE_FRAGILITY = `# FRAGILITY_LOG

## F-01: PlayScreen popup-auto-show gate

**Filer:** \`packages/game-client/src/games/game1/screens/PlayScreen.ts:693-720\`

**Hva ALDRI gjøre:**
- Endre noe.

---

## F-02: Plan-run lifecycle

**Filer:**
- \`apps/backend/src/game/GamePlanRunService.ts\`
- \`apps/backend/src/game/MasterActionService.ts\`
- \`apps/backend/src/game/Game1LobbyService.ts:730-833\`

**Hva ALDRI gjøre:**
- Kalle masterStop uten plan-run reset.

---

## F-03: Husky-hooks (bash 3.2)

**Filer:** \`.husky/pre-commit-fragility-check.sh\` \`scripts/check-fragility-comprehension.mjs\`

**Hva ALDRI gjøre:**
- Bruke bash 4-features.

---

## Format for ny entry

This is the format-section, should be ignored.
`;

// ────────────────────────────────────────────────────────────────────────
// parseFragilityFiles
// ────────────────────────────────────────────────────────────────────────

describe("parseFragilityFiles", () => {
  it("parser F-01 med inline Filer-linje", () => {
    const map = parseFragilityFiles(SAMPLE_FRAGILITY);
    const f01 = map.get("F-01");
    assert.ok(f01, "F-01 finnes");
    assert.deepEqual(f01, [
      "packages/game-client/src/games/game1/screens/PlayScreen.ts",
    ]);
  });

  it("parser F-02 med multi-linje bullet-liste", () => {
    const map = parseFragilityFiles(SAMPLE_FRAGILITY);
    const f02 = map.get("F-02");
    assert.ok(f02, "F-02 finnes");
    assert.deepEqual(f02, [
      "apps/backend/src/game/GamePlanRunService.ts",
      "apps/backend/src/game/MasterActionService.ts",
      "apps/backend/src/game/Game1LobbyService.ts",
    ]);
  });

  it("parser F-03 med flere paths på samme inline-linje", () => {
    const map = parseFragilityFiles(SAMPLE_FRAGILITY);
    const f03 = map.get("F-03");
    assert.ok(f03, "F-03 finnes");
    assert.deepEqual(f03.sort(), [
      ".husky/pre-commit-fragility-check.sh",
      "scripts/check-fragility-comprehension.mjs",
    ].sort());
  });

  it("ignorerer 'Format for ny entry'-seksjonen", () => {
    const map = parseFragilityFiles(SAMPLE_FRAGILITY);
    assert.equal(map.size, 3, "Kun F-01, F-02, F-03 — ikke template");
  });

  it("returnerer tom Map for input uten F-NN-headinger", () => {
    const map = parseFragilityFiles("# No fragility entries\n\nJust text.\n");
    assert.equal(map.size, 0);
  });

  it("ignorerer entries uten filer", () => {
    const noFiles = `## F-99: Empty entry\n\nNo Filer section.\n\n---\n`;
    const map = parseFragilityFiles(noFiles);
    assert.equal(map.size, 0, "Entries uten Filer skal ikke registreres");
  });

  it("strip-er :line-range fra filsti", () => {
    const map = parseFragilityFiles(SAMPLE_FRAGILITY);
    const f01 = map.get("F-01");
    assert.ok(f01);
    assert.ok(
      !f01[0].includes(":"),
      `Filsti skal ikke ha :line-range, fikk: ${f01[0]}`,
    );
  });

  it("dedup-erer duplikate paths innen samme entry", () => {
    const dup = `## F-10: Test\n\n**Filer:** \`a.ts\` \`a.ts\` \`b.ts\`\n\n---\n`;
    const map = parseFragilityFiles(dup);
    const f10 = map.get("F-10");
    assert.deepEqual(f10, ["a.ts", "b.ts"]);
  });

  it("aksepterer kun whitelistede file-extensions", () => {
    const mixed =
      "## F-20: Test\n\n**Filer:** `script.ts` `binary.exe` `data.json` `code.py`\n\n---\n";
    const map = parseFragilityFiles(mixed);
    const f20 = map.get("F-20");
    // .exe og .py er ikke whitelistet — kun .ts og .json plukkes opp
    assert.deepEqual([...f20].sort(), ["data.json", "script.ts"]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// findRequiredFids
// ────────────────────────────────────────────────────────────────────────

describe("findRequiredFids", () => {
  const map = parseFragilityFiles(SAMPLE_FRAGILITY);

  it("matcher exact filsti", () => {
    const result = findRequiredFids(
      ["packages/game-client/src/games/game1/screens/PlayScreen.ts"],
      map,
    );
    assert.deepEqual([...result], ["F-01"]);
  });

  it("matcher en av flere staged filer", () => {
    const result = findRequiredFids(
      ["unrelated/file.ts", "apps/backend/src/game/MasterActionService.ts"],
      map,
    );
    assert.deepEqual([...result], ["F-02"]);
  });

  it("returnerer tom Set hvis ingen matcher", () => {
    const result = findRequiredFids(["foo/bar.ts", "baz/quux.md"], map);
    assert.deepEqual([...result], []);
  });

  it("matcher flere FIDs hvis staged dekker forskjellige entries", () => {
    const result = findRequiredFids(
      [
        "packages/game-client/src/games/game1/screens/PlayScreen.ts",
        "apps/backend/src/game/GamePlanRunService.ts",
      ],
      map,
    );
    assert.deepEqual([...result].sort(), ["F-01", "F-02"]);
  });

  it("matcher self-referansen (denne fila)", () => {
    const result = findRequiredFids(
      ["scripts/check-fragility-comprehension.mjs"],
      map,
    );
    assert.deepEqual([...result], ["F-03"]);
  });

  it("ikke false-positive på like prefiks uten /", () => {
    // "PlayScreen.test.ts" skal IKKE matche "PlayScreen.ts"
    const customMap = new Map([
      ["F-X", ["foo/bar.ts"]],
    ]);
    const result = findRequiredFids(["foo/bar.test.ts"], customMap);
    assert.deepEqual(
      [...result],
      [],
      "Like prefiks uten / skal ikke matche",
    );
  });

  it("matcher directory-prefiks når staged er under fragile-dir", () => {
    const dirMap = new Map([
      ["F-DIR", ["apps/backend/src/game"]],
    ]);
    const result = findRequiredFids(
      ["apps/backend/src/game/BingoEngine.ts"],
      dirMap,
    );
    // Vi forventer match — directory-baserte entries dekker alt under
    assert.deepEqual([...result], ["F-DIR"]);
  });

  it("tom staged-liste returnerer tom Set", () => {
    const result = findRequiredFids([], map);
    assert.deepEqual([...result], []);
  });
});

// ────────────────────────────────────────────────────────────────────────
// extractContextReadFids
// ────────────────────────────────────────────────────────────────────────

describe("extractContextReadFids", () => {
  it("finner en enkelt F-NN", () => {
    const fids = extractContextReadFids("fix(scope): bla\n\n[context-read: F-01]\n");
    assert.deepEqual([...fids], ["F-01"]);
  });

  it("finner flere FIDs i én tag", () => {
    const fids = extractContextReadFids("[context-read: F-01, F-02 F-99]");
    assert.deepEqual([...fids].sort(), ["F-01", "F-02", "F-99"]);
  });

  it("finner FIDs på tvers av flere tagger", () => {
    const fids = extractContextReadFids(
      "[context-read: F-01]\n[context-read: F-02]",
    );
    assert.deepEqual([...fids].sort(), ["F-01", "F-02"]);
  });

  it("returnerer tom Set hvis ingen tag", () => {
    const fids = extractContextReadFids("fix: nothing here\n");
    assert.deepEqual([...fids], []);
  });

  it("er case-insensitive på tag-navn", () => {
    const fids = extractContextReadFids("[Context-Read: f-01]");
    assert.deepEqual([...fids], ["F-01"]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// extractBypassReason
// ────────────────────────────────────────────────────────────────────────

describe("extractBypassReason", () => {
  it("returnerer reason når satt", () => {
    const r = extractBypassReason(
      "fix: thing\n\n[bypass-fragility-check: emergency hotfix]",
    );
    assert.equal(r, "emergency hotfix");
  });

  it("returnerer null når ikke satt", () => {
    const r = extractBypassReason("fix: thing\n");
    assert.equal(r, null);
  });

  it("trim-er whitespace", () => {
    const r = extractBypassReason("[bypass-fragility-check:   spaced   ]");
    assert.equal(r, "spaced");
  });
});

// ────────────────────────────────────────────────────────────────────────
// validateStagedAgainstFragility — full e2e
// ────────────────────────────────────────────────────────────────────────

describe("validateStagedAgainstFragility", () => {
  it("ok=true når ingen staged filer matcher", () => {
    const result = validateStagedAgainstFragility({
      commitMsg: "fix: random",
      stagedFiles: ["unrelated/file.ts"],
      fragilityRaw: SAMPLE_FRAGILITY,
    });
    assert.equal(result.ok, true);
    assert.equal(result.missingFids.length, 0);
  });

  it("ok=true når commit-message har [context-read: F-NN]", () => {
    const result = validateStagedAgainstFragility({
      commitMsg: "fix(game): change\n\n[context-read: F-01]",
      stagedFiles: ["packages/game-client/src/games/game1/screens/PlayScreen.ts"],
      fragilityRaw: SAMPLE_FRAGILITY,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.verifiedFids, ["F-01"]);
  });

  it("ok=false når marker mangler", () => {
    const result = validateStagedAgainstFragility({
      commitMsg: "fix(game): change",
      stagedFiles: ["packages/game-client/src/games/game1/screens/PlayScreen.ts"],
      fragilityRaw: SAMPLE_FRAGILITY,
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.missingFids, ["F-01"]);
  });

  it("rapporterer missing for flere FIDs", () => {
    const result = validateStagedAgainstFragility({
      commitMsg: "fix: both\n\n[context-read: F-01]",
      stagedFiles: [
        "packages/game-client/src/games/game1/screens/PlayScreen.ts",
        "apps/backend/src/game/MasterActionService.ts",
      ],
      fragilityRaw: SAMPLE_FRAGILITY,
    });
    assert.equal(result.ok, false);
    assert.deepEqual(result.missingFids, ["F-02"]);
    assert.deepEqual(result.verifiedFids, ["F-01"]);
  });

  it("ok=true med bypass-marker", () => {
    const result = validateStagedAgainstFragility({
      commitMsg: "fix: emergency\n\n[bypass-fragility-check: prod hotfix, agent unavailable]",
      stagedFiles: ["packages/game-client/src/games/game1/screens/PlayScreen.ts"],
      fragilityRaw: SAMPLE_FRAGILITY,
    });
    assert.equal(result.ok, true);
    assert.equal(result.bypassed, true);
    assert.equal(result.bypassReason, "prod hotfix, agent unavailable");
  });

  it("ok=true med tom staged-liste", () => {
    const result = validateStagedAgainstFragility({
      commitMsg: "",
      stagedFiles: [],
      fragilityRaw: SAMPLE_FRAGILITY,
    });
    assert.equal(result.ok, true);
  });

  it("ok=true når FRAGILITY_LOG har ingen entries", () => {
    const result = validateStagedAgainstFragility({
      commitMsg: "fix: anything",
      stagedFiles: ["packages/game-client/src/games/game1/screens/PlayScreen.ts"],
      fragilityRaw: "# Empty log\n",
    });
    assert.equal(result.ok, true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Bash 3.2 kompatibilitets-integration-test for wrapper
// ────────────────────────────────────────────────────────────────────────

describe("wrapper-script bash 3.2 compatibility", () => {
  it("wrapper bruker ikke bash 4-features (utenfor kommentarer)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const wrapperPath = resolve(
      __dirname,
      "../../.husky/pre-commit-fragility-check.sh",
    );
    const rawContent = readFileSync(wrapperPath, "utf8");

    // Strip comment-linjer FØR sjekk — vi tillater å nevne bash 4-features i
    // doc-kommentaren som forklarer hvorfor wrapperen finnes.
    const codeOnly = rawContent
      .split("\n")
      .filter((l) => !l.trim().startsWith("#"))
      .join("\n");

    // Bash 4-features som IKKE skal forekomme i faktisk kode
    const bash4Features = [
      { name: "declare -A", regex: /\bdeclare\s+-A\b/ },
      { name: "mapfile", regex: /\bmapfile\b/ },
      { name: "readarray", regex: /\breadarray\b/ },
      // ${var,,} og ${var^^} (case-conversion, bash 4)
      { name: "case-conversion ${,,}", regex: /\$\{[^}]+,,\}/ },
      { name: "case-conversion ${^^}", regex: /\$\{[^}]+\^\^\}/ },
      // associative array deref [...]
      { name: "associative-array-deref ${!arr[@]}", regex: /\$\{![a-zA-Z_]+\[@\]\}/ },
    ];

    for (const f of bash4Features) {
      assert.equal(
        f.regex.test(codeOnly),
        false,
        `Wrapper bruker fortsatt bash 4-feature i kode: ${f.name}`,
      );
    }
  });

  it("wrapper kjører på /bin/bash uten error", async () => {
    const { execSync } = await import("node:child_process");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const wrapperPath = resolve(
      __dirname,
      "../../.husky/pre-commit-fragility-check.sh",
    );

    // /bin/bash på macOS er 3.2. Sjekk at scriptet i hvert fall PARSES.
    try {
      execSync(`/bin/bash -n "${wrapperPath}"`, {
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (err) {
      assert.fail(
        `Wrapper feiler bash-syntax-check (-n) på /bin/bash: ${err}`,
      );
    }
  });
});
