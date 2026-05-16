/**
 * Tests for scripts/bypass-telemetry.mjs.
 *
 * Kjøres med: node --test scripts/__tests__/bypass-telemetry.test.mjs
 *
 * Dekker:
 *   - detectBypasses — 12 bypass-mønstre fra ADR-0024
 *   - detectApprovedLabels — labels som hever bypass-godkjenning
 *   - analyzePrs — aggregering + ADR-0024 konsolideringsflagg
 *   - renderMarkdown — output-format
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  BYPASS_MARKERS,
  detectBypasses,
  detectApprovedLabels,
  analyzePrs,
  renderMarkdown,
} from "../bypass-telemetry.mjs";

// ────────────────────────────────────────────────────────────────────────
// detectBypasses
// ────────────────────────────────────────────────────────────────────────

describe("detectBypasses", () => {
  it("returns empty array for body without markers", () => {
    assert.deepEqual(detectBypasses("Regular PR description."), []);
  });

  it("detects [bypass-pm-gate: reason]", () => {
    const r = detectBypasses("Some text\n[bypass-pm-gate: hotfix etter incident]");
    assert.equal(r.length, 1);
    assert.equal(r[0].gate, "pm-gate");
    assert.match(r[0].reason, /hotfix/);
  });

  it("detects gate-not-applicable: tobias", () => {
    const r = detectBypasses("Some text\ngate-not-applicable: tobias");
    assert.equal(r.length, 1);
    assert.equal(r[0].gate, "pm-gate");
  });

  it("detects knowledge-protocol bypass", () => {
    const r = detectBypasses("[bypass-knowledge-protocol: docs-only PR]");
    assert.ok(r.some((b) => b.gate === "knowledge-protocol"));
  });

  it("detects delivery-report-not-applicable", () => {
    const r = detectBypasses(
      "[delivery-report-not-applicable: PR is documentation refactor with no agent involvement]",
    );
    assert.ok(r.some((b) => b.gate === "delivery-report"));
  });

  it("detects agent-contract-not-applicable", () => {
    const r = detectBypasses(
      "[agent-contract-not-applicable: PR is not agent-spawned, Tobias committed directly]",
    );
    assert.ok(r.some((b) => b.gate === "agent-contract"));
  });

  it("detects bug-resurrection-acknowledged", () => {
    const r = detectBypasses("[resurrection-acknowledged: same area as PR #1234 but different fix]");
    assert.ok(r.some((b) => b.gate === "bug-resurrection"));
  });

  it("detects multiple bypass markers in same body", () => {
    const body = `
[bypass-pm-gate: hotfix]
[bypass-knowledge-protocol: docs-only]
[delivery-report-not-applicable: mechanical change]
`;
    const r = detectBypasses(body);
    const gates = new Set(r.map((b) => b.gate));
    assert.ok(gates.has("pm-gate"));
    assert.ok(gates.has("knowledge-protocol"));
    assert.ok(gates.has("delivery-report"));
  });

  it("extracts reason text correctly", () => {
    const r = detectBypasses("[bypass-pm-gate: hotfix etter incident 2026-05-15]");
    assert.equal(r[0].reason, "hotfix etter incident 2026-05-15");
  });

  it("handles empty body gracefully", () => {
    assert.deepEqual(detectBypasses(""), []);
    assert.deepEqual(detectBypasses(null), []);
    assert.deepEqual(detectBypasses(undefined), []);
  });
});

// ────────────────────────────────────────────────────────────────────────
// BYPASS_MARKERS contract
// ────────────────────────────────────────────────────────────────────────

describe("BYPASS_MARKERS", () => {
  it("contains entries for all major gates", () => {
    const gates = new Set(BYPASS_MARKERS.map((m) => m.gate));
    assert.ok(gates.has("pm-gate"));
    assert.ok(gates.has("knowledge-protocol"));
    assert.ok(gates.has("delivery-report"));
    assert.ok(gates.has("delta-report"));
    assert.ok(gates.has("agent-contract"));
    assert.ok(gates.has("fragility-check"));
    assert.ok(gates.has("comprehension"));
    assert.ok(gates.has("bug-resurrection"));
    assert.ok(gates.has("intent"));
  });

  it("each entry has pattern, gate, location", () => {
    for (const def of BYPASS_MARKERS) {
      assert.ok(def.gate);
      assert.ok(def.pattern instanceof RegExp);
      assert.ok(["pr-body", "commit-msg"].includes(def.location));
    }
  });
});

// ────────────────────────────────────────────────────────────────────────
// detectApprovedLabels
// ────────────────────────────────────────────────────────────────────────

describe("detectApprovedLabels", () => {
  it("returns approved labels from name-objects", () => {
    const labels = [
      { name: "approved-pm-bypass" },
      { name: "needs-review" },
      { name: "approved-knowledge-bypass" },
    ];
    const r = detectApprovedLabels(labels);
    assert.deepEqual(r.sort(), ["approved-knowledge-bypass", "approved-pm-bypass"]);
  });

  it("handles string-only label arrays", () => {
    const r = detectApprovedLabels(["approved-emergency-merge", "other-label"]);
    assert.deepEqual(r, ["approved-emergency-merge"]);
  });

  it("returns empty array for null/undefined", () => {
    assert.deepEqual(detectApprovedLabels(null), []);
    assert.deepEqual(detectApprovedLabels(undefined), []);
  });
});

// ────────────────────────────────────────────────────────────────────────
// analyzePrs
// ────────────────────────────────────────────────────────────────────────

describe("analyzePrs", () => {
  it("returns zero stats for empty input", () => {
    const r = analyzePrs([]);
    assert.equal(r.totalPrs, 0);
    assert.equal(r.bypassPrs, 0);
    assert.equal(r.bypassRate, 0);
    assert.deepEqual(r.perGate, {});
  });

  it("counts PRs with bypass correctly", () => {
    const prs = [
      { number: 1, body: "[bypass-pm-gate: x]", author: { login: "tobias50" } },
      { number: 2, body: "Regular PR", author: { login: "tobias50" } },
      { number: 3, body: "[bypass-knowledge-protocol: y]", author: { login: "claude" } },
    ];
    const r = analyzePrs(prs);
    assert.equal(r.totalPrs, 3);
    assert.equal(r.bypassPrs, 2);
    assert.equal(r.perGate["pm-gate"].count, 1);
    assert.equal(r.perGate["knowledge-protocol"].count, 1);
  });

  it("counts per-author correctly", () => {
    const prs = [
      { number: 1, body: "[bypass-pm-gate: x]", author: { login: "tobias50" } },
      { number: 2, body: "[bypass-pm-gate: y]", author: { login: "tobias50" } },
      { number: 3, body: "[bypass-pm-gate: z]", author: { login: "claude" } },
    ];
    const r = analyzePrs(prs);
    assert.equal(r.perAuthor["tobias50"], 2);
    assert.equal(r.perAuthor["claude"], 1);
  });

  it("computes top reasons per gate", () => {
    const prs = [
      { number: 1, body: "[bypass-pm-gate: hotfix]", author: { login: "x" } },
      { number: 2, body: "[bypass-pm-gate: hotfix]", author: { login: "x" } },
      { number: 3, body: "[bypass-pm-gate: docs-only]", author: { login: "x" } },
    ];
    const r = analyzePrs(prs);
    const top = r.perGate["pm-gate"].topReasons;
    assert.equal(top[0].reason, "hotfix");
    assert.equal(top[0].count, 2);
  });

  it("flags HIGH_BYPASS_RATE when > 20% in 30-day window", () => {
    const prs = [];
    for (let i = 0; i < 10; i++) {
      prs.push({
        number: i,
        body: i < 3 ? "[bypass-pm-gate: x]" : "regular",
        author: { login: "test" },
      });
    }
    const r = analyzePrs(prs, { windowDays: 30 });
    assert.ok(r.consolidationFlags.some((f) => f.kind === "HIGH_BYPASS_RATE" && f.gate === "pm-gate"));
  });

  it("does NOT flag HIGH_BYPASS_RATE below 20% threshold", () => {
    const prs = [];
    for (let i = 0; i < 100; i++) {
      prs.push({
        number: i,
        body: i < 10 ? "[bypass-pm-gate: x]" : "regular",
        author: { login: "test" },
      });
    }
    const r = analyzePrs(prs, { windowDays: 30 });
    const flag = r.consolidationFlags.find((f) => f.kind === "HIGH_BYPASS_RATE" && f.gate === "pm-gate");
    assert.equal(flag, undefined);
  });

  it("flags ZERO_USAGE for unused gates in 60+ day window", () => {
    const prs = [
      { number: 1, body: "[bypass-pm-gate: x]", author: { login: "test" } },
    ];
    const r = analyzePrs(prs, { windowDays: 60 });
    assert.ok(
      r.consolidationFlags.some(
        (f) => f.kind === "ZERO_USAGE" && f.gate === "knowledge-protocol",
      ),
    );
  });

  it("does NOT flag ZERO_USAGE in shorter windows", () => {
    const prs = [
      { number: 1, body: "[bypass-pm-gate: x]", author: { login: "test" } },
    ];
    const r = analyzePrs(prs, { windowDays: 30 });
    assert.equal(
      r.consolidationFlags.filter((f) => f.kind === "ZERO_USAGE").length,
      0,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// renderMarkdown
// ────────────────────────────────────────────────────────────────────────

describe("renderMarkdown", () => {
  it("generates a markdown report with sections", () => {
    const prs = [
      { number: 1, body: "[bypass-pm-gate: x]", author: { login: "tobias50" } },
      { number: 2, body: "Regular", author: { login: "claude" } },
    ];
    const stats = analyzePrs(prs);
    const md = renderMarkdown(stats, { generated: "2026-05-16T00:00:00Z" });
    assert.match(md, /# Bypass Telemetry/);
    assert.match(md, /Total PRs:\*\* 2/);
    assert.match(md, /## Per-gate breakdown/);
    assert.match(md, /## Per-author bypass count/);
    assert.match(md, /tobias50/);
  });

  it("includes consolidation flags section when triggered", () => {
    const prs = [];
    for (let i = 0; i < 10; i++) {
      prs.push({
        number: i,
        body: i < 3 ? "[bypass-pm-gate: x]" : "regular",
        author: { login: "test" },
      });
    }
    const stats = analyzePrs(prs, { windowDays: 30 });
    const md = renderMarkdown(stats);
    assert.match(md, /consolidation-trigger flags/);
    assert.match(md, /HIGH_BYPASS_RATE/);
  });

  it("does NOT include flags section when none triggered", () => {
    const prs = [
      { number: 1, body: "Regular", author: { login: "test" } },
    ];
    const stats = analyzePrs(prs, { windowDays: 30 });
    const md = renderMarkdown(stats);
    assert.doesNotMatch(md, /consolidation-trigger flags/);
  });
});
