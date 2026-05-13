/**
 * Tests for scripts/verify-context-comprehension.mjs
 *
 * Bruker node:test (built-in runner). Kjøres med:
 *   node --test scripts/__tests__/verify-context-comprehension.test.mjs
 *
 * Dekker:
 *   1. parseFragilityLog — parser FRAGILITY-entries korrekt
 *   2. extractComprehensionBlock — finner ## Comprehension i commit-msg
 *   3. extractContextReadFids — finner [context-read: F-NN]-tagger
 *   4. extractBypassReason — finner [comprehension-bypass: ...]-tagger
 *   5. isGenericText — fanger fluff
 *   6. ruleOverlap — krever 3+ ord overlap
 *   7. findFileMention — matcher filsti eller basename
 *   8. validateEntryAgainstComprehension — full entry-validering
 *   9. validateCommitMessage — full e2e med bypass / no-tag / pass / fail
 *   10. Heuristikk skal IKKE være for løs (false-positive) eller for streng
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseFragilityLog,
  extractComprehensionBlock,
  extractContextReadFids,
  extractBypassReason,
  isGenericText,
  ruleOverlap,
  findFileMention,
  validateEntryAgainstComprehension,
  validateCommitMessage,
} from "../verify-context-comprehension.mjs";

// ────────────────────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────────────────────

const SAMPLE_FRAGILITY_LOG = `# FRAGILITY_LOG — kode som ALDRI skal røres

## F-01: PlayScreen.update() popup-auto-show gate (5 conditions)

**Filer:** \`packages/game-client/src/games/game1/screens/PlayScreen.ts:693-720\`

**Hvorfor fragile:** 5 gate-conditions må ALLE være riktige for at popup vises.

**Hva ALDRI gjøre:**
- Legge til ny gate-condition uten å oppdatere alle 4 testene under
- Fjerne \`getEventTracker().track("popup.autoShowGate", ...)\` — server-side monitor avhenger av det
- Endre \`autoShowBuyPopupDone\`-reset-logikk uten å forstå idle-state-modus
- Sette \`waitingForMasterPurchase = true\` permanent — vil låse popup forever

**Hvilke tester MÅ stå grønn etter endring:**
- \`tests/e2e/spill1-pilot-flow.spec.ts\`

**Manuell verifikasjon:** ...

**Historisk skade:** PR #1273, PR #1279

---

## F-02: Plan-run lifecycle — stuck-state mellom test-cleanup og master-action

**Filer:**
- \`apps/backend/src/game/GamePlanRunService.ts\`
- \`apps/backend/src/game/MasterActionService.ts\`

**Hvorfor fragile:** To uavhengige state-maskiner som MÅ reconcileres.

**Hva ALDRI gjøre:**
- Kalle \`masterStop()\` uten å også resette \`app_game_plan_run.status\`
- Endre \`Game1LobbyService.buildNextGameFromItem\` uten å sjekke at både plan-run + scheduled-game-state speiler hverandre
- Anta at \`runStatus="running"\` betyr "joinable game finnes"

**Hvilke tester MÅ stå grønn etter endring:**
- \`tests/e2e/spill1-pilot-flow.spec.ts\`

**Historisk skade:** 2026-05-13 (I16)

---

## Format for ny entry

Resten av dokumentet (ikke en F-entry).
`;

// ────────────────────────────────────────────────────────────────────────
// parseFragilityLog
// ────────────────────────────────────────────────────────────────────────

describe("parseFragilityLog", () => {
  const entries = parseFragilityLog(SAMPLE_FRAGILITY_LOG);

  it("parses two entries", () => {
    assert.equal(entries.size, 2);
    assert.ok(entries.has("F-01"));
    assert.ok(entries.has("F-02"));
  });

  it("captures titles", () => {
    assert.match(entries.get("F-01").title, /PlayScreen\.update\(\)/);
    assert.match(entries.get("F-02").title, /Plan-run lifecycle/);
  });

  it("captures file paths from inline backticks", () => {
    const f01 = entries.get("F-01");
    assert.ok(
      f01.files.some((f) => f.endsWith("PlayScreen.ts")),
      `F-01 files should include PlayScreen.ts, got: ${f01.files.join(", ")}`,
    );
  });

  it("captures multiple file paths from bullet list", () => {
    const f02 = entries.get("F-02");
    assert.ok(
      f02.files.some((f) => f.endsWith("GamePlanRunService.ts")),
      `F-02 should include GamePlanRunService.ts, got: ${f02.files.join(", ")}`,
    );
    assert.ok(
      f02.files.some((f) => f.endsWith("MasterActionService.ts")),
      `F-02 should include MasterActionService.ts, got: ${f02.files.join(", ")}`,
    );
  });

  it("captures Hva ALDRI gjøre bullets", () => {
    const f01 = entries.get("F-01");
    assert.ok(
      f01.neverDo.length >= 3,
      `F-01 should have ≥ 3 never-do rules, got: ${f01.neverDo.length}`,
    );
    assert.ok(
      f01.neverDo.some((r) => /autoShowBuyPopupDone/.test(r)),
      `F-01 never-do should mention autoShowBuyPopupDone`,
    );
  });

  it("stops at non-F-NN section headers (e.g. 'Format for ny entry')", () => {
    // Should NOT include the trailing "## Format for ny entry" section as an entry
    assert.equal(entries.size, 2);
    for (const fid of entries.keys()) {
      assert.match(fid, /^F-\d+$/);
    }
  });

  it("handles real FRAGILITY_LOG.md without crashing", async () => {
    // Smoke test against actual file — uses ESM dynamic imports
    const { readFileSync, existsSync } = await import("node:fs");
    const { join, resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = fileURLToPath(import.meta.url);
    const repoRoot = resolve(dirname(here), "../..");
    const realPath = join(repoRoot, "docs/engineering/FRAGILITY_LOG.md");
    if (!existsSync(realPath)) return; // skip if not present
    const real = readFileSync(realPath, "utf8");
    const realEntries = parseFragilityLog(real);
    assert.ok(realEntries.size >= 1, "should parse at least one entry");
    for (const entry of realEntries.values()) {
      assert.ok(entry.files.length >= 1, `${entry.id} should have ≥ 1 file`);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// extractComprehensionBlock
// ────────────────────────────────────────────────────────────────────────

describe("extractComprehensionBlock", () => {
  it("extracts block ending at next ## heading", () => {
    const msg = `fix(scope): kort

[context-read: F-01]

Body text.

## Comprehension

F-01 covers PlayScreen.ts and the 5-conditions gate. I have checked that autoShowBuyPopupDone reset-logic remains per-round.

## Co-Authored-By
Claude
`;
    const block = extractComprehensionBlock(msg);
    assert.ok(block !== null);
    assert.match(block, /F-01 covers PlayScreen\.ts/);
    assert.doesNotMatch(block, /Co-Authored-By/);
  });

  it("returns null when no block present", () => {
    const msg = `fix(scope): kort\n\nBody only.\n`;
    assert.equal(extractComprehensionBlock(msg), null);
  });

  it("handles trailing Co-Authored-By as terminator", () => {
    const msg = `fix: subject

## Comprehension

Real comprehension content here mentioning PlayScreen.ts file with required keywords.

Co-Authored-By: Someone <a@b>
`;
    const block = extractComprehensionBlock(msg);
    assert.ok(block !== null);
    assert.doesNotMatch(block, /Co-Authored-By/);
    assert.match(block, /PlayScreen\.ts/);
  });

  it("case-insensitive on heading", () => {
    const msg = `fix: subject

## comprehension

Lowercase heading works too.
`;
    const block = extractComprehensionBlock(msg);
    assert.ok(block !== null);
    assert.match(block, /Lowercase heading/);
  });

  it("strips leading/trailing empty lines", () => {
    const msg = `fix: subject

## Comprehension



Some content


`;
    const block = extractComprehensionBlock(msg);
    assert.equal(block.trim(), "Some content");
  });
});

// ────────────────────────────────────────────────────────────────────────
// extractContextReadFids
// ────────────────────────────────────────────────────────────────────────

describe("extractContextReadFids", () => {
  it("extracts single FID", () => {
    const msg = `fix: subject\n\n[context-read: F-01]\n`;
    assert.deepEqual(extractContextReadFids(msg), ["F-01"]);
  });

  it("extracts multiple FIDs in same tag", () => {
    const msg = `fix: subject\n\n[context-read: F-01, F-02, F-03]\n`;
    const result = extractContextReadFids(msg);
    assert.deepEqual(result.sort(), ["F-01", "F-02", "F-03"]);
  });

  it("extracts FIDs across multiple tags", () => {
    const msg = `fix: subject\n\n[context-read: F-01]\n[context-read: F-02]\n`;
    const result = extractContextReadFids(msg);
    assert.deepEqual(result.sort(), ["F-01", "F-02"]);
  });

  it("returns empty array if no tag", () => {
    const msg = `fix: subject\n\nNo tag here.\n`;
    assert.deepEqual(extractContextReadFids(msg), []);
  });

  it("uppercases F-id", () => {
    const msg = `fix\n\n[context-read: f-01]\n`;
    assert.deepEqual(extractContextReadFids(msg), ["F-01"]);
  });
});

// ────────────────────────────────────────────────────────────────────────
// extractBypassReason
// ────────────────────────────────────────────────────────────────────────

describe("extractBypassReason", () => {
  it("extracts reason text", () => {
    const msg = `fix\n\n[comprehension-bypass: emergency hotfix for prod incident BIN-9999]\n`;
    const reason = extractBypassReason(msg);
    assert.equal(reason, "emergency hotfix for prod incident BIN-9999");
  });

  it("returns null when no bypass", () => {
    const msg = `fix\n\nNo bypass.\n`;
    assert.equal(extractBypassReason(msg), null);
  });

  it("trims reason", () => {
    const msg = `fix\n\n[comprehension-bypass:   spaced reason text-1234   ]\n`;
    const reason = extractBypassReason(msg);
    assert.equal(reason, "spaced reason text-1234");
  });
});

// ────────────────────────────────────────────────────────────────────────
// isGenericText
// ────────────────────────────────────────────────────────────────────────

describe("isGenericText", () => {
  it("flags 'jeg leste'", () => {
    assert.equal(isGenericText("jeg leste"), true);
    assert.equal(isGenericText("Jeg leste."), true);
  });

  it("flags 'OK' / 'done' / 'lest'", () => {
    assert.equal(isGenericText("OK"), true);
    assert.equal(isGenericText("done"), true);
    assert.equal(isGenericText("lest"), true);
    assert.equal(isGenericText("read it"), true);
  });

  it("does NOT flag substantive text", () => {
    const real = `F-01 covers PlayScreen.ts and the 5-conditions gate. I have checked autoShowBuyPopupDone reset-logic remains per-round.`;
    assert.equal(isGenericText(real), false);
  });

  it("does NOT flag a long Norwegian comprehension", () => {
    const real = `F-01 dekker PlayScreen.ts og 5-conditions-gate-en. Jeg har sjekket at jeg ikke fjerner getEventTracker().track-callen.`;
    assert.equal(isGenericText(real), false);
  });

  it("flags empty / whitespace", () => {
    assert.equal(isGenericText(""), true);
    assert.equal(isGenericText("   "), true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// ruleOverlap
// ────────────────────────────────────────────────────────────────────────

describe("ruleOverlap", () => {
  it("detects 3+ word overlap", () => {
    const rule = "Fjerne getEventTracker().track('popup.autoShowGate', ...) — server-side monitor avhenger av det";
    const text = "Jeg har sjekket at getEventTracker track-callen og popup.autoShowGate fortsatt er aktivert siden monitor avhenger av det.";
    const { overlap } = ruleOverlap(rule, text);
    assert.ok(overlap >= 3, `overlap should be ≥ 3, got ${overlap}`);
  });

  it("returns 0 for unrelated text", () => {
    const rule = "Fjerne getEventTracker().track('popup.autoShowGate', ...) — server-side monitor avhenger av det";
    const text = "Totally unrelated content about apples and bananas oranges.";
    const { overlap } = ruleOverlap(rule, text);
    assert.equal(overlap, 0);
  });

  it("ignores stop-words", () => {
    const rule = "og er en av de som vi";
    const text = "og er en av de som vi";
    const { overlap } = ruleOverlap(rule, text);
    // All stop-words → 0 content overlap
    assert.equal(overlap, 0);
  });
});

// ────────────────────────────────────────────────────────────────────────
// findFileMention
// ────────────────────────────────────────────────────────────────────────

describe("findFileMention", () => {
  it("matches full path", () => {
    const result = findFileMention(
      ["packages/game-client/src/games/game1/screens/PlayScreen.ts"],
      "I edited packages/game-client/src/games/game1/screens/PlayScreen.ts.",
    );
    assert.ok(result !== null);
  });

  it("matches basename", () => {
    const result = findFileMention(
      ["packages/game-client/src/games/game1/screens/PlayScreen.ts"],
      "Endret PlayScreen.ts på linje 693 for å støtte ...",
    );
    assert.ok(result !== null);
  });

  it("returns null when no match", () => {
    const result = findFileMention(
      ["packages/game-client/src/games/game1/screens/PlayScreen.ts"],
      "No filename here at all.",
    );
    assert.equal(result, null);
  });

  it("ignores too-short basenames", () => {
    const result = findFileMention(
      ["packages/a/b/c/x.ts"],
      "We mentioned an x here.",
    );
    // basename "x.ts" is length 4, below threshold of 5 — should not match
    assert.equal(result, null);
  });
});

// ────────────────────────────────────────────────────────────────────────
// validateEntryAgainstComprehension
// ────────────────────────────────────────────────────────────────────────

describe("validateEntryAgainstComprehension", () => {
  const entries = parseFragilityLog(SAMPLE_FRAGILITY_LOG);
  const f01 = entries.get("F-01");

  it("passes proper paraphrase referencing file + rule", () => {
    const text = `F-01 dekker PlayScreen.ts og 5-conditions-gate-en for popup-auto-show.
Jeg har sjekket at jeg ikke fjerner getEventTracker().track-callen for popup.autoShowGate,
og at autoShowBuyPopupDone-reset-logikken forblir per-runde, ikke per-session.`;
    const result = validateEntryAgainstComprehension(f01, text);
    assert.equal(result.ok, true, `Expected ok=true, errors: ${result.errors.join("; ")}`);
  });

  it("fails when too short", () => {
    const text = `Short`;
    const result = validateEntryAgainstComprehension(f01, text);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /for kort/.test(e)));
  });

  it("fails when too long", () => {
    const text = "x".repeat(2500);
    const result = validateEntryAgainstComprehension(f01, text);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /for lang/.test(e)));
  });

  it("fails when missing filename", () => {
    const text = `Generic comprehension text about autoShowBuyPopupDone and getEventTracker but no file mentioned at all - this should be long enough to pass length check easily.`;
    const result = validateEntryAgainstComprehension(f01, text);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /ingen filsti/.test(e)));
  });

  it("fails when no rule paraphrased", () => {
    const text = `I edited PlayScreen.ts to add a new feature for the lobby screen and game controller. Random words: apples bananas oranges grapes mangoes pineapples elephants giraffes lions tigers bears.`;
    const result = validateEntryAgainstComprehension(f01, text);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /paraphraserer ingen regel/.test(e)));
  });

  it("fails on generic 'jeg leste'", () => {
    const text = `jeg leste`;
    const result = validateEntryAgainstComprehension(f01, text);
    assert.equal(result.ok, false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// validateCommitMessage — full e2e
// ────────────────────────────────────────────────────────────────────────

describe("validateCommitMessage (e2e)", () => {
  const entries = parseFragilityLog(SAMPLE_FRAGILITY_LOG);

  it("ALLOWS commit with no [context-read:] tag", () => {
    const msg = `fix(scope): regular commit\n\nNothing fragile here.\n`;
    const result = validateCommitMessage({ commitMsg: msg, fragilityEntries: entries });
    assert.equal(result.ok, true);
    assert.equal(result.verifiedFids.length, 0);
  });

  it("ALLOWS commit with proper ## Comprehension block", () => {
    const msg = `fix(scope): adjust popup auto-show

[context-read: F-01]

Fixed an issue where popup didn't reset between rounds.

## Comprehension

F-01 dekker PlayScreen.ts og 5-conditions-gate-en for popup-auto-show.
Jeg har sjekket at jeg ikke fjerner getEventTracker().track-callen for
popup.autoShowGate, og at autoShowBuyPopupDone-reset-logikken forblir
per-runde, ikke per-session.

Co-Authored-By: Tester <test@example.com>
`;
    const result = validateCommitMessage({ commitMsg: msg, fragilityEntries: entries });
    assert.equal(result.ok, true, `errors: ${result.errors.join("; ")}`);
    assert.deepEqual(result.verifiedFids, ["F-01"]);
  });

  it("REJECTS commit with generic 'jeg leste' comprehension", () => {
    const msg = `fix(scope): adjust popup

[context-read: F-01]

Body.

## Comprehension

jeg leste
`;
    const result = validateCommitMessage({ commitMsg: msg, fragilityEntries: entries });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /generic pattern/.test(e)));
  });

  it("REJECTS commit with [context-read:] but no ## Comprehension block", () => {
    const msg = `fix(scope): adjust popup

[context-read: F-01]

Body without comprehension block.
`;
    const result = validateCommitMessage({ commitMsg: msg, fragilityEntries: entries });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /mangler '## Comprehension'/.test(e)));
  });

  it("Override accepts valid bypass reason ≥ 20 chars", () => {
    const msg = `fix(scope): emergency hotfix

[context-read: F-01]
[comprehension-bypass: hotfix for ongoing prod incident BIN-9999, full review post-merge]

## Comprehension

(skipped via bypass)
`;
    const result = validateCommitMessage({ commitMsg: msg, fragilityEntries: entries });
    assert.equal(result.ok, true);
    assert.equal(result.bypassed, true);
    assert.ok(result.warnings.some((w) => /bypass/i.test(w)));
  });

  it("Override REJECTS reason shorter than 20 chars", () => {
    const msg = `fix(scope): emergency

[context-read: F-01]
[comprehension-bypass: too short]

## Comprehension

(skipped)
`;
    const result = validateCommitMessage({ commitMsg: msg, fragilityEntries: entries });
    assert.equal(result.ok, false);
    assert.equal(result.bypassed, false);
    assert.ok(result.errors.some((e) => /for kort/.test(e)));
  });

  it("Validates multiple FIDs independently", () => {
    const msg = `fix(scope): touch multiple fragile files

[context-read: F-01, F-02]

Body.

## Comprehension

F-01 dekker PlayScreen.ts og popup-auto-show-gate. Jeg har sjekket at jeg
ikke fjerner getEventTracker track-callen og at autoShowBuyPopupDone forblir
per-runde. F-02 dekker GamePlanRunService.ts og lifecycle. Jeg har verifisert
at masterStop også resetter app_game_plan_run.status og at jeg ikke endrer
Game1LobbyService.buildNextGameFromItem uten å sjekke begge state-maskinene.
`;
    const result = validateCommitMessage({ commitMsg: msg, fragilityEntries: entries });
    assert.equal(result.ok, true, `errors: ${result.errors.join("; ")}`);
    assert.deepEqual(result.verifiedFids.sort(), ["F-01", "F-02"]);
  });

  it("Warns when [context-read: F-99] references unknown entry", () => {
    const msg = `fix(scope): something

[context-read: F-99]

## Comprehension

F-99 dekker PlayScreen.ts og noe annet, men entry-en finnes ikke. Innholdet
her er bare for å passere length-check. Lorem ipsum dolor sit amet whatever
this is the warning case.
`;
    const result = validateCommitMessage({ commitMsg: msg, fragilityEntries: entries });
    // F-99 not present → warning only, no errors
    assert.equal(result.ok, true);
    assert.ok(result.warnings.some((w) => /F-99/.test(w)));
  });
});

// ────────────────────────────────────────────────────────────────────────
// Heuristic-quality tests — guard against false-positives + false-negatives
// ────────────────────────────────────────────────────────────────────────

describe("heuristic quality — false-positive guards", () => {
  const entries = parseFragilityLog(SAMPLE_FRAGILITY_LOG);

  it("accepts realistic short-but-substantive Norwegian comprehension", () => {
    // Test that a paraphrase with 3+ content-word overlap to a never-do rule
    // passes — covers the realistic case where a developer references file +
    // rule content without copying verbatim.
    //
    // F-01 rule: "Fjerne getEventTracker().track('popup.autoShowGate', ...) —
    //   server-side monitor avhenger av det"
    // Overlap with text below: getEventTracker, track, popup.autoShowGate, monitor — 4 words ≥ 3
    const msg = `fix(game-client): add data-test to PlayScreen

[context-read: F-01]

## Comprehension

F-01 viser at PlayScreen.ts har en 5-conditions popup-auto-show-gate hvor
autoShowBuyPopupDone reset-logikken må forbli per-runde. Jeg har sjekket at
getEventTracker.track-callen for popup.autoShowGate er beholdt fordi server-side
monitor avhenger av det, og at jeg ikke endrer gate-conditions eller idle-state.
`;
    const result = validateCommitMessage({ commitMsg: msg, fragilityEntries: entries });
    assert.equal(
      result.ok,
      true,
      `Should accept realistic comprehension. Errors: ${result.errors.join("; ")}`,
    );
  });

  it("rejects copy-paste of FRAGILITY entry without paraphrase markers", () => {
    // Just copies the entry text verbatim — should still pass IF text contains
    // file ref + rule overlap. This test verifies that we're not over-strict.
    const msg = `fix: test

[context-read: F-01]

## Comprehension

PlayScreen.ts har en popup-auto-show-gate med 5 conditions. Endring i ÉN
av disse uten å verifisere de ANDRE = popup mismatched mot Tobias-flyt.
Jeg har ikke endret autoShowBuyPopupDone-reset-logikk uten å forstå idle-state.
`;
    const result = validateCommitMessage({ commitMsg: msg, fragilityEntries: entries });
    // Should pass — has file mention + rule overlap + substantive content
    assert.equal(result.ok, true, `errors: ${result.errors.join("; ")}`);
  });
});
