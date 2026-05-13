/**
 * Tests for scripts/generate-tobias-readiness.mjs.
 *
 * Bruker node:test (built-in, ingen avhengighet). Kjør med:
 *   node --test scripts/__tests__/generate-tobias-readiness.test.mjs
 *
 * Eller via npm-script:
 *   npm run test:tobias-readiness
 *
 * Hver test dekker en av scenario-klassene + kant-tilfeller.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");
const SCRIPT = resolve(REPO_ROOT, "scripts/generate-tobias-readiness.mjs");
const FIXTURES = resolve(__dirname, "fixtures");
const TEMPLATES_DIR = resolve(REPO_ROOT, "scripts/tobias-readiness-templates");

import {
  classifyFile,
  aggregateScenarios,
  generateReadinessSection,
  buildSummary,
} from "../generate-tobias-readiness.mjs";

// ---------------------------------------------------------------------------
// classifyFile() — unit-tests for hver heuristikk
// ---------------------------------------------------------------------------

describe("classifyFile", () => {
  it("docs/* er docs-only", () => {
    assert.deepEqual(classifyFile("docs/operations/PM_HANDOFF.md"), ["docs-only"]);
  });

  it("README.md er docs-only", () => {
    assert.deepEqual(classifyFile("README.md"), ["docs-only"]);
  });

  it(".husky/* er docs-only", () => {
    assert.deepEqual(classifyFile(".husky/pre-commit"), ["docs-only"]);
  });

  it("scripts/check-pm-gate.mjs er docs-only", () => {
    assert.deepEqual(classifyFile("scripts/check-pm-gate.mjs"), ["docs-only"]);
  });

  it(".github/workflows/* er docs-only", () => {
    assert.deepEqual(classifyFile(".github/workflows/ai-fragility-review.yml"), ["docs-only"]);
  });

  it("MasterActionService → master-start + master-stop + master-advance", () => {
    const tags = classifyFile("apps/backend/src/game/MasterActionService.ts");
    assert.ok(tags.includes("master-start"));
    assert.ok(tags.includes("master-stop"));
    assert.ok(tags.includes("master-advance"));
  });

  it("Game1Engine → spiller-mark", () => {
    const tags = classifyFile("apps/backend/src/game/Game1Engine.ts");
    assert.ok(tags.includes("spiller-mark"));
  });

  it("Game1PayoutService → master-advance + wallet-touch", () => {
    const tags = classifyFile("apps/backend/src/game/Game1PayoutService.ts");
    assert.ok(tags.includes("master-advance"));
    assert.ok(tags.includes("wallet-touch"));
  });

  it("Game1TicketPurchaseService → spiller-buy + wallet-touch", () => {
    const tags = classifyFile("apps/backend/src/game/Game1TicketPurchaseService.ts");
    assert.ok(tags.includes("spiller-buy"));
    assert.ok(tags.includes("wallet-touch"));
  });

  it("wallet/* → wallet-touch", () => {
    assert.deepEqual(classifyFile("apps/backend/src/wallet/WalletService.ts"), ["wallet-touch"]);
  });

  it("PlayScreen.ts → spiller-buy + spiller-mark", () => {
    const tags = classifyFile("packages/game-client/src/games/game1/screens/PlayScreen.ts");
    assert.ok(tags.includes("spiller-buy"));
    assert.ok(tags.includes("spiller-mark"));
  });

  it("BuyPopup.ts → spiller-buy", () => {
    const tags = classifyFile("packages/game-client/src/games/game1/components/BuyPopup.ts");
    assert.ok(tags.includes("spiller-buy"));
  });

  it("admin-web cash-inout → master-start + master-stop", () => {
    const tags = classifyFile("apps/admin-web/src/pages/cash-inout/Spill1HallStatusBox.ts");
    assert.ok(tags.includes("master-start"));
    assert.ok(tags.includes("master-stop"));
  });

  it("sockets/game1* → master-start + spiller-buy", () => {
    const tags = classifyFile("apps/backend/src/sockets/game1Master.ts");
    assert.ok(tags.includes("master-start"));
    assert.ok(tags.includes("spiller-buy"));
  });

  it("ikke-matchet fil → unknown", () => {
    assert.deepEqual(classifyFile("apps/backend/src/unknown-service.ts"), ["unknown"]);
  });

  it("md-fil under packages/ matcher IKKE docs-only (kan være kode-doc)", () => {
    // Dette er en safety-regel: README inne i kode-pakker kan referere kode-paths
    // og bør ikke automatisk klassifiseres som docs-only.
    const tags = classifyFile("packages/game-client/src/games/game1/README.md");
    assert.deepEqual(tags, ["unknown"]);
  });
});

// ---------------------------------------------------------------------------
// aggregateScenarios() — kombinerings-logikk
// ---------------------------------------------------------------------------

describe("aggregateScenarios", () => {
  it("alle filer docs-only → docs-only flagget allDocsOnly", () => {
    const result = aggregateScenarios([
      "docs/foo.md",
      "README.md",
      ".husky/pre-commit",
    ]);
    assert.equal(result.allDocsOnly, true);
    assert.deepEqual(result.scenarios, ["docs-only"]);
  });

  it("blandet docs + kode → kun reelle scenarier", () => {
    const result = aggregateScenarios([
      "docs/foo.md",
      "apps/backend/src/game/Game1Engine.ts",
    ]);
    assert.equal(result.allDocsOnly, false);
    assert.ok(result.scenarios.includes("spiller-mark"));
    assert.ok(!result.scenarios.includes("docs-only"));
  });

  it("kun unknown → unknown", () => {
    const result = aggregateScenarios(["apps/backend/src/some-random-file.ts"]);
    assert.deepEqual(result.scenarios, ["unknown"]);
  });

  it("flere scenarier → alle returnert som unique", () => {
    const result = aggregateScenarios([
      "apps/backend/src/game/MasterActionService.ts",
      "packages/game-client/src/games/game1/screens/PlayScreen.ts",
    ]);
    // master-start, master-stop, master-advance, spiller-buy, spiller-mark
    assert.ok(result.scenarios.length >= 4);
    assert.ok(result.scenarios.includes("master-start"));
    assert.ok(result.scenarios.includes("spiller-buy"));
  });

  it("tom fil-liste → unknown", () => {
    const result = aggregateScenarios([]);
    assert.deepEqual(result.scenarios, ["unknown"]);
  });
});

// ---------------------------------------------------------------------------
// buildSummary() — commit-melding-håndtering
// ---------------------------------------------------------------------------

describe("buildSummary", () => {
  it("bruker første ikke-merge commit-melding", () => {
    const summary = buildSummary(
      ["apps/backend/src/game/Game1Engine.ts"],
      [
        "Merge pull request #1234 from origin/main",
        "fix(backend): repair ball-draw race-condition",
      ],
    );
    assert.match(summary, /repair ball-draw race-condition/i);
    // Skal IKKE inneholde "fix(backend):" prefix
    assert.ok(!summary.includes("fix(backend):"));
  });

  it("fallback til fil-type-sammendrag når ingen commits", () => {
    const summary = buildSummary(
      ["apps/backend/src/game/Game1Engine.ts", "packages/game-client/src/games/game1/screens/PlayScreen.ts"],
      [],
    );
    assert.match(summary, /backend-fil/i);
    assert.match(summary, /game-client-fil/i);
  });

  it("capitalize første bokstav", () => {
    const summary = buildSummary([], ["fix(scope): lowercase start of message"]);
    assert.match(summary, /^Lowercase/);
  });
});

// ---------------------------------------------------------------------------
// generateReadinessSection() — full output-rendering
// ---------------------------------------------------------------------------

describe("generateReadinessSection", () => {
  it("docs-only-PR genererer 'no test needed'-output", () => {
    const output = generateReadinessSection({
      files: ["docs/foo.md", "README.md"],
      commitMessages: [],
      templatesDir: TEMPLATES_DIR,
    });
    assert.match(output, /## 🎯 Tobias smoke-test/);
    assert.match(output, /Smoke-test ikke nødvendig/i);
    assert.match(output, /0 min/);
    // Skal IKKE inneholde dev:nuke-pre-req for docs-only
    assert.ok(!output.includes("dev:nuke"));
  });

  it("master-start-PR rendrer master-start-mal", () => {
    const output = generateReadinessSection({
      files: ["apps/backend/src/game/MasterActionService.ts"],
      commitMessages: ["feat(backend): add master-action validation"],
      templatesDir: TEMPLATES_DIR,
    });
    assert.match(output, /Smoke-test steps \(master starter runde\)/);
    assert.match(output, /demo-agent-1@spillorama\.no/);
    assert.match(output, /Marker hall klar/);
    assert.match(output, /dev:nuke/);
  });

  it("spiller-buy-PR rendrer buy-mal", () => {
    const output = generateReadinessSection({
      files: ["packages/game-client/src/games/game1/components/BuyPopup.ts"],
      commitMessages: [],
      templatesDir: TEMPLATES_DIR,
    });
    assert.match(output, /Buy-popup åpner/);
    assert.match(output, /5 \/ 10 \/ 15 \/ 15 \/ 30 \/ 45 kr/);
  });

  it("wallet-touch-PR inkluderer SQL-verifikasjon", () => {
    const output = generateReadinessSection({
      files: ["apps/backend/src/wallet/WalletService.ts"],
      commitMessages: [],
      templatesDir: TEMPLATES_DIR,
    });
    assert.match(output, /app_wallet_transactions/);
    assert.match(output, /app_rg_compliance_ledger/);
    assert.match(output, /kjøpe-hall/);
  });

  it("unknown-PR rendrer fallback-mal", () => {
    const output = generateReadinessSection({
      files: ["apps/backend/src/something-uncategorized.ts"],
      commitMessages: [],
      templatesDir: TEMPLATES_DIR,
    });
    assert.match(output, /Manuell test ikke auto-generert/);
  });

  it("output er under 100 linjer for typiske PR-er", () => {
    const output = generateReadinessSection({
      files: [
        "apps/backend/src/game/MasterActionService.ts",
        "packages/game-client/src/games/game1/screens/PlayScreen.ts",
      ],
      commitMessages: ["fix(spill1): repair master-start flow"],
      templatesDir: TEMPLATES_DIR,
    });
    const lineCount = output.split("\n").length;
    // Litt slakk over 30 — vi har flere scenarier som hver bidrar ~15 linjer
    assert.ok(lineCount < 100, `Forventet < 100 linjer, fikk ${lineCount}`);
  });

  it("output er Norsk", () => {
    const output = generateReadinessSection({
      files: ["apps/backend/src/game/MasterActionService.ts"],
      commitMessages: [],
      templatesDir: TEMPLATES_DIR,
    });
    // Sjekk for typiske norske ord
    assert.match(output, /runde|spiller|master|hall/);
  });

  it("output har konkrete URL-er", () => {
    const output = generateReadinessSection({
      files: ["apps/backend/src/game/MasterActionService.ts"],
      commitMessages: [],
      templatesDir: TEMPLATES_DIR,
    });
    assert.match(output, /http:\/\/localhost:5174\/admin\/agent\/cash-in-out/);
  });
});

// ---------------------------------------------------------------------------
// Integration test — kjør script som subprocess med fixture-input
// ---------------------------------------------------------------------------

describe("CLI integration", () => {
  function runScript(args, stdinContent) {
    return spawnSync("node", [SCRIPT, ...args], {
      encoding: "utf8",
      cwd: REPO_ROOT,
      input: stdinContent,
    });
  }

  it("--diff-file fungerer", () => {
    const result = runScript([
      "--diff-file",
      resolve(FIXTURES, "diff-master-start.txt"),
    ]);
    assert.equal(result.status, 0, `script failed: ${result.stderr}`);
    assert.match(result.stdout, /master starter runde/i);
  });

  it("--diff-file + --commit-messages fungerer", () => {
    const result = runScript([
      "--diff-file",
      resolve(FIXTURES, "diff-spiller-buy.txt"),
      "--commit-messages",
      resolve(FIXTURES, "commits-pilot-fix.txt"),
    ]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Popup auto-show gate/i);
    assert.match(result.stdout, /Buy-popup åpner/);
  });

  it("docs-only fixture gir 0 min test-tid", () => {
    const result = runScript([
      "--diff-file",
      resolve(FIXTURES, "diff-docs-only.txt"),
    ]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /0 min \(docs-only\)/);
  });

  it("husky-only fixture gir docs-only-treatment", () => {
    const result = runScript([
      "--diff-file",
      resolve(FIXTURES, "diff-husky-only.txt"),
    ]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Smoke-test ikke nødvendig/);
  });

  it("unknown fixture gir fallback-mal", () => {
    const result = runScript([
      "--diff-file",
      resolve(FIXTURES, "diff-unknown.txt"),
    ]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Manuell test ikke auto-generert/);
  });

  it("mixed scenario-fixture combiner flere maler", () => {
    const result = runScript([
      "--diff-file",
      resolve(FIXTURES, "diff-mixed.txt"),
    ]);
    assert.equal(result.status, 0);
    // mixed har Engine + PlayScreen → spiller-mark + spiller-buy
    assert.match(result.stdout, /spiller markerer tall|Buy-popup åpner/);
  });

  it("--output-file skriver til fil", () => {
    const outputPath = resolve(FIXTURES, ".test-output.md");
    const result = runScript([
      "--diff-file",
      resolve(FIXTURES, "diff-master-start.txt"),
      "--output-file",
      outputPath,
    ]);
    assert.equal(result.status, 0);
    const content = readFileSync(outputPath, "utf8");
    assert.match(content, /Tobias smoke-test/);
    // Clean up
    spawnSync("rm", [outputPath]);
  });
});
