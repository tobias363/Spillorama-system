#!/usr/bin/env node
/**
 * validate-pr-agent-contract.mjs
 *
 * Validates that a PR body contains a pre-spawn Agent Contract reference
 * when the PR touches high-risk paths.
 *
 * Layered defense (per ADR-0024 followup, Fase A):
 *   - knowledge-protocol-gate / delivery-report-gate / delta-report-gate
 *     check POST-delivery evidence: was knowledge updated AFTER work?
 *   - agent-contract-gate (THIS validator) checks PRE-spawn evidence:
 *     was the agent given a proper contract BEFORE work started?
 *
 * These are different failure modes. A PR can pass post-delivery gates
 * while still having been spawned from a free-text prompt that misled
 * the agent. PITFALLS §11.19 documented this exact pattern.
 *
 * What this validator checks:
 *   1. PR-body has `Contract-ID: <YYYYMMDD-slug>` line.
 *   2. PR-body has `Contract-path: <path>` line.
 *   3. Contract-path points to a file in the PR diff (auditable trail).
 *   4. Contract-ID is consistent with the directory in Contract-path.
 *
 * OR a documented bypass:
 *   `[agent-contract-not-applicable: <reason min 20 chars>]`
 *
 * Bypass scenarios (per user spec 2026-05-16):
 *   - PR is not agent-spawned (PM/Tobias directly committed)
 *   - Change is too small for contract to be relevant
 *   - Begrunnelse explains why
 *
 * Usage:
 *   node scripts/validate-pr-agent-contract.mjs \
 *     --body-file <pr-body.md> \
 *     --diff-files <f1> <f2> ...
 *
 *   node scripts/validate-pr-agent-contract.mjs \
 *     --body-stdin --base origin/main
 *
 * Exit codes:
 *   0 — valid OR bypass OR not high-risk
 *   1 — invalid (missing/malformed contract reference)
 *   2 — argument error
 *
 * Shadow-mode: caller (workflow) decides whether to fail or warn.
 * This script always exits 1 on validation failure — workflow soft-fails
 * during shadow-mode window (until 2026-05-24 per ADR-0024).
 */

import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
};

// Same path list as delivery-report-gate.yml + delta-report-gate.yml.
// Kept inline to avoid cross-script coupling; refactor later if drift becomes a problem.
export const HIGH_RISK_PATHS = [
  "apps/backend/src/game/",
  "apps/backend/src/wallet/",
  "apps/backend/src/compliance/",
  "apps/backend/src/auth/",
  "apps/backend/src/draw-engine/",
  "apps/backend/src/sockets/",
  "apps/backend/migrations/",
  "packages/game-client/src/games/game1/",
  "packages/game-client/src/games/game2/",
  "packages/game-client/src/games/game3/",
  "packages/shared-types/src/",
  "apps/admin-web/src/pages/cash-inout/",
  "apps/admin-web/src/pages/agent-portal/",
  "apps/backend/src/routes/agentGame1",
  "apps/backend/src/routes/agentGamePlan",
  "apps/backend/src/routes/adminGame1",
];

const CONTRACT_ID_RE = /^Contract-ID:\s*(\d{8}-[a-z0-9][a-z0-9-]*)\s*$/m;
const CONTRACT_PATH_RE = /^Contract-path:\s*([^\s]+)\s*$/m;
const BYPASS_RE = /\[agent-contract-not-applicable:\s*([^\]]+?)\]/i;
const MIN_BYPASS_REASON_CHARS = 20;

export function isHighRiskChange(diffFiles) {
  return diffFiles.some((f) => HIGH_RISK_PATHS.some((p) => f.startsWith(p)));
}

export function extractBypass(body) {
  const m = BYPASS_RE.exec(body);
  if (!m) return { bypass: false };
  const reason = m[1].trim();
  return {
    bypass: true,
    reason,
    valid: reason.length >= MIN_BYPASS_REASON_CHARS,
  };
}

export function extractContractRef(body) {
  const idMatch = CONTRACT_ID_RE.exec(body);
  const pathMatch = CONTRACT_PATH_RE.exec(body);
  return {
    contractId: idMatch ? idMatch[1] : null,
    contractPath: pathMatch ? pathMatch[1] : null,
  };
}

/**
 * Returns true if contract-path lies under docs/evidence/<contract-id>/.
 * Allows trailing path segments (contract.md, evidence/*.md, etc.).
 */
export function pathMatchesId(contractPath, contractId) {
  if (!contractPath || !contractId) return false;
  const normalized = contractPath.replace(/^\.\//, "");
  return normalized.startsWith(`docs/evidence/${contractId}/`);
}

/**
 * Validate full PR body + diff.
 *
 * Returns { ok, errors, warnings, highRisk, bypass }.
 */
export function validate(body, diffFiles) {
  const errors = [];
  const warnings = [];
  const highRisk = isHighRiskChange(diffFiles);

  if (!highRisk) {
    return { ok: true, errors, warnings, highRisk: false, bypass: false };
  }

  // Bypass marker short-circuits
  const bypassInfo = extractBypass(body);
  if (bypassInfo.bypass) {
    if (!bypassInfo.valid) {
      errors.push(
        `Bypass marker found but reason is too short (${bypassInfo.reason.length} chars, min ${MIN_BYPASS_REASON_CHARS}). Provide concrete explanation of why agent-contract is not applicable.`,
      );
      return { ok: false, errors, warnings, highRisk: true, bypass: false };
    }
    return {
      ok: true,
      errors,
      warnings: [`Agent-contract bypass akseptert: ${bypassInfo.reason}`],
      highRisk: true,
      bypass: true,
    };
  }

  // Contract-ID + Contract-path required
  const ref = extractContractRef(body);

  if (!ref.contractId) {
    errors.push(
      "Missing `Contract-ID: <YYYYMMDD-slug>` line in PR body. " +
        "High-risk PRs must reference the agent-contract used pre-spawn. " +
        "See AGENT_TASK_CONTRACT.md or use `[agent-contract-not-applicable: <reason>]` for non-agent-spawned changes.",
    );
  }

  if (!ref.contractPath) {
    errors.push(
      "Missing `Contract-path: <docs/evidence/...>` line in PR body. " +
        "Path must point to the committed contract file for audit purposes.",
    );
  }

  // Cross-check: path matches ID
  if (ref.contractId && ref.contractPath && !pathMatchesId(ref.contractPath, ref.contractId)) {
    errors.push(
      `Contract-path "${ref.contractPath}" does not lie under "docs/evidence/${ref.contractId}/". ` +
        "The contract directory name must match Contract-ID.",
    );
  }

  // Cross-check: contract-path is in the PR diff
  if (ref.contractPath) {
    const normalized = ref.contractPath.replace(/^\.\//, "");
    if (!diffFiles.includes(normalized)) {
      errors.push(
        `Contract-path "${ref.contractPath}" is not in this PR's diff. ` +
          "The contract file must be committed in the same PR for the audit trail to be complete.",
      );
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    highRisk: true,
    bypass: false,
    contractId: ref.contractId,
    contractPath: ref.contractPath,
  };
}

// CLI ──────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    bodyFile: null,
    bodyStdin: false,
    diffFiles: null,
    diffBase: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--body-file") opts.bodyFile = argv[++i];
    else if (a === "--body-stdin") opts.bodyStdin = true;
    else if (a === "--diff-files") {
      opts.diffFiles = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        opts.diffFiles.push(argv[++i]);
      }
    } else if (a === "--base") opts.diffBase = argv[++i];
    else if (a === "--help" || a === "-h") {
      process.stdout.write(USAGE);
      process.exit(0);
    } else {
      process.stderr.write(`Unknown argument: ${a}\n`);
      process.exit(2);
    }
  }
  return opts;
}

const USAGE = `Usage:
  node scripts/validate-pr-agent-contract.mjs --body-file <path> --diff-files <f1> <f2> ...
  node scripts/validate-pr-agent-contract.mjs --body-stdin --base origin/main

Options:
  --body-file <path>     Read PR body from file
  --body-stdin           Read PR body from stdin
  --diff-files <f...>    Explicit list of changed files (else derived from --base)
  --base <ref>           Git ref to diff against (e.g. origin/main)
  --help                 Show this help
`;

function readBody(opts) {
  if (opts.bodyFile) {
    if (!existsSync(opts.bodyFile)) {
      process.stderr.write(`Body file not found: ${opts.bodyFile}\n`);
      process.exit(2);
    }
    return readFileSync(opts.bodyFile, "utf8");
  }
  if (opts.bodyStdin) {
    return readFileSync(0, "utf8");
  }
  process.stderr.write("Must provide --body-file or --body-stdin.\n");
  process.exit(2);
}

function readDiffFiles(opts) {
  if (opts.diffFiles) return opts.diffFiles;
  if (opts.diffBase) {
    try {
      const out = execSync(`git diff --name-only ${opts.diffBase}`, {
        encoding: "utf8",
      });
      return out.split("\n").filter(Boolean);
    } catch (err) {
      process.stderr.write(`git diff failed: ${err.message}\n`);
      process.exit(2);
    }
  }
  return [];
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const opts = parseArgs(process.argv.slice(2));
  const body = readBody(opts);
  const diffFiles = readDiffFiles(opts);

  const result = validate(body, diffFiles);

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      process.stderr.write(`${C.yellow}⚠ ${w}${C.reset}\n`);
    }
  }

  if (!result.highRisk) {
    process.stdout.write(`${C.dim}No high-risk paths in diff — agent-contract not required.${C.reset}\n`);
    process.exit(0);
  }

  if (result.ok) {
    if (result.bypass) {
      process.stdout.write(`${C.yellow}✓ Agent-contract bypass accepted.${C.reset}\n`);
    } else {
      process.stdout.write(
        `${C.green}✓ Agent-contract reference valid: ${result.contractId} → ${result.contractPath}${C.reset}\n`,
      );
    }
    process.exit(0);
  }

  process.stderr.write(`${C.red}${C.bold}✗ Agent-contract validation failed:${C.reset}\n`);
  for (const e of result.errors) {
    process.stderr.write(`  ${C.red}${e}${C.reset}\n`);
  }
  process.exit(1);
}
