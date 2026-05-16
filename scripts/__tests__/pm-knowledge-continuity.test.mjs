/**
 * Tests for scripts/pm-knowledge-continuity.mjs — Fase 3 P3 heuristikk.
 *
 * Bruker node:test (built-in runner). Kjøres med:
 *   node --test scripts/__tests__/pm-knowledge-continuity.test.mjs
 *
 * Dekker:
 *   1. parseAnswers — finner alle Q1..Q12 svar
 *   2. selfTestContentWords — stop-word-filtrering
 *   3. isGenericSelfTestAnswer — fluff-deteksjon (fanger "ok", "lest gjennom")
 *   4. hasQuestionAnchor — per-spørsmål-anker (12 forskjellige anker-sett)
 *   5. extractSelfTestBypass — bypass-marker (gyldig + for-kort)
 *   6. validateSelfTestText — full validation flow (pass / fail / bypass)
 *   7. Heuristikk-guards — fluff blokkeres, legitime svar passerer
 *   8. PER_QUESTION_ANCHORS — dekker alle 12 spørsmål
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PER_QUESTION_ANCHORS,
  parseAnswers,
  selfTestContentWords,
  isGenericSelfTestAnswer,
  hasQuestionAnchor,
  extractSelfTestBypass,
  validateSelfTest,
  validateSelfTestText,
} from "../pm-knowledge-continuity.mjs";

// ────────────────────────────────────────────────────────────────────────
// Fixture builder
// ────────────────────────────────────────────────────────────────────────

/**
 * Build a fully valid 12-question self-test with answers chosen to satisfy
 * every per-question anchor. Used as baseline — tweak fields to test
 * specific failure modes.
 */
function buildFullValidSelfTest(overrides = {}) {
  const defaults = {
    packHash: "abc123def456",
    q1:
      "Forrige PM (PM_HANDOFF_2026-05-15.md) leverte purchase_open-bug forensic pack. " +
      "PM_SESSION_KNOWLEDGE_EXPORT_2026-05-15.md beskriver kontekst-skifte fra implementation til handoff.",
    q2:
      "Åpne PR-er: #1554 (codex GoH observability) og #1555 (coordination protocol). " +
      "Visual-regression workflow er rød siden 2026-05-15. Min branch: claude/fase3-p3-self-test-heuristics-2026-05-16.",
    q3:
      "BIN-816 purchase_open seed/tick P0 fortsatt aktiv. " +
      "Wallet-balanse-equation må bevares per ADR-0024 hash-chain audit-trail. " +
      "apps/backend/src/game/Game1ScheduleTickService.ts:42 er hot-spot.",
    q4:
      "ADR-0024 PM Knowledge Enforcement Architecture må bevares — 4-lags enforcement. " +
      "ADR-0005 outbox-pattern for wallet/compliance. ADR-0002 perpetual-room for Spill 2/3. " +
      "Hash-chain audit invariants i SPILL_ARCHITECTURE_OVERVIEW må ikke brytes.",
    q5:
      "pm-orchestration-pattern v1.5.0 må lastes før agent-spawn. " +
      "spill1-master-flow v1.20.x for purchase-flow-arbeid. " +
      "wallet-outbox-pattern for compliance-touching kode. .claude/skills/intent-verification/SKILL.md hvis Tier-A.",
    q6:
      "PITFALLS_LOG.md §11.18 (implementation-agent uten forensic evidence), §11.19 (high-risk fritekst-prompt), " +
      "§3.11 (TRE-fase-binding multiplier), §1.9 (regulatorisk color-multiplier).",
    q7:
      "Sentry SPILLORAMA-BACKEND-6 må overvåkes. PostHog session-replay aktivert for purchase-flow. " +
      "pilot-monitor.log må streames under hver live-test. Ved alarm: stopp test, fang DB-snapshot.",
    q8:
      "Branch: claude/fase3-p3-self-test-heuristics-2026-05-16, working tree clean. " +
      "Ingen untracked filer som skal mergees. scripts/pm-knowledge-continuity.mjs er aktiv arbeid.",
    q9:
      "Forrige PM mergede #1551 (Fase 2 skill-SHA-lockfile), #1552 (Fase 3 P1 delivery-report), " +
      "#1553 (purchase-flow quick-wins). Commit 9c35ec396 er forrige main-state. " +
      "Ikke avgjort: Fase 3 P2 (checkpoint-signing) er utsatt.",
    q10:
      "Første handling: implementer Fase 3 P3 self-test heuristikk. " +
      "Konkret: utvid scripts/pm-knowledge-continuity.mjs validateSelfTest med per-spørsmål-anker. " +
      "Følger samme spor som forrige PM (Fase 3-serien).",
    q11:
      "AGENT_DELIVERY_REPORT_TEMPLATE.md med 8 H3-seksjoner. " +
      "Hvis docs-only: [delivery-report-not-applicable: <begrunnelse>] med label. " +
      "Knowledge updates i §5 må matche faktisk diff.",
    q12:
      "Hvis arbeidet endrer PM-workflow-behavior: oppdater pm-orchestration-pattern SKILL.md, " +
      "PITFALLS_LOG.md (append-only), AGENT_EXECUTION_LOG.md (append-only) i samme PR. " +
      "Per §2.19 IMMUTABLE i CLAUDE.md.",
  };
  const o = { ...defaults, ...overrides };
  return `# PM Knowledge Continuity Self-Test

**Pack:** \`/tmp/pack.md\`
**Pack SHA256:** \`${o.packHash}\`

### Q1. Hva er nøyaktig videreføringsprioritet fra siste PM-handoff og knowledge-export?

**Answer:** ${o.q1}

### Q2. Hvilke åpne PR-er, røde workflows eller uferdige branches må PM ta hensyn til før første kodehandling?

**Answer:** ${o.q2}

### Q3. Hvilke P0/P1-risikoer er aktive nå for live-room, wallet, compliance eller pilot?

**Answer:** ${o.q3}

### Q4. Hvilke arkitekturvalg og invariants må du bevare i første oppgave?

**Answer:** ${o.q4}

### Q5. Hvilke skills må lastes før du spawner agent eller endrer kode i det aktuelle domenet?

**Answer:** ${o.q5}

### Q6. Hvilke PITFALLS_LOG-entries er mest relevante, og hvilken konkret feil hindrer hver av dem?

**Answer:** ${o.q6}

### Q7. Hvilke observability-kilder må være aktive under test, og hva gjør du ved ny Sentry/PostHog/monitor-alarm?

**Answer:** ${o.q7}

### Q8. Hva er git-state akkurat nå, og hvilke utrackede eller uferdige filer må ikke blandes inn i neste PR?

**Answer:** ${o.q8}

### Q9. Hva leverte forrige PM, hva ble ikke ferdig, og hvilke beslutninger må ikke tas på nytt?

**Answer:** ${o.q9}

### Q10. Hva er din første konkrete handling etter onboarding, og hvorfor er den i samme spor som forrige PM?

**Answer:** ${o.q10}

### Q11. Hvilket leveranseformat krever du fra agenter før PM kan åpne PR?

**Answer:** ${o.q11}

### Q12. Hvilke dokumenter eller skills må oppdateres hvis arbeidet avdekker ny kunnskap?

**Answer:** ${o.q12}
`;
}

// ────────────────────────────────────────────────────────────────────────
// PER_QUESTION_ANCHORS coverage
// ────────────────────────────────────────────────────────────────────────

describe("PER_QUESTION_ANCHORS", () => {
  it("covers all 12 self-test questions", () => {
    const nums = PER_QUESTION_ANCHORS.map((q) => q.num).sort((a, b) => a - b);
    assert.deepEqual(nums, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("every question has at least one anchor regex", () => {
    for (const q of PER_QUESTION_ANCHORS) {
      assert.ok(q.anchors.length >= 1, `Q${q.num} must have at least one anchor`);
      for (const re of q.anchors) {
        assert.ok(re instanceof RegExp, `Q${q.num} anchor must be RegExp`);
      }
    }
  });

  it("every question has expected-description and label", () => {
    for (const q of PER_QUESTION_ANCHORS) {
      assert.ok(typeof q.expected === "string" && q.expected.length > 10);
      assert.ok(typeof q.label === "string" && q.label.startsWith(`Q${q.num}`));
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// parseAnswers
// ────────────────────────────────────────────────────────────────────────

describe("parseAnswers", () => {
  it("parses 12 numbered answers from a valid self-test", () => {
    const text = buildFullValidSelfTest();
    const answers = parseAnswers(text);
    assert.equal(answers.length, 12);
    assert.deepEqual(
      answers.map((a) => a.number),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    );
  });

  it("returns empty array when no Q-headers", () => {
    const answers = parseAnswers("just some text\nno headers");
    assert.equal(answers.length, 0);
  });

  it("extracts only the answer text after **Answer:**", () => {
    const text = "### Q1. Test question?\n\n**Answer:** Concrete answer here.\n";
    const answers = parseAnswers(text);
    assert.equal(answers.length, 1);
    assert.equal(answers[0].answer, "Concrete answer here.");
  });
});

// ────────────────────────────────────────────────────────────────────────
// selfTestContentWords
// ────────────────────────────────────────────────────────────────────────

describe("selfTestContentWords", () => {
  it("filters out stop-words and keeps content words", () => {
    const words = selfTestContentWords("Dette er en test av self-test heuristikken");
    assert.ok(words.includes("test"));
    assert.ok(words.includes("self-test") || words.includes("heuristikken"));
    assert.ok(!words.includes("dette"));
    assert.ok(!words.includes("er"));
    assert.ok(!words.includes("en"));
  });

  it("filters out words shorter than 3 chars", () => {
    const words = selfTestContentWords("ab cde fghi");
    assert.ok(!words.includes("ab"));
    assert.ok(words.includes("cde"));
    assert.ok(words.includes("fghi"));
  });

  it("strips markdown punctuation", () => {
    const words = selfTestContentWords("Use `npm test` to verify.");
    assert.ok(words.includes("npm"));
    assert.ok(words.includes("test"));
    assert.ok(words.includes("verify"));
  });
});

// ────────────────────────────────────────────────────────────────────────
// isGenericSelfTestAnswer
// ────────────────────────────────────────────────────────────────────────

describe("isGenericSelfTestAnswer", () => {
  it("flags 'OK' as generic", () => {
    assert.equal(isGenericSelfTestAnswer("OK"), true);
    assert.equal(isGenericSelfTestAnswer("ok"), true);
    assert.equal(isGenericSelfTestAnswer("OK."), true);
  });

  it("flags 'lest gjennom' patterns", () => {
    assert.equal(isGenericSelfTestAnswer("lest gjennom"), true);
    assert.equal(isGenericSelfTestAnswer("Lest gjennom."), true);
    assert.equal(isGenericSelfTestAnswer("tatt en titt"), true);
    assert.equal(isGenericSelfTestAnswer("sett på"), true);
  });

  it("flags 'have read'/'read pack' English patterns", () => {
    assert.equal(isGenericSelfTestAnswer("have read"), true);
    assert.equal(isGenericSelfTestAnswer("read pack"), true);
    assert.equal(isGenericSelfTestAnswer("read all"), true);
  });

  it("does NOT flag concrete sentences", () => {
    assert.equal(
      isGenericSelfTestAnswer(
        "Forrige PM mergede PR #1551 (Fase 2 skill-SHA-lockfile) og #1552 (delivery-report-gate).",
      ),
      false,
    );
  });

  it("flags empty string", () => {
    assert.equal(isGenericSelfTestAnswer(""), true);
    assert.equal(isGenericSelfTestAnswer("   "), true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// hasQuestionAnchor — per-question matrix
// ────────────────────────────────────────────────────────────────────────

describe("hasQuestionAnchor", () => {
  it("Q1 accepts PM_HANDOFF filename", () => {
    const r = hasQuestionAnchor("Refererer PM_HANDOFF_2026-05-15.md tydelig.", 1);
    assert.equal(r.ok, true);
  });

  it("Q1 accepts PM_SESSION_KNOWLEDGE_EXPORT filename", () => {
    const r = hasQuestionAnchor("Se PM_SESSION_KNOWLEDGE_EXPORT_2026-05-14.md.", 1);
    assert.equal(r.ok, true);
  });

  it("Q1 rejects generic 'leste handoff'", () => {
    const r = hasQuestionAnchor("Leste handoff fra forrige PM, viktig kontekst.", 1);
    assert.equal(r.ok, false);
    assert.ok(r.expected.includes("PM_HANDOFF") || r.expected.includes("EXPORT"));
  });

  it("Q2 accepts PR-nummer", () => {
    const r = hasQuestionAnchor("PR #1554 og #1555 er aktive.", 2);
    assert.equal(r.ok, true);
  });

  it("Q2 accepts workflow name", () => {
    const r = hasQuestionAnchor("knowledge-protocol gate-en feiler nå.", 2);
    assert.equal(r.ok, true);
  });

  it("Q3 accepts BIN-NNN", () => {
    const r = hasQuestionAnchor("BIN-816 fortsatt P0-blokker for pilot.", 3);
    assert.equal(r.ok, true);
  });

  it("Q3 accepts P0 + wallet keyword", () => {
    const r = hasQuestionAnchor("P0 wallet-balanse-feil er aktiv nå.", 3);
    assert.equal(r.ok, true);
  });

  it("Q3 accepts file:line", () => {
    const r = hasQuestionAnchor("Bug i Game1ScheduleTickService.ts:42 må fikses.", 3);
    assert.equal(r.ok, true);
  });

  it("Q4 accepts ADR-NNNN", () => {
    const r = hasQuestionAnchor("ADR-0024 PM Knowledge Architecture er load-bearing.", 4);
    assert.equal(r.ok, true);
  });

  it("Q4 accepts architectural concept by name", () => {
    const r = hasQuestionAnchor("Hash-chain invariant må bevares for audit-trail.", 4);
    assert.equal(r.ok, true);
  });

  it("Q5 accepts skill name", () => {
    const r = hasQuestionAnchor("Last pm-orchestration-pattern før agent-spawn.", 5);
    assert.equal(r.ok, true);
  });

  it("Q6 accepts §X.Y format", () => {
    const r = hasQuestionAnchor("PITFALLS §11.19 om high-risk fritekst-prompts.", 6);
    assert.equal(r.ok, true);
  });

  it("Q6 rejects generic 'flere fallgruver'", () => {
    const r = hasQuestionAnchor("Flere fallgruver dokumentert i PITFALLS-loggen.", 6);
    assert.equal(r.ok, false);
  });

  it("Q7 accepts Sentry/PostHog/pilot-monitor", () => {
    assert.equal(hasQuestionAnchor("Sentry må overvåkes.", 7).ok, true);
    assert.equal(hasQuestionAnchor("PostHog session-replay aktivert.", 7).ok, true);
    assert.equal(hasQuestionAnchor("pilot-monitor.log streames.", 7).ok, true);
  });

  it("Q7 accepts Sentry issue ID", () => {
    const r = hasQuestionAnchor("SPILLORAMA-BACKEND-6 må resolves.", 7);
    assert.equal(r.ok, true);
  });

  it("Q8 accepts branch-name", () => {
    const r = hasQuestionAnchor("Branch: claude/fase3-p3-self-test-heuristics-2026-05-16, working tree clean.", 8);
    assert.equal(r.ok, true);
  });

  it("Q8 accepts file path", () => {
    const r = hasQuestionAnchor("scripts/validate-delivery-report.mjs er aktivt arbeid.", 8);
    assert.equal(r.ok, true);
  });

  it("Q9 accepts PR-numre OR commit-SHA", () => {
    assert.equal(hasQuestionAnchor("Forrige PM mergede #1551, #1552, #1553.", 9).ok, true);
    assert.equal(hasQuestionAnchor("Commit 9c35ec396 er forrige main-state.", 9).ok, true);
  });

  it("Q10 accepts CLI-command + file path", () => {
    const r = hasQuestionAnchor(
      "Utvid scripts/pm-knowledge-continuity.mjs validateSelfTest.",
      10,
    );
    assert.equal(r.ok, true);
  });

  it("Q11 accepts AGENT_DELIVERY_REPORT", () => {
    const r = hasQuestionAnchor("AGENT_DELIVERY_REPORT_TEMPLATE.md med 8 seksjoner.", 11);
    assert.equal(r.ok, true);
  });

  it("Q11 accepts '8 seksjon' phrase", () => {
    const r = hasQuestionAnchor("Krev 8 H3-seksjon i PR-body før merge.", 11);
    assert.equal(r.ok, true);
  });

  it("Q12 accepts SKILL.md / PITFALLS_LOG.md / AGENT_EXECUTION_LOG.md", () => {
    assert.equal(hasQuestionAnchor("Oppdater SKILL.md hvis pattern endrer seg.", 12).ok, true);
    assert.equal(hasQuestionAnchor("Append til PITFALLS_LOG.md.", 12).ok, true);
    assert.equal(hasQuestionAnchor("Entry i AGENT_EXECUTION_LOG.md.", 12).ok, true);
  });

  it("Q12 rejects vague 'oppdater docs'", () => {
    const r = hasQuestionAnchor("Oppdater relevante docs etter endring.", 12);
    assert.equal(r.ok, false);
  });

  it("returns ok=true for unknown question num (no-op)", () => {
    const r = hasQuestionAnchor("anything", 99);
    assert.equal(r.ok, true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// extractSelfTestBypass
// ────────────────────────────────────────────────────────────────────────

describe("extractSelfTestBypass", () => {
  it("returns bypass=false when marker absent", () => {
    const r = extractSelfTestBypass("Regular text without marker.");
    assert.equal(r.bypass, false);
  });

  it("returns bypass=true + valid=true for long reason", () => {
    const r = extractSelfTestBypass(
      "[self-test-bypass: pack inneholder ingen åpne PR-er fordi alle PR-er er merget]",
    );
    assert.equal(r.bypass, true);
    assert.equal(r.valid, true);
  });

  it("returns valid=false for too-short reason", () => {
    const r = extractSelfTestBypass("[self-test-bypass: kort]");
    assert.equal(r.bypass, true);
    assert.equal(r.valid, false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// validateSelfTestText — full flow
// ────────────────────────────────────────────────────────────────────────

describe("validateSelfTestText", () => {
  it("passes fully valid self-test", () => {
    const text = buildFullValidSelfTest();
    const r = validateSelfTestText(text);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.bypass, false);
  });

  it("fails when fewer than 10 answers", () => {
    const text =
      "**Pack SHA256:** `abc123`\n\n### Q1. ?\n\n**Answer:** " +
      "a".repeat(100) +
      " PM_HANDOFF_2026-05-15.md\n";
    const r = validateSelfTestText(text);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /at least 10/.test(e)));
  });

  it("fails when packHash is 'missing'", () => {
    const text = buildFullValidSelfTest({ packHash: "missing" });
    const r = validateSelfTestText(text);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /pack SHA256/.test(e)));
  });

  it("fails when an answer is too short", () => {
    const text = buildFullValidSelfTest({ q1: "Short." });
    const r = validateSelfTestText(text);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /Q1.*too short/.test(e)));
  });

  it("fails when answer contains placeholder token", () => {
    const text = buildFullValidSelfTest({
      q5:
        "TODO: fyll inn relevante skills senere når pack er bygget komplett ferdig. " +
        "Dette er bare en plassholder som åpenbart må erstattes med ekte innhold.",
    });
    const r = validateSelfTestText(text);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /placeholder/.test(e)));
  });

  it("fails when answer matches generic fluff", () => {
    // Need long enough to bypass length-check first
    const text = buildFullValidSelfTest({
      q1: "Lest gjennom",
    });
    const r = validateSelfTestText(text);
    assert.equal(r.ok, false);
    // Either too-short OR generic fluff — both are valid failures
    assert.ok(r.errors.some((e) => /Q1/.test(e)));
  });

  it("fails when answer is long but lacks per-question anchor", () => {
    const text = buildFullValidSelfTest({
      // Q1 needs PM_HANDOFF or PM_SESSION_KNOWLEDGE_EXPORT
      q1:
        "Jeg har et generelt bilde av hva forrige PM jobbet med og hva som er prioritert " +
        "fremover, men jeg refererer ingen konkrete filer eller datoer i dette svaret.",
    });
    const r = validateSelfTestText(text);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /Q1.*mangler konkret anker/.test(e)));
  });

  it("passes when bypass marker is present with valid reason", () => {
    const text =
      "[self-test-bypass: pack inneholder ingen aktive PR-er denne sesjonen]\n" +
      buildFullValidSelfTest();
    const r = validateSelfTestText(text);
    assert.equal(r.ok, true);
    assert.equal(r.bypass, true);
    assert.ok(r.warnings.length > 0);
  });

  it("fails when bypass marker has too-short reason", () => {
    const text = "[self-test-bypass: kort]\n" + buildFullValidSelfTest();
    const r = validateSelfTestText(text);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /too short/.test(e)));
  });

  it("accepts skipPackHashCheck=true option", () => {
    const text = buildFullValidSelfTest({ packHash: "missing" });
    const r = validateSelfTestText(text, { skipPackHashCheck: true });
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  });
});

// ────────────────────────────────────────────────────────────────────────
// Heuristic guards (regression-protection)
// ────────────────────────────────────────────────────────────────────────

describe("heuristic guards", () => {
  it("rejects 80+ char answer that is just repeated stop-words", () => {
    const text = buildFullValidSelfTest({
      q4:
        "Det er noen ting som kan være viktige å bevare hvis vi tar dette på alvor og " +
        "det er noe vi bør tenke på når vi går videre med arbeidet i fremtiden.",
    });
    const r = validateSelfTestText(text);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /Q4.*mangler konkret anker/.test(e)));
  });

  it("accepts a deeply technical answer with multiple anchors", () => {
    const text = buildFullValidSelfTest({
      q3:
        "BIN-816 (purchase_open seed/tick) er P0 pilot-blokker. " +
        "Sub-bug i apps/backend/src/game/Game1ScheduleTickService.ts:142 " +
        "som affekterer wallet-balanse-equation per audit-hash-chain.",
    });
    const r = validateSelfTestText(text);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  });

  it("rejects answer that uses anchor-format in placeholder way", () => {
    // Try: answer says "PR #XXX" with X placeholder
    // Hard-codes that Q2 needs a real PR number. "#XXX" doesn't match \d{3,}.
    const text = buildFullValidSelfTest({
      q2: "Det finnes en åpen PR #XXX som er aktiv akkurat nå og som dekker noe annet sporsel.",
    });
    const r = validateSelfTestText(text);
    assert.equal(r.ok, false);
  });
});

// ────────────────────────────────────────────────────────────────────────
// validateSelfTest (file-based) — minimal smoke test
// ────────────────────────────────────────────────────────────────────────

describe("validateSelfTest (file-based)", () => {
  it("returns error when file does not exist", () => {
    const r = validateSelfTest("/tmp/does-not-exist-xyz123.md");
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /missing/i.test(e)));
  });
});
