#!/usr/bin/env node
/**
 * find-skills-for-file.mjs — print skills whose scope-glob matches a file
 *
 * Usage:
 *   node scripts/find-skills-for-file.mjs <file> [<file>...]
 *
 * Example:
 *   node scripts/find-skills-for-file.mjs apps/backend/src/game/Game2Engine.ts
 *   → spill2-perpetual-loop
 *
 * Reads `<!-- scope: glob1, glob2, ... -->` from each
 * `.claude/skills/<name>/SKILL.md`. Globs follow shell-style with
 * `*` (single segment wildcard) and `**` (multi-segment).
 *
 * Output: one skill-name per line, sorted alphabetically. Exit code 0
 * even if no matches (so callers can pipe safely).
 *
 * Used by:
 *   - scripts/generate-context-pack.sh (auto-context for agent-spawn)
 *   - scripts/build-skill-file-map.mjs (catalog of file → skills)
 *   - .github/workflows/skill-mapping-validate.yml (CI gate)
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const SKILLS_DIR = join(REPO_ROOT, ".claude", "skills");

const SCOPE_RE = /^<!--\s*scope:\s*(.*?)\s*-->\s*$/m;

/**
 * Loads all skill scope-mappings. Returns Map<skill-name, glob-pattern[]>.
 * A skill with empty scope is included with `[]` (so callers can detect
 * "this skill exists but has no scope assigned").
 */
export function loadSkillScopes() {
  const skills = new Map();
  let entries;
  try {
    entries = readdirSync(SKILLS_DIR, { withFileTypes: true });
  } catch {
    return skills;
  }
  for (const dirent of entries) {
    if (!dirent.isDirectory()) continue;
    const skillName = dirent.name;
    const skillFile = join(SKILLS_DIR, skillName, "SKILL.md");
    let content;
    try {
      content = readFileSync(skillFile, "utf8");
    } catch {
      continue;
    }
    const match = SCOPE_RE.exec(content);
    if (!match) {
      skills.set(skillName, null); // no scope header at all
      continue;
    }
    const raw = match[1].trim();
    const patterns = raw === ""
      ? []
      : raw.split(",").map((s) => s.trim()).filter(Boolean);
    skills.set(skillName, patterns);
  }
  return skills;
}

/**
 * Convert a single glob to a RegExp. Handles `**` (multi-segment) and
 * `*` (single-segment wildcard). Path-separators are normalised to `/`.
 */
function globToRegex(glob) {
  // Escape regex chars except `*` and `?`
  let pattern = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  // Replace `**` first (so we don't get bitten by single-`*` rule)
  pattern = pattern.replace(/\*\*/g, "::DOUBLESTAR::");
  pattern = pattern.replace(/\*/g, "[^/]*");
  pattern = pattern.replace(/\?/g, ".");
  pattern = pattern.replace(/::DOUBLESTAR::/g, ".*");
  return new RegExp(`^${pattern}$`);
}

/**
 * Returns true if `file` (relative path from repo root) matches `glob`.
 */
export function fileMatchesGlob(file, glob) {
  // Normalise path separators
  const normalised = file.replace(/\\/g, "/");
  const re = globToRegex(glob);
  return re.test(normalised);
}

/**
 * Returns sorted skill-names matching the file. Skills with `null` scope
 * (header missing) are NOT matched — they need a scope-header to be
 * useful, and CI catches the missing case separately.
 */
export function findSkillsForFile(file, skillScopes) {
  const matches = [];
  for (const [skill, patterns] of skillScopes.entries()) {
    if (!Array.isArray(patterns) || patterns.length === 0) continue;
    for (const glob of patterns) {
      if (fileMatchesGlob(file, glob)) {
        matches.push(skill);
        break;
      }
    }
  }
  return matches.sort();
}

// CLI entry-point
const isMain = process.argv[1] === __filename;
if (isMain) {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("Usage: find-skills-for-file.mjs <file> [<file>...]");
    process.exit(2);
  }
  const scopes = loadSkillScopes();
  const all = new Set();
  for (const file of files) {
    // Normalise: strip leading ./ and repo-root prefix
    let normalised = file.replace(/^\.\//, "");
    if (normalised.startsWith(`${REPO_ROOT}/`)) {
      normalised = normalised.slice(REPO_ROOT.length + 1);
    }
    for (const skill of findSkillsForFile(normalised, scopes)) {
      all.add(skill);
    }
  }
  const sorted = [...all].sort();
  for (const skill of sorted) {
    console.log(skill);
  }
}
