#!/usr/bin/env node
/**
 * validate-skill-frontmatter.mjs
 *
 * Validates that .claude/skills/<slug>/SKILL.md files have a valid YAML
 * frontmatter block with the keys we depend on for the skill loader:
 *
 *   ---
 *   name: <slug>                 # required
 *   description: <text>          # required, recommended >= 100 chars
 *   metadata:
 *     version: <semver>          # required
 *     project: <string>          # optional but recommended
 *   ---
 *
 * Receives staged file paths as argv (lint-staged forwards them).
 *
 * Exit code 0 = pass; 1 = at least one file failed.
 *
 * Note: We use a small regex-based parser instead of pulling in the
 * `js-yaml` dependency for a single hook script. The frontmatter format
 * for SKILL.md is intentionally flat (top-level scalars + one nested
 * `metadata` map) so the parser can stay tiny. If we ever need richer
 * YAML (lists, multi-line strings beyond `description`) we should switch
 * to js-yaml.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SHORT_DESC_THRESHOLD = 100;

const files = process.argv.slice(2);
let errorCount = 0;

for (const rel of files) {
  const file = resolve(rel);
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch (err) {
    console.error(`X ${rel}: cannot read file (${err.message})`);
    errorCount++;
    continue;
  }

  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    console.error(`X ${rel}: missing YAML frontmatter (must start with '---' on line 1)`);
    errorCount++;
    continue;
  }

  const parsed = parseFlatFrontmatter(match[1]);
  if (parsed.errors.length > 0) {
    for (const err of parsed.errors) {
      console.error(`X ${rel}: ${err}`);
      errorCount++;
    }
    continue;
  }

  const meta = parsed.data;

  // Required: name
  if (!meta.name || typeof meta.name !== "string" || meta.name.trim() === "") {
    console.error(`X ${rel}: missing or empty 'name'`);
    errorCount++;
  }

  // Required: description
  if (!meta.description || typeof meta.description !== "string" || meta.description.trim() === "") {
    console.error(`X ${rel}: missing or empty 'description'`);
    errorCount++;
  } else if (meta.description.trim().length < SHORT_DESC_THRESHOLD) {
    // Warn but do not fail — short descriptions can be intentional.
    console.error(
      `! ${rel}: description is short (${meta.description.trim().length} chars). ` +
        `Pushy descriptions trigger better — recommended >= ${SHORT_DESC_THRESHOLD} chars.`,
    );
  }

  // Required: metadata.version
  if (!meta.metadata || typeof meta.metadata !== "object" || meta.metadata === null) {
    console.error(`X ${rel}: missing 'metadata' block (need 'metadata.version')`);
    errorCount++;
  } else if (!meta.metadata.version || typeof meta.metadata.version !== "string") {
    console.error(`X ${rel}: missing 'metadata.version'`);
    errorCount++;
  }
}

process.exit(errorCount > 0 ? 1 : 0);

/**
 * Parse a flat YAML-like frontmatter where top-level keys are scalars
 * and `metadata:` may have indented sub-keys. Returns
 * `{ data, errors[] }`.
 *
 * Supports:
 *   key: scalar value
 *   metadata:
 *     subkey: subvalue
 *
 * Does NOT support: lists, multi-line strings (other than the natural
 * single-line description), nested maps deeper than one level.
 */
function parseFlatFrontmatter(text) {
  const data = {};
  const errors = [];
  const lines = text.split(/\r?\n/);

  let currentMap = null; // when inside `metadata:` block

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") {
      continue;
    }

    // Comment line
    if (raw.trimStart().startsWith("#")) {
      continue;
    }

    const indented = raw.startsWith("  ") || raw.startsWith("\t");

    if (!indented) {
      // Top-level key
      currentMap = null;

      const m = raw.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
      if (!m) {
        errors.push(`frontmatter line ${i + 1}: cannot parse '${raw}'`);
        continue;
      }
      const key = m[1];
      const valueRaw = m[2].trim();

      if (valueRaw === "") {
        // Likely a parent map (e.g. `metadata:`)
        data[key] = {};
        currentMap = data[key];
      } else {
        data[key] = stripQuotes(valueRaw);
      }
    } else {
      // Indented sub-key
      if (currentMap === null) {
        errors.push(`frontmatter line ${i + 1}: indented value with no parent map: '${raw}'`);
        continue;
      }
      const m = raw.match(/^\s+([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
      if (!m) {
        errors.push(`frontmatter line ${i + 1}: cannot parse indented '${raw}'`);
        continue;
      }
      currentMap[m[1]] = stripQuotes(m[2].trim());
    }
  }

  return { data, errors };
}

function stripQuotes(value) {
  if (value.length >= 2) {
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }
  }
  return value;
}
