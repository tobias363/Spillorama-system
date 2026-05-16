/**
 * Tests for scripts/validate-delivery-report.mjs
 *
 * Bruker node:test (built-in runner). Kjøres med:
 *   node --test scripts/__tests__/validate-delivery-report.test.mjs
 *
 * Dekker:
 *   - parseSections / missingSections
 *   - Bypass-marker (gyldig + for-kort begrunnelse)
 *   - Missing report-header
 *   - Missing 1-N seksjoner
 *   - §4 Tests-validering (kommando, "ikke kjørt"+begrunnelse, mangel)
 *   - §5 Knowledge-cross-check (skill / PITFALLS / AGENT_EXECUTION_LOG)
 *   - §8 Ready-format (ja/nei + Reason)
 *   - Out-of-order (warning, ikke error)
 *   - Edge cases (empty body, only frontmatter, CRLF)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validate,
  parseSections,
  missingSections,
  SECTIONS,
} from "../validate-delivery-report.mjs";

// ---------- Fixture builders ----------

function fullValidBody({
  bypassMarker = null,
  reportHeader = "## Agent Delivery Report — Test agent",
  skillPath = ".claude/skills/test-skill/SKILL.md",
  pitfallsPath = "docs/engineering/PITFALLS_LOG.md",
  agentLogPath = "docs/engineering/AGENT_EXECUTION_LOG.md",
  testsCommand = "`npm test` — pass",
  readyAnswer = "ja",
  readyReason = "All checks passed.",
} = {}) {
  const parts = [];
  if (bypassMarker !== null) {
    parts.push(`[delivery-report-not-applicable: ${bypassMarker}]`);
    parts.push("");
  }
  parts.push(reportHeader);
  parts.push("");
  parts.push("**Branch:** `claude/test`");
  parts.push("**Commit(s):** `abc1234`");
  parts.push("**PR:** #123");
  parts.push("**Scope:** Test scope");
  parts.push("");
  parts.push("### 1. Context read before changes");
  parts.push("- Read AGENT_TASK_CONTRACT.md");
  parts.push("- Read PITFALLS_LOG.md §11");
  parts.push("");
  parts.push("### 2. What changed");
  parts.push("- `apps/backend/src/game/Game1Service.ts:42` — added X");
  parts.push("");
  parts.push("### 3. Invariants preserved");
  parts.push("- Wallet balance equation unchanged");
  parts.push("");
  parts.push("### 4. Tests and verification");
  parts.push(`- ${testsCommand}`);
  parts.push("");
  parts.push("### 5. Knowledge updates");
  if (skillPath) parts.push(`- Skill: \`${skillPath}\` — updated section X`);
  if (pitfallsPath) parts.push(`- PITFALLS_LOG: \`${pitfallsPath}\` §11.X — new entry`);
  if (agentLogPath) parts.push(`- AGENT_EXECUTION_LOG: \`${agentLogPath}\` — added entry`);
  parts.push("");
  parts.push("### 6. Lessons learned");
  parts.push("- Discovered Y when fixing X");
  parts.push("");
  parts.push("### 7. Open risk / follow-up");
  parts.push("- Ingen");
  parts.push("");
  parts.push("### 8. Ready for PR");
  parts.push("");
  parts.push(`Ready for PR: ${readyAnswer}`);
  parts.push(`Reason: ${readyReason}`);
  return parts.join("\n");
}

const FULL_DIFF = [
  "apps/backend/src/game/Game1Service.ts",
  ".claude/skills/test-skill/SKILL.md",
  "docs/engineering/PITFALLS_LOG.md",
  "docs/engineering/AGENT_EXECUTION_LOG.md",
];

// ---------- parseSections / missingSections ----------

describe("parseSections", () => {
  it("finds all 8 sections in order", () => {
    const parsed = parseSections(fullValidBody());
    assert.equal(parsed.length, 8);
    assert.deepEqual(
      parsed.map((p) => p.num),
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
  });

  it("returns empty array when no sections present", () => {
    const parsed = parseSections("Just some text without headers.");
    assert.equal(parsed.length, 0);
  });

  it("ignores headers with wrong number or title", () => {
    const body = "### 1. Wrong title here\n### 9. Made up section\n";
    const parsed = parseSections(body);
    assert.equal(parsed.length, 0);
  });

  it("handles CRLF line endings", () => {
    const body = fullValidBody().replace(/\n/g, "\r\n");
    const parsed = parseSections(body);
    assert.equal(parsed.length, 8);
  });
});

describe("missingSections", () => {
  it("reports all missing when body has none", () => {
    const missing = missingSections([]);
    assert.equal(missing.length, SECTIONS.length);
  });

  it("reports zero missing when all present", () => {
    const parsed = parseSections(fullValidBody());
    assert.equal(missingSections(parsed).length, 0);
  });

  it("reports specific missing sections", () => {
    const body = fullValidBody().replace(/### 5\. Knowledge updates[\s\S]*?### 6/, "### 6");
    const parsed = parseSections(body);
    const missing = missingSections(parsed);
    assert.equal(missing.length, 1);
    assert.equal(missing[0].num, 5);
  });
});

// ---------- Bypass marker ----------

describe("bypass marker", () => {
  it("accepts bypass with valid reason (≥ 10 chars)", () => {
    const body = fullValidBody({ bypassMarker: "docs-only mechanical formatting change" });
    const result = validate(body, []);
    assert.equal(result.ok, true);
    assert.equal(result.bypass, true);
  });

  it("rejects bypass with reason too short", () => {
    const body = "[delivery-report-not-applicable: short]\n";
    const result = validate(body, []);
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /too short/);
  });

  it("rejects bypass without report when reason missing", () => {
    const body = "[delivery-report-not-applicable: ]";
    const result = validate(body, []);
    assert.equal(result.ok, false);
  });
});

// ---------- Report header ----------

describe("report header", () => {
  it("rejects body without `## Agent Delivery Report` header", () => {
    const body = "Just a regular PR description without the template.";
    const result = validate(body, []);
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /Missing.*Agent Delivery Report/);
  });

  it("accepts body with extra prefix text before report header", () => {
    const body = "## Summary\n\nSome description.\n\n" + fullValidBody();
    const result = validate(body, FULL_DIFF);
    assert.equal(result.ok, true);
  });
});

// ---------- Section completeness ----------

describe("section completeness", () => {
  it("fails when §1 missing", () => {
    const body = fullValidBody().replace(/### 1\. Context read before changes[\s\S]*?### 2/, "### 2");
    const result = validate(body, FULL_DIFF);
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /§1/);
  });

  it("fails when multiple sections missing", () => {
    let body = fullValidBody();
    body = body.replace(/### 3\. Invariants preserved[\s\S]*?### 4/, "### 4");
    body = body.replace(/### 6\. Lessons learned[\s\S]*?### 7/, "### 7");
    const result = validate(body, FULL_DIFF);
    assert.equal(result.ok, false);
    assert.match(result.errors[0], /§3/);
    assert.match(result.errors[0], /§6/);
  });

  it("passes when all 8 sections present", () => {
    const body = fullValidBody();
    const result = validate(body, FULL_DIFF);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });
});

// ---------- §4 Tests validation ----------

describe("§4 Tests validation", () => {
  it("accepts section with backtick command", () => {
    const body = fullValidBody({ testsCommand: "`npm test` — pass" });
    const result = validate(body, FULL_DIFF);
    assert.equal(result.ok, true);
  });

  it('accepts section with "ikke kjørt" + reason', () => {
    const body = fullValidBody({
      testsCommand: "Ikke kjørt — grunn: docs-only endring, ingen test relevant",
    });
    const result = validate(body, FULL_DIFF);
    assert.equal(result.ok, true);
  });

  it("rejects section without command or justification", () => {
    const body = fullValidBody({ testsCommand: "Looked at it." });
    const result = validate(body, FULL_DIFF);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("§4")));
  });

  it('rejects "ikke kjørt" without reason word', () => {
    const body = fullValidBody({ testsCommand: "Ikke kjørt." });
    const result = validate(body, FULL_DIFF);
    assert.equal(result.ok, false);
  });
});

// ---------- §5 Knowledge cross-check ----------

describe("§5 Knowledge cross-check", () => {
  it("passes when all claimed paths are in diff", () => {
    const body = fullValidBody();
    const result = validate(body, FULL_DIFF);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });

  it("fails when claimed skill not in diff", () => {
    const body = fullValidBody({
      skillPath: ".claude/skills/nonexistent/SKILL.md",
    });
    const diffWithoutThatSkill = FULL_DIFF.filter((f) => !f.includes("nonexistent"));
    // Remove skill from diff so glob-match also fails
    const diff = ["apps/backend/src/game/Game1Service.ts", "docs/engineering/PITFALLS_LOG.md", "docs/engineering/AGENT_EXECUTION_LOG.md"];
    const result = validate(body, diff);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("§5")));
  });

  it("fails when claimed PITFALLS not in diff", () => {
    const body = fullValidBody();
    const diff = ["apps/backend/src/game/Game1Service.ts", ".claude/skills/test-skill/SKILL.md", "docs/engineering/AGENT_EXECUTION_LOG.md"];
    const result = validate(body, diff);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("PITFALLS") || e.includes("pitfalls")));
  });

  it("fails when claimed AGENT_EXECUTION_LOG not in diff", () => {
    const body = fullValidBody();
    const diff = ["apps/backend/src/game/Game1Service.ts", ".claude/skills/test-skill/SKILL.md", "docs/engineering/PITFALLS_LOG.md"];
    const result = validate(body, diff);
    assert.equal(result.ok, false);
  });

  it("passes any skill-path when at least one skill is in diff", () => {
    // Claim refers to a different skill than diff, but a skill IS in diff
    const body = fullValidBody({ skillPath: ".claude/skills/test-skill/SKILL.md" });
    const result = validate(body, FULL_DIFF);
    assert.equal(result.ok, true);
  });

  it("skips diff check when --no-diff-check is set", () => {
    const body = fullValidBody({ skillPath: ".claude/skills/nonexistent/SKILL.md" });
    const result = validate(body, [], { skipDiffCheck: true });
    assert.equal(result.ok, true);
  });
});

// ---------- §8 Ready validation ----------

describe("§8 Ready validation", () => {
  it('accepts "ja" + Reason', () => {
    const body = fullValidBody({ readyAnswer: "ja", readyReason: "All good" });
    const result = validate(body, FULL_DIFF);
    assert.equal(result.ok, true);
  });

  it('accepts "nei" + Reason', () => {
    const body = fullValidBody({ readyAnswer: "nei", readyReason: "Awaiting review" });
    const result = validate(body, FULL_DIFF);
    assert.equal(result.ok, true);
  });

  it("rejects body without Ready: line", () => {
    const body = fullValidBody().replace(/Ready for PR:.*/, "Done.");
    const result = validate(body, FULL_DIFF);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("§8")));
  });

  it('rejects "ja"/"nei" without Reason: line', () => {
    const body = fullValidBody().replace(/Reason:.*/, "");
    const result = validate(body, FULL_DIFF);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => /Reason/.test(e)));
  });
});

// ---------- Out-of-order warning ----------

describe("section order", () => {
  it("warns but does not fail on out-of-order sections", () => {
    let body = fullValidBody();
    // Swap §6 and §7 positions
    const sec6 = body.match(/### 6\. Lessons learned[\s\S]*?(?=### 7)/)[0];
    const sec7 = body.match(/### 7\. Open risk \/ follow-up[\s\S]*?(?=### 8)/)[0];
    body = body.replace(sec6, "__SEC6__").replace(sec7, sec6).replace("__SEC6__", sec7);
    const result = validate(body, FULL_DIFF);
    assert.equal(result.ok, true);
    assert.ok(result.warnings.some((w) => /out of order/i.test(w)));
  });
});

// ---------- Heuristic guardrails ----------

describe("heuristic guards", () => {
  it("rejects fluff like 'ok ok ok' in §4", () => {
    const body = fullValidBody({ testsCommand: "ok" });
    const result = validate(body, FULL_DIFF);
    assert.equal(result.ok, false);
  });

  it("accepts legitimate complex command in §4", () => {
    const body = fullValidBody({
      testsCommand:
        "`npm --workspace=apps/backend run test -- --testNamePattern=Game1` — 27 pass",
    });
    const result = validate(body, FULL_DIFF);
    assert.equal(result.ok, true);
  });
});
