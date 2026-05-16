#!/usr/bin/env node
/**
 * validate-delivery-report.mjs
 *
 * Validates that an Agent Delivery Report (in a PR body) contains all 8
 * mandatory H3 sections per docs/engineering/AGENT_DELIVERY_REPORT_TEMPLATE.md
 * AND that §5 "Knowledge updates" claims are consistent with the actual diff.
 *
 * Adresserer Fase 3-gapet konsulent-review 2026-05-16 identifiserte:
 * "AGENT_DELIVERY_REPORT er ikke teknisk validert — PM må eyeballe 8 seksjoner
 * × 6 agenter = 48 checkbokser under press."
 *
 * Usage:
 *   # Local (from PR body + git diff vs base)
 *   node scripts/validate-delivery-report.mjs --body-file <pr-body.md> --base origin/main
 *
 *   # CI (body from event payload, diff from git)
 *   node scripts/validate-delivery-report.mjs --body-stdin --diff-files <file1> <file2> ...
 *
 *   # Skip cross-check (heuristics only)
 *   node scripts/validate-delivery-report.mjs --body-file <pr-body.md> --no-diff-check
 *
 * Exit codes:
 *   0 — valid (or bypass marker present)
 *   1 — invalid
 *   2 — argument error
 *
 * Bypass:
 *   Include `[delivery-report-not-applicable: <reason>]` in PR body.
 *   Reason must be >= 10 chars. Workflow gates on `approved-delivery-report-bypass`
 *   label in addition.
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

// Exact section titles from AGENT_DELIVERY_REPORT_TEMPLATE.md.
// Order matters — used for "out of order" detection.
export const SECTIONS = [
  { num: 1, title: "Context read before changes" },
  { num: 2, title: "What changed" },
  { num: 3, title: "Invariants preserved" },
  { num: 4, title: "Tests and verification" },
  { num: 5, title: "Knowledge updates" },
  { num: 6, title: "Lessons learned" },
  { num: 7, title: "Open risk / follow-up" },
  { num: 8, title: "Ready for PR" },
];

const BYPASS_RE = /\[delivery-report-not-applicable:\s*([^\]]+?)\]/i;
const REPORT_START_RE = /^##\s+Agent Delivery Report\b/im;
const READY_RE = /Ready for PR:\s*(ja|nei)\b/i;
const REASON_RE = /Reason:\s*\S+/i;
const COMMAND_RE = /`[^`\n]{3,}`/; // backtick-span >= 3 chars

// Paths the §5 Knowledge updates section should mention if claimed
const KNOWLEDGE_PATH_PATTERNS = [
  {
    name: "skill",
    pattern: /\.claude\/skills\/[^/\s`)]+\/SKILL\.md/g,
    diffMatcher: (file) => file.startsWith(".claude/skills/") && file.endsWith("SKILL.md"),
  },
  {
    name: "pitfalls",
    pattern: /docs\/engineering\/PITFALLS_LOG\.md/g,
    diffMatcher: (file) => file === "docs/engineering/PITFALLS_LOG.md",
  },
  {
    name: "agent_log",
    pattern: /docs\/engineering\/AGENT_EXECUTION_LOG\.md/g,
    diffMatcher: (file) => file === "docs/engineering/AGENT_EXECUTION_LOG.md",
  },
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a regex that matches an H3 header for the given section.
 * Tolerates trailing spaces and CRLF line endings.
 */
function headerRegex(num, title) {
  return new RegExp(`^###\\s+${num}\\.\\s+${escapeRegex(title)}\\s*$`, "im");
}

/**
 * Locate each section header in the body. Returns an array of
 * { num, title, index, end } where index is start-of-header and
 * end is start of next header (or body length).
 */
export function parseSections(body) {
  const found = [];
  for (const sec of SECTIONS) {
    const m = headerRegex(sec.num, sec.title).exec(body);
    if (m) {
      found.push({ num: sec.num, title: sec.title, index: m.index });
    }
  }
  // Sort by index (handles out-of-order headers gracefully) and compute end
  found.sort((a, b) => a.index - b.index);
  for (let i = 0; i < found.length; i++) {
    found[i].end = i + 1 < found.length ? found[i + 1].index : body.length;
    found[i].content = body.slice(found[i].index, found[i].end);
  }
  return found;
}

/**
 * Find which sections are missing vs all expected.
 */
export function missingSections(parsed) {
  const seenNums = new Set(parsed.map((p) => p.num));
  return SECTIONS.filter((s) => !seenNums.has(s.num));
}

/**
 * Validate that the body contains a delivery-report header at all.
 * Returns null if found, error string if missing.
 */
function validateReportPresent(body) {
  if (!REPORT_START_RE.test(body)) {
    return "Missing `## Agent Delivery Report` header. Use the template in docs/engineering/AGENT_DELIVERY_REPORT_TEMPLATE.md.";
  }
  return null;
}

/**
 * §8 Ready for PR must be "ja" or "nei" with a Reason: line.
 */
function validateReadySection(content) {
  if (!READY_RE.test(content)) {
    return '§8 must include "Ready for PR: ja" or "Ready for PR: nei".';
  }
  if (!REASON_RE.test(content)) {
    return '§8 must include "Reason: <text>" after the Ready line.';
  }
  return null;
}

/**
 * §4 Tests and verification should have at least one backtick-command OR
 * an explicit "ikke kjørt" / "not run" justification.
 */
function validateTestsSection(content) {
  if (COMMAND_RE.test(content)) return null;
  // Allow explicit "ikke kjørt" / "not run" with a reason
  if (/(ikke\s+kjørt|not\s+run|no\s+tests)/i.test(content)) {
    // Require a reason word longer than 5 chars after the marker
    if (/(grunn|reason|because|fordi)\b/i.test(content)) {
      return null;
    }
    return '§4 marks tests as "ikke kjørt" / "not run" but does not explain the reason. Provide concrete justification.';
  }
  return '§4 must contain at least one backticked command (e.g. `npm test`) OR explicit "ikke kjørt" + reason.';
}

/**
 * §5 Knowledge updates: parse paths and cross-check against diff.
 * If body claims a skill/PITFALLS/AGENT_EXECUTION_LOG path, the diff
 * must include that file (or a matching glob).
 */
function validateKnowledgeSection(content, diffFiles, options) {
  if (options.skipDiffCheck) return null;

  const errors = [];
  for (const { name, pattern, diffMatcher } of KNOWLEDGE_PATH_PATTERNS) {
    pattern.lastIndex = 0;
    const claims = [];
    let m;
    while ((m = pattern.exec(content)) !== null) {
      claims.push(m[0]);
    }
    if (claims.length === 0) continue;

    // For each claim, find at least one diff file matching the path pattern.
    for (const claim of claims) {
      // Skill claims may reference a specific skill (`.claude/skills/<name>/SKILL.md`).
      // Match exact path first, then fall back to glob-match via diffMatcher.
      const exactMatch = diffFiles.some((f) => f === claim);
      const globMatch = diffFiles.some(diffMatcher);
      if (!exactMatch && !globMatch) {
        errors.push(
          `§5 claims "${claim}" was updated, but the diff does not include any ${name} file. ` +
            `Either remove the claim or add the file to this PR.`,
        );
      }
    }
  }
  return errors.length > 0 ? errors.join("\n  ") : null;
}

/**
 * Check that no sections are out of order. Returns warning string or null.
 */
function checkOrder(parsed) {
  const order = parsed.map((p) => p.num);
  for (let i = 1; i < order.length; i++) {
    if (order[i] < order[i - 1]) {
      return `Sections appear out of order in the body (found ${order.join(", ")}). This is allowed but consider keeping 1-8 sequence for readability.`;
    }
  }
  return null;
}

/**
 * Main validation. Returns { ok: boolean, errors: string[], warnings: string[] }.
 */
export function validate(body, diffFiles, options = {}) {
  const errors = [];
  const warnings = [];

  // Bypass marker — short-circuit if present with sufficient reason
  const bypass = BYPASS_RE.exec(body);
  if (bypass) {
    const reason = bypass[1].trim();
    if (reason.length < 10) {
      errors.push(
        `Bypass marker found but reason is too short (${reason.length} chars). Provide >= 10 chars explaining why the report is not applicable.`,
      );
      return { ok: false, errors, warnings, bypass: false };
    }
    return { ok: true, errors, warnings: [`Bypass: ${reason}`], bypass: true };
  }

  // Must have report header
  const presentErr = validateReportPresent(body);
  if (presentErr) {
    errors.push(presentErr);
    return { ok: false, errors, warnings, bypass: false };
  }

  // Parse sections
  const parsed = parseSections(body);

  // All 8 headers must be present
  const missing = missingSections(parsed);
  if (missing.length > 0) {
    errors.push(
      `Missing ${missing.length} required section(s):\n  ${missing
        .map((s) => `§${s.num} ${s.title}`)
        .join("\n  ")}`,
    );
  }

  // Per-section content validation (only on sections that exist)
  const byNum = Object.fromEntries(parsed.map((p) => [p.num, p]));

  if (byNum[4]) {
    const e = validateTestsSection(byNum[4].content);
    if (e) errors.push(e);
  }

  if (byNum[5]) {
    const e = validateKnowledgeSection(byNum[5].content, diffFiles, options);
    if (e) errors.push(e);
  }

  if (byNum[8]) {
    const e = validateReadySection(byNum[8].content);
    if (e) errors.push(e);
  }

  // Order check is a warning
  const orderWarn = checkOrder(parsed);
  if (orderWarn) warnings.push(orderWarn);

  return { ok: errors.length === 0, errors, warnings, bypass: false };
}

// CLI entry-point
function parseArgs(argv) {
  const opts = {
    bodyFile: null,
    bodyStdin: false,
    diffFiles: null,
    diffBase: null,
    skipDiffCheck: false,
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
    else if (a === "--no-diff-check") opts.skipDiffCheck = true;
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
  node scripts/validate-delivery-report.mjs --body-file <path> [--base origin/main]
  node scripts/validate-delivery-report.mjs --body-stdin --diff-files <f1> <f2> ...
  node scripts/validate-delivery-report.mjs --body-file <path> --no-diff-check

Options:
  --body-file <path>     Read PR body from file
  --body-stdin           Read PR body from stdin
  --diff-files <f...>    Explicit list of changed files (else derived from --base)
  --base <ref>           Git ref to diff against (e.g. origin/main)
  --no-diff-check        Skip §5 cross-check (heuristics only)
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

  const result = validate(body, diffFiles, { skipDiffCheck: opts.skipDiffCheck });

  if (result.warnings.length > 0) {
    for (const w of result.warnings) {
      process.stderr.write(`${C.yellow}⚠ ${w}${C.reset}\n`);
    }
  }

  if (result.ok) {
    if (result.bypass) {
      process.stdout.write(`${C.yellow}✓ Delivery report bypass accepted.${C.reset}\n`);
    } else {
      process.stdout.write(`${C.green}✓ Delivery report valid.${C.reset}\n`);
    }
    process.exit(0);
  }

  process.stderr.write(`${C.red}${C.bold}✗ Delivery report invalid:${C.reset}\n`);
  for (const e of result.errors) {
    process.stderr.write(`  ${C.red}${e}${C.reset}\n`);
  }
  process.exit(1);
}
