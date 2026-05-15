#!/usr/bin/env node
/**
 * verify-contract-freshness.mjs
 *
 * Reads a saved agent-contract (produced by scripts/generate-agent-contract.sh)
 * and checks if any of the referenced skills have drifted since the contract
 * was generated. Drift is detected by comparing the recorded commit-SHA of
 * each skill against the current HEAD SHA.
 *
 * Usage:
 *   node scripts/verify-contract-freshness.mjs <contract.md>
 *
 * Example:
 *   node scripts/verify-contract-freshness.mjs /tmp/agent-contract-purchase-open.md
 *
 * Exit codes:
 *   0 — all skills match current HEAD
 *   1 — at least one skill has drifted (warning printed)
 *   2 — argument or parse error
 *
 * Skill-lockfile format expected in contract:
 *   - `.claude/skills/<name>/SKILL.md` @ `v<version>` @ `<12-char-sha>`
 *
 * Background: ADR-0024 + Fase 2 follow-up. Skill files evolve weekly
 * (skill-freshness-weekly workflow proves this). Without SHA capture at
 * contract-generation time, PM cannot reproduce later which skill-version
 * the agent actually worked against.
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";

function exit(code, msg) {
  if (msg) process.stderr.write(msg + "\n");
  process.exit(code);
}

const contractPath = process.argv[2];
if (!contractPath) {
  exit(
    2,
    `${RED}Usage: verify-contract-freshness.mjs <contract.md>${RESET}\n` +
      `${DIM}Verifies that skills referenced in the contract match current HEAD SHAs.${RESET}`,
  );
}

let content;
try {
  content = readFileSync(contractPath, "utf8");
} catch (err) {
  exit(2, `${RED}Cannot read contract: ${contractPath}${RESET}\n${err.message}`);
}

// Match: - `.claude/skills/<name>/SKILL.md` @ `v<version>` @ `<sha>`
const SKILL_LINE_RE =
  /^\s*-\s+`\.claude\/skills\/([^/`]+)\/SKILL\.md`\s+@\s+`v([^`]+)`\s+@\s+`([a-f0-9]+)`\s*$/gm;

const skills = [];
let match;
while ((match = SKILL_LINE_RE.exec(content)) !== null) {
  const [, name, version, sha] = match;
  skills.push({ name, version, recordedSha: sha });
}

if (skills.length === 0) {
  process.stderr.write(
    `${YELLOW}No skill@version@SHA lines found in contract.${RESET}\n` +
      `${DIM}Either contract pre-dates Fase 2 (ADR-0024 follow-up) or no skills matched scope.${RESET}\n`,
  );
  exit(0);
}

let drifted = 0;
for (const { name, version, recordedSha } of skills) {
  const skillPath = `.claude/skills/${name}/SKILL.md`;
  let currentSha;
  try {
    currentSha = execSync(`git rev-parse "HEAD:${skillPath}"`, {
      encoding: "utf8",
    })
      .trim()
      .slice(0, 12);
  } catch {
    currentSha = "missing";
  }

  if (currentSha === recordedSha) {
    process.stdout.write(
      `${GREEN}✓${RESET} ${name} @ v${version} @ ${recordedSha} (fresh)\n`,
    );
  } else {
    drifted++;
    process.stderr.write(
      `${RED}✗ DRIFT${RESET} ${name} @ v${version}\n` +
        `  contract recorded: ${recordedSha}\n` +
        `  current HEAD:      ${currentSha}\n` +
        `  ${DIM}Review diff: git diff ${recordedSha}..HEAD -- ${skillPath}${RESET}\n`,
    );
  }
}

if (drifted > 0) {
  process.stderr.write(
    `\n${YELLOW}${drifted} skill(s) have drifted since contract was generated.${RESET}\n` +
      `${DIM}Before spawning the agent, either regenerate the contract or review the diffs to confirm the changes do not invalidate the contract's premise.${RESET}\n`,
  );
  exit(1);
}

process.stdout.write(`\n${GREEN}All ${skills.length} skill(s) match current HEAD.${RESET}\n`);
exit(0);
