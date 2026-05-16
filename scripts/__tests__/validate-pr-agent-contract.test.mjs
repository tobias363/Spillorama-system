/**
 * Tests for scripts/validate-pr-agent-contract.mjs — Fase A pre-spawn evidence-gate.
 *
 * Kjøres med: node --test scripts/__tests__/validate-pr-agent-contract.test.mjs
 *
 * Dekker:
 *   - isHighRiskChange — path-glob-matching
 *   - extractContractRef — parse Contract-ID + Contract-path
 *   - extractBypass — parse bypass-marker
 *   - pathMatchesId — directory consistency check
 *   - validate — full flow (high-risk + valid contract, bypass, missing fields,
 *     contract-path not in diff, ID/path mismatch, non-high-risk = pass)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HIGH_RISK_PATHS,
  isHighRiskChange,
  extractContractRef,
  extractBypass,
  pathMatchesId,
  validate,
} from "../validate-pr-agent-contract.mjs";

// ────────────────────────────────────────────────────────────────────────
// Fixture builders
// ────────────────────────────────────────────────────────────────────────

function buildValidPrBody({
  contractId = "20260516-fase-a-pre-spawn-hook",
  contractPath = "docs/evidence/20260516-fase-a-pre-spawn-hook/contract.md",
  bypass = null,
} = {}) {
  const lines = ["## Summary", "Fase A delivery.", ""];
  if (bypass !== null) {
    lines.push(`[agent-contract-not-applicable: ${bypass}]`);
  } else {
    lines.push(`Contract-ID: ${contractId}`);
    lines.push(`Contract-path: ${contractPath}`);
  }
  lines.push("");
  return lines.join("\n");
}

const HIGH_RISK_DIFF = [
  "apps/backend/src/game/Game1Service.ts",
  "docs/evidence/20260516-fase-a-pre-spawn-hook/contract.md",
];

const LOW_RISK_DIFF = [
  "docs/operations/CHANGELOG.md",
  "README.md",
];

// ────────────────────────────────────────────────────────────────────────
// isHighRiskChange
// ────────────────────────────────────────────────────────────────────────

describe("isHighRiskChange", () => {
  it("returns true when any file matches HIGH_RISK_PATHS prefix", () => {
    assert.equal(isHighRiskChange(["apps/backend/src/game/x.ts"]), true);
    assert.equal(isHighRiskChange(["apps/backend/src/wallet/y.ts"]), true);
    assert.equal(isHighRiskChange(["packages/shared-types/src/index.ts"]), true);
  });

  it("returns false when no files match", () => {
    assert.equal(isHighRiskChange(["docs/foo.md", "README.md"]), false);
  });

  it("returns false for empty diff", () => {
    assert.equal(isHighRiskChange([]), false);
  });

  it("matches deep paths under high-risk prefix", () => {
    assert.equal(isHighRiskChange(["apps/backend/src/game/sub/deep/file.ts"]), true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// extractContractRef
// ────────────────────────────────────────────────────────────────────────

describe("extractContractRef", () => {
  it("extracts both ID and path when present", () => {
    const body = buildValidPrBody();
    const ref = extractContractRef(body);
    assert.equal(ref.contractId, "20260516-fase-a-pre-spawn-hook");
    assert.equal(ref.contractPath, "docs/evidence/20260516-fase-a-pre-spawn-hook/contract.md");
  });

  it("returns null fields when missing", () => {
    const ref = extractContractRef("Just a regular PR body.");
    assert.equal(ref.contractId, null);
    assert.equal(ref.contractPath, null);
  });

  it("rejects malformed Contract-ID (wrong date format)", () => {
    const body = "Contract-ID: notadate-slug\nContract-path: docs/evidence/x/c.md\n";
    const ref = extractContractRef(body);
    assert.equal(ref.contractId, null);
  });

  it("accepts Contract-ID with hyphens in slug", () => {
    const body = "Contract-ID: 20260516-fase-a-pre-spawn-hook\nContract-path: x\n";
    const ref = extractContractRef(body);
    assert.equal(ref.contractId, "20260516-fase-a-pre-spawn-hook");
  });
});

// ────────────────────────────────────────────────────────────────────────
// extractBypass
// ────────────────────────────────────────────────────────────────────────

describe("extractBypass", () => {
  it("returns bypass=false when marker absent", () => {
    const r = extractBypass("Regular text.");
    assert.equal(r.bypass, false);
  });

  it("returns bypass + valid=true for sufficient reason", () => {
    const r = extractBypass(
      "[agent-contract-not-applicable: PR is not agent-spawned; Tobias committed directly]",
    );
    assert.equal(r.bypass, true);
    assert.equal(r.valid, true);
  });

  it("returns valid=false for too-short reason", () => {
    const r = extractBypass("[agent-contract-not-applicable: short]");
    assert.equal(r.bypass, true);
    assert.equal(r.valid, false);
  });

  it("trims whitespace from reason", () => {
    const r = extractBypass(
      "[agent-contract-not-applicable:    docs-only typo fix, no agent involved   ]",
    );
    assert.equal(r.valid, true);
    assert.equal(r.reason, "docs-only typo fix, no agent involved");
  });
});

// ────────────────────────────────────────────────────────────────────────
// pathMatchesId
// ────────────────────────────────────────────────────────────────────────

describe("pathMatchesId", () => {
  it("returns true when path lies under docs/evidence/<id>/", () => {
    assert.equal(
      pathMatchesId(
        "docs/evidence/20260516-fase-a/contract.md",
        "20260516-fase-a",
      ),
      true,
    );
  });

  it("returns true for nested files", () => {
    assert.equal(
      pathMatchesId(
        "docs/evidence/20260516-fase-a/sub/file.md",
        "20260516-fase-a",
      ),
      true,
    );
  });

  it("returns false when directory name does not match", () => {
    assert.equal(
      pathMatchesId(
        "docs/evidence/20260516-different/contract.md",
        "20260516-fase-a",
      ),
      false,
    );
  });

  it("returns false when path is not under docs/evidence/", () => {
    assert.equal(
      pathMatchesId("/tmp/contract.md", "20260516-fase-a"),
      false,
    );
  });

  it("tolerates leading ./", () => {
    assert.equal(
      pathMatchesId(
        "./docs/evidence/20260516-fase-a/contract.md",
        "20260516-fase-a",
      ),
      true,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// validate — full flow
// ────────────────────────────────────────────────────────────────────────

describe("validate (full flow)", () => {
  it("passes when not high-risk", () => {
    const r = validate("Empty body.", LOW_RISK_DIFF);
    assert.equal(r.ok, true);
    assert.equal(r.highRisk, false);
  });

  it("passes when high-risk + valid contract reference + path in diff", () => {
    const r = validate(buildValidPrBody(), HIGH_RISK_DIFF);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
    assert.equal(r.highRisk, true);
    assert.equal(r.bypass, false);
  });

  it("fails when high-risk + missing Contract-ID", () => {
    const body =
      "## Summary\nFase A.\n\nContract-path: docs/evidence/20260516-x/contract.md\n";
    const r = validate(body, HIGH_RISK_DIFF);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /Contract-ID/.test(e)));
  });

  it("fails when high-risk + missing Contract-path", () => {
    const body = "Contract-ID: 20260516-fase-a-pre-spawn-hook\n";
    const r = validate(body, HIGH_RISK_DIFF);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /Contract-path/.test(e)));
  });

  it("fails when Contract-path is not in diff", () => {
    const body = buildValidPrBody({
      contractPath: "docs/evidence/20260516-fase-a-pre-spawn-hook/contract.md",
    });
    const diffWithoutContract = [
      "apps/backend/src/game/Game1Service.ts",
      // note: contract.md NOT in diff
    ];
    const r = validate(body, diffWithoutContract);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /not in this PR's diff/.test(e)));
  });

  it("fails when Contract-path doesn't match Contract-ID directory", () => {
    const body = buildValidPrBody({
      contractId: "20260516-fase-a-pre-spawn-hook",
      contractPath: "docs/evidence/20260516-DIFFERENT-SLUG/contract.md",
    });
    const diff = [
      "apps/backend/src/game/Game1Service.ts",
      "docs/evidence/20260516-DIFFERENT-SLUG/contract.md",
    ];
    const r = validate(body, diff);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /does not lie under/.test(e)));
  });

  it("passes when high-risk + valid bypass marker", () => {
    const body = buildValidPrBody({
      bypass: "PR is not agent-spawned; Tobias committed mockup directly",
    });
    const r = validate(body, HIGH_RISK_DIFF);
    assert.equal(r.ok, true);
    assert.equal(r.bypass, true);
    assert.ok(r.warnings.some((w) => /bypass akseptert/.test(w)));
  });

  it("fails when bypass marker has too-short reason", () => {
    const body = buildValidPrBody({ bypass: "short" });
    const r = validate(body, HIGH_RISK_DIFF);
    assert.equal(r.ok, false);
    assert.ok(r.errors.some((e) => /too short/.test(e)));
  });

  it("bypass marker short-circuits even if Contract-ID also present", () => {
    const body =
      "Contract-ID: 20260516-x\nContract-path: docs/evidence/20260516-x/c.md\n" +
      "[agent-contract-not-applicable: PR is documentation-only typo fix]\n";
    const r = validate(body, HIGH_RISK_DIFF);
    assert.equal(r.ok, true);
    assert.equal(r.bypass, true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Heuristic guards
// ────────────────────────────────────────────────────────────────────────

describe("heuristic guards", () => {
  it("HIGH_RISK_PATHS array is non-empty and starts with apps/backend/", () => {
    assert.ok(HIGH_RISK_PATHS.length >= 10);
    assert.ok(HIGH_RISK_PATHS.some((p) => p.startsWith("apps/backend/")));
    assert.ok(HIGH_RISK_PATHS.some((p) => p.startsWith("packages/")));
  });

  it("rejects Contract-ID without 8-digit date prefix", () => {
    const body = "Contract-ID: 2026-fase-a\nContract-path: x\n";
    const ref = extractContractRef(body);
    assert.equal(ref.contractId, null);
  });

  it("accepts realistic full PR body with surrounding markdown", () => {
    const body = [
      "## Summary",
      "",
      "Fase A delivery — pre-spawn evidence gate.",
      "",
      "## Endringer",
      "",
      "- New validator + tests",
      "- Shadow-mode workflow",
      "",
      "## Coordination",
      "",
      "Shared-file rebase: origin/main@abc1234",
      "Shared files touched: none",
      "",
      "Contract-ID: 20260516-fase-a-pre-spawn-hook",
      "Contract-path: docs/evidence/20260516-fase-a-pre-spawn-hook/contract.md",
      "",
      "gate-not-applicable: tobias",
      "",
    ].join("\n");
    const diff = [
      "scripts/validate-pr-agent-contract.mjs",
      "docs/evidence/20260516-fase-a-pre-spawn-hook/contract.md",
      "apps/backend/src/game/Game1Service.ts",
    ];
    const r = validate(body, diff);
    assert.equal(r.ok, true, JSON.stringify(r.errors));
  });
});
